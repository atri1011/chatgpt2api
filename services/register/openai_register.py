from __future__ import annotations

import base64
import hashlib
import json
import random
import secrets
import string
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import urllib3
from curl_cffi import requests as curl_requests

from services.account_service import account_service
from services.register import mail_provider

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
base_dir = Path(__file__).resolve().parent
config = {
    "mail": {
        "request_timeout": 30,
        "wait_timeout": 30,
        "wait_interval": 2,
        "providers": [],
    },
    "proxy": "",
    "total": 10,
    "threads": 3,
}
register_config_file = base_dir.parents[1] / "data" / "register.json"
try:
    saved_config = json.loads(register_config_file.read_text(encoding="utf-8"))
    config.update({key: saved_config[key] for key in ("mail", "proxy", "total", "threads") if key in saved_config})
except Exception:
    pass

auth_base = "https://auth.openai.com"
platform_base = "https://platform.openai.com"
platform_oauth_client_id = "app_2SKx67EdpoN0G6j64rFvigXD"
platform_oauth_redirect_uri = f"{platform_base}/auth/callback"
platform_oauth_audience = "https://api.openai.com/v1"
platform_auth0_client = "eyJuYW1lIjoiYXV0aDAtc3BhLWpzIiwidmVyc2lvbiI6IjEuMjEuMCJ9"

# Sentinel SDK URL —— OpenAI 会不定期换路径哈希；建议每月对照线上 frame.html 同步
SENTINEL_SDK_URL = "https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js"

# 浏览器指纹池：UA / sec-ch-ua / impersonate(TLS JA3) / 时区 / 屏幕一体化
# 每次注册随机抽一份，并在 PlatformRegistrar 实例内全程复用，保证一致性
BROWSER_FINGERPRINTS: list[dict] = [
    {
        "impersonate": "chrome131",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec_ch_ua_full": '"Google Chrome";v="131.0.6778.140", "Chromium";v="131.0.6778.140", "Not_A Brand";v="24.0.0.0"',
        "platform": '"Windows"', "platform_version": '"15.0.0"',
        "arch": '"x86"', "bitness": '"64"',
        "tz_name": "China Standard Time", "tz_offset_minutes": 480,
        "hardware_concurrency": 8, "screen": "1920x1080",
        "accept_language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    {
        "impersonate": "chrome136",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec_ch_ua_full": '"Chromium";v="136.0.7103.93", "Google Chrome";v="136.0.7103.93", "Not.A/Brand";v="99.0.0.0"',
        "platform": '"Windows"', "platform_version": '"19.0.0"',
        "arch": '"x86"', "bitness": '"64"',
        "tz_name": "Pacific Standard Time", "tz_offset_minutes": -480,
        "hardware_concurrency": 16, "screen": "2560x1440",
        "accept_language": "en-US,en;q=0.9",
    },
    {
        "impersonate": "chrome145",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="145", "Not?A_Brand";v="8", "Chromium";v="145"',
        "sec_ch_ua_full": '"Chromium";v="145.0.7370.66", "Not:A-Brand";v="99.0.0.0", "Google Chrome";v="145.0.7370.66"',
        "platform": '"macOS"', "platform_version": '"14.5.0"',
        "arch": '"arm"', "bitness": '"64"',
        "tz_name": "Eastern Standard Time", "tz_offset_minutes": -300,
        "hardware_concurrency": 12, "screen": "1728x1117",
        "accept_language": "en-US,en;q=0.9",
    },
    {
        "impersonate": "chrome142",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not(A:Brand";v="99", "Google Chrome";v="142", "Chromium";v="142"',
        "sec_ch_ua_full": '"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="142.0.7341.10", "Chromium";v="142.0.7341.10"',
        "platform": '"Windows"', "platform_version": '"15.0.0"',
        "arch": '"x86"', "bitness": '"64"',
        "tz_name": "Central European Standard Time", "tz_offset_minutes": 60,
        "hardware_concurrency": 16, "screen": "1920x1200",
        "accept_language": "en-GB,en;q=0.9",
    },
    {
        "impersonate": "chrome146",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="146", "Not:A-Brand";v="8", "Google Chrome";v="146"',
        "sec_ch_ua_full": '"Chromium";v="146.0.7390.54", "Not:A-Brand";v="8.0.0.0", "Google Chrome";v="146.0.7390.54"',
        "platform": '"Windows"', "platform_version": '"19.0.0"',
        "arch": '"x86"', "bitness": '"64"',
        "tz_name": "Japan Standard Time", "tz_offset_minutes": 540,
        "hardware_concurrency": 8, "screen": "1920x1080",
        "accept_language": "en-US,en;q=0.9",
    },
]

# 姓名 / 出生年份扩池，降低跨账号聚类信号
FIRST_NAMES = [
    "James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Charles",
    "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua",
    "Kenneth", "Kevin", "Brian", "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan",
    "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
    "Nancy", "Lisa", "Margaret", "Betty", "Sandra", "Ashley", "Kimberly", "Emily", "Donna", "Michelle",
    "Emma", "Olivia", "Sophia", "Ava", "Isabella", "Mia", "Charlotte", "Amelia", "Harper", "Evelyn",
    "Liam", "Noah", "Ethan", "Lucas", "Mason", "Logan", "Oliver", "Aiden", "Jackson", "Benjamin",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
    "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
    "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
    "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
]

default_timeout = 30
print_lock = threading.Lock()
stats_lock = threading.Lock()
stats = {"done": 0, "success": 0, "fail": 0, "start_time": 0.0}
register_log_sink = None


def pick_fingerprint() -> dict:
    return dict(random.choice(BROWSER_FINGERPRINTS))


def build_common_headers(fp: dict) -> dict:
    return {
        "accept": "application/json",
        "accept-language": fp.get("accept_language", "en-US,en;q=0.9"),
        "content-type": "application/json",
        "origin": auth_base,
        "priority": "u=1, i",
        "user-agent": fp["ua"],
        "sec-ch-ua": fp["sec_ch_ua"],
        "sec-ch-ua-arch": fp["arch"],
        "sec-ch-ua-bitness": fp["bitness"],
        "sec-ch-ua-full-version-list": fp["sec_ch_ua_full"],
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-model": '""',
        "sec-ch-ua-platform": fp["platform"],
        "sec-ch-ua-platform-version": fp["platform_version"],
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }


def build_navigate_headers(fp: dict) -> dict:
    return {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": fp.get("accept_language", "en-US,en;q=0.9"),
        "user-agent": fp["ua"],
        "sec-ch-ua": fp["sec_ch_ua"],
        "sec-ch-ua-arch": fp["arch"],
        "sec-ch-ua-bitness": fp["bitness"],
        "sec-ch-ua-full-version-list": fp["sec_ch_ua_full"],
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-model": '""',
        "sec-ch-ua-platform": fp["platform"],
        "sec-ch-ua-platform-version": fp["platform_version"],
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
    }


def _format_local_date_string(fp: dict) -> str:
    """模拟 JS `new Date().toString()` 在指定时区下的输出，覆盖原本固定的 UTC 字面量。"""
    offset_minutes = int(fp.get("tz_offset_minutes", 0))
    local_struct = time.gmtime(time.time() + offset_minutes * 60)
    sign = "+" if offset_minutes >= 0 else "-"
    abs_minutes = abs(offset_minutes)
    offset_str = f"GMT{sign}{abs_minutes // 60:02d}{abs_minutes % 60:02d}"
    date_part = time.strftime("%a %b %d %Y %H:%M:%S", local_struct)
    return f"{date_part} {offset_str} ({fp.get('tz_name', 'Coordinated Universal Time')})"


def log(text: str, color: str = "") -> None:
    colors = {"red": "\033[31m", "green": "\033[32m", "yellow": "\033[33m"}
    if register_log_sink:
        try:
            register_log_sink(text, color)
        except Exception:
            pass
    with print_lock:
        prefix = colors.get(color, "")
        suffix = "\033[0m" if prefix else ""
        print(f"{prefix}{datetime.now().strftime('%H:%M:%S')} {text}{suffix}")


def step(index: int, text: str, color: str = "") -> None:
    log(f"[任务{index}] {text}", color)


def _make_trace_headers() -> dict[str, str]:
    """生成与真实 dd-RUM SDK 一致的 W3C trace + Datadog 双轨头。
    traceparent.trace-id 的高 64 位编码在 tracestate `t.tid` 字段，
    低 64 位转十进制即为 x-datadog-trace-id；parent-id 双向对齐。
    """
    high = random.getrandbits(64)
    low = random.getrandbits(64)
    parent = random.getrandbits(64)
    trace_hex = format(high, "016x") + format(low, "016x")
    parent_hex = format(parent, "016x")
    high_hex = format(high, "016x")
    return {
        "traceparent": f"00-{trace_hex}-{parent_hex}-01",
        "tracestate": f"dd=s:1;o:rum;p:{parent_hex};t.tid:{high_hex}",
        "x-datadog-origin": "rum",
        "x-datadog-parent-id": str(parent),
        "x-datadog-sampling-priority": "1",
        "x-datadog-trace-id": str(low),
    }


def _generate_pkce() -> tuple[str, str]:
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode("ascii")
    code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


def _random_password(length: int = 16) -> str:
    specials = "!@#$%^&*-_=+"
    chars = string.ascii_letters + string.digits + specials
    value = list(
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + secrets.choice(string.digits)
        + secrets.choice(specials)
        + "".join(secrets.choice(chars) for _ in range(max(0, length - 4)))
    )
    random.shuffle(value)
    return "".join(value)


def _random_name() -> tuple[str, str]:
    return random.choice(FIRST_NAMES), random.choice(LAST_NAMES)


def _random_birthdate() -> str:
    return f"{random.randint(1980, 2006):04d}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"


def _response_json(resp) -> dict:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _decode_jwt_payload(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


def create_mailbox(username: str | None = None) -> dict:
    return mail_provider.create_mailbox(config["mail"], username)


def wait_for_code(mailbox: dict) -> str | None:
    return mail_provider.wait_for_code(config["mail"], mailbox)


class SentinelPowExhausted(RuntimeError):
    """PoW 暴力搜索耗尽 MAX_ATTEMPTS；由 build_sentinel_token 捕获后整体重试。"""


class SentinelTokenGenerator:
    MAX_ATTEMPTS = 500000

    def __init__(self, device_id: str, fp: dict):
        self.device_id = device_id
        self.fp = fp
        self.user_agent = fp["ua"]
        self.sid = str(uuid.uuid4())

    @staticmethod
    def _fnv1a_32(text: str) -> str:
        h = 2166136261
        for ch in text:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 16
        h = (h * 2246822507) & 0xFFFFFFFF
        h ^= h >> 13
        h = (h * 3266489909) & 0xFFFFFFFF
        h ^= h >> 16
        return format(h & 0xFFFFFFFF, "08x")

    def _get_config(self) -> list:
        perf_now = random.uniform(1000, 50000)
        locale = self.fp.get("accept_language", "en-US,en;q=0.9").split(",")[0].strip()
        return [
            self.fp.get("screen", "1920x1080"),
            _format_local_date_string(self.fp),
            4294705152,
            random.random(),
            self.user_agent,
            SENTINEL_SDK_URL,
            None,
            None,
            locale,
            random.random(),
            random.choice(["vendorSub-undefined", "plugins-undefined", "mimeTypes-undefined", "hardwareConcurrency-undefined"]),
            random.choice(["location", "implementation", "URL", "documentURI", "compatMode"]),
            random.choice(["Object", "Function", "Array", "Number", "parseFloat", "undefined"]),
            perf_now,
            self.sid,
            "",
            self.fp.get("hardware_concurrency", 8),
            time.time() * 1000 - perf_now,
        ]

    @staticmethod
    def _b64(data) -> str:
        return base64.b64encode(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).decode("ascii")

    def generate_requirements_token(self) -> str:
        data = self._get_config()
        data[3] = 1
        data[9] = round(random.uniform(5, 50))
        return "gAAAAAC" + self._b64(data)

    def generate_token(self, seed: str, difficulty: str) -> str:
        start = time.time()
        data = self._get_config()
        difficulty = str(difficulty or "0")
        for i in range(self.MAX_ATTEMPTS):
            data[3] = i
            data[9] = round((time.time() - start) * 1000)
            payload = self._b64(data)
            if self._fnv1a_32(seed + payload)[: len(difficulty)] <= difficulty:
                return "gAAAAAB" + payload + "~S"
        raise SentinelPowExhausted(f"pow_exhausted_difficulty={difficulty}")


def build_sentinel_token(session, device_id: str, flow: str, fp: dict, attempts: int = 2) -> str:
    last_error: Exception | None = None
    for _ in range(max(1, attempts)):
        generator = SentinelTokenGenerator(device_id, fp)
        resp = session.post(
            "https://sentinel.openai.com/backend-api/sentinel/req",
            data=json.dumps({"p": generator.generate_requirements_token(), "id": device_id, "flow": flow}),
            headers={
                "Content-Type": "text/plain;charset=UTF-8",
                "Referer": "https://sentinel.openai.com/backend-api/sentinel/frame.html",
                "Origin": "https://sentinel.openai.com",
                "User-Agent": fp["ua"],
                "sec-ch-ua": fp["sec_ch_ua"],
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": fp["platform"],
            },
            timeout=20,
            verify=False,
        )
        data = _response_json(resp)
        token = str(data.get("token") or "").strip()
        if resp.status_code != 200 or not token:
            raise RuntimeError(f"sentinel_req_failed_{resp.status_code}")
        pow_data = data.get("proofofwork") or {}
        try:
            p_value = (
                generator.generate_token(str(pow_data.get("seed") or ""), str(pow_data.get("difficulty") or "0"))
                if pow_data.get("required") and pow_data.get("seed")
                else generator.generate_requirements_token()
            )
        except SentinelPowExhausted as e:
            last_error = e
            continue
        return json.dumps({"p": p_value, "t": "", "c": token, "id": device_id, "flow": flow}, separators=(",", ":"))
    raise RuntimeError(f"sentinel_token_failed: {last_error}")


def _is_socks_proxy(proxy: str) -> bool:
    candidate = str(proxy or "").strip().lower()
    return candidate.startswith("socks5://") or candidate.startswith("socks5h://")


def create_session(proxy: str = "", impersonate: str = "chrome131") -> Any:
    """统一走 curl_cffi，保证 TLS/JA3 与 UA 同源；任意路径都不再暴露 python-requests 指纹。"""
    proxy = (proxy or "").strip()

    def _new(imp: str):
        if not proxy:
            return curl_requests.Session(impersonate=imp, verify=False)
        if _is_socks_proxy(proxy):
            return curl_requests.Session(impersonate=imp, verify=False, proxy=proxy)
        return curl_requests.Session(impersonate=imp, verify=False, proxies={"http": proxy, "https": proxy})

    try:
        return _new(impersonate)
    except Exception:
        # 当前 curl_cffi 版本不支持该 impersonate 名称，回退到最新 chrome
        return _new("chrome")


def request_with_local_retry(session, method: str, url: str, retry_attempts: int = 3, **kwargs):
    last_error = ""
    for _ in range(max(1, retry_attempts)):
        try:
            return session.request(method.upper(), url, timeout=default_timeout, **kwargs), ""
        except Exception as error:
            last_error = str(error)
            time.sleep(1)
    return None, last_error


def validate_otp(session, device_id: str, code: str, fp: dict):
    headers = build_common_headers(fp)
    headers["referer"] = f"{auth_base}/email-verification"
    headers["oai-device-id"] = device_id
    headers.update(_make_trace_headers())
    resp, error = request_with_local_retry(session, "post", f"{auth_base}/api/accounts/email-otp/validate", json={"code": code}, headers=headers, verify=False)
    if resp is not None and resp.status_code == 200:
        return resp, ""
    headers["openai-sentinel-token"] = build_sentinel_token(session, device_id, "authorize_continue", fp)
    resp, error = request_with_local_retry(session, "post", f"{auth_base}/api/accounts/email-otp/validate", json={"code": code}, headers=headers, verify=False)
    return resp, error


def extract_oauth_callback_params_from_url(url: str) -> dict[str, str] | None:
    if not url:
        return None
    try:
        params = parse_qs(urlparse(url).query)
    except Exception:
        return None
    code = str((params.get("code") or [""])[0]).strip()
    if not code:
        return None
    return {"code": code, "state": str((params.get("state") or [""])[0]).strip(), "scope": str((params.get("scope") or [""])[0]).strip()}


def extract_oauth_callback_params_from_consent_session(session, consent_url: str, device_id: str, fp: dict) -> dict[str, str] | None:
    if consent_url.startswith("/"):
        consent_url = f"{auth_base}{consent_url}"
    current_url = consent_url
    nav_headers = build_navigate_headers(fp)
    for _ in range(10):
        response = session.get(current_url, headers=nav_headers, verify=False, timeout=30, allow_redirects=False)
        callback_params = extract_oauth_callback_params_from_url(str(response.url)) or extract_oauth_callback_params_from_url(str(response.headers.get("Location") or "").strip())
        if callback_params:
            return callback_params
        location = str(response.headers.get("Location") or "").strip()
        if response.status_code not in (301, 302, 303, 307, 308) or not location:
            break
        current_url = f"{auth_base}{location}" if location.startswith("/") else location
    raw = session.cookies.get("oai-client-auth-session", domain=".auth.openai.com") or session.cookies.get("oai-client-auth-session")
    if not raw:
        return None
    try:
        first_part = raw.split(".")[0]
        padding = 4 - len(first_part) % 4
        if padding != 4:
            first_part += "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(first_part))
        workspace_id = payload["workspaces"][0]["id"]
    except Exception:
        return None
    headers = build_common_headers(fp)
    headers["referer"] = consent_url
    headers["oai-device-id"] = device_id
    headers.update(_make_trace_headers())
    ws_resp = session.post(f"{auth_base}/api/accounts/workspace/select", json={"workspace_id": workspace_id}, headers=headers, verify=False, timeout=30, allow_redirects=False)
    callback_params = extract_oauth_callback_params_from_url(str(ws_resp.headers.get("Location") or "").strip())
    if callback_params:
        return callback_params
    ws_data = _response_json(ws_resp)
    orgs = ((ws_data.get("data") or {}).get("orgs") or []) if isinstance(ws_data, dict) else []
    if not orgs:
        return None
    org_id = str((orgs[0] or {}).get("id") or "").strip()
    project_id = str(((orgs[0] or {}).get("projects") or [{}])[0].get("id") or "").strip()
    if not org_id:
        return None
    org_headers = build_common_headers(fp)
    org_headers["referer"] = str(ws_data.get("continue_url") or consent_url)
    org_headers["oai-device-id"] = device_id
    org_headers.update(_make_trace_headers())
    body = {"org_id": org_id}
    if project_id:
        body["project_id"] = project_id
    org_resp = session.post(f"{auth_base}/api/accounts/organization/select", json=body, headers=org_headers, verify=False, timeout=30, allow_redirects=False)
    return extract_oauth_callback_params_from_url(str(org_resp.headers.get("Location") or "").strip())


def exchange_platform_tokens(session, device_id: str, code_verifier: str, consent_url: str, fp: dict) -> dict | None:
    callback_params = extract_oauth_callback_params_from_consent_session(session, consent_url, device_id, fp)
    if not callback_params:
        # 回退方案：直接导航 consent URL（allow_redirects=True），从最终 URL 提取 code
        print(f"[exchange_platform_tokens] 主方案失败，尝试回退方案, continue_url={consent_url[:120]}")
        try:
            r = session.get(consent_url, headers=build_navigate_headers(fp), allow_redirects=True, verify=False, timeout=30)
            final_url = str(r.url)
            print(f"[exchange_platform_tokens] 回退 final_url={final_url[:120]}")
            callback_params = extract_oauth_callback_params_from_url(final_url)
            if not callback_params:
                for hist in getattr(r, "history", []) or []:
                    loc = str(hist.headers.get("Location") or "")
                    callback_params = extract_oauth_callback_params_from_url(loc)
                    if callback_params:
                        break
        except Exception as e:
            print(f"[exchange_platform_tokens] 回退方案异常: {e}")
    if not callback_params:
        print("[exchange_platform_tokens] 所有方案均无法提取 OAuth code")
        return None
    code = str(callback_params.get("code") or "").strip()
    if not code:
        return None
    token_session = create_session(config["proxy"], impersonate=fp.get("impersonate", "chrome131"))
    try:
        resp = token_session.post(
            f"{auth_base}/oauth/token",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": fp["ua"],
                "Origin": platform_base,
                "Referer": f"{platform_base}/",
                "accept-language": fp.get("accept_language", "en-US,en;q=0.9"),
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": platform_oauth_redirect_uri,
                "client_id": platform_oauth_client_id,
                "code_verifier": code_verifier,
            },
            verify=False,
            timeout=60,
        )
    finally:
        try:
            token_session.close()
        except Exception:
            pass
    data = _response_json(resp)
    if resp.status_code != 200 or not data.get("access_token") or not data.get("refresh_token") or not data.get("id_token"):
        return None
    payload = _decode_jwt_payload(str(data.get("id_token") or "")) or _decode_jwt_payload(str(data.get("access_token") or ""))
    return {
        "email": str(payload.get("email") or "").strip(),
        "access_token": str(data.get("access_token") or "").strip(),
        "refresh_token": str(data.get("refresh_token") or "").strip(),
        "id_token": str(data.get("id_token") or "").strip(),
    }


class PlatformRegistrar:
    def __init__(self, proxy: str = "") -> None:
        self.fp = pick_fingerprint()
        self.session = create_session(proxy, impersonate=self.fp.get("impersonate", "chrome131"))
        self.device_id = str(uuid.uuid4())

    def close(self) -> None:
        try:
            self.session.close()
        except Exception:
            pass

    def _navigate_headers(self, referer: str = "") -> dict[str, str]:
        headers = build_navigate_headers(self.fp)
        if referer:
            headers["referer"] = referer
        return headers

    def _json_headers(self, referer: str) -> dict[str, str]:
        headers = build_common_headers(self.fp)
        headers["referer"] = referer
        headers["oai-device-id"] = self.device_id
        headers.update(_make_trace_headers())
        return headers

    def _platform_authorize(self, email: str, index: int) -> None:
        step(index, "开始 platform authorize")
        # 仅写 .auth.openai.com 一份；前导点会覆盖 auth.openai.com 子域
        self.session.cookies.set("oai-did", self.device_id, domain=".auth.openai.com")
        _, code_challenge = _generate_pkce()
        params = {
            "issuer": auth_base,
            "client_id": platform_oauth_client_id,
            "audience": platform_oauth_audience,
            "redirect_uri": platform_oauth_redirect_uri,
            "device_id": self.device_id,
            "screen_hint": "login_or_signup",
            "max_age": "0",
            "login_hint": email,
            "scope": "openid profile email offline_access",
            "response_type": "code",
            "response_mode": "query",
            "state": secrets.token_urlsafe(32),
            "nonce": secrets.token_urlsafe(32),
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "auth0Client": platform_auth0_client,
        }
        resp, error = request_with_local_retry(self.session, "get", f"{auth_base}/api/accounts/authorize?{urlencode(params)}", headers=self._navigate_headers(f"{platform_base}/"), allow_redirects=True, verify=False)
        if resp is None or resp.status_code != 200:
            err = _response_json(resp).get("error", {}) if resp is not None else {}
            detail = f": {err.get('code', '')} - {err.get('message', '')}".strip(" -") if err else ""
            raise RuntimeError(error or f"platform_authorize_http_{getattr(resp, 'status_code', 'unknown')}{detail}")
        step(index, "platform authorize 完成")

    def _register_user(self, email: str, password: str, index: int) -> None:
        step(index, "开始提交注册密码")
        headers = self._json_headers(f"{auth_base}/create-account/password")
        headers["openai-sentinel-token"] = build_sentinel_token(self.session, self.device_id, "username_password_create", self.fp)
        resp, error = request_with_local_retry(self.session, "post", f"{auth_base}/api/accounts/user/register", json={"username": email, "password": password}, headers=headers, verify=False)
        if resp is None or resp.status_code != 200:
            data = _response_json(resp) if resp is not None else {}
            if data.get("message") == "Failed to create account. Please try again.":
                step(index, "注册失败提示: 邮箱域名很可能因滥用被封禁，请更换邮箱域名", "yellow")
            detail = f", detail={json.dumps(data, ensure_ascii=False)}" if data else ""
            raise RuntimeError(error or f"user_register_http_{getattr(resp, 'status_code', 'unknown')}{detail}")
        step(index, "提交注册密码完成")

    def _send_otp(self, index: int) -> None:
        step(index, "开始发送验证码")
        resp, error = request_with_local_retry(self.session, "get", f"{auth_base}/api/accounts/email-otp/send", headers=self._navigate_headers(f"{auth_base}/create-account/password"), allow_redirects=True, verify=False)
        if resp is None or resp.status_code not in (200, 302):
            raise RuntimeError(error or f"send_otp_http_{getattr(resp, 'status_code', 'unknown')}")
        step(index, "发送验证码完成")

    def _validate_otp(self, code: str, index: int) -> None:
        step(index, f"开始校验验证码 {code}")
        resp, error = validate_otp(self.session, self.device_id, code, self.fp)
        if resp is None or resp.status_code != 200:
            body = ""
            try:
                body = (resp.text or "")[:500] if resp is not None else ""
            except Exception:
                pass
            raise RuntimeError(error or f"validate_otp_http_{getattr(resp, 'status_code', 'unknown')}_body={body}")
        step(index, "验证码校验完成")

    def _create_account(self, name: str, birthdate: str, index: int) -> None:
        step(index, "开始创建账号资料")
        headers = self._json_headers(f"{auth_base}/about-you")
        headers["openai-sentinel-token"] = build_sentinel_token(self.session, self.device_id, "oauth_create_account", self.fp)
        resp, error = request_with_local_retry(self.session, "post", f"{auth_base}/api/accounts/create_account", json={"name": name, "birthdate": birthdate}, headers=headers, verify=False)
        if resp is None or resp.status_code not in (200, 302):
            data = _response_json(resp) if resp is not None else {}
            if data.get("message") == "Failed to create account. Please try again.":
                step(index, "创建账号失败提示: 邮箱域名很可能因滥用被封禁，请更换邮箱域名", "yellow")
            detail = f", detail={json.dumps(data, ensure_ascii=False)}" if data else ""
            raise RuntimeError(error or f"create_account_http_{getattr(resp, 'status_code', 'unknown')}{detail}")
        step(index, "创建账号资料完成")

    def _login_and_exchange_tokens(self, email: str, password: str, mailbox: dict, index: int) -> dict:
        step(index, "开始独立登录换 token")
        # 登录 session 使用全新指纹 + 新 device_id，与注册 session 解耦，降低同账号双指纹关联
        login_fp = pick_fingerprint()
        login_session = create_session(config["proxy"], impersonate=login_fp.get("impersonate", "chrome131"))
        login_device_id = str(uuid.uuid4())
        login_session.cookies.set("oai-did", login_device_id, domain=".auth.openai.com")
        code_verifier, code_challenge = _generate_pkce()
        params = {
            "issuer": auth_base,
            "client_id": platform_oauth_client_id,
            "audience": platform_oauth_audience,
            "redirect_uri": platform_oauth_redirect_uri,
            "device_id": login_device_id,
            "screen_hint": "login_or_signup",
            "max_age": "0",
            "login_hint": email,
            "scope": "openid profile email offline_access",
            "response_type": "code",
            "response_mode": "query",
            "state": secrets.token_urlsafe(32),
            "nonce": secrets.token_urlsafe(32),
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "auth0Client": platform_auth0_client,
        }

        def _login_nav_headers(referer: str = "") -> dict[str, str]:
            h = build_navigate_headers(login_fp)
            if referer:
                h["referer"] = referer
            return h

        def _login_json_headers(referer: str) -> dict[str, str]:
            h = build_common_headers(login_fp)
            h["referer"] = referer
            h["oai-device-id"] = login_device_id
            h.update(_make_trace_headers())
            return h

        resp, error = request_with_local_retry(
            login_session, "get",
            f"{auth_base}/api/accounts/authorize?{urlencode(params)}",
            headers=_login_nav_headers(f"{platform_base}/"),
            allow_redirects=True, verify=False
        )
        if resp is None:
            raise RuntimeError(error or "platform_login_authorize_failed")
        step(index, "登录 authorize 完成")

        # 提交邮箱（原样，不带 state）
        def _do_authorize_continue():
            h = _login_json_headers(f"{auth_base}/log-in?usernameKind=email")
            h["openai-sentinel-token"] = build_sentinel_token(login_session, login_device_id, "authorize_continue", login_fp)
            return request_with_local_retry(
                login_session, "post",
                f"{auth_base}/api/accounts/authorize/continue",
                json={"username": {"kind": "email", "value": email}},
                headers=h,
                allow_redirects=False,
                verify=False
            )

        step(index, "开始提交邮箱")
        resp, error = _do_authorize_continue()
        if resp is not None and resp.status_code == 409:
            step(index, "邮箱提交 invalid_state，重新 authorize 后重试")
            for cookie in list(login_session.cookies):
                domain = getattr(cookie, "domain", "") or ""
                if 'auth.openai.com' in domain:
                    try:
                        login_session.cookies.clear(domain=domain, path=getattr(cookie, "path", "/"), name=cookie.name)
                    except Exception:
                        pass
            login_session.cookies.set("oai-did", login_device_id, domain=".auth.openai.com")
            resp, error = request_with_local_retry(
                login_session, "get",
                f"{auth_base}/api/accounts/authorize?{urlencode(params)}",
                headers=_login_nav_headers(f"{platform_base}/"),
                allow_redirects=True, verify=False
            )
            if resp is None:
                raise RuntimeError(error or "platform_login_authorize_retry_failed")
            resp, error = _do_authorize_continue()

        if resp is None or resp.status_code != 200:
            data = _response_json(resp) if resp is not None else {}
            detail = json.dumps(data, ensure_ascii=False) if data else ""
            raise RuntimeError(
                error or f"email_submit_http_{getattr(resp, 'status_code', 'unknown')}"
                + (f": {detail}" if detail else "")
            )
        step(index, "邮箱提交完成")

        # 密码验证
        step(index, "开始密码校验")
        headers = _login_json_headers(f"{auth_base}/log-in/password")
        headers["openai-sentinel-token"] = build_sentinel_token(
            login_session, login_device_id, "password_verify", login_fp
        )
        resp, error = request_with_local_retry(
            login_session, "post",
            f"{auth_base}/api/accounts/password/verify",
            json={"password": password},
            headers=headers,
            allow_redirects=False,
            verify=False
        )
        if resp is None or resp.status_code != 200:
            body = ""
            try:
                body = (resp.text or "")[:500] if resp is not None else ""
            except Exception:
                pass
            raise RuntimeError(error or f"password_verify_http_{getattr(resp, 'status_code', '')}_body={body}")
        step(index, "密码校验完成")

        payload = _response_json(resp)
        continue_url = str(payload.get("continue_url") or "").strip()
        page_type = str(((payload.get("page") or {}).get("type")) or "")

        if page_type == "email_otp_verification" or "email-verification" in continue_url or "email-otp" in continue_url:
            step(index, "独立登录需要邮箱验证码")
            code = wait_for_code(mailbox)
            if not code:
                login_session.close()
                raise RuntimeError("独立登录等待验证码超时")
            step(index, f"收到登录验证码: {code}")
            resp, reason = validate_otp(login_session, login_device_id, code, login_fp)
            if resp is None or resp.status_code != 200:
                print("独立登录验证码校验失败响应:", resp.text if resp is not None else "None")
                data = _response_json(resp) if resp is not None else {}
                message = str((data.get("error") or {}).get("message") or data.get("message") or "").strip()
                login_session.close()
                raise RuntimeError(reason or f"独立登录验证码校验失败{': ' + message if message else ''}")
            otp_payload = _response_json(resp)
            continue_url = str(otp_payload.get("continue_url") or continue_url).strip()
            step(index, "独立登录验证码校验完成")

        if not continue_url:
            continue_url = f"{auth_base}/sign-in-with-chatgpt/codex/consent"
        tokens = exchange_platform_tokens(login_session, login_device_id, code_verifier, continue_url, login_fp)
        try:
            login_session.close()
        except Exception:
            pass
        if not tokens:
            raise RuntimeError("token换取失败")
        step(index, "token 换取完成")
        return tokens

    def register(self, index: int) -> dict:
        step(index, "开始创建邮箱")
        mailbox = create_mailbox()
        email = str(mailbox.get("address") or "").strip()
        if not email:
            raise RuntimeError("邮箱服务未返回 address")
        label = str(mailbox.get("label") or "")
        step(index, f"邮箱创建完成[{label}]: {email}")
        password = _random_password()
        first_name, last_name = _random_name()
        self._platform_authorize(email, index)
        self._register_user(email, password, index)
        self._send_otp(index)
        step(index, "开始等待注册验证码")
        code = wait_for_code(mailbox)
        if not code:
            raise RuntimeError("等待注册验证码超时")
        step(index, f"收到注册验证码: {code}")
        self._validate_otp(code, index)
        self._create_account(f"{first_name} {last_name}", _random_birthdate(), index)
        tokens = self._login_and_exchange_tokens(email, password, mailbox, index)
        return {
            "email": email,
            "password": password,
            "access_token": str(tokens.get("access_token") or "").strip(),
            "refresh_token": str(tokens.get("refresh_token") or "").strip(),
            "id_token": str(tokens.get("id_token") or "").strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


def worker(index: int) -> dict:
    start = time.time()
    registrar = PlatformRegistrar(config["proxy"])
    try:
        step(index, "任务启动")
        result = registrar.register(index)
        cost = time.time() - start
        access_token = str(result["access_token"])
        account_service.add_account_items([result])
        account_service.refresh_accounts([access_token])
        with stats_lock:
            stats["done"] += 1
            stats["success"] += 1
            avg = (time.time() - stats["start_time"]) / stats["success"]
        log(f'{result["email"]} 注册成功，本次耗时{cost:.1f}s，全局平均每个号注册耗时{avg:.1f}s', "green")
        return {"ok": True, "index": index, "result": result}
    except Exception as e:
        cost = time.time() - start
        with stats_lock:
            stats["done"] += 1
            stats["fail"] += 1
        log(f"任务{index} 注册失败，本次耗时{cost:.1f}s，原因: {e}", "red")
        return {"ok": False, "index": index, "error": str(e)}
    finally:
        registrar.close()
