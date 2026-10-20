import { AppError } from "@/lib/api";
import { json, type Source } from "./contracts";
import type { Tx } from "./repository";
import { event, validateSources } from "./repository";
import { outputSchema } from "./tools";
export async function saveOutput(tx:Tx,missionId:string,stepId:string,input:unknown,available:Source[]){
 const existing=await tx.agentMissionOutput.findUnique({where:{stepId}});if(existing)return existing;
 const body=outputSchema.parse(input);if(new Set(body.blocks.map(b=>b.blockId)).size!==body.blocks.length)throw new AppError("INVALID_BLOCKS","段落编号不能重复",422);
 const sources=body.blocks.flatMap(b=>b.sourceIds).map(id=>{const s=available.find(s=>s.id===id);if(!s)throw new AppError("SOURCE_NOT_FOUND","草稿引用了未读取的来源",409);return s;});
 for(const b of body.blocks){if(b.kind!=="INFERENCE"&&!b.sourceIds.length)throw new AppError("SOURCE_REQUIRED","观察和外部参考必须保留来源",422);if(b.kind==="PROJECT_OBSERVATION"&&b.sourceIds.some(id=>available.find(s=>s.id===id)?.kind!=="PROJECT"))throw new AppError("EXTERNAL_NOT_PROJECT_FACT","外部资料不能当作项目实测",422);}
 const m=await tx.agentMission.findUniqueOrThrow({where:{id:missionId}});await validateSources(m.projectId,sources,tx);
 const last=await tx.agentMissionOutput.aggregate({where:{missionId},_max:{revision:true}});
 const output=await tx.agentMissionOutput.create({data:{missionId,stepId,revision:(last._max.revision??0)+1,kind:body.kind,contentJson:json(body),sourceRefsJson:json(sources),claimChecksJson:json(body.blocks.map(b=>({blockId:b.blockId,status:"NOT_CHECKED"}))),verificationStatus:"NEEDS_REVIEW"}});
 await event(tx,missionId,"OUTPUT_SAVED",{outputId:output.id,revision:output.revision});return output;
}
