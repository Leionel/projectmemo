import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { commandSchema, constraintsSchema, createMissionSchema, defaultBudget, json, jsonHash, researchScopeSchema, terminal } from "./contracts";
import { assertOwner, commandReplay, event, lock, ownedMission, validateSources } from "./repository";
import type { Source } from "./contracts";
import { z } from "zod";
import { continuationPolicySchema } from "@/lib/types/mission";
import { readMissionCompletion } from "./completionSummary";
import { suggestionsForMission } from "@/lib/experience/injection";
import type {Prisma} from "@/lib/generated/prisma/client";
import { premiseFor, assessEvidenceFit, requireFitReview, recordFitReview } from "./evidenceFitService";
import type { WaitState } from "./gaps";
export function requireMissions() { if (!isFeatureEnabled("MISSION_ENABLED", false)) throw new AppError("MISSION_DISABLED", "委托功能尚未启用", 503); }
export async function createMission(userId: string, input: unknown) {
  requireMissions(); const body=createMissionSchema.parse(input); await assertOwner(userId,body.projectId); const hash=jsonHash(body);
  const find=()=>db.agentMission.findUnique({where:{ownerUserId_createRequestId:{ownerUserId:userId,createRequestId:body.requestId}}});
  const existing=await find(); if(existing){if(existing.createPayloadHash!==hash)throw new AppError("REQUEST_ID_REUSED","请求编号已用于其他委托",409);return existing;}
  try{return await db.$transaction(tx=>createMissionInTx(tx,userId,body));}catch(error){const raced=await find();if(raced?.createPayloadHash===hash)return raced;throw error;}
}
/** Shared creation path for confirmed Copilot handoff; caller owns the atomic receipt transaction. */
export async function createMissionInTx(tx:Prisma.TransactionClient,userId:string,input:unknown){
    requireMissions();const body=createMissionSchema.parse(input);await assertOwner(userId,body.projectId,tx);const hash=jsonHash(body);
    const m=await tx.agentMission.create({data:{ownerUserId:userId,projectId:body.projectId,createRequestId:body.requestId,createPayloadHash:hash,goal:body.goal,successCriteriaJson:body.successCriteria,constraintsJson:json({...body.missionConstraints,llmContextApproved:body.llmContextApproved}),researchScopeJson:json(body.researchScope),continuationPolicyJson:body.continuationPolicy,budgetJson:defaultBudget}});
    await event(tx,m.id,"CREATED",{goal:m.goal,constraints:body.missionConstraints,researchScope:body.researchScope,llmContextApproved:body.llmContextApproved});return m;
}
export async function listMissions(userId:string,projectId:string,cursor?:string){
  await assertOwner(userId,projectId);
  const rows=await db.agentMission.findMany({where:{ownerUserId:userId,projectId},orderBy:{id:"asc"},take:21,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  return {missions:rows.slice(0,20).map(m=>({id:m.id,goal:m.goal,status:m.status,version:m.version})),nextCursor:rows.length>20?rows[19].id:null};
}
export async function missionDetail(userId:string,id:string){
  const m=await ownedMission(userId,id);const [steps,approvals,outputs,questions]=await Promise.all([
    db.agentMissionStep.findMany({where:{missionId:id},orderBy:{ordinal:"asc"}}),db.agentMissionApproval.findMany({where:{missionId:id,status:"PENDING"}}),db.agentMissionOutput.findMany({where:{missionId:id},orderBy:{revision:"desc"},take:5}),db.agentMissionEvent.findMany({where:{missionId:id,type:"QUESTION"},orderBy:{seq:"desc"},take:1}),
  ]);
  const completion=await readMissionCompletion(id,outputs[0]?.verificationStatus??null);
  const fitPremise=m.waitStateJson&&m.status==="WAITING_INPUT"?premiseFor(m,m.waitStateJson as unknown as WaitState):null;
  const experience=isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED",true)?{enabled:true as const,suggestions:await suggestionsForMission(m),note:"建议不改变权限；影子观察不注入模型上下文。"}:{enabled:false as const,suggestions:[],note:"项目经验复用当前未开启。"};
  return {evidencePremise:fitPremise,completion,experience,semanticCheckEnabled:isFeatureEnabled("MISSION_SEMANTIC_CHECK_ENABLED",false),artifactAdoptionEnabled:isFeatureEnabled("MISSION_ARTIFACT_ADOPTION_ENABLED",false),id:m.id,projectId:m.projectId,goal:m.goal,status:m.status,version:m.version,contextVersion:m.contextVersion,planRevision:m.planRevision,continuationPolicy:m.continuationPolicyJson,autoContinuationEnabled:isFeatureEnabled("MISSION_AUTO_CONTINUATION_ENABLED",false),successCriteria:m.successCriteriaJson,constraints:m.constraintsJson,constraintsVersion:m.constraintsVersion,researchScope:m.researchScopeJson,researchScopeVersion:m.researchScopeVersion,pauseReason:m.pauseReason,pauseRequestedAt:m.pauseRequestedAt?.toISOString()??null,cancelRequestedAt:m.cancelRequestedAt?.toISOString()??null,error:m.lastErrorJson,budget:m.budgetJson,used:m.budgetUsedJson,question:m.status==="WAITING_INPUT"?questions[0]??null:null,steps:steps.map(s=>({id:s.id,ordinal:s.ordinal,toolName:s.toolName,status:s.status,result:s.resultJson})),approvals:approvals.map(a=>({id:a.id,proposal:a.proposalJson,proposalHash:a.proposalHash,expiresAt:a.expiresAt})),outputs};
}
export async function readOutput(userId:string,id:string,outputId:string){await ownedMission(userId,id);const output=await db.agentMissionOutput.findFirst({where:{id:outputId,missionId:id}});if(!output)throw new AppError("OUTPUT_NOT_FOUND","没有找到成果草稿",404);return output;}
export async function missionEvents(userId:string,id:string,after=0){await ownedMission(userId,id);const events=await db.agentMissionEvent.findMany({where:{missionId:id,seq:{gt:after}},orderBy:{seq:"asc"},take:100});return{events,nextAfterSeq:events.at(-1)?.seq??after};}
export async function commandMission(userId:string,id:string,action:string,raw:unknown,approvalId?:string,guard?:(mission:Awaited<ReturnType<typeof ownedMission>>)=>void, transaction?:Prisma.TransactionClient){
  requireMissions();const body=commandSchema.parse(raw),hash=jsonHash({action,approvalId,body});
  const apply = async (tx:Prisma.TransactionClient) => {
    await lock(tx,id);const m=await ownedMission(userId,id,tx);guard?.(m);if(await commandReplay(tx,id,body.requestId,hash))return m;
    if(m.version!==body.expectedVersion||terminal.includes(m.status))throw new AppError("MISSION_CHANGED","委托状态已变化，请刷新",409);
    let status=m.status;
    if(action==="input"){
      const q=await tx.agentMissionEvent.findFirst({where:{missionId:id,type:"QUESTION"},orderBy:{seq:"desc"}});
      if(m.status!=="WAITING_INPUT"||!body.answer||q?.id!==body.questionId)throw new AppError("INPUT_CHANGED","问题已变化，请刷新后补充",409);status="READY";
      const wait=m.waitStateJson as unknown as WaitState;
      const fit=await assessEvidenceFit(tx,m,wait,[],body.evidenceReview);
      if(fit){
        requireFitReview(fit,body.evidenceReview);
        if(body.evidenceReview!.mode!=="CONDITIONAL_ANALYSIS")throw new AppError("FIT_MATERIAL_REQUIRED","文字答复只用于保留未知的条件分析；直接作答请选取原资料",409);
        const reviewed=await recordFitReview(tx,m,fit,body.evidenceReview!);
        await tx.agentMission.update({where:{id},data:{waitStateJson:json({...wait,resolved:true,evidenceFitReview:fit,evidenceFitEventId:reviewed.id})}});
      }else if(body.evidenceReview)throw new AppError("FIT_NOT_AVAILABLE","此问题没有新版核对条件",409);

    }else if(action==="approval"){
      const a=await tx.agentMissionApproval.findFirst({where:{id:approvalId,missionId:id,status:"PENDING"}});
      if(m.status!=="WAITING_APPROVAL"||!a||!body.decision||a.proposalHash!==body.proposalHash||a.expiresAt<=new Date()||a.expectedPlanRevision!==m.planRevision)throw new AppError("APPROVAL_CHANGED","批准预览已失效，请重新预览",409);
      if(body.decision==="APPROVED")await validateSources(m.projectId,a.readSetJson as unknown as Source[],tx,m.id);
      await tx.agentMissionApproval.update({where:{id:a.id},data:{status:body.decision,approverUserId:userId,decidedAt:new Date()}});
      await tx.agentMissionStep.update({where:{id:a.stepId},data:{status:body.decision==="APPROVED"?"READY":"SKIPPED"}});status="READY";
      if(body.decision==="REJECTED"){const c=m.constraintsJson as Record<string,unknown>;const title=(a.proposalJson as {args:{title:string}}).args.title;await tx.agentMission.update({where:{id},data:{constraintsJson:json({...c,rejectedActions:[...new Set([...(c.rejectedActions as string[]??[]),title])].slice(-12)}),constraintsVersion:{increment:1},contextVersion:{increment:1},planRevision:{increment:1}}});await event(tx,id,"CONSTRAINTS_CHANGED",{rejectedAction:title,source:"USER_REJECTED_APPROVAL"});}
    }else if(action==="replan"){
      if(m.status!=="WAITING_APPROVAL")throw new AppError("INVALID_TRANSITION","当前没有待重新预览的提案",409);
      await tx.agentMissionApproval.updateMany({where:{missionId:id,status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});
      await tx.agentMissionStep.updateMany({where:{missionId:id,status:{in:["WAITING_APPROVAL","READY"]}},data:{status:"OBSOLETE"}});
      await tx.agentMission.update({where:{id},data:{planRevision:{increment:1}}});status="READY";
    }else if(action==="resume"){
      if(m.status!=="PAUSED")throw new AppError("MISSION_NOT_PAUSED","仅暂停的委托可以继续；失败任务需先修复原因",409);const previous=(m.planJson as {resumeStatus?:string}).resumeStatus;status=previous&&["WAITING_INPUT","WAITING_APPROVAL"].includes(previous)?previous:"READY";
    }else if(action==="pause"){if(!["READY","RUNNING","WAITING_INPUT","WAITING_APPROVAL"].includes(m.status))throw new AppError("INVALID_TRANSITION","当前状态无法暂停",409);status=m.status==="RUNNING"?"RUNNING":"PAUSED";}
    else if(action==="cancel")status=m.status==="RUNNING"?"RUNNING":"CANCELLED";
    else throw new AppError("INVALID_COMMAND","不支持此操作",422);
    const updated=await tx.agentMission.update({where:{id},data:{status,...(action==="pause"?{planJson:json({...m.planJson as object,resumeStatus:m.status==="RUNNING"?"READY":m.status})}:{}),...( ["resume","input","approval","replan"].includes(action)?{planJson:json({...m.planJson as object,resumeStatus:null,automaticContinuation:null,...((m.planJson as {dynamicReview?:{completed?:boolean}}).dynamicReview?.completed&&["resume","input"].includes(action)?{dynamicReview:null}:{})})}:{}),version:{increment:1},...(action==="input"?{contextVersion:{increment:1}}:{}),pauseRequestedAt:action==="pause"?new Date():null,cancelRequestedAt:action==="cancel"?new Date():m.cancelRequestedAt,pauseReason:action==="pause"?"USER":null}});
    await event(tx,id,action.toUpperCase(),json(body),{id:`cmd:${body.requestId}`,hash});return updated;
  };
  return transaction ? apply(transaction) : db.$transaction(apply);
}
const editSchema=z.object({requestId:z.string().min(1).max(128),expectedVersion:z.number().int().positive(),expectedConstraintsVersion:z.number().int().positive().optional(),expectedScopeVersion:z.number().int().positive().optional(),constraints:constraintsSchema.optional(),scope:researchScopeSchema.optional(),llmContextApproved:z.boolean().optional()}).strict();
export async function editMission(userId:string,id:string,kind:"constraints"|"research-scope",raw:unknown){
  requireMissions();const body=editSchema.parse(raw),hash=jsonHash({kind,body});
  return db.$transaction(async tx=>{
    await lock(tx,id);const m=await ownedMission(userId,id,tx);if(await commandReplay(tx,id,body.requestId,hash))return m;
    if(terminal.includes(m.status)||m.version!==body.expectedVersion||(kind==="constraints"?m.constraintsVersion!==body.expectedConstraintsVersion:m.researchScopeVersion!==body.expectedScopeVersion))throw new AppError("MISSION_CHANGED","委托已变化，请刷新后修改",409);
    if(kind==="constraints"&&!body.constraints||kind==="research-scope"&&!body.scope)throw new AppError("INVALID_EDIT","请提供完整的约束或公开研究范围",422);
    await tx.agentMissionApproval.updateMany({where:{missionId:id,status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});
    await tx.agentMissionStep.updateMany({where:{missionId:id,status:{in:["READY","WAITING_APPROVAL"]}},data:{status:"OBSOLETE"}});
    const old=m.constraintsJson as Record<string,unknown>;
    const updated=await tx.agentMission.update({where:{id},data:{...(kind==="constraints"?{constraintsJson:json({...body.constraints,llmContextApproved:body.llmContextApproved??old.llmContextApproved}),constraintsVersion:{increment:1}}:{researchScopeJson:json(body.scope),researchScopeVersion:{increment:1}}),contextVersion:{increment:1},version:{increment:1},planRevision:{increment:1},planJson:json({...m.planJson as object,resumeStatus:(m.planJson as {resumeStatus?:string}).resumeStatus==="WAITING_INPUT"?"WAITING_INPUT":"READY"}),status:m.status==="WAITING_APPROVAL"?"READY":m.status}});
    await event(tx,id,kind==="constraints"?"CONSTRAINTS_CHANGED":"RESEARCH_SCOPE_CHANGED",json(body),{id:`cmd:${body.requestId}`,hash});return updated;
  });
}
const policyEditSchema=z.object({requestId:z.string().min(1).max(128),expectedVersion:z.number().int().positive(),policy:continuationPolicySchema}).strict();
export async function editContinuationPolicy(userId:string,id:string,raw:unknown){
 requireMissions();const body=policyEditSchema.parse(raw),hash=jsonHash(body);
 return db.$transaction(async tx=>{
  await lock(tx,id);const m=await ownedMission(userId,id,tx);if(await commandReplay(tx,id,body.requestId,hash))return m;
  if(m.version!==body.expectedVersion||terminal.includes(m.status))throw new AppError("MISSION_CHANGED","委托已变化，请刷新",409);
  const active=!!(m.planJson as {automaticContinuation?:unknown}).automaticContinuation;
  await tx.agentMissionApproval.updateMany({where:{missionId:id,status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});
  await tx.agentMissionStep.updateMany({where:{missionId:id,status:{in:["READY","WAITING_APPROVAL"]}},data:{status:"OBSOLETE"}});
  const status=active&&m.status==="READY"?"PAUSED":m.status==="WAITING_APPROVAL"?"READY":m.status;
  const updated=await tx.agentMission.update({where:{id},data:{continuationPolicyJson:json(body.policy),contextVersion:{increment:1},planRevision:{increment:1},version:{increment:1},status,pauseRequestedAt:active&&m.status==="RUNNING"?new Date():m.pauseRequestedAt,planJson:json({...m.planJson as object,automaticContinuation:null,...(status==="PAUSED"?{resumeStatus:"READY"}:{})})}});
  await event(tx,id,"CONTINUATION_POLICY_CHANGED",{policy:body.policy,source:"USER_CONFIRMED"},{id:`cmd:${body.requestId}`,hash});return updated;
 });
}
