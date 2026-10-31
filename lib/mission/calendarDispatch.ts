import {randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import {AppError} from "@/lib/api";
import {record} from "@/lib/conversation/repository";
import type {CalendarFetch} from "@/lib/calendar/feishuOAuth";
import {assertDirectiveEffect,effectiveContinuity} from "@/lib/continuity/directiveService";
import {assertExperienceReadSet} from "@/lib/experience/injection";
import {assertCognitiveReadSet} from "@/lib/memory/hypothesisService";
import {validateSources} from "./repository";
import {fenced,type Lease} from "./runtimeStore";
import {json,jsonHash,usageOf,defaultBudget,type Source} from "./contracts";

/** Every HTTP sub-operation uses the original step, lease, frozen approval and cumulative budget. */
export function missionCalendarFetch(lease:Lease,stepId:string,fetcher:CalendarFetch,readOnly:()=>boolean=()=>false):CalendarFetch {
 return async(url,init)=>{
  if(readOnly()&&!["GET","HEAD"].includes(init.method??"GET"))throw new AppError("CALENDAR_RECONCILE_READ_ONLY","只读核对不能重新派发或刷新授权",409);
  const operationId=randomUUID();
  await db.$transaction(async tx=>{
   const m=await fenced(tx,lease),step=await tx.agentMissionStep.findFirstOrThrow({where:{id:stepId,missionId:m.id}}),approval=await tx.agentMissionApproval.findUniqueOrThrow({where:{stepId}});
   const proposal=record(approval.proposalJson),target=record(proposal.target),args=record(proposal.args);
   if(approval.status!=="DISPATCHING"||approval.proposalHash!==jsonHash(approval.proposalJson))throw new AppError("APPROVAL_CHANGED","原外部写入许可已失效",409);
   const write=!["GET","HEAD"].includes(init.method??"GET");
   if(write&&approval.expiresAt<=new Date())throw new AppError("APPROVAL_CHANGED","外部写入许可已到期，停止后续请求",409);
   assertDirectiveEffect(await effectiveContinuity(m.ownerUserId,{projectId:m.projectId,missionId:m.id},tx),write?"BUSINESS_WRITE":"EXTERNAL_READ");
   await assertCognitiveReadSet(m.ownerUserId,record(step.protocolJson).cognitiveReadSet,tx);
   await assertExperienceReadSet(m.ownerUserId,record(step.protocolJson).experienceReadSet,tx);
   await validateSources(m.projectId,approval.readSetJson as unknown as Source[],tx,m.id);
   const connection=await tx.calendarConnection.findFirst({where:{id:String(args.connectionId),projectId:m.projectId,ownerUserId:m.ownerUserId,status:"ACTIVE",revokedAt:null}});
   if(!connection)throw new AppError("CALENDAR_CONNECTION_REVOKED","日历授权已撤回，停止后续请求",409);
   if(connection.revision!==target.connectionRevision||connection.authGeneration!==target.authGeneration||connection.calendarId!==target.calendarId)throw new AppError("CALENDAR_CONNECTION_CHANGED","日历许可已变化，停止后续请求",409);
   if(write&&!connection.scope.split(/\s+/).includes("calendar:calendar"))throw new AppError("CALENDAR_WRITE_SCOPE_MISSING","当前连接没有写权限",409);
   if(init.method==="DELETE"&&proposal.compensationPolicy!=="RECHECK_THEN_DELETE_CREATED_EVENTS")throw new AppError("CALENDAR_COMPENSATION_NOT_APPROVED","原批准不包含删除补偿",409);
   const used=usageOf(m.budgetUsedJson),limits={...defaultBudget,...m.budgetJson as object};
   if(used.calendarRequests+1>limits.calendarRequests)throw new AppError("CALENDAR_REQUEST_BUDGET_EXHAUSTED","日历累计HTTP额度已用完，停止后续请求",409);
   used.calendarRequests++;await tx.agentMission.update({where:{id:m.id},data:{budgetUsedJson:json(used)}});
   const protocol=record(step.protocolJson),effect=record(protocol.externalEffect),operations=record(effect.httpOperations);
   await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...protocol,externalEffect:{...effect,httpOperations:{...operations,[operationId]:{state:"DISPATCHING",method:init.method??"GET",requestHash:jsonHash({url,body:init.body??null})}}}})}});
  });
  try{
   const response=await fetcher(url,init);
   await settle("RECEIVED",response.status);return response;
  }catch(error){await settle("UNKNOWN");throw error;}
  async function settle(state:string,status?:number){
   // A late receipt belongs to this old request only; it cannot publish success or restart execution.
   await db.$transaction(async tx=>{
    const step=await tx.agentMissionStep.findUniqueOrThrow({where:{id:stepId}}),protocol=record(step.protocolJson),effect=record(protocol.externalEffect),operations=record(effect.httpOperations);
    if(record(operations[operationId]).state!=="DISPATCHING")return;
    await tx.agentMissionStep.update({where:{id:stepId},data:{protocolJson:json({...protocol,externalEffect:{...effect,httpOperations:{...operations,[operationId]:{...record(operations[operationId]),state,...(status?{status}:{})}}}})}});
   });
  }
 };
}
