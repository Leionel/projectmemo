import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { confirmCopilotActionInTx } from "@/lib/copilot/confirmation";
import { conversationConfirmSchema } from "@/lib/types/conversation";
import type { ConversationActor } from "@/lib/types/conversation";
import { assertProject, lockConversation, ownedConversation, record } from "./repository";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import { readConversation } from "./service";

export async function confirmConversationAction(actor: ConversationActor, id: string, executionId: string, raw: unknown) {
  const input = conversationConfirmSchema.parse(raw), hash = jsonHash({ executionId, input });
  const result = await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx);
    const execution = await tx.copilotToolExecution.findFirst({ where: { id: executionId,
      tool: "create_action", sourceRun: { conversationId: id } }, include: { sourceRun: true } });
    const target = record(execution?.sourceRun.trace).copilotTargetProjectId;
    if (!execution || typeof target !== "string" || record(execution.sourceRun.trace).actorUserId !== actor.userId)
      throw new AppError("PROPOSAL_NOT_FOUND", "没有可访问的行动提案", 404);
    const projectId = target;
    await assertProject(actor, projectId, tx);
    if (execution.status !== "COMMITTED" && input.expectedConversationVersion !== undefined && c.version !== input.expectedConversationVersion)
      throw new AppError("CONVERSATION_CHANGED", "讨论已变化，请刷新原提案", 409);
    if (execution.proposalHash !== input.proposalHash) throw new AppError("PROPOSAL_CHANGED", "行动提案已变化，请重新核对", 409);
    const previous = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (previous && previous.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他确认", 409);
    if (execution.status !== "COMMITTED" && record(c.focusJson).projectId !== projectId)
      throw new AppError("CONTEXT_SCOPE_CHANGED", "讨论焦点已切换，请先回到提案所属项目", 409);
    const receipt = await confirmCopilotActionInTx(tx, projectId, {
      tool: "create_action", confirmed: true, sourceRunId: execution.sourceRunId,
      payload: record(execution.proposalJson),
    }, actor);
    if (!previous) await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId,
      inputHash: hash, inputJson: json({ kind: "CONFIRM_ACTION", executionId, expectedConversationVersion: input.expectedConversationVersion }), baseVersion: c.version,
      status: "COMMITTED", finishedAt: new Date() } });
    return { projectId, actionId: receipt.result.id, alreadyExecuted: receipt.alreadyExecuted };
  }, { timeout: 20000 });
  const stateRefreshPending = await refreshProjectStateAfterMutation(result.projectId);
  return { ...result, stateRefreshPending, conversation: await readConversation(actor, id) };
}
export async function declineConversationAction(actor: ConversationActor, id: string, executionId: string) {
  await db.$transaction(async tx => {
    await lockConversation(tx, id);
    await ownedConversation(actor, id, tx);
    const execution = await tx.copilotToolExecution.findFirst({ where: { id: executionId, sourceRun: { conversationId: id } }, include: { sourceRun: true } });
    const target = record(execution?.sourceRun.trace).copilotTargetProjectId;
    if (!execution || typeof target !== "string") throw new AppError("PROPOSAL_NOT_FOUND", "提案不存在", 404);
    await assertProject(actor, target, tx);
    if (execution.status === "COMMITTED") throw new AppError("PROPOSAL_COMMITTED", "操作已提交，请查看原回执", 409);
    await tx.copilotToolExecution.update({ where: { id: executionId }, data: { status: "DECLINED" } });
  });
  return { conversation: await readConversation(actor, id) };
}
