from __future__ import annotations

import os
from pathlib import Path

from services.storage.base import StorageBackend
from services.storage.cloudflare_d1_storage import CloudflareD1StorageBackend
from services.storage.database_storage import DatabaseStorageBackend
from services.storage.json_storage import JSONStorageBackend


def create_storage_backend(data_dir: Path) -> StorageBackend:
    """
    根据环境变量创建存储后端
    
    环境变量：
    - STORAGE_BACKEND: json|sqlite|postgres|git|cloudflare_d1 (默认 json)
    - DATABASE_URL: 数据库连接字符串 (用于 sqlite/postgres)
    - GIT_REPO_URL: Git 仓库地址 (用于 git)
    - GIT_TOKEN: Git 访问令牌 (用于 git)
    - GIT_BRANCH: Git 分支 (默认 main)
    - GIT_FILE_PATH: Git 仓库中的文件路径 (默认 accounts.json)
    - CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN (用于 cloudflare_d1)
    """
    backend_type = os.getenv("STORAGE_BACKEND", "json").lower().strip()
    
    print(f"[storage] Initializing storage backend: {backend_type}")
    
    if backend_type == "json":
        # 本地 JSON 文件存储
        file_path = data_dir / "accounts.json"
        auth_keys_path = data_dir / "auth_keys.json"
        print(f"[storage] Using JSON storage: {file_path}")
        return JSONStorageBackend(file_path, auth_keys_path)
    
    elif backend_type in ("sqlite", "postgres", "postgresql", "mysql", "database"):
        # 数据库存储
        database_url = os.getenv("DATABASE_URL", "").strip()
        
        if not database_url:
            # 如果没有指定 DATABASE_URL，使用本地 SQLite
            database_url = f"sqlite:///{data_dir / 'accounts.db'}"
            print(f"[storage] No DATABASE_URL provided, using local SQLite: {database_url}")
        else:
            print(f"[storage] Using database storage: {_mask_password(database_url)}")
        
        return DatabaseStorageBackend(database_url)
    
    elif backend_type == "git":
        from services.storage.git_storage import GitStorageBackend

        # Git 仓库存储
        repo_url = os.getenv("GIT_REPO_URL", "").strip()
        token = os.getenv("GIT_TOKEN", "").strip()
        branch = os.getenv("GIT_BRANCH", "main").strip()
        file_path = os.getenv("GIT_FILE_PATH", "accounts.json").strip()
        auth_keys_file_path = os.getenv("GIT_AUTH_KEYS_FILE_PATH", "auth_keys.json").strip()
        
        if not repo_url:
            raise ValueError(
                "GIT_REPO_URL is required when using git storage backend. "
                "Please set GIT_REPO_URL environment variable."
            )
        
        print(f"[storage] Using Git storage: {_mask_token(repo_url)}, branch: {branch}, file: {file_path}")
        
        cache_dir = data_dir / "git_cache"
        return GitStorageBackend(
            repo_url=repo_url,
            token=token,
            branch=branch,
            file_path=file_path,
            auth_keys_file_path=auth_keys_file_path,
            local_cache_dir=cache_dir,
        )

    elif backend_type in ("cloudflare_d1", "cloudflare-d1", "d1"):
        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        database_id = os.getenv("CLOUDFLARE_D1_DATABASE_ID", "").strip()
        api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        api_base_url = os.getenv("CLOUDFLARE_D1_API_BASE_URL", "https://api.cloudflare.com/client/v4").strip()
        timeout_seconds = _parse_timeout_seconds(os.getenv("CLOUDFLARE_D1_TIMEOUT_SECONDS"))

        print(
            "[storage] Using Cloudflare D1 storage:",
            f"account={_mask_token(account_id)}",
            f"database={database_id}",
        )

        return CloudflareD1StorageBackend(
            account_id=account_id,
            database_id=database_id,
            api_token=api_token,
            api_base_url=api_base_url,
            request_timeout=timeout_seconds,
        )
    
    else:
        raise ValueError(
            f"Unknown storage backend: {backend_type}. "
            f"Supported backends: json, sqlite, postgres, git, cloudflare_d1"
        )


def _mask_password(url: str) -> str:
    """隐藏数据库连接字符串中的密码"""
    if "://" not in url:
        return url
    try:
        protocol, rest = url.split("://", 1)
        if "@" in rest:
            credentials, host = rest.split("@", 1)
            if ":" in credentials:
                username, _ = credentials.split(":", 1)
                return f"{protocol}://{username}:****@{host}"
        return url
    except Exception:
        return url


def _mask_token(url: str) -> str:
    """隐藏 URL 中的 token"""
    if len(url) <= 8:
        return url
    if "://" not in url:
        return f"{url[:4]}****{url[-4:]}"
    if "@" in url and "://" in url:
        protocol, rest = url.split("://", 1)
        if "@" in rest:
            _, host = rest.split("@", 1)
            return f"{protocol}://****@{host}"
    return url


def _parse_timeout_seconds(value: str | None) -> float:
    try:
        return max(1.0, float(str(value or "").strip() or 30))
    except ValueError:
        return 30.0
