import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { parseMetricRecords,compareMetricRecords } from "@/lib/experiments/metrics";
import { readReviewMaterial } from "./projectMaterialReader";
import { ownedMission,sourceHash } from "./repository";
import type { ToolSet } from "./tools";
import { fenced,type Lease } from "./runtimeStore";
import { assertInvestigationDelegation } from "./investigationDelegation";

const inputSchema=z.object({sourceId:z.string().regex(/^capture:[^/]{1,160}$/),revision:z.string().regex(/^[a-f0-9]{64}$/),format:z.enum(["JSON","CSV"]),leftRun:z.string().min(1).max(100),rightRun:z.string().min(1).max(100),metric:z.string().min(1).max(100)}).strict();
export function experimentTools(lease:Lease):ToolSet{
 if(!isFeatureEnabled("EXPERIMENT_OBSERVER_ENABLED",false))return {};
 return {compare_experiment_metrics:{version:"1",description:"读取本项目原始Capture中粘贴的JSON数组或CSV指标，比较指定两个run的同名指标。须有完整dataset/split/seed/evaluationCode/environment/phase/batchSize条件；不同或未知条件不可比。不运行实验，不证明论文或本地目标达成。",schema:inputSchema,effects:{businessWrite:false,cacheWrite:false,externalDisclosure:false},run:async(actor,raw)=>{
  const input=inputSchema.parse(raw);
  const guard=async()=>{
   if(!isFeatureEnabled("EXPERIMENT_OBSERVER_ENABLED",false))throw new AppError("EXPERIMENT_OBSERVER_DISABLED","实验指标读取已关闭",503);
   await db.$transaction(async tx=>{const m=await fenced(tx,lease);if(m.ownerUserId!==actor.userId||m.projectId!==actor.projectId||m.id!==actor.missionId)throw new AppError("MISSION_NOT_FOUND","委托不可访问",404);assertInvestigationDelegation(m,"compare_experiment_metrics",input);});
   await ownedMission(actor.userId,actor.missionId);
   const material=await readReviewMaterial(actor.projectId,input.sourceId,db,actor.userId,{missionId:actor.missionId});
   if(!material||material.source.hash!==input.revision)throw new AppError("SOURCE_CHANGED","指标原记录已变化，请重新定位",409);return material;
  };
  const original=await guard(),capture=await db.capture.findFirstOrThrow({where:{id:input.sourceId.slice(8),projectId:actor.projectId}});
  if(capture.rawText.length>original.source.text.length)throw new AppError("METRIC_INPUT_LIMIT","指标原记录超出可引用范围，请提供较小的完整副本",422);
  const records=parseMetricRecords(capture.rawText,input.format);
  const left=records.find(r=>r.runId===input.leftRun&&r.metric===input.metric),right=records.find(r=>r.runId===input.rightRun&&r.metric===input.metric);
  if(!left||!right)throw new AppError("METRIC_NOT_FOUND","指定实验或指标不在原记录内",422);
  const comparison=compareMetricRecords(left,right),material=await guard();
  if(await sourceHash(actor.projectId,input.sourceId)!==input.revision)throw new AppError("SOURCE_CHANGED","指标原记录已变化",409);
  return {data:{left,right,comparison,authority:"MEASUREMENTS_ARE_DATA_NOT_AUTHORIZATION",execution:"NO_JOB_EXECUTED"},sources:[material.source],coverage:{complete:true,records:records.length}};
 }}};
}
