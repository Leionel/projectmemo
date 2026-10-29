import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { z } from "zod";
import { syncExperiences } from "./extract";
import { buildTrajectoryIndex } from "./trajectoryIndex";

/**
 * P3-A 经验管理服务。
 * 激活只能由用户在 SHADOW 状态发起（样本不足的 CANDIDATE 不可激活）；
 * 撤销保留行与全部使用记录，只是停止新注入。全程不调用模型。
 */

export const experienceActionSchema = z
  .object({
    action: z.enum(["ACTIVATE", "REVOKE"]),
    requestId: z.string().min(1).max(128),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
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

export async function listExperiences(userId: string, projectId: string) {
  const enabled = isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED", true);
  if (!enabled) return { enabled: false as const, experiences: [], trajectory: null };
  await requirePrivateAccess(userId, projectId);
  await syncExperiences(userId, projectId);
  const [rows, index] = await Promise.all([
    db.agentExperience.findMany({ where: { projectId, ownerUserId: userId }, orderBy: { supportCount: "desc" }, take: 50 }),
    buildTrajectoryIndex(userId, projectId),
  ]);
  const statusOrder: Record<string, number> = { SHADOW: 0, ACTIVE: 1, CANDIDATE: 2, REVOKED: 3 };
  rows.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || b.supportCount - a.supportCount);
  const trajectory = {
    missionCount: index.entries.length,
    truncated: index.truncated,
    engineeringSucceeded: index.entries.filter(e => e.engineeringCompleted).length,
    adopted: index.entries.filter(e => e.adoptionCount > 0).length,
    actionsCompleted: index.entries.flatMap(e => e.actionOutcomes).filter(a => a.resultCardId !== null).length,
    realOutcomeAttested: index.entries.filter(e => e.realOutcome === "USER_ATTESTED").length,
    note: "工程执行成功、用户采用、行动完成（带复盘回执）与用户自述效果分别计数，不混作成功样本。",
  };
  return {
    enabled: true as const,
    trajectory,
    experiences: rows.map(row => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      statement: row.statement,
      conditions: ((row.applicabilityJson as { conditions?: string[] }).conditions ?? []).slice(0, 3),
      tools: ((row.applicabilityJson as { tools?: string[] }).tools ?? []).slice(0, 8),
      toolVersions: row.toolVersionsJson as Record<string, string>,
      supportCount: row.supportCount,
      counterCount: row.counterCount,
      sampleCount: (row.sampleMissionIdsJson as string[]).length,
      sampleMissions: (row.sampleMissionIdsJson as string[]).slice(0, 5),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedReason: row.revokedReason ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function actOnExperience(userId: string, projectId: string, experienceId: string, raw: unknown) {
  requireEnabled();
  const input = experienceActionSchema.parse(raw);
  const row = await ownedExperience(userId, projectId, experienceId);
  if (input.action === "ACTIVATE") {
    if (row.status === "ACTIVE") return current(row);
    if (row.status !== "SHADOW")
      throw new AppError("EXPERIENCE_NOT_SHADOW", "仅影子观察中的经验可激活；样本不足的候选不可激活", 409);
    if (row.revokedAt)
      throw new AppError("EXPERIENCE_REVOKED", "该经验已撤销，撤销对此模式长期生效；历史使用记录已保留", 409);
    const updated = await db.agentExperience.update({ where: { id: row.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    return current(updated);
  }
  if (row.status === "REVOKED") return current(row);
  if (row.status === "CANDIDATE")
    throw new AppError("EXPERIENCE_NOT_ACTIVE", "候选经验尚未注入，无需撤销", 409);
  const updated = await db.agentExperience.update({
    where: { id: row.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: input.reason ?? "USER_REVOKED" },
  });
  return current(updated);
}

function current(row: { id: string; kind: string; status: string; supportCount: number; counterCount: number; activatedAt: Date | null; revokedAt: Date | null }) {
  return { id: row.id, kind: row.kind, status: row.status, supportCount: row.supportCount, counterCount: row.counterCount, activatedAt: row.activatedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null };
}
