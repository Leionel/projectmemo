import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { jsonHash } from "./contracts";
import { assertOwner, event, type Tx } from "./repository";
import { createMissionInTx, editContinuationPolicy } from "./missionService";
import { boundedInvestigationPolicySchema } from "@/lib/types/mission";

/**
 * Product entry for a V2 bounded continuous delegation.
 *
 * One reviewed preview, then one confirmation. The confirmation atomically creates the imported
 * text material, the v2 Mission, the bounded continuation policy and the receipt event. The
 * preview itself writes no business state. No provider can be selected from this path.
 */

const MAX_MATERIAL = 20000;
const previewInput = z.object({
  goal: z.string().trim().min(3).max(300),
  materialText: z.string().trim().min(1).max(MAX_MATERIAL),
  expiresInDays: z.number().int().min(1).max(30).default(7),
}).strict();
const confirmInput = previewInput.extend({
  requestId: z.string().min(1).max(128),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
}).strict();

function requireDelegationEntry() {
  if (!isFeatureEnabled("MISSION_ENABLED", false)) throw new AppError("MISSION_DISABLED", "委托功能尚未启用", 503);
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
  if (!isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false)) throw new AppError("DELEGATION_DISABLED", "持续跟进暂未开启", 503);
}

export function delegationPolicy(expiresAt: string) {
  return boundedInvestigationPolicySchema.parse({
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt,
    checkEveryMinutes: 60, maxModels: 24, maxTools: 32, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output", "inspect_project"],
    connectionIds: [], trackBranchHead: false, timezone: "Asia/Shanghai",
  });
}

function canonicalPreview(projectId: string, body: z.infer<typeof previewInput>, expiresAt: string) {
  const policy = delegationPolicy(expiresAt);
  const materialText = body.materialText.replace(/\r\n/g, "\n").trim();
  const payload = {
    schemaVersion: 1 as const, projectId, goal: body.goal, materialTextHash: jsonHash(materialText),
    materialLength: materialText.length, expiresAt, policyHash: jsonHash(policy),
  };
  return { payload, previewHash: jsonHash(payload), policy, materialText };
}

const CAPABILITIES = {
  readProjectMaterial: true, createPrivateDraft: true, updateMissionDraft: true,
  externalRead: false, publicResearch: false, businessWrite: false, autoSend: false,
  allowedTools: ["read_project_material", "save_mission_output", "inspect_project"],
  note: "路由只能收窄这些能力；联网、公开研究、业务写入、外发与付费调用都不在这次确认里。",
};

export async function previewV2Delegation(userId: string, projectId: string, raw: unknown) {
  requireDelegationEntry();
  const body = previewInput.parse(raw);
  await assertOwner(userId, projectId);
  const expiresAt = new Date(Date.now() + body.expiresInDays * 86400000).toISOString();
  const canonical = canonicalPreview(projectId, body, expiresAt);
  return {
    schemaVersion: 1 as const, projectId, goal: body.goal,
    material: { length: canonical.materialText.length, preview: canonical.materialText.slice(0, 400) },
    expiresAt, policy: canonical.policy, capabilities: CAPABILITIES,
    previewHash: canonical.previewHash,
    writeEffect: "NONE" as const,
    note: "确认前不会创建资料、委托或许可；确认后可在成果工作台查看版本、依据与过程。",
  };
}

export type V2DelegationResult = {
  missionId: string; projectId: string; materialSourceId: string; policyHash: string;
  expiresAt: string; workbenchUrl: string; alreadyCreated: boolean;
};

export async function confirmV2Delegation(userId: string, projectId: string, raw: unknown): Promise<V2DelegationResult> {
  requireDelegationEntry();
  const body = confirmInput.parse(raw);
  const expiresAtMs = Date.parse(body.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 30 * 86400000)
    throw new AppError("DELEGATION_PERIOD_CHANGED", "预览的跟进期限已失效，请重新预览", 409);
  const canonical = canonicalPreview(projectId, body, body.expiresAt);
  if (canonical.previewHash !== body.previewHash) throw new AppError("DELEGATION_PREVIEW_CHANGED", "预览内容已变化，请重新核对范围与期限", 409);
  const createRequestId = "v2-delegation:" + body.requestId;
  const materialRequestId = "v2-material:" + body.requestId;
  return db.$transaction(async (tx: Tx) => {
    await assertOwner(userId, projectId, tx);
    const existing = await tx.agentMission.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: userId, createRequestId } } });
    if (existing) {
      const capture = await tx.capture.findUnique({ where: { projectId_requestId: { projectId, requestId: materialRequestId } } });
      const policy = boundedInvestigationPolicySchema.parse(existing.continuationPolicyJson);
      return {
        missionId: existing.id, projectId, materialSourceId: capture ? "capture:" + capture.id : "",
        policyHash: jsonHash(policy), expiresAt: policy.expiresAt,
        workbenchUrl: "/v2/workbench?missionId=" + existing.id, alreadyCreated: true,
      } satisfies V2DelegationResult;
    }
    const capture = await tx.capture.upsert({
      where: { projectId_requestId: { projectId, requestId: materialRequestId } },
      create: { projectId, requestId: materialRequestId, requestHash: jsonHash(canonical.materialText), rawText: canonical.materialText, sourceType: "TEXT" },
      update: {},
    });
    const created = await createMissionInTx(tx, userId, {
      runtimeProtocolVersion: 2, projectId, requestId: createRequestId,
      goal: body.goal, successCriteria: ["DRAFT_EXISTS"], llmContextApproved: true,
      missionConstraints: { executionBoundary: "READ_ANALYZE" },
    });
    const updated = await editContinuationPolicy(userId, created.id, {
      requestId: "v2-delegation-policy:" + body.requestId, expectedVersion: created.version, policy: canonical.policy,
    }, tx);
    await event(tx, created.id, "V2_DELEGATION_CONFIRMED", {
      previewHash: body.previewHash, materialSourceId: "capture:" + capture.id,
      policyHash: jsonHash(canonical.policy), expiresAt: canonical.policy.expiresAt,
      grantsAuthority: false, deliveryCheckpointOnly: true,
    }, { id: "v2-delegation:" + body.requestId, hash: body.previewHash });
    return {
      missionId: updated.id, projectId, materialSourceId: "capture:" + capture.id,
      policyHash: jsonHash(canonical.policy), expiresAt: canonical.policy.expiresAt,
      workbenchUrl: "/v2/workbench?missionId=" + updated.id, alreadyCreated: false,
    } satisfies V2DelegationResult;
  });
}

/** Read-only receipt projection for the project page after confirmation (no business state change). */
export async function listV2Delegations(userId: string, projectId: string) {
  if (!isFeatureEnabled("MISSION_ENABLED", false)) return { enabled: false as const, items: [] };
  await assertOwner(userId, projectId);
  const rows = await db.agentMission.findMany({ where: { ownerUserId: userId, projectId, runtimeProtocolVersion: 2 }, orderBy: { createdAt: "desc" }, take: 5,
    select: { id: true, goal: true, status: true, continuationPolicyJson: true, planJson: true, createdAt: true } });
  return { enabled: isFeatureEnabled("MISSION_V2_ENABLED", false), items: rows.map(row => ({
    id: row.id, goal: row.goal, status: row.status,
    expiresAt: (row.continuationPolicyJson as { expiresAt?: string }).expiresAt ?? null,
    workbenchUrl: "/v2/workbench?missionId=" + row.id,
  })) };
}

