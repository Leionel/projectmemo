import { db } from "@/lib/db";
import type { AgentMission } from "@/lib/generated/prisma/client";

/**
 * P3-A 注入：只提供文字建议，不授予业务写入权限，不修改事实，不绕过用户确认。
 * 停止新注入（保留历史使用记录）的条件：非 ACTIVE、已撤销、工具版本不兼容、
 * 协议 schemaVersion 不兼容、反例计数追平支持样本。
 */

export type ExperienceAdvisory = {
  id: string;
  kind: string;
  title: string;
  statement: string;
  conditions: string[];
  note: "项目内经验建议，不改变权限";
};

export type InjectionDecision = { advisory: ExperienceAdvisory; experienceId: string } | { suppressed: { experienceId: string; reason: string } };

export async function injectionDecisions(m: AgentMission, usedTools: Array<{ name: string; version: string }>, protocolSchemaVersion: number | null): Promise<InjectionDecision[]> {
  const rows = await db.agentExperience.findMany({
    where: { projectId: m.projectId, ownerUserId: m.ownerUserId, status: "ACTIVE" },
    orderBy: { supportCount: "desc" },
    take: 8,
  });
  const decisions: InjectionDecision[] = [];
  for (const row of rows) {
    if (row.revokedAt) { decisions.push({ suppressed: { experienceId: row.id, reason: "REVOKED" } }); continue; }
    const toolVersions = row.toolVersionsJson as Record<string, string>;
    const protocolVersions = row.protocolVersionsJson as number[];
    if (protocolSchemaVersion === null || (protocolVersions.length > 0 && !protocolVersions.includes(protocolSchemaVersion))) {
      decisions.push({ suppressed: { experienceId: row.id, reason: `PROTOCOL_VERSION_MISMATCH:${protocolSchemaVersion}` } }); continue;
    }
    const registry = new Map(usedTools.map(t => [t.name, t.version]));
    const mismatched = Object.entries(toolVersions).find(([name, version]) => registry.get(name) !== version);
    if (mismatched) { decisions.push({ suppressed: { experienceId: row.id, reason: `TOOL_VERSION_MISMATCH:${mismatched[0]}` } }); continue; }
    if (row.supportCount > 0 && row.counterCount >= row.supportCount) { decisions.push({ suppressed: { experienceId: row.id, reason: "EVIDENCE_TURNED_AGAINST" } }); continue; }
    const applicability = row.applicabilityJson as { conditions?: string[] };
    decisions.push({
      advisory: {
        id: row.id, kind: row.kind, title: row.title, statement: row.statement,
        conditions: (applicability.conditions ?? []).slice(0, 3),
        note: "项目内经验建议，不改变权限",
      },
      experienceId: row.id,
    });
  }
  return decisions;
}

/** 记录使用（best-effort）：同一委托同一阶段只记一次，重试不重复计。撤销后不再新增记录。 */
export async function recordUses(missionId: string, decisions: InjectionDecision[], contextHash: string | null): Promise<void> {
  for (const decision of decisions) {
    if (!("advisory" in decision)) continue;
    try {
      await db.agentExperienceUse.upsert({
        where: { experienceId_missionId_stage: { experienceId: decision.experienceId, missionId, stage: "SUGGESTION" } },
        create: { experienceId: decision.experienceId, missionId, stage: "SUGGESTION", contextHash },
        update: { contextHash },
      });
    } catch { /* 建议注入失败不影响委托执行 */ }
  }
}

/** UI 就近展示：ACTIVE（注入中）+ SHADOW（影子观察，不注入）；供委托详情使用。 */
export async function suggestionsForMission(m: AgentMission) {
  const rows = await db.agentExperience.findMany({
    where: { projectId: m.projectId, ownerUserId: m.ownerUserId, status: { in: ["ACTIVE", "SHADOW"] } },
    orderBy: [{ status: "asc" }, { supportCount: "desc" }],
    take: 10,
  });
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    statement: row.statement,
    conditions: ((row.applicabilityJson as { conditions?: string[] }).conditions ?? []).slice(0, 3),
    toolVersions: row.toolVersionsJson as Record<string, string>,
    supportCount: row.supportCount,
    counterCount: row.counterCount,
    sampleCount: (row.sampleMissionIdsJson as string[]).length,
    revoked: row.revokedAt !== null,
  }));
}
