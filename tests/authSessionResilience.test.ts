import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 鉴权韧性验收：异常百分号编码的 Cookie 必须按「未登录」处理，而不是抛 URIError。
 * 写入探针使用独立 DATABASE_URL（导入 lib/db.ts 前设置）并在结束时断开、清理临时库。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-auth-resilience-"));
  const file = path.join(dir, "auth.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { SEMANTIC_MEMORY_ENABLED: "false", LLM_MODE: "mock" });
  const sql = new Database(file);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const migrationFile = path.join("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(migrationFile)) sql.exec(fs.readFileSync(migrationFile, "utf8"));
  }
  sql.close();
  return { dir };
});

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

import fs from "node:fs";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { authenticateUser, readBearerToken } from "@/lib/auth/guard";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/serverSession";
import { createSession, hashToken } from "@/lib/auth/session";
import { sessionCookieHeader } from "@/lib/auth/sessionCookie";

let userId = "";

beforeAll(async () => {
  const user = await db.user.create({
    data: { username: `auth-resilience-${Date.now()}`, displayName: "鉴权韧性用户", passwordHash: "unused" },
  });
  userId = user.id;
});

afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await db.authSession.deleteMany({ where: { userId } }).catch(() => {});
  await db.user.delete({ where: { id: userId } }).catch(() => {});
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

function requestWithCookie(cookie: string) {
  return new Request("http://localhost/api/projects", { headers: { cookie } });
}

function requestWithBearer(token: string) {
  return new Request("http://localhost/api/projects", { headers: { authorization: `Bearer ${token}` } });
}

const MALFORMED = ["%E0%A4%A", "%ZZ", "%", "%E0%A4"];

describe("异常编码 Cookie 按未登录处理", () => {
  it.each(MALFORMED)("readBearerToken 对 pm_session=%s 返回空字符串而不是抛 URIError", (encoded) => {
    expect(() => readBearerToken(requestWithCookie(`pm_session=${encoded}`))).not.toThrow();
    expect(readBearerToken(requestWithCookie(`pm_session=${encoded}`))).toBe("");
  });

  it.each(MALFORMED)("readBearerToken 对 session_token=%s 返回空字符串", (encoded) => {
    expect(readBearerToken(requestWithCookie(`session_token=${encoded}`))).toBe("");
  });

  it("authenticateUser 对异常编码 Cookie 返回 AppError(UNAUTHORIZED, 401)，不是 URIError", async () => {
    for (const encoded of MALFORMED) {
      const error = await authenticateUser(requestWithCookie(`pm_session=${encoded}`)).catch((value: unknown) => value);
      expect(error, `pm_session=${encoded}`).toBeInstanceOf(AppError);
      expect(error).not.toBeInstanceOf(URIError);
      expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    }
  });

  it("authenticateUser 对异常编码 session_token 同样返回 401", async () => {
    const error = await authenticateUser(requestWithCookie("session_token=%E0%A4%A")).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AppError);
    expect(error).not.toBeInstanceOf(URIError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("getSessionUser 对异常编码 Cookie 返回 null，页面不崩溃", async () => {
    for (const encoded of MALFORMED) {
      jar.set(SESSION_COOKIE, encoded);
      await expect(getSessionUser()).resolves.toBeNull();
    }
  });
});

describe("有效凭据恢复用户", () => {
  it("URL 编码后的有效 pm_session Cookie 能恢复用户", async () => {
    const { token } = await createSession(userId);
    const cookie = sessionCookieHeader(token).split(";")[0];
    expect(cookie).toBe(`pm_session=${encodeURIComponent(token)}`);

    const context = await authenticateUser(requestWithCookie(cookie));
    expect(context.user.id).toBe(userId);
    expect(context.session.tokenHash).toBe(hashToken(token));
  });

  it("直接 encodeURIComponent(token) 的 Cookie 与有效 Bearer Token 都能恢复用户", async () => {
    const { token } = await createSession(userId);

    const fromCookie = await authenticateUser(requestWithCookie(`pm_session=${encodeURIComponent(token)}`));
    expect(fromCookie.user.id).toBe(userId);

    const fromBearer = await authenticateUser(requestWithBearer(token));
    expect(fromBearer.user.id).toBe(userId);
  });

  it("readBearerToken 对有效编码 Cookie 返回解码后的 token", async () => {
    const { token } = await createSession(userId);
    const value = encodeURIComponent(token);
    expect(readBearerToken(requestWithCookie(`pm_session=${value}`))).toBe(token);
    expect(readBearerToken(requestWithBearer(token))).toBe(token);
  });

  it("getSessionUser 用 URL 编码的有效 Cookie 恢复用户", async () => {
    const { token } = await createSession(userId);
    jar.set(SESSION_COOKIE, encodeURIComponent(token));
    const user = await getSessionUser();
    expect(user?.id).toBe(userId);
  });
});

describe("过期与撤销会话拒绝", () => {
  it("expiresAt 已过去的会话 Cookie/Bearer 均返回 401", async () => {
    const { token, session } = await createSession(userId);
    await db.authSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const cookieError = await authenticateUser(requestWithCookie(`pm_session=${encodeURIComponent(token)}`)).catch((value: unknown) => value);
    expect(cookieError).toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    const bearerError = await authenticateUser(requestWithBearer(token)).catch((value: unknown) => value);
    expect(bearerError).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("revokedAt 已设置的会话 Cookie/Bearer 均返回 401", async () => {
    const { token, session } = await createSession(userId);
    await db.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    const cookieError = await authenticateUser(requestWithCookie(`pm_session=${encodeURIComponent(token)}`)).catch((value: unknown) => value);
    expect(cookieError).toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    const bearerError = await authenticateUser(requestWithBearer(token)).catch((value: unknown) => value);
    expect(bearerError).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("过期/撤销的会话 Cookie 在 getSessionUser 中也恢复不出用户", async () => {
    const revoked = await createSession(userId);
    await db.authSession.update({ where: { id: revoked.session.id }, data: { revokedAt: new Date() } });
    jar.set(SESSION_COOKIE, encodeURIComponent(revoked.token));
    await expect(getSessionUser()).resolves.toBeNull();

    const expired = await createSession(userId);
    await db.authSession.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    jar.set(SESSION_COOKIE, encodeURIComponent(expired.token));
    await expect(getSessionUser()).resolves.toBeNull();
  });
});
