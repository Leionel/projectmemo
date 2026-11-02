import { db } from "@/lib/db";
import type { ProjectCreateInput, ProjectUpdateInput } from "@/lib/validation/schemas";
import type { ProjectScenario } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { buildProjectDashboard } from "@/lib/projectDashboard";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import { jsonHash } from "@/lib/mission/contracts";
import { record } from "@/lib/conversation/repository";

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
      deletionRequestedAt: null,
      ...(userId ? { memberships: { some: { userId } } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      memberships: { where: userId ? { userId } : {}, select: { role: true } },
      _count: { select: { cards: true, artifacts: true } },
      cards: { select: { type: true } },
      artifacts: { select: { artifactType: true } },
      actions: { select: { status: true, priority: true, dueAt: true, createdAt: true, completedAt: true, resultCardId: true, isSimulated: true } },
      interventions: { where: { NOT: { dedupeKey: { startsWith: "goal:" } } }, select: { status: true, severity: true, snoozedUntil: true, isSimulated: true, triggerType: true } },
    },
  });
  return projects.map(({ memberships, cards, artifacts, actions, interventions, ...project }) => ({
    ...project,
    canDelete: Boolean(userId && memberships.some(m => m.role === "OWNER")),
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

/**
 * 建项事务的唯一实现：Project + OWNER + AgentRun 回执在同一次提交里。
 *
 * 项目前材料确认复用这一个函数，而不是另写一套建项：`hashExtra` 只把
 * 草稿身份、修订与预览 hash 并入去重 hash，让「同一请求改内容」仍然被拒；
 * 存进 Project 的永远只有用户接受的那几个业务字段。
 */
export async function createOwnedProjectInTx(tx: import("@/lib/generated/prisma/client").Prisma.TransactionClient,
  input: ProjectCreateInput, userId: string, requestId: string, options: {
    sessionId?: string; provider?: string; hashExtra?: Record<string, unknown>; resultExtra?: Record<string, unknown>;
    traceExtra?: Record<string, unknown>;
  } = {}) {
  const { requestId: _request, ...fields } = input;
  void _request;
  const hash = jsonHash(options.hashExtra ? { ...fields, intake: options.hashExtra } : fields);
  const provider = options.provider ?? "project-create-v1", externalRequestId = `${userId}:${requestId}`;
  await tx.user.update({ where: { id: userId }, data: { continuitySeq: { increment: 0 } } });
  if (options.sessionId && !await tx.authSession.findFirst({ where: { id: options.sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } } }))
    throw new AppError("UNAUTHORIZED", "登录状态已变化，未创建项目", 401);
  const previous = await tx.agentRun.findUnique({ where: { provider_externalRequestId: { provider, externalRequestId } } });
  if (previous) {
    if (record(previous.trace).payloadHash !== hash) throw new AppError("IDEMPOTENCY_CONFLICT", "同一建项请求的内容已变化，请重新提交", 409);
    if (options.hashExtra && record(previous.trace).intakeHash !== jsonHash(options.hashExtra))
      throw new AppError("IDEMPOTENCY_CONFLICT", "同一建项请求已绑定另一份材料预览", 409);
    const project = await tx.project.findFirst({ where: { id: String(record(previous.resultJson).projectId), deletionRequestedAt: null,
      memberships: { some: { userId, role: "OWNER" } } } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "原请求的项目已不可用，不会重新创建", 404);
    return { project, replayed: true };
  }
  const project = await tx.project.create({ data: { ...fields, scenario: fields.scenario as ProjectScenario,
    deadline: fields.deadline ? new Date(`${fields.deadline}T23:59:59`) : null,
    memberships: { create: { userId, role: "OWNER" } } } });
  await tx.agentRun.create({ data: { provider, externalRequestId, runType: "ACTION", status: "SUCCESS",
    trace: { ownerId: userId, payloadHash: hash, ...(options.hashExtra ? { intakeHash: jsonHash(options.hashExtra) } : {}), ...options.traceExtra },
    resultJson: { projectId: project.id, ...options.resultExtra } } });
  return { project, replayed: false };
}

export async function createOwnedProject(input: ProjectCreateInput, userId: string, requestId: string, sessionId?: string) {
  return db.$transaction(tx => createOwnedProjectInTx(tx, input, userId, requestId, { sessionId }));
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
  if (!project || project.deletionRequestedAt) throw new AppError("PROJECT_NOT_FOUND", "没有可访问的项目", 404);
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
          capture: { select: { rawText: true, sourceType: true, processingJson: true } },
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
