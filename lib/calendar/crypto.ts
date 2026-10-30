import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "@/lib/api";

const VERSION = "v1";
function key() {
  const raw = process.env.CALENDAR_TOKEN_KEY?.trim();
  if (!raw) throw new AppError("CALENDAR_NOT_CONFIGURED", "服务端尚未配置日历凭据加密密钥", 503);
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new AppError("CALENDAR_NOT_CONFIGURED", "日历凭据加密密钥必须为 32 字节（base64 或 hex）", 503);
  return bytes;
}
export const calendarConfigured = () => {
  try { key(); return true; } catch { return false; }
};
/** AES-256-GCM envelope. Tokens never leave this module as plaintext outside server calls. */
export function sealSecret(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function openSecret(envelope: string): string {
  const [version, iv, tag, payload] = envelope.split(".");
  if (version !== VERSION || !iv || !tag || !payload) throw new AppError("CALENDAR_TOKEN_INVALID", "日历凭据密文无法读取", 503);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new AppError("CALENDAR_TOKEN_INVALID", "日历凭据密文校验失败", 503); }
}
export const randomUrlToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
