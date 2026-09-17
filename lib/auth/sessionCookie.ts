/**
 * 会话 Cookie 的唯一构造点。
 *
 * `Secure` 只按 NODE_ENV 判断，不看请求头：生产评审后端是 HTTPS，
 * 缺了 Secure 浏览器仍会在明文连接上把会话凭据发出去；而本地开发走
 * http://127.0.0.1，带上 Secure 会导致 Cookie 根本不被保存。
 * Host / X-Forwarded-Proto 由客户端决定，不能作为安全属性依据。
 */
export const SESSION_COOKIE = "pm_session";

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600;

function secureAttribute(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookieHeader(
  token: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureAttribute()}`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureAttribute()}`;
}