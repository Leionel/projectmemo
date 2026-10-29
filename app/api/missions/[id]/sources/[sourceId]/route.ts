import { authenticateUser } from "@/lib/auth/guard";
import { apiError,AppError } from "@/lib/api";
import { ownedMission } from "@/lib/mission/repository";
import { validateDocumentObservation,findDocumentObservation } from "@/lib/documents/observations";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { readSource } from "@/lib/research/sourceRepository";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string;sourceId:string}>}){try{
 const {user}=await authenticateUser(request),p=await c.params;
 if(!p.sourceId.startsWith("doc:"))return Response.json({source:await readSource(user.id,p.id,p.sourceId)});
 const m=await ownedMission(user.id,p.id),found=await findDocumentObservation(m.projectId,p.sourceId,undefined,user.id);
 if(!found?.document||found.document.missionId!==m.id)throw new AppError("SOURCE_NOT_FOUND","来源不属于原委托",404);
 const source=await validateDocumentObservation(user.id,m.projectId,p.sourceId,found.hash??found.revision);await assertSourceUse(user.id,m.projectId,p.sourceId,undefined,{missionId:m.id});
 return Response.json({source:{id:source.id,sourceId:source.id,projectId:m.projectId,revision:source.hash??source.revision,title:source.document.fileName,excerpt:source.text??source.excerpt??"",document:source.document}});
 }catch(error){return apiError(error);}}
