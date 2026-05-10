from __future__ import annotations

import base64
import unittest
from types import SimpleNamespace
from unittest import mock

from services.image_provider import (
    handle_image_request,
    image_models_for_provider,
    save_reference_image_bytes,
    stream_image_outputs,
)
from services.protocol.conversation import ConversationRequest, ImageGenerationError


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9W4Z0AAAAASUVORK5CYII="
PNG_BYTES = base64.b64decode(PNG_BASE64)


class ImageProviderTests(unittest.TestCase):
    def test_chatgpt_web_provider_exposes_legacy_models_only(self) -> None:
        fake_config = SimpleNamespace(image_provider="chatgpt_web")
        with mock.patch("services.image_provider.config", fake_config):
            self.assertEqual(image_models_for_provider(), {"gpt-image-2", "codex-gpt-image-2"})

    def test_linggan10s_provider_exposes_extended_models(self) -> None:
        fake_config = SimpleNamespace(image_provider="linggan10s")
        with mock.patch("services.image_provider.config", fake_config):
            self.assertIn("gpt-5-3", image_models_for_provider())
            self.assertIn("gpt-5-4-thinking", image_models_for_provider())

    def test_save_reference_image_requires_public_base_url(self) -> None:
        fake_config = SimpleNamespace(base_url="", cleanup_old_images=lambda: None)
        with mock.patch("services.image_provider.config", fake_config):
            with self.assertRaises(ImageGenerationError) as context:
                save_reference_image_bytes(PNG_BYTES, "demo.png", "image/png", "http://127.0.0.1:8000")
        self.assertIn("publicly reachable", str(context.exception))

    def test_linggan10s_missing_api_key_is_explicit(self) -> None:
        fake_config = SimpleNamespace(
            image_provider="linggan10s",
            image_timeout_sec=120,
            image_api_base_url="https://example.test",
            image_api_key="",
            image_default_model="gpt-image-2",
            base_url="https://public.example.com",
        )
        with mock.patch("services.image_provider.config", fake_config):
            with self.assertRaises(ImageGenerationError) as context:
                handle_image_request(ConversationRequest(prompt="draw", model="gpt-image-2"))
        self.assertIn("CHATGPT2API_IMAGE_API_KEY", str(context.exception))

    def test_linggan10s_streams_url_result(self) -> None:
        fake_config = SimpleNamespace(
            image_provider="linggan10s",
            image_timeout_sec=120,
            image_api_base_url="https://example.test",
            image_api_key="sk-test",
            image_default_model="gpt-image-2",
            base_url="https://public.example.com",
        )
        fake_response = SimpleNamespace(
            status_code=200,
            text='{"ok":true}',
            json=lambda: {
                "created": 123,
                "data": [{"url": "https://cdn.example.com/image.png", "b64_json": "https://cdn.example.com/image.png"}],
            },
        )
        fake_session = mock.Mock()
        fake_download_response = SimpleNamespace(
            status_code=200,
            content=PNG_BYTES,
            headers={"content-type": "image/png"},
        )
        fake_session.post.return_value = fake_response
        fake_session.get.return_value = fake_download_response
        with mock.patch("services.image_provider.config", fake_config), \
                mock.patch("services.image_provider.Session", return_value=fake_session), \
                mock.patch("services.image_provider.save_image_bytes", return_value="https://public.example.com/images/result.png"):
            outputs = list(stream_image_outputs(ConversationRequest(prompt="draw", model="gpt-5-3", response_format="b64_json")))
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].kind, "result")
        self.assertEqual(outputs[0].data[0]["url"], "https://public.example.com/images/result.png")
        self.assertNotEqual(outputs[0].data[0]["b64_json"], "https://cdn.example.com/image.png")
        self.assertTrue(outputs[0].data[0]["b64_json"])


if __name__ == "__main__":
    unittest.main()
