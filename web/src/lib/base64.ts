const BASE64_BODY_RE = /^[A-Za-z0-9+/=_-]+$/;

function base64Payload(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("data:") && text.includes(",") ? text.split(",", 2)[1] || "" : text;
}

export function normalizeBase64(value: string): string {
  const payload = base64Payload(value).replace(/\s+/g, "");
  if (!payload) return "";
  if (!BASE64_BODY_RE.test(payload)) {
    throw new Error("invalid base64 image data");
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized + "=".repeat(padding);
}

export function decodeBase64Bytes(value: string): number[] {
  const binary = atob(normalizeBase64(value));
  return Array.from(binary, (char) => char.charCodeAt(0));
}
