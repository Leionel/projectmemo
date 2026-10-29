import { metricInputSources } from "./metricInputSources";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { effectiveContinuity,assertDirectiveEffect } from "@/lib/continuity/directiveService";
import { metricJobSchema,prepareMetricJobFiles,createMetricContainer,inspectMetricContainer,dockerCommand,metricJobName,type DockerCommand,readMetricContainerIdentity } from "@/lib/experiments/sandbox";
import { json,jsonHash,type Source } from "./contracts";
import { record } from "@/lib/conversation/repository";
import { fenced,release,type Lease } from "./runtimeStore";
import { event,validateSources,type Tx,ownedMission } from "./repository";
import { assertAutomaticTool } from "./automaticPolicy";
import { assertDynamicTool } from "./dynamicGuard";

/** Original Step + Approval are the job ledger. Kernel work stays outside SQLite transactions. */
export async function commitApprovedMetricVerification(lease:Lease,stepId:string,run:DockerCommand=dockerCommand){
 const checkInTx=async(tx:Tx)=>{
  if(!isFeatureEnabled("SANDBOX_VERIFICATION_ENABLED",false))throw new AppError("SANDBOX_DISABLED","沙箱核算已关闭，批准记录保留",503);
  const mission=await fenced(tx,lease),step=await tx.agentMissionStep.findFirstOrThrow({where:{id:stepId,missionId:mission.id}}),approval=await tx.agentMissionApproval.findUniqueOrThrow({where:{stepId}});
  if(step.status==="SUCCEEDED"&&approval.status==="CONSUMED")return {mission,step,approval,replay:true};
  assertDirectiveEffect(await effectiveContinuity(mission.ownerUserId,{projectId:mission.projectId,missionId:mission.id},tx),"BUSINESS_WRITE");
  assertAutomaticTool(mission,"verify_experiment_metrics",true);assertDynamicTool(mission,"verify_experiment_metrics",step.canonicalInputJson);
  const proposal=record(approval.proposalJson);
  if(approval.status!=="APPROVED"||approval.proposalHash!==jsonHash(proposal)||approval.expiresAt<=new Date()||approval.expectedPlanRevision!==mission.planRevision||proposal.contextVersion!==mission.contextVersion||proposal.constraintsVersion!==mission.constraintsVersion||proposal.tool!=="verify_experiment_metrics")throw new AppError("APPROVAL_CHANGED","核算批准已失效，请重新预览",409);
  metricJobSchema.parse(record(proposal.args).job);await validateSources(mission.projectId,approval.readSetJson as unknown as Source[],tx,mission.id);
  return {mission,step,approval,replay:false};
 };
 const check=()=>db.$transaction(checkInTx);
 let checked:Awaited<ReturnType<typeof check>>;
 try{checked=await check();}catch(error){
  // Expiry/STOP invalidates execution, not the ability to settle a previously dispatched job as history.
  const mission=await db.agentMission.findUniqueOrThrow({where:{id:lease.id}});await ownedMission(mission.ownerUserId,mission.id);
  const step=await db.agentMissionStep.findFirst({where:{id:stepId,missionId:mission.id}}),approval=await db.agentMissionApproval.findUnique({where:{stepId}});
  if(step?.effectKey&&record(record(step.protocolJson).sandboxJob).phase&&approval){
   try{const oldJob=metricJobSchema.parse(record(record(approval.proposalJson).args).job),receipt=await inspectMetricContainer(step.effectKey,oldJob,run);await db.$transaction(async tx=>{const current=await tx.agentMissionStep.findUniqueOrThrow({where:{id:stepId}});await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...record(current.protocolJson),sandboxObservation:receipt})}});});}catch{/* Original unknown reservation remains; no create/start replay. */}
  }
  throw error;
 }
 if(checked.replay)return checked.step.resultJson;
 const job=metricJobSchema.parse(record(record(checked.approval.proposalJson).args).job),effectKey=checked.step.effectKey!,name=metricJobName(effectKey);
 let marker=record(record(checked.step.protocolJson).sandboxJob);
 if(!marker.phase){
  await run(["image","inspect",job.image,"--format","{{.Id}}"]);await prepareMetricJobFiles(effectKey,job);await check();
  await db.$transaction(async tx=>{
   const current=await checkInTx(tx),m=current.mission,step=current.step,protocol=record(step.protocolJson);
   if(record(protocol.sandboxJob).phase)throw new AppError("SANDBOX_RESULT_UNKNOWN","原job已预占，请读取原状态",409);
   await validateSources(m.projectId,checked.approval.readSetJson as unknown as Source[],tx,m.id);
   const used=record(m.budgetUsedJson);if(Number(used.sandboxJobs??0)>=1)throw new AppError("SANDBOX_BUDGET_EXHAUSTED","本委托的一次核算额度已使用，保留已有job并核对结果",409);
   await tx.agentMission.update({where:{id:m.id},data:{budgetUsedJson:json({...used,sandboxJobs:Number(used.sandboxJobs??0)+1})}});
   await tx.agentMissionStep.update({where:{id:stepId},data:{status:"RUNNING",protocolJson:json({...protocol,sandboxJob:{phase:"CREATE_DISPATCH_COMMITTED",name,inputHash:jsonHash(job),at:new Date().toISOString()}})}});
   await event(tx,m.id,"SANDBOX_DISPATCH_RESERVED",{stepId,jobName:name,scriptHash:job.scriptHash,image:job.image});
  });
  const created=await createMetricContainer(effectKey,job,run);
  await db.$transaction(async tx=>{const {step}=await checkInTx(tx);await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...record(step.protocolJson),sandboxJob:{phase:"CREATED",name,containerId:created.id}})}});});
  marker={phase:"CREATED",name};
 }
 if(marker.phase==="CREATE_DISPATCH_COMMITTED"){
  // A create reply may have been lost. A verified, never-started container settles creation only.
  let existing;try{existing=await readMetricContainerIdentity(effectKey,job,run);}catch{throw new AppError("SANDBOX_RESULT_UNKNOWN","原创建请求未结算，未找到可靠的同名job；不会重发创建",409);}
  if(existing.State?.Status==="created"){
   await db.$transaction(async tx=>{const {step}=await checkInTx(tx);await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...record(step.protocolJson),sandboxJob:{phase:"CREATED",name,containerId:existing.Id,reconciled:true}})}});});marker={phase:"CREATED",name};
  }
 }
 if(marker.phase==="CREATED"){
  await prepareMetricJobFiles(effectKey,job);await check();await db.$transaction(async tx=>{const {step}=await checkInTx(tx);await tx.agentMissionStep.update({where:{id:stepId},data:{status:"RUNNING",protocolJson:json({...record(step.protocolJson),sandboxJob:{...record(record(step.protocolJson).sandboxJob),phase:"START_DISPATCH_COMMITTED"}})}});});
  await run(["start",name]);await run(["wait",name],15000);
 }
 let receipt:Awaited<ReturnType<typeof inspectMetricContainer>>;
 try{receipt=await inspectMetricContainer(effectKey,job,run);}catch(error){if(error instanceof AppError&&["SANDBOX_IDENTITY_CHANGED","SANDBOX_JOB_FAILED","SANDBOX_RESULT_MISMATCH"].includes(error.code)){
  if(error.code==="SANDBOX_JOB_FAILED")await db.$transaction(async tx=>{const step=await tx.agentMissionStep.findFirstOrThrow({where:{id:stepId,missionId:lease.id,effectKey}});await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...record(step.protocolJson),sandboxFailure:error.details})}});});
  throw error;
 }throw new AppError("SANDBOX_RESULT_UNKNOWN","原核算job结果尚未结算，只核对同一job，不重发创建或启动",409);}
 // Raw receipt is audit history even if source/permission changes before business settlement.
 await db.$transaction(async tx=>{const step=await tx.agentMissionStep.findFirstOrThrow({where:{id:stepId,missionId:lease.id,effectKey}});await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...record(step.protocolJson),sandboxObservation:receipt})}});});
 checked=await check();
 return db.$transaction(async tx=>{
  const current=await checkInTx(tx),m=current.mission,approval=current.approval;
  if(approval.status!=="APPROVED"||approval.proposalHash!==checked.approval.proposalHash||approval.expiresAt<=new Date())throw new AppError("APPROVAL_CHANGED","原job回执保留为历史，当前批准已变化",409);
  await validateSources(m.projectId,approval.readSetJson as unknown as Source[],tx,m.id);
  const step=await tx.agentMissionStep.findUniqueOrThrow({where:{id:stepId}}),sources=metricInputSources(approval.readSetJson as unknown as Source[],record(record(approval.proposalJson).args).sourceBindings),result={data:{...receipt,jobName:name},sources};
  await tx.agentMissionApproval.update({where:{id:approval.id},data:{status:"CONSUMED",consumedAt:new Date()}});
  await tx.agentMissionStep.update({where:{id:stepId},data:{status:"SUCCEEDED",resultJson:json(result),verificationJson:json(receipt),finishedAt:new Date(),protocolJson:json({...record(step.protocolJson),sandboxJob:{phase:"SETTLED",name,receiptHash:receipt.receiptHash}})}});
  await event(tx,m.id,"SANDBOX_JOB_SETTLED",{stepId,...receipt});await release(tx,m,"READY");return result;
 });
}
