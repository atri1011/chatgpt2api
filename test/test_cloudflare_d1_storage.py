import unittest

from services.storage.cloudflare_d1_storage import CloudflareD1StorageBackend


def _response(rows: list[dict]) -> dict:
    return {
        "success": True,
        "errors": [],
        "result": [
            {
                "success": True,
                "results": rows,
            }
        ],
    }


class FakeCloudflareD1StorageBackend(CloudflareD1StorageBackend):
    def __init__(self) -> None:
        self._store: dict[str, str] = {}
        self.account_id = "account-12345678"
        self.database_id = "db-1234"
        self.api_token = "token"
        self.api_base_url = "https://api.cloudflare.com/client/v4"
        self.request_timeout = 30.0
        self.calls: list[dict] = []
        self._ensure_schema()

    def _post_query(self, payload: dict) -> dict:
        self.calls.append(payload)
        sql = str(payload.get("sql") or "")
        params = [str(item) for item in payload.get("params", [])]

        if sql.startswith("CREATE TABLE IF NOT EXISTS"):
            return _response([])
        if sql.startswith("SELECT payload FROM chatgpt2api_storage"):
            payload_json = self._store.get(params[0])
            return _response([] if payload_json is None else [{"payload": payload_json}])
        if sql.startswith("INSERT INTO chatgpt2api_storage"):
            self._store[params[0]] = params[1]
            return _response([])
        if sql.startswith("SELECT namespace, LENGTH(payload) AS payload_size, updated_at FROM chatgpt2api_storage"):
            return _response(
                [
                    {
                        "namespace": namespace,
                        "payload_size": len(payload_json),
                        "updated_at": "2026-01-01T00:00:00+00:00",
                    }
                    for namespace, payload_json in self._store.items()
                ]
            )
        raise AssertionError(f"Unexpected SQL: {sql}")


class CloudflareD1StorageBackendTests(unittest.TestCase):
    def test_accounts_and_auth_keys_round_trip(self) -> None:
        backend = FakeCloudflareD1StorageBackend()

        accounts = [{"access_token": "token-1", "status": "正常"}]
        auth_keys = [{"id": "admin-1", "role": "admin"}]

        backend.save_accounts(accounts)
        backend.save_auth_keys(auth_keys)

        self.assertEqual(backend.load_accounts(), accounts)
        self.assertEqual(backend.load_auth_keys(), auth_keys)

    def test_health_and_backend_info(self) -> None:
        backend = FakeCloudflareD1StorageBackend()
        backend.save_accounts([{"access_token": "token-1"}])

        health = backend.health_check()
        info = backend.get_backend_info()

        self.assertEqual(health["status"], "healthy")
        self.assertEqual(health["backend"], "cloudflare_d1")
        self.assertIn("accounts", health["namespaces"])
        self.assertEqual(info["type"], "cloudflare_d1")
        self.assertEqual(info["database_id"], "db-1234")
        self.assertTrue(str(info["account_id"]).startswith("accoun"))


if __name__ == "__main__":
    unittest.main()
