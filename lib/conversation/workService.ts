import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { ownedMission } from "@/lib/mission/repository";
import { commandMission } from "@/lib/mission/missionService";
import { premiseFor } from "@/lib/mission/evidenceFitService";
import type { WaitState } from "@/lib/mission/gaps";
import { listContinuationCandidates, previewContinuation, confirmContinuation } from "@/lib/mission/continuationService";
import { previewArtifactAdoption, confirmArtifactAdoption } from "@/lib/mission/artifactAdoptionService";
import { latestScenario, createScenarios, adoptScenario } from "@/lib/decision/scenarios";
import { prepareActionResult, commitActionResult, actionResultVersion, type PreparedActionResult } from "@/lib/services/actionService";
import type { ConversationActor, ConversationProposal } from "@/lib/types/conversation";
import { conversationConfirmSchema } from "@/lib/types/conversation";
import { workRefSchema, workPreviewSchema, type ConversationWork, type ConversationWorkRef } from "@/lib/types/conversationWork";
import { assertProject, emptyBlocks, lockConversation, ownedConversation, record, type Tx } from "./repository";
import { appendConversationMessage, bindRefs, readConversation } from "./service";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";

export async function requireWork(actor: ConversationActor, id: string, ref: ConversationWorkRef, tx: Tx = db) {
  const c = await ownedConversation(actor, id, tx);
  await assertProject(actor, ref.projectId, tx);
  if (c.homeProjectId && c.homeProjectId !== ref.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "请回到原会话范围", 409);
  const bound = await tx.conversationBinding.findFirst({ where: { conversationId: id, projectId: ref.projectId, kind: ref.kind, entityId: ref.id } });
  // An Action created by this conversation is also an exact original object.
  const created = !bound && ref.kind === "ACTION" && await tx.copilotToolExecution.findFirst({ where: {
    resultId: ref.id, tool: "create_action", status: "COMMITTED", sourceRun: { conversationId: id } } });
  if (!bound && !created) throw new AppError("OBJECT_NOT_BOUND", "请先在这段讨论中读取原任务", 409);
  if (ref.kind === "MISSION") {
    const m = await ownedMission(actor.userId, ref.id, tx);
    if (m.projectId !== ref.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "任务与项目不一致", 409);
  } else if (!await tx.actionItem.findFirst({ where: { id: ref.id, projectId: ref.projectId, isSimulated: false } }))
    throw new AppError("ACTION_NOT_FOUND", "没有可访问的真实行动", 404);
  return c;
}
const missionToken = (m: { version: number; contextVersion: number; planRevision: number; status: string }) => jsonHash({ version: m.version, contextVersion: m.contextVersion, planRevision: m.planRevision, status: m.status });
function assertWorkPolicy(pinned: unknown, operation: string, command: Record<string, unknown>) {
  const rules: Record<string, RegExp> = { complete_action: /(?:不要|禁止|不得|不允许).*(?:完成|复盘|结果写入)/,
    adopt_artifact: /(?:不要|禁止|不得|不允许).*(?:归入|分享|成果写入)/,
    adopt_scenario: /(?:不要|禁止|不得|不允许).*改.*计划/,
    approval: /(?:不要|禁止|不得|不允许).*(?:批准|执行)/ };
  const choiceVeto = (v: string) => operation === "adopt_scenario" && /不要|禁止|不选|不接受|拒绝/.test(v) &&
    (command.scenarioKey === "VERIFY_FIRST" ? /先核对|第一[种项个]/.test(v) : /先整理|先交付|草稿|第二[种项个]/.test(v));
  if (Array.isArray(pinned) && pinned.some(v => typeof v === "string" && (/只读|禁止.*(?:操作|写入)/.test(v) || rules[operation]?.test(v) || choiceVeto(v))))
    throw new AppError("READ_ONLY_CONSTRAINT", "这项操作与会话中保留的限制冲突，请另开协作主题", 409);
}
export async function readConversationWork(actor: ConversationActor, id: string, raw: unknown): Promise<ConversationWork> {
  const ref = workRefSchema.parse(raw);
  await requireWork(actor, id, ref);
  const base = { ref, version: 0, contextVersion: 0, planRevision: 0, question: null, approval: null, output: null,
    resultText: null, resultCardId: null, candidates: [], scenario: null };
  if (ref.kind === "ACTION") {
    const a = await db.actionItem.findUniqueOrThrow({ where: { id: ref.id } });
    await requireWork(actor, id, ref);
    return { ...base, title: a.title, status: a.status, versionToken: actionResultVersion(a), resultText: a.resultText, resultCardId: a.resultCardId };
  }
  const m = await ownedMission(actor.userId, ref.id);
  const [q, approval, output, scenario, candidates] = await Promise.all([
    m.status === "WAITING_INPUT" ? db.agentMissionEvent.findFirst({ where: { missionId: m.id, type: "QUESTION" }, orderBy: { seq: "desc" } }) : null,
    m.status === "WAITING_APPROVAL" ? db.agentMissionApproval.findFirst({ where: { missionId: m.id, status: "PENDING" }, orderBy: { id: "desc" } }) : null,
    db.agentMissionOutput.findFirst({ where: { missionId: m.id }, orderBy: { revision: "desc" } }),
    latestScenario(actor, m.id),
    m.status === "WAITING_INPUT" && typeof record(m.waitStateJson).questionId === "string" ? listContinuationCandidates(actor.userId, m.id, { questionId: record(m.waitStateJson).questionId, includeExisting: "1" }) : { candidates: [] },
  ]);
  await requireWork(actor, id, ref);
  const args = record(record(approval?.proposalJson).args);
  return { ...base, title: m.goal, status: m.status, versionToken: missionToken(m), version: m.version, contextVersion: m.contextVersion,
    planRevision: m.planRevision,
    question: q ? { id: q.id, text: String(record(q.payloadJson).question ?? "请补充原问题"), premise: premiseFor(m, m.waitStateJson as unknown as WaitState) } : null,
    approval: approval ? { id: approval.id, proposalHash: approval.proposalHash, title: String(args.title ?? "原委托待批准操作"), description: String(args.description ?? "") } : null,
    output: output ? { id: output.id, revision: output.revision, title: "原任务成果 · 第 " + output.revision + " 版", verificationStatus: output.verificationStatus } : null,
    candidates: candidates.candidates,
    scenario: scenario ? { id: scenario.id, proposalHash: scenario.proposalHash, expectedVersion: scenario.base.expectedVersion,
      status: scenario.status, stale: scenario.stale, choices: scenario.scenarios.map(s => ({ key: s.key, title: s.title, tradeoff: s.tradeoff, feasibility: s.feasibility, reasons: s.reasons })) } : null };
}
const scenarioInput = z.object({ ref: workRefSchema, versionToken: z.string(), requestId: z.string().min(1).max(100),
  availableMinutes: z.number().int().positive().max(100000), deliveryMinutes: z.number().int().positive().max(100000), allowActionProposals: z.boolean().default(false) }).strict();
export async function compareConversationScenarios(actor: ConversationActor, id: string, raw: unknown) {
  const input = scenarioInput.parse(raw), work = await readConversationWork(actor, id, input.ref);
  if (input.ref.kind !== "MISSION" || input.versionToken !== work.versionToken) throw new AppError("MISSION_CHANGED", "任务已变化，请重新读取", 409);
  const s = await createScenarios(actor, input.ref.id, { requestId: "focus:" + id + ":" + input.requestId,
    availableMinutes: input.availableMinutes, deliveryMinutes: input.deliveryMinutes, allowActionProposals: input.allowActionProposals, requestModelAdvice: false });
  await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await requireWork(actor, id, input.ref, tx);
    if (c.activeTurnId) throw new AppError("CONVERSATION_BUSY", "请等本次讨论结束", 409);
    if (await tx.conversationBinding.findFirst({ where: { conversationId: id, kind: "SCENARIO", entityId: s.id } })) return;
    const options = s.scenarios.filter(v => v.key !== "BASELINE").map(v => ({ key: v.key, label: v.title, projectId: s.projectId,
      missionId: s.missionId, proposalId: s.id, proposalHash: s.proposalHash, expectedVersion: s.base.expectedVersion }));
    await tx.conversationBinding.create({ data: { conversationId: id, projectId: s.projectId, kind: "SCENARIO", entityId: s.id, revisionKey: s.proposalHash, valueJson: json(options) } });
    await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", "两种推进方案已准备好，请比较取舍后选择。",
      { ...emptyBlocks(), observedProjectIds: [s.projectId], options, refs: await bindRefs(tx, id, [{ kind: "MISSION", id: s.missionId,
        projectId: s.projectId, title: work.title, href: "/projects/" + s.projectId + "/missions?mission=" + s.missionId }]) });
    await tx.conversation.update({ where: { id }, data: { version: { increment: 1 }, focusJson: { projectId: s.projectId } } });
  });
  return { conversation: await readConversation(actor, id), work: await readConversationWork(actor, id, input.ref) };
}
export async function assessConversationMaterials(actor: ConversationActor, id: string, raw: unknown) {
  const input = workPreviewSchema.parse(raw), work = await readConversationWork(actor, id, input.ref);
  if (work.versionToken !== input.versionToken || !work.question) throw new AppError("INPUT_CHANGED", "原问题已变化", 409);
  return previewContinuation(actor.userId, input.ref.id, { questionId: work.question.id, sourcePointers: input.sourcePointers, ...(input.evidenceReview ? { evidenceReview: input.evidenceReview } : {}) });
}
const labels: Record<string, string> = { input: "提交原问题答复", approval: "处理原待批准操作", resume: "恢复原委托", continuation: "用所选材料接续原问题", adopt_scenario: "采用原方案", adopt_artifact: "将此版成果归入项目", complete_action: "完成行动并保存复盘" };
export async function previewConversationWork(actor: ConversationActor, id: string, raw: unknown, turnId?: string) {
  const input = workPreviewSchema.parse(raw), inputHash = jsonHash(input);
  await requireWork(actor, id, input.ref);
  const key = "work:" + input.requestId;
  const existing = await db.copilotToolExecution.findFirst({ where: { proposalKey: key, sourceRun: { conversationId: id } } });
  if (existing) {
    if (record(existing.proposalJson).inputHash !== inputHash) throw new AppError("REQUEST_ID_REUSED", "预览编号已用于其他内容", 409);
    return { conversation: await readConversation(actor, id) };
  }
  const work = await readConversationWork(actor, id, input.ref);
  if (work.versionToken !== input.versionToken) throw new AppError("OBJECT_CHANGED", "原任务已变化，请重新读取", 409);
  let command: Record<string, unknown> = { expectedVersion: work.version };
  const op = input.operation;
  if (op === "complete_action") {
    if (input.ref.kind !== "ACTION" || !input.answer || input.answer.length > 2000 || ["DONE", "CANCELLED"].includes(work.status)) throw new AppError("ACTION_CHANGED", "请为未完成行动填写实际结果（5—2000字）", 409);
    command = { prepared: await prepareActionResult(input.ref.projectId, input.ref.id, input.answer, true) };
  } else {
    if (input.ref.kind !== "MISSION") throw new AppError("INVALID_OPERATION", "此操作需要原委托", 422);
    if (op === "input") {
      if (!work.question || !input.answer) throw new AppError("INPUT_CHANGED", "原问题已变化或缺少答复", 409);
      command = { ...command, questionId: work.question.id, answer: input.answer, ...(input.evidenceReview ? { evidenceReview: input.evidenceReview } : {}) };
    } else if (op === "approval") {
      if (!work.approval || !input.decision) throw new AppError("APPROVAL_CHANGED", "原批准提案已变化", 409);
      command = { ...command, approvalId: work.approval.id, proposalHash: work.approval.proposalHash, decision: input.decision };
    } else if (op === "resume") {
      if (work.status !== "PAUSED") throw new AppError("MISSION_NOT_PAUSED", "仅暂停的原委托可以恢复", 409);
    } else if (op === "continuation") {
      if (!work.question || !input.answer || !input.sourcePointers) throw new AppError("INVALID_MATERIALS", "请选择资料并填写核对结论", 422);
      const a = await assessConversationMaterials(actor, id, input);
      command = { ...command, questionId: work.question.id, expectedContextVersion: work.contextVersion, answer: input.answer,
        sourcePointers: input.sourcePointers, assessmentHash: a.assessmentHash, confirmedGap: true,
        ...(input.evidenceReview ? { evidenceReview: input.evidenceReview, fitHash: a.fitHash } : {}) };
    } else if (op === "adopt_scenario") {
      if (!work.scenario || work.scenario.id !== input.scenarioProposalId || !input.scenarioKey || work.scenario.stale || work.scenario.status !== "READY") throw new AppError("PROPOSAL_CHANGED", "原方案已变化，请重新对比", 409);
      command = { ...command, proposalId: work.scenario.id, proposalHash: work.scenario.proposalHash, scenarioKey: input.scenarioKey, confirmed: true };
    } else if (op === "adopt_artifact") {
      if (!input.outputId || !input.outputRevision) throw new AppError("OUTPUT_CHANGED", "请选择明确的成果版本", 409);
      const p = await previewArtifactAdoption(actor.userId, input.ref.id, input.outputId, { expectedOutputRevision: input.outputRevision });
      command = { outputId: input.outputId, expectedOutputRevision: input.outputRevision, expectedContextVersion: p.contextVersion, previewHash: p.previewHash, artifactType: "weekly_report" };
    }
  }
  await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await requireWork(actor, id, input.ref, tx);
    const raced = await tx.copilotToolExecution.findFirst({ where: { proposalKey: key, sourceRun: { conversationId: id } } });
    if (raced) { if (record(raced.proposalJson).inputHash !== inputHash) throw new AppError("REQUEST_ID_REUSED", "预览内容不同", 409); return; }
    if ((c.activeTurnId && c.activeTurnId !== turnId) || c.version !== input.expectedConversationVersion) throw new AppError("CONVERSATION_CHANGED", "讨论已变化，请刷新后预览", 409);
    const current = input.ref.kind === "MISSION" ? missionToken(await ownedMission(actor.userId, input.ref.id, tx)) : actionResultVersion(await tx.actionItem.findUniqueOrThrow({ where: { id: input.ref.id } }));
    if (current !== input.versionToken) throw new AppError("OBJECT_CHANGED", "原任务已变化", 409);
    assertWorkPolicy(c.pinnedStateJson, op, command);
    const payload = { schemaVersion: 1, inputHash, ref: input.ref, operation: op, versionToken: input.versionToken,
      contextVersion: work.contextVersion, planRevision: work.planRevision, constraintHash: jsonHash(c.pinnedStateJson), command, expiresAt: Date.now() + 15 * 60 * 1000 };
    const run = await tx.agentRun.create({ data: { projectId: null, conversationId: id, runType: "CHAT", provider: "project_state", status: "SUCCESS",
      trace: { purpose: "FOCUS_WORK_PREVIEW", actorUserId: actor.userId, copilotTargetProjectId: input.ref.projectId } } });
    const e = await tx.copilotToolExecution.create({ data: { sourceRunId: run.id, proposalKey: key, tool: op, proposalJson: json(payload), proposalHash: jsonHash(payload), sourceManifestHash: jsonHash(command) } });
    const description = [input.answer, input.decision === "REJECTED" ? "拒绝原操作" : input.decision === "APPROVED" ? "批准原操作，实际执行仍由原委托运行器完成" : "", op === "adopt_scenario" ? input.scenarioKey : "", op === "adopt_artifact" ? "所选成果将对项目成员可见；保留原来源与验证状态。" : ""].filter(Boolean).join("\n") || "保留原任务的范围、预算与成功条件。";
    const proposal: ConversationProposal = { tool: op, executionId: e.id, projectId: input.ref.projectId, title: labels[op] + "：" + work.title, description, proposalHash: e.proposalHash, status: e.status, resultId: null };
    const refs = await bindRefs(tx, id, [{ ...input.ref, title: work.title, version: work.version, status: work.status,
      href: "/projects/" + input.ref.projectId + (input.ref.kind === "MISSION" ? "/missions?mission=" + input.ref.id : "/actions#action-" + input.ref.id) }]);
    await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", "请核对后确认。", { ...emptyBlocks(), refs, proposal, observedProjectIds: [input.ref.projectId] }, turnId, run.id);
    await tx.conversation.update({ where: { id }, data: { version: { increment: 1 }, ...(turnId ? { activeTurnId: null } : {}), focusJson: { projectId: input.ref.projectId, entityRef: input.ref } } });
    if (turnId) await tx.conversationTurn.update({ where: { id: turnId }, data: { status: "ANSWERED", finishedAt: new Date() } });
  }, { timeout: 20000 });
  return { conversation: await readConversation(actor, id) };
}

export async function confirmConversationWork(actor: ConversationActor, id: string, executionId: string, raw: unknown) {
  const input = conversationConfirmSchema.parse(raw), hash = jsonHash({ executionId, input });
  const result = await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    const e = await tx.copilotToolExecution.findFirst({ where: { id: executionId, sourceRun: { conversationId: id } }, include: { sourceRun: true } });
    if (!e || record(e.sourceRun.trace).purpose !== "FOCUS_WORK_PREVIEW") throw new AppError("PROPOSAL_NOT_FOUND", "协作提案不可访问", 404);
    const p = record(e.proposalJson), ref = workRefSchema.parse(p.ref), op = String(p.operation), cmd = record(p.command);
    await requireWork(actor, id, ref, tx);
    if (input.proposalHash !== e.proposalHash || jsonHash(p) !== e.proposalHash || jsonHash(cmd) !== e.sourceManifestHash) throw new AppError("PROPOSAL_CHANGED", "提案已变化", 409);
    const old = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (old && old.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他确认", 409);
    if (e.status === "COMMITTED") return { projectId: ref.projectId, resultId: e.resultId, alreadyExecuted: true };
    assertWorkPolicy(c.pinnedStateJson, op, cmd);
    if (jsonHash(c.pinnedStateJson) !== p.constraintHash) throw new AppError("CONSTRAINTS_CHANGED", "会话限制已变化，请重新预览", 409);
    if (e.status !== "PENDING" || Number(p.expiresAt) <= Date.now() || c.activeTurnId || record(c.focusJson).projectId !== ref.projectId) throw new AppError("PROPOSAL_EXPIRED", "提案已处理、过期或焦点已切换", 409);
    const current = ref.kind === "MISSION" ? missionToken(await ownedMission(actor.userId, ref.id, tx)) : actionResultVersion(await tx.actionItem.findUniqueOrThrow({ where: { id: ref.id } }));
    if (current !== p.versionToken) throw new AppError("OBJECT_CHANGED", "原任务状态已变化，请重新预览", 409);
    const requestId = "focus-command:" + e.id;
    let resultId = ref.id, receiptText = "已提交到原委托，尚未执行完成。";
    if (op === "complete_action") {
      const r = await commitActionResult(tx, cmd.prepared as PreparedActionResult, async () => { await assertProject(actor, ref.projectId, tx); });
      resultId = r.updatedAction.id; receiptText = "行动已完成，复盘已保存：" + r.card?.id;
    } else if (op === "continuation") {
      const r = await confirmContinuation(actor.userId, ref.id, { ...cmd, requestId }, tx);
      receiptText = r.continued ? "材料已绑定原问题，原委托已就绪。" : "已保存核对，原委托仍在等待：" + r.reason;
    } else if (op === "adopt_scenario") {
      const { proposalId, ...body } = cmd;
      await adoptScenario(actor, String(proposalId), { ...body, requestId }, tx);
      receiptText = "已采用原方案；原委托保留，执行前请核对当前状态。";
    } else if (op === "adopt_artifact") {
      const { outputId, ...body } = cmd;
      const r = await confirmArtifactAdoption(actor.userId, ref.id, String(outputId), { ...body, requestId }, tx);
      resultId = r.artifactId; receiptText = "已归入第 " + r.outputRevision + " 版成果；来源与验证快照随回执保留。";
    } else if (["input", "approval", "resume"].includes(op)) {
      const { approvalId, ...body } = cmd;
      await commandMission(actor.userId, ref.id, op, { ...body, requestId }, typeof approvalId === "string" ? approvalId : undefined,
        m => { if (m.contextVersion !== p.contextVersion || m.planRevision !== p.planRevision) throw new AppError("MISSION_CHANGED", "原任务依据已变化", 409); }, tx);
    } else throw new AppError("UNSUPPORTED_TOOL", "此协作操作尚未开放", 422);
    await tx.copilotToolExecution.update({ where: { id: e.id }, data: { status: "COMMITTED", resultId, committedAt: new Date(), confirmationHash: hash } });
    await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId, inputHash: hash, inputJson: json({ executionId, resultId, receiptText }), baseVersion: c.version, status: "COMMITTED", finishedAt: new Date() } });
    await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", receiptText, { ...emptyBlocks(), observedProjectIds: [ref.projectId] });
    await tx.conversation.update({ where: { id }, data: { version: { increment: 1 } } });
    return { projectId: ref.projectId, resultId, alreadyExecuted: false };
  }, { timeout: 20000 });
  const stateRefreshPending = await refreshProjectStateAfterMutation(result.projectId);
  return { ...result, stateRefreshPending, conversation: await readConversation(actor, id) };
}
