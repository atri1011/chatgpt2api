from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib import error, request

from services.storage.base import StorageBackend


class CloudflareD1StorageBackend(StorageBackend):
    """Cloudflare D1 storage backend via the official REST API."""

    TABLE_NAME = "chatgpt2api_storage"
    ACCOUNTS_NAMESPACE = "accounts"
    AUTH_KEYS_NAMESPACE = "auth_keys"

    def __init__(
        self,
        account_id: str,
        database_id: str,
        api_token: str,
        *,
        api_base_url: str = "https://api.cloudflare.com/client/v4",
        request_timeout: float = 30.0,
    ):
        self.account_id = account_id.strip()
        self.database_id = database_id.strip()
        self.api_token = api_token.strip()
        self.api_base_url = api_base_url.rstrip("/")
        self.request_timeout = float(request_timeout)
        if not self.account_id:
            raise ValueError("CLOUDFLARE_ACCOUNT_ID is required when using Cloudflare D1 storage backend.")
        if not self.database_id:
            raise ValueError("CLOUDFLARE_D1_DATABASE_ID is required when using Cloudflare D1 storage backend.")
        if not self.api_token:
            raise ValueError("CLOUDFLARE_API_TOKEN is required when using Cloudflare D1 storage backend.")
        self._ensure_schema()

    @property
    def _query_url(self) -> str:
        return f"{self.api_base_url}/accounts/{self.account_id}/d1/database/{self.database_id}/query"

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _serialize_items(items: list[dict[str, Any]]) -> str:
        return json.dumps(items, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _parse_items(payload: str) -> list[dict[str, Any]]:
        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return []
        return data if isinstance(data, list) else []

    @staticmethod
    def _error_message_from_response(data: dict[str, Any]) -> str:
        errors = data.get("errors")
        if isinstance(errors, list):
            messages = [
                str(item.get("message") or "").strip()
                for item in errors
                if isinstance(item, dict) and str(item.get("message") or "").strip()
            ]
            if messages:
                return "; ".join(messages)
        messages = data.get("messages")
        if isinstance(messages, list):
            texts = [
                str(item.get("message") or "").strip()
                for item in messages
                if isinstance(item, dict) and str(item.get("message") or "").strip()
            ]
            if texts:
                return "; ".join(texts)
        return ""

    def _post_query(self, payload: dict[str, Any]) -> dict[str, Any]:
        req = request.Request(
            self._query_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.request_timeout) as response:
                raw = response.read().decode("utf-8")
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                raise RuntimeError(f"Cloudflare D1 request failed: HTTP {exc.code}") from exc
            message = self._error_message_from_response(data) or f"Cloudflare D1 request failed: HTTP {exc.code}"
            raise RuntimeError(message) from exc
        except error.URLError as exc:
            raise RuntimeError(f"Cloudflare D1 request failed: {exc.reason}") from exc

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Cloudflare D1 returned invalid JSON response.") from exc
        if not isinstance(data, dict):
            raise RuntimeError("Cloudflare D1 returned invalid response payload.")
        return data

    def _run_query(self, sql: str, params: list[str] | None = None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"sql": sql}
        if params:
            payload["params"] = [str(item) for item in params]
        data = self._post_query(payload)
        if not bool(data.get("success", False)):
            message = self._error_message_from_response(data) or "Cloudflare D1 query failed."
            raise RuntimeError(message)
        result = data.get("result")
        if not isinstance(result, list):
            raise RuntimeError("Cloudflare D1 returned malformed query result.")
        normalized: list[dict[str, Any]] = []
        for item in result:
            if not isinstance(item, dict):
                raise RuntimeError("Cloudflare D1 returned malformed statement result.")
            if not bool(item.get("success", False)):
                raise RuntimeError(self._error_message_from_response(data) or "Cloudflare D1 statement failed.")
            normalized.append(item)
        return normalized

    def _ensure_schema(self) -> None:
        self._run_query(
            f"""
            CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
              namespace TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """.strip()
        )

    def _load_namespace(self, namespace: str) -> list[dict[str, Any]]:
        result = self._run_query(
            f"SELECT payload FROM {self.TABLE_NAME} WHERE namespace = ? LIMIT 1",
            [namespace],
        )
        if not result:
            return []
        rows = result[0].get("results")
        if not isinstance(rows, list) or not rows:
            return []
        row = rows[0]
        if not isinstance(row, dict):
            return []
        payload = row.get("payload")
        if not isinstance(payload, str):
            return []
        return self._parse_items(payload)

    def _save_namespace(self, namespace: str, items: list[dict[str, Any]]) -> None:
        self._run_query(
            f"""
            INSERT INTO {self.TABLE_NAME} (namespace, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(namespace) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """.strip(),
            [namespace, self._serialize_items(items), self._now_iso()],
        )

    def load_accounts(self) -> list[dict[str, Any]]:
        return self._load_namespace(self.ACCOUNTS_NAMESPACE)

    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        self._save_namespace(self.ACCOUNTS_NAMESPACE, accounts)

    def load_auth_keys(self) -> list[dict[str, Any]]:
        return self._load_namespace(self.AUTH_KEYS_NAMESPACE)

    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        self._save_namespace(self.AUTH_KEYS_NAMESPACE, auth_keys)

    def health_check(self) -> dict[str, Any]:
        try:
            result = self._run_query(
                f"SELECT namespace, LENGTH(payload) AS payload_size, updated_at FROM {self.TABLE_NAME}"
            )
            rows = result[0].get("results") if result else []
            items = rows if isinstance(rows, list) else []
            namespaces = [row.get("namespace") for row in items if isinstance(row, dict)]
            return {
                "status": "healthy",
                "backend": "cloudflare_d1",
                "account_id": self._mask_account_id(self.account_id),
                "database_id": self.database_id,
                "namespaces": namespaces,
                "row_count": len(items),
            }
        except Exception as exc:
            return {
                "status": "unhealthy",
                "backend": "cloudflare_d1",
                "error": str(exc),
            }

    def get_backend_info(self) -> dict[str, Any]:
        return {
            "type": "cloudflare_d1",
            "description": "Cloudflare D1 via REST API",
            "account_id": self._mask_account_id(self.account_id),
            "database_id": self.database_id,
            "api_base_url": self.api_base_url,
            "request_timeout": self.request_timeout,
        }

    @staticmethod
    def _mask_account_id(account_id: str) -> str:
        text = account_id.strip()
        if len(text) <= 8:
            return text
        return f"{text[:6]}...{text[-4:]}"
