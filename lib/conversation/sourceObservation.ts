import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { assertProject, type Tx } from "./repository";
import type { ConversationActor } from "@/lib/types/conversation";

/** Read already-authorized cached GitHub observations only. Never refreshes the network or adopts a Capture. */
export async function readSourceObservation(actor: ConversationActor, projectId: string, connectionId: string, tx: Tx = db) {
  if ((await assertProject(actor, projectId, tx)).role !== "OWNER") throw new AppError("ENTRY_NOT_FOUND", "仓库观察不可访问", 404);
  const connection = await tx.sourceConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: actor.userId, status: "ACTIVE", revokedAt: null } });
  if (!connection) throw new AppError("ENTRY_NOT_FOUND", "仓库连接已撤销或不可访问", 404);
  const signals = await tx.externalSignal.findMany({ where: { connectionId, projectId, ownerUserId: actor.userId, status: { in: ["CANDIDATE", "ADOPTED"] } },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }], take: 20 });
  const signalIds = signals.map(s => s.sha);
  const revision = jsonHash({ connectionId, repo: connection.repo, ref: connection.ref, signals: signals.map(s => ({ sha: s.sha, title: s.title, linkedActionId: s.linkedActionId })) });
  const text = ["已授权仓库 " + connection.repo + " · " + connection.ref,
    ...signals.map(s => `- ${s.title} · ${s.sha.slice(0, 10)}${s.linkedActionId ? " · 关联原行动 " + s.linkedActionId : ""}`),
    signals.length ? "提交记录只是外部线索，是否影响当前目标仍待核对，不能证明部署、实验或行动完成。" : "尚无已缓存的提交线索；可在原资料页明确刷新。"].join("\n");
  return { revision, text, signalIds, ref: { kind: "PROJECT" as const, id: projectId, projectId, title: connection.repo + " 仓库线索", href: "/projects/" + projectId + "/knowledge" } };
}
