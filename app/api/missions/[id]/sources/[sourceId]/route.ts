import { authenticateUser } from "@/lib/auth/guard";
import { apiError,AppError } from "@/lib/api";
import { ownedMission } from "@/lib/mission/repository";
import { validateDocumentObservation,findDocumentObservation } from "@/lib/documents/observations";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { readSource } from "@/lib/research/sourceRepository";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string;sourceId:string}>}){try{
 const {user}=await authenticateUser(request),p=await c.params;
 if(!p.sourceId.startsWith("doc:")){
  const mission=await ownedMission(user.id,p.id),raw=await readSource(user.id,p.id,p.sourceId);await assertSourceUse(user.id,mission.projectId,p.sourceId,undefined,{missionId:p.id});
  return Response.json({source:{...raw,sourceId:raw.id,projectId:mission.projectId,revision:raw.normalizedContentHash,excerpt:(raw.excerptJson as {text?:string}).text??"",external:{provider:raw.retrievalMode==="ACADEMIC_METADATA"?"Crossref":"Web",requestedUrl:raw.requestedUrl,readLevel:raw.retrievalMode==="ACADEMIC_METADATA"?"ACADEMIC_METADATA":raw.retrievalMode==="SEARCH_SNIPPET"?"SEARCH_SNIPPET":"FETCH_EXCERPT",fetchedAt:raw.fetchedAt}}});
 }
 const m=await ownedMission(user.id,p.id),found=await findDocumentObservation(m.projectId,p.sourceId,undefined,user.id);
 if(!found?.document||found.document.missionId!==m.id)throw new AppError("SOURCE_NOT_FOUND","来源不属于原委托",404);
 const source=await validateDocumentObservation(user.id,m.projectId,p.sourceId,found.hash??found.revision);await assertSourceUse(user.id,m.projectId,p.sourceId,undefined,{missionId:m.id});
 return Response.json({source:{id:source.id,sourceId:source.id,projectId:m.projectId,revision:source.hash??source.revision,title:source.document.fileName,excerpt:source.text??source.excerpt??"",document:source.document}});
 }catch(error){return apiError(error);}}
