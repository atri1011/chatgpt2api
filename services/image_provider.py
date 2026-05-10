from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

from curl_cffi.requests import Session

from services.config import config
from services.protocol.conversation import (
    ConversationRequest,
    ImageOutput,
    ImageGenerationError,
    collect_image_outputs,
    encode_images,
    format_image_result,
    save_image_bytes,
    stream_image_chunks,
    stream_image_outputs_with_pool,
)
from services.proxy_service import proxy_settings
from utils.helper import CHATGPT_WEB_IMAGE_MODELS, IMAGE_MODELS
from utils.log import logger

LINGGAN10S_MODEL_MAPPING = {
    "gpt-image-2": "gpt-image-1",
    "codex-gpt-image-2": "gpt-image-1",
    "gpt-5-4-thinking": "gpt-image-1",
    "gpt-5-3": "gpt-image-0",
}


def _normalize_model(model: object) -> str:
    return str(model or "").strip() or "gpt-image-2"


def _ensure_supported_image_model(model: str) -> None:
    if model not in IMAGE_MODELS:
        raise ImageGenerationError(
            "unsupported image model,supported models: " + ", ".join(sorted(IMAGE_MODELS)),
            status_code=400,
            error_type="invalid_request_error",
            code="unsupported_model",
            param="model",
        )


def _sanitize_extension(filename: str, mime_type: str) -> str:
    suffix = Path(filename or "").suffix.lower().strip(".")
    if suffix in {"png", "jpg", "jpeg", "webp", "gif"}:
        return "jpg" if suffix == "jpeg" else suffix
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    if mime_type == "image/gif":
        return "gif"
    return "png"


def save_reference_image_bytes(
    image_data: bytes,
    filename: str,
    mime_type: str,
    base_url: str | None,
) -> str:
    if not image_data:
        raise ImageGenerationError("image file is empty", status_code=400, error_type="invalid_request_error", param="image")
    resolved_base_url = str(base_url or config.base_url or "").strip().rstrip("/")
    if not resolved_base_url:
        raise ImageGenerationError(
            "base_url is required for image edit with provider linggan10s",
            status_code=400,
            error_type="invalid_request_error",
            code="base_url_required",
            param="base_url",
        )
    host = urlparse(resolved_base_url).hostname or ""
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        raise ImageGenerationError(
            "base_url must be a publicly reachable URL for image edit with provider linggan10s",
            status_code=400,
            error_type="invalid_request_error",
            code="base_url_not_public",
            param="base_url",
        )
    config.cleanup_old_images()
    ext = _sanitize_extension(filename, mime_type)
    relative_dir = Path(time.strftime("%Y"), time.strftime("%m"), time.strftime("%d"))
    target_dir = config.images_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{int(time.time() * 1000)}_{os.urandom(6).hex()}.{ext}"
    file_path = target_dir / safe_name
    file_path.write_bytes(image_data)
    return f"{resolved_base_url}/images/{relative_dir.as_posix()}/{safe_name}"


def _reference_image_urls(request: ConversationRequest) -> list[str]:
    urls = [str(item).strip() for item in (request.images or []) if str(item).strip().startswith(("http://", "https://"))]
    if urls:
        return urls
    inputs = request.image_inputs or []
    if not inputs:
        return []
    return [
        save_reference_image_bytes(image_data, filename, mime_type, request.base_url)
        for image_data, filename, mime_type in inputs
    ]


def _chatgpt_web_handle(request: ConversationRequest, stream: bool = False) -> dict[str, Any] | Iterator[dict[str, Any]]:
    normalized_request = request
    if request.images is None and request.image_inputs:
        normalized_request = ConversationRequest(
            model=request.model,
            prompt=request.prompt,
            messages=request.messages,
            images=encode_images(request.image_inputs) or None,
            image_inputs=request.image_inputs,
            n=request.n,
            size=request.size,
            response_format=request.response_format,
            base_url=request.base_url,
            message_as_error=request.message_as_error,
            timeout_sec=request.timeout_sec,
        )
    outputs = stream_image_outputs_with_pool(normalized_request)
    if stream:
        return stream_image_chunks(outputs)
    return collect_image_outputs(outputs)


def _linggan10s_model(model: str) -> str:
    mapped = LINGGAN10S_MODEL_MAPPING.get(model)
    if mapped:
        return mapped
    fallback = config.image_default_model
    mapped_fallback = LINGGAN10S_MODEL_MAPPING.get(fallback, fallback)
    logger.warning({
        "event": "image_provider_model_fallback",
        "provider": "linggan10s",
        "requested_model": model,
        "fallback_model": mapped_fallback,
    })
    return mapped_fallback


def _linggan10s_request_payload(request: ConversationRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": _linggan10s_model(_normalize_model(request.model)),
        "prompt": request.prompt,
        "n": max(1, request.n),
        "size": request.size,
    }
    if request.timeout_sec:
        payload["timeout_sec"] = request.timeout_sec
    image_urls = _reference_image_urls(request)
    if image_urls:
        payload["image"] = image_urls
    return {key: value for key, value in payload.items() if value not in (None, "", [])}


def _linggan10s_handle(request: ConversationRequest) -> dict[str, Any]:
    api_base_url = config.image_api_base_url
    api_key = config.image_api_key
    if not api_base_url:
        raise ImageGenerationError(
            "CHATGPT2API_IMAGE_API_BASE_URL is required when image provider is linggan10s",
            status_code=500,
            error_type="configuration_error",
            code="missing_image_api_base_url",
        )
    if not api_key:
        raise ImageGenerationError(
            "CHATGPT2API_IMAGE_API_KEY is required when image provider is linggan10s",
            status_code=500,
            error_type="configuration_error",
            code="missing_image_api_key",
        )

    session = Session(**proxy_settings.build_session_kwargs(verify=True))
    try:
        response = session.post(
            f"{api_base_url}/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json=_linggan10s_request_payload(request),
            timeout=request.timeout_sec or config.image_timeout_sec,
        )
    except Exception as exc:
        raise ImageGenerationError(str(exc) or "image generation failed") from exc
    finally:
        session.close()

    try:
        payload = response.json()
    except Exception as exc:
        raise ImageGenerationError(f"invalid upstream response: {response.text}") from exc

    if response.status_code < 200 or response.status_code >= 300:
        error = payload.get("error") if isinstance(payload, dict) else None
        message = ""
        if isinstance(error, dict):
            message = str(error.get("message") or error.get("error") or "")
        if not message:
            message = str(payload)
        raise ImageGenerationError(message or f"upstream status {response.status_code}")

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise ImageGenerationError("invalid upstream response: data is required")
    normalized_items: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            normalized_items.append(_normalize_linggan10s_result_item(item, request))
        except ImageGenerationError:
            raise
        except Exception as exc:
            logger.warning({
                "event": "linggan10s_item_normalize_failed",
                "item": item,
                "error": str(exc),
            })
    return format_image_result(
        normalized_items,
        request.prompt,
        request.response_format,
        request.base_url,
        int(payload.get("created") or 0) or int(time.time()),
        str(payload.get("message") or ""),
    )


def _normalize_linggan10s_result_item(item: dict[str, Any], request: ConversationRequest) -> dict[str, Any]:
    normalized = dict(item)
    raw_url = str(item.get("url") or "").strip()
    raw_b64 = str(item.get("b64_json") or "").strip()
    source_url = raw_url or (raw_b64 if raw_b64.startswith(("http://", "https://")) else "")
    if not source_url:
        return normalized

    image_bytes, content_type = _download_upstream_image_bytes(source_url, request.timeout_sec or config.image_timeout_sec)
    local_url = save_image_bytes(image_bytes, request.base_url)
    normalized["url"] = local_url
    if request.response_format == "b64_json":
        normalized["b64_json"] = base64.b64encode(image_bytes).decode("ascii")
    elif raw_b64 and not raw_b64.startswith(("http://", "https://")):
        normalized["b64_json"] = raw_b64
    return normalized


def _download_upstream_image_bytes(url: str, timeout_sec: int) -> tuple[bytes, str]:
    session = Session(**proxy_settings.build_session_kwargs(verify=True))
    try:
        response = session.get(url, headers={"Accept": "image/*,*/*"}, timeout=timeout_sec)
    except Exception as exc:
        raise ImageGenerationError(f"failed to download upstream image: {exc}") from exc
    finally:
        session.close()
    if response.status_code < 200 or response.status_code >= 300:
        raise ImageGenerationError(f"failed to download upstream image: status={response.status_code}")
    image_bytes = bytes(response.content or b"")
    if not image_bytes:
        raise ImageGenerationError("failed to download upstream image: empty body")
    return image_bytes, str(response.headers.get("content-type") or "image/png")


def image_provider_name() -> str:
    return config.image_provider


def stream_image_outputs(request: ConversationRequest) -> Iterator[ImageOutput]:
    model = _normalize_model(request.model)
    _ensure_supported_image_model(model)
    request.model = model
    request.timeout_sec = request.timeout_sec or config.image_timeout_sec
    provider = image_provider_name()
    if provider == "chatgpt_web":
        yield from stream_image_outputs_with_pool(request)
        return
    if provider == "linggan10s":
        yield from _single_result_to_outputs(_linggan10s_handle(request), model)
        return
    raise ImageGenerationError(f"unsupported image provider: {provider}", code="unsupported_image_provider")


def handle_image_request(request: ConversationRequest, stream: bool = False) -> dict[str, Any] | Iterator[dict[str, Any]]:
    outputs = stream_image_outputs(request)
    if stream:
        return stream_image_chunks(outputs)
    return collect_image_outputs(outputs)


def _single_result_to_outputs(result: dict[str, Any], model: str) -> Iterator[ImageOutput]:
    created = int(result.get("created") or 0) or int(time.time())
    data = result.get("data")
    if isinstance(data, list) and data:
        yield ImageOutput(kind="result", model=model, index=1, total=1, created=created, data=data)
        return
    message = str(result.get("message") or "").strip()
    if message:
        yield ImageOutput(kind="message", model=model, index=1, total=1, created=created, text=message)


def image_models_for_provider() -> set[str]:
    if image_provider_name() == "chatgpt_web":
        return set(CHATGPT_WEB_IMAGE_MODELS)
    return set(IMAGE_MODELS)
