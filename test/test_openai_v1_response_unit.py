from __future__ import annotations

import base64
import unittest

from services.protocol.openai_v1_response import extract_response_image


class OpenAIV1ResponseUnitTests(unittest.TestCase):
    def test_extract_response_image_accepts_unpadded_data_url(self):
        image_b64 = base64.b64encode(b"fake-png").decode("ascii").rstrip("=")
        image, mime_type = extract_response_image([
            {
                "type": "input_image",
                "image_url": f"data:image/png;base64,{image_b64}",
            }
        ]) or (None, None)

        self.assertEqual(image, b"fake-png")
        self.assertEqual(mime_type, "image/png")


if __name__ == "__main__":
    unittest.main()
