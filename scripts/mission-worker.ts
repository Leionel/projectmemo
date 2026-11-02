import { consumeImpactJobs } from "../lib/decision/impactJobs";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { runMissionSlice } from "../lib/mission/runner";
import { db } from "../lib/db";
import { processMaterialContinuationBatch } from "../lib/mission/continuationService";
import { runConversationTurn } from "../lib/conversation/turnWorker";
import { processInvestigationDelegations } from "../lib/mission/investigationDelegation";
import { runWorkerCycle, type WorkerCycleState } from "../lib/mission/workerCycle";
import { recordWorkerPresence } from "../lib/mission/workerPresence";
import { processProjectDeletions } from "../lib/services/projectDeletionService";

const workerId = randomUUID();
let stopping = false;
const state: WorkerCycleState = { first: "CONVERSATION", nextScanAt: 0 };
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

recordWorkerPresence({workerId,version:"r4-ux3-worker"});
const heartbeat=setInterval(()=>recordWorkerPresence({workerId,version:"r4-ux3-worker"}),10000);heartbeat.unref();
try {
  do {
    let successfulScans=0;
    const scanned=async(run:()=>Promise<unknown>)=>{const result=await run();if(++successfulScans===4)recordWorkerPresence({workerId,scan:true});return result;};
    const result = await runWorkerCycle(state, {
      scan: [
        { name: "PROJECT_CLEANUP", run: () => scanned(() => processProjectDeletions()) },
        { name: "IMPACT", run: () => scanned(()=>consumeImpactJobs()) },
        { name: "MATERIAL", run: () => scanned(()=>processMaterialContinuationBatch()) },
        { name: "DELEGATION", run: () => scanned(()=>processInvestigationDelegations()) },
      ],
      conversation: () => runConversationTurn({ onClaim: () => recordWorkerPresence({ workerId, claim: true }) }),
      mission: () => runMissionSlice({ workerId,onClaim:()=>recordWorkerPresence({workerId,claim:true}) }),
      onError: (name) => {
        if (["PROJECT_CLEANUP", "IMPACT", "MATERIAL", "DELEGATION"].includes(name)) recordWorkerPresence({ workerId, failedScan: name });
        console.error(`委托 Worker ${name} 本次处理失败，请核对功能开关、迁移和原任务记录`);
      },
    });


    if (process.argv.includes("--once") && result.failures) process.exitCode = 1;
    if (!result.ran && !process.argv.includes("--once")) await setTimeout(result.failures ? 2000 : 1000);
  } while (!stopping && !process.argv.includes("--once"));
} finally {
  clearInterval(heartbeat);
  await db.$disconnect();
}
