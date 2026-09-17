import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/serverSession";
import { archiveProject, createProject } from "@/lib/repositories/projects";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw Object.assign(new Error(`redirect:${target}`), { digest: "NEXT_REDIRECT" });
  },
  notFound: () => {
    throw Object.assign(new Error("notFound"), { digest: "NEXT_NOT_FOUND" });
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

type TreeNode = { type: unknown; props: Record<string, unknown> };

/**
 * 收集 RSC 返回的元素树里指定组件的 props。
 * 项目列表页没有 DOM 测试环境，这里直接对元素树断言，
 * 避免为了一个展示层分组断言引入新的组件测试基础设施。
 */
function collect(node: unknown, matches: (type: unknown) => boolean, found: TreeNode[] = []): TreeNode[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, matches, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;

  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type && matches(element.type)) {
    found.push({ type: element.type, props: element.props ?? {} });
  }
  if (element.props) {
    for (const value of Object.values(element.props)) collect(value, matches, found);
  }
  return found;
}

function typeName(type: unknown): string {
  if (typeof type === "function") return (type as { name?: string }).name ?? "";
  return "";
}

/**
 * 主页（/projects）必须把在册与已归档项目分开呈现。
 * 这守住的不变量是：归档项目不会混进主列表继续占用"需要关注"的排序位置，
 * 但也必须仍然可达 —— 归档不是隐藏，更不是删除。
 */
describe("项目列表页的归档分组", () => {
  const createdProjectIds: string[] = [];
  let userId = "";

  beforeEach(async () => {
    const passwordHash = await hashPassword("projects-page-password");
    const user = await db.user.create({
      data: { username: `projects-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, displayName: "列表页用户", passwordHash },
    });
    userId = user.id;
  });

  afterEach(async () => {
    jar.clear();
    for (const id of createdProjectIds.splice(0)) {
      await db.project.delete({ where: { id } }).catch(() => {});
    }
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
  });

  async function ownedProject(title: string) {
    const project = await createProject({
      title,
      description: `${title}：用于验证列表页的归档分组呈现。`,
      goal: "验证归档分组",
      scenario: "COMPETITION",
      deadline: null,
    });
    createdProjectIds.push(project.id);
    await db.projectMembership.create({ data: { userId, projectId: project.id, role: "OWNER" } });
    return project;
  }

  async function renderProjectsPage() {
    const { token } = await createSession(userId);
    jar.set(SESSION_COOKIE, encodeURIComponent(token));
    const { default: ProjectsPage } = await import("@/app/projects/page");
    return ProjectsPage();
  }

  it("在册项目进主列表，已归档项目进已归档分区且不在主列表", async () => {
    const active = await ownedProject("在册项目");
    const archived = await ownedProject("已归档项目");
    await archiveProject(archived.id);

    const tree = await renderProjectsPage();

    const lists = collect(tree, (type) => typeName(type) === "ProjectList");
    expect(lists).toHaveLength(1);
    const listedIds = (lists[0].props.projects as Array<{ id: string }>).map((item) => item.id);
    expect(listedIds).toContain(active.id);
    expect(listedIds).not.toContain(archived.id);

    const cards = collect(tree, (type) => typeName(type) === "ProjectCard");
    expect(cards.map((card) => (card.props.project as { id: string }).id)).toEqual([archived.id]);
  });

  it("没有归档项目时不渲染已归档分区", async () => {
    await ownedProject("唯一在册项目");

    const tree = await renderProjectsPage();

    expect(collect(tree, (type) => typeName(type) === "ProjectCard")).toHaveLength(0);
  });

  it("归档项目卡片带有恢复入口所需的归档标记", async () => {
    const archived = await ownedProject("带标记的归档项目");
    await archiveProject(archived.id);

    const tree = await renderProjectsPage();

    const [card] = collect(tree, (type) => typeName(type) === "ProjectCard");
    expect((card.props.project as { archivedAt: unknown }).archivedAt).not.toBeNull();
  });
});