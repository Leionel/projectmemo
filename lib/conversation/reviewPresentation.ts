import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { readReview } from "@/lib/decision/reviewPersistence";
import { agentPresentationSchema, type AgentPresentation } from "@/lib/types/agentExperience";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";
import type { ChangeReviewResult, DynamicReviewResult } from "@/lib/types/changeReview";
import { ownedConversation } from "./repository";

/** Rebind original D1/D2 results; no UI planning call or parallel approval state. */
export async function reviewPresentation(actor: ConversationActor, id: string, blocks: ConversationBlocks): Promise<AgentPresentation | undefined> {
  if (!blocks.reviewRef || !isFeatureEnabled("FOCUS_AGENT_R4_ENABLED", false)) return;
  const c = await ownedConversation(actor, id), ref = blocks.reviewRef;
  const review = await readReview(actor, ref.id);
  if (!review.result || review.missionId !== ref.missionId || review.projectId !== ref.projectId || review.proposalHash !== ref.proposalHash) return;
  const original = await db.decisionScenarioProposal.findFirst({ where: { id: review.id, ownerUserId: actor.userId }, select: { expiresAt: true } });
  if (!original) return;
  const source = { kind: "REVIEW" as const, id: review.id, projectId: review.projectId, revision: review.proposalHash };
  if (review.purpose === "CHANGE_REVIEW") {
    const result = review.result as ChangeReviewResult, candidate = result.candidates.find(x => x.relevance !== "UNRELATED");
    return agentPresentationSchema.parse({ schemaVersion: 1, blocks: [{ blockKey: "change:" + review.id, semanticType: "change", emphasis: "primary",
      fallbackText: review.stale ? "原复核依据已变化" : result.summary, refs: [source], actionBindingIds: [], disposition: result.decision,
      goalQuote: candidate?.goalQuote ?? review.base.goal, changeKind: candidate?.changeKind ?? "无相关变化", relevance: candidate?.reason ?? result.summary,
      unknowns: result.candidates.flatMap(x => x.unknown).slice(0, 8) }], allowedActions: [] });
  }
  if (review.purpose !== "DYNAMIC_PLAN") return;
  const result = review.result as DynamicReviewResult;
  const reason = c.activeTurnId ? "请等本轮讨论结束" : review.stale ? "依据或原结果已变化，请重新复核" : review.status !== "READY" ? "这项方案已处理" : original.expiresAt <= new Date() ? "方案已过期" : null;
  const actions = result.candidates.map(candidate => {
    const disabled = reason ?? (candidate.feasibility !== "READY" ? candidate.feasibilityReasons.join("；") || "方案条件尚未核对" : null);
    return { bindingId: `preview-review:${review.id}:${candidate.candidateId}`, conversationId: id, expectedConversationVersion: c.version,
      actionKind: "PREVIEW" as const, target: { ...source, kind: "PROPOSAL" as const }, label: "预览采用", enabled: !disabled, disabledReason: disabled,
      frozen: { executionId: null, candidateId: candidate.candidateId, proposalHash: review.proposalHash, expiresAt: original.expiresAt.toISOString() } };
  });
  return agentPresentationSchema.parse({ schemaVersion: 1, blocks: [{ blockKey: "comparison:" + review.id, semanticType: "comparison", emphasis: "primary",
    fallbackText: result.summary, refs: [{ ...source, kind: "PROPOSAL" }], actionBindingIds: actions.map(a => a.bindingId), proposalHash: review.proposalHash,
    candidates: result.candidates.map(x => ({ id: x.candidateId, title: x.title, tradeoff: x.reason,
      feasibility: x.feasibility === "UNMET" ? "BLOCKED" : x.feasibility, expectedObservation: x.expectedObservation || null, branches: x.branches, stopCondition: x.stopCondition })) }], allowedActions: actions });
}
