import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getSessionUser, hasProjectAccess, SESSION_COOKIE } from "@/lib/auth/serverSession";

const REDIRECT_SENTINEL = "NEXT_REDIRECT";
const NOT_FOUND_SENTINEL = "NEXT_NOT_FOUND";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw Object.assign(new Error(`redirect:${target}`), { digest: REDIRECT_SENTINEL });
  },
  notFound: () => {
    throw Object.assign(new Error("notFound"), { digest: NOT_FOUND_SENTINEL });
  },
}));

function setSessionCookie(token: string) {
  jar.set(SESSION_COOKIE, encodeURIComponent(token));
}

describe("服务端页面鉴权与项目归属", () => {
  let owner = "";
  let stranger = "";
  let projectId = "";

  beforeEach(async () => {
    const passwordHash = await hashPassword("page-auth-password");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const ownerUser = await db.user.create({
      data: { username: `page-owner-${suffix}`, displayName: "页面归属用户", passwordHash },
    });
    const strangerUser = await db.user.create({
      data: { username: `page-stranger-${suffix}`, displayName: "无关用户", passwordHash },
    });
    owner = ownerUser.id;
    stranger = strangerUser.id;

    const project = await db.project.create({
      data: { title: "页面鉴权测试项目", description: "用于验证服务端页面归属校验", goal: "验证越权访问被拦截", scenario: "RESEARCH" },
    });
    projectId = project.id;

    await db.projectMembership.create({ data: { userId: owner, projectId, role: "OWNER" } });
  });

  afterEach(async () => {
    jar.clear();
    vi.unstubAllEnvs();
    await db.project.delete({ where: { id: projectId } }).catch(() => {});
    for (const id of [owner, stranger]) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("无 Cookie 时恢复不出会话用户", async () => {
    expect(await getSessionUser()).toBeNull();
  });

  it("有效会话 Cookie 能恢复出用户", async () => {
    const { token } = await createSession(owner);
    setSessionCookie(token);

    const user = await getSessionUser();
    expect(user?.id).toBe(owner);
  });

  it("已撤销的会话 Cookie 不恢复用户", async () => {
    const { token, session } = await createSession(owner);
    await db.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    setSessionCookie(token);

    expect(await getSessionUser()).toBeNull();
  });

  it("归属校验区分项目所有者与无关用户", async () => {
    expect(await hasProjectAccess(owner, projectId)).toBe(true);
    expect(await hasProjectAccess(stranger, projectId)).toBe(false);
  });

  it("不存在的项目对任何人都不可访问", async () => {
    expect(await hasProjectAccess(owner, "no-such-project")).toBe(false);
  });

  it("匿名访问项目列表页被重定向到登录页", async () => {
    const { default: ProjectsPage } = await import("@/app/projects/page");

    await expect(ProjectsPage()).rejects.toMatchObject({ digest: REDIRECT_SENTINEL });
  });

  it("登录后项目列表页正常渲染", async () => {
    const { token } = await createSession(owner);
    setSessionCookie(token);
    const { default: ProjectsPage } = await import("@/app/projects/page");

    await expect(ProjectsPage()).resolves.toBeDefined();
  });

  it("无关用户访问项目详情页按 404 处理，而不是 403", async () => {
    const { token } = await createSession(stranger);
    setSessionCookie(token);
    const { default: ProjectDetailPage } = await import("@/app/projects/[id]/page");

    await expect(ProjectDetailPage({ params: Promise.resolve({ id: projectId }) }))
      .rejects.toMatchObject({ digest: NOT_FOUND_SENTINEL });
  });

  it("无关用户访问成果生成页按 404 处理", async () => {
    const { token } = await createSession(stranger);
    setSessionCookie(token);
    const { default: GeneratePage } = await import("@/app/projects/[id]/generate/page");

    await expect(GeneratePage({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({}) }))
      .rejects.toMatchObject({ digest: NOT_FOUND_SENTINEL });
  }, 15000);
});
