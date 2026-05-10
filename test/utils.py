import base64
import json
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT_DIR / "data" / "output"
BASE_URL = "http://127.0.0.1:8000"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def load_auth_key() -> str:
    return json.loads((ROOT_DIR / "config.json").read_text(encoding="utf-8"))["auth-key"]


def post_json(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {load_auth_key()}"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode())


def detect_ext(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return ".webp"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    return ".png"


def save_image(image_b64: str, name: str) -> Path:
    image_bytes = base64.b64decode(image_b64)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"{name}_{int(time.time())}{detect_ext(image_bytes)}"
    path.write_bytes(image_bytes)
    return path


def save_image_result(result: str, name: str) -> Path:
    value = str(result or "").strip()
    if value.startswith("http://") or value.startswith("https://"):
        with urllib.request.urlopen(value) as response:
            image_bytes = response.read()
            content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        ext = {
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "image/png": ".png",
        }.get(content_type, detect_ext(image_bytes))
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        suffix = Path(urlparse(value).path).suffix or ext
        path = OUTPUT_DIR / f"{name}_{int(time.time())}{suffix}"
        path.write_bytes(image_bytes)
        return path
    return save_image(value, name)
