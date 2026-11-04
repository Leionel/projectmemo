import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type WorkerPresenceStatus = "UNOBSERVED" | "RECENT" | "STALE";

export type WorkerPresenceInfo = {
  status: WorkerPresenceStatus;
  workerId: string | null;
  lastHeartbeatAt: string | null;
  lastScanAt: string | null;
  lastClaimAt: string | null;
  version: string | null;
  isProcessAlive: boolean;
  isActivelyInspecting: boolean;
  hasClaimedWork: boolean;
  release?: string | null;
  databaseHash?: string;
  configHash?: string;
  identityMatches?: boolean;
  mismatchReason?: string | null;
  lastScanFailedAt?: string | null;
  failedPhase?: string | null;
};

function identity() {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const database = url.startsWith("file:") ? path.resolve(url.slice(5)) : url;
  const flags = [
    "MISSION_ENABLED", "MISSION_WRITES_ENABLED", "MISSION_WEB_ENABLED", "MISSION_EVENT_CONTINUATION_ENABLED",
    "MISSION_AUTO_CONTINUATION_ENABLED", "MISSION_INVESTIGATION_DELEGATION_ENABLED", "MISSION_EVIDENCE_FIT_ENABLED",
    "MISSION_ARTIFACT_ADOPTION_ENABLED", "MISSION_SEMANTIC_CHECK_ENABLED", "MISSION_CLAIM_JUDGE_ENABLED", "MISSION_WAIT_EMAIL_ENABLED",
    "FOCUS_AGENT_ENABLED", "FOCUS_AGENT_R4_ENABLED", "FOCUS_WEB_ENABLED", "FOCUS_ASYNC_ENABLED", "FOCUS_CONTINUITY_ENABLED",
    "DEPLOYMENT_OBSERVER_ENABLED", "BROWSER_READ_ENABLED", "ACADEMIC_RESEARCH_ENABLED", "REPO_CI_OBSERVER_ENABLED",
    "DOCUMENT_DEEP_READ_ENABLED", "EXPERIMENT_OBSERVER_ENABLED", "SANDBOX_VERIFICATION_ENABLED",
    "CALENDAR_CONNECTIONS_ENABLED", "CALENDAR_EVENT_WRITE_ENABLED", "TEMPORAL_MEMORY_ENABLED", "PROJECT_EXPERIENCE_ENABLED",
    "LLM_MODE", "LLM_PROVIDER", "LLM_MODEL_NAME",
  ];
  return { release: process.env.PROJECTMEMO_RELEASE?.trim() || "unversioned", databaseHash: hash(database), configHash: hash(JSON.stringify(flags.map(k => [k, process.env[k] ?? null]))) };
}

function getPresencePath(): string {
  if (process.env.WORKER_PRESENCE_FILE) return process.env.WORKER_PRESENCE_FILE;
  return path.join(process.cwd(), ".runtime", "worker-presence.json");
}

let inMemoryPresence: WorkerPresenceInfo | null = null;

export function recordWorkerPresence(data: {
  workerId: string;
  scan?: boolean;
  claim?: boolean;
  version?: string;
  now?: number;
  failedScan?: string;
  /** 一整轮扫描没有任何失败时才允许清掉失败信号。 */
  cleanCycle?: boolean;
}): void {
  const ts = new Date(data.now ?? Date.now()).toISOString();
  const filePath = getPresencePath();
  let existing: Partial<WorkerPresenceInfo> = inMemoryPresence ?? {};
  try {
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}

  if(existing.workerId!==data.workerId)existing={};
  const lastScanAt = data.scan ? ts : (existing.lastScanAt ?? null);
  const lastClaimAt = data.claim ? ts : (existing.lastClaimAt ?? null);
  const updated: WorkerPresenceInfo = {
    status: "RECENT",
    workerId: data.workerId,
    lastHeartbeatAt: ts,
    lastScanAt,
    lastClaimAt,
    version: data.version ?? existing.version ?? "1.0.0",
    isProcessAlive: true,
    isActivelyInspecting: Boolean(lastScanAt && (Date.now() - Date.parse(lastScanAt) <= 120000)),
    hasClaimedWork: Boolean(lastClaimAt),
    ...identity(),
    // 成功扫描只更新“最近扫描时间”，不再顺手抹掉失败：一处持续失败会在一轮里
    // 被其它扫描的成功掩盖。只有干净的一整轮才清除失败信号。
    lastScanFailedAt: data.cleanCycle ? null : data.failedScan ? ts : existing.lastScanFailedAt ?? null,
    failedPhase: data.cleanCycle ? null : data.failedScan ?? existing.failedPhase ?? null,
  };
  inMemoryPresence = updated;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary=filePath+"."+process.pid+".tmp";
    fs.writeFileSync(temporary, JSON.stringify(updated), "utf-8");fs.renameSync(temporary,filePath);
  } catch { console.error("Worker 状态未能持久化，Web 端不能据此确认后台在线"); }
}

export function readWorkerPresence(now = Date.now()): WorkerPresenceInfo {
  const filePath = getPresencePath();
  let data: WorkerPresenceInfo | null = null;
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}

  if (!data || typeof data.lastHeartbeatAt!=="string" || !Number.isFinite(Date.parse(data.lastHeartbeatAt))) {
    return {
      status: "UNOBSERVED",
      workerId: null,
      lastHeartbeatAt: null,
      lastScanAt: null,
      lastClaimAt: null,
      version: null,
      isProcessAlive: false,
      isActivelyInspecting: false,
      hasClaimedWork: false,
    };
  }

  const elapsedHeartbeat = now - Date.parse(data.lastHeartbeatAt);
  const elapsedScan = data.lastScanAt ? now - Date.parse(data.lastScanAt) : Infinity;
  const isProcessAlive = elapsedHeartbeat >= -5000 && elapsedHeartbeat <= 60000;
  const expected = identity();
  const mismatchReason = data.release !== expected.release ? "RELEASE_MISMATCH" : data.databaseHash !== expected.databaseHash ? "DATABASE_MISMATCH" : data.configHash !== expected.configHash ? "CONFIG_MISMATCH" : null;
  const identityMatches = !mismatchReason;
  // 失败信号只由“干净的一整轮”清除。同一轮里其它扫描成功不再把时间戳推后
  // 就当作恢复——否则一处持续失败会被同轮的成功掩盖。
  const scanSucceeded = !data.failedPhase && !data.lastScanFailedAt;
  const isActivelyInspecting = Boolean(isProcessAlive && identityMatches && scanSucceeded && elapsedScan >= -5000 && elapsedScan <= 120000);
  const hasClaimedWork = Boolean(data.lastClaimAt);
  const status: WorkerPresenceStatus = isProcessAlive && identityMatches ? "RECENT" : "STALE";
  return {
    ...data,
    status,
    isProcessAlive,
    isActivelyInspecting,
    hasClaimedWork,
    identityMatches, mismatchReason,
  };
}

export function clearWorkerPresenceForTest(): void {
  inMemoryPresence = null;
  const filePath = getPresencePath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

