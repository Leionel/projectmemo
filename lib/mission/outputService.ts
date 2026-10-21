import type {ClaimCheck} from "./claimVerifier";
import {isFeatureEnabled} from "@/lib/config/features";
import { validateResearchOutput } from "./researchOutputSchema";
import { AppError } from "@/lib/api";
import { json,jsonHash, type Source } from "./contracts";
import type { Tx } from "./repository";
import { event, validateSources } from "./repository";
import { outputSchema } from "./tools";
export async function saveOutput(tx:Tx,missionId:string,stepId:string,input:unknown,available:Source[],checks?:ClaimCheck[]){
 const existing=await tx.agentMissionOutput.findUnique({where:{stepId}});if(existing)return existing;
 const body=validateResearchOutput(outputSchema.parse(input),available);if(new Set(body.blocks.map(b=>b.blockId)).size!==body.blocks.length)throw new AppError("INVALID_BLOCKS","段落编号不能重复",422);
 const sources=body.blocks.flatMap(b=>b.sourceIds).map(id=>{const s=available.find(s=>s.id===id);if(!s)throw new AppError("SOURCE_NOT_FOUND","草稿引用了未读取的来源",409);return s;});
 for(const b of body.blocks){if(b.kind!=="INFERENCE"&&!b.sourceIds.length)throw new AppError("SOURCE_REQUIRED","观察和外部参考必须保留来源",422);if(b.kind==="PROJECT_OBSERVATION"&&b.sourceIds.some(id=>available.find(s=>s.id===id)?.kind!=="PROJECT"||available.some(s=>s.id===id&&s.entityType==="ARTIFACT"&&s.knowledgeClass!=="PROJECT_OBSERVATION")))throw new AppError("EXTERNAL_NOT_PROJECT_FACT","外部资料不能当作项目实测",422);}
 const m=await tx.agentMission.findUniqueOrThrow({where:{id:missionId}});await validateSources(m.projectId,sources,tx,missionId);
 const currentChecks=isFeatureEnabled("MISSION_SEMANTIC_CHECK_ENABLED",false)&&checks?checks:body.blocks.map(b=>({blockId:b.blockId,status:"NOT_CHECKED"}));
 if(checks?.some(c=>{const block=body.blocks.find(b=>b.blockId===c.blockId);return !block||c.claimStart<0||c.claimEnd>block.text.length||c.claimStart>=c.claimEnd||c.claimHash!==jsonHash(block.text.slice(c.claimStart,c.claimEnd));}))throw new AppError("CLAIM_CHANGED","核验内容与草稿不一致",409);
 const last=await tx.agentMissionOutput.aggregate({where:{missionId},_max:{revision:true}});
 const output=await tx.agentMissionOutput.create({data:{missionId,stepId,revision:(last._max.revision??0)+1,kind:body.kind,contentJson:json(body),sourceRefsJson:json(sources),claimChecksJson:json(currentChecks),verificationStatus:"NEEDS_REVIEW"}});
 await event(tx,missionId,"OUTPUT_SAVED",{outputId:output.id,revision:output.revision});return output;
}
