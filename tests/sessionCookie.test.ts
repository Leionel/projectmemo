import { afterEach, describe, expect, it, vi } from "vitest";
import { clearedSessionCookieHeader, sessionCookieHeader } from "@/lib/auth/sessionCookie";

/**
 * 生产环境评审后端是 HTTPS。缺了 Secure，浏览器仍会在明文连接上把会话凭据发出去；
 * 而本地开发走 http://127.0.0.1，带上 Secure 会导致 Cookie 根本不被保存。
 * 因此这里断言的是「按 NODE_ENV 区分」，而不是无条件加或无条件不加。
 */
describe("会话 Cookie 属性", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("生产环境的写入 Cookie 带 HttpOnly / SameSite / Secure", () => {
    vi.stubEnv("NODE_ENV", "production");

    const header = sessionCookieHeader("token-value");

    expect(header).toContain("pm_session=token-value");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
  });

  it("本地开发不加 Secure，否则 http://127.0.0.1 上 Cookie 会被直接丢弃", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(sessionCookieHeader("token-value")).not.toContain("Secure");
  });

  it("清除用的 Cookie 与写入时属性一致，确保真正覆盖而不是留下旧 Cookie", () => {
    vi.stubEnv("NODE_ENV", "production");

    const cleared = clearedSessionCookieHeader();

    expect(cleared).toContain("pm_session=;");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Lax");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("会话凭据在 Cookie 中按 URL 编码写入", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(sessionCookieHeader("a+b/c=")).toContain("pm_session=a%2Bb%2Fc%3D");
  });
});