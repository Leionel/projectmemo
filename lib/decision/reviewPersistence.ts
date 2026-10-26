import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { chatWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { assertActor, type CopilotActor } from "@/lib/copilot/confirmation";
import { defaultBudget, json, jsonHash, usageOf } from "@/lib/mission/contracts";
import { event, lock, ownedMission, sourceHash, type Tx } from "@/lib/mission/repository";
import type { AgentExecutionResult } from "@/lib/types";
import type { AgentMission, DecisionScenarioProposal } from "@/lib/generated/prisma/client";
import type { ReviewBase, ReviewView, ChangeReviewResult, DynamicReviewResult } from "@/lib/types/changeReview";

export type ReviewPurpose = "CHANGE_REVIEW" | "DYNAMIC_PLAN";
export type ReviewProvider = (prompt: string, purpose: ReviewPurpose) => Promise<AgentExecutionResult<string>>;
export function requireReviews() {
  if (!isFeatureEnabled("GOAL_CHANGE_REVIEW_ENABLED", false)) throw new AppError("CHANGE_REVIEW_DISABLED", "变化复核暂未开启，原计划仍保留", 503);
}
export async function reviewMission(actor: CopilotActor, id: string, tx: Tx = db) {
  const mission = await ownedMission(actor.userId, id, tx);
  await assertActor(tx, mission.projectId, actor);
  return mission;
}
export async function reviewFresh(base: ReviewBase, m: AgentMission, tx: Tx = db) {
  if (await tx.goalQuestionPreference.findFirst({ where: { userId: m.ownerUserId, missionId: m.id, questionId: "*", mode: "STOP" } })) return false;
  if (jsonHash(m.goal) !== base.goalHash || jsonHash(m.successCriteriaJson) !== base.successHash ||
    jsonHash(m.constraintsJson) !== base.constraintsHash || jsonHash(m.researchScopeJson) !== base.scopeHash ||
    m.planRevision !== base.planRevision && (m.planJson as { dynamicReview?: { originalRootReviewKey?: string } }).dynamicReview?.originalRootReviewKey !== base.rootReviewKey) return false;
  const project = await tx.project.findUniqueOrThrow({ where: { id: m.projectId }, select: { goal: true } });
  if (jsonHash(project.goal) !== base.projectGoalHash) return false;
  for (const p of base.sourcePointers) if (await sourceHash(m.projectId, p.id, tx) !== p.hash) return false;
  return true;
}
function present(p: DecisionScenarioProposal, stale: boolean): ReviewView {
  return { id: p.id, missionId: p.missionId, projectId: p.projectId, purpose: p.purpose, status: p.status,
    proposalHash: p.proposalHash, base: p.baseManifest as unknown as ReviewBase,
    result: p.scenariosJson && typeof p.scenariosJson === "object" && "summary" in p.scenariosJson ? p.scenariosJson as unknown as ChangeReviewResult | DynamicReviewResult : null,
    stale, receipt: p.receiptJson, createdAt: p.createdAt.toISOString(), toolAttempts: Number((p.reviewStateJson as { toolAttempts?: number } | null)?.toolAttempts ?? 0) };
}
export async function readReview(actor: CopilotActor, id: string): Promise<ReviewView> {
  return db.$transaction(async tx => {
    const p = await tx.decisionScenarioProposal.findFirst({ where: { id, ownerUserId: actor.userId, purpose: { in: ["CHANGE_REVIEW", "DYNAMIC_PLAN"] } } });
    if (!p) throw new AppError("REVIEW_NOT_FOUND", "复核不存在或不可访问", 404);
    const m = await reviewMission(actor, p.missionId, tx), base = p.baseManifest as unknown as ReviewBase;
    // Reading a timed-out call never retries it. Its reservation and unknown usage remain.
    if (p.status === "BUILDING" && Date.now() - p.createdAt.getTime() > 120000) {
      p.status = "UNKNOWN";
    }
    return present(p, !await reviewFresh(base, m, tx));
  }, { timeout: 20000 });
}
export async function replayReview(actor: CopilotActor, missionId: string, requestId: string, inputHash: string) {
  const replay = await db.decisionReviewRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId } } });
  if (!replay) return null;
  if (replay.inputHash !== inputHash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一项复核", 409);
  const result = await readReview(actor, replay.proposalId);
  if (result.missionId !== missionId) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一项委托", 409);
  return result;
}
export async function prepareReview(input: {
  actor: CopilotActor; missionId: string; requestId: string; inputHash: string; requestInput: unknown;
  purpose: ReviewPurpose; base: ReviewBase; parentId?: string; provider?: ReviewProvider;
}) {
  requireReviews();
  return db.$transaction(async tx => {
    await lock(tx, input.missionId);
    const m = await reviewMission(input.actor, input.missionId, tx);
    const alias = await tx.decisionReviewRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: input.actor.userId, requestId: input.requestId } } });
    if (alias) {
      if (alias.inputHash !== input.inputHash) throw new AppError("REQUEST_ID_REUSED", "请求编号载荷已变化", 409);
      return { proposal: await tx.decisionScenarioProposal.findUniqueOrThrow({ where: { id: alias.proposalId } }), existing: true };
    }
    if (await tx.decisionScenarioProposal.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: input.actor.userId, createRequestId: input.requestId } } }))
      throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他方案", 409);
    const reviewKey = jsonHash({ root: input.base.rootReviewKey, attempt: input.base.attempt });
    const previous = await tx.decisionScenarioProposal.findUnique({ where: { ownerUserId_purpose_reviewKey: { ownerUserId: input.actor.userId, purpose: input.purpose, reviewKey } } });
    if (previous) {
      await tx.decisionReviewRequest.create({ data: { ownerUserId: input.actor.userId, requestId: input.requestId, inputHash: input.inputHash, proposalId: previous.id } });
      return { proposal: previous, existing: true };
    }
    if (m.version !== input.base.expectedVersion || !await reviewFresh(input.base, m, tx)) throw new AppError("REVIEW_CHANGED", "目标、相关资料或约束已变化，请重新选择材料", 409);
    if (!["READY", "PAUSED"].includes(m.status) || m.cancelRequestedAt || m.pauseRequestedAt && m.status !== "PAUSED")
      throw new AppError("MISSION_CHANGED", "先在原委托暂停执行或处理当前问题，再复核变化", 409);
    const constraints = m.constraintsJson as { llmContextApproved?: boolean; costCeiling?: unknown };
    if (!input.provider && (constraints.llmContextApproved !== true || process.env.LLM_MODE !== "openai-compatible"))
      throw new AppError("REVIEW_MODEL_NOT_APPROVED", "本委托尚未授权云端分析或服务未配置模型", 409);
    if (constraints.costCeiling) throw new AppError("COST_POLICY_REQUIRED", "先核对原委托的金额与调用预算", 409);
    if (input.purpose === "DYNAMIC_PLAN") {
      const parent = await tx.decisionScenarioProposal.findFirst({ where: { id: input.parentId, missionId: m.id, ownerUserId: input.actor.userId, purpose: "CHANGE_REVIEW", status: "READY" } });
      if (!parent || !await reviewFresh(parent.baseManifest as unknown as ReviewBase, m, tx)) throw new AppError("REVIEW_CHANGED", "原变化复核已变化，请重新读取", 409);
      if (input.base.attempt > 2 || await tx.decisionScenarioProposal.count({ where: { parentId: parent.id, purpose: "DYNAMIC_PLAN" } }) >= 2)
        throw new AppError("REVIEW_ROUND_LIMIT", "本轮已分析两次，请保留当前未知或补充新的相关观察", 409);
    }
    const used = usageOf(m.budgetUsedJson), limits = { ...defaultBudget, ...m.budgetJson as object };
    used.models++; used.reservedOutputTokens += 2048; used.activeMs += 20000; used.unknownCalls++;
    if (Object.entries(limits).some(([key, value]) => used[key as keyof typeof used] > value)) throw new AppError("BUDGET_EXHAUSTED", "原委托剩余预算不足，保留当前计划", 409);
    const base: ReviewBase = { ...input.base, reservation: { outputTokens: 2048, activeMs: 20000, settled: false, sent: false } };
    const proposal = await tx.decisionScenarioProposal.create({ data: {
      projectId: m.projectId, missionId: m.id, ownerUserId: input.actor.userId, createRequestId: input.requestId,
      purpose: input.purpose, reviewKey, inputHash: input.inputHash, inputJson: json(input.requestInput),
      baseManifest: json(base), scenariosJson: { schemaVersion: 2, pending: true }, proposalHash: jsonHash({ base, purpose: input.purpose }),
      status: "BUILDING", parentId: input.parentId, revision: input.base.attempt, expiresAt: new Date(Date.now() + 15 * 60000),
    } });
    await tx.decisionReviewRequest.create({ data: { ownerUserId: input.actor.userId, requestId: input.requestId, inputHash: input.inputHash, proposalId: proposal.id } });
    await tx.agentMission.update({ where: { id: m.id }, data: { budgetUsedJson: json(used) } });
    return { proposal, existing: false };
  }, { timeout: 20000 });
}
export async function runPreparedReview<T>(actor: CopilotActor, p: DecisionScenarioProposal, prompt: string, schema: z.ZodType<T>,
  normalize: (answer: T, base: ReviewBase, provider: string, usageUnknown: boolean) => ChangeReviewResult | DynamicReviewResult, provider?: ReviewProvider) {
  const base = p.baseManifest as unknown as ReviewBase;
  let reply: AgentExecutionResult<string> | undefined, answer: ChangeReviewResult | DynamicReviewResult | null = null, error: unknown;
  const started = Date.now();
  try {
    if (prompt.length > 22000) throw new AppError("REVIEW_CONTEXT_LIMIT", "复核资料超出本轮范围", 409);
    // The original provider wrapper consumes account quota once; preparation reserves only Mission budget.
    await db.decisionScenarioProposal.update({ where: { id: p.id }, data: { baseManifest: json({ ...base, reservation: { ...base.reservation!, sent: true } }) } });
    reply = await (provider ? provider(prompt, p.purpose as ReviewPurpose) : chatWithLLMWithMeta(prompt, p.projectId, undefined, { userId: actor.userId, sessionId: actor.sessionId, reviewProposalId: p.id }));
    if (!["SUCCESS", "PARTIAL"].includes(reply.status)) throw new AppError("REVIEW_MODEL_FAILED", "模型未提供有效复核，保留原计划", 409);
    answer = normalize(schema.parse(JSON.parse(reply.data)), base, reply.provider, !!reply.usageUnknown);
  } catch (caught) { error = caught; }
  await db.$transaction(async tx => {
    await lock(tx, p.missionId);
    const current = await tx.decisionScenarioProposal.findUniqueOrThrow({ where: { id: p.id } });
    const storedBase = current.baseManifest as unknown as ReviewBase;
    if (storedBase.reservation?.settled) return;
    const m = await tx.agentMission.findUniqueOrThrow({ where: { id: p.missionId } }), used = usageOf(m.budgetUsedJson);
    const notSent = error instanceof AppError && ["CLOUD_ACCESS_DISABLED", "CLOUD_QUOTA_EXHAUSTED", "REVIEW_CONTEXT_LIMIT", "UNAUTHORIZED", "PROJECT_NOT_FOUND", "REVIEW_STOPPED"].includes(error.code);
    if (notSent) { used.models = Math.max(0, used.models - 1); used.unknownCalls = Math.max(0, used.unknownCalls - 1); used.reservedOutputTokens = Math.max(0, used.reservedOutputTokens - 2048); }
    used.activeMs = Math.max(0, used.activeMs - 20000) + (notSent ? 0 : Date.now() - started);
    if (reply?.usage) {
      if (reply.usage.inputTokens !== null) used.inputTokens += reply.usage.inputTokens;
      if (reply.usage.outputTokens !== null) { used.outputTokens += reply.usage.outputTokens; used.reservedOutputTokens = Math.max(0, used.reservedOutputTokens - 2048) + reply.usage.outputTokens; }
      if (reply.usage.inputTokens !== null && reply.usage.outputTokens !== null) used.unknownCalls = Math.max(0, used.unknownCalls - 1);
    }
    let fresh = false;
    try { await reviewMission(actor, p.missionId, tx); fresh = await reviewFresh(base, m, tx); } catch { /* Settle usage even if authorization was revoked while HTTP was in flight. */ }
    const status = error ? reply || notSent ? "FAILED" : "UNKNOWN" : fresh ? "READY" : "STALE";
    const finalBase = { ...base, reservation: { ...base.reservation!, sent: !notSent, settled: true } };
    await tx.agentMission.update({ where: { id: m.id }, data: { budgetUsedJson: json(used) } });
    await tx.decisionScenarioProposal.update({ where: { id: p.id }, data: { status, baseManifest: json(finalBase), scenariosJson: answer ? json(answer) : { schemaVersion: 2, pending: false },
      proposalHash: jsonHash({ base: finalBase, purpose: p.purpose, answer }), receiptJson: error ? json({ code: error instanceof AppError ? error.code : reply ? "INVALID_REVIEW_RESULT" : "REVIEW_INTERRUPTED",
        diagnostic: error instanceof z.ZodError ? error.issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.join("."), message: issue.message.slice(0, 160) })) : null,
        usageUnknown: !reply?.usage || !!reply.usageUnknown }) : undefined } });
    await tx.agentRun.create({ data: { projectId: p.projectId, runType: "CHAT", provider: reply?.provider ?? (provider ? "TEST_FIXTURE" : "change-review-model"),
      status: status === "READY" ? "SUCCESS" : "FAILED", fallbackReason: status === "READY" ? null : status,
      trace: json({ purpose: p.purpose, reviewProposalId: p.id, actorUserId: actor.userId, usage: reply?.usage ?? null, usageUnknown: !reply?.usage || !!reply.usageUnknown, requestIdentity: reply?.requestIdentity ?? null, durationMs: Date.now() - started }) } });
    if (status === "READY") await event(tx, m.id, p.purpose === "CHANGE_REVIEW" ? "CHANGE_REVIEW_READY" : "DYNAMIC_PLAN_READY", { proposalId: p.id });
  }, { timeout: 20000 });
  return readReview(actor, p.id);
}
