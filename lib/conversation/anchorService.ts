import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { ownedMission, event, validateSources } from "@/lib/mission/repository";
import { currentMissionGoalQuestionInTx, interactGoalQuestion } from "@/lib/decision/questions";
import { previewContinuationInTx } from "@/lib/mission/continuationService";
import { readProjectMaterialView } from "@/lib/mission/sourceSignals";
import type { ConversationAnchor } from "@/lib/generated/prisma/client";
import { anchorCommandSchema, type AnchorView } from "@/lib/types/conversationAnchor";
import { conversationCreateSchema, conversationEntrySchema, type ConversationActor, type ConversationBlocks, type ConversationRef } from "@/lib/types/conversation";
import { assertProject, assertSession, emptyBlocks, lockConversation, ownedConversation, record, type Tx } from "./repository";
import { appendConversationMessage, bindRefs, readConversation } from "./service";
import { readConversationEntry } from "./entry";

const enabled = () => isFeatureEnabled("FOCUS_AGENT_FOLLOW_ENABLED", false);
type Snapshot = { key: string; content: string; refs: ConversationRef[]; sources?: ConversationBlocks["sources"]; silent?: boolean };
async function allowed(actor: ConversationActor, a: ConversationAnchor, tx: Tx) {
  await assertProject(actor, a.projectId, tx);
  if (a.missionId) { const m = await ownedMission(actor.userId, a.missionId, tx); if (m.projectId !== a.projectId) throw new AppError("ANCHOR_NOT_FOUND", "原主题已不可访问", 404); }
}
async function projectSnapshot(tx: Tx, actor: ConversationActor, a: ConversationAnchor, s: Snapshot, baseline = false) {
  if (await tx.conversationAnchorProjection.findUnique({ where: { anchorId_revisionKey: { anchorId: a.id, revisionKey: s.key } } })) return false;
  const blocks = { ...emptyBlocks(), refs: await bindRefs(tx, a.conversationId, s.refs), sources: s.sources ?? [], observedProjectIds: [a.projectId] };
  let messageId: string | null = null, seq: number | null = null;
  if (!baseline) {
    seq = (await tx.conversationAnchor.update({ where: { id: a.id }, data: { projectedSeq: { increment: 1 } } })).projectedSeq;
    messageId = (await appendConversationMessage(tx, a.conversationId, actor.userId, "ASSISTANT", s.content, blocks)).id;
    await tx.conversation.update({ where: { id: a.conversationId }, data: { version: { increment: 1 } } });
  }
  await tx.conversationAnchorProjection.create({ data: { anchorId: a.id, revisionKey: s.key, seq, messageId, payloadJson: json({ content: s.content, blocks }) } });
  return !baseline;
}
/** A caller explicitly opening an entry may read it; merely listing reminders never creates a conversation. */
export async function openConversationEntry(actor: ConversationActor, raw: unknown) {
  const input = conversationCreateSchema.parse(raw), hash = jsonHash(input);
  if (!input.entry) throw new AppError("ENTRY_REQUIRED", "请选择原提醒或问题", 422);
  const entry = input.entry;
  return db.$transaction(async tx => {
    // Serialize entry aliases before reading either unique identity; no orphan conversation on races.
    await tx.authSession.updateMany({ where: { id: actor.sessionId, userId: actor.userId }, data: { id: actor.sessionId } });
    await assertSession(actor, tx);
    const receipt = await tx.conversationEntryRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId: input.requestId } } });
    if (receipt) {
      if (receipt.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "入口编号已用于其他主题", 409);
      await ownedConversation(actor, receipt.conversationId, tx); await assertProject(actor, entry.projectId, tx);
      const original = await tx.conversationAnchor.findFirst({ where: { conversationId: receipt.conversationId, ownerUserId: actor.userId, projectId: entry.projectId } });
      if (!original) throw new AppError("ANCHOR_NOT_FOUND", "原主题不可访问", 404);
      await allowed(actor, original, tx); return { id: receipt.conversationId };
    }
    const legacy = await tx.conversation.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: actor.userId, createRequestId: input.requestId } } });
    if (legacy && legacy.createInputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一段讨论", 409);
    if (legacy) {
      await ownedConversation(actor, legacy.id, tx); await assertProject(actor, entry.projectId, tx);
      const original = await tx.conversationAnchor.findFirst({ where: { conversationId: legacy.id, ownerUserId: actor.userId, projectId: entry.projectId } });
      if (!original) throw new AppError("ANCHOR_NOT_FOUND", "原主题不可访问", 404);
      await allowed(actor, original, tx);
      await tx.conversationEntryRequest.create({ data: { ownerUserId: actor.userId, requestId: input.requestId, inputHash: hash, conversationId: legacy.id } });
      return { id: legacy.id };
    }
    if (input.projectId) await assertProject(actor, input.projectId, tx);
    if (input.scope === "PROJECT" && input.projectId !== entry.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "提醒不属于这段项目讨论", 409);
    const source = await readConversationEntry(actor, entry, tx);
    const rootKey = jsonHash({ user: actor.userId, project: entry.projectId, topic: source.missionId ? "mission:" + source.missionId : entry.kind + ":" + entry.id, scope: input.scope });
    let a = await tx.conversationAnchor.findUnique({ where: { rootKey } });
    if (!a && source.missionId) a = await tx.conversationAnchor.findFirst({ where: { ownerUserId: actor.userId, projectId: entry.projectId, missionId: source.missionId,
      conversation: { scope: input.scope } }, orderBy: { id: "asc" } });
    if (!a) a = await tx.conversationAnchor.findUnique({ where: { ownerUserId_originKind_originId_topicKey: { ownerUserId: actor.userId, originKind: entry.kind, originId: entry.id, topicKey: "DISCUSS" } } });
    const isNew = !a;
    if (!a) {
      const c = legacy ?? await tx.conversation.create({ data: { ownerUserId: actor.userId, createRequestId: input.requestId, createInputHash: hash,
        scope: input.scope, homeProjectId: input.scope === "PROJECT" ? input.projectId : null, title: input.title ?? source.ref.title.slice(0, 100), focusJson: { projectId: entry.projectId } } });
      a = await tx.conversationAnchor.create({ data: { ownerUserId: actor.userId, conversationId: c.id, projectId: entry.projectId,
        originKind: entry.kind, originId: entry.id, originRevision: source.revision, rootKey, missionId: source.missionId,
        originEntryJson: json({ entry, title: source.ref.title }), eventCursor: source.missionId ? (await ownedMission(actor.userId, source.missionId, tx)).nextEventSeq : 0 } });
    } else {
      const c = await ownedConversation(actor, a.conversationId, tx);
      if (c.homeProjectId && c.homeProjectId !== entry.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "请打开关联原会话，或另开项目讨论", 409);
      await allowed(actor, a, tx);
      if (c.activeTurnId) throw new AppError("CONVERSATION_BUSY", "请等本次讨论结束后读取修订", 409);
    }
    // Adopt the original F1 opening message without copying it when the revision did not change.
    if (!isNew && !a.projectedSeq && a.originRevision === source.revision) {
      const first = await tx.agentMessage.findFirst({ where: { conversationId: a.conversationId, ownerUserId: actor.userId, role: "ASSISTANT" }, orderBy: { seq: "asc" } });
      if (first) await tx.conversationAnchorProjection.create({ data: { anchorId: a.id, revisionKey: "origin:" + source.revision, seq: 1, messageId: first.id,
        payloadJson: json({ content: first.content, blocks: first.blocksJson }) } });
      if (first) a = await tx.conversationAnchor.update({ where: { id: a.id }, data: { projectedSeq: 1, seenSeq: 1 } });
    }
    const refs: ConversationRef[] = [source.ref];
    if (source.missionId) { const m = await ownedMission(actor.userId, source.missionId, tx); refs.push({ kind: "MISSION", id: m.id, projectId: m.projectId, title: m.goal, version: m.version, status: m.status, href: "/projects/" + m.projectId + "/missions?mission=" + m.id }); }
    await projectSnapshot(tx, actor, a, { key: "origin:" + source.revision, content: (isNew ? "" : "原主题有了修订。\n") + source.ref.title + "\n" + source.text, refs });
    const current = await tx.conversationAnchor.findUniqueOrThrow({ where: { id: a.id } });
    await tx.conversationAnchor.update({ where: { id: a.id }, data: { rootKey: a.rootKey ?? rootKey, missionId: source.missionId,
      originRevision: source.revision, originEntryJson: json({ entry, title: source.ref.title }), ...(isNew ? { seenSeq: current.projectedSeq } : {}) } });
    await tx.conversationEntryRequest.create({ data: { ownerUserId: actor.userId, requestId: input.requestId, inputHash: hash, conversationId: a.conversationId } });
    return { id: a.conversationId };
  }, { timeout: 20000 });
}
export async function listConversationAnchors(actor: ConversationActor, id: string) {
  await ownedConversation(actor, id);
  const rows = await db.conversationAnchor.findMany({ where: { conversationId: id, ownerUserId: actor.userId }, orderBy: { id: "asc" }, take: 20 });
  const anchors: AnchorView[] = [];
  for (const a of rows) {
    try { await allowed(actor, a, db); } catch (e) { if (e instanceof AppError && e.status === 404) continue; throw e; }
    anchors.push({ id: a.id, conversationId: id, projectId: a.projectId, title: String(record(a.originEntryJson).title ?? "原主题"),
      originKind: a.originKind, originId: a.originId, topicKey: a.topicKey, missionId: a.missionId, mode: a.mode as AnchorView["mode"], version: a.version,
      snoozedUntil: a.snoozedUntil?.toISOString() ?? null, projectedSeq: a.projectedSeq, seenSeq: a.seenSeq, unread: Math.max(0, a.projectedSeq - a.seenSeq) });
  }
  await assertSession(actor);
  return { enabled: enabled(), anchors };
}
async function missionSnapshots(tx: Tx, actor: ConversationActor, a: ConversationAnchor, batch?: Array<{ type: string; payloadJson: unknown }>): Promise<Snapshot[]> {
  if (!a.missionId) return [];
  const m = await ownedMission(actor.userId, a.missionId, tx);
  const ref: ConversationRef = { kind: "MISSION", id: m.id, projectId: m.projectId, title: m.goal, status: m.status, version: m.version,
    href: "/projects/" + m.projectId + "/missions?mission=" + m.id };
  const wait = record(m.waitStateJson);
  const question = m.status === "WAITING_INPUT" ? await tx.agentMissionEvent.findFirst({ where: { missionId: m.id, type: "QUESTION" }, orderBy: { seq: "desc" } }) : null;
  const approval = m.status === "WAITING_APPROVAL" ? await tx.agentMissionApproval.findFirst({ where: { missionId: m.id, status: "PENDING" }, orderBy: { id: "desc" } }) : null;
  const snapshots: Snapshot[] = [{ key: "state:" + jsonHash({ status: m.status, plan: m.planRevision, context: m.contextVersion, questionId: question?.id, approvalId: approval?.id }),
    content: m.status === "WAITING_INPUT" ? "原委托正在等待补充：\n" + String(record(question?.payloadJson).question ?? wait.question ?? "请核对原问题")
      : m.status === "WAITING_APPROVAL" ? "原委托有一项待批准操作。请先核对原提案；尚未执行。"
      : m.status === "SUCCEEDED" ? "原委托的服务端成功条件已验收。现实结果仍以具体证据与回执为准。"
      : m.status === "CANCELLED" ? "原委托已取消，已有记录仍保留。"
      : m.status === "PAUSED" ? "原委托已暂停，原计划与依据需要重新核对。" : "原委托状态已更新：" + m.status + "。", refs: [ref] }];
  const ownCommands = await tx.copilotToolExecution.findMany({ where: { resultId: m.id, status: "COMMITTED", sourceRun: { conversationId: a.conversationId },
    tool: { in: ["input", "approval", "resume", "resume_mission", "continuation", "adopt_scenario", "adopt_dynamic"] } }, orderBy: { updatedAt: "desc" }, take: 5 });
  snapshots[0].silent = ownCommands.some(e => Number(record(record(e.proposalJson).command).expectedVersion ?? record(e.proposalJson).expectedVersion) === m.version - 1);
  const reviewIds = batch?.filter(e => ["CHANGE_REVIEW_READY", "DYNAMIC_PLAN_READY"].includes(e.type)).map(e => record(e.payloadJson).proposalId).filter((id): id is string => typeof id === "string");
  const reviews = await tx.decisionScenarioProposal.findMany({ where: { missionId: m.id, ownerUserId: actor.userId,
    purpose: { in: ["CHANGE_REVIEW", "DYNAMIC_PLAN"] }, status: "READY", ...(batch ? { id: { in: reviewIds ?? [] } } : {}) }, orderBy: { createdAt: "desc" }, take: 4 });
  for (const review of reviews) {
    const result = record(review.scenariosJson);
    if (typeof result.summary !== "string" || result.decision === "KEEP_PLAN") continue;
    const { reviewFresh } = await import("@/lib/decision/reviewPersistence");
    if (!await reviewFresh(review.baseManifest as unknown as import("@/lib/types/changeReview").ReviewBase, m, tx)) continue;
    const alreadyProjected = await tx.agentMessage.findFirst({ where: { conversationId: a.conversationId,
      blocksJson: { path: "$.reviewRef.id", equals: review.id } }, select: { id: true } });
    snapshots.push({ key: "review:" + review.id + ":" + review.proposalHash, refs: [ref], silent: !!alreadyProjected,
      content: (review.purpose === "CHANGE_REVIEW" ? "原资料变化复核已返回：\n" : "本轮推进方案已返回：\n") + result.summary + "\n可在原任务协作中读取，尚未采用或执行。" });
  }
  const reads = await tx.agentMissionStep.findMany({ where: { missionId: m.id, status: "SUCCEEDED", toolName: "read_project_material" }, orderBy: { ordinal: "desc" }, take: 4 });
  for (const read of reads) {
    if (record(read.protocolJson).purpose !== "DYNAMIC_READ") continue;
    const result = read.resultJson as unknown as import("@/lib/mission/contracts").ToolResult;
    try { await validateSources(m.projectId, result.sources, tx, m.id); } catch (e) { if (e instanceof AppError) continue; throw e; }
    snapshots.push({ key: "review-read:" + read.id, refs: [ref], content: "原委托已读回所选资料，等待你核对：\n" + result.sources.map(s => s.text.slice(0, 600)).join("\n"),
      sources: result.sources.map(s => ({ id: m.projectId + "/" + s.id, projectId: m.projectId, sourceId: s.id, revision: s.hash, title: "本轮读取资料", excerpt: s.text.slice(0, 600), start: 0, end: Math.min(600, s.text.length), excerptHash: jsonHash(s.text.slice(0, 600)), observedAt: s.observedAt, temporalState: s.temporalState ?? "UNKNOWN", knowledgeClass: s.knowledgeClass ?? "PROJECT_OBSERVATION" })) });
  }
  const outputIds = batch?.filter(e => e.type === "TOOL_FINISHED").map(e => record(record(record(e.payloadJson).result).data).outputId).filter((id): id is string => typeof id === "string") ?? [];
  const outputs = await tx.agentMissionOutput.findMany({ where: { missionId: m.id, ...(batch ? { id: { in: outputIds } } : {}) }, orderBy: { revision: "desc" }, take: batch ? 40 : 3 });
  for (const output of outputs.reverse()) {
    try { await validateSources(m.projectId, output.sourceRefsJson as unknown as Source[], tx, m.id); } catch (e) { if (e instanceof AppError) continue; throw e; }
    const text = Array.isArray(record(output.contentJson).blocks) ? (record(output.contentJson).blocks as Array<{ text?: string }>).map(b => b.text ?? "").join("\n").slice(0, 800) : "";
    snapshots.push({ key: "output:" + output.id + ":" + jsonHash({ revision: output.revision, verification: output.verificationStatus, checks: output.claimChecksJson }),
      content: "原委托保存了第 " + output.revision + " 版成果。验证状态：" + output.verificationStatus + "。\n" + text, refs: [ref] });
  }
  const actionEvents = batch ? batch.filter(e => e.type === "ACTION_CREATED") : await tx.agentMissionEvent.findMany({ where: { missionId: m.id, type: "ACTION_CREATED" }, orderBy: { seq: "desc" }, take: 8 });
  for (const e of actionEvents) {
    const actionId = record(e.payloadJson).actionId;
    if (typeof actionId !== "string") continue;
    const action = await tx.actionItem.findFirst({ where: { id: actionId, projectId: m.projectId, isSimulated: false } });
    if (!action) continue;
    await tx.conversationAnchorAction.upsert({ where: { anchorId_actionId: { anchorId: a.id, actionId } }, create: { anchorId: a.id, actionId }, update: {} });
  }
  const watches = await tx.conversationAnchorAction.findMany({ where: { anchorId: a.id }, include: { action: true }, orderBy: [{ lastCheckedAt: "asc" }, { actionId: "asc" }], take: 8 });
  for (const watch of watches) {
    const action = watch.action;
    if (action.projectId !== a.projectId || action.isSimulated) continue;
    const result = action.resultCardId && action.status === "DONE" ? await tx.knowledgeCard.findFirst({ where: { id: action.resultCardId, projectId: m.projectId } }) : null;
    const alreadyReported = result && await tx.copilotToolExecution.findFirst({ where: { tool: "complete_action", resultId: action.id, status: "COMMITTED", sourceRun: { conversationId: a.conversationId } } });
    const observed = watch.observedStatus === action.status && watch.observedResultCardId === action.resultCardId;
    snapshots.push({ key: "action:" + action.id + ":" + jsonHash({ status: action.status, result: result?.id }), silent: !!alreadyReported || observed,
      content: result ? "原行动已完成，用户结果和复盘已保存。\n" + (action.resultText ?? result.summary).slice(0, 1000)
        : "原委托创建的行动“" + action.title + "”当前状态：" + action.status + "，尚无完成复盘回执。",
      refs: [{ kind: "ACTION", id: action.id, projectId: m.projectId, title: action.title, status: action.status, href: "/projects/" + m.projectId + "/actions#action-" + action.id }, ref] });
    await tx.conversationAnchorAction.update({ where: { anchorId_actionId: { anchorId: a.id, actionId: action.id } }, data: { lastCheckedAt: new Date(), observedStatus: action.status, observedResultCardId: action.resultCardId } });
  }
  return snapshots;
}
export async function commandConversationAnchor(actor: ConversationActor, id: string, anchorId: string, raw: unknown) {
  const input = anchorCommandSchema.parse(raw), hash = jsonHash({ anchorId, input });
  await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    const a = await tx.conversationAnchor.findFirst({ where: { id: anchorId, conversationId: id, ownerUserId: actor.userId } });
    if (!a) throw new AppError("ANCHOR_NOT_FOUND", "原主题不可访问", 404);
    await allowed(actor, a, tx);
    const previous = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (previous) { if (previous.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "反馈编号已用于其他选择", 409); return; }
    if (a.version !== input.expectedVersion) throw new AppError("ANCHOR_CHANGED", "主题策略已变化，请重新读取", 409);
    if (input.action === "FOLLOW" && !enabled()) throw new AppError("FOLLOW_DISABLED", "后续关注尚未开启", 503);
    if (input.action === "ACK" && (input.seenSeq === undefined || input.seenSeq > a.projectedSeq)) throw new AppError("INVALID_CURSOR", "请确认实际读取的消息范围", 422);
    if (input.action === "FOLLOW" && a.missionId && await tx.goalQuestionPreference.findFirst({ where: { userId: actor.userId, missionId: a.missionId, questionId: "*", mode: "STOP" } }))
      throw new AppError("ORIGINAL_TOPIC_STOPPED", "原委托已停止提醒，请先在原委托恢复", 409);
    if (input.action === "FOLLOW" && a.mode === "MANUAL") {
      if (a.missionId) await tx.$executeRaw`INSERT OR IGNORE INTO ConversationAnchorAction (anchorId,actionId,lastCheckedAt,observedStatus,observedResultCardId)
        SELECT ${a.id},ai.id,NULL,ai.status,ai.resultCardId FROM AgentMissionEvent e JOIN ActionItem ai ON ai.id=json_extract(e.payloadJson,'$.actionId')
        WHERE e.missionId=${a.missionId} AND e.type='ACTION_CREATED' AND ai.projectId=${a.projectId} AND ai.isSimulated=0 AND ai.status IN ('TODO','DOING')`;
      for (const s of await missionSnapshots(tx, actor, a)) await projectSnapshot(tx, actor, a, s, true);
      if (a.missionId) await tx.conversationAnchor.update({ where: { id: a.id }, data: { eventCursor: (await ownedMission(actor.userId, a.missionId, tx)).nextEventSeq } });
    }
    if (["STOP", "LATER"].includes(input.action) && a.missionId) {
      const q = (await currentMissionGoalQuestionInTx(tx, actor, a.projectId, a.missionId)).question;
      if (q?.missionId === a.missionId) await interactGoalQuestion(actor, a.projectId, { requestId: "anchor:" + anchorId + ":" + input.requestId,
        questionId: q.questionId, contextHash: q.contextHash, action: input.action }, new Date(), tx, a.missionId);
      else if (input.action === "STOP") {
        await tx.goalQuestionPreference.upsert({ where: { userId_missionId_questionId: { userId: actor.userId, missionId: a.missionId, questionId: "*" } },
          create: { userId: actor.userId, missionId: a.missionId, questionId: "*", mode: "STOP", contextHash: a.originRevision }, update: { mode: "STOP", contextHash: a.originRevision, snoozedUntil: null } });
        await event(tx, a.missionId, "GOAL_QUESTION_FEEDBACK", { action: "STOP", source: "FOCUS_TOPIC", anchorId });
      }
    }
    await tx.conversationAnchor.update({ where: { id: anchorId }, data: { version: { increment: 1 },
      ...(input.action === "ACK" ? { seenSeq: Math.max(a.seenSeq, input.seenSeq!) }
        : { mode: input.action === "FOLLOW" ? "FOLLOWING" : input.action === "STOP" ? "STOPPED" : "LATER", snoozedUntil: input.action === "LATER" ? new Date(Date.now() + 86400000) : null }) } });
    await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId, inputHash: hash, inputJson: json({ kind: "ANCHOR_POLICY", anchorId, action: input.action }), baseVersion: c.version, status: "COMMITTED", finishedAt: new Date() } });
    await tx.conversation.update({ where: { id }, data: { version: { increment: 1 } } });
  }, { timeout: 20000 });
  return { ...await listConversationAnchors(actor, id), conversation: await readConversation(actor, id) };
}
export async function syncConversationAnchors(actor: ConversationActor, id: string) {
  const projected = await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    if (c.activeTurnId) return 0;
    const anchors = await tx.conversationAnchor.findMany({ where: { conversationId: id, ownerUserId: actor.userId }, orderBy: [{ lastSyncedAt: "asc" }, { id: "asc" }], take: 20 });
    let count = 0;
    for (let a of anchors) {
      await tx.conversationAnchor.update({ where: { id: a.id }, data: { lastSyncedAt: new Date() } });
      try { await allowed(actor, a, tx); } catch (e) { if (e instanceof AppError && e.status === 404) continue; throw e; }
      // Rebuild missing message projections from the durable snapshot, never replay business commands.
      for (const p of await tx.conversationAnchorProjection.findMany({ where: { anchorId: a.id, seq: { gt: 0 }, messageId: null }, orderBy: { seq: "asc" }, take: 20 })) {
        const saved = record(p.payloadJson), message = await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", String(saved.content ?? "原主题历史记录"), saved.blocks as ConversationBlocks);
        await tx.conversationAnchorProjection.update({ where: { id: p.id }, data: { messageId: message.id } });
        await tx.conversation.update({ where: { id }, data: { version: { increment: 1 } } }); count++;
      }
      if (!enabled() || a.mode !== "FOLLOWING" && !(a.mode === "LATER" && a.snoozedUntil && a.snoozedUntil <= new Date())) continue;
      if (a.missionId) {
        const m = await ownedMission(actor.userId, a.missionId, tx), questionId = String(record(m.waitStateJson).questionId ?? "impact:" + m.id);
        const preferences = await tx.goalQuestionPreference.findMany({ where: { userId: actor.userId, missionId: a.missionId, questionId: { in: ["*", questionId] } } });
        if (preferences.some(p => p.mode === "STOP" || p.mode === "LATER" && p.snoozedUntil && p.snoozedUntil > new Date())) continue;
        if (preferences.some(p => ["UNKNOWN", "NOT_USEFUL"].includes(p.mode))) {
          const q = (await currentMissionGoalQuestionInTx(tx, actor, a.projectId, a.missionId)).question;
          if (!q || preferences.some(p => ["UNKNOWN", "NOT_USEFUL"].includes(p.mode) && p.contextHash === q.contextHash)) continue;
        }
      }
      if (a.mode === "LATER") a = await tx.conversationAnchor.update({ where: { id: a.id }, data: { mode: "FOLLOWING", snoozedUntil: null, version: { increment: 1 } } });
      if (!a.missionId) {
        const parsed = conversationEntrySchema.safeParse(record(a.originEntryJson).entry);
        if (!parsed.success) continue;
        const source = await readConversationEntry(actor, { ...parsed.data, revision: undefined }, tx);
        if (source.revision !== a.originRevision && await projectSnapshot(tx, actor, a, { key: "origin:" + source.revision, content: "关注的原提醒有了修订。\n" + source.ref.title + "\n" + source.text, refs: [source.ref] })) count++;
        await tx.conversationAnchor.update({ where: { id: a.id }, data: { originRevision: source.revision } });
        continue;
      }
      const m = await ownedMission(actor.userId, a.missionId, tx);
      const events = await tx.agentMissionEvent.findMany({ where: { missionId: m.id, seq: { gt: a.eventCursor } }, orderBy: { seq: "asc" }, take: 40 });
      for (const e of events.filter(e => e.type === "SOURCE_ARRIVED")) {
        const p = record(e.payloadJson), pointer = record(p.sourcePointer), wait = record(m.waitStateJson);
        if (m.status !== "WAITING_INPUT" || p.questionId !== wait.questionId || typeof pointer.id !== "string" || typeof pointer.hash !== "string") continue;
        const view = await readProjectMaterialView(a.projectId, pointer.id, tx);
        if (!view || !view.source.text.trim() || view.source.hash !== pointer.hash) continue;
        const assessment = await previewContinuationInTx(tx, actor.userId, m.id, { questionId: p.questionId, sourcePointers: [pointer] });
        if (assessment.relevance !== "RELATED" || assessment.evidenceFit?.fitStatus === "NOT_FIT" || !assessment.readable || assessment.temporalStates.some(s => ["SUPERSEDED", "CONTESTED"].includes(s.state))) continue;
        const source = view.source;
        if (await projectSnapshot(tx, actor, a, { key: "source:" + p.questionId + ":" + source.id + ":" + source.hash,
          content: "原问题收到一份可能相关的资料：" + view.title + "。适用条件与含义仍需核对；原任务尚未自动继续。",
          refs: [{ kind: "MISSION", id: m.id, projectId: m.projectId, title: m.goal, status: m.status, version: m.version, href: "/projects/" + m.projectId + "/missions?mission=" + m.id }],
          sources: [{ id: m.projectId + "/" + source.id, projectId: m.projectId, sourceId: source.id, revision: source.hash, title: view.title, excerpt: source.text.slice(0, 500), observedAt: source.observedAt, temporalState: assessment.temporalStates[0]?.state ?? "UNKNOWN",
            knowledgeClass: source.knowledgeClass ?? "PROJECT_OBSERVATION", start: 0, end: Math.min(source.text.length, 500), excerptHash: jsonHash(source.text.slice(0, 500)) }] })) count++;
      }
      for (const s of await missionSnapshots(tx, actor, a, events)) if (await projectSnapshot(tx, actor, a, s, s.silent)) count++;
      const nextCursor = events.at(-1)?.seq ?? a.eventCursor;
      const trackPending = m.status === "CANCELLED" ? 0 : 1;
      const watchBacklog = await tx.$queryRaw<Array<{ count: number | bigint }>>`SELECT COUNT(*) AS count FROM ConversationAnchorAction w JOIN ActionItem ai ON ai.id=w.actionId WHERE w.anchorId=${a.id} AND ((${trackPending}=1 AND ai.status IN ('TODO','DOING')) OR w.lastCheckedAt IS NULL OR w.observedStatus!=ai.status OR COALESCE(w.observedResultCardId,'')!=COALESCE(ai.resultCardId,''))`;
      const terminal = nextCursor >= m.nextEventSeq && ["SUCCEEDED", "CANCELLED"].includes(m.status) && Number(watchBacklog[0].count) === 0;
      await tx.conversationAnchor.update({ where: { id: a.id }, data: { eventCursor: nextCursor,
        ...(terminal ? { mode: "STOPPED", version: { increment: 1 } } : {}) } });
    }
    return count;
  }, { timeout: 20000 });
  return { ...await listConversationAnchors(actor, id), projected, conversation: await readConversation(actor, id) };
}
export async function readAnchorInbox(userId: string) {
  if (!isFeatureEnabled("FOCUS_AGENT_ENABLED", false)) return [];
  const memberships = await db.projectMembership.findMany({ where: { userId }, select: { projectId: true, role: true } });
  const owners = new Set(memberships.filter(m => m.role === "OWNER").map(m => m.projectId));
  const rows = await db.conversationAnchor.findMany({ where: { ownerUserId: userId, projectId: { in: memberships.map(m => m.projectId) }, projectedSeq: { gt: 0 }, conversation: { ownerUserId: userId } }, include: { conversation: { select: { title: true } } }, take: 100 });
  const grouped = new Map<string, { conversationId: string; title: string; unread: number }>();
  for (const a of rows) {
    if (a.missionId && !owners.has(a.projectId) || a.projectedSeq <= a.seenSeq) continue;
    const item = grouped.get(a.conversationId) ?? { conversationId: a.conversationId, title: "关注的项目讨论", unread: 0 };
    item.unread += a.projectedSeq - a.seenSeq; grouped.set(a.conversationId, item);
  }
  return [...grouped.values()].slice(0, 8);
}
export async function syncWorkspaceAnchors(actor: ConversationActor) {
  await assertSession(actor);
  let projected = 0;
  if (enabled()) {
    const projects = (await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true } })).map(p => p.projectId);
    const rows = await db.conversationAnchor.findMany({ where: { ownerUserId: actor.userId, projectId: { in: projects },
      conversation: { ownerUserId: actor.userId, OR: [{ homeProjectId: null }, { homeProjectId: { in: projects } }] },
      OR: [{ mode: "FOLLOWING" }, { mode: "LATER", snoozedUntil: { lte: new Date() } }] },
      orderBy: [{ lastSyncedAt: "asc" }, { id: "asc" }], select: { conversationId: true }, distinct: ["conversationId"], take: 8 });
    for (const row of rows) {
      try { projected += (await syncConversationAnchors(actor, row.conversationId)).projected; }
      catch (e) { if (e instanceof AppError && e.status === 404) continue; throw e; }
    }
  }
  await assertSession(actor);
  return { enabled: enabled(), projected, discussions: await readAnchorInbox(actor.userId) };
}
