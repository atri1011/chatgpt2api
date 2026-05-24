from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any

from curl_cffi import CurlMime, requests

from services.config import config
from services.proxy_service import proxy_settings
from utils.helper import ensure_ok, iter_sse_payloads


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
        return base64.b64decode(payload, validate=";base64" in header.lower())
    except Exception as exc:
        raise NewAPIImageProviderResponseError("NewAPI returned invalid base64 image data") from exc


class NewAPIImageProvider:
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
        raw_data = payload.get("data")
        if not isinstance(raw_data, list):
            raise NewAPIImageProviderResponseError("NewAPI image response did not include data")
        items: list[dict[str, Any]] = []
        for raw_item in raw_data:
            if not isinstance(raw_item, dict):
                continue
            b64_json = _clean(raw_item.get("b64_json"))
            if not b64_json:
                image_url = _clean(raw_item.get("url"))
                if image_url:
                    b64_json = self._download_image_b64(image_url)
            if not b64_json:
                continue
            items.append({
                "b64_json": b64_json,
                "revised_prompt": _clean(raw_item.get("revised_prompt")) or prompt,
            })
        if not items:
            raise NewAPIImageProviderResponseError("NewAPI image response did not include usable images")
        created = payload.get("created")
        try:
            created_at = int(created)
        except (TypeError, ValueError):
            created_at = int(time.time())
        return NewAPIImageResult(created=created_at, items=items)


newapi_image_provider = NewAPIImageProvider()
