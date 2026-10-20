import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { createActionInTx } from "@/lib/repositories/agent";
import { json, jsonHash, type Source } from "./contracts";
import { event, validateSources, type Tx } from "./repository";
import { assertToolConstraints } from "./constraintsService";
import { actionProposalSchema } from "./tools";
import { fenced, release, type Lease } from "./runtimeStore";
export async function commitApprovedAction(lease:Lease,stepId:string){
 if(!isFeatureEnabled("MISSION_WRITES_ENABLED",false))throw new AppError("WRITES_DISABLED","行动写入已关闭，提案已保留",503);
 return db.$transaction(async tx=>{
  const m=await fenced(tx,lease);const step=await tx.agentMissionStep.findFirst({where:{id:stepId,missionId:m.id}});
  const approval=await tx.agentMissionApproval.findUnique({where:{stepId}});
  if(!step||!approval||approval.missionId!==m.id)throw new AppError("APPROVAL_CHANGED","批准不存在",409);
  if(step.status==="SUCCEEDED"&&approval.status==="CONSUMED")return step.resultJson;
  if(approval.status!=="APPROVED"||approval.expectedPlanRevision!==m.planRevision||approval.expiresAt<=new Date()||approval.proposalHash!==jsonHash(approval.proposalJson))throw new AppError("APPROVAL_CHANGED","批准已失效，请重新预览",409);
  await validateSources(m.projectId,approval.readSetJson as unknown as Source[],tx);
  const proposal=approval.proposalJson as {args:unknown};const args=actionProposalSchema.parse(proposal.args);assertToolConstraints(m.constraintsJson,"propose_action",args);
  const key=step.effectKey!;const old=await tx.actionItem.findUnique({where:{dedupeKey:key}});
  const action=old??await createActionInTx(tx,m.projectId,{...args,dueAt:args.dueAt??undefined},key);
  const result={data:{actionId:action.id,title:action.title,status:action.status,resultCardId:action.resultCardId},sources:[]};
  await tx.agentMissionApproval.update({where:{id:approval.id},data:{status:"CONSUMED",consumedAt:new Date()}});
  await tx.agentMissionStep.update({where:{id:stepId},data:{status:"SUCCEEDED",resultJson:json(result),verificationJson:{created:true,actionId:action.id},finishedAt:new Date()}});
  await event(tx,m.id,"ACTION_CREATED",result.data);await release(tx,m,"READY");return result;
 });
}
export async function obsoleteApprovals(tx:Tx,id:string){
 await tx.agentMissionApproval.updateMany({where:{missionId:id,status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});
 await tx.agentMissionStep.updateMany({where:{missionId:id,status:{in:["READY","WAITING_APPROVAL"]}},data:{status:"OBSOLETE"}});
}
