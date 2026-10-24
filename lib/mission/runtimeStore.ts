import {readDecisionSnapshot} from "@/lib/decision/snapshot";
import { assertAutomaticPermission,validateAutomaticEvidence } from "./automaticPolicy";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { json, usageOf, defaultBudget } from "./contracts";
import { assertOwner, event, lock, type Tx } from "./repository";
import { requireMissions } from "./missionService";
export type Lease={id:string;owner:string;epoch:number;contextVersion:number;planRevision:number};
export async function claimMission(owner:string,id?:string){
 requireMissions();return db.$transaction(async tx=>{
  const now=new Date();await tx.agentMission.updateMany({where:{status:"RUNNING",leaseUntil:{lte:now}},data:{status:"READY",executionSlot:null,leaseOwner:null,leaseUntil:null}});
  if(await tx.agentMission.count({where:{executionSlot:1}}))return null;
  for(let scan=0;scan<20;scan++){
  const m=await tx.agentMission.findFirst({where:{status:"READY",OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}],...(id?{id}:{})},orderBy:{createdAt:"asc"}});if(!m)return null;
  await lock(tx,m.id);try{await assertOwner(m.ownerUserId,m.projectId,tx);}catch(error){if(!(error instanceof AppError))throw error;await tx.agentMission.update({where:{id:m.id},data:{status:"PAUSED",pauseReason:"REVIEW_REQUIRED",version:{increment:1},lastErrorJson:{code:"AUTHORIZATION_REVOKED",message:"项目权限已撤销，委托已暂停"}}});await event(tx,m.id,"AUTHORIZATION_REVOKED",{});continue;}
  const claimed=await tx.agentMission.update({where:{id:m.id},data:{status:"RUNNING",nextAttemptAt:null,executionSlot:1,leaseOwner:owner,leaseUntil:new Date(Date.now()+60000),leaseEpoch:{increment:1},version:{increment:1}}});
  await event(tx,m.id,"CLAIMED",{epoch:claimed.leaseEpoch});return claimed;
  }return null;
 });
}
export async function fenced(tx:Tx,lease:Lease,checkContext=true){
 requireMissions();await lock(tx,lease.id);const m=await tx.agentMission.findUniqueOrThrow({where:{id:lease.id}});
 if(m.status!=="RUNNING"||m.leaseOwner!==lease.owner||m.leaseEpoch!==lease.epoch||!m.leaseUntil||m.leaseUntil<=new Date())throw new AppError("LEASE_LOST","执行租约已失效",409);
 await assertOwner(m.ownerUserId,m.projectId,tx);assertAutomaticPermission(m);
 if(m.cancelRequestedAt||m.pauseRequestedAt)throw new AppError("STOP_REQUESTED","用户请求停止执行",409);
 if(checkContext&&(m.contextVersion!==lease.contextVersion||m.planRevision!==lease.planRevision))throw new AppError("CONTEXT_CHANGED","委托上下文已变化",409);
 const impactGuard=(m.planJson as {impactGuard?:string}).impactGuard;
 if(checkContext&&impactGuard){const current=await readDecisionSnapshot(tx,m.projectId);if(current.coverage.state!=="COMPLETE"||current.sharedHash!==impactGuard)throw new AppError("SOURCE_CHANGED","依赖或来源已变化，旧方案不得继续提交，请重新对比并确认",409);}
 await validateAutomaticEvidence(tx,m);
 return m;
}
export async function renew(lease:Lease){requireMissions();const result=await db.agentMission.updateMany({where:{id:lease.id,status:"RUNNING",leaseOwner:lease.owner,leaseEpoch:lease.epoch,leaseUntil:{gt:new Date()}},data:{leaseUntil:new Date(Date.now()+60000)}});return result.count===1;}
export async function reserve(lease:Lease,kind:"models"|"tools",tool?:string,outputTokens=1000){return db.$transaction(async tx=>{
 const m=await fenced(tx,lease);const used=usageOf(m.budgetUsedJson),limits={...defaultBudget,...m.budgetJson as object};
 used[kind]++;if(tool==="web_search")used.searches++;if(tool==="web_fetch")used.fetches++;used.activeMs+=20000;if(kind==="models"){used.reservedOutputTokens+=outputTokens;used.unknownCalls++;}
 if(Object.entries(limits).some(([key,value])=>used[key as keyof typeof used]>value))throw new AppError("BUDGET_EXHAUSTED","委托预算已用完，请检查后处理",409);
 await tx.agentMission.update({where:{id:m.id},data:{budgetUsedJson:json(used)}});return used;
 });}
export async function settleUsage(lease:Lease,kind:"models"|"tools",durationMs:number,tokens?:{inputTokens:number|null;outputTokens:number|null}){return db.$transaction(async tx=>{
 const m=await fenced(tx,lease,false);const used=usageOf(m.budgetUsedJson);used.activeMs=Math.max(0,used.activeMs-20000)+durationMs;
 if(kind==="models"&&tokens){if(tokens.inputTokens!==null)used.inputTokens+=tokens.inputTokens;if(tokens.outputTokens!==null)used.outputTokens+=tokens.outputTokens;if(tokens.inputTokens!==null&&tokens.outputTokens!==null)used.unknownCalls=Math.max(0,used.unknownCalls-1);}
 await tx.agentMission.update({where:{id:m.id},data:{budgetUsedJson:json(used)}});
 });}
export async function release(tx:Tx,m:AgentMission,status:string,reason?:string){return tx.agentMission.update({where:{id:m.id},data:{status,pauseReason:reason??null,...(status==="PAUSED"&&reason!=="USER"?{planJson:json({...m.planJson as object,resumeStatus:"READY"})}:{}),executionSlot:null,leaseOwner:null,leaseUntil:null,version:{increment:1},...(status==="SUCCEEDED"||status==="CANCELLED"?{finishedAt:new Date()}:{})}});}
