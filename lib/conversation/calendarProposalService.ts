import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { calendarEventProposalBaseSchema, refineCalendarEventProposal } from "@/lib/calendar/contracts";
import { confirmCopilotTool, freezeCopilotProposals, readCopilotContext } from "@/lib/copilot/confirmation";
import { conversationConfirmSchema, type ConversationActor, type ConversationProposal } from "@/lib/types/conversation";
import { appendConversationMessage, readConversation } from "./service";
import { emptyBlocks, lockConversation, ownedConversation, record, type Tx } from "./repository";

export const conversationCalendarProposalSchema = calendarEventProposalBaseSchema.extend({
  projectId: z.string().min(1).max(160), requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive(),
}).strict().superRefine(refineCalendarEventProposal);

function summaryOf(payload: z.infer<typeof conversationCalendarProposalSchema>, target: { accountName: string; accountEmail: string; calendarSummary: string; calendarId: string }) {
  const when = payload.allDay ? `${payload.startAt} 至 ${payload.endAt}（全天）` : `${payload.startAt} → ${payload.endAt}（${payload.timeZone}）`;
  return `飞书日历 ${target.accountName || target.accountEmail} / ${target.calendarSummary || target.calendarId} · ${when}${payload.recurrence ? ` · 重复 ${payload.recurrence}` : ""}`;
}

/** User-initiated proposal in the original conversation; it freezes the exact payload and waits for the original confirm route. */
export async function createConversationCalendarProposal(actor: ConversationActor, conversationId: string, raw: unknown) {
  const input = conversationCalendarProposalSchema.parse(raw), hash = jsonHash({ kind: "CREATE_CALENDAR_EVENT", input });
  const result = await db.$transaction(async (tx: Tx) => {
    await lockConversation(tx, conversationId);
    const c = await ownedConversation(actor, conversationId, tx);
    const projectId = input.projectId;
    const previous = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId, requestId: input.requestId } } });
    if (previous) {
      if (previous.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他操作", 409);
      return { replayed: true as const };
    }
    if (c.version !== input.expectedVersion) throw new AppError("CONVERSATION_CHANGED", "讨论已变化，请刷新后重试", 409);
    if (record(c.focusJson).projectId !== projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "讨论焦点已切换，请先回到该项目", 409);
    const connection = await tx.calendarConnection.findFirst({ where: { id: input.connectionId, projectId, ownerUserId: actor.userId, status: "ACTIVE", revokedAt: null } });
    if (!connection) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在、已撤销或不属于当前项目", 404);
    const sources = await readCopilotContext(tx, projectId, actor);
    const run = await tx.agentRun.create({ data: { projectId: null, conversationId, runType: "CHAT", status: "SUCCESS", provider: "user-calendar-proposal",
      trace: { purpose: "FOCUS_CALENDAR_PROPOSAL", actorUserId: actor.userId, copilotTargetProjectId: projectId, r4Draft: true, copilotSources: sources.sourceManifest,
        supportState: "SUPPORTED", supportBasis: "USER_EXPLICIT_CALENDAR_PROPOSAL", proposalExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
      resultJson: {} } });
    const proposed = { kind: "create_calendar_event" as const, label: "创建飞书日程", title: input.title, description: input.description,
      connectionId: input.connectionId, startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone, allDay: input.allDay, recurrence: input.recurrence };
    await tx.agentRun.update({ where: { id: run.id }, data: { resultJson: json({ proposedActions: [proposed] }) } });
    await freezeCopilotProposals(tx, run.id, [proposed], sources.sourceManifest);
    const execution = await tx.copilotToolExecution.findFirstOrThrow({ where: { sourceRunId: run.id } });
    const frozen = record(execution.proposalJson), target = record(frozen.target) as { accountName: string; accountEmail: string; calendarSummary: string; calendarId: string };
    const proposal: ConversationProposal = { tool: "create_calendar_event", executionId: execution.id, projectId, title: input.title,
      description: summaryOf(input, target), proposalHash: execution.proposalHash, status: execution.status, resultId: null };
    const message = await appendConversationMessage(tx, conversationId, actor.userId, "ASSISTANT", "请在核对下方账号、日历、时间与完整描述后确认；批准后才会发送给飞书。",
      { ...emptyBlocks(), refs: [], proposal, observedProjectIds: [projectId] }, undefined, run.id);
    await tx.conversationTurn.create({ data: { conversationId, requestId: input.requestId, inputHash: hash,
      inputJson: json({ kind: "CREATE_CALENDAR_EVENT", executionId: execution.id }), baseVersion: c.version, status: "COMMITTED", finishedAt: new Date() } });
    await tx.conversation.update({ where: { id: conversationId }, data: { version: { increment: 1 } } });
    return { replayed: false as const, messageId: message.id, proposal };
  });
  const conversation = await readConversation(actor, conversationId);
  return result.replayed ? { conversation } : { messageId: result.messageId, proposal: result.proposal, conversation };
}

export async function confirmConversationCalendar(actor: ConversationActor, conversationId: string, executionId: string, raw: unknown) {
  const input = conversationConfirmSchema.parse(raw), hash = jsonHash({ executionId, input });
  const pre = await db.$transaction(async (tx: Tx) => {
    await lockConversation(tx, conversationId);
    const c = await ownedConversation(actor, conversationId, tx);
    const execution = await tx.copilotToolExecution.findFirst({ where: { id: executionId, sourceRun: { conversationId }, tool: "create_calendar_event" }, include: { sourceRun: true } });
    if (!execution || record(execution.sourceRun.trace).actorUserId !== actor.userId) throw new AppError("PROPOSAL_NOT_FOUND", "没有可访问的日历提案", 404);
    const projectId = record(execution.sourceRun.trace).copilotTargetProjectId;
    if (typeof projectId !== "string") throw new AppError("PROPOSAL_NOT_FOUND", "日历提案缺少项目", 404);
    if (execution.status !== "COMMITTED" && input.expectedConversationVersion !== undefined && c.version !== input.expectedConversationVersion)
      throw new AppError("CONVERSATION_CHANGED", "讨论已变化，请刷新原提案", 409);
    if (execution.proposalHash !== input.proposalHash) throw new AppError("PROPOSAL_CHANGED", "日历提案已变化，请重新核对", 409);
    const previous = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId, requestId: input.requestId } } });
    if (previous && previous.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他确认", 409);
    if (execution.status === "DECLINED") throw new AppError("PROPOSAL_DECLINED", "你已否决这项提案，请重新讨论", 409);
    if (execution.status === "UNKNOWN" || execution.status === "FAILED") throw new AppError("COPILOT_RESULT_NOT_RETRYABLE", "原外部写入结果不可自动重试；请核对原回执", 409);
    if (execution.status !== "COMMITTED" && record(c.focusJson).projectId !== projectId)
      throw new AppError("CONTEXT_SCOPE_CHANGED", "讨论焦点已切换，请先回到提案所属项目", 409);
    if (!previous) await tx.conversationTurn.create({ data: { conversationId, requestId: input.requestId, inputHash: hash,
      inputJson: json({ kind: "CONFIRM_CALENDAR_EVENT", executionId, expectedConversationVersion: input.expectedConversationVersion }), baseVersion: c.version,
      status: "COMMITTED", finishedAt: new Date() } });
    return { projectId, sourceRunId: execution.sourceRunId, payload: record(execution.proposalJson).payload };
  });
  const receipt = await confirmCopilotTool(pre.projectId, { tool: "create_calendar_event", confirmed: true, sourceRunId: pre.sourceRunId, payload: record(pre.payload) }, actor);
  return { ...receipt, conversation: await readConversation(actor, conversationId) };
}
