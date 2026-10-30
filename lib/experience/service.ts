import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "@/lib/mission/contracts";
import { record } from "@/lib/conversation/repository";
import { z } from "zod";
import { syncExperiences } from "./extract";
import { buildTrajectoryIndex } from "./trajectoryIndex";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { readApplicability } from "./conditions";

/**
 * CT-8 经验管理服务。
 * GET/列表是纯读，不隐式同步、不调用模型；只有显式 REFRESH 或真实结果提交后的有界触发才重算。
 * 激活仅限 SHADOW（样本不足的 CANDIDATE 不可激活）；撤销保留行与全部使用/事件记录。
 * 激活、撤销、反馈、迁移都带 requestId 幂等与预期版本 CAS，双端不会互相覆盖。
 */

export const experienceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE"), requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive().optional(), reason: z.string().trim().max(200).optional() }).strict(),
  z.object({ action: z.literal("REVOKE"), requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive().optional(), reason: z.string().trim().max(200).optional() }).strict(),
  z.object({ action: z.literal("FEEDBACK"), requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive().optional(),
    disposition: z.enum(["ADOPT", "NOT_APPLICABLE", "COUNTEREXAMPLE", "UNKNOWN"]), reason: z.string().trim().max(300).optional(),
    missionId: z.string().min(1).max(160).optional(), conversationId: z.string().min(1).max(160).optional(), turnId: z.string().min(1).max(160).optional() }).strict(),
  z.object({ action: z.literal("MIGRATE"), requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive().optional(), targetProjectId: z.string().min(1).max(160) }).strict(),
]);
export const experienceRefreshSchema = z.object({ action: z.literal("REFRESH"), requestId: z.string().min(1).max(128) }).strict();
export type ExperienceActionInput = z.infer<typeof experienceActionSchema>;

function requireEnabled() {
  if (!isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED", true))
    throw new AppError("EXPERIENCE_DISABLED", "项目经验复用当前未开启", 403);
}

async function ownedExperience(userId: string, projectId: string, experienceId: string) {
  await requirePrivateAccess(userId, projectId);
  const row = await db.agentExperience.findFirst({ where: { id: experienceId, projectId } });
  if (!row || row.ownerUserId !== userId) throw new AppError("EXPERIENCE_NOT_FOUND", "经验不存在或不可访问", 404);
  return row;
}

async function requirePrivateAccess(userId: string, projectId: string) {
  if (!await db.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } }))
    throw new AppError("PROJECT_NOT_FOUND", "项目不存在或不可访问", 404);
}

/** Pure read: no sync, no model, no sample writes. */
export async function readExperiences(userId: string, projectId: string) { return experienceView(userId, projectId); }
/** Legacy name kept for callers; GET must not synchronize. */
export async function listExperiences(userId: string, projectId: string) { return readExperiences(userId, projectId); }

export async function refreshExperiences(userId: string, projectId: string, raw: unknown) {
  requireEnabled();
  experienceRefreshSchema.parse(raw);
  await requirePrivateAccess(userId, projectId);
  const changed = await syncExperiences(userId, projectId);
  return { ...await experienceView(userId, projectId), synced: { changed, at: new Date().toISOString() } };
}

async function experienceView(userId: string, projectId: string) {
  const enabled = isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED", true);
  if (!enabled) return { enabled: false as const, experiences: [], trajectory: null };
  await requirePrivateAccess(userId, projectId);
  const [rows, index, continuity] = await Promise.all([
    db.agentExperience.findMany({ where: { projectId, ownerUserId: userId }, orderBy: { updatedAt: "desc" }, take: 50 }),
    buildTrajectoryIndex(userId, projectId),
    effectiveContinuity(userId, { projectId }),
  ]);
  const statusOrder: Record<string, number> = { ACTIVE: 0, SHADOW: 1, CANDIDATE: 2, REVOKED: 3 };
  rows.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || b.supportCount - a.supportCount);
  const suppressedRoots = new Set(continuity.directives.filter(d => d.kind === "USE_SUPPRESSION").flatMap(d => d.sourceIds));
  const trajectory = {
    missionCount: index.entries.length,
    truncated: index.truncated,
    engineeringSucceeded: index.entries.filter(e => e.resultLabels.engineeringCompleted).length,
    adopted: index.entries.filter(e => e.resultLabels.adopted).length,
    actionsCompleted: index.entries.filter(e => e.resultLabels.actionCompletedWithReceipt).length,
    realOutcomeAttested: index.entries.filter(e => e.resultLabels.userAttested).length,
    independentMeasurements: index.entries.filter(e => e.resultLabels.independentMeasurement).length,
    explicitNegative: index.entries.filter(e => e.resultLabels.negative.length).length,
    note: "工程执行成功、用户采用、行动完成（带复盘回执）、用户自述效果、独立工具实测与明确负结果分别计数，不混作成功样本；未采用与未知不等于反例。",
  };
  return {
    enabled: true as const,
    trajectory,
    experiences: rows.map(row => {
      const evidence = record(row.evidenceJson);
      const labels = record(row.resultLabelsJson);
      const applicability = readApplicability(row.applicabilityJson);
      const counters = Array.isArray(row.counterExamplesJson) ? row.counterExamplesJson as Array<{ missionId?: string; reason?: string; sampleId?: string }> : [];
      const eligible = eligibilityAtRest(row);
      return {
        id: row.id, kind: row.kind, status: row.status, version: row.version,
        title: row.title, statement: row.statement,
        conditions: applicability?.conditions.slice(0, 5) ?? ((row.applicabilityJson as { conditions?: string[] }).conditions ?? []).slice(0, 3),
        unknownConditions: applicability?.unknownConditions.slice(0, 5) ?? ["旧版本未记录适用条件；不会自动升级为建议"],
        notApplicableWhen: applicability?.notApplicableWhen.slice(0, 3) ?? [],
        tools: applicability?.tools.slice(0, 8) ?? ((row.applicabilityJson as { tools?: string[] }).tools ?? []).slice(0, 8),
        toolVersions: row.toolVersionsJson as Record<string, string>,
        supportCount: row.supportCount, counterCount: row.counterCount,
        caseReferenceCount: Number(evidence.caseReferenceCount ?? 0), unknownSampleCount: Number(evidence.unknownCount ?? 0),
        sampleCount: (row.sampleMissionIdsJson as string[]).length,
        sampleMissions: (row.sampleMissionIdsJson as string[]).slice(0, 5),
        resultLabels: labels,
        counterExamples: counters.slice(0, 5),
        conditionsComplete: Boolean(record(applicability?.coverage).complete),
        eligibility: eligible,
        suppressed: suppressedRoots.has("experience:" + row.id),
        originMissionId: (record(row.originJson).missionId as string | undefined) ?? null,
        activatedAt: row.activatedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        revokedReason: row.revokedReason ?? null,
        validUntil: row.validUntil?.toISOString() ?? null,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  };
}

function eligibilityAtRest(row: { status: string; revokedAt: Date | null; validUntil: Date | null; supportCount: number; counterCount: number; applicabilityJson: unknown }) {
  if (row.status !== "ACTIVE") return { eligible: false, reason: row.status === "REVOKED" ? "REVOKED" : row.status === "SHADOW" ? "SHADOW_ONLY" : "NOT_ACTIVE" };
  if (row.revokedAt) return { eligible: false, reason: "REVOKED" };
  if (row.validUntil && +row.validUntil <= Date.now()) return { eligible: false, reason: "EXPIRED" };
  if (row.supportCount === 0) return { eligible: false, reason: "NO_QUALIFIED_SUPPORT" };
  if (row.counterCount >= row.supportCount) return { eligible: false, reason: "EVIDENCE_TURNED_AGAINST" };
  if (!readApplicability(row.applicabilityJson)) return { eligible: false, reason: "LEGACY_CONDITION_SCHEMA" };
  return { eligible: true, reason: "ACTIVE_WITH_QUALIFIED_SUPPORT" };
}

type ActionReceipt = { id: string; kind: string; status: string; version: number; supportCount: number; counterCount: number;
  activatedAt: string | null; revokedAt: string | null; validUntil: string | null; targetExperienceId?: string; feedback?: string };

function receiptOf(row: { id: string; kind: string; status: string; version: number; supportCount: number; counterCount: number;
  activatedAt: Date | null; revokedAt: Date | null; validUntil: Date | null }, targetExperienceId?: string): ActionReceipt {
  return { id: row.id, kind: row.kind, status: row.status, version: row.version, supportCount: row.supportCount,
    counterCount: row.counterCount, activatedAt: row.activatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null, validUntil: row.validUntil?.toISOString() ?? null,
    ...(targetExperienceId ? { targetExperienceId } : {}) };
}

export async function actOnExperience(userId: string, projectId: string, experienceId: string, raw: unknown) {
  requireEnabled();
  const input = experienceActionSchema.parse(raw);
  const row = await ownedExperience(userId, projectId, experienceId);
  const payloadHash = jsonHash({ projectId, experienceId, input });
  const prior = await db.agentExperienceEvent.findUnique({ where: { ownerUserId_requestId: { ownerUserId: userId, requestId: input.requestId } } });
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他经验操作", 409);
    return record(prior.payloadJson).receipt as ActionReceipt;
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== row.version)
    throw new AppError("EXPERIENCE_CHANGED", "经验已在其他设备变化，请刷新后再操作", 409);

  if (input.action === "ACTIVATE") {
    if (row.status === "ACTIVE") return receiptOf(row);
    if (row.status !== "SHADOW")
      throw new AppError("EXPERIENCE_NOT_SHADOW", "仅影子观察中的经验可激活；样本不足的候选不可激活", 409);
    if (row.revokedAt)
      throw new AppError("EXPERIENCE_REVOKED", "该经验已撤销，撤销对此模式长期生效；历史使用记录已保留", 409);
    if (row.supportCount === 0 || row.counterCount >= row.supportCount)
      throw new AppError("EXPERIENCE_INELIGIBLE", "当前证据不支持激活；候选只能作为案例参考", 409);
    const version = row.version + 1;
    const updated = await db.agentExperience.updateMany({ where: { id: row.id, version: row.version },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedByUserId: userId, version } });
    if (!updated.count) throw new AppError("EXPERIENCE_CHANGED", "经验已在其他设备变化，请刷新后再操作", 409);
    const after = await db.agentExperience.findUniqueOrThrow({ where: { id: row.id } });
    const receipt = receiptOf(after);
    await appendEvent(row, input, payloadHash, receipt);
    return receipt;
  }

  if (input.action === "REVOKE") {
    if (row.status === "REVOKED") return receiptOf(row);
    if (row.status === "CANDIDATE")
      throw new AppError("EXPERIENCE_NOT_ACTIVE", "候选经验尚未注入，无需撤销", 409);
    const version = row.version + 1;
    const updated = await db.agentExperience.updateMany({ where: { id: row.id, version: row.version },
      data: { status: "REVOKED", revokedAt: new Date(), revokedReason: input.reason ?? "USER_REVOKED", revokedByUserId: userId, version } });
    if (!updated.count) throw new AppError("EXPERIENCE_CHANGED", "经验已在其他设备变化，请刷新后再操作", 409);
    const after = await db.agentExperience.findUniqueOrThrow({ where: { id: row.id } });
    const receipt = receiptOf(after);
    await appendEvent(row, input, payloadHash, receipt);
    return receipt;
  }

  if (input.action === "FEEDBACK") {
    if (input.missionId) {
      const mission = await db.agentMission.findFirst({ where: { id: input.missionId, projectId, ownerUserId: userId } });
      if (!mission) throw new AppError("EXPERIENCE_SCOPE_DENIED", "原任务不存在或不可访问", 404);
    }
    if (input.conversationId) {
      const conversation = await db.conversation.findFirst({ where: { id: input.conversationId, ownerUserId: userId, homeProjectId: projectId } });
      if (!conversation) throw new AppError("EXPERIENCE_SCOPE_DENIED", "原讨论不存在或不可访问", 404);
    }
    if (!input.missionId && !input.conversationId) throw new AppError("EXPERIENCE_SCOPE_REQUIRED", "反馈需要绑定原任务或原讨论", 409);
    const scopeKey = input.missionId ? "mission:" + input.missionId : `conversation:${input.conversationId}:${input.turnId ?? "latest"}`;
    await db.agentExperienceUse.upsert({
      where: { experienceId_scopeKey_stage: { experienceId: row.id, scopeKey, stage: "USER_FEEDBACK" } },
      create: { experienceId: row.id, missionId: input.missionId ?? null, conversationId: input.conversationId ?? null, turnId: input.turnId ?? null,
        scopeKey, actorKind: input.missionId ? "MISSION" : "CONVERSATION", stage: "USER_FEEDBACK", experienceVersion: row.version,
        matchState: "MATCH", outcomeJson: json({ disposition: input.disposition, reason: input.reason ?? null, by: "USER" }) },
      update: { outcomeJson: json({ disposition: input.disposition, reason: input.reason ?? null, by: "USER" }), experienceVersion: row.version },
    });
    const receipt = receiptOf(row);
    await appendEvent(row, input, payloadHash, { ...receipt, feedback: input.disposition });
    return { ...receipt, feedback: input.disposition };
  }

  // MIGRATE: create a revalidation-required candidate in the target project; never inherit ACTIVE or private samples.
  const targetProjectId = input.targetProjectId;
  if (targetProjectId === projectId) throw new AppError("EXPERIENCE_SAME_PROJECT", "目标项目与当前项目相同", 409);
  await requirePrivateAccess(userId, targetProjectId);
  const existing = await db.agentExperience.findUnique({ where: {
    projectId_ownerUserId_kind_patternHash_conditionKey: { projectId: targetProjectId, ownerUserId: userId, kind: row.kind, patternHash: row.patternHash, conditionKey: row.conditionKey } } });
  if (existing) return { ...receiptOf(row, existing.id), targetStatus: existing.status };
  const migrated = await db.$transaction(async tx => {
    const target = await tx.agentExperience.create({ data: {
      projectId: targetProjectId, ownerUserId: userId, kind: row.kind, patternHash: row.patternHash, conditionKey: row.conditionKey,
      title: row.title, statement: `从其他项目迁移的候选：${row.statement}\n必须在本项目重新核对条件、来源与真实结果后才可进入影子观察。`,
      applicabilityJson: json(row.applicabilityJson), toolVersionsJson: json(row.toolVersionsJson), protocolVersionsJson: json(row.protocolVersionsJson),
      counterExamplesJson: json([]), evidenceJson: json({ schemaVersion: 2, migrationSource: projectId, samples: [], coverage: { complete: false } }),
      eligibilityJson: json({ eligible: false, reason: "MIGRATION_REVALIDATION_REQUIRED" }), resultLabelsJson: json({}),
      originJson: json({ sourceExperienceId: row.id, sourceProjectId: projectId, migratedAt: new Date().toISOString() }),
      status: "CANDIDATE", sampleMissionIdsJson: json([]), supportCount: 0, counterCount: 0,
      schemaVersion: 2,
    } });
    const seq = (await tx.agentExperienceEvent.aggregate({ where: { experienceId: row.id }, _max: { seq: true } }))._max.seq ?? 0;
    const receipt = { ...receiptOf(row, target.id), targetStatus: target.status };
    await tx.agentExperienceEvent.create({ data: { experienceId: row.id, projectId, ownerUserId: userId, seq: seq + 1,
      requestId: input.requestId, action: input.action, actorKind: "USER", expectedVersion: input.expectedVersion,
      resultVersion: row.version, payloadHash, payloadJson: json({ receipt, targetProjectId }) } });
    return receipt;
  });
  return migrated;
}

async function appendEvent(row: { id: string; projectId: string; ownerUserId: string; version: number },
  input: ExperienceActionInput, payloadHash: string, receipt: ActionReceipt) {
  const seq = (await db.agentExperienceEvent.aggregate({ where: { experienceId: row.id }, _max: { seq: true } }))._max.seq ?? 0;
  await db.agentExperienceEvent.create({ data: { experienceId: row.id, projectId: row.projectId, ownerUserId: row.ownerUserId,
    seq: seq + 1, requestId: input.requestId, action: input.action, actorKind: "USER",
    expectedVersion: input.expectedVersion, resultVersion: receipt.version, payloadHash,
    payloadJson: json({ receipt, reason: "reason" in input ? input.reason ?? null : null, input }) } });
}

/** Bounded refresh after a real result commit; failures must not roll back the original business receipt. */
export async function refreshExperiencesAfterResult(ownerUserId: string, projectId: string) {
  if (!isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED", true)) return;
  try { await syncExperiences(ownerUserId, projectId); } catch { /* result receipt remains authoritative */ }
}

export async function refreshExperiencesForProject(projectId: string) {
  const owner = await db.projectMembership.findFirst({ where: { projectId, role: "OWNER" }, select: { userId: true } });
  if (owner) await refreshExperiencesAfterResult(owner.userId, projectId);
}
