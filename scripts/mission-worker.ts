import { consumeImpactJobs } from "../lib/decision/impactJobs";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { runMissionSlice } from "../lib/mission/runner";
import { db } from "../lib/db";
import { processMaterialContinuationBatch } from "../lib/mission/continuationService";
import { runConversationTurn } from "../lib/conversation/turnWorker";
import { processInvestigationDelegations } from "../lib/mission/investigationDelegation";
import { processWaitNotices } from "../lib/mission/waitNotice";
import { runWorkerCycle, type WorkerCycleState } from "../lib/mission/workerCycle";
import { recordWorkerPresence } from "../lib/mission/workerPresence";
import { processProjectDeletions } from "../lib/services/projectDeletionService";
import { expireIntakeDrafts } from "../lib/services/projectIntakeService";
import { isFeatureEnabled } from "../lib/config/features";
import { WORKER_CAPABILITY_VERSION } from "../lib/mission/workerRelease";

// This build claims only enabled protocol versions. Rollback keeps v1 consumption available while
// v2 rows remain frozen; deployment readiness is inspected separately by v2-rollout-check.
try {
  const columns = await db.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("AgentMission")`;
  if (!columns.some(column => column.name === "runtimeProtocolVersion")) {
    console.error("委托 Worker 启动中止：数据库缺少 runtimeProtocolVersion 迁移，请先完成迁移并升级全部 Worker。");
    process.exit(1);
  }
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false) && await db.agentMission.count({ where: { runtimeProtocolVersion: 2 } }) > 0) {
    console.warn("V2 当前关闭：本 Worker 仅消费 v1 委托，v2 委托保持冻结。重新启用前请核对 v2-rollout-check。");
  }
} catch (error) {
  console.error("委托 Worker 启动检查失败，未继续消费任务：" + (error instanceof Error ? error.message : "unknown"));
  process.exit(1);
}
const workerId = randomUUID();
let stopping = false;
const state: WorkerCycleState = { first: "CONVERSATION", nextScanAt: 0 };
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

recordWorkerPresence({workerId,version:WORKER_CAPABILITY_VERSION});
const heartbeat=setInterval(()=>recordWorkerPresence({workerId,version:WORKER_CAPABILITY_VERSION}),10000);heartbeat.unref();
try {
  do {
    let successfulScans=0;
    const scanned=async(run:()=>Promise<unknown>)=>{const result=await run();if(++successfulScans===4)recordWorkerPresence({workerId,scan:true});return result;};
    const result = await runWorkerCycle(state, {
      scan: [
        { name: "PROJECT_CLEANUP", run: () => scanned(() => processProjectDeletions()) },
        { name: "INTAKE_CLEANUP", run: () => scanned(() => expireIntakeDrafts()) },
        { name: "IMPACT", run: () => scanned(()=>consumeImpactJobs()) },
        { name: "MATERIAL", run: () => scanned(()=>processMaterialContinuationBatch()) },
        { name: "DELEGATION", run: () => scanned(()=>processInvestigationDelegations()) },
        { name: "WAIT_NOTICE", run: () => processWaitNotices() },
      ],
      conversation: () => runConversationTurn({ onClaim: () => recordWorkerPresence({ workerId, claim: true }) }),
      mission: () => isFeatureEnabled("MISSION_ENABLED", false)
        ? runMissionSlice({ workerId,onClaim:()=>recordWorkerPresence({workerId,claim:true}) })
        : Promise.resolve(false),
      onError: (name, error) => {
        if (["PROJECT_CLEANUP", "INTAKE_CLEANUP", "IMPACT", "MATERIAL", "DELEGATION"].includes(name)) recordWorkerPresence({ workerId, failedScan: name });
        console.error(`委托 Worker ${name} 本次处理失败，请核对功能开关、迁移和原任务记录`, error);
      },
    });


    if (process.argv.includes("--once") && result.failures) process.exitCode = 1;
    // 只有整轮无失败才清除失败信号；任何一处持续失败都不会被其它成功扫描掩盖。
    if (!result.failures) recordWorkerPresence({ workerId, cleanCycle: true });
    if (!result.ran && !process.argv.includes("--once")) await setTimeout(result.failures ? 2000 : 1000);
  } while (!stopping && !process.argv.includes("--once"));
} finally {
  clearInterval(heartbeat);
  await db.$disconnect();
}
