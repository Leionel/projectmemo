import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { record } from "@/lib/conversation/repository";
import { parseProjectMaterial } from "@/lib/intake/projectMaterial";
import { jsonHash } from "./contracts";
import { event, ownedMission, type Tx } from "./repository";


const materialPreviewInput = z.object({ text: z.string().min(1).max(20000), name: z.string().trim().min(1).max(180).optional() }).strict();

/** Read-only native/Web preview: validates scope and text without writing a Capture or waking the Mission. */
export async function previewMissionMaterial(userId: string, missionId: string, raw: unknown) {
  const body = materialPreviewInput.parse(raw);
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
  return db.$transaction(async tx => {
    const mission = await ownedMission(userId, missionId, tx);
    if (mission.runtimeProtocolVersion !== 2) throw new AppError("MISSION_PROTOCOL_REQUIRED", "此入口用于 V2 原委托", 409);
    const parsed = parseProjectMaterial(body.text, body.name);
    return { name: parsed.name, format: parsed.format, text: parsed.text, length: parsed.text.length,
      target: { missionId, projectId: mission.projectId, goal: mission.goal, status: mission.status },
      authorization: mission.continuationPolicyJson ? "BOUNDED_POLICY_PRESENT" : "NO_CONTINUOUS_POLICY",
      note: "预览不写入、不调用模型；确认后才作为用户材料保存，原许可与预算继续生效。" };
  });
}

const materialInput = z.object({ requestId: z.string().min(1).max(128), text: z.string().min(1).max(20000),
  name: z.string().trim().min(1).max(180).optional(), kind: z.enum(["MATERIAL", "FEEDBACK"]).default("MATERIAL") }).strict();

/** Explicit user material intake: no structuring/model calls, proposals, or automatic authority changes. */
export async function addMissionMaterial(userId: string, missionId: string, raw: unknown) {
  return db.$transaction(tx => addMissionMaterialInTx(tx, userId, missionId, raw));
}
/** Lets an explicit challenge handoff and its material receipt commit atomically. */
export async function addMissionMaterialInTx(tx: Tx, userId: string, missionId: string, raw: unknown) {
  const body = materialInput.parse(raw), parsed = parseProjectMaterial(body.text, body.name);
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
  const requestId = "v2-material-add:" + missionId + ":" + body.requestId;
  const hash = jsonHash({ missionId, kind: body.kind, text: parsed.text, name: parsed.name });
  const mission = await ownedMission(userId, missionId, tx);
  if (mission.runtimeProtocolVersion !== 2) throw new AppError("MISSION_PROTOCOL_REQUIRED", "此入口用于 V2 原委托", 409);
  const existing = await tx.capture.findUnique({ where: { projectId_requestId: { projectId: mission.projectId, requestId } } });
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError("REQUEST_ID_REUSED", "该请求编号已用于另一份材料，请核对原请求", 409);
    return { sourceId: "capture:" + existing.id, replayed: true, kind: body.kind };
  }
  const text = body.kind === "FEEDBACK" ? "用户提供的反馈（待核对，不代表已确认变更）：\n" + parsed.text : parsed.text;
  const capture = await tx.capture.create({ data: { projectId: mission.projectId, requestId, requestHash: hash, rawText: text, sourceType: "TEXT" } });
  await event(tx, missionId, body.kind === "FEEDBACK" ? "USER_FEEDBACK_ADDED" : "USER_MATERIAL_ADDED",
    { sourceId: "capture:" + capture.id, name: parsed.name, format: parsed.format, requestHash: hash, kind: body.kind, authority: "USER_SUPPLIED_UNVERIFIED" });
  // Scheduling only: the original scanner still checks authority, source use, dedupe, and budgets.
  if (mission.status === "WAITING_INPUT" && record(mission.waitStateJson).waitingFor === "OBSERVATION")
    await tx.agentMission.update({ where: { id: missionId }, data: { nextAttemptAt: new Date() } });
  return { sourceId: "capture:" + capture.id, replayed: false, kind: body.kind };
}
