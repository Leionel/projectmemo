import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, jsonHash } from "./contracts";
import { event } from "./repository";
import { fenced, release, reserve, settleUsage, type Lease } from "./runtimeStore";
import { investigationInputHash } from "./investigationDelegation";
import type { ToolSet } from "./tools";

type Target={connectionId:string;sha:string;revision:number};
/** A declared read before reasoning. Uses the same MissionStep, lease, HTTP ledger and cumulative budget. */
export async function runDelegationObservation(lease:Lease,tools:ToolSet,onStep:(id:string)=>void):Promise<boolean>{
  const pending=await db.$transaction(async tx=>{
    const m=await fenced(tx,lease),state=record(record(m.planJson).delegation),poll=record(state.poll);
    if(typeof poll.cycle!=="string")return null;
    const targets=poll.targets as Target[];
    if(!Array.isArray(targets)||!targets.length||targets.length>3)throw new AppError("DELEGATION_CHANGED","仓库观察范围需要重新核对",409);
    const steps=await tx.agentMissionStep.findMany({where:{missionId:m.id,planRevision:m.planRevision},orderBy:{ordinal:"asc"}});
    const observed=steps.filter(s=>record(s.protocolJson).delegationCycle===poll.cycle&&s.status==="SUCCEEDED");
    const snapshots:Record<string,string>={};
    for(const s of observed){
      const observation=record(record(record(s.resultJson).data).observation),args=record(s.canonicalInputJson);
      // Ignore observation timestamps; ordering and first baseline are explicit, no false 'new information' per poll.
      const byId=(a:unknown)=>Array.isArray(a)?[...a].sort((x,y)=>Number(record(x).id)-Number(record(y).id)):[];
      snapshots[String(args.connectionId)]=jsonHash({sha:observation.sha,connectionRevision:observation.connectionRevision,checks:byId(observation.checks),runs:byId(observation.runs),coverage:observation.coverage});
    }
    const next=targets.find(t=>snapshots[t.connectionId]===undefined);
    if(!next){
      const input=await investigationInputHash(m,tx),previous=record(state.remoteSnapshots);
      if(input.truncated)throw new AppError("INPUT_COVERAGE_LIMIT","资料变化较多，请核对调查范围",409);
      const changed=input.hash!==state.inputHash||Object.entries(snapshots).some(([key,value])=>previous[key]!==value);
      const fresh=await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...record(m.planJson),delegation:{...state,poll:null,remoteSnapshots:snapshots,lastObservedAt:new Date().toISOString(),attention:changed?null:state.attention}}),...(changed?{contextVersion:{increment:1},planRevision:{increment:1}}:{})}});
      await event(tx,m.id,changed?"INVESTIGATION_OBSERVATION_CHANGED":"INVESTIGATION_NO_NEW_INFORMATION",{cycle:poll.cycle,changed,observationStepIds:observed.map(s=>s.id)});
      await release(tx,fresh,changed?"READY":"WAITING_INPUT");return {done:true} as const;
    }
    const connection=await tx.sourceConnection.findUnique({where:{id:next.connectionId}});
    if(!connection||connection.revision!==next.revision)throw new AppError("CONNECTION_CHANGED","仓库授权版本已变化，请重新核对",409);
    const existing=steps.find(s=>record(s.protocolJson).delegationCycle===poll.cycle&&record(s.canonicalInputJson).connectionId===next.connectionId&&s.status==="RUNNING");
    const last=await tx.agentMissionStep.aggregate({where:{missionId:m.id},_max:{ordinal:true}});
    const s=existing??await tx.agentMissionStep.create({data:{missionId:m.id,ordinal:(last._max.ordinal??0)+1,planRevision:m.planRevision,status:"RUNNING",toolName:"read_repository_ci",toolVersion:"1",canonicalInputJson:{connectionId:next.connectionId,sha:next.sha},inputHash:jsonHash(next),readSetJson:[],protocolJson:{schemaVersion:1,delegationCycle:poll.cycle},startedAt:new Date()}});
    return {done:false,mission:m,step:s} as const;
  });
  if(!pending)return false;if(pending.done)return true;
  const tool=tools.read_repository_ci;if(!tool)throw new AppError("CI_NOT_AUTHORIZED","原仓库观察工具不可用",409);
  const stepId=pending.step.id;onStep(stepId);
  // reserve() rechecks deadline, STOP, continuity and tool permission before any request.
  await reserve(lease,"tools","read_repository_ci");const started=Date.now();
  let result;
  try{result=await tool.run({userId:pending.mission.ownerUserId,projectId:pending.mission.projectId,missionId:pending.mission.id},tool.schema.parse(pending.step.canonicalInputJson));if(JSON.stringify(result).length>40000)throw new AppError("TOOL_OUTPUT_LIMIT","工具结果超出任务读取范围",409);}
  catch(error){await settleUsage(lease,"tools",Date.now()-started).catch(()=>undefined);throw error;}
  await settleUsage(lease,"tools",Date.now()-started);
  await db.$transaction(async tx=>{const m=await fenced(tx,lease);await tx.agentMissionStep.update({where:{id:stepId},data:{status:"SUCCEEDED",resultJson:json(result),finishedAt:new Date()}});await event(tx,m.id,"TOOL_FINISHED",{stepId,tool:"read_repository_ci",purpose:"DECLARED_OBSERVATION",result});await release(tx,m,"READY");});
  return true;
}
