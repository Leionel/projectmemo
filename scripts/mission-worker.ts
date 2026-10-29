import {consumeImpactJobs} from "../lib/decision/impactJobs";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { runMissionSlice } from "../lib/mission/runner";
import { db } from "../lib/db";
import { processMaterialContinuationBatch } from "../lib/mission/continuationService";
import { runConversationTurn } from "../lib/conversation/turnWorker";
import { processInvestigationDelegations } from "../lib/mission/investigationDelegation";
const workerId=randomUUID();let stopping=false;let nextScan=0;
process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
try{do{try{if(Date.now()>=nextScan){await consumeImpactJobs();await processMaterialContinuationBatch();await processInvestigationDelegations();nextScan=Date.now()+15000;}const ran=(await runConversationTurn()) || await runMissionSlice({workerId});if(!ran&&!process.argv.includes("--once"))await setTimeout(1000);}catch{console.error("委托 Worker 未能领取任务，请检查功能开关、数据库迁移和成员权限");if(process.argv.includes("--once"))process.exitCode=1;else await setTimeout(2000);}}while(!stopping&&!process.argv.includes("--once"));}finally{await db.$disconnect();}
