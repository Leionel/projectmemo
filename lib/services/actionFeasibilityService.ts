import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";

export type FeasibilityState = "READY" | "BLOCKED" | "UNKNOWN";

export interface FeasibilityRequirementInput {
  targetKind: "action" | "card" | "deliverable";
  targetId: string;
  hard?: boolean;
  note?: string | null;
}

export interface FeasibilityUpdateInput {
  actionId: string;
  addRequirements?: FeasibilityRequirementInput[];
  removeRequirementIds?: string[];
  estimatedMinutes?: number | null;
  /** 编辑器读取到的持久化依赖版本；未提供时保持旧客户端兼容。 */
  expectedVersion?: number;
}

export interface FeasibilityDependentState {
  requirementId: string;
  targetKind: string;
  targetId: string;
  targetTitle: string | null;
  hard: boolean;
  state: "MET" | "UNMET" | "UNKNOWN" | "MISSING";
  note: string;
}

export interface FeasibilityAssessment {
  actionId: string;
  /** 本次评估读取到的依赖/估时编辑版本。 */
  dependencyVersion: number;
  feasibility: FeasibilityState;
  dependencies: FeasibilityDependentState[];
  overdue: boolean;
  deadline: string | null;
  estimateMinutes: number | null;
  estimateNote: string;
  assessedAt: string;
  summary: string;
}

const KINDS = ["action", "card", "deliverable"] as const;

function assertKind(kind: string): asserts kind is (typeof KINDS)[number] {
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    throw new AppError("INVALID_TARGET_KIND", "依赖类型必须是 action、card 或 deliverable", 422);
  }
}

async function assertTargetInProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  actionId: string,
  target: FeasibilityRequirementInput,
) {
  assertKind(target.targetKind);
  if (target.targetKind === "action") {
    const found = await tx.actionItem.findFirst({ where: { id: target.targetId, projectId } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的行动不存在或不属于当前项目", 400);
    if (found.id === actionId) {
      throw new AppError("SELF_DEPENDENCY", "行动不能依赖自身", 400);
    }
  } else if (target.targetKind === "card") {
    const found = await tx.knowledgeCard.findFirst({ where: { id: target.targetId, projectId } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的记录不存在或不属于当前项目", 400);
  } else {
    const found = await tx.deliverable.findFirst({ where: { id: target.targetId, milestone: { projectId } } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的交付物不存在或不属于当前项目", 400);
  }
}

function requirementKey(targetKind: string, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

/**
 * 按最终依赖集合检查环路。当前 action 的旧边不会继续参与图，因而
 * “移除再添加”检查的是提交后的图，而不是旧图加新边的中间状态。
 */
async function assertNoActionCycle(
  tx: Prisma.TransactionClient,
  projectId: string,
  actionId: string,
  finalRequirements: Array<{ targetKind: string; targetId: string }>,
) {
  const requirements = await tx.actionRequirement.findMany({
    where: { projectId, targetKind: "action" },
    select: { actionId: true, targetId: true },
  });
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    const targets = adjacency.get(from) ?? new Set<string>();
    targets.add(to);
    adjacency.set(from, targets);
  };
  for (const req of requirements) {
    if (req.actionId !== actionId) addEdge(req.actionId, req.targetId);
  }
  for (const req of finalRequirements) {
    if (req.targetKind === "action") addEdge(actionId, req.targetId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of adjacency.keys()) {
    if (visit(node)) throw new AppError("CYCLIC_DEPENDENCY", "依赖不能形成循环", 400);
  }
}

async function assessDependent(
  req: { id: string; targetKind: string; targetId: string; hard: boolean },
  temporalStates: Map<string, { supportState: string; supersededByTitle: string | null }>,
): Promise<FeasibilityDependentState> {
  const base = {
    requirementId: req.id,
    targetKind: req.targetKind,
    targetId: req.targetId,
    hard: req.hard,
  };

  if (req.targetKind === "action") {
    const action = await db.actionItem.findUnique({ where: { id: req.targetId } });
    if (!action) return { ...base, targetTitle: null, state: "MISSING", note: "依赖的行动记录不存在" };
    if (action.status === "DONE") return { ...base, targetTitle: action.title, state: "MET", note: "依赖行动已完成" };
    if (action.status === "CANCELLED") return { ...base, targetTitle: action.title, state: "UNMET", note: "依赖行动已取消" };
    return { ...base, targetTitle: action.title, state: "UNMET", note: `依赖行动尚未完成（${action.status}）` };
  }

  if (req.targetKind === "card") {
    const card = await db.knowledgeCard.findUnique({ where: { id: req.targetId } });
    if (!card) return { ...base, targetTitle: null, state: "MISSING", note: "依赖的记录不存在" };
    const state = temporalStates.get(card.id);
    if (!state) return { ...base, targetTitle: card.title, state: "UNKNOWN", note: "无法确认依赖记录的当前状态" };
    if (state.supportState === "SUPERSEDED") {
      return { ...base, targetTitle: card.title, state: "UNMET", note: `依赖的记录已被「${state.supersededByTitle ?? "新记录"}」取代` };
    }
    if (state.supportState === "REVOKED") {
      return { ...base, targetTitle: card.title, state: "UNMET", note: "依赖记录的相关关系已撤销，前提不再成立" };
    }
    if (state.supportState === "SUPPORTED") {
      return { ...base, targetTitle: card.title, state: "MET", note: "依赖记录当前有效" };
    }
    return { ...base, targetTitle: card.title, state: "UNKNOWN", note: "依赖记录证据不足或待确认，无法确认前提成立" };
  }

  const deliverable = await db.deliverable.findUnique({ where: { id: req.targetId } });
  if (!deliverable) return { ...base, targetTitle: null, state: "MISSING", note: "依赖的交付物不存在" };
  if (deliverable.status === "COMPLETED") return { ...base, targetTitle: deliverable.title, state: "MET", note: "交付物已完成" };
  return { ...base, targetTitle: deliverable.title, state: "UNMET", note: "交付物尚未完成" };
}

/** 以当前源状态评估；不信任客户端传入的结论，也不持久化旧评估。 */
export async function assessActionFeasibility(projectId: string, actionId: string): Promise<FeasibilityAssessment> {
  const action = await db.actionItem.findFirst({ where: { id: actionId, projectId } });
  if (!action) throw new AppError("ACTION_NOT_FOUND", "行动不存在或不属于当前项目", 404);

  const requirements = await db.actionRequirement.findMany({ where: { actionId: action.id } });
  const cardIds = requirements.filter((r) => r.targetKind === "card").map((r) => r.targetId);
  const temporalStates = new Map<string, { supportState: string; supersededByTitle: string | null }>();
  if (cardIds.length > 0) {
    const { getTemporalSearchStates } = await import("@/lib/services/temporalLedgerService");
    const states = await getTemporalSearchStates(projectId, cardIds, new Date());
    for (const [cardId, item] of states) {
      temporalStates.set(cardId, {
        supportState: item.supportState,
        supersededByTitle: item.supersededBy ? item.supersededBy.title : null,
      });
    }
  }

  const dependencies: FeasibilityDependentState[] = [];
  for (const req of requirements) dependencies.push(await assessDependent(req, temporalStates));

  const hardDeps = dependencies.filter((dep) => dep.hard);
  const blocked = hardDeps.some((dep) => dep.state === "UNMET" || dep.state === "MISSING");
  const unknownHard = hardDeps.some((dep) => dep.state === "UNKNOWN");
  const feasibility: FeasibilityState = blocked ? "BLOCKED" : unknownHard ? "UNKNOWN" : "READY";
  const deadlineIso = action.dueAt ? action.dueAt.toISOString() : null;
  const overdue = deadlineIso !== null && new Date(deadlineIso).getTime() < Date.now();
  const summary = blocked
    ? "存在未满足的硬依赖，不能立即开始执行。"
    : unknownHard
      ? "没有已知阻塞，但关键依赖的状态无法确认。"
      : "已声明的硬依赖全部满足。READY 不保证现实一定能按时完成。";

  return {
    actionId: action.id,
    dependencyVersion: action.dependencyVersion,
    feasibility,
    dependencies,
    overdue,
    deadline: deadlineIso,
    estimateMinutes: action.estimatedMinutes ?? null,
    estimateNote: action.estimatedMinutes === null ? "未估算（由用户补充，系统不编造估时）" : "用户填写",
    assessedAt: new Date().toISOString(),
    summary,
  };
}

export async function updateActionFeasibilityInput(
  projectId: string,
  input: FeasibilityUpdateInput,
): Promise<FeasibilityAssessment> {
  try {
    await db.$transaction(async (tx) => {
      const action = await tx.actionItem.findFirst({ where: { id: input.actionId, projectId } });
      if (!action) throw new AppError("ACTION_NOT_FOUND", "行动不存在或不属于当前项目", 404);
      if (input.expectedVersion !== undefined && input.expectedVersion !== action.dependencyVersion) {
        throw new AppError("FEASIBILITY_VERSION_CONFLICT", "依赖已被其他编辑更新，请重新打开后再保存", 409);
      }

      if (input.estimatedMinutes !== undefined && input.estimatedMinutes !== null &&
        (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0 || input.estimatedMinutes > 100000)) {
        throw new AppError("INVALID_ESTIMATE", "估时必须是正整数分钟，缺失时保持未估算", 422);
      }

      const current = await tx.actionRequirement.findMany({ where: { actionId: action.id } });
      const currentByKey = new Map<string, typeof current[number]>();
      for (const requirement of current) {
        const key = requirementKey(requirement.targetKind, requirement.targetId);
        if (currentByKey.has(key)) throw new AppError("DUPLICATE_REQUIREMENT", "当前行动存在重复依赖，请先修复数据", 409);
        currentByKey.set(key, requirement);
      }

      const removeIds = new Set(input.removeRequirementIds ?? []);
      for (const id of removeIds) {
        const found = current.find((requirement) => requirement.id === id);
        if (!found) throw new AppError("REQUIREMENT_NOT_FOUND", "要删除的依赖不存在或不属于当前行动", 400);
        currentByKey.delete(requirementKey(found.targetKind, found.targetId));
      }

      const addKeys = new Set<string>();
      for (const target of input.addRequirements ?? []) {
        await assertTargetInProject(tx, projectId, action.id, target);
        const key = requirementKey(target.targetKind, target.targetId);
        if (addKeys.has(key)) throw new AppError("DUPLICATE_REQUIREMENT", "同一请求不能重复添加同一依赖目标", 400);
        addKeys.add(key);
        const previous = currentByKey.get(key);
        currentByKey.set(key, {
          id: previous?.id ?? "",
          actionId: action.id,
          projectId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          hard: target.hard ?? previous?.hard ?? true,
          note: target.note !== undefined ? target.note : previous?.note ?? null,
          createdAt: previous?.createdAt ?? new Date(),
        });
      }

      const finalRequirements = [...currentByKey.values()];
      await assertNoActionCycle(tx, projectId, action.id, finalRequirements);

      const finalKeys = new Set(finalRequirements.map((requirement) => requirementKey(requirement.targetKind, requirement.targetId)));
      const currentChanged = current.some((requirement) => {
        const key = requirementKey(requirement.targetKind, requirement.targetId);
        const next = currentByKey.get(key);
        return !finalKeys.has(key) || !next || next.hard !== requirement.hard || next.note !== requirement.note;
      });
      const added = finalRequirements.some((requirement) => !current.some((item) => item.id === requirement.id));
      const requirementsChanged = currentChanged || added;
      const estimateChanged = input.estimatedMinutes !== undefined && input.estimatedMinutes !== action.estimatedMinutes;

      for (const requirement of current) {
        const key = requirementKey(requirement.targetKind, requirement.targetId);
        const next = currentByKey.get(key);
        // 移除后又添加同一目标时，final row 没有旧 ID：先删除旧行再创建
        // 新行，避免因为 key 仍存在而留下旧依赖或触发重复关系。
        if (!finalKeys.has(key) || !next || next.id !== requirement.id) {
          await tx.actionRequirement.delete({ where: { id: requirement.id } });
        }
      }
      for (const requirement of finalRequirements) {
        if (requirement.id) {
          await tx.actionRequirement.update({
            where: { id: requirement.id },
            data: { hard: requirement.hard, note: requirement.note },
          });
        } else {
          await tx.actionRequirement.create({
            data: {
              actionId: action.id,
              projectId,
              targetKind: requirement.targetKind,
              targetId: requirement.targetId,
              hard: requirement.hard,
              note: requirement.note,
            },
          });
        }
      }

      if (requirementsChanged || estimateChanged) {
        await tx.actionItem.update({
          where: { id: action.id },
          data: {
            ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
            dependencyVersion: { increment: 1 },
          },
        });
      }
    });
  } catch (error) {
    // SQLite may report a short-lived writer lock when opposite edges are
    // edited concurrently; expose it as a retryable business conflict.
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("database is locked") || message.includes("busy")) {
      throw new AppError("FEASIBILITY_CONFLICT", "依赖正在被其他编辑更新，请重新打开后重试", 409);
    }
    throw error;
  }

  // 事务提交后重新读取真实源状态；不信任客户端传入的 READY，也不复用
  // 事务前的旧评估。
  return assessActionFeasibility(projectId, input.actionId);
}
