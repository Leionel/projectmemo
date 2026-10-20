import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { defaultBudget, json, jsonHash, usageOf, type Source } from "./contracts";
import { commandReplay, event, lock, ownedMission, type Tx } from "./repository";
import { gapRequirementsSchema, sourcePointerSchema, type WaitState } from "./gaps";
import { readProjectMaterial } from "./sourceSignals";
import { requireMissions } from "./missionService";
import { materialTemporalStates } from "./readSetValidator";
type ContinuationResult={continued:boolean;questionId:string;reason?:string;contextVersion?:number;planRevision?:number};

const previewSchema=z.object({questionId:z.string(),sourcePointers:z.array(sourcePointerSchema).min(1).max(8).refine(p=>new Set(p.map(s=>s.id)).size===p.length,"材料不能重复选择")}).strict();
const confirmSchema=previewSchema.extend({requestId:z.string().min(1).max(128),expectedVersion:z.number().int().positive(),expectedContextVersion:z.number().int().positive(),assessmentHash:z.string(),answer:z.string().trim().min(1).max(3000),confirmedGap:z.literal(true)}).strict();
function enabled(){requireMissions();if(!isFeatureEnabled("MISSION_EVENT_CONTINUATION_ENABLED",false))throw new AppError("CONTINUATION_DISABLED","材料接续尚未启用，可直接补充当前问题",503);}
async function assess(userId:string,id:string,body:z.infer<typeof previewSchema>,tx:Tx){
  const m=await ownedMission(userId,id,tx),wait=m.waitStateJson as unknown as WaitState|null;
  if(m.status!=="WAITING_INPUT"||wait?.questionId!==body.questionId||m.cancelRequestedAt||m.pauseRequestedAt)throw new AppError("INPUT_CHANGED","等待问题已变化，请刷新",409);
  const requirements=gapRequirementsSchema.parse(wait.requirements??{}),sources:Source[]=[];
  for(const pointer of body.sourcePointers){const source=await readProjectMaterial(m.projectId,pointer.id,tx);if(!source||source.hash!==pointer.hash)throw new AppError("SOURCE_CHANGED","材料已变化或不可访问，请重新选择",409);sources.push(source);}
  const readable=sources.every(s=>!!s.text.trim()),text=sources.map(s=>s.text).join("\n");
  const checks=[...requirements.terms,...(requirements.unit?[requirements.unit]:[]),...(requirements.period?[requirements.period]:[])].map(term=>({term,present:text.toLowerCase().includes(term.toLowerCase())}));
  if(requirements.unit){const escaped=requirements.unit.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");checks.push({term:`指标数值（${requirements.unit}）`,present:new RegExp(`[-+]?\\d+(?:\\.\\d+)?\\s*${escaped}`,"i").test(text)});}
  const typeMatches=sources.every(s=>requirements.sourceType==="EITHER"||s.entityType===requirements.sourceType);
  const relevance=readable&&typeMatches&&checks.some(c=>c.present)?"RELATED":"UNKNOWN";
  const temporalStates=await materialTemporalStates(m.projectId,sources,tx);
  const blocked=temporalStates.some(s=>s.state==="SUPERSEDED"||s.state==="CONTESTED");
  const assessment=!readable||!typeMatches?"INSUFFICIENT":wait.missing==="CONFLICT"||blocked?"CONFLICT":!checks.length?"UNKNOWN":checks.every(c=>c.present)?"SUFFICIENT":"INSUFFICIENT";
  const value={questionId:wait.questionId,gapId:wait.gapId,version:m.version,contextVersion:m.contextVersion,constraintsVersion:m.constraintsVersion,scopeVersion:m.researchScopeVersion,sourcePointers:body.sourcePointers,relevance,assessment,readable,checks,temporalStates,sourceTypeMatches:typeMatches,semanticVerification:"NOT_CHECKED",remaining:checks.filter(c=>!c.present).map(c=>c.term)};
  return{m,wait,sources,value,assessmentHash:jsonHash(value)};
}
export async function previewContinuation(userId:string,id:string,raw:unknown){enabled();const body=previewSchema.parse(raw);return db.$transaction(async tx=>{const a=await assess(userId,id,body,tx);return{...a.value,assessmentHash:a.assessmentHash,materials:a.sources.map(s=>({id:s.id,text:s.text.slice(0,3000),hash:s.hash}))};});}
export async function listContinuationCandidates(userId:string,id:string){
  const m=await ownedMission(userId,id);const wait=m.waitStateJson as unknown as WaitState|null;
  if(m.status!=="WAITING_INPUT"||!wait?.questionId)return{candidates:[]};
  const events=await db.agentMissionEvent.findMany({where:{missionId:id,type:"SOURCE_ARRIVED"},orderBy:{seq:"desc"},take:80});
  const candidates=[];
  for(const e of events){const payload=e.payloadJson as {questionId:string;sourcePointer:{id:string;hash:string}};if(payload.questionId!==wait.questionId)continue;const s=await readProjectMaterial(m.projectId,payload.sourcePointer.id);if(s?.hash===payload.sourcePointer.hash)candidates.push({sourcePointer:payload.sourcePointer,readable:!!s.text.trim(),excerpt:s.text.slice(0,400),observedAt:s.observedAt});}
  return{candidates};
}
export async function confirmContinuation(userId:string,id:string,raw:unknown):Promise<ContinuationResult>{
  enabled();const body=confirmSchema.parse(raw),hash=jsonHash(body);
  return db.$transaction(async tx=>{
    await lock(tx,id);await ownedMission(userId,id,tx);
    const replay=await commandReplay(tx,id,body.requestId,hash);if(replay)return replay.payloadJson as unknown as ContinuationResult;
    const a=await assess(userId,id,body,tx),{m,wait,sources}=a;
    if(m.version!==body.expectedVersion||m.contextVersion!==body.expectedContextVersion||a.assessmentHash!==body.assessmentHash)throw new AppError("ASSESSMENT_CHANGED","评估已变化，请重新预览",409);
    const budget={...defaultBudget,...m.budgetJson as object},used=usageOf(m.budgetUsedJson);
    const canRun=!Object.entries(budget).some(([key,value])=>used[key as keyof typeof used]>=value);
    const sufficient=a.value.assessment==="SUFFICIENT"||a.value.assessment==="UNKNOWN"&&a.value.readable&&a.value.sourceTypeMatches;
    await event(tx,id,"SOURCE_ASSOCIATED",{questionId:wait.questionId,pointers:body.sourcePointers,basis:"USER_REVIEWED",relevance:a.value.relevance});
    await event(tx,id,"GAP_ASSESSED",{...a.value,userConfirmed:true,answer:body.answer});
    const authorized=(m.constraintsJson as {llmContextApproved?:boolean}).llmContextApproved===true;
    if(!sufficient||!canRun||!authorized){const result={continued:false,reason:!authorized?"LLM_CONTEXT_NOT_APPROVED":!canRun?"BUDGET_EXHAUSTED":a.value.assessment,questionId:wait.questionId};await event(tx,id,"CONTINUATION_HELD",result,{id:`cmd:${body.requestId}`,hash});return result;}
    // Existing completed history stays immutable. Only unexecuted work from the old plan is retired.
    const pending=await tx.agentMissionStep.findMany({where:{missionId:id,status:{in:["READY","WAITING_APPROVAL","RUNNING"]}}});
    const related=pending.filter(s=>!Array.isArray(s.readSetJson)||(s.readSetJson as unknown as Source[]).length===0||(s.readSetJson as unknown as Source[]).some(old=>sources.some(now=>old.id===now.id||old.id===`project:${m.projectId}`)));
    if(related.length){await tx.agentMissionApproval.updateMany({where:{missionId:id,stepId:{in:related.map(s=>s.id)},status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});await tx.agentMissionStep.updateMany({where:{id:{in:related.map(s=>s.id)}},data:{status:"OBSOLETE"}});}
    const last=await tx.agentMissionStep.aggregate({where:{missionId:id},_max:{ordinal:true}});
    await tx.agentMissionStep.create({data:{missionId:id,ordinal:(last._max.ordinal??0)+1,planRevision:m.planRevision+1,toolName:"bind_project_sources",status:"SUCCEEDED",canonicalInputJson:json(body.sourcePointers),inputHash:hash,readSetJson:json(sources),resultJson:json({data:{questionId:wait.questionId,answer:body.answer,userReviewed:true},sources}),finishedAt:new Date()}});
    await tx.agentMission.update({where:{id},data:{status:"READY",contextVersion:{increment:1},planRevision:{increment:1},version:{increment:1},waitStateJson:json({...wait,resolved:true}),lastErrorJson:{}}});
    await event(tx,id,"INPUT",{questionId:wait.questionId,answer:body.answer,sourcePointers:body.sourcePointers});
    const result={continued:true,questionId:wait.questionId,contextVersion:m.contextVersion+1,planRevision:m.planRevision+1};
    await event(tx,id,"CONTINUATION_READY",result,{id:`cmd:${body.requestId}`,hash});return result;
  });
}
