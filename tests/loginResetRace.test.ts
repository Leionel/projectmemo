import { afterAll, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("login-reset-race"));
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import * as sessions from "@/lib/auth/session";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as reset } from "@/app/api/auth/reset-password/route";
const originalCreateSession = sessions.createSession;
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.$disconnect();
  const target = path.resolve(isolated.dir);
  if (!target.startsWith(path.join(os.tmpdir(), "pm-continuity-login-reset-race-"))) throw new Error("隔离清理路径不正确");
  fs.rmSync(target, { recursive: true, force: true });
});
function request(data: unknown) { return new Request("http://localhost/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); }
async function user(name: string) { return db.user.create({ data: {
  username: name, displayName: name, passwordHash: await hashPassword("old-secure-password"),
  security: { create: { email: name + "@example.invalid", emailVerifiedAt: new Date() } },
} }); }
it("密码重置已提交后，在途旧密码登录不得新建会话", async () => {
  const account = await user("reset-race");
  const token = "a".repeat(64);
  await db.accountToken.create({ data: { userId: account.id, purpose: "RESET_PASSWORD",
    tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) } });
  vi.spyOn(sessions, "createSession").mockImplementationOnce(async (...args) => {
    const response = await reset(request({ token, password: "new-secure-password", confirmPassword: "new-secure-password" }));
    expect(response.status).toBe(200);
    return originalCreateSession(...args);
  });
  const response = await login(request({ username: account.username, password: "old-secure-password" }));
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await db.authSession.count({ where: { userId: account.id, revokedAt: null } })).toBe(0);
  expect((await login(request({ username: account.username, password: "new-secure-password" }))).status).toBe(200);
});
it("校验后邮箱资格被撤回，在途登录不得新建会话", async () => {
  const account = await user("verification-race");
  vi.spyOn(sessions, "createSession").mockImplementationOnce(async (...args) => {
    await db.accountSecurity.update({ where: { userId: account.id }, data: { emailVerifiedAt: null } });
    return originalCreateSession(...args);
  });
  const response = await login(request({ username: account.username, password: "old-secure-password" }));
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await db.authSession.count({ where: { userId: account.id } })).toBe(0);
});
