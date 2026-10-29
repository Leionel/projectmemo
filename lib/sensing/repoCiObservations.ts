import { db } from "@/lib/db";
import type { Tx } from "@/lib/mission/repository";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import type { RepositorySourceMeta } from "@/lib/types/repositoryCi";
import { isFeatureEnabled } from "@/lib/config/features";
type Stored = { repository: RepositorySourceMeta; sourceId?: string; id: string; revision: string; hash?: string; excerpt?: string; text?: string; projectId?: string };
export async function findRepositoryObservation(projectId: string, sourceId: string, tx: Tx = db, ownerId?: string): Promise<Stored | null> {
  const rows = await tx.$queryRaw<Array<{ value: string }>>`
    SELECT s.value FROM "ConversationTurn" t JOIN "Conversation" c ON c.id=t."conversationId", json_each(t."readManifestJson", '$.repositorySources') s
    WHERE json_extract(s.value, '$.sourceId')=${sourceId} AND json_extract(s.value, '$.projectId')=${projectId}
      AND (${ownerId ?? null} IS NULL OR c."ownerUserId"=${ownerId ?? null}) LIMIT 1`;
  if (rows[0]) return JSON.parse(rows[0].value);
  const steps = await tx.$queryRaw<Array<{ value: string }>>`
    SELECT s.value FROM "AgentMissionStep" st JOIN "AgentMission" m ON m.id=st."missionId", json_each(st."resultJson", '$.sources') s
    WHERE json_extract(s.value, '$.id')=${sourceId} AND m."projectId"=${projectId}
      AND (${ownerId ?? null} IS NULL OR m."ownerUserId"=${ownerId ?? null}) LIMIT 1`;
  return steps[0] ? JSON.parse(steps[0].value) : null;
}
export async function validateRepositoryObservation(userId: string, projectId: string, sourceId: string, revision: string, tx: Tx = db) {
  const source = await findRepositoryObservation(projectId, sourceId, tx, userId);
  if (!source?.repository || (source.hash ?? source.revision) !== revision) throw new AppError("SOURCE_CHANGED", "原 CI 观察不存在或版本已变化", 409);
  const r = source.repository;
  if ((source.hash ?? source.revision) !== jsonHash({ repository: r, text: source.excerpt ?? source.text })) throw new AppError("SOURCE_CHANGED", "CI 观察正文与原记录不一致", 409);
  const member = await tx.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } });
  const c = await tx.sourceConnection.findFirst({ where: { id: r.connectionId, projectId, ownerUserId: userId, status: "ACTIVE", revokedAt: null, revision: r.connectionRevision } });
  if (!isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false) || !member || !c || !["COMMITS_AND_CI", "COMMITS_CI_LOGS"].includes(c.signalKind) || r.kind === "LOG" && c.signalKind !== "COMMITS_CI_LOGS")
    throw new AppError("CONNECTION_CHANGED", "CI 授权已撤销或变化，原观察仅保留历史", 409);
  return source;
}
