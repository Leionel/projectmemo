import { AppError } from "@/lib/api";
import { db } from "@/lib/db";

export type FeasibilityState = "READY" | "BLOCKED" | "UNKNOWN";

export interface FeasibilityRequirementInput {
  targetKind: "action" | "card" | "deliverable";
  targetId: string;
  hard?: boolean;
  note?: string;
}

export interface FeasibilityUpdateInput {
  actionId: string;
  addRequirements?: FeasibilityRequirementInput[];
  removeRequirementIds?: string[];
  estimatedMinutes?: number | null;
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

async function assertTargetInProject(projectId: string, actionId: string, target: FeasibilityRequirementInput) {
  assertKind(target.targetKind);
  if (target.targetKind === "action") {
    const found = await db.actionItem.findFirst({ where: { id: target.targetId, projectId } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的行动不存在或不属于当前项目", 400);
    if (found.id === actionId) {
      throw new AppError("SELF_DEPENDENCY", "行动不能依赖自身", 400);
    }
  } else if (target.targetKind === "card") {
    const found = await db.knowledgeCard.findFirst({ where: { id: target.targetId, projectId } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的记录不存在或不属于当前项目", 400);
  } else {
    const found = await db.deliverable.findFirst({ where: { id: target.targetId, milestone: { projectId } } });
    if (!found) throw new AppError("CROSS_PROJECT_REQUIREMENT", "依赖的交付物不存在或不属于当前项目", 400);
  }
}

/** 环检测：action 依赖图不允许循环（依赖边 action → 依赖 action），包含待新增边 */
async function assertNoActionCycle(projectId: string, actionId: string, newTargets: FeasibilityRequirementInput[]) {
  const requirements = await db.actionRequirement.findMany({
    where: { projectId, targetKind: "action" },
    select: { actionId: true, targetId: true },
  });
  const adjacency = new Map<string, string[]>();
  for (const req of requirements) {
    const list = adjacency.get(req.actionId) ?? [];
    list.push(req.targetId);
    adjacency.set(req.actionId, list);
  }
  for (const target of newTargets) {
    if (target.targetKind !== "action") continue;
    const list = adjacency.get(actionId) ?? [];
    list.push(target.targetId);
    adjacency.set(actionId, list);
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
    if (visit(node)) {
      throw new AppError("CYCLIC_DEPENDENCY", "依赖不能形成循环", 400);
    }
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
    if (!action) {
      return { ...base, targetTitle: null, state: "MISSING", note: "依赖的行动记录不存在" };
    }
    if (action.status === "DONE") {
      return { ...base, targetTitle: action.title, state: "MET", note: "依赖行动已完成" };
    }
    if (action.status === "CANCELLED") {
      return { ...base, targetTitle: action.title, state: "UNMET", note: "依赖行动已取消" };
    }
    return { ...base, targetTitle: action.title, state: "UNMET", note: `依赖行动尚未完成（${action.status}）` };
  }

  if (req.targetKind === "card") {
    const card = await db.knowledgeCard.findUnique({ where: { id: req.targetId } });
    if (!card) {
      return { ...base, targetTitle: null, state: "MISSING", note: "依赖的记录不存在" };
    }
    // 严格按账本状态映射：只有 SUPPORTED 才算前提满足，其余不兜底为 MET
    const state = temporalStates.get(card.id);
    if (!state) {
      return { ...base, targetTitle: card.title, state: "UNKNOWN", note: "无法确认依赖记录的当前状态" };
    }
    if (state.supportState === "SUPERSEDED") {
      return {
        ...base,
        targetTitle: card.title,
        state: "UNMET",
        note: `依赖的记录已被「${state.supersededByTitle ?? "新记录"}」取代`,
      };
    }
    if (state.supportState === "REVOKED") {
      return { ...base, targetTitle: card.title, state: "UNMET", note: "依赖记录的相关关系已撤销，前提不再成立" };
    }
    if (state.supportState === "SUPPORTED") {
      return { ...base, targetTitle: card.title, state: "MET", note: "依赖记录当前有效" };
    }
    return { ...base, targetTitle: card.title, state: "UNKNOWN", note: "依赖记录证据不足或待确认，无法确认前提成立" };
  }

  const deliverable = await db.deliverable.findUnique({
    where: { id: req.targetId },
    include: { evidences: true },
  });
  if (!deliverable) {
    return { ...base, targetTitle: null, state: "MISSING", note: "依赖的交付物不存在" };
  }
  if (deliverable.status === "COMPLETED") {
    return { ...base, targetTitle: deliverable.title, state: "MET", note: "交付物已完成" };
  }
  return { ...base, targetTitle: deliverable.title, state: "UNMET", note: "交付物尚未完成" };
}

/** 以当前源状态评估；不信任客户端传入的结论，也不把评估结果持久化（旧评估自然过期） */
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
  for (const req of requirements) {
    dependencies.push(await assessDependent(req, temporalStates));
  }

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
  const action = await db.actionItem.findFirst({ where: { id: input.actionId, projectId } });
  if (!action) throw new AppError("ACTION_NOT_FOUND", "行动不存在或不属于当前项目", 404);

  // 估时先校验：非法输入不得留下部分已添加的依赖
  if (input.estimatedMinutes !== undefined) {
    if (input.estimatedMinutes !== null && (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0 || input.estimatedMinutes > 100000)) {
      throw new AppError("INVALID_ESTIMATE", "估时必须是正整数分钟，缺失时保持未估算", 422);
    }
  }

  if (input.addRequirements) {
    for (const target of input.addRequirements) {
      await assertTargetInProject(projectId, action.id, target);
    }
    await assertNoActionCycle(projectId, action.id, input.addRequirements);
    for (const target of input.addRequirements) {
      const duplicate = await db.actionRequirement.findFirst({
        where: { actionId: action.id, targetKind: target.targetKind, targetId: target.targetId },
      });
      if (duplicate) continue;
      await db.actionRequirement.create({
        data: {
          actionId: action.id,
          projectId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          hard: target.hard ?? true,
          note: target.note ?? null,
        },
      });
    }
  }

  if (input.removeRequirementIds && input.removeRequirementIds.length > 0) {
    await db.actionRequirement.deleteMany({
      where: { actionId: action.id, id: { in: input.removeRequirementIds } },
    });
  }

  if (input.estimatedMinutes !== undefined) {
    await db.actionItem.update({
      where: { id: action.id },
      data: { estimatedMinutes: input.estimatedMinutes },
    });
  }

  return assessActionFeasibility(projectId, action.id);
}
