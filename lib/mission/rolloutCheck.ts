import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { readWorkerPresence } from "./workerPresence";
import { WORKER_CAPABILITY_VERSION } from "./workerRelease";

export type RolloutCheck = { name: string; status: "PASS" | "WARN" | "BLOCK"; detail: string };
export type RolloutReport = {
  ok: boolean; verdict: "V1_ONLY_SAFE" | "V2_READY" | "BLOCKED";
  reason: string; v2Rows: number; v2Enabled: boolean; workerVersion: string | null; workerStatus: string;
  checks: RolloutCheck[];
};

/**
 * Read-only mixed-deployment gate. It never migrates or writes business rows.
 * Old Worker binaries do not understand v2 rows, so enabling v2 (or merely existing v2 rows) is only
 * safe when the schema and a v2-capable Worker are both present.
 */
export async function inspectV2Rollout(options: { now?: number } = {}): Promise<RolloutReport> {
  const checks: RolloutCheck[] = [];
  const columns = await db.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("AgentMission")`;
  const hasProtocolColumn = columns.some(column => column.name === "runtimeProtocolVersion");
  checks.push({ name: "SCHEMA_PROTOCOL_COLUMN", status: hasProtocolColumn ? "PASS" : "BLOCK",
    detail: hasProtocolColumn ? "AgentMission.runtimeProtocolVersion 已存在" : "缺少协议版本列：必须先执行迁移，旧/新 Worker 均不能继续" });
  const v2Enabled = isFeatureEnabled("MISSION_V2_ENABLED", false);
  checks.push({ name: "V2_FEATURE_FLAG", status: v2Enabled ? "PASS" : "WARN", detail: v2Enabled ? "MISSION_V2_ENABLED=true" : "MISSION_V2_ENABLED 关闭（v2 行应保持冻结）" });
  if (!hasProtocolColumn) return { ok: false, verdict: "BLOCKED", reason: "MIGRATION_REQUIRED", v2Rows: 0, v2Enabled, workerVersion: null, workerStatus: "UNKNOWN", checks };
  const [v2Rows, unsupportedRows] = await Promise.all([
    db.agentMission.count({ where: { runtimeProtocolVersion: 2 } }),
    db.agentMission.count({ where: { runtimeProtocolVersion: { gt: 2 } } }),
  ]);
  checks.push({ name: "V2_ROWS", status: unsupportedRows ? "BLOCK" : "PASS", detail: unsupportedRows ? `存在 ${unsupportedRows} 条未知协议版本行` : `v2 行 ${v2Rows} 条` });
  const presence = readWorkerPresence(options.now);
  const workerVersion = presence.version;
  checks.push({ name: "WORKER_BUILD", status: presence.workerId && workerVersion === WORKER_CAPABILITY_VERSION ? "PASS" : "WARN",
    detail: presence.workerId ? `最近 Worker 版本 ${workerVersion ?? "未知"}（要求 ${WORKER_CAPABILITY_VERSION}）` : "尚未观察到 Worker 心跳" });
  checks.push({ name: "WORKER_IDENTITY", status: presence.workerId && presence.identityMatches === false ? "BLOCK" : "PASS",
    detail: presence.identityMatches === false ? `Worker 与当前配置不一致：${presence.mismatchReason}` : "Worker 身份与当前配置一致或未观察" });

  let verdict: RolloutReport["verdict"] = "V2_READY";
  let reason = "全部检查通过";
  if (!hasProtocolColumn) { verdict = "BLOCKED"; reason = "MIGRATION_REQUIRED"; }
  else if (unsupportedRows > 0) { verdict = "BLOCKED"; reason = "UNSUPPORTED_PROTOCOL_VERSION"; }
  else if (v2Rows > 0 && !v2Enabled) { verdict = "BLOCKED"; reason = "V2_ROWS_PRESENT_WHILE_DISABLED"; }
  else if (v2Enabled && !presence.workerId) { verdict = "BLOCKED"; reason = "V2_WORKER_UNOBSERVED"; }
  else if (v2Enabled && workerVersion !== WORKER_CAPABILITY_VERSION) { verdict = "BLOCKED"; reason = "MIXED_WORKER_VERSION"; }
  else if (v2Enabled && presence.identityMatches !== true) { verdict = "BLOCKED"; reason = "WORKER_IDENTITY_MISMATCH"; }
  else if (v2Enabled && (!presence.isProcessAlive || presence.status !== "RECENT")) { verdict = "BLOCKED"; reason = "V2_WORKER_STALE"; }
  else if (v2Rows === 0 && !v2Enabled) { verdict = "V1_ONLY_SAFE"; reason = "仅 v1 行且功能关闭，可安全运行旧 Worker"; }
  const ok = verdict !== "BLOCKED";
  if (!ok) checks.push({ name: "VERDICT", status: "BLOCK", detail: reason });
  return { ok, verdict, reason, v2Rows, v2Enabled, workerVersion, workerStatus: presence.status, checks };
}
