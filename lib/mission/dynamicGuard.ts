import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "./contracts";
import { sourceHash, type Tx } from "./repository";
import type { AgentMission } from "@/lib/generated/prisma/client";

export type DynamicReviewGuard = {
  schemaVersion: 2; rootReviewId: string; originalRootReviewKey: string; proposalId: string; candidateId: string;
  kind: "READ_EXISTING" | "ASK_USER"; goalHash: string; successHash: string; constraintsHash: string; scopeHash: string; projectGoalHash: string;
  readSet: Array<{ id: string; hash: string }>; allowedReads: Array<{ id: string; hash: string }>;
  question: string | null; completed: boolean;
};
export function dynamicGuard(m: Pick<AgentMission, "planJson">): DynamicReviewGuard | null {
  const guard = (m.planJson as { dynamicReview?: DynamicReviewGuard } | null)?.dynamicReview;
  if (!guard) return null;
  if (guard.schemaVersion !== 2) throw new AppError("UNSUPPORTED_REVIEW_GUARD", "计划保护版本不受支持，请更新客户端后重新核对", 409);
  return guard;
}
export async function validateDynamicGuard(tx: Tx, m: AgentMission) {
  const guard = dynamicGuard(m);
  if (!guard) return;
  if (!isFeatureEnabled("GOAL_CHANGE_REVIEW_ENABLED", false)) throw new AppError("CHANGE_REVIEW_DISABLED", "动态复核已暂停，原记录保留", 409);
  if (!await tx.decisionScenarioProposal.findFirst({ where: { id: guard.rootReviewId, ownerUserId: m.ownerUserId, missionId: m.id, purpose: "CHANGE_REVIEW", status: "READY" } }))
    throw new AppError("REVIEW_STOPPED", "原变化复核已停止或失效", 409);
  if (await tx.goalQuestionPreference.findFirst({ where: { userId: m.ownerUserId, missionId: m.id, questionId: "*", mode: "STOP" } }))
    throw new AppError("REVIEW_STOPPED", "该主题已停止，本轮不再读取新资料", 409);
  if (jsonHash(m.goal) !== guard.goalHash || jsonHash(m.successCriteriaJson) !== guard.successHash ||
    jsonHash(m.constraintsJson) !== guard.constraintsHash || jsonHash(m.researchScopeJson) !== guard.scopeHash)
    throw new AppError("SOURCE_CHANGED", "目标、成功条件或约束已变化，请重新核对方案", 409);
  const project = await tx.project.findUniqueOrThrow({ where: { id: m.projectId }, select: { goal: true } });
  if (jsonHash(project.goal) !== guard.projectGoalHash) throw new AppError("SOURCE_CHANGED", "原项目目标已变化", 409);
  for (const p of guard.readSet) if (await sourceHash(m.projectId, p.id, tx) !== p.hash) throw new AppError("SOURCE_CHANGED", "方案涉及的资料已变化，原读取不会继续提交", 409);
}
export function assertDynamicTool(m: AgentMission, name: string, input: unknown) {
  const guard = dynamicGuard(m);
  if (!guard) return;
  const pointer = input as { sourceId?: string; sourceHash?: string };
  if (guard.completed || guard.kind !== "READ_EXISTING" || name !== "read_project_material" ||
    !guard.allowedReads.some(p => p.id === pointer.sourceId && p.hash === pointer.sourceHash))
    throw new AppError("DYNAMIC_SCOPE_VIOLATION", "本轮只允许读取已确认的原资料，不批准其他操作", 409);
}
export async function reserveDynamicRead(tx: Tx, m: AgentMission) {
  const guard = dynamicGuard(m);
  if (!guard) return;
  const root = await tx.decisionScenarioProposal.findFirst({ where: { id: guard.rootReviewId, missionId: m.id, ownerUserId: m.ownerUserId, purpose: "CHANGE_REVIEW" } });
  if (!root) throw new AppError("REVIEW_NOT_FOUND", "原复核记录已不可访问", 409);
  const state = (root.reviewStateJson ?? {}) as { toolAttempts?: number };
  if ((state.toolAttempts ?? 0) >= 2) throw new AppError("REVIEW_READ_LIMIT", "本轮两次只读调查额度已用完，请读取已有结果", 409);
  await tx.decisionScenarioProposal.update({ where: { id: root.id }, data: { reviewStateJson: json({ ...state, toolAttempts: (state.toolAttempts ?? 0) + 1 }) } });
}
