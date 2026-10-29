import { reserveCloudCall } from "@/lib/auth/cloudQuota";
import {verifyResearchClaims,type ClaimJudge,type ClaimCheck} from "./claimVerifier";
import {configuredClaimJudge} from "./claimJudgeAdapter";
import {isFeatureEnabled} from "@/lib/config/features";
import { assertAutomaticTool } from "./automaticPolicy";
import { researchTools,type ResearchDependencies } from "./tools/researchTools";
import { persistObservations } from "@/lib/research/sourceRepository";
import { verifyMissionResult } from "./resultVerifier";
import { gapRequirementsSchema } from "./gaps";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { missionStrategyV2 } from "@/lib/agent/specialistPrompts";
import { chooseNext, type DecisionProvider } from "./modelAdapter";
import { buildContext } from "./contextBuilder";
import { choiceSchema, json, jsonHash, MISSION_PROTOCOL_SCHEMA_VERSION, type Decision, type Source } from "./contracts";
import { event, lock, validateSources } from "./repository";
import { claimMission, fenced, release, renew, reserve, settleUsage, type Lease } from "./runtimeStore";
import { projectTools, sourcesFrom, toolInputHash, type ToolSet } from "./tools";
import { assertToolConstraints } from "./constraintsService";
import { saveOutput } from "./outputService";
import { commitApprovedAction, obsoleteApprovals } from "./approvalService";
import { decisionTokenLimit, ModelProtocolError, protocolDiagnostic, missionFailure, missionContextManifest, type MissionPhase, type MissionRecovery, type MissionContextManifest } from "./modelProtocol";
import { dynamicGuard, assertDynamicTool } from "./dynamicGuard";
import { Prisma } from "@/lib/generated/prisma/client";
import { repositoryTools } from "./repositoryTools";
import type { CiTransport } from "@/lib/sensing/repoCi";
import { boundedPolicy } from "./investigationDelegation";
import { runDelegationObservation } from "./delegationObservation";
export async function runMissionSlice(options:{id?:string;workerId?:string;provider?:DecisionProvider;tools?:ToolSet;research?:ResearchDependencies;repository?:CiTransport;judge?:ClaimJudge}={}){
 const m=await claimMission(options.workerId??randomUUID(),options.id);if(!m)return false;
 const lease:Lease={id:m.id,owner:m.leaseOwner!,epoch:m.leaseEpoch,contextVersion:m.contextVersion,planRevision:m.planRevision};
 const tools={...(options.tools??{...projectTools,...researchTools(lease,options.research),...await repositoryTools(lease,m,options.repository)})};const delegation=boundedPolicy(m);if(delegation)for(const name of Object.keys(tools))if(!delegation.allowedTools.includes(name as typeof delegation.allowedTools[number]))delete tools[name];let activeStepId:string|undefined;
 let phase:MissionPhase="CONTEXT",contextManifest:MissionContextManifest|undefined,sourceDecisionRunId:string|null|undefined;
 const failedSettlements=new Set<"models"|"tools">();
 // Keep failed reservations and unknown usage; a lost lease must not hide the original failure.
 const settleFailed=async(kind:"models"|"tools",started:number,usage?:Decision["usage"])=>{try{await settleUsage(lease,kind,Date.now()-started,usage);}catch{failedSettlements.add(kind);}};
 const heartbeat=setInterval(()=>{void renew(lease).catch(()=>false);},10000);heartbeat.unref();
 try{
  if(recordDelegationPoll(m.planJson)){phase="TOOL";if(await runDelegationObservation(lease,tools,id=>{activeStepId=id;}))return true;phase="CONTEXT";}
  const directed = dynamicGuard(m);
  if (directed) {
   const ready = await db.agentMissionStep.findFirst({where:{missionId:m.id,planRevision:m.planRevision,status:"READY",toolName:"read_project_material"},orderBy:{ordinal:"asc"}});
   const running = await db.agentMissionStep.findFirst({where:{missionId:m.id,planRevision:m.planRevision,status:"RUNNING",toolName:"read_project_material"},orderBy:{ordinal:"asc"}});
   if (directed.kind === "ASK_USER" || !ready && !running) {
    phase="COMMIT";
    await db.$transaction(async tx=>{
     const current=await fenced(tx,lease);const guard=dynamicGuard(current)!;
     if(guard.kind==="ASK_USER"&&!guard.completed){
      const question=await event(tx,m.id,"QUESTION",{question:guard.question,missing:"PRIVATE",requirements:{},reviewProposalId:guard.proposalId,phase:"DYNAMIC_REVIEW"});
      await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...current.planJson as object,dynamicReview:{...guard,completed:true}}),waitStateJson:json({questionId:question.id,gapId:question.id,question:guard.question,missing:"PRIVATE",requirements:{},startedAt:new Date().toISOString(),readSet:[],reviewProposalId:guard.proposalId})}});
      await release(tx,current,"WAITING_INPUT");
     }else{
      const completed=await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...current.planJson as object,dynamicReview:{...guard,completed:true}})}});
      await event(tx,m.id,"REVIEW_OBSERVATIONS_READY",{rootReviewId:guard.rootReviewId,proposalId:guard.proposalId});
      await release(tx,completed,"PAUSED","REVIEW_REQUIRED");
     }
    });return true;
   }
   if(ready&&!running)await db.$transaction(async tx=>{const current=await fenced(tx,lease);assertDynamicTool(current,ready.toolName,ready.canonicalInputJson);await tx.agentMissionStep.update({where:{id:ready.id},data:{status:"RUNNING",startedAt:new Date()}});});
  }
  const pending=await db.agentMissionStep.findFirst({where:{missionId:m.id,status:"READY",approval:{status:"APPROVED"}},orderBy:{ordinal:"asc"}});
  if(pending){phase="APPROVAL";activeStepId=pending.id;sourceDecisionRunId=pending.agentRunId;await commitApprovedAction(lease,pending.id);return true;}
  const unfinished=await db.agentMissionStep.findFirst({where:{missionId:m.id,status:"RUNNING",planRevision:m.planRevision},orderBy:{ordinal:"asc"}});
  let step=unfinished;
  if(!step){
   await db.$transaction(async tx=>{await fenced(tx,lease);await tx.agentMissionStep.updateMany({where:{missionId:m.id,status:"RUNNING",planRevision:{not:m.planRevision}},data:{status:"OBSOLETE"}});});
   const constraints=m.constraintsJson as {llmContextApproved?:boolean;costCeiling?:{amount:number}|null};
   if(!options.provider&&!constraints.llmContextApproved)throw new AppError("LLM_CONTEXT_NOT_APPROVED","请先确认云模型使用本委托上下文的范围",409);
   if(!options.provider&&constraints.costCeiling)throw new AppError("COST_POLICY_REQUIRED","金额上限尚无法自动换算，需确认调用额度或使用不计费模式",409);
   const context=await buildContext(m,tools);contextManifest=missionContextManifest(context,m);
   phase="DECISION";await reserve(lease,"models",undefined,decisionTokenLimit(m.lastErrorJson));const started=Date.now();
   const decision=await (async()=>{try{if(!options.provider)await reserveCloudCall(m.projectId);return await (options.provider??chooseNext)(context,tools);}catch(error){
    await settleFailed("models",started,error instanceof ModelProtocolError?error.metadata.usage:undefined);
    throw error;
   }})();
   await settleUsage(lease,"models",Date.now()-started,decision.usage);
   const parsedChoice=choiceSchema.safeParse(decision.choice);
   if(!parsedChoice.success)throw new ModelProtocolError(protocolDiagnostic("INVALID_CHOICE",null,0,parsedChoice.error.issues.slice(0,8).map(issue=>({code:issue.code,path:issue.path.join(".")}))),decision);
   const choice=parsedChoice.data;
   let toolArgs:unknown;
   if(choice.kind==="tool"){
    const tool=tools[choice.tool];if(!tool)throw new AppError("UNKNOWN_TOOL","模型选择了未开放的工具",422);
    const parsedArgs=tool.schema.safeParse(choice.args);
    if(!parsedArgs.success)throw new ModelProtocolError(protocolDiagnostic("INVALID_TOOL_ARGUMENTS",null,0,parsedArgs.error.issues.slice(0,8).map(issue=>({code:issue.code,path:issue.path.join(".")}))),decision);
    toolArgs=parsedArgs.data;
   }
   phase="COMMIT";
   step=await db.$transaction(async tx=>{
    const current=await fenced(tx,lease);
    await tx.agentMission.update({where:{id:m.id},data:{lastErrorJson:Prisma.DbNull}});
    const run=await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"SUCCESS",provider:decision.provider,trace:json({missionId:m.id,phase:"DECISION",model:decision.model,protocol:decision.protocol,prompt:decision.prompt??null,usage:decision.usage,serialization:decision.serialization,contextManifest}),resultJson:json({kind:choice.kind}),durationMs:Date.now()-started}});
    if(choice.kind==="ask"){
     phase="DECISION";const requirements=gapRequirementsSchema.parse(choice.requirements??{});if(!isFeatureEnabled("MISSION_EVIDENCE_FIT_ENABLED",false))delete requirements.evidenceFitV1;const gapId=randomUUID();phase="COMMIT";
     const evidencePremiseContext=requirements.evidenceFitV1?{constraintsVersion:current.constraintsVersion,scopeVersion:current.researchScopeVersion,goalHash:jsonHash(current.goal)}:undefined;
     const q=await event(tx,m.id,"QUESTION",{question:choice.question,missing:choice.missing,gapId,requirements,evidencePremiseContext,phase:"DECISION"});
     const history=await tx.agentMissionStep.findMany({where:{missionId:m.id,status:"SUCCEEDED",...((current.planJson as {impactGuard?:string}).impactGuard?{planRevision:current.planRevision}:{})},orderBy:{ordinal:"asc"}});
     await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...current.planJson as object,automaticContinuation:null}),waitStateJson:json({questionId:q.id,gapId,question:choice.question,missing:choice.missing,requirements,evidencePremiseContext,startedAt:new Date().toISOString(),readSet:sourcesFrom(history.map(s=>s.resultJson))})}});await release(tx,current,"WAITING_INPUT");return null;
    }
    if(choice.kind==="finish"){
     phase="VERIFY";const verification=await verifyMissionResult(tx,current,choice.outputId);phase="COMMIT";
     await event(tx,m.id,"CRITERIA_CHECKED",{...verification,phase:"VERIFY"});await release(tx,current,"SUCCEEDED");return null;
    }
    phase="TOOL";const tool=tools[choice.tool],args=toolArgs;assertAutomaticTool(current,choice.tool,tool.effects.businessWrite);assertToolConstraints(current.constraintsJson,choice.tool,args);
    const history=await tx.agentMissionStep.findMany({where:{missionId:m.id,status:"SUCCEEDED",...((current.planJson as {impactGuard?:string}).impactGuard?{planRevision:current.planRevision}:{})},orderBy:{ordinal:"asc"}});const sources=sourcesFrom(history.map(s=>s.resultJson));const inputHash=toolInputHash(choice.tool,args,sources);
    if(history.slice(-2).length===2&&history.slice(-2).every(s=>s.inputHash===inputHash))throw new AppError("NO_PROGRESS","连续调用没有新信息，请调整目标或补充资料",409);
    phase="COMMIT";const last=await tx.agentMissionStep.aggregate({where:{missionId:m.id},_max:{ordinal:true}});
    const created=await tx.agentMissionStep.create({data:{missionId:m.id,ordinal:(last._max.ordinal??0)+1,planRevision:m.planRevision,toolName:choice.tool,toolVersion:tools[choice.tool].version??"1",canonicalInputJson:json(args),inputHash,readSetJson:json(sources),agentRunId:run.id,providerCallId:decision.callId,protocolJson:{protocol:decision.protocol,schemaVersion:MISSION_PROTOCOL_SCHEMA_VERSION}}});
    await event(tx,m.id,"TOOL_STARTED",{stepId:created.id,tool:choice.tool,summary:choice.summary,phase:"TOOL"});return created;
   });if(!step)return true;
  }
  phase="TOOL";activeStepId=step.id;sourceDecisionRunId=step.agentRunId;const tool=tools[step.toolName];if(!tool)throw new AppError("UNKNOWN_TOOL","该工具版本不可恢复",409);
  const currentMission=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});assertAutomaticTool(currentMission,step.toolName,tool.effects.businessWrite);
  assertToolConstraints(currentMission.constraintsJson,step.toolName,step.canonicalInputJson);
  const args=tool.schema.parse(step.canonicalInputJson);assertDynamicTool(currentMission,step.toolName,args);await reserve(lease,"tools",step.toolName);const started=Date.now();
  const result=await(async()=>{try{const value=await tool.run({userId:m.ownerUserId,projectId:m.projectId,missionId:m.id},args);if(JSON.stringify(value).length>40000)throw new AppError("TOOL_OUTPUT_LIMIT","工具结果超出任务读取范围",409);return value;}catch(error){await settleFailed("tools",started);throw error;}})();
  await settleUsage(lease,"tools",Date.now()-started);
  let claimChecks:ClaimCheck[]|undefined;
  if(step.toolName==="save_mission_output"){
   phase="VERIFY";
   const constraints=currentMission.constraintsJson as {llmContextApproved?:boolean;costCeiling?:unknown};
   const delegate=options.judge??(isFeatureEnabled("MISSION_CLAIM_JUDGE_ENABLED",false)&&constraints.llmContextApproved&&!constraints.costCeiling?configuredClaimJudge:undefined);
   const judge:ClaimJudge|undefined=delegate?async request=>{
    if(!isFeatureEnabled("MISSION_SEMANTIC_CHECK_ENABLED",false)||!options.judge&&!isFeatureEnabled("MISSION_CLAIM_JUDGE_ENABLED",false))throw new AppError("JUDGE_DISABLED","语义核验已关闭",409);
    const begin=Date.now();let reserved=false;
    const response=await(async()=>{try{await reserve(lease,"models");reserved=true;if(!options.judge)await reserveCloudCall(m.projectId);return await delegate(request);}catch(error){
     if(reserved)await settleFailed("models",begin,error instanceof ModelProtocolError?error.metadata.usage:undefined);
     const failure=missionFailure(error,"VERIFY");
     await db.$transaction(async tx=>{await fenced(tx,lease);await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"FAILED",provider:options.judge?"TEST_FIXTURE":"mission-claim-judge",fallbackReason:"JUDGE_UNAVAILABLE",trace:json({missionId:m.id,phase:"VERIFY",purpose:"CLAIM_JUDGE",claimId:request.claimId,code:failure.code,category:failure.category,diagnostic:failure.diagnostic,contextManifest})}});});throw error;
    }})();
    await settleUsage(lease,"models",Date.now()-begin,response.usage);
    await db.$transaction(async tx=>{await fenced(tx,lease);await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"SUCCESS",provider:response.provider,trace:json({missionId:m.id,phase:"VERIFY",purpose:"CLAIM_JUDGE",model:response.model,claimId:request.claimId,usage:response.usage,contextManifest}),resultJson:{verdict:response.verdict}}});});return response;
   }:undefined;
   claimChecks=await verifyResearchClaims(step.canonicalInputJson,step.readSetJson as unknown as Source[],{enabled:isFeatureEnabled("MISSION_SEMANTIC_CHECK_ENABLED",false),judge});
  }

  phase="COMMIT";await db.$transaction(async tx=>{
   const current=await fenced(tx,lease);assertDynamicTool(current,step!.toolName,step!.canonicalInputJson);let data=result;
   if(step!.toolName==="web_search"||step!.toolName==="web_fetch")await persistObservations(tx,m.id,result.data);
   if(step!.toolName==="save_mission_output"){
    phase="VERIFY";const output=await saveOutput(tx,m.id,step!.id,step!.canonicalInputJson,step!.readSetJson as unknown as Source[],claimChecks);phase="COMMIT";data={data:{outputId:output.id,revision:output.revision},sources:[]};
   }
   if(step!.toolName==="propose_action"){
    phase="VERIFY";await validateSources(m.projectId,step!.readSetJson as unknown as Source[],tx,m.id);phase="APPROVAL";
    const expiresAt=new Date(Date.now()+600000);const proposal={tool:"create_action",toolVersion:"1",args:step!.canonicalInputJson,ownerUserId:m.ownerUserId,projectId:m.projectId,planRevision:m.planRevision,contextVersion:m.contextVersion,constraintsVersion:current.constraintsVersion,readSet:step!.readSetJson,expiresAt:expiresAt.toISOString()};
    await tx.agentMissionApproval.create({data:{missionId:m.id,stepId:step!.id,proposalJson:json(proposal),proposalHash:jsonHash(proposal),expectedPlanRevision:m.planRevision,readSetJson:json(step!.readSetJson),expiresAt}});
    await tx.agentMissionStep.update({where:{id:step!.id},data:{status:"WAITING_APPROVAL",effectKey:`mission:${m.id}:step:${step!.id}`}});
    await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...current.planJson as object,automaticContinuation:null})}});
    await event(tx,m.id,"APPROVAL_REQUESTED",{stepId:step!.id,proposal,phase:"APPROVAL"});await release(tx,current,"WAITING_APPROVAL");return;
   }
   if(step!.toolName==="inspect_action"){const action=data.data as {actionId?:string;status?:string;resultCardId?:string};if(action.status==="DONE"&&action.resultCardId)await event(tx,m.id,"USER_REPORTED",{stepId:step!.id,actionId:action.actionId,resultCardId:action.resultCardId});}
   await tx.agentMissionStep.update({where:{id:step!.id},data:{status:"SUCCEEDED",resultJson:json(data),finishedAt:new Date()}});
   await event(tx,m.id,"TOOL_FINISHED",{stepId:step!.id,result:data,phase:"COMMIT"});await release(tx,current,"READY");
  });return true;
 }catch(error){
  const failure=missionFailure(error,phase),code=failure.code;
  await db.$transaction(async tx=>{
   await lock(tx,m.id);const current=await tx.agentMission.findUniqueOrThrow({where:{id:m.id}});
   if(current.leaseOwner!==lease.owner||current.leaseEpoch!==lease.epoch||current.status!=="RUNNING")return;
   const stop=!!current.cancelRequestedAt||!!current.pauseRequestedAt;
   const active=activeStepId?await tx.agentMissionStep.findUnique({where:{id:activeStepId}}):null;
   const retry=!stop&&code==="RESEARCH_RETRYABLE"&&active?.status==="RUNNING"&&active.attempts<3;let nextAttemptAt:Date|undefined;
   if(retry){await tx.agentMissionStep.update({where:{id:active!.id},data:{attempts:{increment:1}}});const requested=(error as AppError).details as {retryAfterMs?:number}|undefined;const delay=Math.min(30000,Math.max(1000*2**(active!.attempts-1),requested?.retryAfterMs??0));nextAttemptAt=new Date(Date.now()+delay);await tx.agentMission.update({where:{id:m.id},data:{nextAttemptAt}});}
   if(activeStepId&&!stop&&!retry)await tx.agentMissionStep.updateMany({where:{id:activeStepId,status:"RUNNING"},data:{status:code==="CONTEXT_CHANGED"?"OBSOLETE":"FAILED"}});
   if(code==="SOURCE_CHANGED"||code==="APPROVAL_CHANGED"||code==="CONTEXT_CHANGED"){await obsoleteApprovals(tx,m.id);await tx.agentMission.update({where:{id:m.id},data:{planRevision:{increment:1}}});}
   const diagnostic=failure.diagnostic,metadata=failure.metadata;
   const boundary=failure.protocol?await tx.agentMissionEvent.findFirst({where:{missionId:m.id,type:{in:["TOOL_FINISHED","QUESTION","CRITERIA_CHECKED","RESUME","INPUT"]}},orderBy:{seq:"desc"}}):null;
   const failures=failure.protocol?await tx.agentMissionEvent.count({where:{missionId:m.id,type:"MODEL_PROTOCOL_ERROR",seq:{gt:boundary?.seq??0}}}):0;
   const repair=!stop&&failure.protocol&&failures<1;
   const recovery:MissionRecovery=stop?{kind:"STOP_REQUESTED",automatic:false,message:"已按你的要求停止，已有记录保留。"}
    :retry?{kind:"RESEARCH_RETRY",automatic:true,message:"公开资料服务暂不可用，将按退避时间重试。",attempt:active!.attempts+1,maxAttempts:3,nextAttemptAt:nextAttemptAt!.toISOString()}
    :repair?{kind:"MODEL_FORMAT_RETRY",automatic:true,message:"正在进行一次模型格式纠错，已有成功步骤保留。",attempt:failures+1,maxAttempts:2}
    :code==="BUDGET_EXHAUSTED"?{kind:"BUDGET_REVIEW",automatic:false,message:"任务预算已用完；继续不会重置预算，请核对目标和额度。"}
    :{kind:"REVIEW_REQUIRED",automatic:false,message:failure.protocol?"模型格式纠错仍未通过，请检查模型配置后人工继续。":"请核对当前失败原因后继续，已有步骤和结果保留。",...(failure.protocol?{attempt:failures+1,maxAttempts:2}:{})};
   await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"FAILED",provider:metadata?.provider??(options.provider?"TEST_FIXTURE":"mission-adapter"),trace:json({prompt:options.provider?null:{id:missionStrategyV2.id,version:missionStrategyV2.version,purpose:missionStrategyV2.purpose,outputSchemaVersion:missionStrategyV2.outputSchemaVersion},missionId:m.id,stepId:activeStepId,sourceDecisionRunId,code,phase:failure.phase,category:failure.category,...metadata,diagnostic,recovery,contextManifest,...(failedSettlements.size?{usageSettlementFailures:[...failedSettlements]}:{})}),fallbackReason:code}});
   await tx.agentMission.update({where:{id:m.id},data:{lastErrorJson:json({code,message:failure.message,diagnostic,phase:failure.phase,category:failure.category,recovery})}});
   await event(tx,m.id,failure.protocol?"MODEL_PROTOCOL_ERROR":"EXECUTION_STOPPED",{code,...diagnostic,phase:failure.phase,category:failure.category,recovery});
   const status=current.cancelRequestedAt?"CANCELLED":current.pauseRequestedAt?"PAUSED":retry||repair?"READY":"PAUSED";
   await release(tx,current,status,stop?"USER":code==="BUDGET_EXHAUSTED"?"BUDGET":"REVIEW_REQUIRED");
  });return true;
 }finally{clearInterval(heartbeat);}
}
function recordDelegationPoll(plan:unknown){return !!(plan as {delegation?:{poll?:unknown}}|null)?.delegation?.poll;}
