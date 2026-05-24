from __future__ import annotations

import asyncio
import unittest

from fastapi.responses import StreamingResponse

from services.log_service import LoggedCall


class LoggedCallStreamTests(unittest.TestCase):
    def test_run_can_return_stream_without_prefetching_iterator(self):
        advanced = False

        def handler():
            def items():
                nonlocal advanced
                advanced = True
                yield {"data": [{"url": "http://testserver/images/fake.png"}]}

            return items()

        call = LoggedCall(
            {"id": "key-1", "name": "test", "role": "user"},
            "/v1/images/generations",
            "gpt-image-2",
            "文生图",
        )

        response = asyncio.run(call.run(handler, prefetch_stream=False))

        self.assertIsInstance(response, StreamingResponse)
        self.assertFalse(advanced)


if __name__ == "__main__":
    unittest.main()
