import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { experimentMetricRecordSchema,compareMetricRecords } from "./metrics";

// Official Docker Hub manifest digest, resolved 2026-10-29; never accept an image/command from a model.
export const METRIC_IMAGE="python@sha256:8bcfa47b04b853a17aaf909362b847b2112fd6ec4105ea553ef9a43bafbb5916";
export const METRIC_SCRIPT=`import json,math
with open('/input/data.json',encoding='utf-8') as f: d=json.load(f)
a,b=d['left'],d['right']
keys=['dataset','split','seed','evaluationCode','environment','phase','batchSize']
unknown=[k for k in keys+['unit','period','direction'] if a[k] is None or b[k] is None]
mismatch=[k for k in keys+['metric','unit','period','direction'] if a[k]!=b[k]]
delta=None if unknown or mismatch else b['value']-a['value']
if delta is not None and not math.isfinite(delta): raise ValueError('nonfinite')
print(json.dumps({'state':'NOT_COMPARABLE' if unknown or mismatch else 'SAME_CONDITIONS','delta':delta,'unknown':unknown,'mismatched':mismatch,'verification':'FIXED_ARITHMETIC_RECOMPUTATION_NOT_EXPERIMENT_REPRODUCTION'},allow_nan=False))
`;
export const METRIC_SCRIPT_HASH=createHash("sha256").update(METRIC_SCRIPT).digest("hex");
export const metricJobSchema=z.object({schemaVersion:z.literal(1),image:z.literal(METRIC_IMAGE),scriptHash:z.literal(METRIC_SCRIPT_HASH),left:experimentMetricRecordSchema,right:experimentMetricRecordSchema}).strict();
export type MetricJob=z.infer<typeof metricJobSchema>;
export type DockerCommand=(args:string[],timeoutMs?:number)=>Promise<string>;
export const dockerCommand:DockerCommand=(args,timeoutMs=12000)=>new Promise((resolve,reject)=>{
 const child=spawn("docker",args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});const chunks:Buffer[]=[];let bytes=0,done=false;
 const fail=(code:string)=>{if(done)return;done=true;clearTimeout(timer);child.kill();reject(new AppError(code,"容器操作结果未确认，请核对原job；不会重发创建",409));};
 const timer=setTimeout(()=>fail("SANDBOX_RESULT_UNKNOWN"),timeoutMs);
 child.stdout.on("data",(data:Buffer)=>{bytes+=data.length;if(bytes>65536)fail("SANDBOX_RESULT_LIMIT");else chunks.push(data);});child.stderr.on("data",()=>{});
 child.on("error",()=>fail("SANDBOX_UNAVAILABLE"));child.on("close",code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)reject(new AppError("SANDBOX_COMMAND_FAILED","容器操作未成功，请核对原job及本地沙箱环境",409));else resolve(Buffer.concat(chunks).toString("utf8").trim());});
});
export function metricJobName(effectKey:string){return "pm-metric-"+jsonHash(effectKey).slice(0,32);}
export async function prepareMetricJobFiles(effectKey:string,raw:MetricJob){
 const job=metricJobSchema.parse(raw),name=metricJobName(effectKey),directory=path.resolve("tmp","metric-jobs",name),data=JSON.stringify({left:job.left,right:job.right});
 await fs.mkdir(directory,{recursive:true});
 for(const [file,content] of [["verify.py",METRIC_SCRIPT],["data.json",data]]){
  const target=path.join(directory,file);try{await fs.writeFile(target,content,{flag:"wx",mode:0o444});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST"||await fs.readFile(target,"utf8")!==content)throw new AppError("SANDBOX_INPUT_CHANGED","核算副本或固定脚本已变化，禁止执行",409);}
 }
 return {name,directory,inputHash:jsonHash({left:job.left,right:job.right})};
}
export async function createMetricContainer(effectKey:string,job:MetricJob,run:DockerCommand=dockerCommand){
 const prepared=await prepareMetricJobFiles(effectKey,job);
 const args=["create","--pull=never","--name",prepared.name,"--network=none","--read-only","--user=65534:65534","--cap-drop=ALL","--security-opt=no-new-privileges","--pids-limit=32","--cpus=0.5","--memory=64m","--memory-swap=64m","--label","projectmemo.input="+prepared.inputHash,"--label","projectmemo.script="+METRIC_SCRIPT_HASH,"--label","projectmemo.effect="+jsonHash(effectKey),"--mount",`type=bind,source=${prepared.directory},target=/input,readonly`,METRIC_IMAGE,"timeout","-s","KILL","8","python","-I","-B","/input/verify.py"];
 const id=await run(args);if(!/^[a-f0-9]{64}$/.test(id))throw new AppError("SANDBOX_RESULT_UNKNOWN","未取得可靠的容器身份，请核对原job",409);return {id,...prepared};
}
/** Reconciliation inspects the same named job. It never creates or restarts a missing/unknown job. */
export async function readMetricContainerIdentity(effectKey:string,job:MetricJob,run:DockerCommand=dockerCommand){
 const name=metricJobName(effectKey),rows=JSON.parse(await run(["inspect",name])),container=rows[0];
 if(!container||container.Config?.Image!==METRIC_IMAGE||container.Config?.Labels?.["projectmemo.effect"]!==jsonHash(effectKey)||container.Config?.Labels?.["projectmemo.input"]!==jsonHash({left:job.left,right:job.right})||container.Config?.Labels?.["projectmemo.script"]!==METRIC_SCRIPT_HASH||container.HostConfig?.NetworkMode!=="none"||container.HostConfig?.ReadonlyRootfs!==true||container.Config?.User!=="65534:65534")throw new AppError("SANDBOX_IDENTITY_CHANGED","原job身份、输入或隔离配置不一致",409);
 if(container.HostConfig?.Memory!==67108864||container.HostConfig?.MemorySwap!==67108864||container.HostConfig?.NanoCpus!==500000000||container.HostConfig?.PidsLimit!==32||container.HostConfig?.Privileged||!container.HostConfig?.CapDrop?.includes("ALL")||!container.HostConfig?.SecurityOpt?.includes("no-new-privileges")||container.Mounts?.length!==1||container.Mounts[0].Destination!=="/input"||container.Mounts[0].RW!==false||JSON.stringify(container.Config?.Cmd)!==JSON.stringify(["timeout","-s","KILL","8","python","-I","-B","/input/verify.py"]))throw new AppError("SANDBOX_IDENTITY_CHANGED","原job资源限制、命令或只读挂载不一致",409);
 return container;
}
export async function inspectMetricContainer(effectKey:string,job:MetricJob,run:DockerCommand=dockerCommand){
 const name=metricJobName(effectKey),container=await readMetricContainerIdentity(effectKey,job,run);
 if(container.State?.Running||!container.State?.FinishedAt||container.State.FinishedAt.startsWith("0001"))throw new AppError("SANDBOX_RESULT_UNKNOWN","原job尚未结算，请稍后核对同一job",409);
 if(container.State.ExitCode!==0)throw new AppError("SANDBOX_JOB_FAILED","固定核算job失败，失败回执已保留；没有训练或重试",422,{jobName:name,containerId:container.Id,exitCode:container.State.ExitCode,finishedAt:container.State.FinishedAt});
 const output=await run(["logs",name]),parsed=z.object({state:z.enum(["NOT_COMPARABLE","SAME_CONDITIONS"]),delta:z.number().finite().nullable(),unknown:z.array(z.string()).max(10),mismatched:z.array(z.string()).max(11),verification:z.literal("FIXED_ARITHMETIC_RECOMPUTATION_NOT_EXPERIMENT_REPRODUCTION")}).strict().parse(JSON.parse(output));
 const expected=compareMetricRecords(job.left,job.right);
 if(parsed.state!==expected.state||JSON.stringify(parsed.unknown)!==JSON.stringify(expected.unknown)||JSON.stringify(parsed.mismatched)!==JSON.stringify(expected.mismatched)||parsed.delta!==expected.delta)throw new AppError("SANDBOX_RESULT_MISMATCH","容器核算结果与批准输入不一致",409);
 return {jobName:name,containerId:container.Id,image:METRIC_IMAGE,scriptHash:METRIC_SCRIPT_HASH,inputHash:jsonHash({left:job.left,right:job.right}),exitCode:0,finishedAt:container.State.FinishedAt,result:parsed,receiptHash:jsonHash({id:container.Id,input:job,output:parsed}),verification:"FIXED_ARITHMETIC_RECOMPUTATION_NOT_EXPERIMENT_REPRODUCTION"};
}
