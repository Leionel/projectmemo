import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  archiveProject,
  createProject,
  deleteProject,
  listProjects,
  requireProject,
  restoreProject,
} from "@/lib/repositories/projects";
import { processCapture } from "@/lib/services/captureService";
import { saveArtifact } from "@/lib/repositories/artifacts";
import { GET as projectsRoute } from "@/app/api/projects/route";
import { POST as archiveRoute } from "@/app/api/projects/[id]/archive/route";
import { POST as restoreRoute } from "@/app/api/projects/[id]/restore/route";
import { DELETE as deleteRoute } from "@/app/api/projects/[id]/route";
import { createTestAuth } from "./testAuthHelper";

/**
 * 项目归档 / 恢复 / 删除。
 *
 * 这些用例守住的核心不变量：
 * 归档是「离开主列表」的可恢复偏好，不是删除——它不改变记忆时态、不删任何历史行，
 * 且归档项目必须仍然可以按 id 读取、恢复和删除。
 * 默认列表必须排除归档项目，否则跨项目聚合会继续把归档项目算进提醒与待办。
 */
describe("项目归档与删除", () => {
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];

  async function newProject(title: string) {
    const project = await createProject({
      title,
      description: `${title}：用于验证项目归档、恢复与删除的完整行为。`,
      goal: "验证生命周期不改变业务事实",
      scenario: "COMPETITION",
      deadline: null,
    });
    createdProjectIds.push(project.id);
    return project;
  }

  async function newOwner(projectId?: string) {
    const auth = await createTestAuth(projectId);
    createdUserIds.push(auth.user.id);
    return auth;
  }

  afterEach(async () => {
    for (const id of createdProjectIds.splice(0)) {
      await db.project.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdUserIds.splice(0)) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it("新建项目默认未归档，且出现在默认列表中", async () => {
    const auth = await newOwner();
    const project = await newProject("默认在册项目");
    await auth.bindProject(project.id);

    expect(project.archivedAt).toBeNull();

    const active = await listProjects(auth.user.id);
    expect(active.map((item) => item.id)).toContain(project.id);
  });

  it("归档后离开默认列表，只出现在 archived 列表里", async () => {
    const project = await newProject("待归档项目");
    const auth = await newOwner(project.id);

    const archived = await archiveProject(project.id);
    expect(archived.archivedAt).not.toBeNull();

    const active = await listProjects(auth.user.id);
    expect(active.map((item) => item.id)).not.toContain(project.id);

    const onlyArchived = await listProjects(auth.user.id, { archived: "only" });
    expect(onlyArchived.map((item) => item.id)).toContain(project.id);

    const included = await listProjects(auth.user.id, { archived: "include" });
    expect(included.map((item) => item.id)).toContain(project.id);
  });

  it("重复归档保持原 archivedAt，不刷新时间戳", async () => {
    const project = await newProject("幂等归档项目");

    const first = await archiveProject(project.id);
    const firstAt = first.archivedAt?.toISOString();
    expect(firstAt).toBeTruthy();

    // 拉开时间差，确保"没被刷新"不是因为两次调用落在同一毫秒
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await archiveProject(project.id);

    expect(second.archivedAt?.toISOString()).toBe(firstAt);
  });

  it("恢复清空 archivedAt 并回到默认列表，重复恢复保持空值", async () => {
    const project = await newProject("恢复项目");
    const auth = await newOwner(project.id);

    await archiveProject(project.id);
    const restored = await restoreProject(project.id);
    expect(restored.archivedAt).toBeNull();

    expect((await restoreProject(project.id)).archivedAt).toBeNull();
    expect((await listProjects(auth.user.id)).map((item) => item.id)).toContain(project.id);
    expect((await listProjects(auth.user.id, { archived: "only" })).map((item) => item.id)).not.toContain(project.id);
  });

  it("归档不改变任何业务事实：卡片、成果与详情都保持原样", async () => {
    const project = await newProject("事实不变项目");
    await processCapture(project.id, "需要记录一次对照实验并分析 baseline 准确率变化。", "实验记录");
    await saveArtifact(project.id, "readme", "归档前进度");

    const cardsBefore = await db.knowledgeCard.count({ where: { projectId: project.id } });
    const artifactsBefore = await db.generatedArtifact.count({ where: { projectId: project.id } });
    const capturesBefore = await db.capture.count({ where: { projectId: project.id } });
    expect(cardsBefore).toBeGreaterThan(0);

    await archiveProject(project.id);

    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(cardsBefore);
    expect(await db.generatedArtifact.count({ where: { projectId: project.id } })).toBe(artifactsBefore);
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(capturesBefore);
  });

  it("归档项目仍可按 id 读取，不做 404 隐藏", async () => {
    const project = await newProject("仍可读取项目");
    await archiveProject(project.id);

    const reread = await requireProject(project.id);
    expect(reread.id).toBe(project.id);
    expect(reread.archivedAt).not.toBeNull();
  });

  it("归档不触发项目状态重评，不产生新快照", async () => {
    const project = await newProject("不重评项目");
    await processCapture(project.id, "为状态快照准备一条可评估记录，包含风险与后续任务。", "任务安排");

    const snapshotsBefore = await db.projectStateSnapshot.count({ where: { projectId: project.id } });
    await archiveProject(project.id);
    await restoreProject(project.id);
    const snapshotsAfter = await db.projectStateSnapshot.count({ where: { projectId: project.id } });

    expect(snapshotsAfter).toBe(snapshotsBefore);
  });

  it("归档后的项目仍可删除，且级联清空项目资产", async () => {
    const project = await newProject("归档后删除项目");
    await processCapture(project.id, "这条记录应当随项目级联删除一起消失。", "任务安排");
    await archiveProject(project.id);

    await deleteProject(project.id);
    createdProjectIds.splice(createdProjectIds.indexOf(project.id), 1);

    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(0);
  });

  describe("HTTP 契约", () => {
    it("GET /api/projects 默认不含归档，archived=true 只含归档", async () => {
      const project = await newProject("接口归档项目");
      const auth = await newOwner(project.id);

      const before = await projectsRoute(new Request("http://localhost/api/projects", { headers: auth.headers }));
      expect(before.status).toBe(200);
      expect((await before.json()).projects.map((item: { id: string }) => item.id)).toContain(project.id);

      await archiveProject(project.id);

      const active = await projectsRoute(new Request("http://localhost/api/projects", { headers: auth.headers }));
      expect((await active.json()).projects.map((item: { id: string }) => item.id)).not.toContain(project.id);

      const archived = await projectsRoute(new Request("http://localhost/api/projects?archived=true", { headers: auth.headers }));
      const archivedIds = (await archived.json()).projects.map((item: { id: string }) => item.id);
      expect(archivedIds).toContain(project.id);
    });

    it("归档与恢复接口返回 archivedAt，且对无权限用户返回 404", async () => {
      const project = await newProject("接口生命周期项目");
      const auth = await newOwner(project.id);
      const context = { params: Promise.resolve({ id: project.id }) };

      const archived = await archiveRoute(
        new Request(`http://localhost/api/projects/${project.id}/archive`, { method: "POST", headers: auth.headers }),
        context,
      );
      expect(archived.status).toBe(200);
      expect((await archived.json()).project.archivedAt).toBeTruthy();

      const restored = await restoreRoute(
        new Request(`http://localhost/api/projects/${project.id}/restore`, { method: "POST", headers: auth.headers }),
        context,
      );
      expect(restored.status).toBe(200);
      expect((await restored.json()).project.archivedAt).toBeNull();

      const stranger = await newOwner();
      const denied = await archiveRoute(
        new Request(`http://localhost/api/projects/${project.id}/archive`, { method: "POST", headers: stranger.headers }),
        context,
      );
      expect(denied.status).toBe(404);
    });

    it("未登录不能归档项目", async () => {
      const project = await newProject("未登录归档项目");
      const response = await archiveRoute(
        new Request(`http://localhost/api/projects/${project.id}/archive`, { method: "POST" }),
        { params: Promise.resolve({ id: project.id }) },
      );

      expect(response.status).toBe(401);
    });

    it("归档项目仍可经 DELETE 删除", async () => {
      const project = await newProject("接口删除归档项目");
      const auth = await newOwner(project.id);
      await archiveProject(project.id);

      const response = await deleteRoute(
        new Request(`http://localhost/api/projects/${project.id}`, { method: "DELETE", headers: auth.headers }),
        { params: Promise.resolve({ id: project.id }) },
      );

      expect(response.status).toBe(204);
      createdProjectIds.splice(createdProjectIds.indexOf(project.id), 1);
      await expect(requireProject(project.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });
  });
});