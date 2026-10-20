import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { chooseNext, type DecisionProvider } from "./modelAdapter";
import { buildContext } from "./contextBuilder";
import { choiceSchema, json, jsonHash, type Source } from "./contracts";
import { event, lock, validateSources } from "./repository";
import { claimMission, fenced, release, renew, reserve, settleUsage, type Lease } from "./runtimeStore";
import { projectTools, sourcesFrom, toolInputHash, type ToolSet } from "./tools";
import { assertToolConstraints } from "./constraintsService";
import { saveOutput } from "./outputService";
import { commitApprovedAction, obsoleteApprovals } from "./approvalService";
export async function runMissionSlice(options:{id?:string;workerId?:string;provider?:DecisionProvider;tools?:ToolSet}={}){
 const m=await claimMission(options.workerId??randomUUID(),options.id);if(!m)return false;
 const lease:Lease={id:m.id,owner:m.leaseOwner!,epoch:m.leaseEpoch,contextVersion:m.contextVersion,planRevision:m.planRevision};
 const tools=options.tools??projectTools;let activeStepId:string|undefined;
 const heartbeat=setInterval(()=>{void renew(lease).catch(()=>false);},10000);heartbeat.unref();
 try{
  const pending=await db.agentMissionStep.findFirst({where:{missionId:m.id,status:"READY",approval:{status:"APPROVED"}},orderBy:{ordinal:"asc"}});
  if(pending){activeStepId=pending.id;await commitApprovedAction(lease,pending.id);return true;}
  const unfinished=await db.agentMissionStep.findFirst({where:{missionId:m.id,status:"RUNNING"},orderBy:{ordinal:"asc"}});
  let step=unfinished;
  if(!step){
   const constraints=m.constraintsJson as {llmContextApproved?:boolean;costCeiling?:{amount:number}|null};
   if(!options.provider&&!constraints.llmContextApproved)throw new AppError("LLM_CONTEXT_NOT_APPROVED","请先确认云模型使用本委托上下文的范围",409);
   if(!options.provider&&constraints.costCeiling)throw new AppError("COST_POLICY_REQUIRED","金额上限尚无法自动换算，需确认调用额度或使用不计费模式",409);
   await reserve(lease,"models");const started=Date.now();const decision=await (options.provider??chooseNext)(await buildContext(m),tools);
   await settleUsage(lease,"models",Date.now()-started,decision.usage);const choice=choiceSchema.parse(decision.choice);
   step=await db.$transaction(async tx=>{
    const current=await fenced(tx,lease);
    const run=await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"SUCCESS",provider:decision.provider,trace:json({missionId:m.id,model:decision.model,protocol:decision.protocol,usage:decision.usage}),resultJson:json({kind:choice.kind}),durationMs:Date.now()-started}});
    if(choice.kind==="ask"){
     const q=await event(tx,m.id,"QUESTION",{question:choice.question,missing:choice.missing});
     await tx.agentMission.update({where:{id:m.id},data:{waitStateJson:{questionId:q.id,question:choice.question,missing:choice.missing}}});await release(tx,current,"WAITING_INPUT");return null;
    }
    if(choice.kind==="finish"){
     const output=await tx.agentMissionOutput.findFirst({where:{id:choice.outputId,missionId:m.id}});
     if(!output)throw new AppError("OUTPUT_REQUIRED","请先保存本委托的成果草稿",409);
     await validateSources(m.projectId,output.sourceRefsJson as unknown as Source[],tx);
     const criteria=m.successCriteriaJson as string[];
     if(criteria.includes("ACTION_CREATED")&&!await tx.agentMissionApproval.count({where:{missionId:m.id,status:"CONSUMED"}}))throw new AppError("CRITERIA_NOT_MET","尚未完成批准后的行动创建",409);
     await event(tx,m.id,"CRITERIA_CHECKED",{outputId:output.id,draftDelivered:true,actionCreated:criteria.includes("ACTION_CREATED"),contentVerification:"NEEDS_REVIEW"});await release(tx,current,"SUCCEEDED");return null;
    }
    const tool=tools[choice.tool];if(!tool)throw new AppError("UNKNOWN_TOOL","模型选择了未开放的工具",422);const args=tool.schema.parse(choice.args);assertToolConstraints(current.constraintsJson,choice.tool,args);
    const history=await tx.agentMissionStep.findMany({where:{missionId:m.id,status:"SUCCEEDED"},orderBy:{ordinal:"asc"}});const sources=sourcesFrom(history.map(s=>s.resultJson));const inputHash=toolInputHash(choice.tool,args,sources);
    if(history.slice(-2).length===2&&history.slice(-2).every(s=>s.inputHash===inputHash))throw new AppError("NO_PROGRESS","连续调用没有新信息，请调整目标或补充资料",409);
    const last=await tx.agentMissionStep.aggregate({where:{missionId:m.id},_max:{ordinal:true}});
    const created=await tx.agentMissionStep.create({data:{missionId:m.id,ordinal:(last._max.ordinal??0)+1,planRevision:m.planRevision,toolName:choice.tool,canonicalInputJson:json(args),inputHash,readSetJson:json(sources),agentRunId:run.id,providerCallId:decision.callId,protocolJson:{protocol:decision.protocol,schemaVersion:1}}});
    await event(tx,m.id,"TOOL_STARTED",{stepId:created.id,tool:choice.tool,summary:choice.summary});return created;
   });if(!step)return true;
  }
  activeStepId=step.id;const tool=tools[step.toolName];if(!tool)throw new AppError("UNKNOWN_TOOL","该工具版本不可恢复",409);
  assertToolConstraints((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).constraintsJson,step.toolName,step.canonicalInputJson);
  await reserve(lease,"tools",step.toolName);const started=Date.now();
  const result=await tool.run({userId:m.ownerUserId,projectId:m.projectId,missionId:m.id},tool.schema.parse(step.canonicalInputJson));
  if(JSON.stringify(result).length>40000)throw new AppError("TOOL_OUTPUT_LIMIT","工具结果超出任务读取范围",409);
  await settleUsage(lease,"tools",Date.now()-started);
  await db.$transaction(async tx=>{
   const current=await fenced(tx,lease);let data=result;
   if(step!.toolName==="save_mission_output"){
    const output=await saveOutput(tx,m.id,step!.id,step!.canonicalInputJson,step!.readSetJson as unknown as Source[]);data={data:{outputId:output.id,revision:output.revision},sources:[]};
   }
   if(step!.toolName==="propose_action"){
    await validateSources(m.projectId,step!.readSetJson as unknown as Source[],tx);
    const expiresAt=new Date(Date.now()+600000);const proposal={tool:"create_action",toolVersion:"1",args:step!.canonicalInputJson,ownerUserId:m.ownerUserId,projectId:m.projectId,planRevision:m.planRevision,contextVersion:m.contextVersion,constraintsVersion:current.constraintsVersion,readSet:step!.readSetJson,expiresAt:expiresAt.toISOString()};
    await tx.agentMissionApproval.create({data:{missionId:m.id,stepId:step!.id,proposalJson:json(proposal),proposalHash:jsonHash(proposal),expectedPlanRevision:m.planRevision,readSetJson:json(step!.readSetJson),expiresAt}});
    await tx.agentMissionStep.update({where:{id:step!.id},data:{status:"WAITING_APPROVAL",effectKey:`mission:${m.id}:step:${step!.id}`}});
    await event(tx,m.id,"APPROVAL_REQUESTED",{stepId:step!.id,proposal});await release(tx,current,"WAITING_APPROVAL");return;
   }
   await tx.agentMissionStep.update({where:{id:step!.id},data:{status:"SUCCEEDED",resultJson:json(data),finishedAt:new Date()}});
   await event(tx,m.id,"TOOL_FINISHED",{stepId:step!.id,result:data});await release(tx,current,"READY");
  });return true;
 }catch(error){
  const code=error instanceof AppError?error.code:error instanceof SyntaxError||error instanceof Error&&error.name==="ZodError"?"MODEL_PROTOCOL_ERROR":"EXECUTION_FAILED";
  await db.$transaction(async tx=>{
   await lock(tx,m.id);const current=await tx.agentMission.findUniqueOrThrow({where:{id:m.id}});
   if(current.leaseOwner!==lease.owner||current.leaseEpoch!==lease.epoch||current.status!=="RUNNING")return;
   const stop=!!current.cancelRequestedAt||!!current.pauseRequestedAt;
   if(activeStepId&&!stop)await tx.agentMissionStep.updateMany({where:{id:activeStepId,status:"RUNNING"},data:{status:code==="CONTEXT_CHANGED"?"OBSOLETE":"FAILED"}});
   if(code==="SOURCE_CHANGED"||code==="APPROVAL_CHANGED"||code==="CONTEXT_CHANGED"){await obsoleteApprovals(tx,m.id);await tx.agentMission.update({where:{id:m.id},data:{planRevision:{increment:1}}});}
   await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"FAILED",provider:options.provider?"TEST_FIXTURE":"mission-adapter",trace:{missionId:m.id,code},fallbackReason:code}});
   const failures=code==="MODEL_PROTOCOL_ERROR"?await tx.agentMissionEvent.count({where:{missionId:m.id,type:"MODEL_PROTOCOL_ERROR"}}):0;
   await tx.agentMission.update({where:{id:m.id},data:{lastErrorJson:{code,message:error instanceof AppError?error.message:"委托执行失败，请检查服务配置后继续"}}});
   await event(tx,m.id,code==="MODEL_PROTOCOL_ERROR"?code:"EXECUTION_STOPPED",{code});
   await release(tx,current,current.cancelRequestedAt?"CANCELLED":code==="MODEL_PROTOCOL_ERROR"&&failures<1?"READY":"PAUSED",stop?"USER":code==="BUDGET_EXHAUSTED"?"BUDGET":"REVIEW_REQUIRED");
  });return true;
 }finally{clearInterval(heartbeat);}
}
