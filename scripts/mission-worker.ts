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

// Mixed-deployment gate: this build only claims rows it understands, and it refuses to run on an
// un-migrated schema or with frozen v2 rows while MISSION_V2_ENABLED is off (old Worker binaries may be present).
try {
  const columns = await db.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("AgentMission")`;
  if (!columns.some(column => column.name === "runtimeProtocolVersion")) {
    console.error("委托 Worker 启动中止：数据库缺少 runtimeProtocolVersion 迁移，请先完成迁移并升级全部 Worker。");
    process.exit(1);
  }
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false) && await db.agentMission.count({ where: { runtimeProtocolVersion: 2 } }) > 0) {
    console.error("委托 Worker 启动中止：库中存在 v2 委托但 MISSION_V2_ENABLED 关闭，可能存在旧 Worker 混跑。请先升级全部 API/Worker 并核对 v2-rollout-check。");
    process.exit(1);
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
const heartbeat=setInterval(()=>recordWorkerPresence({workerId,version:"r4-ux3-worker"}),10000);heartbeat.unref();
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
