import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { boundedInvestigationPolicySchema } from "@/lib/types/mission";
import { json, jsonHash, usageOf } from "./contracts";
import { record } from "@/lib/conversation/repository";
import { event, lock, assertOwner, sourceHash, type Tx } from "./repository";
import { assertContinuityBinding } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { decidePrivateMissionAttention } from "@/lib/services/interventionPolicyService";

export function boundedPolicy(m: Pick<AgentMission,"continuationPolicyJson">) {
  const parsed=boundedInvestigationPolicySchema.safeParse(m.continuationPolicyJson);return parsed.success?parsed.data:null;
}
export function assertInvestigationDelegation(m:AgentMission,tool?:string,args?:unknown){
  const p=boundedPolicy(m);if(!p)return;
  if(!isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED",false)||Date.parse(p.expiresAt)<=Date.now())throw new AppError("DELEGATION_EXPIRED","持续调查许可已到期或关闭",409);
  if((m.constraintsJson as {llmContextApproved?:boolean}).llmContextApproved!==true)throw new AppError("LLM_CONTEXT_NOT_APPROVED","持续调查的模型上下文许可已撤销",409);
  const state=record(record(m.planJson).delegation);
  if(state.policyHash!==jsonHash(p))throw new AppError("DELEGATION_CHANGED","持续调查许可已变化，请重新核对",409);
  if(tool&&(!p.allowedTools.includes(tool as typeof p.allowedTools[number])||["read_repository_ci","read_ci_jobs","read_ci_log"].includes(tool)&&typeof record(args).connectionId==="string"&&!p.connectionIds.includes(String(record(args).connectionId))))throw new AppError("DELEGATION_TOOL_DENIED","该读取不在持续调查许可内",409);
}
export async function validateDelegationConnections(m:AgentMission,tx:Tx){
  const p=boundedPolicy(m);if(!p)return;
  const versions=record(record(record(m.planJson).delegation).connectionVersions);
  for(const id of p.connectionIds){
    const c=await tx.sourceConnection.findFirst({where:{id,projectId:m.projectId,ownerUserId:m.ownerUserId,status:"ACTIVE",revokedAt:null,signalKind:{in:p.allowedTools.includes("read_ci_log")?["COMMITS_CI_LOGS"]:["COMMITS_AND_CI","COMMITS_CI_LOGS"]}}});
    if(!c||versions[id]!==c.revision)throw new AppError("DELEGATION_CONNECTION_CHANGED","仓库授权版本已变化，请重新确认持续调查范围",409);
  }
}
/** Local input cursor: metadata/content hashes only, no model and no outbound request. */
export async function investigationInputHash(m:AgentMission,tx:Tx=db){
  const [captures,attachments,actions,signals]=await Promise.all([
    tx.capture.findMany({where:{projectId:m.projectId},orderBy:{id:"desc"},take:101,select:{id:true,rawText:true}}),
    tx.attachment.findMany({where:{projectId:m.projectId},orderBy:{id:"desc"},take:101,select:{id:true,extractionStatus:true,revisions:{orderBy:{revisionIndex:"desc"},take:1,select:{id:true,revisionIndex:true,text:true}}}}),
    tx.actionItem.findMany({where:{projectId:m.projectId,isSimulated:false},orderBy:{id:"desc"},take:101,select:{id:true,status:true,resultCardId:true,dependencyVersion:true}}),
    tx.externalSignal.findMany({where:{projectId:m.projectId,ownerUserId:m.ownerUserId,connectionId:{in:boundedPolicy(m)?.connectionIds??[]}},orderBy:{id:"desc"},take:101,select:{id:true,sha:true,status:true}}),
  ]);
  const allowed=[];for(const capture of captures)if((await sourceUse(m.ownerUserId,m.projectId,"capture:"+capture.id,tx,{missionId:m.id})).state==="ALLOWED")allowed.push(capture);
  const allowedAttachments=[];for(const a of attachments)if((await sourceUse(m.ownerUserId,m.projectId,"attachment:"+a.id,tx,{missionId:m.id})).state==="ALLOWED")allowedAttachments.push(a);
  const allowedActions=[];for(const a of actions)if((await sourceUse(m.ownerUserId,m.projectId,"action:"+a.id,tx,{missionId:m.id})).state==="ALLOWED")allowedActions.push(a);
  const pointers=[];for(const c of allowed.slice(0,8)){const id="capture:"+c.id;const hash=await sourceHash(m.projectId,id,tx);if(hash)pointers.push({sourceId:id,sourceHash:hash});}
  return {hash:jsonHash({captures:allowed,attachments:allowedAttachments,actions:allowedActions,signals}),pointers,truncated:[captures,attachments,actions,signals].some(a=>a.length>100)};
}
export async function initializeDelegation(tx:Tx,m:AgentMission,raw:unknown){
  const p=boundedInvestigationPolicySchema.parse(raw);
  if(!isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED",false))throw new AppError("DELEGATION_DISABLED","持续调查暂未开启",503);
  if(p.allowedTools.some(t=>["inspect_document","read_document_page","read_document_section","read_document_table"].includes(t))&&!isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false))throw new AppError("DOCUMENT_READER_DISABLED","文档深读当前未开启，不能新增这项持续许可",503);
  if(p.allowedTools.some(t=>["inspect_experiment_metrics","compare_experiment_metrics","propose_metric_verification"].includes(t))&&!isFeatureEnabled("EXPERIMENT_OBSERVER_ENABLED",false))throw new AppError("EXPERIMENT_OBSERVER_DISABLED","实验指标读取未开启，不能新增持续许可",503);
  if(p.allowedTools.includes("propose_metric_verification")&&!isFeatureEnabled("SANDBOX_VERIFICATION_ENABLED",false))throw new AppError("SANDBOX_DISABLED","固定核算未开启，不能新增提案许可",503);
  if(p.allowedTools.includes("read_paper_metadata")&&(!isFeatureEnabled("ACADEMIC_RESEARCH_ENABLED",false)||!record(m.researchScopeJson).academicMetadata||!record(m.researchScopeJson).enabled))throw new AppError("ACADEMIC_NOT_APPROVED","请先核对原公开研究范围中的论文元数据许可",409);
  if(Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.expiresAt)>Date.now()+30*86400000)throw new AppError("INVALID_DELEGATION_PERIOD","请选择未来30天内的调查期限",422);
  try{new Intl.DateTimeFormat("zh-CN",{timeZone:p.timezone}).format();}catch{throw new AppError("INVALID_TIMEZONE","时区无法识别",422);}
  if((m.constraintsJson as {llmContextApproved?:boolean}).llmContextApproved!==true)throw new AppError("LLM_CONTEXT_NOT_APPROVED","请先允许云模型使用原委托上下文",409);
  if(p.allowedTools.some(t=>["read_repository_ci","read_ci_jobs","read_ci_log"].includes(t))&&!p.connectionIds.length)throw new AppError("CI_NOT_AUTHORIZED","请选择原来已授权的仓库连接",409);
  const connectionVersions:Record<string,number>={};
  for(const id of p.connectionIds){const c=await tx.sourceConnection.findFirst({where:{id,projectId:m.projectId,ownerUserId:m.ownerUserId,status:"ACTIVE",revokedAt:null,signalKind:{in:p.allowedTools.includes("read_ci_log")?["COMMITS_CI_LOGS"]:["COMMITS_AND_CI","COMMITS_CI_LOGS"]}}});if(!c)throw new AppError("CI_NOT_AUTHORIZED","持续调查不能扩大原仓库授权",409);connectionVersions[id]=c.revision;}
  const input=await investigationInputHash({...m,continuationPolicyJson:json(p)},tx);
  return {policyHash:jsonHash(p),connectionVersions,inputHash:input.hash,grantedAt:new Date().toISOString(),attention:null,trigger:"PROJECT_INPUT_OR_AUTHORIZED_PINNED_CI",remoteSnapshots:{}};
}
export function delegationAttention(m:AgentMission,reason:string,now=new Date()){
  const p=boundedPolicy(m);if(!p)return null;
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:p.timezone,hour:"2-digit",hourCycle:"h23"}).format(now));
  const quiet=p.quietStart===p.quietEnd?false:p.quietStart<p.quietEnd?hour>=p.quietStart&&hour<p.quietEnd:hour>=p.quietStart||hour<p.quietEnd;
  return {level:quiet?"QUEUE":"DIGEST",reason,occurredAt:now.toISOString(),needsUser:true,systemPush:false};
}
export async function scopedDelegationAttention(tx:Tx,m:AgentMission,reason:string){
  const attention=delegationAttention(m,reason);if(!attention)return null;
  const preferences=await tx.goalQuestionPreference.findMany({where:{userId:m.ownerUserId,missionId:m.id,OR:[{questionId:"*"},{questionId:String(record(m.waitStateJson).questionId??"")}]}});
  const anchors=await tx.conversationAnchor.findMany({where:{ownerUserId:m.ownerUserId,missionId:m.id},select:{mode:true,snoozedUntil:true}});
  let level=attention.level;
  if(preferences.some(p=>p.mode==="STOP")||anchors.some(a=>a.mode==="STOPPED"))level="SUPPRESS";
  else if([...preferences,...anchors].some(p=>p.mode==="LATER"&&p.snoozedUntil&&p.snoozedUntil>new Date()))level="QUEUE";
  const wait=record(m.waitStateJson),deadline=Date.parse(String(record(m.constraintsJson).deadline??""));
  const urgent=reason==="WAITING_INPUT"&&["CRITICAL","CONFLICT"].includes(String(wait.missing))&&Number.isFinite(deadline)&&deadline>Date.now()&&deadline-Date.now()<=3600000;
  const decision=await decidePrivateMissionAttention(tx,{userId:m.ownerUserId,projectId:m.projectId,candidateKey:jsonHash({missionId:m.id,contextVersion:m.contextVersion,questionId:wait.questionId,reason}),urgent,level,reason,now:new Date()});
  const previous=record(record(record(m.planJson).delegation).attention);
  return {...attention,...decision,delivery:previous.decisionId===decision.decisionId?previous.delivery:{channel:"PRIVATE_MISSION_INBOX",status:"AVAILABLE",seenAt:null}};
}
/** Called by the existing worker. The same Mission wakes; budgets are never reset. */
export async function processInvestigationDelegations(limit=8){
  if(!isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED",false))return {checked:0,woken:0};
  const now=new Date(),batchSize=Math.max(1,Math.min(32,Math.floor(limit)));
  // Select due delegated work before applying the batch limit; manual waits must not starve it.
  const ids=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM "AgentMission" WHERE status='WAITING_INPUT' AND "cancelRequestedAt" IS NULL AND "pauseRequestedAt" IS NULL AND json_extract("continuationPolicyJson",'$.mode')='BOUNDED_INVESTIGATION' AND ("nextAttemptAt" IS NULL OR CASE WHEN typeof("nextAttemptAt")='integer' THEN "nextAttemptAt"<=${+now} ELSE julianday("nextAttemptAt")<=julianday(${now.toISOString()}) END) ORDER BY "updatedAt" ASC LIMIT ${batchSize}`;
  const rows=await db.agentMission.findMany({where:{id:{in:ids.map(r=>r.id)}},orderBy:{updatedAt:"asc"}});let woken=0;
  for(const candidate of rows)if(boundedPolicy(candidate))await db.$transaction(async tx=>{
    await tx.user.updateMany({where:{id:candidate.ownerUserId},data:{continuitySeq:{increment:0}}});await lock(tx,candidate.id);
    const m=await tx.agentMission.findUniqueOrThrow({where:{id:candidate.id}}),p=boundedPolicy(m);if(!p||m.status!=="WAITING_INPUT"||m.pauseRequestedAt||m.cancelRequestedAt)return;
    const state=record(record(m.planJson).delegation);
    const hold=async(reason:string)=>{const attention=await scopedDelegationAttention(tx,m,reason);await tx.agentMission.update({where:{id:m.id},data:{status:"PAUSED",pauseReason:"REVIEW_REQUIRED",nextAttemptAt:null,planJson:json({...record(m.planJson),resumeStatus:"READY",delegation:{...state,attention}}),version:{increment:1}}});await event(tx,m.id,"INVESTIGATION_HELD",{reason});};
    try{await assertOwner(m.ownerUserId,m.projectId,tx);assertInvestigationDelegation(m);await validateDelegationConnections(m,tx);await assertContinuityBinding(m.ownerUserId,{projectId:m.projectId,missionId:m.id},record(m.planJson).continuityBinding,tx);}catch(error){if(!(error instanceof AppError))throw error;await hold(error.code);return;}
    const used=usageOf(m.budgetUsedJson);if(used.models>=p.maxModels||used.tools>=p.maxTools){await hold("BUDGET_EXHAUSTED");return;}
    const input=await investigationInputHash(m,tx);if(input.truncated){await hold("INPUT_COVERAGE_LIMIT");return;}
    const nextAttemptAt=new Date(Math.min(Date.parse(p.expiresAt),Date.now()+p.checkEveryMinutes*60000));
    if(input.hash===state.inputHash){
      // A due remote observation becomes work in the existing Runner, never an HTTP call in this transaction.
      if(p.connectionIds.length&&p.allowedTools.includes("read_repository_ci")){
        const targets=[];
        for(const connectionId of p.connectionIds){
          const connection=await tx.sourceConnection.findFirst({where:{id:connectionId,projectId:m.projectId,ownerUserId:m.ownerUserId,status:"ACTIVE",revokedAt:null,signalKind:{in:["COMMITS_AND_CI","COMMITS_CI_LOGS"]}}});
          if(!connection){await hold("CI_NOT_AUTHORIZED");return;}
          const signal=await tx.externalSignal.findFirst({where:{connectionId,projectId:m.projectId,ownerUserId:m.ownerUserId,status:{in:["CANDIDATE","ADOPTED"]}},orderBy:[{fetchedAt:"desc"},{id:"desc"}]});
          if(!signal){await hold("CI_TARGET_NOT_OBSERVED");return;}
          targets.push({connectionId,sha:signal.sha,revision:connection.revision});
        }
        await tx.agentMission.update({where:{id:m.id},data:{status:"READY",nextAttemptAt:null,version:{increment:1},planJson:json({...record(m.planJson),delegation:{...state,poll:{cycle:crypto.randomUUID(),targets,requestedAt:now.toISOString()}}})}});
        await event(tx,m.id,"INVESTIGATION_OBSERVATION_DUE",{targets});woken++;return;
      }
      await tx.agentMission.update({where:{id:m.id},data:{nextAttemptAt,planJson:json({...record(m.planJson),delegation:{...state,attention:await scopedDelegationAttention(tx,m,"WAITING_INPUT")}})}});return;
    }
    await tx.agentMissionApproval.updateMany({where:{missionId:m.id,status:{in:["PENDING","APPROVED"]}},data:{status:"OBSOLETE"}});
    await tx.agentMission.update({where:{id:m.id},data:{status:"READY",nextAttemptAt:null,contextVersion:{increment:1},version:{increment:1},planRevision:{increment:1},planJson:json({...record(m.planJson),automaticContinuation:null,delegation:{...state,inputHash:input.hash,candidateSources:input.pointers,lastWakeAt:now.toISOString(),attention:null}})}});
    await event(tx,m.id,"INVESTIGATION_INPUT_CHANGED",{previousHash:state.inputHash,currentHash:input.hash});woken++;
  });return {checked:rows.length,woken};
}
