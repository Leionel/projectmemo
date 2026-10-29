import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/api";
import { createMission } from "@/lib/mission/missionService";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import { reserveCloudCall } from "@/lib/auth/cloudQuota";
import { sendAccountMail, type AccountMail } from "@/lib/auth/mail";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as verify } from "@/app/api/auth/verify-email/route";
import { POST as resend } from "@/app/api/auth/resend-verification/route";
import { POST as forgot } from "@/app/api/auth/forgot-password/route";
import { POST as reset } from "@/app/api/auth/reset-password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as projects } from "@/app/api/projects/route";
import { GET as project } from "@/app/api/projects/[id]/route";
import {
  GET as actions,
  POST as createAction,
} from "@/app/api/projects/[id]/actions/route";
import {
  GET as artifacts,
  POST as createArtifact,
} from "@/app/api/projects/[id]/artifacts/route";
import { GET as search } from "@/app/api/projects/[id]/cards/search/route";
import { PATCH as editCard } from "@/app/api/projects/[id]/cards/[cardId]/route";
import { GET as missions } from "@/app/api/missions/route";
import { GET as mission } from "@/app/api/missions/[id]/route";
import { POST as captures } from "@/app/api/projects/[id]/captures/route";
import { chatWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { getEmbedding } from "@/lib/memory/embedding";

vi.mock("@/lib/auth/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/mail")>()),
  sendAccountMail: vi.fn(async () => undefined),
}));
const prefix = "signup-" + Date.now();
let counter = 0;
let name = "",
  email = "",
  ip = "";
const password = "a correct long password";
const mockMail = vi.mocked(sendAccountMail);
function req(
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": ip,
      ...headers,
    },
    body: JSON.stringify(data),
  });
}
function signup(overrides: Record<string, unknown> = {}) {
  return register(
    req("/api/auth/register", {
      username: name,
      email,
      password,
      confirmPassword: password,
      ...overrides,
    }),
  );
}
function mailToken(index = -1) {
  const message = mockMail.mock.calls.at(index)?.[0] as AccountMail;
  return new URL(
    message.text.match(/http[^\s]+\?token=[a-f0-9]{64}/)![0],
  ).searchParams.get("token")!;
}
async function activated() {
  expect((await signup()).status).toBe(201);
  expect(
    (await verify(req("/api/auth/verify-email", { token: mailToken() })))
      .status,
  ).toBe(200);
  const res = await login(req("/api/auth/login", { username: name, password }));
  expect(res.status).toBe(200);
  return (await res.json()).accessToken as string;
}
const bearer = (token: string) => ({ Authorization: "Bearer " + token });

beforeEach(() => {
  counter++;
  name = prefix + "-" + counter;
  email = name + "@example.com";
  ip = "signup-test-" + counter + "-" + prefix;
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
  await db.project.deleteMany({
    where: {
      memberships: { some: { user: { username: { startsWith: prefix } } } },
    },
  });
  await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
});

describe("Public account lifecycle", () => {
  it("requires verified email, stores only hashes and grants no projects or cloud budget", async () => {
    const response = await signup({
      username: name.toUpperCase(),
      email: email.toUpperCase(),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ verificationRequired: true });
    expect(response.headers.get("set-cookie")).toBeNull();
    const user = await db.user.findUniqueOrThrow({
      where: { username: name },
      include: {
        security: true,
        sessions: true,
        memberships: true,
        accountTokens: true,
      },
    });
    expect(await verifyPassword(password, user.passwordHash)).toBe(true);
    expect(user.passwordHash).not.toBe(password);
    expect(user.security).toMatchObject({
      email,
      emailVerifiedAt: null,
      dailyCloudLimit: 0,
    });
    expect(user.sessions).toHaveLength(0);
    expect(user.memberships).toHaveLength(0);
    expect(user.accountTokens[0].tokenHash).toBe(hashToken(mailToken()));
    expect(JSON.stringify(user)).not.toContain(mailToken());
    const denied = await login(
      req("/api/auth/login", { username: name, password }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect(mockMail.mock.calls[0][0].text).toContain(
      "https://project.example.com/verify-email?token=",
    );
  });
  it("verifies once, logs in through existing cookie/session and logs out server-side", async () => {
    const token = await activated();
    expect(
      (
        await projects(
          new Request("http://localhost/api/projects", {
            headers: bearer(token),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await projects(
          new Request("http://localhost/api/projects", {
            headers: bearer(token),
          }),
        )
      ).json(),
    ).resolves.toMatchObject({ projects: [] });
    expect(
      (await verify(req("/api/auth/verify-email", { token: mailToken() })))
        .status,
    ).toBe(422);
    expect(
      (await logout(req("/api/auth/logout", {}, bearer(token)))).status,
    ).toBe(200);
    expect(
      (
        await me(
          new Request("http://localhost/api/auth/me", {
            headers: bearer(token),
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("enforces password confirmation, account syntax, email validation and rejects injected roles", async () => {
    for (const value of [
      { confirmPassword: "different-password" },
      { password: "short", confirmPassword: "short" },
      { username: "bad/name" },
      { email: "not-an-email" },
      { role: "OWNER" },
    ])
      expect((await signup(value)).status).toBe(422);
    expect(await db.user.count({ where: { username: name } })).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });
  it("handles duplicate account races and email reuse without extra sessions or memberships", async () => {
    const results = await Promise.all([signup(), signup()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect((await signup({ username: name + "x" })).status).toBe(409);
    expect(
      await db.user.count({ where: { username: { startsWith: name } } }),
    ).toBe(1);
  });
  it("keeps configured and default demo account names reserved", async () => {
    vi.stubEnv("DEMO_USERNAME", "special-demo");
    expect((await signup({ username: "contest-demo" })).status).toBe(409);
    expect((await signup({ username: "special-demo" })).status).toBe(409);
    expect(mockMail).not.toHaveBeenCalled();
  });
  it("expires verification links and invalidates the previous link when resending", async () => {
    await signup();
    const old = mailToken();
    await db.accountToken.update({
      where: { tokenHash: hashToken(old) },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await verify(req("/api/auth/verify-email", { token: old }))).status,
    ).toBe(422);
    expect(
      (await resend(req("/api/auth/resend-verification", { email }))).status,
    ).toBe(200);
    const current = mailToken();
    expect(current).not.toBe(old);
    expect(
      (await verify(req("/api/auth/verify-email", { token: current }))).status,
    ).toBe(200);
  });
  it("resets password with a single-use purpose-bound token and revokes every old session", async () => {
    const oldSession = await activated();
    await forgot(req("/api/auth/forgot-password", { email }));
    const token = mailToken();
    expect(
      (await verify(req("/api/auth/verify-email", { token }))).status,
    ).toBe(422);
    const newPassword = "my changed long password";
    const change = {
      token,
      password: newPassword,
      confirmPassword: newPassword,
    };
    expect((await reset(req("/api/auth/reset-password", change))).status).toBe(
      200,
    );
    expect((await reset(req("/api/auth/reset-password", change))).status).toBe(
      422,
    );
    expect(
      (
        await me(
          new Request("http://localhost/api/auth/me", {
            headers: bearer(oldSession),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await login(req("/api/auth/login", { username: name, password })))
        .status,
    ).toBe(401);
    expect(
      (
        await login(
          req("/api/auth/login", { username: name, password: newPassword }),
        )
      ).status,
    ).toBe(200);
  });
  it("does not disclose whether a recovery email exists and does not send to unknown addresses", async () => {
    await activated();
    const known = await forgot(req("/api/auth/forgot-password", { email }));
    const unknown = await forgot(
      req("/api/auth/forgot-password", { email: "unknown-" + email }),
    );
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    expect(mockMail).toHaveBeenCalledTimes(2);
  });
  it("fails closed without SMTP in production and never creates an unverified session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_PASSWORD", "");
    expect((await signup()).status).toBe(503);
    expect(
      (await forgot(req("/api/auth/forgot-password", { email }))).status,
    ).toBe(503);
    expect(await db.user.count({ where: { username: name } })).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });
  it("reports delivery failure and leaves a retryable account with no usable verification token or session", async () => {
    mockMail.mockRejectedValueOnce(
      new AppError("ACCOUNT_MAIL_FAILED", "验证邮件暂时无法发出", 503),
    );
    expect((await signup()).status).toBe(503);
    const user = await db.user.findUniqueOrThrow({
      where: { username: name },
      include: { accountTokens: true, sessions: true },
    });
    expect(user.accountTokens.every((t) => t.usedAt !== null)).toBe(true);
    expect(user.sessions).toHaveLength(0);
    expect(
      (await resend(req("/api/auth/resend-verification", { email }))).status,
    ).toBe(200);
    expect(
      (await verify(req("/api/auth/verify-email", { token: mailToken() })))
        .status,
    ).toBe(200);
  });
  it("limits rotating usernames by source, including malformed requests, and sets Retry-After", async () => {
    for (let i = 0; i < 5; i++)
      expect((await signup({ username: "invalid/name-" + i })).status).toBe(
        422,
      );
    const blocked = await signup({ username: name + "-rotated" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("rejects cross-origin and oversized bodies before creating users", async () => {
    expect(
      (
        await register(
          req("/api/auth/register", {}, { Origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await register(req("/api/auth/register", { blob: "x".repeat(5000) })))
        .status,
    ).toBe(413);
    expect(mockMail).not.toHaveBeenCalled();
  });
  it("prevents cross-user project, memory, action, mission and artifact reads and writes", async () => {
    const token = await activated();
    const otherUser = await db.user.create({
      data: {
        username: name + "-owner",
        displayName: "另一个用户",
        passwordHash: "not-for-login",
      },
    });
    const other = await db.project.create({
      data: {
        title: "Other private project",
        description: "secret",
        goal: "private",
        scenario: "RESEARCH",
        memberships: { create: { userId: otherUser.id, role: "OWNER" } },
      },
    });
    vi.stubEnv("MISSION_ENABLED", "true");
    const privateMission = await createMission(otherUser.id, {
      projectId: other.id,
      requestId: "isolation-" + other.id,
      goal: "保密的项目阶段汇报",
      successCriteria: ["DRAFT_EXISTS"],
    });
    try {
      const context = { params: Promise.resolve({ id: other.id }) };
      const getReq = () =>
        new Request("http://localhost/api/projects/" + other.id, {
          headers: bearer(token),
        });
      for (const handler of [project, actions, artifacts])
        expect((await handler(getReq(), context)).status).toBe(404);
      expect(
        (
          await search(
            new NextRequest(
              "http://localhost/api/projects/" +
                other.id +
                "/cards/search?q=secret",
              { headers: bearer(token) },
            ),
            context,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await missions(
            new Request("http://localhost/api/missions?projectId=" + other.id, {
              headers: bearer(token),
            }),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await mission(getReq(), {
            params: Promise.resolve({ id: privateMission.id }),
          })
        ).status,
      ).toBe(404);
      for (const handler of [createAction, createArtifact, captures])
        expect(
          (
            await handler(
              req("/api/projects/" + other.id, {}, bearer(token)),
              context,
            )
          ).status,
        ).toBe(404);
      expect(
        (
          await editCard(req("/api/projects/" + other.id, {}, bearer(token)), {
            params: Promise.resolve({ id: other.id, cardId: "other-card" }),
          })
        ).status,
      ).toBe(404);
    } finally {
      await db.project.delete({ where: { id: other.id } });
    }
  });
  it("blocks all paid chat/embedding calls by default and atomically enforces a provisioned daily limit", async () => {
    const accountToken = await activated();
    const user = await db.user.findUniqueOrThrow({ where: { username: name } });
    const p = await db.project.create({
      data: {
        title: "Quota test",
        description: "",
        goal: "",
        scenario: "RESEARCH",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("should not reach provider"));
    try {
      vi.stubEnv("LLM_MODE", "openai-compatible");
      vi.stubEnv("LLM_API_KEY", "test-key");
      vi.stubEnv("EMBEDDING_BASE_URL", "https://api.example.com/v1");
      vi.stubEnv("EMBEDDING_MODEL_NAME", "test-embedding");
      vi.stubEnv("EMBEDDING_API_KEY", "test-key");
      await expect(chatWithLLMWithMeta("test", p.id)).rejects.toMatchObject({
        code: "CLOUD_ACCESS_DISABLED",
      });
      const embedding = await getEmbedding("test", p.id);
      expect(embedding.isMock).toBe(true);
      expect(embedding.fallbackReason).toContain("云模型额度");
      expect(fetchSpy).not.toHaveBeenCalled();
      const capture = await captures(
        req(
          "/api/projects/" + p.id + "/captures",
          { rawText: "测试记录：今天已完成需求整理。", sourceType: "TEXT" },
          bearer(accountToken),
        ),
        { params: Promise.resolve({ id: p.id }) },
      );
      expect(capture.status).toBe(201);
      expect(fetchSpy).not.toHaveBeenCalled();
      await db.accountSecurity.update({
        where: { userId: user.id },
        data: { dailyCloudLimit: 1 },
      });
      const reservations = await Promise.allSettled([
        reserveCloudCall(p.id),
        reserveCloudCall(p.id),
      ]);
      expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(reservations.filter((r) => r.status === "rejected")).toHaveLength(
        1,
      );
      expect(
        (await db.accountCloudUsage.findMany({ where: { userId: user.id } }))[0]
          .used,
      ).toBe(1);
    } finally {
      fetchSpy.mockRestore();
      await db.project.delete({ where: { id: p.id } });
    }
  });
});
