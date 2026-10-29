import assert from "node:assert/strict";
import { METRIC_IMAGE,type DockerCommand } from "../../lib/experiments/sandbox";
export function fakeDocker(){
 const calls:string[]=[];let container:Record<string,unknown>|null=null;
 const run:DockerCommand=async args=>{
  calls.push(args[0]);if(args[0]==="image")return "sha256:image";
  if(args[0]==="create"){
   if(container)throw new Error("DUPLICATE_CREATE");const labels:Record<string,string>={};args.forEach((a,i)=>{if(a==="--label"){const [key,...v]=args[i+1].split("=");labels[key]=v.join("=");}});
   assert.ok(args.includes("--network=none"));assert.ok(args.includes("--read-only"));assert.ok(args.includes("--pids-limit=32"));assert.ok(args.includes("--memory=64m"));
   container={Id:"f".repeat(64),Config:{Image:METRIC_IMAGE,Labels:labels,User:"65534:65534",Cmd:["timeout","-s","KILL","8","python","-I","-B","/input/verify.py"]},HostConfig:{NetworkMode:"none",ReadonlyRootfs:true,Memory:67108864,MemorySwap:67108864,NanoCpus:500000000,PidsLimit:32,CapDrop:["ALL"],SecurityOpt:["no-new-privileges"],Privileged:false},Mounts:[{Destination:"/input",RW:false}],State:{Status:"created",Running:false,FinishedAt:"0001-01-01"}};return "f".repeat(64);
  }
  if(args[0]==="start"){if(!container)throw new Error("MISSING_JOB");container.State={Status:"exited",Running:false,FinishedAt:"2026-10-29T10:00:00.000Z",ExitCode:0};return "job";}
  if(args[0]==="wait")return "0";
  if(args[0]==="inspect"){if(!container)throw new Error("NOT_FOUND");return JSON.stringify([container]);}
  if(args[0]==="logs")return JSON.stringify({state:"SAME_CONDITIONS",delta:0.7-0.8,unknown:[],mismatched:[],verification:"FIXED_ARITHMETIC_RECOMPUTATION_NOT_EXPERIMENT_REPRODUCTION"});
  throw new Error("UNEXPECTED_COMMAND");
 };return {run,calls};
}