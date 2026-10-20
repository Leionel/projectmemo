import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { runMissionSlice } from "../lib/mission/runner";
import { db } from "../lib/db";
const workerId=randomUUID();let stopping=false;
process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
try{do{try{const ran=await runMissionSlice({workerId});if(!ran&&!process.argv.includes("--once"))await setTimeout(1000);}catch{console.error("委托 Worker 未能领取任务，请检查功能开关、数据库迁移和成员权限");if(process.argv.includes("--once"))process.exitCode=1;else await setTimeout(2000);}}while(!stopping&&!process.argv.includes("--once"));}finally{await db.$disconnect();}
