import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Prisma } from "@/lib/generated/prisma/client";
import { json, jsonHash, type Source } from "./contracts";
export type Tx = Prisma.TransactionClient;
export async function assertOwner(userId: string, projectId: string, tx: Tx = db) {
  const membership = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId } } });
  if (membership?.role !== "OWNER") throw new AppError("MISSION_NOT_FOUND", "没有可访问的委托", 404);
}
export async function ownedMission(userId: string, id: string, tx: Tx = db) {
  const m = await tx.agentMission.findFirst({ where: { id, ownerUserId: userId } });
  if (!m) throw new AppError("MISSION_NOT_FOUND", "没有可访问的委托", 404);
  await assertOwner(userId, m.projectId, tx); return m;
}
export async function event(tx: Tx, id: string, type: string, payload: unknown, command?: { id: string; hash: string }) {
  const m = await tx.agentMission.update({ where: { id }, data: { nextEventSeq: { increment: 1 } } });
  return tx.agentMissionEvent.create({ data: { missionId: id, seq: m.nextEventSeq, type, payloadJson: json(payload), commandRequestId: command?.id, commandPayloadHash: command?.hash } });
}
export async function lock(tx: Tx, id: string) { await tx.agentMission.updateMany({ where: { id }, data: { version: { increment: 0 } } }); }
export async function sourceHash(projectId: string, id: string, tx: Tx = db): Promise<string | null> {
  if (id === `project:${projectId}`) {
    const project = await tx.project.findUnique({where:{id:projectId},select:{title:true,goal:true,deadline:true}});
    const actions = await tx.actionItem.findMany({where:{projectId,isSimulated:false},orderBy:{id:"asc"},select:{id:true,title:true,status:true,dependencyVersion:true,dueAt:true}});
    return project ? jsonHash({project,actions}) : null;
  }
  if (id.startsWith("card:")) {
    const card = await tx.knowledgeCard.findFirst({where:{id:id.slice(5),projectId},include:{capture:true,attachment:{include:{revisions:{orderBy:{revisionIndex:"desc"},take:1}}}}});
    if (!card) return null;
    const relations = await tx.cardRelation.findMany({where:{OR:[{currentCardId:card.id},{relatedCardId:card.id}]},orderBy:{id:"asc"}});
    const now=Date.now();
    return jsonHash({card,relations:relations.map(r=>({...r,effective:r.confirmed && !!r.confirmedAt && +r.confirmedAt<=now && (!r.revokedAt || +r.revokedAt>now) && (!r.validFrom || +r.validFrom<=now) && (!r.validTo || +r.validTo>now)}))});
  }
  return null;
}
export async function validateSources(projectId: string, sources: Source[], tx: Tx = db) {
  for (const source of sources.filter(s=>s.kind==="PROJECT")) if (await sourceHash(projectId,source.id,tx)!==source.hash) throw new AppError("SOURCE_CHANGED","来源已变化，请重新读取并预览",409);
}
export async function commandReplay(tx: Tx, id: string, requestId: string, hash: string) {
  const replay=await tx.agentMissionEvent.findUnique({where:{missionId_commandRequestId:{missionId:id,commandRequestId:`cmd:${requestId}`}}});
  if (replay && replay.commandPayloadHash!==hash) throw new AppError("REQUEST_ID_REUSED","请求编号已用于其他操作",409);
  return replay;
}
