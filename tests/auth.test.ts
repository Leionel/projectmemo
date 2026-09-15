import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as projectDetailRoute } from "@/app/api/projects/[id]/route";
import { POST as captureRoute } from "@/app/api/projects/[id]/captures/route";
import { POST as xiaoyiMemoryRoute } from "@/app/xiaoyi/v1/memories/route";

describe("Authentication & Project Authorization Suite", () => {
  const testUsername = `user-${Date.now()}`;
  const testPassword = "securePassword123!";
  let testUserId = "";
  let ownedProjectId = "";
  let otherProjectId = "";

  beforeEach(async () => {
    // 创建测试用户
    const passwordHash = await hashPassword(testPassword);
    const user = await db.user.create({
      data: {
        username: testUsername,
        displayName: "测试员",
        passwordHash,
      },
    });
    testUserId = user.id;

    // 创建测试项目 A（属于该用户）
    const projectA = await db.project.create({
      data: {
        title: "用户A拥有的项目",
        description: "用于测试授权访问",
        goal: "完成复赛",
        scenario: "COMPETITION",
      },
    });
    ownedProjectId = projectA.id;

    await db.projectMembership.create({
      data: {
        userId: testUserId,
        projectId: ownedProjectId,
        role: "OWNER",
      },
    });

    // 创建测试项目 B（其他项目，该用户无权限）
    const projectB = await db.project.create({
      data: {
        title: "未授权项目",
        description: "该用户无权访问",
        goal: "机密",
        scenario: "RESEARCH",
      },
    });
    otherProjectId = projectB.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // 清理创建的数据
    if (testUserId) {
      await db.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
    if (ownedProjectId) {
      await db.project.delete({ where: { id: ownedProjectId } }).catch(() => {});
    }
    if (otherProjectId) {
      await db.project.delete({ where: { id: otherProjectId } }).catch(() => {});
    }
  });

  it("1. 正确用户名和密码登录成功，生成会话并返回项目", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        client: "harmony",
      }),
    });

    const response = await loginRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.user.username).toBe(testUsername);
    expect(data.accessToken).toBeDefined();
    expect(typeof data.accessToken).toBe("string");
    expect(data.accessToken.length).toBe(64); // 32字节 hex
    expect(data.expiresAt).toBeDefined();
    expect(Array.isArray(data.projects)).toBe(true);
    expect(data.projects.some((p: { id: string }) => p.id === ownedProjectId)).toBe(true);

    // 严禁泄露内部密码或哈希
    expect(data.user.passwordHash).toBeUndefined();
    expect(data.user.password).toBeUndefined();
  });

  it("2. 错误密码统一返回 401 并保护账号隐私", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: testUsername,
        password: "WrongPassword!",
      }),
    });

    const response = await loginRoute(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toBe("账号或密码错误");
  });

  it("3. 空用户名或密码校验失败返回 422", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "",
        password: "",
      }),
    });

    const response = await loginRoute(request);
    expect(response.status).toBe(422);
  });

  it("4. /api/auth/me 能正确读取当前用户与项目", async () => {
    const { token } = await createSession(testUserId);

    const request = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await meRoute(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user.id).toBe(testUserId);
    expect(data.user.username).toBe(testUsername);
    expect(data.projects.some((p: { id: string }) => p.id === ownedProjectId)).toBe(true);
  });

  it("5. 过期 Token 访问返回 401", async () => {
    // 创建一个已过期的 session
    const { token, session } = await createSession(testUserId);
    await db.authSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const request = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await meRoute(request);
    expect(response.status).toBe(401);
  });

  it("6. 撤销的 Token 访问返回 401", async () => {
    const { token, session } = await createSession(testUserId);
    await db.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const request = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await meRoute(request);
    expect(response.status).toBe(401);
  });

  it("7. 登出接口幂等且成功撤销会话", async () => {
    const { token } = await createSession(testUserId);

    const logoutReq = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const res1 = await logoutRoute(logoutReq);
    expect(res1.status).toBe(200);

    // 重复登出保持幂等
    const res2 = await logoutRoute(logoutReq);
    expect(res2.status).toBe(200);

    // 撤销后访问受限路由应为 401
    const meReq = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const res3 = await meRoute(meReq);
    expect(res3.status).toBe(401);
  });

  it("8. 未登录（无 Token）访问项目 API 返回 401", async () => {
    const request = new Request(`http://localhost/api/projects/${ownedProjectId}`, {
      method: "GET",
    });

    const response = await projectDetailRoute(request, {
      params: Promise.resolve({ id: ownedProjectId }),
    });

    expect(response.status).toBe(401);
  });

  it("9. 已登录但无项目权限访问返回 403", async () => {
    const { token } = await createSession(testUserId);

    const request = new Request(`http://localhost/api/projects/${otherProjectId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await projectDetailRoute(request, {
      params: Promise.resolve({ id: otherProjectId }),
    });

    expect(response.status).toBe(403);
  });

  it("10. 已登录且拥有权限可以成功访问项目及其子路由", async () => {
    const { token } = await createSession(testUserId);

    const request = new Request(`http://localhost/api/projects/${ownedProjectId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await projectDetailRoute(request, {
      params: Promise.resolve({ id: ownedProjectId }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.project.id).toBe(ownedProjectId);
  });

  it("11. 修改 URL 中的 projectId 无法越权写入（拒绝跨项目写入）", async () => {
    const { token } = await createSession(testUserId);

    const request = new Request(`http://localhost/api/projects/${otherProjectId}/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rawText: "尝试越权写入",
      }),
    });

    const response = await captureRoute(request, {
      params: Promise.resolve({ id: otherProjectId }),
    });

    expect(response.status).toBe(403);
  });

  it("12. 登录失败限流器正常生效", async () => {
    const failIp = "192.0.2.100";
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Real-IP": failIp,
        },
        body: JSON.stringify({
          username: testUsername,
          password: "bad-password",
        }),
      });
      await loginRoute(req);
    }

    // 第 6 次应被限流 (429)
    const reqBlocked = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Real-IP": failIp,
      },
      body: JSON.stringify({
        username: testUsername,
        password: "bad-password",
      }),
    });
    const res = await loginRoute(reqBlocked);
    expect(res.status).toBe(429);
  });

  it("13. 小艺 Bearer Token 独立鉴权不受用户登录改动影响", async () => {
    vi.stubEnv("XIAOYI_ENABLED", "true");
    vi.stubEnv("XIAOYI_ADAPTER_ENABLED", "true");
    vi.stubEnv("XIAOYI_ADAPTER_TOKEN", "a-very-long-token-for-xiaoyi-test-1234567890");
    vi.stubEnv("XIAOYI_TEST_PROJECT_ID", ownedProjectId);

    const request = new Request("http://localhost/xiaoyi/v1/memories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer a-very-long-token-for-xiaoyi-test-1234567890",
        "idempotency-key": `req-${Date.now()}`,
      },
      body: JSON.stringify({
        content: "小艺语音采集记录测试",
        source_type: "xiaoyi-workflow",
      }),
    });

    const response = await xiaoyiMemoryRoute(request);
    expect(response.status).toBe(201);
  });
});
