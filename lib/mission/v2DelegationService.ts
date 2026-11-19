import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "./contracts";
import { record } from "@/lib/conversation/repository";
import { assertOwner, event, type Tx } from "./repository";
import { createMissionInTx, editContinuationPolicy } from "./missionService";
import { boundedInvestigationPolicySchema } from "@/lib/types/mission";
import { parseProjectMaterial } from "@/lib/intake/projectMaterial";
import { PROJECT_PRESET_IDS } from "@/lib/intake/projectPresets";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { readProjectMaterial } from "./sourceSignals";
import { V2_DELEGATION_LIMITS } from "@/lib/types/v2Delegation";

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
  materialText: z.string().trim().max(MAX_MATERIAL).default(""),
  materialName: z.string().trim().min(1).max(180).optional(),
  presetId: z.enum(PROJECT_PRESET_IDS).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(V2_DELEGATION_LIMITS.days),
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
    checkEveryMinutes: 60, maxModels: V2_DELEGATION_LIMITS.maxModels, maxTools: V2_DELEGATION_LIMITS.maxTools, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output", "inspect_project"],
    connectionIds: [], trackBranchHead: false, timezone: "Asia/Shanghai",
  });
}

function canonicalPreview(projectId: string, body: z.infer<typeof previewInput>, expiresAt: string) {
  const policy = delegationPolicy(expiresAt);
  const material = body.materialText ? parseProjectMaterial(body.materialText, body.materialName) : null;
  if (!material && body.materialName) throw new AppError("DELEGATION_MATERIAL_REQUIRED", "请重新导入该文件，或直接使用项目已有资料", 422);
  const materialText = material?.text ?? "";
  const payload = {
    schemaVersion: 1 as const, projectId, goal: body.goal, materialTextHash: jsonHash(materialText),
    materialLength: materialText.length, expiresAt, policyHash: jsonHash(policy),
    ...(body.materialName ? { materialName: body.materialName } : {}), ...(body.presetId ? { presetId: body.presetId } : {}),
  };
  return { payload, previewHash: jsonHash(payload), policy, materialText, material };
}

async function requireExistingMaterial(userId: string, projectId: string, tx: Tx = db) {
  const [captures, attachments] = await Promise.all([
    tx.capture.findMany({ where: { projectId, rawText: { not: "" } }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true } }),
    tx.attachment.findMany({ where: { projectId, extractionStatus: "SUCCESS" }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true } }),
  ]);
  for (const id of [...captures.map(row => "capture:" + row.id), ...attachments.map(row => "attachment:" + row.id)]) {
    if ((await sourceUse(userId, projectId, id, tx)).state !== "ALLOWED") continue;
    const source = await readProjectMaterial(projectId, id, tx);
    if (source?.text.trim()) return;
  }
  throw new AppError("DELEGATION_MATERIAL_REQUIRED", "这个项目还没有可用于跟进的资料，请先补一份", 422);
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
  if (!canonical.material) await requireExistingMaterial(userId, projectId);
  return {
    schemaVersion: 1 as const, projectId, goal: body.goal,
    material: { length: canonical.materialText.length, preview: canonical.materialText.slice(0, 400),
      format: canonical.material?.format ?? null, name: canonical.material?.name ?? null, rows: canonical.material?.rows, columns: canonical.material?.columns },
    expiresAt, policy: canonical.policy, capabilities: CAPABILITIES,
    previewHash: canonical.previewHash,
    personalMemoryMode: body.presetId === "client" ? "PROJECT_ONLY" : "UNCHANGED",
    writeEffect: "NONE" as const,
    note: "确认前不会创建资料、委托或许可；确认后可在成果工作台查看版本、依据与过程。",
  };
}

export type V2DelegationResult = {
  missionId: string; projectId: string; materialSourceId: string | null; policyHash: string;
  expiresAt: string; workbenchUrl: string; alreadyCreated: boolean;
};

type V2DelegationReceipt = {
  schemaVersion: 1; requestId: string; projectId: string; ownerUserId: string;
  goalHash: string; materialHash: string; previewHash: string; policyHash: string;
  expiresAt: string; materialSourceId: string | null; confirmedAt: string;
  materialName?: string; presetId?: string;
};

function readReceipt(mission: { planJson: unknown }): V2DelegationReceipt | null {
  const value = record(record(mission.planJson).v2DelegationReceipt);
  return value.schemaVersion === 1 && typeof value.projectId === "string" ? value as unknown as V2DelegationReceipt : null;
}

function idempotentResult(mission: { id: string; projectId: string; planJson: unknown }, input: {
  projectId: string; goal: string; materialText: string; previewHash: string; expiresAt: string; requestId: string;
  materialName?: string; presetId?: string;
}): V2DelegationResult {
  const receipt = readReceipt(mission);
  const conflict = (reason: string) => new AppError("DELEGATION_IDEMPOTENCY_CONFLICT", reason, 409, { requestId: input.requestId });
  if (!receipt) throw conflict("该请求编号已有原确认，但缺少可核对的绑定回执；请使用新的请求编号重新确认");
  if (mission.projectId !== receipt.projectId || input.projectId !== receipt.projectId)
    throw conflict("该请求编号已用于另一个项目的确认，不能换项目重放");
  if (receipt.goalHash !== jsonHash(input.goal) || receipt.materialHash !== jsonHash(input.materialText)
    || receipt.previewHash !== input.previewHash || receipt.expiresAt !== input.expiresAt
    || receipt.materialName !== input.materialName || receipt.presetId !== input.presetId)
    throw conflict("该请求编号已用于内容不同的确认，不能更改目标、材料或许可重放");
  return {
    missionId: mission.id, projectId: mission.projectId, materialSourceId: receipt.materialSourceId,
    policyHash: receipt.policyHash, expiresAt: receipt.expiresAt,
    workbenchUrl: "/v2/workbench?missionId=" + mission.id, alreadyCreated: true,
  };
}

export async function confirmV2Delegation(userId: string, projectId: string, raw: unknown): Promise<V2DelegationResult> {
  requireDelegationEntry();
  const body = confirmInput.parse(raw);
  const goal = body.goal, materialText = body.materialText ? parseProjectMaterial(body.materialText, body.materialName).text : "";
  const createRequestId = "v2-delegation:" + body.requestId;
  const materialRequestId = "v2-material:" + body.requestId;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx: Tx) => {
        await assertOwner(userId, projectId, tx);
        // Replay is decided against the persisted receipt before any period or preview revalidation:
        // an identical retry must survive preview expiry and later policy edits.
        const existing = await tx.agentMission.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: userId, createRequestId } } });
        if (existing) return idempotentResult(existing, { projectId, goal, materialText, previewHash: body.previewHash, expiresAt: body.expiresAt, requestId: body.requestId,
          materialName: body.materialName, presetId: body.presetId });
        const expiresAtMs = Date.parse(body.expiresAt);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 30 * 86400000)
          throw new AppError("DELEGATION_PERIOD_CHANGED", "预览的跟进期限已失效，请重新预览", 409);
        const canonical = canonicalPreview(projectId, body, body.expiresAt);
        if (canonical.previewHash !== body.previewHash)
          throw new AppError("DELEGATION_PREVIEW_CHANGED", "预览内容已变化，请重新核对范围与期限", 409);
        if (!canonical.material) await requireExistingMaterial(userId, projectId, tx);
        const capture = canonical.material ? await tx.capture.upsert({
          where: { projectId_requestId: { projectId, requestId: materialRequestId } },
          create: { projectId, requestId: materialRequestId, requestHash: jsonHash(canonical.materialText), rawText: canonical.materialText, sourceType: "TEXT" },
          update: {},
        }) : null;
        if (body.presetId === "client") await tx.projectMembership.updateMany({
          where: { userId, projectId, personalMemoryMode: { not: "PROJECT_ONLY" } },
          data: { personalMemoryMode: "PROJECT_ONLY", personalMemoryModeVersion: { increment: 1 } },
        });
        const created = await createMissionInTx(tx, userId, {
          runtimeProtocolVersion: 2, projectId, requestId: createRequestId,
          goal, successCriteria: ["DRAFT_EXISTS"], llmContextApproved: true,
          missionConstraints: { executionBoundary: "READ_ANALYZE" },
        });
        const policyHash = jsonHash(canonical.policy);
        const receipt: V2DelegationReceipt = {
          schemaVersion: 1, requestId: body.requestId, projectId, ownerUserId: userId,
          goalHash: jsonHash(goal), materialHash: jsonHash(materialText), previewHash: body.previewHash,
          policyHash, expiresAt: canonical.policy.expiresAt, materialSourceId: capture ? "capture:" + capture.id : null,
          confirmedAt: new Date().toISOString(),
          ...(body.materialName ? { materialName: body.materialName } : {}), ...(body.presetId ? { presetId: body.presetId } : {}),
        };
        const updated = await editContinuationPolicy(userId, created.id, {
          requestId: "v2-delegation-policy:" + body.requestId, expectedVersion: created.version, policy: canonical.policy,
        }, tx);
        await tx.agentMission.update({ where: { id: updated.id }, data: { planJson: json({ ...record(updated.planJson), v2DelegationReceipt: receipt }) } });
        await event(tx, updated.id, "V2_DELEGATION_CONFIRMED", {
          receipt, previewHash: body.previewHash, materialSourceId: receipt.materialSourceId,
          policyHash, expiresAt: receipt.expiresAt, grantsAuthority: false, deliveryCheckpointOnly: true,
        }, { id: "v2-delegation:" + body.requestId, hash: body.previewHash });
        return {
          missionId: updated.id, projectId: updated.projectId, materialSourceId: receipt.materialSourceId,
          policyHash, expiresAt: receipt.expiresAt, workbenchUrl: "/v2/workbench?missionId=" + updated.id, alreadyCreated: false,
        } satisfies V2DelegationResult;
      });
    } catch (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (attempt < 2 && ["P2002", "P1008", "P2034", "SQLITE_BUSY"].includes(code)) {
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
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

