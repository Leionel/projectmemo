import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "@/lib/mission/contracts";
import { createChangeReview, listChangeMaterials } from "@/lib/decision/changeUnderstanding";
import { createDynamicReview } from "@/lib/decision/dynamicCandidates";
import { readReview } from "@/lib/decision/reviewPersistence";
import { requireWork } from "./workService";
import { appendConversationMessage, bindRefs, readConversation } from "./service";
import { emptyBlocks, lockConversation, ownedConversation, record } from "./repository";
import { workRefSchema } from "@/lib/types/conversationWork";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";
import type { ReviewView, DynamicReviewResult } from "@/lib/types/changeReview";

export const conversationReviewSchema = z.object({
  requestId: z.string().min(1).max(128), expectedConversationVersion: z.number().int().positive(),
  ref: workRefSchema, purpose: z.enum(["CHANGE_REVIEW", "DYNAMIC_PLAN"]), expectedVersion: z.number().int().positive(),
  llmContextApproved: z.literal(true), sources: z.array(z.object({ id: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(5).optional(),
  reviewId: z.string().optional(), feedback: z.string().trim().max(500).default(""), retry: z.boolean().default(false),
  rejectedCandidateIds: z.array(z.string().min(1).max(64)).max(3).default([]),
}).strict();
export async function readConversationReviews(actor: ConversationActor, id: string, ref: unknown) {
  const parsed = workRefSchema.parse(ref);
  await requireWork(actor, id, parsed);
  if (parsed.kind !== "MISSION") return { enabled: false, materials: [], change: null, dynamic: null };
  const enabled = isFeatureEnabled("GOAL_CHANGE_REVIEW_ENABLED", false);
  const rows = await db.decisionScenarioProposal.findMany({ where: { missionId: parsed.id, ownerUserId: actor.userId, purpose: { in: ["CHANGE_REVIEW", "DYNAMIC_PLAN"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12 });
  const change = rows.find(p => p.purpose === "CHANGE_REVIEW"), dynamic = rows.find(p => p.purpose === "DYNAMIC_PLAN" && p.parentId === change?.id);
  return { enabled, ...(enabled ? await listChangeMaterials(actor, parsed.id) : { materials: [] }),
    change: change ? await readReview(actor, change.id) : null, dynamic: dynamic ? await readReview(actor, dynamic.id) : null };
}
async function projectReview(actor: ConversationActor, id: string, turnId: string, review: ReviewView) {
  return db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx);
    await requireWork(actor, id, { kind: "MISSION", id: review.missionId, projectId: review.projectId }, tx);
    const anchor = await tx.conversationAnchor.findFirst({ where: { conversationId: id, missionId: review.missionId, ownerUserId: actor.userId } });
    if (!anchor) {
      const mission = await tx.agentMission.findUniqueOrThrow({ where: { id: review.missionId } });
      await tx.conversationAnchor.create({ data: { ownerUserId: actor.userId, conversationId: id, projectId: review.projectId,
        missionId: review.missionId, originKind: "CHANGE_REVIEW", originId: review.id, topicKey: id,
        rootKey: jsonHash({ user: actor.userId, mission: review.missionId, conversation: id }), originRevision: review.proposalHash,
        originEntryJson: { title: mission.goal }, eventCursor: mission.nextEventSeq } });
    }
    const projected = await tx.agentMessage.findMany({ where: { conversationId: id, turnId, role: "ASSISTANT" }, take: 8, select: { blocksJson: true } });
    if (projected.some(message => {
      const ref = record(record(message.blocksJson).reviewRef);
      return ref.id === review.id && ref.status === review.status && ref.proposalHash === review.proposalHash;
    })) return;
    {
      const m = await tx.agentMission.findUniqueOrThrow({ where: { id: review.missionId } });
      const refs = await bindRefs(tx, id, [{ kind: "MISSION", id: m.id, projectId: m.projectId, title: m.goal, status: m.status, version: m.version,
        href: `/projects/${m.projectId}/missions?mission=${m.id}` }]);
      const sources: ConversationBlocks["sources"] = review.base.evidence.map(e => ({
        id: review.projectId + "/" + e.ref, projectId: review.projectId, sourceId: e.source.id, revision: e.source.hash,
        title: e.title, excerpt: e.text, start: 0, end: e.text.length, excerptHash: jsonHash(e.text),
        observedAt: e.source.observedAt, temporalState: e.source.temporalState ?? "UNKNOWN", knowledgeClass: e.source.knowledgeClass ?? "PROJECT_OBSERVATION",
      }));
      const result = review.result;
      const citations = result?.candidates.flatMap(candidate => candidate.evidence.map(q => ({ sourceId: review.projectId + "/" + q.ref, quote: q.quote }))) ?? [];
      const content = review.status === "READY" && result ? result.summary : `原复核状态：${review.status}。没有自动重发模型，原计划保留。`;
      await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", content, {
        ...emptyBlocks(), refs, sources, citations, provider: result?.provider ?? "project_state", observedProjectIds: [review.projectId],
        reviewRef: { id: review.id, purpose: review.purpose, missionId: review.missionId, projectId: review.projectId, status: review.status, proposalHash: review.proposalHash },
        options: review.purpose === "DYNAMIC_PLAN" && review.status === "READY" ? (result as DynamicReviewResult).candidates.map(candidate => ({
          key: candidate.candidateId, label: candidate.title, candidateId: candidate.candidateId, purpose: "DYNAMIC_PLAN",
          projectId: review.projectId, missionId: review.missionId, proposalId: review.id, proposalHash: review.proposalHash, expectedVersion: review.base.expectedVersion,
        })) : [],
      }, turnId);
    }
    await tx.conversationTurn.update({ where: { id: turnId }, data: { status: "ANSWERED", finishedAt: new Date() } });
    await tx.conversation.update({ where: { id }, data: { version: { increment: 1 }, ...(c.activeTurnId === turnId ? { activeTurnId: null } : {}) } });
  }, { timeout: 20000 });
}
export async function submitConversationReview(actor: ConversationActor, id: string, raw: unknown) {
  const input = conversationReviewSchema.parse(raw), inputHash = jsonHash(input);
  if (input.ref.kind !== "MISSION") throw new AppError("MISSION_REQUIRED", "请选择原委托进行变化复核", 422);
  const prepared = await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await requireWork(actor, id, input.ref, tx);
    const old = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (old) {
      if (old.inputHash !== inputHash) throw new AppError("REQUEST_ID_REUSED", "该请求编号已用于其他复核", 409);
      return { turn: old, existing: true };
    }
    if (c.activeTurnId || c.version !== input.expectedConversationVersion) throw new AppError("CONVERSATION_CHANGED", "讨论正在处理其他输入，请先读取状态", 409);
    const pinned = Array.isArray(c.pinnedStateJson) ? c.pinnedStateJson : [];
    if (pinned.some(p => typeof p === "string" && /(?:不要|禁止|不允许|不得).*(?:云端|模型|联网|对外)/.test(p))) throw new AppError("CLOUD_CONTEXT_RESTRICTED", "本讨论保留了云端或联网限制，请使用本地整理或另开明确授权的主题", 409);
    const turn = await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId, inputHash, inputJson: json(input), baseVersion: c.version, status: "OBSERVING" } });
    await appendConversationMessage(tx, id, actor.userId, "USER", input.purpose === "CHANGE_REVIEW" ? "复核所选资料对原委托的影响。" : input.feedback || "围绕原变化比较本轮推进方案。", { ...emptyBlocks(), observedProjectIds: [input.ref.projectId] }, turn.id);
    await tx.conversation.update({ where: { id }, data: { activeTurnId: turn.id, version: { increment: 1 } } });
    return { turn, existing: false };
  });
  const requestId = "review:" + prepared.turn.id;
  let review: ReviewView | null = null;
  if (prepared.existing) {
    const alias = await db.decisionReviewRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId } } });
    if (alias) review = await readReview(actor, alias.proposalId);
    if (!review && Date.now() - prepared.turn.createdAt.getTime() > 120000) {
      await db.$transaction(async tx => {
        await lockConversation(tx, id);
        await tx.conversationTurn.update({ where: { id: prepared.turn.id }, data: { status: "FAILED", finishedAt: new Date(), errorJson: { code: "INTERRUPTED_BEFORE_REVIEW_RESERVATION" } } });
        await tx.conversation.updateMany({ where: { id, activeTurnId: prepared.turn.id }, data: { activeTurnId: null } });
      });
    }
    if (!review || review.status === "BUILDING") return { review, conversation: await readConversation(actor, id) };
  } else {
    try {
      review = input.purpose === "CHANGE_REVIEW" ? await createChangeReview(actor, input.ref.id, { requestId, expectedVersion: input.expectedVersion, sources: input.sources, llmContextApproved: true })
        : await createDynamicReview(actor, input.ref.id, { requestId, reviewId: input.reviewId, feedback: input.feedback, retry: input.retry, rejectedCandidateIds: input.rejectedCandidateIds, llmContextApproved: true });
    } catch (error) {
      await db.$transaction(async tx => {
        await lockConversation(tx, id);
        await tx.conversationTurn.update({ where: { id: prepared.turn.id }, data: { status: "FAILED", finishedAt: new Date(), errorJson: { code: error instanceof AppError ? error.code : "REVIEW_FAILED" } } });
        await tx.conversation.updateMany({ where: { id, activeTurnId: prepared.turn.id }, data: { activeTurnId: null } });
      });
      throw error;
    }
  }
  if (review) await projectReview(actor, id, prepared.turn.id, review);
  return { review, conversation: await readConversation(actor, id) };
}
