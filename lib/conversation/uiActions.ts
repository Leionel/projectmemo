import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { confirmConversationAction, declineConversationAction } from "./commands";
import { ownedConversation, record } from "./repository";
import { readConversation } from "./service";
import { conversationHref } from "./navigation";
import type { ConversationActor } from "@/lib/types/conversation";
import { jsonHash } from "@/lib/mission/contracts";
import { readConversationWork, previewConversationWork } from "./workService";

const inputSchema = z.object({ messageId: z.string().min(1).max(160), bindingId: z.string().min(1).max(200),
  requestId: z.string().min(1).max(160), expectedConversationVersion: z.number().int().positive() }).strict();
/** Re-resolves the original server binding; no model/client URL, command or target payload is accepted. */
export async function performConversationUIAction(actor: ConversationActor, id: string, raw: unknown) {
  const input = inputSchema.parse(raw);
  await ownedConversation(actor, id);
  const row = await db.agentMessage.findFirst({ where: { id: input.messageId, conversationId: id, ownerUserId: actor.userId } });
  if (!row?.seq) throw new AppError("MESSAGE_NOT_FOUND", "原回答不可访问", 404);
  const view = await readConversation(actor, id, row.seq + 1), message = view.messages.find(m => m.id === row.id);
  if (!message || message.restricted) throw new AppError("MESSAGE_NOT_FOUND", "原回答不可访问", 404);
  const previewRequestId = "ui-review:" + jsonHash(input);
  if (message.reviewRef && input.bindingId.startsWith("preview-review:" + message.reviewRef.id + ":")) {
    const replay = await db.copilotToolExecution.findFirst({ where: { proposalKey: "work:" + previewRequestId, sourceRun: { conversationId: id } } });
    if (replay) return { conversation: await readConversation(actor, id) };
  }
  // A completed retry may no longer render a confirm button. Only its exact recorded request can replay.
  const prior = await db.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
  const saved = record(prior?.inputJson);
  if (message.proposal && typeof saved.executionId === "string" && saved.kind === "CONFIRM_ACTION" && input.bindingId === "confirm:" + saved.executionId &&
    saved.expectedConversationVersion === input.expectedConversationVersion && message.proposal?.executionId === saved.executionId)
    return confirmConversationAction(actor, id, String(saved.executionId), { requestId: input.requestId, expectedConversationVersion: input.expectedConversationVersion,
      proposalHash: message.proposal.proposalHash, confirmed: true });
  if (view.version !== input.expectedConversationVersion) throw new AppError("CONVERSATION_CHANGED", "讨论已变化，请刷新后再选择", 409);
  const action = message.presentation?.allowedActions.find(a => a.bindingId === input.bindingId);
  if (!action || !action.enabled) throw new AppError("UI_ACTION_UNAVAILABLE", action?.disabledReason ?? "这个操作已不可用，请读取原状态", 409);
  if (action.actionKind === "PREVIEW" && message.reviewRef?.id === action.target.id && action.frozen?.candidateId) {
    const ref = { kind: "MISSION" as const, id: message.reviewRef.missionId, projectId: message.reviewRef.projectId };
    const work = await readConversationWork(actor, id, ref);
    return previewConversationWork(actor, id, { requestId: previewRequestId, expectedConversationVersion: input.expectedConversationVersion,
      ref, versionToken: work.versionToken, operation: "adopt_dynamic", dynamicProposalId: action.target.id, candidateId: action.frozen.candidateId });
  }
  if (action.actionKind === "CONFIRM" && action.frozen?.executionId)
    return confirmConversationAction(actor, id, action.frozen.executionId, { requestId: input.requestId,
      proposalHash: action.frozen.proposalHash, confirmed: true, expectedConversationVersion: input.expectedConversationVersion });
  if (action.actionKind === "DECLINE" && action.frozen?.executionId)
    return declineConversationAction(actor, id, action.frozen.executionId);
  if (action.actionKind === "OPEN" && action.target.kind === "ACTION")
    return { href: conversationHref(`/projects/${encodeURIComponent(action.target.projectId)}/actions#action-${encodeURIComponent(action.target.id)}`, id, row.id), conversation: await readConversation(actor, id) };
  if (action.actionKind === "ASK") return { questionId: action.target.id, conversation: await readConversation(actor, id) };
  if (action.actionKind === "REFRESH") return { conversation: await readConversation(actor, id) };
  throw new AppError("UI_ACTION_UNAVAILABLE", "请从原任务预览这项操作", 409);
}
