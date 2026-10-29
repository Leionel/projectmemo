import { z } from "zod";
import { parse } from "csv-parse/sync";
import { AppError } from "@/lib/api";
import { metricRequirementSchema } from "@/lib/mission/gaps";

const conditionKeys = ["dataset", "split", "seed", "evaluationCode", "environment", "phase", "batchSize"] as const;
const condition = z.string().trim().min(1).max(160).nullable();
export const experimentMetricRecordSchema = z.object({
  runId:z.string().trim().min(1).max(100), method:z.string().trim().min(1).max(160),
  metric:metricRequirementSchema.shape.name, value:z.number().finite(), unit:metricRequirementSchema.shape.unit.nullable(), period:metricRequirementSchema.shape.period.nullable(),
  direction:z.enum(["HIGHER_BETTER","LOWER_BETTER"]).nullable(),
  dataset:condition, split:condition, seed:condition, evaluationCode:condition,
  environment:condition, phase:condition, batchSize:condition,
}).strict();
export type MetricRecord = z.infer<typeof experimentMetricRecordSchema>;
const fields = Object.keys(experimentMetricRecordSchema.shape);
/** Exact-condition arithmetic. No unit inference, averaging, significance claim or training execution. */
export function parseMetricRecords(raw:string,format:"JSON"|"CSV"):MetricRecord[]{
  if(Buffer.byteLength(raw,"utf8")>65536)throw new AppError("METRIC_INPUT_LIMIT","指标记录超过64KB，请提供有界副本",422);
  try{
    let rows:unknown;
    if(format==="JSON")rows=JSON.parse(raw);
    else{
      const cells=parse(raw,{bom:true,skip_empty_lines:true,max_record_size:8192}) as string[][];
      const headers=cells.shift()??[];
      if(headers.length!==fields.length||new Set(headers).size!==fields.length||headers.some(h=>!fields.includes(h)))throw new Error("HEADER_INVALID");
      if(cells.length>100)throw new Error("ROW_LIMIT");
      rows=cells.map(row=>{if(row.length!==headers.length)throw new Error("COLUMN_COUNT");return Object.fromEntries(headers.map((key,index)=>{
        const value=row[index].trim();return [key,key==="value"?(value&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)?Number(value):NaN):conditionKeys.includes(key as typeof conditionKeys[number])&&value===""?null:value];
      }));});
    }
    const records=z.array(experimentMetricRecordSchema).min(1).max(100).parse(rows);
    const keys=records.map(r=>JSON.stringify([r.runId,r.metric]));if(new Set(keys).size!==keys.length)throw new Error("DUPLICATE_METRIC");
    return records;
  }catch{throw new AppError("METRIC_FORMAT_INVALID","指标格式不完整或有重复记录；请核对列名、单位、方向和实验条件",422);}
}
export function compareMetricRecords(left:MetricRecord,right:MetricRecord){
  left=experimentMetricRecordSchema.parse(left);right=experimentMetricRecordSchema.parse(right);
  const unknown=([...conditionKeys,"unit","period","direction"] as const).filter(k=>left[k]===null||right[k]===null);
  const mismatched=[...conditionKeys,"metric","unit","period","direction"] .filter(k=>left[k as keyof MetricRecord]!==right[k as keyof MetricRecord]);
  if(unknown.length||mismatched.length)return {state:"NOT_COMPARABLE" as const,unknown,mismatched,delta:null,improvement:null,verification:"REPORTED_INPUTS_NOT_REPRODUCED" as const};
  const delta=right.value-left.value;
  if(!Number.isFinite(delta))throw new AppError("METRIC_ARITHMETIC_OVERFLOW","指标差值超出数值范围",422);
  return {state:"SAME_CONDITIONS" as const,unknown,mismatched,delta,improvement:delta===0?"UNCHANGED" as const:(right.direction==="HIGHER_BETTER"?delta>0:delta<0)?"IMPROVED" as const:"REGRESSED" as const,verification:"REPORTED_INPUTS_NOT_REPRODUCED" as const};
}
