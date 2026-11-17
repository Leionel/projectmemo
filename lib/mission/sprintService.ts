import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { isFeatureEnabled } from "@/lib/config/features";
import { jsonHash } from "./contracts";
import { event, lock, ownedMission, type Tx } from "./repository";
import type { SprintView, ProjectSprint } from "@/lib/types/sprint";

const requestId = z.string().min(1).max(100);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), requestId, objective: z.string().trim().min(1).max(300), minutes: z.union([z.literal(5), z.literal(15), z.literal(25)]) }).strict(),
  z.object({ action: z.literal("SELF_REPORT"), requestId, sprintId: z.string().min(1).max(160), done: z.boolean() }).strict(),
  z.object({ action: z.literal("END"), requestId, sprintId: z.string().min(1).max(160) }).strict(),
]);
function enabled() {
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false) || !isFeatureEnabled("MISSION_CHALLENGES_ENABLED", false))
    throw new AppError("SPRINT_DISABLED", "双人冲刺尚未开启", 404);
}
async function view(tx: Tx, userId: string, missionId: string): Promise<SprintView> {
  const m = await ownedMission(userId, missionId, tx);
  const working = m.runtimeProtocolVersion === 2 && m.status === "RUNNING" && !!m.leaseOwner &&
    !!m.leaseUntil && m.leaseUntil.getTime() > Date.now() && m.executionSlot !== null;
  const start = await tx.agentMissionEvent.findFirst({ where: { missionId, type: "SPRINT_STARTED" }, orderBy: { seq: "desc" } });
  let session: ProjectSprint | null = null;
  if (start) {
    const payload = record(start.payloadJson), filter = { missionId, payloadJson: { path: "$.sprintId", equals: start.id } };
    const ended = await tx.agentMissionEvent.findFirst({ where: { ...filter, type: "SPRINT_ENDED" } });
    const cutoff = new Date(Math.min(Date.parse(String(payload.endsAt)), ended?.createdAt.getTime() ?? Infinity));
    const [reported, steps, outputs, latest, recentSteps, recentOutputs, opens] = await Promise.all([
      tx.agentMissionEvent.findFirst({ where: { ...filter, type: "SPRINT_SELF_REPORTED" }, orderBy: { seq: "desc" } }),
      tx.agentMissionStep.count({ where: { missionId, status: "SUCCEEDED", finishedAt: { gte: start.createdAt, lte: cutoff } } }),
      tx.agentMissionOutput.count({ where: { missionId, revision: { gt: Number(payload.baselineRevision) }, createdAt: { gte: start.createdAt, lte: cutoff } } }),
      tx.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" }, select: { revision: true } }),
      tx.agentMissionStep.findMany({ where: { missionId, status: "SUCCEEDED", finishedAt: { gte: start.createdAt, lte: cutoff } },
        orderBy: { finishedAt: "desc" }, take: 6, select: { id: true, toolName: true, finishedAt: true } }),
      tx.agentMissionOutput.findMany({ where: { missionId, revision: { gt: Number(payload.baselineRevision) }, createdAt: { gte: start.createdAt, lte: cutoff } },
        orderBy: { revision: "desc" }, take: 3, select: { revision: true, createdAt: true, contentJson: true } }),
      tx.agentMissionEvent.findMany({ where: { missionId, type: "CHALLENGE_SOURCE_OPENED", createdAt: { gte: start.createdAt, lte: cutoff } },
        select: { payloadJson: true }, take: 32 }),
    ]);
    const labelOf = (toolName: string) => toolName === "read_project_material" ? "读取资料"
      : toolName === "save_mission_output" ? "保存新稿"
      : toolName === "search_project" || toolName === "inspect_project" ? "整理依据" : "完成一个步骤";
    const receipts = [
      ...recentSteps.filter(step => step.finishedAt).map(step => ({ id: step.id, label: labelOf(step.toolName), at: step.finishedAt!.toISOString(), kind: "STEP" as const })),
      ...recentOutputs.map(row => ({ id: "output-" + row.revision, label: "保存新稿 · 第 " + row.revision + " 版", at: row.createdAt.toISOString(), kind: "OUTPUT" as const })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-5);
    const missing = record(recentOutputs[0]?.contentJson).missingInformation;
    const openItems = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
    const elapsed = Date.now() >= Date.parse(String(payload.endsAt));
    session = { id: start.id, missionId, objective: String(payload.objective), startedAt: start.createdAt.toISOString(), endsAt: String(payload.endsAt),
      status: ended ? "ENDED" : elapsed ? "ELAPSED" : "ACTIVE", selfReportedDone: record(reported?.payloadJson).done === true,
      agent: { working, label: working ? "正在处理原委托" : m.status === "WAITING_INPUT" ? "正在等待资料或你的判断" : m.status === "PAUSED" ? "原委托已暂停" : "当前没有执行中的步骤",
        completedSteps: steps, newOutputs: outputs, latestRevision: latest?.revision ?? null,
        latestNewRevision: recentOutputs[0]?.revision ?? null,
        latestNewOutputAt: recentOutputs[0]?.createdAt.toISOString() ?? null,
        receipts, openedSources: new Set(opens.map(row => String(record(row.payloadJson).sourceKey))).size, openItems } };
  }
  return { canStart: working && session?.status !== "ACTIVE", reason: working ? "" : "等原委托开始实际处理后再开启；你也可以先阅读已有成果。", session };
}
export async function readProjectSprint(userId: string, missionId: string) {
  enabled(); return db.$transaction(tx => view(tx, userId, missionId));
}
export async function commandProjectSprint(userId: string, missionId: string, raw: unknown) {
  enabled(); const body = input.parse(raw), hash = jsonHash(body), key = "sprint:" + body.requestId;
  return db.$transaction(async tx => {
    await ownedMission(userId, missionId, tx); await lock(tx, missionId);
    const old = await tx.agentMissionEvent.findUnique({ where: { missionId_commandRequestId: { missionId, commandRequestId: key } } });
    if (old) {
      if (old.commandPayloadHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他冲刺操作", 409);
      return { ...await view(tx, userId, missionId), replayed: true };
    }
    const current = await view(tx, userId, missionId), command = { id: key, hash };
    if (body.action === "START") {
      if (!current.canStart) throw new AppError("SPRINT_NOT_READY", current.session?.status === "ACTIVE" ? "本轮还在进行，可继续或先结束本轮" : current.reason, 409);
      const latest = await tx.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" }, select: { revision: true } });
      await event(tx, missionId, "SPRINT_STARTED", { objective: body.objective, endsAt: new Date(Date.now() + body.minutes * 60000).toISOString(), baselineRevision: latest?.revision ?? 0 }, command);
    } else {
      if (!current.session || body.sprintId !== current.session.id) throw new AppError("SPRINT_CHANGED", "请刷新当前冲刺后重试", 409);
      if (body.action === "SELF_REPORT" && current.session.status !== "ACTIVE") throw new AppError("SPRINT_ENDED", "本轮已结束，自述不再更新", 409);
      await event(tx, missionId, body.action === "END" ? "SPRINT_ENDED" : "SPRINT_SELF_REPORTED", { sprintId: body.sprintId, ...(body.action === "SELF_REPORT" ? { done: body.done } : {}) }, command);
    }
    return { ...await view(tx, userId, missionId), replayed: false };
  });
}
