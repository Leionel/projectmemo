import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { GET as settingsGet, POST as settingsPost } from "@/app/api/settings/route";
import { POST as probePost } from "@/app/api/settings/probe/route";

const TRACKED_ENV = ["LLM_MODE", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL_NAME"] as const;

describe("模型设置与探针鉴权", () => {
  let userId = "";
  let token = "";
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(async () => {
    envSnapshot = {};
    for (const key of TRACKED_ENV) envSnapshot[key] = process.env[key];

    const passwordHash = await hashPassword("settings-auth-password");
    const user = await db.user.create({
      data: {
        username: `settings-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        displayName: "设置鉴权用户",
        passwordHash,
      },
    });
    userId = user.id;
    ({ token } = await createSession(userId));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const key of TRACKED_ENV) {
      if (envSnapshot[key] === undefined) delete process.env[key];
      else process.env[key] = envSnapshot[key];
    }
    await db.authSession.deleteMany({ where: { userId } }).catch(() => {});
    await db.user.delete({ where: { id: userId } }).catch(() => {});
  });

  function authed(url: string, init: RequestInit = {}) {
    return new Request(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }

  it("开发模式下未登录不能写运行时设置", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await settingsPost(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmMode: "mock" }),
    }));

    expect(response.status).toBe(401);
  });

  it("开发模式下登录用户可以写运行时设置", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await settingsPost(authed("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmMode: "mock" }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).editable).toBe(true);
  });

  it("生产环境即使登录也拒绝运行时写配置", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await settingsPost(authed("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmMode: "mock" }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("SETTINGS_READ_ONLY");
  });

  it("生产环境不再凭 Host 头放行本地请求", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await settingsPost(authed("http://127.0.0.1/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmMode: "mock" }),
    }));

    expect(response.status).toBe(403);
  });

  it("设置读取对匿名访客保持可用，但不报告可编辑", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await settingsGet(new Request("http://localhost/api/settings"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.editable).toBe(false);
    expect(body.apiKeyMasked).toBe(body.hasApiKey ? "••••••" : "");
  });

  it("登录后的设置读取在开发模式下报告可编辑", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await settingsGet(authed("http://localhost/api/settings"));

    expect(response.status).toBe(200);
    expect((await response.json()).editable).toBe(true);
  });

  it("生产环境匿名读取设置不下发 provider 细节", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LLM_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("LLM_MODEL_NAME", "deepseek-flash");
    vi.stubEnv("LLM_API_KEY", "sk-should-not-be-disclosed");

    const response = await settingsGet(new Request("http://localhost/api/settings"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ llmMode: "mock", editable: false });
    expect(body.llmBaseUrl).toBeUndefined();
    expect(body.llmModelName).toBeUndefined();
    expect(body.hasApiKey).toBeUndefined();
  });

  it("生产环境登录用户仍可读到 provider 细节，但仍不可编辑", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LLM_MODEL_NAME", "deepseek-flash");

    const response = await settingsGet(authed("http://localhost/api/settings"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.editable).toBe(false);
    expect(body.llmModelName).toBe("deepseek-flash");
  });

  it("未登录不能调用连通性探针", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await probePost(new Request("http://localhost/api/settings/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmBaseUrl: "http://169.254.169.254/latest/meta-data" }),
    }));

    expect(response.status).toBe(401);
  });

  it("生产环境探针仍然禁用", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await probePost(authed("http://localhost/api/settings/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(403);
  });
});
