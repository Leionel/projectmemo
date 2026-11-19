import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertOwner, event, lock, ownedMission, type Tx } from "@/lib/mission/repository";
import { jsonHash, type Source } from "@/lib/mission/contracts";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import type { ReentryBrief, ReentryItem } from "@/lib/types/reentryBrief";

const ackInput = z.object({ requestId: z.string().min(1).max(100), seenSeq: z.number().int().min(0), seenOutputRevision: z.number().int().min(0),
  handledItemIds: z.array(z.string().max(120)).max(3).default([]) }).strict();
const ITEM_LIMIT = 3;
const NOTE = "最多展示上次已读后的三项变化；发生时间与记录时间可能不同，未独立确认。标记已读或已处理不等于批准。";

function enabled() {
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
}

export async function readReentryBrief(userId: string, missionId: string): Promise<ReentryBrief> {
  enabled();
  return db.$transaction(tx => buildBrief(userId, missionId, tx));
}
export async function readReentryReceipt(tx: Tx, missionId: string) {
  const row = await tx.agentMissionEvent.findFirst({ where: { missionId, type: "REENTRY_BRIEF_SEEN" }, orderBy: { seq: "desc" } });
  return record(row?.payloadJson);
}

export async function readProjectReturnItems(userId: string, projectId: string) {
  return db.$transaction(async tx => {
    await assertOwner(userId, projectId, tx);
    const [recent, waiting] = await Promise.all([
      tx.agentMission.findMany({ where: { projectId, ownerUserId: userId, runtimeProtocolVersion: 2 },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 6, select: { id: true, goal: true } }),
      tx.$queryRaw<Array<{ id: string; goal: string }>>`
        SELECT id, goal FROM "AgentMission"
        WHERE "projectId" = ${projectId} AND "ownerUserId" = ${userId} AND "runtimeProtocolVersion" = 2
          AND status = 'WAITING_INPUT' AND "pauseRequestedAt" IS NULL AND "cancelRequestedAt" IS NULL
          AND json_type("waitStateJson", '$.questionId') = 'text'
          AND COALESCE(json_extract("waitStateJson", '$.waitingFor'), '') != 'OBSERVATION'
          AND COALESCE(json_extract("waitStateJson", '$.resolved'), 0) != 1
        ORDER BY "updatedAt" DESC, id DESC LIMIT ${ITEM_LIMIT}`,
    ]);
    const waitingIds = new Set(waiting.map(mission => mission.id));
    const missions = [...waiting, ...recent.filter(mission => !waitingIds.has(mission.id))];
    const reads = await Promise.all(missions.map(async mission => {
      const brief = await buildBrief(userId, mission.id, tx);
      return { ...mission, questionId: brief.items.find(item => item.questionId)?.questionId,
        output: brief.items.filter(item => item.kind === "OUTPUT_UPDATED").at(-1),
        baseline: brief.lastSeenOutputRevision };
    }));
    return [...reads.filter(item => item.questionId), ...reads.filter(item => !item.questionId && item.output)].slice(0, ITEM_LIMIT);
  });
}

async function buildBrief(userId: string, missionId: string, tx: Tx): Promise<ReentryBrief> {
  const mission = await ownedMission(userId, missionId, tx);
  const [seenPayload, outputs, events, pendingApprovals] = await Promise.all([
    readReentryReceipt(tx, missionId),
    tx.agentMissionOutput.findMany({ where: { missionId }, orderBy: { revision: "desc" }, take: ITEM_LIMIT + 2 }),
    tx.agentMissionEvent.findMany({ where: { missionId, type: { in: ["INVESTIGATION_HELD", "APPROVAL_REQUESTED", "INVESTIGATION_INPUT_CHANGED", "INVESTIGATION_OBSERVATION_CHANGED", "USER_MATERIAL_ADDED", "USER_FEEDBACK_ADDED"] } }, orderBy: { seq: "desc" }, take: 40 }),
    mission.status === "WAITING_APPROVAL" && !mission.pauseRequestedAt && !mission.cancelRequestedAt
      ? tx.agentMissionApproval.findMany({ where: { missionId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true, stepId: true } }) : [],
  ]);
  const baseSeq = Number(seenPayload.seenSeq ?? 0), baseRevision = Number(seenPayload.seenOutputRevision ?? 0);
  const handledIds = new Set(Array.isArray(seenPayload.handledItemIds) ? seenPayload.handledItemIds.map(String) : []);
  const currentSeq = (await tx.agentMissionEvent.findFirst({ where: { missionId }, orderBy: { seq: "desc" }, select: { seq: true } }))?.seq ?? 0;
  const currentRevision = outputs[0]?.revision ?? 0;
  const items: ReentryItem[] = [];

  const sourceChanged = events.filter(item => item.seq > baseSeq && ["INVESTIGATION_INPUT_CHANGED", "INVESTIGATION_OBSERVATION_CHANGED", "INVESTIGATION_DUPLICATE_IGNORED", "USER_MATERIAL_ADDED", "USER_FEEDBACK_ADDED"].includes(item.type));
  const wait = record(mission.waitStateJson);
  const activeQuestion = mission.status === "WAITING_INPUT" && wait.waitingFor !== "OBSERVATION" &&
    wait.resolved !== true && !mission.pauseRequestedAt && !mission.cancelRequestedAt && typeof wait.questionId === "string" ? wait.questionId : undefined;
  const question = activeQuestion ? await tx.agentMissionEvent.findFirst({ where: { missionId, type: "QUESTION", id: activeQuestion } }) : null;
  const approvalsByStep = new Map(pendingApprovals.map(approval => [approval.stepId, approval.id]));
  const approvalId = (payload: unknown) => approvalsByStep.get(String(record(payload).stepId));
  const decisions = events.filter(item => item.seq > baseSeq && (item.type === "INVESTIGATION_HELD" && mission.status === "PAUSED" ||
    item.type === "APPROVAL_REQUESTED" && approvalId(item.payloadJson)));
  if (question) decisions.unshift(question);
  for (const item of decisions.filter(item => item.id === activeQuestion || !handledIds.has("decision:" + item.id)).slice(0, ITEM_LIMIT).map(item => {
    return {
      id: "decision:" + item.id, kind: "NEEDS_DECISION" as const,
      title: item.type === "QUESTION" ? "原委托有一处需要你的判断" : item.type === "APPROVAL_REQUESTED" ? "原委托提出一项待批准操作" : "持续跟进需要你核对条件",
      why: "请打开原委托，按当前来源许可核对待处理问题。",
      ...(item.id === activeQuestion ? { questionId: item.id } : {}),
      ...(item.type === "APPROVAL_REQUESTED" ? { approvalId: approvalId(item.payloadJson) } : {}),
      sourceKeys: [], occurredAt: item.createdAt.toISOString(), recordedAt: item.createdAt.toISOString(),
      decisionAt: null, read: item.seq <= baseSeq, handled: handledIds.has("decision:" + item.id), approved: false,
    };
  })) items.push(item);
  const newOutputs = outputs.filter(output => output.revision > baseRevision);
  const availableSlots = ITEM_LIMIT - items.length;
  const visibleOutputs: ReentryItem[] = [];
  const sourcePermissions = new Map<string, ReturnType<typeof sourceUse>>();
  for (const output of newOutputs) {
    if (visibleOutputs.length === availableSlots) break;
    if (handledIds.has("output:" + output.id)) continue;
    const refs = (output.sourceRefsJson as unknown as Source[] | null) ?? [];
    const allowed = await Promise.all(refs.map(source => {
      const existing = sourcePermissions.get(source.id);
      if (existing) return existing;
      const permission = sourceUse(userId, mission.projectId, source.id, tx, { missionId });
      sourcePermissions.set(source.id, permission);
      return permission;
    }));
    if (allowed.some(result => result.state !== "ALLOWED")) continue;
    const latestSourceChange = sourceChanged.find(item => item.createdAt <= output.createdAt);
    const why = latestSourceChange ? "资料或反馈更新后保存了这版成果；具体变化请打开原稿核对" : "保存了新的私有稿；具体变化请打开原稿核对";
    visibleOutputs.push({ id: "output:" + output.id, kind: "OUTPUT_UPDATED", title: "私有稿更新到第 " + output.revision + " 版", why,
      outputId: output.id, revision: output.revision, sourceKeys: refs.map(source => source.id + "@" + source.hash),
      occurredAt: latestSourceChange?.createdAt.toISOString() ?? output.createdAt.toISOString(),
      recordedAt: output.createdAt.toISOString(), decisionAt: null, read: false,
      handled: handledIds.has("output:" + output.id), approved: false });
  }
  items.push(...visibleOutputs.reverse());
  if (!items.length && sourceChanged.length) {
    const item = sourceChanged[0];
    items.push({ id: "source:" + item.id, kind: "SOURCE_CHANGED", title: "有新的项目变化被记录", why: "原扫描器已记录变化；是否影响成果需按当前稿件核对",
      sourceKeys: [], occurredAt: item.createdAt.toISOString(), recordedAt: item.createdAt.toISOString(), decisionAt: null,
      read: false, handled: handledIds.has("source:" + item.id), approved: false });
  }
  const unhandled = items.filter(item => item.questionId || !handledIds.has(item.id));
  return { schemaVersion: 1, missionId, generatedAt: new Date().toISOString(), readState: unhandled.some(item => !item.read) || !seenPayload.at ? "UNREAD" : "SEEN",
    cursor: { seq: currentSeq, outputRevision: currentRevision },
    lastSeenOutputRevision: baseRevision,
    items: unhandled.slice(0, ITEM_LIMIT),
    note: mission.runtimeProtocolVersion === 2 ? NOTE : "旧协议委托仅展示已记录的成果版本变化。" };
}

export async function acknowledgeReentryBrief(userId: string, missionId: string, raw: unknown) {
  enabled();
  const body = ackInput.parse(raw), hash = jsonHash({ ...body, missionId }), key = "reentry-seen:" + missionId + ":" + body.requestId;
  return db.$transaction(async tx => {
    await ownedMission(userId, missionId, tx);
    await lock(tx, missionId);
    const previous = await tx.agentMissionEvent.findUnique({ where: { missionId_commandRequestId: { missionId, commandRequestId: key } } });
    if (previous) {
      if (previous.commandPayloadHash !== hash) throw new AppError("REQUEST_ID_REUSED", "该请求编号已用于另一次已读回执", 409);
      return buildBrief(userId, missionId, tx);
    }
    const current = await buildBrief(userId, missionId, tx);
    if (body.seenSeq > current.cursor.seq || body.seenOutputRevision > current.cursor.outputRevision)
      throw new AppError("REENTRY_CURSOR_INVALID", "已读位置超过当前成果，请刷新后重试", 409);
    const last = record((await tx.agentMissionEvent.findFirst({ where: { missionId, type: "REENTRY_BRIEF_SEEN" }, orderBy: { seq: "desc" } }))?.payloadJson);
    if (body.handledItemIds.some(id => !current.items.some(item => item.id === id))) throw new AppError("REENTRY_ITEM_CHANGED", "这项变化已处理或已更新，请刷新后重试", 409);
    // Handling one item does not mark every other visible change as read. Late tabs cannot rewind.
    const handling = body.handledItemIds.length > 0;
    await event(tx, missionId, "REENTRY_BRIEF_SEEN", {
      seenSeq: Math.max(Number(last.seenSeq ?? 0), handling ? 0 : body.seenSeq),
      seenOutputRevision: Math.max(Number(last.seenOutputRevision ?? 0), handling ? 0 : body.seenOutputRevision),
      handledItemIds: [...new Set([...(Array.isArray(last.handledItemIds) ? last.handledItemIds.map(String) : []), ...body.handledItemIds])].slice(-128),
      at: new Date().toISOString() }, { id: key, hash });
    return buildBrief(userId, missionId, tx);
  });
}
