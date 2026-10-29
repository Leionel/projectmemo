import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { structureCapture } from "@/lib/agent";
import { ActionStatus, AgentRunStatus, AgentRunType, InterventionStatus, KnowledgeType } from "@/lib/generated/prisma/client";
import { KeywordVectorStore } from "@/lib/memory/vectorStore";
import { loadRecentCards } from "@/lib/repositories/cards";
import { findAction, updateAction } from "@/lib/repositories/agent";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/repositories/projects";
import { saveAgentRun } from "@/lib/repositories/agent";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import type { Prisma } from "@/lib/generated/prisma/client";
import { jsonHash } from "@/lib/mission/contracts";

const vectorStore = new KeywordVectorStore();

export const actionResultVersion = (action: { id: string; projectId: string; status: string; updatedAt: Date; resultCardId: string | null; isSimulated: boolean }) =>
  jsonHash({ id: action.id, projectId: action.projectId, status: action.status, updatedAt: action.updatedAt, resultCardId: action.resultCardId, isSimulated: action.isSimulated });
/** Prepare outside the write transaction; callers can explicitly select local rules. */
export async function prepareActionResult(projectId: string, actionId: string, resultText: string, localOnly = false) {
  const cleanResult = resultText.trim();
  if (cleanResult.length < 5) throw new AppError("INVALID_ACTION_RESULT", "请至少填写 5 个字的完成结果", 400);
  if (cleanResult.length > 2000) throw new AppError("INVALID_ACTION_RESULT", "完成结果不能超过 2000 个字", 400);
  const action = await findAction(projectId, actionId);
  if (action.isSimulated) throw new AppError("SIMULATED_ACTION", "演示模拟行动不会写入真实复盘，请清除模拟后再执行", 409);
  if (action.status === ActionStatus.CANCELLED) throw new AppError("ACTION_CANCELLED", "已取消的行动不能完成", 409);

  const project = await requireProject(projectId);
  const existingCards = await loadRecentCards(projectId);
  const historyKeywords = [...new Set(existingCards.flatMap((card) => card.keywords))].slice(0, 30);
  const draft = localOnly ? { type: "reflection" as const, title: action.title.slice(0, 100) + " · 行动复盘", summary: cleanResult,
    keywords: [] as string[], relatedTasks: [] as string[], nextActions: [] as string[], importance: 3 } : await structureCapture({
    project,
    rawText: cleanResult,
    historyKeywords,
    preferredType: "reflection",
  });
  const links = await vectorStore.search(draft, existingCards, 3);
  const captureId = randomUUID();
  const cardId = randomUUID();
  return { projectId, actionId, cleanResult, draft, links, captureId, cardId, actionVersion: actionResultVersion(action) };
}
export type PreparedActionResult = Awaited<ReturnType<typeof prepareActionResult>>;
export async function commitActionResult(tx: Prisma.TransactionClient, prepared: PreparedActionResult, guard?: () => Promise<void>) {
    const { projectId, actionId, cleanResult, draft, links, captureId, cardId } = prepared;
    await guard?.();
    // 事务内原子检查：防止并发调用导致创建多张复盘卡
    const currentAction = await tx.actionItem.findUnique({
      where: { id: actionId },
    });
    if (!currentAction || currentAction.projectId !== projectId) throw new AppError("ACTION_NOT_FOUND", "行动不存在", 404);
    if (currentAction.isSimulated || currentAction.status === ActionStatus.CANCELLED) throw new AppError("ACTION_CHANGED", "行动已取消或属于模拟数据", 409);
    if (currentAction.status === ActionStatus.DONE && currentAction.resultCardId) {
      const existingCard = await tx.knowledgeCard.findUnique({
        where: { id: currentAction.resultCardId },
      });
      return { card: existingCard, updatedAction: currentAction, alreadyDone: true };
    }
    if (actionResultVersion(currentAction) !== prepared.actionVersion) throw new AppError("ACTION_CHANGED", "行动已变化，请重新核对完成结果", 409);

    await tx.capture.create({
      data: { id: captureId, projectId, rawText: cleanResult, sourceType: "Agent行动回执" },
    });
    const card = await tx.knowledgeCard.create({
      data: {
        id: cardId,
        projectId,
        captureId,
        type: KnowledgeType.reflection,
        title: draft.title,
        summary: draft.summary,
        keywords: draft.keywords,
        relatedTasks: draft.relatedTasks,
        nextActions: draft.nextActions,
        importance: draft.importance,
      },
    });
    if (links.length) {
      await tx.cardRelation.createMany({
        data: links.map((link) => ({
          currentCardId: cardId,
          relatedCardId: link.relatedCardId,
          reason: link.reason,
          score: link.score,
        })),
      });
    }
    const updatedAction = await tx.actionItem.update({
      where: { id: actionId },
      data: {
        status: ActionStatus.DONE,
        resultText: cleanResult,
        resultCardId: cardId,
        completedAt: new Date(),
      },
    });
    if (currentAction.sourceInterventionId) {
      await tx.agentIntervention.update({
        where: { id: currentAction.sourceInterventionId },
        data: { status: InterventionStatus.RESOLVED, handledAt: new Date() },
      });
    }
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return { card, updatedAction, alreadyDone: false };
}
export async function completeProjectAction(projectId: string, actionId: string, resultText: string) {
  const startedAt = Date.now();
  if (resultText.trim().length < 5) throw new AppError("INVALID_ACTION_RESULT", "请至少填写 5 个字的完成结果", 400);
  if (resultText.trim().length > 2000) throw new AppError("INVALID_ACTION_RESULT", "完成结果不能超过 2000 个字", 400);
  const action = await findAction(projectId, actionId);
  if (action.status === "DONE" && action.resultCardId && !action.isSimulated) return { ...action,
    resultCard: await db.knowledgeCard.findUnique({ where: { id: action.resultCardId } }), stateRefreshPending: false };
  const prepared = await prepareActionResult(projectId, actionId, resultText);
  const result = await db.$transaction(tx => commitActionResult(tx, prepared));
  if (result.alreadyDone) {
    return { ...result.updatedAction, resultCard: result.card, stateRefreshPending: false };
  }
  const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
  if (result.card) {
    await vectorStore.index({ id: result.card.id, title: result.card.title, keywords: result.card.keywords as string[] });
  }
  const run = await saveAgentRun({
    projectId,
    runType: AgentRunType.ACTION,
    status: AgentRunStatus.SUCCESS,
    provider: process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY ? "agent+rules" : "mock",
    trace: {
      actionId,
      resultCardId: result.card?.id ?? null,
      linkedCardIds: prepared.links.map((link) => link.relatedCardId),
      rule: "completed_action_creates_reflection_card",
    },
    durationMs: Date.now() - startedAt,
  });
  return { ...result.updatedAction, resultCard: result.card, run, stateRefreshPending };
}

export async function updateProjectAction(projectId: string, actionId: string, input: Parameters<typeof updateAction>[2]) {
  if (input.status === "DONE") {
    const existing = await findAction(projectId, actionId);
    return completeProjectAction(projectId, actionId, input.resultText ?? existing.resultText ?? "完成行动并记录结果");
  }
  return updateAction(projectId, actionId, input);
}
