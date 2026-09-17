import { db } from "@/lib/db";
import type { ProjectCreateInput, ProjectUpdateInput } from "@/lib/validation/schemas";
import type { ProjectScenario } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { buildProjectDashboard } from "@/lib/projectDashboard";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";

export interface ListProjectsOptions {
  /**
   * 归档项目默认不出现在主列表：它们不该继续占用"需要关注"的排序位置，
   * 也不该参与跨项目聚合（提醒 / 待办 / 卡片统计）。要看它们必须显式声明。
   */
  archived?: "exclude" | "include" | "only";
}

export async function listProjects(userId?: string, options: ListProjectsOptions = {}) {
  const archived = options.archived ?? "exclude";
  const archivedFilter =
    archived === "only" ? { archivedAt: { not: null } } : archived === "include" ? {} : { archivedAt: null };

  const projects = await db.project.findMany({
    where: {
      ...archivedFilter,
      ...(userId ? { memberships: { some: { userId } } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { cards: true, artifacts: true } },
      cards: { select: { type: true } },
      artifacts: { select: { artifactType: true } },
      actions: { select: { status: true, priority: true, dueAt: true, createdAt: true, completedAt: true, resultCardId: true, isSimulated: true } },
      interventions: { select: { status: true, severity: true, snoozedUntil: true, isSimulated: true, triggerType: true } },
    },
  });
  return projects.map(({ cards, artifacts, actions, interventions, ...project }) => ({
    ...project,
    dashboard: buildProjectDashboard({
      projectId: project.id,
      deadline: project.deadline,
      cards: cards.map((card) => ({ type: String(card.type) })),
      artifacts: artifacts.map((artifact) => ({ artifactType: String(artifact.artifactType) })),
      actions: actions.map((action) => ({ ...action, status: String(action.status) })),
      interventions: interventions.map((item) => ({ ...item, status: String(item.status), triggerType: String(item.triggerType) })),
    }),
  }));
}

export async function createProject(input: ProjectCreateInput) {
  return db.project.create({
    data: {
      title: input.title,
      description: input.description,
      goal: input.goal,
      scenario: input.scenario as ProjectScenario,
      deadline: input.deadline ? new Date(`${input.deadline}T23:59:59`) : null,
    },
  });
}

export async function updateProject(projectId: string, input: ProjectUpdateInput) {
  await requireProject(projectId);
  const updated = await db.project.update({
    where: { id: projectId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.scenario !== undefined ? { scenario: input.scenario as ProjectScenario } : {}),
      ...(input.deadline !== undefined
        ? { deadline: input.deadline ? new Date(`${input.deadline}T23:59:59`) : null }
        : {}),
    },
  });
  const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
  return { ...updated, stateRefreshPending };
}

export async function deleteProject(projectId: string) {
  await requireProject(projectId);
  return db.project.delete({ where: { id: projectId } });
}

/**
 * 归档项目：可恢复的展示偏好，不改变任何业务事实。
 *
 * 幂等：已归档的项目再次归档保持原 archivedAt，不刷新时间戳——否则"归档时间"
 * 会随重复点击漂移，无法作为"它是什么时候退出的"依据。
 * 不触发状态重评：归档是生命周期动作，不是业务数据变更。
 */
export async function archiveProject(projectId: string) {
  const project = await requireProject(projectId);
  if (project.archivedAt) return project;
  return db.project.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
}

/** 恢复项目：清空 archivedAt，归档期间被隐藏的数据本身从未改变。 */
export async function restoreProject(projectId: string) {
  const project = await requireProject(projectId);
  if (!project.archivedAt) return project;
  return db.project.update({ where: { id: projectId }, data: { archivedAt: null } });
}

export async function requireProject(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
  return project;
}

export async function getProjectDetail(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      cards: {
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          capture: { select: { rawText: true, sourceType: true } },
          attachment: { select: { id: true, fileName: true, type: true, extractionStatus: true } },
          outgoingLinks: { include: { relatedCard: true }, orderBy: { score: "desc" } },
          incomingLinks: { include: { currentCard: true }, orderBy: { score: "desc" } },
        },
      },
      artifacts: { orderBy: { createdAt: "desc" } },
      _count: { select: { captures: true, cards: true, artifacts: true } },
    },
  });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
  return project;
}

export async function findProjectByTitle(title: string) {
  return db.project.findFirst({ where: { title } });
}
