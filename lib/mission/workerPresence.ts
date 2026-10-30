import fs from "node:fs";
import path from "node:path";

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
};

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
  };
  inMemoryPresence = updated;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary=filePath+"."+process.pid+".tmp";
    fs.writeFileSync(temporary, JSON.stringify(updated), "utf-8");fs.renameSync(temporary,filePath);
  } catch {}
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
  const isActivelyInspecting = elapsedScan <= 120000;
  const hasClaimedWork = Boolean(data.lastClaimAt);
  const status: WorkerPresenceStatus = isProcessAlive ? "RECENT" : "STALE";
  return {
    ...data,
    status,
    isProcessAlive,
    isActivelyInspecting,
    hasClaimedWork,
  };
}

export function clearWorkerPresenceForTest(): void {
  inMemoryPresence = null;
  const filePath = getPresencePath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
