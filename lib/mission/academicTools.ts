import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { readCrossrefMetadata } from "@/lib/research/crossrefMetadata";
import { doiFromPublicSource,academicMetadataText } from "@/lib/research/academic";
import { publicUrl } from "@/lib/research/queryPolicy";
import { observation } from "@/lib/research/sourceRepository";
import { assertContinuityBinding,effectiveContinuity,assertDirectiveEffect } from "@/lib/continuity/directiveService";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { researchScopeSchema } from "@/lib/types/mission";
import { missionCiDispatch } from "./repositoryTools";
import { fenced,type Lease } from "./runtimeStore";
import { assertInvestigationDelegation } from "./investigationDelegation";
import type { ToolSet } from "./tools";
import type { Source } from "./contracts";

export function academicTools(lease:Lease,transport:typeof fetch=fetch):ToolSet{
 if(!isFeatureEnabled("ACADEMIC_RESEARCH_ENABLED",false)||!isFeatureEnabled("MISSION_WEB_ENABLED",false))return {};
 return {read_paper_metadata:{version:"1",description:"从本委托已检索/读取的公开来源定位DOI，向Crossref读取元数据、摘要与版本/更正关系。需单独批准论文元数据范围；不是全文，不证明本地实验，不接受任意DOI或查询文本。",schema:z.object({sourceId:z.string().min(1).max(200),revision:z.string().regex(/^[a-f0-9]{64}$/),scopeRevision:z.number().int().positive()}).strict(),effects:{businessWrite:false,cacheWrite:true,externalDisclosure:true},run:async(actor,raw)=>{
  const input=raw as {sourceId:string;revision:string;scopeRevision:number};
  const binding=await effectiveContinuity(actor.userId,{projectId:actor.projectId,missionId:actor.missionId});
  const guard=async()=>{
   if(!isFeatureEnabled("ACADEMIC_RESEARCH_ENABLED",false)||!isFeatureEnabled("MISSION_WEB_ENABLED",false))throw new AppError("ACADEMIC_DISABLED","论文元数据读取已关闭",503);
   const m=await db.$transaction(async tx=>{const current=await fenced(tx,lease);assertInvestigationDelegation(current,"read_paper_metadata",input);return current;}),scope=researchScopeSchema.parse(m.researchScopeJson);
   if(!scope.enabled||!scope.academicMetadata||m.researchScopeVersion!==input.scopeRevision)throw new AppError("SCOPE_CHANGED","论文元数据范围未批准或已变化",409);
   await assertContinuityBinding(actor.userId,{projectId:actor.projectId,missionId:actor.missionId},binding);assertDirectiveEffect(binding,"EXTERNAL_READ");
   const parent=await db.externalSource.findFirst({where:{id:input.sourceId,missionId:actor.missionId,normalizedContentHash:input.revision,availability:"AVAILABLE"}});
   if(!parent||(parent.excerptJson as {scopeRevision?:number}).scopeRevision!==m.researchScopeVersion)throw new AppError("SOURCE_CHANGED","请先定位本委托当前可读的公开来源",409);
   publicUrl(parent.requestedUrl,scope.allowedHosts);await assertSourceUse(actor.userId,actor.projectId,parent.id,db,{missionId:actor.missionId});
   return {parent,scope};
  };
  const {parent,scope}=await guard(),text=(parent.excerptJson as {text?:string}).text??"",doi=doiFromPublicSource(parent.requestedUrl,text,scope.allowedCategories.includes("PUBLIC_SOURCE"));
  const dispatch=missionCiDispatch(lease,"academicOperations");
  const metadata=await readCrossrefMetadata(doi,async(url,run)=>(await dispatch(url,1,async()=>{await guard();return {status:200,body:await run()};})).body,transport);await guard();
  const row=observation(actor.missionId,"https://doi.org/"+metadata.doi,"ACADEMIC_METADATA",metadata.title,academicMetadataText(metadata),null,input.scopeRevision);row.observedAt=metadata.observedAt;row.excerpt.parentSourceIds=[parent.id];
  const source:Source={id:row.id,kind:"EXTERNAL",entityType:"EXTERNAL_SOURCE",knowledgeClass:"EXTERNAL_REFERENCE",hash:row.normalizedContentHash,revision:row.normalizedContentHash,identityKey:row.requestedUrl,text:row.excerpt.text,observedAt:metadata.observedAt,temporalState:"UNKNOWN"};
  return {data:{metadata,readLevel:"ACADEMIC_METADATA",fullTextRead:false,observations:[row]},sources:[source],coverage:{complete:false,fullTextRead:false}};
 }}};
}
