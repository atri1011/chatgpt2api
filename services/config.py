from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
import sys
import time
from pathlib import Path
from tempfile import gettempdir

from services.storage.base import StorageBackend

BASE_DIR = Path(__file__).resolve().parents[1]
IS_VERCEL = os.getenv("VERCEL") == "1"
DEFAULT_DATA_DIR = Path(gettempdir()) / "chatgpt2api" if IS_VERCEL else BASE_DIR / "data"
DATA_DIR = Path(os.getenv("CHATGPT2API_DATA_DIR") or DEFAULT_DATA_DIR)
CONFIG_FILE = Path(os.getenv("CHATGPT2API_CONFIG_FILE") or (BASE_DIR / "config.json"))
VERSION_FILE = BASE_DIR / "VERSION"


@dataclass(frozen=True)
class LoadedSettings:
    auth_key: str
    refresh_account_interval_minute: int
    enable_background_watcher: bool


@dataclass(frozen=True)
class ImageApiEndpoint:
    name: str
    base_url: str
    api_key: str
    upstream_model: str = ""


def _normalize_auth_key(value: object) -> str:
    return str(value or "").strip()


def _is_invalid_auth_key(value: object) -> bool:
    return _normalize_auth_key(value) == ""


def _read_json_object(path: Path, *, name: str) -> dict[str, object]:
    if not path.exists():
        return {}
    if path.is_dir():
        print(
            f"Warning: {name} at '{path}' is a directory, ignoring it and falling back to other configuration sources.",
            file=sys.stderr,
        )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _env_text(name: str) -> str:
    return str(os.getenv(name) or "").strip()


def _resolve_image_api_endpoints() -> tuple[list[ImageApiEndpoint], str | None]:
    pattern = re.compile(r"^CHATGPT2API_IMAGE_API_(\d+)_(BASE_URL|KEY|MODEL)$")
    grouped: dict[int, dict[str, str]] = {}
    for name, raw_value in os.environ.items():
        match = pattern.match(str(name))
        if not match:
            continue
        index = int(match.group(1))
        field = match.group(2)
        grouped.setdefault(index, {})[field] = str(raw_value or "").strip()

    if grouped:
        endpoints: list[ImageApiEndpoint] = []
        for index in sorted(grouped):
            label = f"CHATGPT2API_IMAGE_API_{index}"
            base_url = str(grouped[index].get("BASE_URL") or "").strip().rstrip("/")
            api_key = str(grouped[index].get("KEY") or "").strip()
            upstream_model = str(grouped[index].get("MODEL") or "").strip()
            if not base_url and not api_key:
                continue
            if not base_url:
                return [], f"{label}_BASE_URL is required when {label}_KEY is set"
            if not api_key:
                return [], f"{label}_KEY is required when {label}_BASE_URL is set"
            endpoints.append(ImageApiEndpoint(
                name=label,
                base_url=base_url,
                api_key=api_key,
                upstream_model=upstream_model,
            ))
        return endpoints, None

    base_url = _env_text("CHATGPT2API_IMAGE_API_BASE_URL").rstrip("/")
    api_key = _env_text("CHATGPT2API_IMAGE_API_KEY")
    upstream_model = _env_text("CHATGPT2API_IMAGE_API_MODEL")
    if base_url and api_key:
        return [ImageApiEndpoint(
            name="CHATGPT2API_IMAGE_API",
            base_url=base_url,
            api_key=api_key,
            upstream_model=upstream_model,
        )], None
    if base_url:
        return [], "CHATGPT2API_IMAGE_API_KEY is required when CHATGPT2API_IMAGE_API_BASE_URL is set"
    if api_key:
        return [], "CHATGPT2API_IMAGE_API_BASE_URL is required when CHATGPT2API_IMAGE_API_KEY is set"
    return [], None


def _load_settings() -> LoadedSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_config = _read_json_object(CONFIG_FILE, name="config.json")
    auth_key = _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or raw_config.get("auth-key"))
    if _is_invalid_auth_key(auth_key):
        raise ValueError(
            "❌ auth-key 未设置！\n"
            "请按以下任意一种方式解决：\n"
            "1. 在系统环境变量或当前终端中设置：\n"
            "   CHATGPT2API_AUTH_KEY = your_real_auth_key\n"
            "2. 或者在项目根目录的 config.json / config.example.json 中填写：\n"
            '   "auth-key": "your_real_auth_key"\n'
            "3. Windows 本地部署可直接运行 windows_setup.bat 与 windows_run.bat\n"
            "4. Vercel 部署请在项目环境变量中设置 CHATGPT2API_AUTH_KEY"
        )

    try:
        refresh_interval = int(raw_config.get("refresh_account_interval_minute", 5))
    except (TypeError, ValueError):
        refresh_interval = 5

    return LoadedSettings(
        auth_key=auth_key,
        refresh_account_interval_minute=refresh_interval,
        enable_background_watcher=_env_flag("CHATGPT2API_ENABLE_BACKGROUND_WATCHER", default=not IS_VERCEL),
    )


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.data = self._load()
        self._storage_backend: StorageBackend | None = None
        if _is_invalid_auth_key(self.auth_key):
            raise ValueError(
                "❌ auth-key 未设置！\n"
                "请按以下任意一种方式解决：\n"
                "1. 在 Render 的 Environment 变量中添加：\n"
                "   CHATGPT2API_AUTH_KEY = your_real_auth_key\n"
                "2. 或者在 config.json 中填写：\n"
                '   "auth-key": "your_real_auth_key"'
            )

    def _load(self) -> dict[str, object]:
        return _read_json_object(self.path, name="config.json")

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @property
    def auth_key(self) -> str:
        return _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or self.data.get("auth-key"))

    @property
    def accounts_file(self) -> Path:
        return DATA_DIR / "accounts.json"

    @property
    def refresh_account_interval_minute(self) -> int:
        try:
            return int(self.data.get("refresh_account_interval_minute", 5))
        except (TypeError, ValueError):
            return 5

    @property
    def enable_background_watcher(self) -> bool:
        return _env_flag("CHATGPT2API_ENABLE_BACKGROUND_WATCHER", default=not IS_VERCEL)

    @property
    def image_retention_days(self) -> int:
        try:
            return max(1, int(self.data.get("image_retention_days", 30)))
        except (TypeError, ValueError):
            return 30

    @property
    def auto_remove_invalid_accounts(self) -> bool:
        value = self.data.get("auto_remove_invalid_accounts", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def auto_remove_rate_limited_accounts(self) -> bool:
        value = self.data.get("auto_remove_rate_limited_accounts", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def log_levels(self) -> list[str]:
        levels = self.data.get("log_levels")
        if not isinstance(levels, list):
            return []
        allowed = {"debug", "info", "warning", "error"}
        return [level for item in levels if (level := str(item or "").strip().lower()) in allowed]

    @property
    def images_dir(self) -> Path:
        path = DATA_DIR / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def cleanup_old_images(self) -> int:
        cutoff = time.time() - self.image_retention_days * 86400
        removed = 0
        for path in self.images_dir.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        for path in sorted((p for p in self.images_dir.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            try:
                path.rmdir()
            except OSError:
                pass
        return removed

    @property
    def base_url(self) -> str:
        return str(
            os.getenv("CHATGPT2API_BASE_URL")
            or self.data.get("base_url")
            or ""
        ).strip().rstrip("/")

    @property
    def image_provider(self) -> str:
        provider = _env_text("CHATGPT2API_IMAGE_PROVIDER").lower()
        return provider if provider in {"chatgpt_web", "linggan10s"} else "chatgpt_web"

    @property
    def image_api_base_url(self) -> str:
        endpoints = self.image_api_endpoints
        if endpoints:
            return endpoints[0].base_url
        return _env_text("CHATGPT2API_IMAGE_API_BASE_URL").rstrip("/")

    @property
    def image_api_key(self) -> str:
        endpoints = self.image_api_endpoints
        if endpoints:
            return endpoints[0].api_key
        return _env_text("CHATGPT2API_IMAGE_API_KEY")

    @property
    def image_api_endpoints(self) -> list[ImageApiEndpoint]:
        endpoints, _ = _resolve_image_api_endpoints()
        return endpoints

    @property
    def image_api_configuration_error(self) -> str:
        _, error = _resolve_image_api_endpoints()
        return error or ""

    @property
    def image_timeout_sec(self) -> int:
        raw = _env_text("CHATGPT2API_IMAGE_TIMEOUT_SEC")
        try:
            return max(1, int(raw or "300"))
        except (TypeError, ValueError):
            return 300

    @property
    def image_default_model(self) -> str:
        return _env_text("CHATGPT2API_IMAGE_DEFAULT_MODEL") or "gpt-image-2"

    @property
    def app_version(self) -> str:
        try:
            value = VERSION_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "0.0.0"
        return value or "0.0.0"

    def get(self) -> dict[str, object]:
        data = dict(self.data)
        data["refresh_account_interval_minute"] = self.refresh_account_interval_minute
        data["image_retention_days"] = self.image_retention_days
        data["auto_remove_invalid_accounts"] = self.auto_remove_invalid_accounts
        data["auto_remove_rate_limited_accounts"] = self.auto_remove_rate_limited_accounts
        data["log_levels"] = self.log_levels
        data["image_provider"] = self.image_provider
        data["image_api_base_url"] = self.image_api_base_url
        data["image_api_endpoint_count"] = len(self.image_api_endpoints)
        data["image_timeout_sec"] = self.image_timeout_sec
        data["image_default_model"] = self.image_default_model
        data["has_image_api_key"] = bool(self.image_api_key or _env_text("CHATGPT2API_IMAGE_API_KEY"))
        data.pop("auth-key", None)
        return data

    def get_proxy_settings(self) -> str:
        return str(self.data.get("proxy") or "").strip()

    def update(self, data: dict[str, object]) -> dict[str, object]:
        next_data = dict(self.data)
        readonly_keys = {
            "image_provider",
            "image_api_base_url",
            "image_api_key",
            "image_api_endpoint_count",
            "image_timeout_sec",
            "image_default_model",
            "has_image_api_key",
        }
        next_data.update({key: value for key, value in dict(data or {}).items() if key not in readonly_keys})
        self.data = next_data
        self._save()
        return self.get()

    def get_storage_backend(self) -> StorageBackend:
        if self._storage_backend is None:
            from services.storage.factory import create_storage_backend
            self._storage_backend = create_storage_backend(DATA_DIR)
        return self._storage_backend


config = ConfigStore(CONFIG_FILE)
