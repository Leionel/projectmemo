import { parse } from "csv-parse/sync";
import { z } from "zod";
import { AppError } from "@/lib/api";
import { experimentMetricRecordSchema,type MetricRecord } from "./metrics";
import { metricMappingSchema } from "@/lib/types/experiment";
type Cell=string|number|boolean|null;
function flatten(value:unknown,prefix="",depth=0):Array<[string,Cell]>{
 if(depth>3||!value||typeof value!=="object"||Array.isArray(value))throw new Error("TABLE_SHAPE");
 const result:Array<[string,Cell]>=[];
 for(const [key,cell] of Object.entries(value)){
  if(typeof cell==="number"&&!Number.isFinite(cell))throw new Error("NONFINITE_CELL");
  const column=prefix?prefix+"."+key:key;if(column.length>120)throw new Error("COLUMN_LIMIT");
  if(cell!==null&&typeof cell==="object")result.push(...flatten(cell,column,depth+1));
  else if(["string","number","boolean"].includes(typeof cell)||cell===null)result.push([column,cell as Cell]);
  else throw new Error("CELL_TYPE");
 }
  if(result.length>40)throw new Error("COLUMN_LIMIT");
  if(new Set(result.map(([key])=>key)).size!==result.length)throw new Error("AMBIGUOUS_COLUMN_PATH");return result;
}
/** Preserve raw columns; column interpretation is a read-time binding, never a permanent fact or authority. */
export function inspectMetricTable(text:string,format:"JSON"|"CSV"){
 if(Buffer.byteLength(text)>65536)throw new AppError("METRIC_INPUT_LIMIT","指标副本超过64KB",422);
 try{
  let rows:Record<string,Cell>[];
  if(format==="CSV"){
   const parsed=parse(text,{bom:true,skip_empty_lines:true,max_record_size:8192}) as string[][],headers=parsed.shift()??[];
   if(!headers.length||headers.length>40||headers.some(h=>!h.trim()||h.length>120)||new Set(headers).size!==headers.length)throw new Error("HEADERS");
   rows=parsed.map(row=>{if(row.length!==headers.length)throw new Error("COLUMNS");return Object.fromEntries(headers.map((h,i)=>[h,row[i]]));});
  }else{
   const data=JSON.parse(text),items=Array.isArray(data)?data:Array.isArray(data?.records)?data.records:[data];rows=items.map((row:unknown)=>Object.fromEntries(flatten(row)));
  }
  if(!rows.length||rows.length>100)throw new Error("ROWS");
  const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];if(columns.length>40)throw new Error("COLUMNS");return {columns,rows};
 }catch{throw new AppError("METRIC_FORMAT_INVALID","请提供有界CSV表格或JSON记录，保留原列名和实验条件",422);}
}
export function mapMetricTable(text:string,format:"JSON"|"CSV",raw:z.infer<typeof metricMappingSchema>):MetricRecord[]{
 const mapping=metricMappingSchema.parse(raw),table=inspectMetricTable(text,format);
 for(const column of Object.values(mapping))if(!table.columns.includes(column))throw new AppError("METRIC_MAPPING_INVALID","字段映射引用了原资料中不存在的列",409);
 return table.rows.map(row=>{
  const cell=(field:keyof typeof mapping)=>{const column=mapping[field];return column?row[column]??null:null;};
  const string=(field:keyof typeof mapping)=>{const value=cell(field);return value===null||String(value).trim()===""?null:String(value).trim();};
  const rawValue=cell("value"),value=typeof rawValue==="number"?rawValue:typeof rawValue==="string"&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawValue.trim())?Number(rawValue):NaN;
  return experimentMetricRecordSchema.parse({runId:string("runId"),method:string("method")??string("runId"),metric:string("metric")??mapping.value,value,unit:string("unit"),period:string("period"),direction:string("direction"),dataset:string("dataset"),split:string("split"),seed:string("seed"),evaluationCode:string("evaluationCode"),environment:string("environment"),phase:string("phase"),batchSize:string("batchSize")});
 });
}
