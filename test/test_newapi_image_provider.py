from __future__ import annotations

import base64
import json
import os
import unittest
from unittest import mock

from services.protocol import conversation
from services.protocol.conversation import (
    ConversationRequest,
    ImageGenerationError,
    collect_image_outputs,
    stream_image_outputs_with_pool,
)


IMAGE_BYTES = b"\x89PNG\r\n\x1a\n"
IMAGE_B64 = base64.b64encode(IMAGE_BYTES).decode("ascii")
IMAGE_B64_UNPADDED = IMAGE_B64.rstrip("=")


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        payload: object | None = None,
        content: bytes = b"",
        headers: dict[str, str] | None = None,
        lines: list[str] | None = None,
    ):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.content = content
        self.headers = headers or {}
        self.text = json.dumps(self._payload, ensure_ascii=False)
        self._lines = lines or []

    def json(self):
        return self._payload

    def iter_lines(self):
        return iter(self._lines)


class FakeMultipart:
    def __init__(self, parts):
        self.parts = parts
        self.closed = False

    @classmethod
    def from_list(cls, parts):
        return cls(parts)

    def close(self):
        self.closed = True


class NewAPIImageProviderTests(unittest.TestCase):
    def setUp(self):
        self.original_data = dict(conversation.config.data)
        self.original_env = {
            key: os.environ.get(key)
            for key in (
                "CHATGPT2API_NEWAPI_BASE_URL",
                "CHATGPT2API_NEWAPI_API_KEY",
                "CHATGPT2API_NEWAPI_IMAGE_MODEL",
                "CHATGPT2API_NEWAPI_TIMEOUT_SEC",
            )
        }
        conversation.config.data["image_provider"] = "newapi"
        os.environ["CHATGPT2API_NEWAPI_BASE_URL"] = "https://newapi.example.test"
        os.environ["CHATGPT2API_NEWAPI_API_KEY"] = "sk-test"
        os.environ.pop("CHATGPT2API_NEWAPI_IMAGE_MODEL", None)
        os.environ.pop("CHATGPT2API_NEWAPI_TIMEOUT_SEC", None)
        self.save_patcher = mock.patch.object(
            conversation,
            "save_image_bytes",
            lambda _data, _base_url=None: "http://local.test/images/newapi.png",
        )
        self.save_patcher.start()

    def tearDown(self):
        self.save_patcher.stop()
        conversation.config.data = self.original_data
        for key, value in self.original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_generation_uses_newapi_provider(self):
        calls = []

        def fake_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(payload={"created": 123, "data": [{"b64_json": IMAGE_B64, "revised_prompt": "cat"}]})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["created"], 123)
        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)
        self.assertEqual(result["data"][0]["url"], "http://local.test/images/newapi.png")
        self.assertEqual(calls[0][0], "https://newapi.example.test/v1/images/generations")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(calls[0][1]["headers"]["Accept"], "text/event-stream")
        self.assertEqual(calls[0][1]["json"]["model"], "gpt-image-1")
        self.assertEqual(calls[0][1]["json"]["prompt"], "cat")
        self.assertIs(calls[0][1]["json"]["stream"], True)
        self.assertIs(calls[0][1]["stream"], True)

    def test_generation_reads_streaming_newapi_response(self):
        calls = []
        stream_lines = [
            'data: {"object":"image.generation.chunk","data":[]}',
            f'data: {json.dumps({"created": 456, "data": [{"b64_json": IMAGE_B64, "revised_prompt": "stream cat"}]})}',
            "data: [DONE]",
        ]

        def fake_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(
                headers={"content-type": "text/event-stream; charset=utf-8"},
                lines=stream_lines,
            )

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["created"], 456)
        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)
        self.assertEqual(result["data"][0]["revised_prompt"], "stream cat")
        self.assertEqual(calls[0][1]["headers"]["Accept"], "text/event-stream")
        self.assertIs(calls[0][1]["json"]["stream"], True)
        self.assertIs(calls[0][1]["stream"], True)

    def test_generation_normalizes_unpadded_b64_json(self):
        def fake_post(url, **kwargs):
            return FakeResponse(payload={"created": 789, "data": [{"b64_json": IMAGE_B64_UNPADDED, "revised_prompt": "cat"}]})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["created"], 789)
        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)
        self.assertEqual(result["data"][0]["url"], "http://local.test/images/newapi.png")

    def test_generation_passthrough_model(self):
        os.environ["CHATGPT2API_NEWAPI_IMAGE_MODEL"] = "passthrough"
        calls = []

        def fake_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(payload={"data": [{"b64_json": IMAGE_B64}]})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="codex-gpt-image-2",
                n=1,
            )))

        self.assertEqual(calls[0][1]["json"]["model"], "codex-gpt-image-2")

    def test_edit_uses_multipart_images(self):
        calls = []

        def fake_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(payload={"data": [{"b64_json": IMAGE_B64}]})

        with (
            mock.patch("services.newapi_image_provider.CurlMime", FakeMultipart),
            mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post),
        ):
            collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="edit",
                model="gpt-image-2",
                n=1,
                image_files=[(IMAGE_BYTES, "input.png", "image/png")],
            )))

        self.assertEqual(calls[0][0], "https://newapi.example.test/v1/images/edits")
        self.assertEqual(calls[0][1]["data"]["prompt"], "edit")
        self.assertEqual(calls[0][1]["data"]["stream"], "true")
        self.assertEqual(calls[0][1]["headers"]["Accept"], "text/event-stream")
        self.assertIs(calls[0][1]["stream"], True)
        self.assertNotIn("files", calls[0][1])
        self.assertIsInstance(calls[0][1]["multipart"], FakeMultipart)
        self.assertEqual(calls[0][1]["multipart"].parts, [{
            "name": "image",
            "filename": "input.png",
            "content_type": "image/png",
            "data": IMAGE_BYTES,
        }])
        self.assertTrue(calls[0][1]["multipart"].closed)

    def test_url_response_is_downloaded_and_normalized(self):
        post_calls = []
        get_calls = []

        def fake_post(url, **kwargs):
            post_calls.append((url, kwargs))
            return FakeResponse(payload={"data": [{"url": "https://cdn.example.test/out.png"}]})

        def fake_get(url, **kwargs):
            get_calls.append((url, kwargs))
            return FakeResponse(content=IMAGE_BYTES)

        with (
            mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post),
            mock.patch("services.newapi_image_provider.requests.get", side_effect=fake_get),
        ):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(post_calls[0][0], "https://newapi.example.test/v1/images/generations")
        self.assertEqual(get_calls[0][0], "https://cdn.example.test/out.png")
        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)

    def test_data_url_response_without_padding_is_normalized(self):
        data_url = f"data:image/png;base64,{IMAGE_B64_UNPADDED}"

        def fake_post(url, **kwargs):
            return FakeResponse(payload={"data": [{"url": data_url}]})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)

    def test_generation_accepts_image_url_field(self):
        def fake_post(url, **kwargs):
            return FakeResponse(payload={"data": [{"image_url": {"url": "https://cdn.example.test/from-image-url.png"}}]})

        def fake_get(url, **kwargs):
            self.assertEqual(url, "https://cdn.example.test/from-image-url.png")
            return FakeResponse(content=IMAGE_BYTES)

        with (
            mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post),
            mock.patch("services.newapi_image_provider.requests.get", side_effect=fake_get),
        ):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)

    def test_generation_accepts_top_level_images_field(self):
        def fake_post(url, **kwargs):
            return FakeResponse(payload={"created": 321, "images": [{"base64": IMAGE_B64}]})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            result = collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
                response_format="b64_json",
            )))

        self.assertEqual(result["created"], 321)
        self.assertEqual(result["data"][0]["b64_json"], IMAGE_B64)

    def test_missing_env_returns_openai_style_error(self):
        os.environ.pop("CHATGPT2API_NEWAPI_API_KEY", None)

        with self.assertRaises(ImageGenerationError) as raised:
            collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                prompt="cat",
                model="gpt-image-2",
                n=1,
            )))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.code, "missing_newapi_config")

    def test_upstream_error_preserves_status(self):
        def fake_post(url, **kwargs):
            return FakeResponse(status_code=429, payload={"error": {"message": "rate limited"}})

        with mock.patch("services.newapi_image_provider.requests.post", side_effect=fake_post):
            with self.assertRaises(ImageGenerationError) as raised:
                collect_image_outputs(stream_image_outputs_with_pool(ConversationRequest(
                    prompt="cat",
                    model="gpt-image-2",
                    n=1,
                )))

        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("rate limited", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
