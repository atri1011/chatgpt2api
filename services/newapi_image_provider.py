from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from typing import Any

from curl_cffi import CurlMime, requests

from services.config import config
from services.proxy_service import proxy_settings
from utils.helper import decode_base64_bytes, ensure_ok, iter_sse_payloads
from utils.log import logger


class NewAPIImageProviderConfigError(ValueError):
    """Raised when the NewAPI image provider is selected but env config is incomplete."""


class NewAPIImageProviderResponseError(RuntimeError):
    """Raised when NewAPI returns a successful response without usable image data."""


@dataclass(frozen=True)
class NewAPIImageResult:
    created: int
    items: list[dict[str, Any]]


def _clean(value: object) -> str:
    return str(value or "").strip()


def _decode_data_url(value: str) -> bytes:
    header, separator, payload = value.partition(",")
    if not separator or not header.lower().startswith("data:image/"):
        raise NewAPIImageProviderResponseError("NewAPI returned an invalid image data URL")
    try:
        return decode_base64_bytes(value, validate=";base64" in header.lower())
    except Exception as exc:
        raise NewAPIImageProviderResponseError("NewAPI returned invalid base64 image data") from exc


class NewAPIImageProvider:
    _BASE64_TEXT_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")
    _BASE64_KEYS = (
        "b64_json",
        "base64",
        "b64",
        "image_b64",
        "image_base64",
        "image_data",
    )
    _REFERENCE_KEYS = (
        "url",
        "image_url",
        "image",
        "result",
        "output",
        "content",
        "data",
    )

    def _build_image_multipart(self, images: list[tuple[bytes, str, str]]) -> CurlMime:
        parts = [
            {
                "name": "image",
                "filename": filename or f"image_{index}.png",
                "content_type": mime_type or "image/png",
                "data": image_data,
            }
            for index, (image_data, filename, mime_type) in enumerate(images, start=1)
            if image_data
        ]
        if not parts:
            raise NewAPIImageProviderResponseError("image is required")
        return CurlMime.from_list(parts)

    def _base_url(self) -> str:
        base_url = config.newapi_image_base_url
        if not base_url:
            raise NewAPIImageProviderConfigError("CHATGPT2API_NEWAPI_BASE_URL is required when image_provider=newapi")
        return base_url.rstrip("/")

    def _api_key(self) -> str:
        api_key = config.newapi_image_api_key
        if not api_key:
            raise NewAPIImageProviderConfigError("CHATGPT2API_NEWAPI_API_KEY is required when image_provider=newapi")
        return api_key

    def _api_url(self, path: str) -> str:
        base_url = self._base_url()
        prefix = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
        return f"{prefix}{path}"

    def _headers(self, *, json_content: bool) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._api_key()}",
            "Accept": "application/json",
        }
        if json_content:
            headers["Content-Type"] = "application/json"
        return headers

    def _stream_headers(self, *, json_content: bool) -> dict[str, str]:
        headers = self._headers(json_content=json_content)
        headers["Accept"] = "text/event-stream"
        return headers

    def _upstream_model(self, request_model: str) -> str:
        configured = config.newapi_image_model
        if configured.lower() == "passthrough":
            return _clean(request_model) or "gpt-image-1"
        return configured

    def generate(
        self,
        *,
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        response_format: str,
    ) -> NewAPIImageResult:
        payload: dict[str, Any] = {
            "model": self._upstream_model(model),
            "prompt": prompt,
            "n": n,
            "response_format": response_format,
            "stream": True,
        }
        if size:
            payload["size"] = size
        response = requests.post(
            self._api_url("/images/generations"),
            headers=self._stream_headers(json_content=True),
            json=payload,
            timeout=config.newapi_image_timeout_sec,
            stream=True,
            **proxy_settings.build_session_kwargs(),
        )
        ensure_ok(response, "newapi_images_generations")
        return self._normalize_stream_or_json_response(response, prompt)

    def edit(
        self,
        *,
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        response_format: str,
        images: list[tuple[bytes, str, str]],
    ) -> NewAPIImageResult:
        if not images:
            raise NewAPIImageProviderResponseError("image is required")
        data: dict[str, str] = {
            "model": self._upstream_model(model),
            "prompt": prompt,
            "n": str(n),
            "response_format": response_format,
            "stream": "true",
        }
        if size:
            data["size"] = size
        multipart = self._build_image_multipart(images)
        try:
            response = requests.post(
                self._api_url("/images/edits"),
                headers=self._stream_headers(json_content=False),
                data=data,
                multipart=multipart,
                timeout=config.newapi_image_timeout_sec,
                stream=True,
                **proxy_settings.build_session_kwargs(),
            )
            ensure_ok(response, "newapi_images_edits")
            return self._normalize_stream_or_json_response(response, prompt)
        finally:
            multipart.close()

    def _download_image_b64(self, url: str) -> str:
        if url.lower().startswith("data:image/"):
            return base64.b64encode(_decode_data_url(url)).decode("ascii")
        response = requests.get(
            url,
            headers={"Accept": "image/*,*/*;q=0.8", "User-Agent": "chatgpt2api newapi image fetcher"},
            timeout=config.newapi_image_timeout_sec,
            allow_redirects=True,
            **proxy_settings.build_session_kwargs(),
        )
        ensure_ok(response, "newapi_image_download")
        if not response.content:
            raise NewAPIImageProviderResponseError("NewAPI image URL returned empty content")
        return base64.b64encode(response.content).decode("ascii")

    def _normalize_stream_or_json_response(self, response: requests.Response, prompt: str) -> NewAPIImageResult:
        payload = self._last_stream_payload(response)
        if payload is None:
            payload = response.json()
        return self._normalize_response(payload, prompt)

    def _normalize_base64_payload(self, value: object, *, strict: bool) -> str:
        text = _clean(value)
        if not text:
            return ""
        normalized = "".join(text.split())
        if not normalized:
            return ""
        if not self._BASE64_TEXT_RE.fullmatch(normalized):
            return ""
        try:
            data = decode_base64_bytes(normalized, validate=strict)
        except Exception:
            return ""
        if not data:
            return ""
        if not strict and not self._looks_like_image_bytes(data):
            return ""
        return base64.b64encode(data).decode("ascii")

    @staticmethod
    def _looks_like_image_bytes(data: bytes) -> bool:
        return data.startswith((
            b"\x89PNG\r\n\x1a\n",
            b"\xff\xd8\xff",
            b"GIF87a",
            b"GIF89a",
            b"BM",
        )) or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")

    def _extract_image_b64(self, value: object, *, strict_base64: bool = False) -> str:
        if isinstance(value, str):
            text = _clean(value)
            if not text:
                return ""
            if text.lower().startswith("data:image/"):
                return base64.b64encode(_decode_data_url(text)).decode("ascii")
            if text.lower().startswith(("http://", "https://")):
                return self._download_image_b64(text)
            return self._normalize_base64_payload(text, strict=strict_base64)
        if isinstance(value, list):
            for item in value:
                b64_json = self._extract_image_b64(item, strict_base64=strict_base64)
                if b64_json:
                    return b64_json
            return ""
        if not isinstance(value, dict):
            return ""
        for key in self._BASE64_KEYS:
            if key not in value:
                continue
            b64_json = self._extract_image_b64(value.get(key), strict_base64=True)
            if b64_json:
                return b64_json
        for key in self._REFERENCE_KEYS:
            if key not in value:
                continue
            b64_json = self._extract_image_b64(value.get(key), strict_base64=False)
            if b64_json:
                return b64_json
        return ""

    def _response_items(self, payload: dict[str, Any]) -> list[Any]:
        for key in ("data", "images", "output", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                return [value]
        return []

    def _payload_debug_summary(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return {"payload_type": type(payload).__name__}
        summary: dict[str, Any] = {"payload_keys": sorted(str(key) for key in payload.keys())[:20]}
        items = self._response_items(payload)
        summary["item_count"] = len(items)
        if items:
            first = items[0]
            summary["first_item_type"] = type(first).__name__
            if isinstance(first, dict):
                summary["first_item_keys"] = sorted(str(key) for key in first.keys())[:20]
            elif isinstance(first, str):
                summary["first_item_preview"] = first[:120]
        error = payload.get("error")
        if error is not None:
            summary["error"] = error
        return summary

    def _last_stream_payload(self, response: requests.Response) -> Any | None:
        content_type = str(response.headers.get("content-type") or "").lower()
        if "text/event-stream" not in content_type:
            return None
        last_payload: Any | None = None
        for payload in iter_sse_payloads(response):
            if payload == "[DONE]":
                break
            try:
                item = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(item, dict):
                continue
            if item.get("error"):
                error = item.get("error")
                if isinstance(error, dict):
                    message = str(error.get("message") or error)
                else:
                    message = str(error)
                raise NewAPIImageProviderResponseError(message or "NewAPI image stream returned an error")
            if isinstance(item.get("data"), list):
                last_payload = item
        return last_payload

    def _normalize_response(self, payload: Any, prompt: str) -> NewAPIImageResult:
        if not isinstance(payload, dict):
            raise NewAPIImageProviderResponseError("NewAPI returned a non-object image response")
        raw_data = self._response_items(payload)
        if not raw_data:
            logger.warning({
                "event": "newapi_image_response_missing_data",
                "summary": self._payload_debug_summary(payload),
            })
            raise NewAPIImageProviderResponseError("NewAPI image response did not include data")
        items: list[dict[str, Any]] = []
        for raw_item in raw_data:
            b64_json = self._extract_image_b64(raw_item)
            if not b64_json:
                continue
            revised_prompt = prompt
            if isinstance(raw_item, dict):
                revised_prompt = _clean(raw_item.get("revised_prompt")) or revised_prompt
            items.append({
                "b64_json": b64_json,
                "revised_prompt": revised_prompt,
            })
        if not items:
            logger.warning({
                "event": "newapi_image_response_unusable",
                "summary": self._payload_debug_summary(payload),
            })
            raise NewAPIImageProviderResponseError("NewAPI image response did not include usable images")
        created = payload.get("created")
        try:
            created_at = int(created)
        except (TypeError, ValueError):
            created_at = int(time.time())
        return NewAPIImageResult(created=created_at, items=items)


newapi_image_provider = NewAPIImageProvider()
