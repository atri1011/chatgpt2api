from __future__ import annotations

from typing import Any, Iterator

from services.image_provider import handle_image_request
from services.protocol.conversation import ConversationRequest, ImageGenerationError


def handle(body: dict[str, Any]) -> dict[str, Any] | Iterator[dict[str, Any]]:
    prompt = str(body.get("prompt") or "")
    images = body.get("images") or []
    model = str(body.get("model") or "gpt-image-2")
    n = int(body.get("n") or 1)
    size = body.get("size")
    response_format = str(body.get("response_format") or "b64_json")
    base_url = str(body.get("base_url") or "") or None
    if not images:
        raise ImageGenerationError("image is required")
    return handle_image_request(ConversationRequest(
        prompt=prompt,
        model=model,
        n=n,
        size=size,
        response_format=response_format,
        base_url=base_url,
        image_inputs=images,
        message_as_error=True,
    ), stream=bool(body.get("stream")))
