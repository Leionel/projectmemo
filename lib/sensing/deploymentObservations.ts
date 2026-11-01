import {db} from "@/lib/db";
import type {Tx} from "@/lib/mission/repository";
import {AppError} from "@/lib/api";
import {jsonHash} from "@/lib/mission/contracts";
import {deploymentConnection} from "./deploymentConnections";
import type {DeploymentSourceMeta} from "@/lib/types/deployment";
export type StoredDeploymentSource={deployment:DeploymentSourceMeta;id:string;sourceId?:string;revision:string;hash?:string;excerpt?:string;text?:string};
type Stored=StoredDeploymentSource;
export async function latestDeploymentObservation(userId:string,projectId:string,connectionId:string){
  const rows=await db.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "ConversationTurn" t JOIN "Conversation" c ON c.id=t."conversationId",json_each(t."readManifestJson",'$.deploymentSources') s
    WHERE c."ownerUserId"=${userId} AND json_extract(s.value,'$.projectId')=${projectId} AND json_extract(s.value,'$.deployment.connectionId')=${connectionId} AND json_extract(s.value,'$.deployment.kind')='STATUS' ORDER BY t."createdAt" DESC LIMIT 1`;
  const steps=await db.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "AgentMissionStep" st JOIN "AgentMission" m ON m.id=st."missionId",json_each(st."resultJson",'$.sources') s
    WHERE m."ownerUserId"=${userId} AND m."projectId"=${projectId} AND json_extract(s.value,'$.deployment.connectionId')=${connectionId} AND json_extract(s.value,'$.deployment.kind')='STATUS' ORDER BY st."startedAt" DESC LIMIT 1`;
  const candidates=[...rows,...steps].map(r=>JSON.parse(r.value) as Stored).filter(s=>Number.isFinite(Date.parse(s.deployment.observedAt)));
  const source=candidates.sort((a,b)=>Date.parse(b.deployment.observedAt)-Date.parse(a.deployment.observedAt))[0];
  if(!source)return null;
  const policy=await(await import("@/lib/continuity/sourcePolicy")).sourceUse(userId,projectId,source.sourceId??source.id,db,{...(source.deployment.missionId?{missionId:source.deployment.missionId}:{}),...(source.deployment.conversationId?{conversationId:source.deployment.conversationId}:{})});
  const current=policy.state==="ALLOWED"&&await deploymentObservationCurrent(projectId,source);
  let layers:unknown[]=[];if(current){try{const value=JSON.parse(source.excerpt??source.text??"{}");layers=Array.isArray(value.layers)?value.layers:[];}catch{}}
  return{sourceId:source.sourceId??source.id,observedAt:source.deployment.observedAt,validUntil:source.deployment.validUntil,availability:current?"CURRENT":policy.reason==="ROOT_SUPPRESSED"?"SUPPRESSED":"HISTORICAL",layers};
}
export async function findDeploymentObservation(projectId:string,sourceId:string,tx:Tx=db,ownerId?:string):Promise<Stored|null>{
  const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "ConversationTurn" t JOIN "Conversation" c ON c.id=t."conversationId",json_each(t."readManifestJson",'$.deploymentSources') s
    WHERE json_extract(s.value,'$.sourceId')=${sourceId} AND json_extract(s.value,'$.projectId')=${projectId}
    AND (${ownerId??null} IS NULL OR c."ownerUserId"=${ownerId??null}) LIMIT 1`;
  if(rows[0])return JSON.parse(rows[0].value);
  const steps=await tx.$queryRaw<Array<{value:string}>>`SELECT s.value FROM "AgentMissionStep" st JOIN "AgentMission" m ON m.id=st."missionId",json_each(st."resultJson",'$.sources') s
    WHERE json_extract(s.value,'$.id')=${sourceId} AND m."projectId"=${projectId}
    AND (${ownerId??null} IS NULL OR m."ownerUserId"=${ownerId??null}) LIMIT 1`;
  return steps[0]?JSON.parse(steps[0].value):null;
}
export async function deploymentObservationCurrent(projectId:string,source:Stored,tx:Tx=db){
  const meta=source.deployment;
  if(!meta||!Number.isFinite(Date.parse(meta.observedAt))||Date.parse(meta.observedAt)>Date.now()+5000||!(Date.parse(meta.validUntil)>Date.now()))return false;
  const row=await tx.sourceConnection.findFirst({where:{id:meta.connectionId,projectId,provider:"DEPLOYMENT"}});
  if(!row)return false;
  try{const current=await deploymentConnection(row.ownerUserId,projectId,row.id,tx);
    return row.revision===meta.connectionRevision&&current.config.origin===meta.origin&&current.config.environment===meta.environment&&current.config.expectedRelease===meta.expectedRelease&&
      (meta.kind!=="LOG"||Boolean(current.config.logPath))&&
      (source.hash??source.revision)===jsonHash({deployment:meta,text:source.excerpt??source.text});
  }catch(error){if(error instanceof AppError)return false;throw error;}
}
export async function validateDeploymentObservation(userId:string,projectId:string,sourceId:string,revision:string,tx:Tx=db){
  const source=await findDeploymentObservation(projectId,sourceId,tx,userId);
  if(!source||revision!==(source.hash??source.revision)||!await deploymentObservationCurrent(projectId,source,tx))throw new AppError("DEPLOYMENT_OBSERVATION_STALE","原环境观察已过期、许可已变化或正文不一致，请重新核对",409);
  return source;
}
