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

  const updated: WorkerPresenceInfo = {
    status: "RECENT",
    workerId: data.workerId,
    lastHeartbeatAt: ts,
    lastScanAt: data.scan ? ts : (existing.lastScanAt ?? null),
    lastClaimAt: data.claim ? ts : (existing.lastClaimAt ?? null),
    version: data.version ?? existing.version ?? "1.0.0",
  };
  inMemoryPresence = updated;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(updated), "utf-8");
  } catch {}
}

export function readWorkerPresence(now = Date.now()): WorkerPresenceInfo {
  const filePath = getPresencePath();
  let data = inMemoryPresence;
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}

  if (!data || !data.lastHeartbeatAt) {
    return {
      status: "UNOBSERVED",
      workerId: null,
      lastHeartbeatAt: null,
      lastScanAt: null,
      lastClaimAt: null,
      version: null,
    };
  }

  const elapsed = now - Date.parse(data.lastHeartbeatAt);
  const status: WorkerPresenceStatus = elapsed <= 60000 ? "RECENT" : "STALE";
  return {
    ...data,
    status,
  };
}

export function clearWorkerPresenceForTest(): void {
  inMemoryPresence = null;
  const filePath = getPresencePath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
