import { effectiveContinuity, assertContinuityBinding } from "@/lib/continuity/directiveService";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { defaultBudget, json, jsonHash, usageOf, type Source } from "./contracts";
import { commandReplay, event, lock, ownedMission, type Tx } from "./repository";
import { gapRequirementsSchema, sourcePointerSchema, type WaitState, parseMetricRecord } from "./gaps";
import { readProjectMaterial,readProjectMaterialView,scanWaitingMaterialBatch } from "./sourceSignals";
import { requireMissions } from "./missionService";
import { materialTemporalStates } from "./readSetValidator";
import { evidenceReviewSchema } from "@/lib/types/missionEvidenceFit";
import { assessEvidenceFit, requireFitReview, recordFitReview, fitSourceClass, fitSourceScopes } from "./evidenceFitService";
type ContinuationResult={continued:boolean;questionId:string;reason?:string;contextVersion?:number;planRevision?:number};

const previewSchema=z.object({questionId:z.string(),sourcePointers:z.array(sourcePointerSchema).min(1).max(8).refine(p=>new Set(p.map(s=>s.id)).size===p.length,"材料不能重复选择"),evidenceReview:evidenceReviewSchema.optional()}).strict();
const confirmSchema=previewSchema.extend({requestId:z.string().min(1).max(128),expectedVersion:z.number().int().positive(),expectedContextVersion:z.number().int().positive(),assessmentHash:z.string(),fitHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),answer:z.string().trim().min(1).max(3000),confirmedGap:z.literal(true)}).strict();
function materialPreviewText(text:string){const record=parseMetricRecord(text);return record?.success?`${record.data.name}：${record.data.value} ${record.data.unit}（${record.data.period}，本项目实验，用户提供）`:text;}
function enabled(){requireMissions();if(!isFeatureEnabled("MISSION_EVENT_CONTINUATION_ENABLED",false))throw new AppError("CONTINUATION_DISABLED","材料接续尚未启用，可直接补充当前问题",503);}
async function assess(userId:string,id:string,body:z.infer<typeof previewSchema>,tx:Tx){
  const m=await ownedMission(userId,id,tx),wait=m.waitStateJson as unknown as WaitState|null;
  if(m.status!=="WAITING_INPUT"||wait?.questionId!==body.questionId||m.cancelRequestedAt||m.pauseRequestedAt)throw new AppError("INPUT_CHANGED","等待问题已变化，请刷新",409);
  const requirements=gapRequirementsSchema.parse(wait.requirements??{}),sources:Source[]=[];
  const pointers = requirements.evidenceFitV1 ? [...body.sourcePointers].sort((a,b)=>a.id.localeCompare(b.id)) : body.sourcePointers;
  for(const pointer of pointers){const source=await readProjectMaterial(m.projectId,pointer.id,tx);if(!source||source.hash!==pointer.hash)throw new AppError("SOURCE_CHANGED","材料已变化或不可访问，请重新选择",409);await assertSourceUse(userId,m.projectId,pointer.id,tx,{missionId:id});sources.push(source);}
  const readable=sources.every(s=>!!s.text.trim()),text=sources.map(s=>s.text).join("\n");
  const checks=[...requirements.terms,...(requirements.unit?[requirements.unit]:[]),...(requirements.period?[requirements.period]:[])].map(term=>({term,present:text.toLowerCase().includes(term.toLowerCase())}));
  if(requirements.unit){const escaped=requirements.unit.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");checks.push({term:`指标数值（${requirements.unit}）`,present:new RegExp(`[-+]?\\d+(?:\\.\\d+)?\\s*${escaped}`,"i").test(text)});}
  const metric=requirements.metric;
  const records=sources.map(source=>parseMetricRecord(source.text));
  const structuredMatch=!!metric&&records.length>0&&records.every(record=>record?.success&&record.data.projectId===m.projectId&&record.data.name===metric.name&&record.data.unit===metric.unit&&record.data.period===metric.period);
  const structuredConflict=structuredMatch&&new Set(records.flatMap(r=>r?.success?[r.data.value]:[])).size>1;
  const typeMatches=sources.every(s=>requirements.sourceType==="EITHER"||s.entityType===requirements.sourceType);
  const relevance=readable&&typeMatches&&checks.some(c=>c.present)?"RELATED":"UNKNOWN";
  const temporalStates=await materialTemporalStates(m.projectId,sources,tx);
  const blocked=temporalStates.some(s=>s.state==="SUPERSEDED"||s.state==="CONTESTED");
  const assessment=!readable||!typeMatches?"INSUFFICIENT":wait.missing==="CONFLICT"||blocked||structuredConflict?"CONFLICT":structuredMatch&&checks.every(c=>c.present)?"SUFFICIENT":structuredMatch?"INSUFFICIENT":!checks.length?"UNKNOWN":checks.every(c=>c.present)?"SUFFICIENT":"INSUFFICIENT";
  const fit=await assessEvidenceFit(tx,m,wait,sources,body.evidenceReview);
  if(!fit&&body.evidenceReview)throw new AppError("FIT_NOT_AVAILABLE","此历史问题不含新版核对条件，请按原补料流程继续",409);
  const continuity = await effectiveContinuity(userId,{projectId:m.projectId,missionId:id},tx);
  const value={continuity:{intentHash:continuity.intentHash,reusePolicyHash:continuity.reusePolicyHash},questionId:wait.questionId,gapId:wait.gapId,version:m.version,contextVersion:m.contextVersion,constraintsVersion:m.constraintsVersion,scopeVersion:m.researchScopeVersion,sourcePointers:pointers,relevance,assessment,readable,checks,structuredMatch,structuredConflict,temporalStates,sourceTypeMatches:typeMatches,semanticVerification:"NOT_CHECKED",remaining:checks.filter(c=>!c.present).map(c=>c.term),...(fit?{evidenceFit:fit.evidenceFit,fitHash:fit.fitHash,review:fit.review}: {})};
  return{m,wait,sources,value,fit,assessmentHash:jsonHash(value)};
}
export async function previewContinuation(userId:string,id:string,raw:unknown){return db.$transaction(tx=>previewContinuationInTx(tx,userId,id,raw));}
export async function previewContinuationInTx(tx:Tx,userId:string,id:string,raw:unknown){enabled();const body=previewSchema.parse(raw);const a=await assess(userId,id,body,tx);return{...a.value,assessmentHash:a.assessmentHash,materials:a.sources.map(s=>({id:s.id,text:materialPreviewText(s.text).slice(0,3000),hash:s.hash})),...(a.fit?{observationExcerpts:a.fit.evidenceFit.groups.map(g=>{const source=a.sources.find(s=>s.id===g.sourceId)!,span=g.spans[0];return{sourceId:source.id,hash:source.hash,revision:source.revision,observationGroup:g.observationGroup,...span,text:source.text.slice(span.start,span.end).slice(0,1500),truncated:span.end-span.start>1500};})}:{})};}
const candidateQuerySchema=z.object({
 questionId:z.string().min(1).max(180).optional(),
 sourceId:z.string().min(9).max(180).refine(id=>id.startsWith("capture:")||id.startsWith("attachment:"),"请选择项目记录或附件").optional(),
 includeExisting:z.literal("1").optional(),
}).strict().refine(q=>(!q.sourceId&&!q.includeExisting)||!!q.questionId,"定向选择资料需要原问题编号");
export async function listContinuationCandidates(userId:string,id:string,raw:unknown={}){
 const query=candidateQuerySchema.parse(raw);
 return db.$transaction(async tx=>{
  const m=await ownedMission(userId,id,tx),wait=m.waitStateJson as unknown as WaitState|null;
  if(query.questionId&&(m.status!=="WAITING_INPUT"||wait?.questionId!==query.questionId||m.cancelRequestedAt||m.pauseRequestedAt))throw new AppError("INPUT_CHANGED","原问题已变化，请返回原委托核对；不会提交给另一项问题",409);
  if(m.status!=="WAITING_INPUT"||!wait?.questionId)return{candidates:[]};
  const events=await tx.agentMissionEvent.findMany({where:{missionId:id,type:"SOURCE_ARRIVED"},orderBy:{seq:"desc"},take:80});
  const pointers=new Map<string,{id:string;hash?:string}>();
  if(query.sourceId)pointers.set(query.sourceId,{id:query.sourceId});
  for(const e of events){const payload=e.payloadJson as {questionId:string;sourcePointer:{id:string;hash:string}};if(payload.questionId===wait.questionId&&!pointers.has(payload.sourcePointer.id))pointers.set(payload.sourcePointer.id,payload.sourcePointer);}
  if(query.includeExisting){
   const [captures,attachments]=await Promise.all([
    tx.capture.findMany({where:{projectId:m.projectId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:12,select:{id:true}}),
    tx.attachment.findMany({where:{projectId:m.projectId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:12,select:{id:true}}),
   ]);
   for(const row of captures)if(!pointers.has(`capture:${row.id}`))pointers.set(`capture:${row.id}`,{id:`capture:${row.id}`});
   for(const row of attachments)if(!pointers.has(`attachment:${row.id}`))pointers.set(`attachment:${row.id}`,{id:`attachment:${row.id}`});
  }
  const limit=query.includeExisting?24:81,candidates=[];
  for(const pointer of [...pointers.values()].slice(0,limit)){
   const view=await readProjectMaterialView(m.projectId,pointer.id,tx);
   if(!view){if(pointer.id===query.sourceId)throw new AppError("SOURCE_NOT_FOUND","资料不存在或不可访问",404);continue;}
   try{await assertSourceUse(userId,m.projectId,pointer.id,tx,{missionId:id});}catch(error){if(error instanceof AppError && pointer.id!==query.sourceId)continue;throw error;}
   const s=view.source;
   if(pointer.hash&&s.hash!==pointer.hash&&!query.includeExisting)continue;
   candidates.push({sourcePointer:{id:s.id,hash:s.hash},readable:!!s.text.trim(),excerpt:materialPreviewText(s.text).slice(0,400),observedAt:s.observedAt,title:view.title,coverage:view.coverage});
  }
  return{candidates,coverage:{limit,truncated:pointers.size>limit,existingLimit:query.includeExisting?12:0}};
 });
}
export async function confirmContinuation(userId:string,id:string,raw:unknown,transaction?:Tx):Promise<ContinuationResult>{
  enabled();const body=confirmSchema.parse(raw);if(body.evidenceReview)body.sourcePointers.sort((a,b)=>a.id.localeCompare(b.id));const hash=jsonHash(body);
  const apply=async (tx:Tx)=>{
    await lock(tx,id);await ownedMission(userId,id,tx);
    const replay=await commandReplay(tx,id,body.requestId,hash);if(replay)return replay.payloadJson as unknown as ContinuationResult;
    const a=await assess(userId,id,body,tx),{m,wait}=a;
    for (const source of a.sources) await assertSourceUse(userId,m.projectId,source.id,tx,{missionId:id});
    if(m.version!==body.expectedVersion||m.contextVersion!==body.expectedContextVersion||a.assessmentHash!==body.assessmentHash)throw new AppError("ASSESSMENT_CHANGED","评估已变化，请重新预览",409);
    if(a.fit){requireFitReview(a.fit,body.evidenceReview);if(body.fitHash!==a.fit.fitHash)throw new AppError("FIT_CHANGED","核对条件、用途或资料已变化，请重新预览",409);}
    const budget={...defaultBudget,...m.budgetJson as object},used=usageOf(m.budgetUsedJson);
    const canRun=!Object.entries(budget).some(([key,value])=>used[key as keyof typeof used]>=value);
    const sufficient=a.fit?body.evidenceReview!.mode!=="BACKGROUND_ONLY"&&a.value.readable&&a.value.sourceTypeMatches:a.value.assessment==="SUFFICIENT"||a.value.assessment==="UNKNOWN"&&a.value.readable&&a.value.sourceTypeMatches;
    const fitEvent=a.fit?await recordFitReview(tx,m,a.fit,body.evidenceReview!):null;
    await event(tx,id,"SOURCE_ASSOCIATED",{questionId:wait.questionId,pointers:body.sourcePointers,basis:"USER_REVIEWED",relevance:a.value.relevance});
    await event(tx,id,"GAP_ASSESSED",{...a.value,userConfirmed:true,answer:body.answer});
    const authorized=(m.constraintsJson as {llmContextApproved?:boolean}).llmContextApproved===true;
    if(!sufficient||!canRun||!authorized){const result={continued:false,reason:!authorized?"LLM_CONTEXT_NOT_APPROVED":!canRun?"BUDGET_EXHAUSTED":a.fit&&body.evidenceReview?.mode==="BACKGROUND_ONLY"?"BACKGROUND_ONLY":a.value.assessment,questionId:wait.questionId};await event(tx,id,"CONTINUATION_HELD",result,{id:`cmd:${body.requestId}`,hash});return result;}
    return resumeWithMaterials(tx,a,body,hash,"MANUAL",fitEvent?.id);
  };
  return transaction?apply(transaction):db.$transaction(apply);
}

async function resumeWithMaterials(tx:Tx,a:Awaited<ReturnType<typeof assess>>,body:{sourcePointers:Array<{id:string;hash:string}>;answer:string;requestId:string},hash:string,mode:"MANUAL"|"AUTO",fitEventId?:string){
  const {m,wait,sources}=a,id=m.id;
  const continuity = await effectiveContinuity(m.ownerUserId,{projectId:m.projectId,missionId:id},tx);
  if(mode==="AUTO")await assertContinuityBinding(m.ownerUserId,{projectId:m.projectId,missionId:id},(m.planJson as {continuityBinding?:unknown}).continuityBinding,tx);
  const bindingSources=a.fit?sources.map(s=>({...s,knowledgeClass:fitSourceClass(a.fit!,s.id),observationScopes:fitSourceScopes(a.fit!,s.id)})):sources;
    // Existing completed history stays immutable. Only unexecuted work from the old plan is retired.
    const pending=await tx.agentMissionStep.findMany({where:{missionId:id,status:{in:["READY","WAITING_APPROVAL","RUNNING"]}}});
    const related=pending.filter(s=>!Array.isArray(s.readSetJson)||(s.readSetJson as unknown as Source[]).length===0||(s.readSetJson as unknown as Source[]).some(old=>sources.some(now=>old.id===now.id||old.id===`project:${m.projectId}`)));
    if(related.length){await tx.agentMissionApproval.updateMany({where:{missionId:id,stepId:{in:related.map(s=>s.id)},status:{in:["PENDING","APPROVED"]}},data:{status:"EXPIRED"}});await tx.agentMissionStep.updateMany({where:{id:{in:related.map(s=>s.id)}},data:{status:"OBSOLETE"}});}
    const last=await tx.agentMissionStep.aggregate({where:{missionId:id},_max:{ordinal:true}});
    await tx.agentMissionStep.create({data:{missionId:id,ordinal:(last._max.ordinal??0)+1,planRevision:m.planRevision+1,toolName:"bind_project_sources",status:"SUCCEEDED",canonicalInputJson:json(body.sourcePointers),inputHash:hash,readSetJson:json(sources),resultJson:json({data:{questionId:wait.questionId,answer:body.answer,userReviewed:mode==="MANUAL",continuationMode:mode,...(a.fit?{evidenceFitEventId:fitEventId,evidenceFit:a.fit}: {})},sources:bindingSources}),finishedAt:new Date()}});
    await tx.agentMission.update({where:{id},data:{status:"READY",contextVersion:{increment:1},planRevision:{increment:1},version:{increment:1},waitStateJson:json({...wait,resolved:true,...(a.fit?{evidenceFitReview:a.fit,evidenceFitEventId:fitEventId}: {})}),planJson:json({...m.planJson as object,continuityBinding:{intentHash:continuity.intentHash,reusePolicyHash:continuity.reusePolicyHash},automaticContinuation:mode==="AUTO"?{policyHash:jsonHash(m.continuationPolicyJson),questionId:wait.questionId,metric:wait.requirements.metric,startedAt:wait.startedAt,sourcePointers:body.sourcePointers}:null}),lastErrorJson:{}}});
    await event(tx,id,"INPUT",{questionId:wait.questionId,answer:body.answer,sourcePointers:body.sourcePointers});
    const result={continued:true,mode,questionId:wait.questionId,contextVersion:m.contextVersion+1,planRevision:m.planRevision+1};
    await event(tx,id,mode==="AUTO"?"AUTO_CONTINUATION_READY":"CONTINUATION_READY",result,{id:`cmd:${body.requestId}`,hash});return result;
}

/** No model call: only a single, typed local metric record can deterministically close a metric gap. */
export async function automaticallyContinueWaitingMissions(limit=8,missionIds?:string[]){
 if(!isFeatureEnabled("MISSION_ENABLED",false)||!isFeatureEnabled("MISSION_EVENT_CONTINUATION_ENABLED",false)||!isFeatureEnabled("MISSION_AUTO_CONTINUATION_ENABLED",false))return 0;
 const missions=await db.agentMission.findMany({where:{status:"WAITING_INPUT",cancelRequestedAt:null,pauseRequestedAt:null,...(missionIds?{id:{in:missionIds}}:{})},orderBy:{updatedAt:"asc"},take:limit});let continued=0;
 for(const candidate of missions)await db.$transaction(async tx=>{
  await lock(tx,candidate.id);const m=await ownedMission(candidate.ownerUserId,candidate.id,tx).catch(()=>null);
  if(!m||m.status!=="WAITING_INPUT"||m.cancelRequestedAt||m.pauseRequestedAt||(m.continuationPolicyJson as {mode?:string}).mode!=="LOW_RISK_READ_ANALYZE")return;
  const wait=m.waitStateJson as unknown as WaitState|null;if(!wait?.requirements?.metric||wait.requirements.evidenceFitV1||wait.missing==="CONFLICT")return;
  const constraints=m.constraintsJson as {llmContextApproved?:boolean;costCeiling?:unknown};
  if(!constraints.llmContextApproved||constraints.costCeiling)return;
  const limits={...defaultBudget,...m.budgetJson as object},used=usageOf(m.budgetUsedJson);
  if(Object.entries(limits).some(([key,value])=>used[key as keyof typeof used]>=value))return;
  const signals=await tx.agentMissionEvent.findMany({where:{missionId:m.id,type:"SOURCE_ARRIVED"},orderBy:{seq:"desc"},take:80});
  const pointers=new Map<string,{id:string;hash:string}>();
  for(const signal of signals){const payload=signal.payloadJson as {questionId:string;sourcePointer:{id:string;hash:string}};
   if(payload.questionId!==wait.questionId)continue;
   const source=await readProjectMaterial(m.projectId,payload.sourcePointer.id,tx);if(!source||source.hash!==payload.sourcePointer.hash)continue;
   const parsed=parseMetricRecord(source.text);if(!parsed?.success)continue;
   const record=parsed.data,metric=wait.requirements.metric;
   if(record.projectId!==m.projectId||record.name!==metric.name||record.unit!==metric.unit||record.period!==metric.period)continue;
   // Sources predating the question may be offered for human review, but cannot trigger background continuation.
   if(new Date(source.observedAt)<new Date(wait.startedAt))continue;
   pointers.set(source.id,payload.sourcePointer);
  }
  if(!pointers.size||pointers.size>8)return;
  const body={questionId:wait.questionId,sourcePointers:[...pointers.values()]};const a=await assess(m.ownerUserId,m.id,body,tx);
  const key=`auto:${jsonHash({questionId:wait.questionId,pointers:body.sourcePointers,policy:m.continuationPolicyJson,contextVersion:m.contextVersion})}`;
  if(await tx.agentMissionEvent.findUnique({where:{missionId_commandRequestId:{missionId:m.id,commandRequestId:`cmd:${key}`}}}))return;
  if(a.value.assessment!=="SUFFICIENT"||!a.value.structuredMatch||!a.value.sourceTypeMatches){await event(tx,m.id,"AUTO_CONTINUATION_HELD",{questionId:wait.questionId,assessment:a.value.assessment},{id:`cmd:${key}`,hash:a.assessmentHash});return;}
  await event(tx,m.id,"SOURCE_ASSOCIATED",{...body,basis:"EXACT_STRUCTURED_METRIC",relevance:a.value.relevance});
  await event(tx,m.id,"GAP_ASSESSED",{...a.value,userConfirmed:false,policy:m.continuationPolicyJson});
  await resumeWithMaterials(tx,a,{...body,requestId:key,answer:"已收到与当前缺口字段完全匹配的用户实验记录；数据含义与现实结果尚未核验。"},a.assessmentHash,"AUTO");continued++;
 });
 return continued;
}

export async function processMaterialContinuationBatch(limit=8){const batch=await scanWaitingMaterialBatch(limit);return{signals:batch.signals,continued:await automaticallyContinueWaitingMissions(limit,batch.missionIds)};}
