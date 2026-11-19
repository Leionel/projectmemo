import { publishMissionDigest } from "@/lib/memory/digestService";
import { recordHypothesisUpdates, missionHypothesisSources } from "@/lib/memory/hypothesisService";
import { record } from "@/lib/conversation/repository";
import type { ProjectInputRef } from "@/lib/memory/inputReadSet";
import type {ClaimCheck} from "./claimVerifier";
import {isFeatureEnabled} from "@/lib/config/features";
import { validateOutputContent } from "./outputValidation";
import { AppError } from "@/lib/api";
import { json,jsonHash, type Source } from "./contracts";
import type { Tx } from "./repository";
import { event, validateSources } from "./repository";
import { outputSchema } from "./tools";
export async function saveOutput(tx:Tx,missionId:string,stepId:string,input:unknown,available:Source[],checks?:ClaimCheck[]){
 const existing=await tx.agentMissionOutput.findUnique({where:{stepId}});if(existing)return existing;
 const body=validateOutputContent(outputSchema.parse(input),available);
 const sources=body.blocks.flatMap(b=>b.sourceIds).map(id=>{const s=available.find(s=>s.id===id);if(!s)throw new AppError("SOURCE_NOT_FOUND","草稿引用了未读取的来源",409);return s;});
 const m=await tx.agentMission.findUniqueOrThrow({where:{id:missionId}});await validateSources(m.projectId,sources,tx,missionId);
 const currentChecks=isFeatureEnabled("MISSION_SEMANTIC_CHECK_ENABLED",false)&&checks?checks:body.blocks.map(b=>({blockId:b.blockId,status:"NOT_CHECKED"}));
 if(checks?.some(c=>{const block=body.blocks.find(b=>b.blockId===c.blockId);return !block||c.claimStart<0||c.claimEnd>block.text.length||c.claimStart>=c.claimEnd||c.claimHash!==jsonHash(block.text.slice(c.claimStart,c.claimEnd));}))throw new AppError("CLAIM_CHANGED","核验内容与草稿不一致",409);
 // Identical content is not a new version: keep the latest revision and record the no-op.
 const previous=await tx.agentMissionOutput.findFirst({where:{missionId},orderBy:{revision:"desc"}});
 if(previous&&jsonHash(record(previous.contentJson).blocks)===jsonHash(body.blocks)&&jsonHash(previous.sourceRefsJson)===jsonHash(sources)){
  await event(tx,missionId,"OUTPUT_UNCHANGED",{outputId:previous.id,revision:previous.revision});return previous;
 }
 const last=await tx.agentMissionOutput.aggregate({where:{missionId},_max:{revision:true}});
 const output=await tx.agentMissionOutput.create({data:{missionId,stepId,revision:(last._max.revision??0)+1,kind:body.kind,contentJson:json(body),sourceRefsJson:json(sources),claimChecksJson:json(currentChecks),verificationStatus:"NEEDS_REVIEW"}});
 if(body.memorySynthesis){
  const step=await tx.agentMissionStep.findUniqueOrThrow({where:{id:stepId}});
  const hypothesisSources=available.filter(s=>body.memorySynthesis!.hypotheses.some(h=>h.evidence.some(e=>e.sourceId===s.id)));
  await validateSources(m.projectId,hypothesisSources,tx,missionId);
  await recordHypothesisUpdates(tx,{kind:"MISSION_OUTPUT",id:output.id,userId:m.ownerUserId,projectId:m.projectId,missionId,
   allowedProjectIds:[m.projectId],sourceRevisionReadSet:record(step.protocolJson).sourceRevisionReadSet as ProjectInputRef[]},body.memorySynthesis.hypotheses,missionHypothesisSources(m.projectId,hypothesisSources));
  await publishMissionDigest(tx,missionId,output.id,body.memorySynthesis,[...new Map([...sources,...hypothesisSources].map(s=>[s.id,s])).values()]);
 }
 await event(tx,missionId,"OUTPUT_SAVED",{outputId:output.id,revision:output.revision});return output;
}
