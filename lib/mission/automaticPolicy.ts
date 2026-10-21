import {AppError} from "@/lib/api";
import {isFeatureEnabled} from "@/lib/config/features";
import type {AgentMission} from "@/lib/generated/prisma/client";
import {jsonHash} from "./contracts";
import {parseMetricRecord,type GapRequirements} from "./gaps";
import {readProjectMaterial} from "./sourceSignals";
import type {Tx} from "./repository";
export function assertAutomaticPermission(m:AgentMission){
 const marker=(m.planJson as {automaticContinuation?:{policyHash:string}|null}).automaticContinuation;if(!marker)return;
 if(!isFeatureEnabled("MISSION_AUTO_CONTINUATION_ENABLED",false)||(m.continuationPolicyJson as {mode?:string}).mode!=="LOW_RISK_READ_ANALYZE"||marker.policyHash!==jsonHash(m.continuationPolicyJson))throw new AppError("AUTOMATION_REVOKED","自动接续已撤销，请人工检查后继续",409);
}
export function assertAutomaticTool(m:AgentMission,name:string,businessWrite:boolean){
 assertAutomaticPermission(m);
 if((m.planJson as {automaticContinuation?:unknown}).automaticContinuation&&(businessWrite||!["inspect_project","search_memory","web_search","web_fetch","inspect_action","save_mission_output","propose_action"].includes(name)))throw new AppError("AUTO_TOOL_BLOCKED","自动接续只能读取、分析或保存私有草稿；其他操作需人工确认",409);
}
export async function validateAutomaticEvidence(tx:Tx,m:AgentMission){
 const marker=(m.planJson as {automaticContinuation?:{metric?:GapRequirements["metric"];startedAt?:string;sourcePointers?:Array<{id:string;hash:string}>}}).automaticContinuation;
 if(!marker?.metric||!marker.startedAt||!marker.sourcePointers?.length)return;
 const values=new Set<number>();
 for(const pointer of marker.sourcePointers){const source=await readProjectMaterial(m.projectId,pointer.id,tx);if(!source||source.hash!==pointer.hash)throw new AppError("SOURCE_CHANGED","自动接续的材料已变化，请重新核对",409);const parsed=parseMetricRecord(source.text);if(parsed?.success)values.add(parsed.data.value);}
 const since=new Date(marker.startedAt);
 const captures=await tx.capture.findMany({where:{projectId:m.projectId,createdAt:{gte:since}},select:{rawText:true},take:101});
 const attachments=await tx.attachment.findMany({where:{projectId:m.projectId,extractionStatus:"SUCCESS",OR:[{createdAt:{gte:since}},{revisions:{some:{createdAt:{gte:since}}}}]},include:{revisions:{orderBy:[{revisionIndex:"desc"},{id:"desc"}],take:1}},take:101});
 if(captures.length>100||attachments.length>100)throw new AppError("CONTEXT_TOO_LARGE","自动接续期间资料较多，请人工核对",409);
 for(const text of [...captures.map(c=>c.rawText),...attachments.map(a=>a.revisions[0]?.text??a.extractedText??"")]){const parsed=parseMetricRecord(text);if(!parsed?.success)continue;const record=parsed.data;if(record.projectId===m.projectId&&record.name===marker.metric.name&&record.unit===marker.metric.unit&&record.period===marker.metric.period)values.add(record.value);}
 if(values.size>1)throw new AppError("SOURCE_CHANGED","自动接续期间出现不同版本的实验数值，请人工核对",409);
}
