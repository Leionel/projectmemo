import { metricInputSources } from "./metricInputSources";
import { record } from "@/lib/conversation/repository";
import { AppError } from "@/lib/api";
import { z } from "zod";
import { successCriterionSchema, type Source } from "./contracts";
import { validateSources, type Tx } from "./repository";
import type { AgentMission } from "@/lib/generated/prisma/client";

export async function verifyMissionResult(tx:Tx,m:AgentMission,outputId:string){
  const output=await tx.agentMissionOutput.findFirst({where:{id:outputId,missionId:m.id}});
  if(!output)throw new AppError("OUTPUT_REQUIRED","请先保存本委托的成果草稿",409);
  const sources=output.sourceRefsJson as unknown as Source[];
  await validateSources(m.projectId,sources,tx,m.id);
  const criteria=z.array(successCriterionSchema).parse(m.successCriteriaJson);
  const approvals=await tx.agentMissionApproval.findMany({where:{missionId:m.id,status:"CONSUMED"},include:{step:true}});
  const checks=[];
  for(const criterion of criteria){
    const type=typeof criterion==="string"?criterion:criterion.type;let passed=false;
    if(type==="DRAFT_EXISTS")passed=true;
    if(type==="SOURCE_COUNT")passed=new Set(sources.map(s=>s.id)).size>=(typeof criterion==="object"?criterion.minimum:1);
    if(type==="APPROVAL_CONSUMED")passed=approvals.some(a=>a.consumedAt&&a.approverUserId===m.ownerUserId);
    if(type==="ACTION_CREATED")for(const approval of approvals){const id=(approval.step.resultJson as {data?:{actionId?:string}}|null)?.data?.actionId;if(id&&await tx.actionItem.count({where:{id,projectId:m.projectId,isSimulated:false,dedupeKey:approval.step.effectKey}})){passed=true;break;}}
    if(type==="FIXED_METRIC_JOB_RECORDED"){
      for(const approval of approvals){if(approval.step.toolName!=="propose_metric_verification"||approval.step.status!=="SUCCEEDED")continue;
        const receipt=approval.step.verificationJson as {receiptHash?:string;exitCode?:number}|null,protocol=approval.step.protocolJson as {sandboxJob?:{phase?:string;receiptHash?:string}}|null;
        if(receipt?.receiptHash&&receipt.exitCode===0&&protocol?.sandboxJob?.phase==="SETTLED"&&protocol.sandboxJob.receiptHash===receipt.receiptHash){await validateSources(m.projectId,metricInputSources(approval.readSetJson as unknown as Source[],record(record(approval.proposalJson).args).sourceBindings),tx,m.id);passed=true;break;}
      }
    }
    if(type==="PAPER_METADATA_READ"){
      const reads=await tx.agentMissionStep.findMany({where:{missionId:m.id,toolName:"read_paper_metadata",status:"SUCCEEDED"}});
      for(const read of reads){const refs=(read.resultJson as {sources?:Source[]}|null)?.sources??[];if(refs.length){try{await validateSources(m.projectId,refs,tx,m.id);passed=true;break;}catch{/* Historical metadata does not satisfy a current grant. */}}}
    }
    if(type==="ACTION_RESULT_RECORDED")for(const approval of approvals){const id=(approval.step.resultJson as {data?:{actionId?:string}}|null)?.data?.actionId;if(id&&await tx.actionItem.count({where:{id,projectId:m.projectId,status:"DONE",resultCardId:{not:null},isSimulated:false,dedupeKey:approval.step.effectKey}})){passed=true;break;}}
    if(type==="REQUIRED_INPUT_PRESENT"){
      const question=await tx.agentMissionEvent.findFirst({where:{missionId:m.id,type:"QUESTION"},orderBy:{seq:"desc"}});
      const inputs=await tx.agentMissionEvent.findMany({where:{missionId:m.id,type:"INPUT",...(question?{seq:{gt:question.seq}}:{})}});
      passed=!!question&&inputs.some(e=>(e.payloadJson as {questionId?:string;answer?:string}).questionId===question.id&&!!(e.payloadJson as {answer?:string}).answer?.trim());
    }
    checks.push({criterion,passed});
  }
  if(checks.some(c=>!c.passed))throw new AppError("CRITERIA_NOT_MET","委托验收条件尚未满足",409,{checks});
  return{outputId,checks,contentVerification:output.verificationStatus,realityOutcome:"NOT_INFERRED"};
}
