import { actorDirectiveScope } from "@/lib/continuity/directiveService";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
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
  if(connection.provider==="DEPLOYMENT"){
    await assertSourceUse(actor.userId,projectId,"connection:"+connectionId,tx,actorDirectiveScope(actor,projectId));
    const current=await(await import("@/lib/sensing/deploymentConnections")).deploymentConnection(actor.userId,projectId,connectionId,tx);
    return{revision:current.revision,text:`已获准只读观察 ${current.config.environment}；期望release ${current.config.expectedRelease}。只允许固定路径 ${[current.config.healthPath,current.config.userPath,current.config.logPath].filter(Boolean).join("、")}，许可至 ${current.config.expiresAt}。这是用户配置的读取范围，还没有在本次讨论派发HTTP；需用原调查工具取得实际观察。`,signalIds:[] as string[],access:"DEPLOYMENT",ref:{kind:"PROJECT" as const,id:projectId,projectId,title:current.config.environment+" 环境观察",href:"/projects/"+projectId+"/records"}};
  }
  if(connection.provider!=="GITHUB")throw new AppError("ENTRY_NOT_FOUND","来源类型不可访问",404);
  await assertSourceUse(actor.userId, projectId, "repo:" + connectionId, tx, actorDirectiveScope(actor, projectId));
  const signals = await tx.externalSignal.findMany({ where: { connectionId, projectId, ownerUserId: actor.userId, status: { in: ["CANDIDATE", "ADOPTED"] } },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }], take: 20 });
  const signalIds = signals.map(s => s.sha);
  const revision = jsonHash({ connectionId, connectionRevision: connection.revision, access: connection.signalKind, repo: connection.repo, ref: connection.ref, signals: signals.map(s => ({ sha: s.sha, title: s.title, linkedActionId: s.linkedActionId })) });
  const text = ["已授权仓库 " + connection.repo + " · " + connection.ref,
    ...signals.map(s => `- ${s.title} · ${s.sha.slice(0, 10)}${s.linkedActionId ? " · 关联原行动 " + s.linkedActionId : ""}`),
    signals.length ? "提交记录只是外部线索，是否影响当前目标仍待核对，不能证明部署、实验或行动完成。" : "尚无已缓存的提交线索；可在原资料页明确刷新。"].join("\n");
  return { revision, text, signalIds, access: connection.signalKind, ref: { kind: "PROJECT" as const, id: projectId, projectId, title: connection.repo + " 仓库线索", href: "/projects/" + projectId + "/knowledge" } };
}
