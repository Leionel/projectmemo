import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("login-identity"),
);
afterAll(async () => {
  await db.$disconnect();
  const target = path.resolve(isolated.dir);
  if (!target.startsWith(path.join(os.tmpdir(), "pm-continuity-login-identity-")))
    throw new Error("拒绝清理隔离目录之外的路径");
  fs.rmSync(target, { recursive: true, force: true });
});
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import { sendAccountMail, type AccountMail } from "@/lib/auth/mail";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as verify } from "@/app/api/auth/verify-email/route";
import { POST as resend } from "@/app/api/auth/resend-verification/route";
import { POST as forgot } from "@/app/api/auth/forgot-password/route";
import { POST as reset } from "@/app/api/auth/reset-password/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as projects } from "@/app/api/projects/route";

vi.mock("@/lib/auth/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/mail")>()),
  sendAccountMail: vi.fn(async () => undefined),
}));
const mockMail = vi.mocked(sendAccountMail);
const prefix = "login-id-" + Date.now();
const password = "a correct long password";
let counter = 0;
let ip = "";
function req(
  requestPath: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost" + requestPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": ip,
      ...headers,
    },
    body: JSON.stringify(data),
  });
}
const bearer = (token: string) => ({ Authorization: "Bearer " + token });
function attempt(identifier: string, secret: string, extra: Record<string, unknown> = {}) {
  return login(req("/api/auth/login", { username: identifier, password: secret, ...extra }));
}
function mailToken(index = -1) {
  const message = mockMail.mock.calls.at(index)?.[0] as AccountMail;
  return new URL(
    message.text.match(/http[^\s]+\?token=[a-f0-9]{64}/)![0],
  ).searchParams.get("token")!;
}
type SeededUser = { id: string; username: string; password: string; email?: string };
async function seedUser(options: {
  username?: string;
  secret?: string;
  email?: string;
  verified?: boolean;
  legacyEmailCase?: boolean;
} = {}): Promise<SeededUser> {
  counter++;
  const username = options.username ?? `${prefix}-${counter}`;
  const secret = options.secret ?? password;
  const user = await db.user.create({
    data: {
      username,
      displayName: username,
      passwordHash: await hashPassword(secret),
    },
  });
  if (options.email !== undefined) {
    await db.accountSecurity.create({
      data: {
        userId: user.id,
        email: options.legacyEmailCase ? options.email : options.email.toLowerCase(),
        emailVerifiedAt: options.verified === false ? null : new Date(),
      },
    });
  }
  return { id: user.id, username, password: secret, email: options.email };
}
beforeEach(() => {
  counter++;
  ip = `login-identity-${counter}-${prefix}`;
  mockMail.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_USER", "test");
  vi.stubEnv("SMTP_PASSWORD", "not-a-real-credential");
  vi.stubEnv("SMTP_FROM", "忆程 <noreply@example.com>");
  vi.stubEnv("AUTH_PUBLIC_BASE_URL", "https://project.example.com");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const users = await db.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await db.project.deleteMany({
      where: { memberships: { some: { userId: { in: ids } } } },
    });
  }
  await db.user.deleteMany({ where: { id: { in: ids } } });
});

describe("Username or email login identity", () => {
  it("1. original username keeps the existing session contract", async () => {
    const user = await seedUser();
    const response = await attempt(user.username, user.password, { client: "web" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("pm_session=");
    const body = await response.json();
    expect(body.user).toEqual({
      id: user.id,
      username: user.username,
      displayName: user.username,
    });
    expect(body.accessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.projects).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("emailVerifiedAt");
    const session = await me(
      new Request("http://localhost/api/auth/me", { headers: bearer(body.accessToken) }),
    );
    expect(session.status).toBe(200);
    expect((await session.json()).user.id).toBe(user.id);
  });
  it("2. verified email login resolves the same user and project permissions", async () => {
    const user = await seedUser({ email: `${prefix}-2@example.com` });
    const project = await db.project.create({
      data: {
        title: "邮箱登录权限项目",
        description: "",
        goal: "",
        scenario: "RESEARCH",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const byEmail = await attempt(`  ${user.email!.toUpperCase()}  `, user.password);
    expect(byEmail.status).toBe(200);
    const emailBody = await byEmail.json();
    expect(emailBody.user.id).toBe(user.id);
    expect(emailBody.projects.map((item: { id: string }) => item.id)).toEqual([project.id]);
    const byUsername = await attempt(user.username, user.password);
    expect(byUsername.status).toBe(200);
    expect((await byUsername.json()).user.id).toBe(user.id);
    const list = await projects(
      new Request("http://localhost/api/projects", { headers: bearer(emailBody.accessToken) }),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()).projects.map((item: { id: string }) => item.id);
    expect(listed).toEqual([project.id]);
    // 另一个账号不能借邮箱登录得到不属于自己的项目。
    const other = await seedUser({ email: `${prefix}-2b@example.com` });
    const otherLogin = await attempt(other.email!, other.password);
    expect((await otherLogin.json()).projects).toEqual([]);
  });
  it("3. email normalization reuses registration rules and never merges aliases", async () => {
    // 注册链路会 trim + 小写；+tag 与点号都保留原样，不做别名合并。
    const signupName = `${prefix}-norm`;
    const signupEmail = `${prefix}-Norm.Tag@Example.COM`;
    expect(
      (
        await register(
          req("/api/auth/register", {
            username: signupName,
            email: signupEmail,
            password,
            confirmPassword: password,
          }),
        )
      ).status,
    ).toBe(201);
    expect((await verify(req("/api/auth/verify-email", { token: mailToken() }))).status).toBe(200);
    expect((await attempt(signupEmail.toUpperCase(), password)).status).toBe(200);
    expect((await attempt(` ${signupEmail.toLowerCase()} `, password)).status).toBe(200);
    // 删除 +tag 或点号视为不同邮箱，不能登录到该账号。
    const noTag = signupEmail.toLowerCase().replace(".tag", "");
    expect((await attempt(noTag, password)).status).toBe(401);
    // 历史数据可能保留邮箱原始大小写：查询按 NOCASE 匹配，但账号匹配规则不被改写。
    const legacy = await seedUser({
      email: `${prefix}-Mixed.Case@Example.com`,
      legacyEmailCase: true,
    });
    expect((await attempt(`${prefix}-mixed.case@example.com`, legacy.password)).status).toBe(200);
  });
  it("4. unverified email cannot log in through either identifier", async () => {
    const user = await seedUser({ email: `${prefix}-pending@example.com`, verified: false });
    const byUsername = await attempt(user.username, user.password);
    expect(byUsername.status).toBe(403);
    expect((await byUsername.json()).error).toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      message: "请先验证注册邮箱；未收到邮件可以重新发送",
    });
    expect(byUsername.headers.get("set-cookie")).toBeNull();
    const byEmail = await attempt(user.email!, user.password);
    expect(byEmail.status).toBe(403);
    expect((await byEmail.json()).error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(byEmail.headers.get("set-cookie")).toBeNull();
    expect(await db.authSession.count({ where: { userId: user.id } })).toBe(0);
  });
  it("5. unknown identifier and wrong password share one failure contract", async () => {
    const user = await seedUser({ email: `${prefix}-known@example.com` });
    const unknownEmail = await attempt(`${prefix}-nobody@example.com`, "whatever-password");
    const unknownUsername = await attempt(`${prefix}-nobody`, "whatever-password");
    const wrongPassword = await attempt(user.username, "wrong-password");
    expect(unknownEmail.status).toBe(401);
    expect(unknownUsername.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    const bodies = await Promise.all(
      [unknownEmail, unknownUsername, wrongPassword].map((response) => response.json()),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect(bodies[0].error).toMatchObject({
      code: "AUTH_FAILED",
      message: "账号或密码错误",
    });
    for (const response of [unknownEmail, unknownUsername, wrongPassword]) {
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
  it("6. legacy and demo accounts stay compatible without new security rows", async () => {
    const legacy = await seedUser({ username: `${prefix}-Legacy.User` });
    expect((await attempt(`${prefix}-Legacy.User`, legacy.password)).status).toBe(200);
    // 用户名匹配规则保持不变：大小写不同不再尝试模糊匹配。
    expect((await attempt(`${prefix}-legacy.user`, legacy.password)).status).toBe(401);
    // 演示账号在非生产测试环境按原机制初始化，登录能力保留。
    const demo = await attempt("contest-demo", "contest-demo-2026");
    expect(demo.status).toBe(200);
    expect((await demo.json()).user.username).toBe("contest-demo");
  });
  it("7. ambiguous identifiers never pick an account arbitrarily", async () => {
    const ambiguous = `${prefix}-legacy@example.com`;
    const legacyOwner = await seedUser({ username: ambiguous, secret: "legacy-owner-password" });
    const emailOwner = await seedUser({
      email: ambiguous,
      secret: "email-owner-password",
    });
    const asLegacy = await attempt(ambiguous, legacyOwner.password);
    expect(asLegacy.status).toBe(200);
    expect((await asLegacy.json()).user.id).toBe(legacyOwner.id);
    const asEmail = await attempt(ambiguous, emailOwner.password);
    expect(asEmail.status).toBe(200);
    expect((await asEmail.json()).user.id).toBe(emailOwner.id);
    expect((await attempt(ambiguous, "neither-password")).status).toBe(401);
    // 同一密码同时命中两个账号：不任选，统一失败且不建立会话。
    const shared = "same-password-for-both";
    const dupLegacy = await seedUser({ username: `${prefix}-dup@example.com`, secret: shared });
    const dupEmail = await seedUser({ email: `${prefix}-dup@example.com`, secret: shared });
    const before = await db.authSession.count();
    const ambiguousLogin = await attempt(`${prefix}-dup@example.com`, shared);
    expect(ambiguousLogin.status).toBe(401);
    expect(await ambiguousLogin.json()).toMatchObject({
      error: { code: "AUTH_FAILED", message: "账号或密码错误" },
    });
    expect(await db.authSession.count()).toBe(before);
    expect(dupLegacy.id).not.toBe(dupEmail.id);
  });
  it("8. account-level limit covers username/email switch and case changes", async () => {
    const user = await seedUser({ email: `${prefix}-limit@example.com` });
    for (let index = 0; index < 5; index++) {
      expect((await attempt(user.username, "wrong-password")).status).toBe(401);
    }
    // 换成邮箱形式仍被同一账号桶拦截，不能靠切换标识继续猜密码。
    const byEmail = await attempt(user.email!, "wrong-password");
    expect(byEmail.status).toBe(429);
    expect(Number(byEmail.headers.get("Retry-After"))).toBeGreaterThan(0);
    const upperCase = await attempt(user.username.toUpperCase(), user.password);
    expect(upperCase.status).toBe(429);
  });
  it("9. register -> mock mail -> verify -> email login closes the loop", async () => {
    const name = `${prefix}-loop`;
    const email = `${prefix}-loop@example.com`;
    expect(
      (
        await register(
          req("/api/auth/register", { username: name, email, password, confirmPassword: password }),
        )
      ).status,
    ).toBe(201);
    const message = mockMail.mock.calls.at(-1)?.[0] as AccountMail;
    expect(message.text).toContain("https://project.example.com/verify-email?token=");
    const token = mailToken();
    expect((await attempt(name, password)).status).toBe(403);
    expect((await attempt(email, password)).status).toBe(403);
    expect((await verify(req("/api/auth/verify-email", { token }))).status).toBe(200);
    const emailLogin = await attempt(email, password);
    expect(emailLogin.status).toBe(200);
    const usernameLogin = await attempt(name, password);
    expect(usernameLogin.status).toBe(200);
    expect((await usernameLogin.json()).user.id).toBe((await emailLogin.json()).user.id);
  });
  it("10. links are purpose-bound, single-use, expire and are superseded by resend", async () => {
    const user = await seedUser({ email: `${prefix}-links@example.com`, verified: false });
    await resend(req("/api/auth/resend-verification", { email: user.email }));
    const firstToken = mailToken();
    await resend(req("/api/auth/resend-verification", { email: user.email }));
    const secondToken = mailToken();
    expect(secondToken).not.toBe(firstToken);
    expect((await verify(req("/api/auth/verify-email", { token: firstToken }))).status).toBe(422);
    expect((await verify(req("/api/auth/verify-email", { token: secondToken }))).status).toBe(200);
    expect((await verify(req("/api/auth/verify-email", { token: secondToken }))).status).toBe(422);

    await forgot(req("/api/auth/forgot-password", { email: user.email }));
    const resetToken = mailToken();
    // 重置 token 不能用于验证邮箱；验证 token 也不能用于重置密码。
    expect((await verify(req("/api/auth/verify-email", { token: resetToken }))).status).toBe(422);
    const newPassword = "another correct long password";
    expect(
      (
        await reset(
          req("/api/auth/reset-password", { token: resetToken, password: newPassword, confirmPassword: newPassword }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await reset(
          req("/api/auth/reset-password", { token: resetToken, password: newPassword, confirmPassword: newPassword }),
        )
      ).status,
    ).toBe(422);
    // 过期 token：即使未使用也不能通过。
    const expiringUser = await seedUser({ email: `${prefix}-expiring@example.com`, verified: false });
    await resend(req("/api/auth/resend-verification", { email: expiringUser.email }));
    const expiring = mailToken();
    await db.accountToken.update({
      where: { tokenHash: hashToken(expiring) },
      data: { expiresAt: new Date(0) },
    });
    expect((await verify(req("/api/auth/verify-email", { token: expiring }))).status).toBe(422);
  });
  it("11. password reset revokes old sessions and old password for both identifiers", async () => {
    const user = await seedUser({ email: `${prefix}-reset@example.com` });
    const loginByUsername = await attempt(user.username, user.password);
    expect(loginByUsername.status).toBe(200);
    const oldToken = (await loginByUsername.json()).accessToken as string;
    await forgot(req("/api/auth/forgot-password", { email: user.email }));
    const resetToken = mailToken();
    const newPassword = "my changed long password";
    expect(
      (
        await reset(
          req("/api/auth/reset-password", { token: resetToken, password: newPassword, confirmPassword: newPassword }),
        )
      ).status,
    ).toBe(200);
    const oldSession = await me(
      new Request("http://localhost/api/auth/me", { headers: bearer(oldToken) }),
    );
    expect(oldSession.status).toBe(401);
    expect((await attempt(user.username, user.password)).status).toBe(401);
    expect((await attempt(user.email!, user.password)).status).toBe(401);
    expect((await attempt(user.email!, newPassword)).status).toBe(200);
    expect((await attempt(user.username, newPassword)).status).toBe(200);
  });
  it("12. mail unavailable and delivery failure never create a usable session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_PASSWORD", "");
    const name = `${prefix}-nomail`;
    expect(
      (
        await register(
          req("/api/auth/register", {
            username: name,
            email: `${prefix}-nomail@example.com`,
            password,
            confirmPassword: password,
          }),
        )
      ).status,
    ).toBe(503);
    expect(await db.user.count({ where: { username: name } })).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    beforeEachMailEnv();
    mockMail.mockRejectedValueOnce(new AppError("ACCOUNT_MAIL_FAILED", "验证邮件暂时无法发出", 503));
    const failedName = `${prefix}-failmail`;
    expect(
      (
        await register(
          req("/api/auth/register", {
            username: failedName,
            email: `${prefix}-failmail@example.com`,
            password,
            confirmPassword: password,
          }),
        )
      ).status,
    ).toBe(503);
    const retryable = await db.user.findUniqueOrThrow({
      where: { username: failedName },
      include: { sessions: true, accountTokens: true },
    });
    expect(retryable.sessions).toHaveLength(0);
    expect(retryable.accountTokens.every((token) => token.usedAt !== null)).toBe(true);
    expect((await attempt(failedName, password)).status).toBe(403);
    expect(await db.authSession.count({ where: { userId: retryable.id } })).toBe(0);
  });
  it("13. login and mail requests cannot inject identity, role or email verification", async () => {
    const user = await seedUser({ email: `${prefix}-inject@example.com`, verified: false });
    const other = await seedUser({ email: `${prefix}-inject-other@example.com` });
    const injected = await attempt(user.username, user.password, {
      userId: other.id,
      role: "OWNER",
      emailVerified: true,
      email: other.email,
    });
    // 正确密码但邮箱未验证：仍按未验证处理；额外字段不能改变身份或验证状态。
    expect(injected.status).toBe(403);
    expect((await injected.json()).error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(await db.authSession.count({ where: { userId: user.id } })).toBe(0);
    expect(
      (
        await resend(
          req("/api/auth/resend-verification", {
            email: user.email,
            userId: other.id,
            role: "OWNER",
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await forgot(
          req("/api/auth/forgot-password", { email: user.email, userId: other.id }),
        )
      ).status,
    ).toBe(422);
    expect(mockMail).not.toHaveBeenCalled();
    const stored = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { security: true },
    });
    expect(stored.security?.emailVerifiedAt).toBeNull();
    expect(stored.security?.email).toBe(user.email);
    expect(await verifyPassword(user.password, stored.passwordHash)).toBe(true);
  });
});

function beforeEachMailEnv() {
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_USER", "test");
  vi.stubEnv("SMTP_PASSWORD", "not-a-real-credential");
  vi.stubEnv("SMTP_FROM", "忆程 <noreply@example.com>");
  vi.stubEnv("AUTH_PUBLIC_BASE_URL", "https://project.example.com");
}
