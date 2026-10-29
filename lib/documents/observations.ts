import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Tx } from "@/lib/mission/repository";
import { sourceHash } from "@/lib/mission/repository";
import { jsonHash } from "@/lib/mission/contracts";
import type { DocumentMeta } from "@/lib/types/document";
import { isFeatureEnabled } from "@/lib/config/features";
type Stored={document:DocumentMeta;sourceId?:string;id:string;revision:string;hash?:string;text?:string;excerpt?:string;projectId?:string};
export async function findDocumentObservation(projectId:string,id:string,tx:Tx=db,ownerId?:string):Promise<Stored|null>{
 const turns=await tx.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "ConversationTurn" t JOIN "Conversation" c ON c.id=t."conversationId", json_each(t."readManifestJson",'$.documentSources') s WHERE json_extract(s.value,'$.sourceId')=${id} AND json_extract(s.value,'$.projectId')=${projectId} AND (${ownerId??null} IS NULL OR c."ownerUserId"=${ownerId??null}) LIMIT 1`;
 if(turns[0])return JSON.parse(turns[0].value);
 const steps=await tx.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "AgentMissionStep" st JOIN "AgentMission" m ON m.id=st."missionId", json_each(st."resultJson",'$.sources') s WHERE json_extract(s.value,'$.id')=${id} AND m."projectId"=${projectId} AND (${ownerId??null} IS NULL OR m."ownerUserId"=${ownerId??null}) LIMIT 1`;
 return steps[0]?JSON.parse(steps[0].value):null;
}
export async function documentObservationCurrent(projectId:string,source:Stored,tx:Tx=db){
 return isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false)&&source.document&&(source.hash??source.revision)===jsonHash({document:source.document,text:source.text??source.excerpt})&&await sourceHash(projectId,"attachment:"+source.document.attachmentId,tx)===source.document.attachmentHash;
}
export async function validateDocumentObservation(userId:string,projectId:string,id:string,revision:string,tx:Tx=db){
 const source=await findDocumentObservation(projectId,id,tx,userId);
 if(!source?.document||(source.hash??source.revision)!==revision||revision!==jsonHash({document:source.document,text:source.text??source.excerpt})||!await documentObservationCurrent(projectId,source,tx)||!await tx.projectMembership.findUnique({where:{userId_projectId:{userId,projectId}}}))throw new AppError("DOCUMENT_SOURCE_CHANGED","文档观察与原件/修订已不一致，请重新读取",409);
 return source;
}
