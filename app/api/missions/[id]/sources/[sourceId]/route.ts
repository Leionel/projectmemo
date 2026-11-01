import { authenticateUser } from "@/lib/auth/guard";
import { apiError,AppError } from "@/lib/api";
import { ownedMission } from "@/lib/mission/repository";
import { validateDocumentObservation,findDocumentObservation } from "@/lib/documents/observations";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { readSource } from "@/lib/research/sourceRepository";
import { db } from "@/lib/db";
import { record } from "@/lib/conversation/repository";
import { calendarSourceMetaSchema } from "@/lib/calendar/contracts";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string;sourceId:string}>}){try{
 const {user}=await authenticateUser(request),p=await c.params;
 if(p.sourceId.startsWith("calendar:")){
  const m=await ownedMission(user.id,p.id),observation=await db.calendarObservation.findFirst({where:{id:p.sourceId.slice(9),missionId:m.id},include:{connection:true}});
  if(!observation)throw new AppError("SOURCE_NOT_FOUND","日历来源不属于当前委托",404);
  await assertSourceUse(user.id,m.projectId,p.sourceId,undefined,{missionId:m.id});
  const payload=record(observation.payloadJson),calendar=calendarSourceMetaSchema.parse(payload.meta);
  return Response.json({source:{id:p.sourceId,sourceId:p.sourceId,projectId:m.projectId,revision:observation.revision,title:observation.title,
    excerpt:String(payload.excerpt??""),observedAt:observation.observedAt.toISOString(),temporalState:"UNKNOWN",knowledgeClass:"EXTERNAL_REFERENCE",readScope:"STRUCTURED",calendar}});
 }
 if(p.sourceId.startsWith("deploy:")){
  const m=await ownedMission(user.id,p.id),observations=await import("@/lib/sensing/deploymentObservations"),found=await observations.findDeploymentObservation(m.projectId,p.sourceId,undefined,user.id);
  if(!found?.deployment||found.deployment.missionId!==m.id)throw new AppError("SOURCE_NOT_FOUND","观察不属于原委托",404);
  await observations.validateDeploymentObservation(user.id,m.projectId,p.sourceId,found.hash??found.revision);await assertSourceUse(user.id,m.projectId,p.sourceId,undefined,{missionId:m.id});
  return Response.json({source:{...found,sourceId:p.sourceId,projectId:m.projectId,title:found.deployment.environment+" 环境观察",excerpt:found.text??found.excerpt??""}},{headers:{"cache-control":"no-store"}});
 }
 if(!p.sourceId.startsWith("doc:")){
  const mission=await ownedMission(user.id,p.id),raw=await readSource(user.id,p.id,p.sourceId);await assertSourceUse(user.id,mission.projectId,p.sourceId,undefined,{missionId:p.id});
  const excerpt=raw.excerptJson as {text?:string;browser?:unknown};
  return Response.json({source:{...raw,sourceId:raw.id,projectId:mission.projectId,revision:raw.normalizedContentHash,excerpt:excerpt.text??"",external:{provider:raw.retrievalMode==="ACADEMIC_METADATA"?"Crossref":"Web",requestedUrl:raw.requestedUrl,resolvedUrl:raw.resolvedUrl,readLevel:raw.retrievalMode==="ACADEMIC_METADATA"?"ACADEMIC_METADATA":raw.retrievalMode==="SEARCH_SNIPPET"?"SEARCH_SNIPPET":raw.retrievalMode==="BROWSER_RENDER"?"BROWSER_RENDER":"FETCH_EXCERPT",retrievalMethod:raw.retrievalMode==="BROWSER_RENDER"?"ISOLATED_BROWSER":raw.retrievalMode==="ACADEMIC_METADATA"?"CROSSREF_METADATA":"PROVIDER_FETCH",fetchedAt:raw.fetchedAt,...(excerpt.browser?{browser:excerpt.browser}:{})}}});
 }
 const m=await ownedMission(user.id,p.id),found=await findDocumentObservation(m.projectId,p.sourceId,undefined,user.id);
 if(!found?.document||found.document.missionId!==m.id)throw new AppError("SOURCE_NOT_FOUND","来源不属于原委托",404);
 const source=await validateDocumentObservation(user.id,m.projectId,p.sourceId,found.hash??found.revision);await assertSourceUse(user.id,m.projectId,p.sourceId,undefined,{missionId:m.id});
 return Response.json({source:{id:source.id,sourceId:source.id,projectId:m.projectId,revision:source.hash??source.revision,title:source.document.fileName,excerpt:source.text??source.excerpt??"",document:source.document}});
 }catch(error){return apiError(error);}}
