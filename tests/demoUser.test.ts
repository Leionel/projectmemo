import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { ensureDemoUser, isDemoUserEnabled } from "@/lib/auth/ensureDemoUser";

describe("演示账号初始化", () => {
  let demoUsername = "";
  let projectIds: string[] = [];

  beforeEach(async () => {
    demoUsername = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    vi.stubEnv("DEMO_USERNAME", demoUsername);
    vi.stubEnv("DEMO_DISPLAY_NAME", "测试演示账号");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of projectIds) {
      await db.project.delete({ where: { id } }).catch(() => {});
    }
    projectIds = [];
    const user = await db.user.findUnique({ where: { username: demoUsername } });
    if (user) {
      await db.projectMembership.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  async function createProject(title: string) {
    const project = await db.project.create({
      data: { title, description: "演示账号测试项目", goal: "验证不会自动授权", scenario: "COMPETITION" },
    });
    projectIds.push(project.id);
    return project.id;
  }

  async function membershipCount() {
    const user = await db.user.findUnique({ where: { username: demoUsername } });
    if (!user) return 0;
    return db.projectMembership.count({ where: { userId: user.id } });
  }

  it("生产环境未显式开启时不初始化任何账号", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DEMO_USER_ENABLED;

    expect(isDemoUserEnabled()).toBe(false);
    expect(await ensureDemoUser()).toBeNull();
    expect(await db.user.findUnique({ where: { username: demoUsername } })).toBeNull();
  });

  it("生产环境显式开启但缺少口令时拒绝使用内置默认密码", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_USER_ENABLED", "true");
    delete process.env.DEMO_PASSWORD;
    delete process.env.DEMO_PASSWORD_HASH;

    expect(await ensureDemoUser()).toBeNull();
    expect(await db.user.findUnique({ where: { username: demoUsername } })).toBeNull();
  });

  it("缺少 DEMO_PROJECT_ID 时不再自动绑定库里最早的项目", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.DEMO_PROJECT_ID;
    await createProject("较早创建的真实项目");
    await createProject("较晚创建的真实项目");

    const result = await ensureDemoUser();

    expect(result?.user.username).toBe(demoUsername);
    expect(result?.projectId).toBeUndefined();
    expect(await membershipCount()).toBe(0);
  });

  it("显式指定 DEMO_PROJECT_ID 时只绑定该项目", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const earliest = await createProject("较早创建的真实项目");
    const designated = await createProject("指定隔离演示项目");
    vi.stubEnv("DEMO_PROJECT_ID", designated);

    const result = await ensureDemoUser();

    expect(result?.projectId).toBe(designated);
    expect(result?.projectId).not.toBe(earliest);
    const memberships = await db.projectMembership.findMany({
      where: { projectId: { in: projectIds }, user: { username: demoUsername } },
      select: { projectId: true, role: true },
    });
    expect(memberships).toEqual([{ projectId: designated, role: "OWNER" }]);
  });

  it("指定的项目不存在时不建立任何归属", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_PROJECT_ID", "no-such-project");

    const result = await ensureDemoUser();

    expect(result?.user.username).toBe(demoUsername);
    expect(await membershipCount()).toBe(0);
  });

  it("重复初始化保持幂等，不产生重复账号或归属", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const designated = await createProject("指定隔离演示项目");
    vi.stubEnv("DEMO_PROJECT_ID", designated);

    await ensureDemoUser();
    await ensureDemoUser();

    expect(await db.user.count({ where: { username: demoUsername } })).toBe(1);
    expect(await membershipCount()).toBe(1);
  });
});
