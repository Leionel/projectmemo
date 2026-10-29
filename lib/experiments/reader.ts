import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertProject } from "@/lib/conversation/repository";
import { ownedMission,sourceHash } from "@/lib/mission/repository";
import { readReviewMaterial } from "@/lib/mission/projectMaterialReader";
import { effectiveContinuity,assertContinuityBinding } from "@/lib/continuity/directiveService";
import { readAttachmentFile } from "@/lib/storage/attachmentStorage";
import { parseMetricRecords,compareMetricRecords,type MetricRecord } from "./metrics";
import { inspectMetricTable,mapMetricTable } from "./table";
import type { ConversationActor } from "@/lib/types/conversation";
import { experimentToolSchemas,metricSourceSchema,type ExperimentCall } from "@/lib/types/experiment";
import { z } from "zod";
type Actor={userId:string;sessionId?:string;missionId?:string;conversationId?:string};
async function load(actor:Actor,projectId:string,input:z.infer<typeof metricSourceSchema>){
 const scope={projectId,missionId:actor.missionId,conversationId:actor.conversationId},binding=await effectiveContinuity(actor.userId,scope);
 const guard=async()=>{
  if(!isFeatureEnabled("EXPERIMENT_OBSERVER_ENABLED",false))throw new AppError("EXPERIMENT_OBSERVER_DISABLED","实验指标读取已关闭",503);
  if(actor.sessionId)await assertProject(actor as ConversationActor,projectId);
  else if(!actor.missionId||(await ownedMission(actor.userId,actor.missionId)).projectId!==projectId)throw new AppError("PROJECT_NOT_FOUND","项目不可访问",404);
  await assertContinuityBinding(actor.userId,scope,binding);
  const material=await readReviewMaterial(projectId,input.sourceId,db,actor.userId,scope);
  if(!material||material.source.hash!==input.revision)throw new AppError("SOURCE_CHANGED","指标原记录已变化，请重新定位",409);return material;
 };
 const material=await guard();let text:string;
 if(input.sourceId.startsWith("capture:"))text=(await db.capture.findFirstOrThrow({where:{id:input.sourceId.slice(8),projectId}})).rawText;
 else{
  const attachment=await db.attachment.findFirstOrThrow({where:{id:input.sourceId.slice(11),projectId}});
  if(!["CSV","JSON"].includes(attachment.type)||attachment.type!==input.format)throw new AppError("METRIC_FORMAT_INVALID","请选择对应格式的指标文件",422);
  const bytes=await readAttachmentFile(attachment.storageKey);
  if(createHash("sha256").update(bytes).digest("hex")!==attachment.sha256)throw new AppError("SOURCE_CHANGED","指标原文件哈希不一致",409);
  text=material.source.text;
 }
 if(text.length>material.source.text.length||actor.conversationId&&text.length>5000)throw new AppError("METRIC_INPUT_LIMIT","原指标超出本轮可引用范围，请提供较小的完整副本",422);
 return {text,material,guard,input};
}
function records(source:Awaited<ReturnType<typeof load>>){
 try{return source.input.mapping?mapMetricTable(source.text,source.input.format,source.input.mapping):parseMetricRecords(source.text,source.input.format);}
 catch(error){if(error instanceof AppError&&error.code==="METRIC_MAPPING_INVALID")throw error;throw new AppError("METRIC_MAPPING_REQUIRED","原表不是标准指标记录，请先检查列名，再按原列建立映射；缺少条件保持未知",422);}
}
export async function readExperiment(actor:Actor,raw:ExperimentCall){
 const call=z.discriminatedUnion("tool",experimentToolSchemas).parse(raw),leftSource=await load(actor,call.projectId,call),all=[leftSource];let data:object;
 if(call.tool==="inspect_experiment_metrics"){
  try{const rows=records(leftSource);data={records:rows,comparison:null,mappingRequired:false};}
  catch{const table=inspectMetricTable(leftSource.text,call.format);data={columns:table.columns,rowCount:table.rows.length,samples:table.rows.slice(0,12).map((row,index)=>({rowIndex:index,values:Object.fromEntries(Object.entries(row).slice(0,12).map(([k,v])=>[k,typeof v==="string"?v.slice(0,120):v]))})),truncated:table.rows.length>12||table.columns.length>12,mappingRequired:true,note:"映射必须选择原列；未提供的单位、方向与实验条件保持未知"};}
 }else{
  const rightSource=call.rightSource?await load(actor,call.projectId,call.rightSource):leftSource;if(rightSource!==leftSource)all.push(rightSource);
  const choose=(rows:MetricRecord[],runId:string,index?:number)=>{const matches=index===undefined?rows.filter(r=>r.runId===runId&&r.metric===call.metric):[rows[index]].filter(r=>r&&r.runId===runId&&r.metric===call.metric);if(matches.length!==1)throw new AppError(matches.length?"METRIC_SELECTION_AMBIGUOUS":"METRIC_NOT_FOUND","指标选择不唯一或不存在，请核对原行号、run和指标",422);return matches[0];};
  const left=choose(records(leftSource),call.leftRun,call.leftRow),right=choose(records(rightSource),call.rightRun,call.rightRow);data={left,right,comparison:compareMetricRecords(left,right)};
 }
 for(const source of all){await source.guard();if(await sourceHash(call.projectId,source.input.sourceId)!==source.input.revision)throw new AppError("SOURCE_CHANGED","指标原记录已变化",409);}
 return {data:{...data,sourceBindings:all.map(s=>({sourceId:s.input.sourceId,revision:s.input.revision,mapping:s.input.mapping??null})),authority:"MEASUREMENTS_ARE_DATA_NOT_AUTHORIZATION",interpretation:"SOURCE_COLUMN_BINDINGS_REFERENCE_ONLY",execution:"NO_JOB_EXECUTED"},sources:[...new Map(all.map(s=>[s.material.source.id,s.material.source])).values()],coverage:{complete:true,sourceCount:all.length}};
}
