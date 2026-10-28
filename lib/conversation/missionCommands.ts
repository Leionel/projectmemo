import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { ownedMission } from "@/lib/mission/repository";
import { commandMission } from "@/lib/mission/missionService";
import { conversationConfirmSchema } from "@/lib/types/conversation";
import type { ConversationActor, ConversationProposal } from "@/lib/types/conversation";
import { emptyBlocks, lockConversation, ownedConversation, record } from "./repository";
import { appendConversationMessage, bindRefs, readConversation } from "./service";
import { confirmConversationAction } from "./commands";
import { confirmConversationWork } from "./workService";
import { effectiveContinuity, assertContinuityBinding } from "@/lib/continuity/directiveService";

const payloadSchema = z.object({ missionId: z.string(), projectId: z.string(), expectedVersion: z.number(),
  contextVersion: z.number(), planRevision: z.number(), continuity: z.object({ intentHash: z.string(), reusePolicyHash: z.string() }).optional() }).strict();
export async function previewConversationResume(actor: ConversationActor, id: string, missionId: string) {
  await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx), m = await ownedMission(actor.userId, missionId, tx);
    if (c.activeTurnId) throw new AppError("CONVERSATION_BUSY", "请等本次讨论完成后再预览", 409);
    if (!await tx.conversationBinding.findFirst({ where: { conversationId: id, kind: "MISSION", entityId: m.id, projectId: m.projectId } }))
      throw new AppError("MISSION_NOT_BOUND", "先读取并讨论这条原委托", 409);
    if (m.status !== "PAUSED") throw new AppError("MISSION_NOT_PAUSED", "仅暂停的原委托可以恢复，其他状态请核对原问题", 409);
    const continuity = await effectiveContinuity(actor.userId, { projectId: m.projectId, conversationId: id }, tx);
    const key = "resume:" + m.id + ":" + m.version + ":" + continuity.intentHash;
    const previous = await tx.copilotToolExecution.findFirst({ where: { proposalKey: key, tool: "resume_mission", sourceRun: { conversationId: id } } });
    if (previous) return;
    const payload = { missionId: m.id, projectId: m.projectId, expectedVersion: m.version,
      contextVersion: m.contextVersion, planRevision: m.planRevision, continuity: { intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash } };
    const run = await tx.agentRun.create({ data: { projectId: null, conversationId: id, runType: "CHAT", provider: "project_state",
      status: "SUCCESS", trace: { purpose: "FOCUS_RESUME_PREVIEW", actorUserId: actor.userId, copilotTargetProjectId: m.projectId }, resultJson: {} } });
    const e = await tx.copilotToolExecution.create({ data: { sourceRunId: run.id, proposalKey: key, tool: "resume_mission",
      proposalJson: payload, proposalHash: jsonHash(payload), sourceManifestHash: jsonHash(payload) } });
    const proposal: ConversationProposal = { tool: "resume_mission", executionId: e.id, projectId: m.projectId,
      title: "接续原委托：" + m.goal, description: "恢复原任务及其现有范围、预算和成功条件，不新建委托。",
      proposalHash: e.proposalHash, status: e.status, resultId: null };
    const refs = await bindRefs(tx, id, [{ kind: "MISSION", id: m.id, projectId: m.projectId, title: m.goal, status: m.status,
      version: m.version, href: "/projects/" + m.projectId + "/missions?mission=" + m.id }]);
    await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", proposal.description,
      { ...emptyBlocks(), refs, proposal, observedProjectIds: [m.projectId] });
    await tx.conversation.update({ where: { id }, data: { focusJson: { projectId: m.projectId }, version: { increment: 1 } } });
  });
  return { conversation: await readConversation(actor, id) };
}
export async function confirmConversationProposal(actor: ConversationActor, id: string, executionId: string, raw: unknown) {
  await ownedConversation(actor, id);
  const execution = await db.copilotToolExecution.findFirst({ where: { id: executionId, sourceRun: { conversationId: id } } });
  if (!execution) throw new AppError("PROPOSAL_NOT_FOUND", "原提案不存在", 404);
  if (execution.tool === "create_action") return confirmConversationAction(actor, id, executionId, raw);
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: execution.sourceRunId } });
  if (record(run.trace).purpose === "FOCUS_WORK_PREVIEW") return confirmConversationWork(actor, id, executionId, raw);
  if (execution.tool !== "resume_mission") throw new AppError("UNSUPPORTED_TOOL", "此操作尚未开放", 422);
  const input = conversationConfirmSchema.parse(raw), hash = jsonHash({ executionId, input });
  const result = await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx);
    const e = await tx.copilotToolExecution.findUniqueOrThrow({ where: { id: executionId } });
    const p = payloadSchema.parse(e.proposalJson);
    await ownedMission(actor.userId, p.missionId, tx);
    if (input.proposalHash !== e.proposalHash || jsonHash(p) !== e.proposalHash) throw new AppError("PROPOSAL_CHANGED", "原提案已变化", 409);
    const old = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (old && old.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他选择", 409);
    if (e.status === "COMMITTED") return { missionId: p.missionId, alreadyExecuted: true };
    await assertContinuityBinding(actor.userId, { projectId: p.projectId, conversationId: id }, p.continuity, tx);
    if (e.status !== "PENDING" || record(c.focusJson).projectId !== p.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "提案已处理或讨论焦点已变化", 409);
    await commandMission(actor.userId, p.missionId, "resume", { requestId: "conversation:" + e.id, expectedVersion: p.expectedVersion },
      undefined, m => { if (m.contextVersion !== p.contextVersion || m.planRevision !== p.planRevision) throw new AppError("MISSION_CHANGED", "委托依据已变化，请重新预览", 409); }, tx);
    await tx.copilotToolExecution.update({ where: { id: e.id }, data: { status: "COMMITTED", resultId: p.missionId, committedAt: new Date(), confirmationHash: hash } });
    if (!old) await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId, inputHash: hash,
      inputJson: json({ kind: "RESUME_MISSION", executionId }), baseVersion: c.version, status: "COMMITTED", finishedAt: new Date() } });
    return { missionId: p.missionId, alreadyExecuted: false };
  });
  return { ...result, conversation: await readConversation(actor, id) };
}
