import {consumeImpactJobs} from "../lib/decision/impactJobs";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { runMissionSlice } from "../lib/mission/runner";
import { db } from "../lib/db";
import { processMaterialContinuationBatch } from "../lib/mission/continuationService";
import { runConversationTurn } from "../lib/conversation/turnWorker";
import { processInvestigationDelegations } from "../lib/mission/investigationDelegation";
import { runWorkerCycle, type WorkerCycleState } from "../lib/mission/workerCycle";
const workerId=randomUUID();let stopping=false;
const state:WorkerCycleState={first:"CONVERSATION",nextScanAt:0};
process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
try{
 do{
  const result=await runWorkerCycle(state,{
   scan:[{name:"IMPACT",run:()=>consumeImpactJobs()},{name:"MATERIAL",run:()=>processMaterialContinuationBatch()},{name:"DELEGATION",run:()=>processInvestigationDelegations()}],
   conversation:()=>runConversationTurn(),mission:()=>runMissionSlice({workerId}),
   onError:(name)=>console.error(`委托 Worker ${name} 本次处理失败，请核对功能开关、迁移和原任务记录`),
  });
  if(process.argv.includes("--once")&&result.failures)process.exitCode=1;
  if(!result.ran&&!process.argv.includes("--once"))await setTimeout(result.failures?2000:1000);
 }while(!stopping&&!process.argv.includes("--once"));
}finally{await db.$disconnect();}
