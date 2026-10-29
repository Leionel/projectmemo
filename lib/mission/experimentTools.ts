import { METRIC_IMAGE,METRIC_SCRIPT_HASH,metricJobSchema } from "@/lib/experiments/sandbox";
import { metricComparisonSchema } from "@/lib/types/experiment";
import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { readExperiment } from "@/lib/experiments/reader";
import { experimentToolSchemas,type ExperimentCall } from "@/lib/types/experiment";
import type { ToolSet } from "./tools";
import { fenced,type Lease } from "./runtimeStore";
import { assertInvestigationDelegation } from "./investigationDelegation";
export function experimentTools(lease:Lease):ToolSet{
 if(!isFeatureEnabled("EXPERIMENT_OBSERVER_ENABLED",false))return {};
 const schemas={inspect_experiment_metrics:experimentToolSchemas[0].omit({tool:true,projectId:true}),compare_experiment_metrics:experimentToolSchemas[1].omit({tool:true,projectId:true})};
 const tools:ToolSet={};for(const schema of experimentToolSchemas){const name=schema.shape.tool.value;
  tools[name]={version:"2",description:"读取原JSON/CSV实验记录目录或比较两个run。同条件才计算差值，未知/不同条件不可比；下降保留。不运行训练，不证明本地复现或论文成立。",schema:schemas[name],effects:{businessWrite:false,cacheWrite:false,externalDisclosure:false},run:async(actor,raw)=>{
   await db.$transaction(async tx=>{const m=await fenced(tx,lease);assertInvestigationDelegation(m,name,raw);});
   return readExperiment({userId:actor.userId,missionId:actor.missionId},{...raw as object,tool:name,projectId:actor.projectId} as ExperimentCall);
  }};
 }
 if(isFeatureEnabled("SANDBOX_VERIFICATION_ENABLED",false))tools.propose_metric_verification={version:"1",description:"提出待用户逐项确认的固定算术核算job：只核算已上传两条实验记录，不训练、不执行模型代码、不联网。用户确认镜像、脚本、只读输入与CPU/内存/时间限制后才运行。",schema:metricComparisonSchema,effects:{businessWrite:false,cacheWrite:false,externalDisclosure:false},run:async(actor,raw)=>{
  await db.$transaction(async tx=>{const m=await fenced(tx,lease);assertInvestigationDelegation(m,"propose_metric_verification",raw);});
  const result=await readExperiment({userId:actor.userId,missionId:actor.missionId},{...raw as object,tool:"compare_experiment_metrics",projectId:actor.projectId} as ExperimentCall);
  const data=result.data as unknown as {left:unknown;right:unknown;sourceBindings?:Array<{sourceId:string;mapping:Record<string,string>|null}>};const job=metricJobSchema.parse({schemaVersion:1,image:METRIC_IMAGE,scriptHash:METRIC_SCRIPT_HASH,left:data.left,right:data.right});
  return {...result,data:{...result.data,title:"固定脚本核算两条实验指标",description:"仅在无网、只读输入、非root容器中重算差值；CPU 0.5核 / 内存64MB / 最长8秒，不进行训练或复现实验。"+(data.sourceBindings?.some(s=>s.mapping)?" 列映射："+data.sourceBindings.filter(s=>s.mapping).map(s=>Object.entries(s.mapping!).map(([k,v])=>k+" ← "+v).join("；")).join(" / "):""),sourceBindings:data.sourceBindings,job}};
 }};
 return tools;
}
