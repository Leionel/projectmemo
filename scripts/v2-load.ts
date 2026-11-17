/**
 * Isolated 10/30 active-delegation load probe. Real Mission rows, real Runner, real SQLite, local
 * deterministic provider only. This proves local coordination/contention, NOT real cloud capacity.
 *
 *   npm.cmd exec tsx -- scripts/v2-load.ts --count 10 --out evidence/v2-first-loop/m4-20261117/load-10
 *   npm.cmd exec tsx -- scripts/v2-load.ts --count 30 --out evidence/v2-first-loop/m4-20261117/load-30
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const arg = (name: string, fallback = "") => {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const count = Math.max(1, Math.min(50, Number(arg("count", "10"))));
const outDir = path.resolve(arg("out", "evidence/v2-first-loop/m4-20261117/load-" + count));
fs.mkdirSync(outDir, { recursive: true });
const dbPath = path.join(outDir, "load.db");
const databaseUrl = "file:" + dbPath.replaceAll("\\", "/");
for (const suffix of ["", "-shm", "-wal"]) { try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* fresh load DB */ } }
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const file = path.join("prisma/migrations", name, "migration.sql");
  if (!fs.existsSync(file)) continue;
  const sql = new Database(dbPath);
  sql.exec(fs.readFileSync(file, "utf8"));
  sql.close();
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, LLM_MODE: "mock", MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" });

const { db } = await import("../lib/db");
const { createMission, editContinuationPolicy, missionDetail } = await import("../lib/mission/missionService");
const { runMissionSlice } = await import("../lib/mission/runner");
const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
const { fixtureSkillProvider } = await import("./fixtures/v2-provider");

const user = await db.user.create({ data: { username: "load-" + randomUUID(), displayName: "负载探针", passwordHash: "unused" } });
const project = await db.project.create({ data: { title: "负载项目", description: "隔离负载探针", goal: "持续报告", scenario: "RESEARCH",
  memberships: { create: { userId: user.id, role: "OWNER" } } } });
const policy = { mode: "BOUNDED_INVESTIGATION" as const, schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
  checkEveryMinutes: 60, maxModels: 50, maxTools: 100, maxMetadataRequests: 0,
  allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" };
type MissionState = "READY" | "OBSERVATION" | "USER" | "STALE_RUNNING" | "RUNNING";
const missions: Array<{ missionId: string; projectId: string; captureId: string; state: MissionState; createdAt: number; acceptedMs?: number;
  queuedMs?: number; firstResultMs?: number; claims: number; outputs: number; provider: ReturnType<typeof fixtureSkillProvider> }> = [];
const states: MissionState[] = ["READY", "OBSERVATION", "USER", "STALE_RUNNING", "RUNNING"];
for (let index = 0; index < count; index++) {
  const p = await db.project.create({ data: { title: "负载项目 " + index, description: "隔离负载探针", goal: "持续报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: p.id, sourceType: "TEXT", rawText: "负载资料 " + index + "：结果仍待核对。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: p.id, requestId: randomUUID(), goal: "整理持续报告", llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy });
  const state = states[index % states.length];
  if (state === "OBSERVATION")
    await db.agentMission.update({ where: { id: mission.id }, data: { status: "WAITING_INPUT", waitStateJson: { waitingFor: "OBSERVATION", startedAt: new Date().toISOString() }, nextAttemptAt: new Date(Date.now() + 3600000) } });
  if (state === "USER")
    await db.agentMission.update({ where: { id: mission.id }, data: { status: "WAITING_INPUT", waitStateJson: { waitingFor: "USER", questionId: "q" + index, question: "请补充口径", startedAt: new Date().toISOString() } } });
  if (state === "STALE_RUNNING")
    await db.agentMission.update({ where: { id: mission.id }, data: { status: "RUNNING", executionSlot: null, leaseOwner: "dead", leaseUntil: new Date(0), leaseEpoch: { increment: 1 } } });
  if (state === "RUNNING")
    await db.agentMission.update({ where: { id: mission.id }, data: { status: "RUNNING", executionSlot: null, leaseOwner: "live", leaseUntil: new Date(Date.now() + 300000), leaseEpoch: { increment: 1 } } });
  const source = async () => {
    const material = await readProjectMaterial(p.id, "capture:" + capture.id);
    return { sourceId: material!.id, sourceHash: material!.hash };
  };
  missions.push({ missionId: mission.id, projectId: p.id, captureId: capture.id, state, createdAt: Date.now(), claims: 0, outputs: 0,
    provider: fixtureSkillProvider(source) });
}

const accepted: number[] = [], queue: number[] = [], firstResult: number[] = [], foregroundLatency: number[] = [], busyErrors: string[] = [];
let foregroundSamples = 0, foregroundFailures = 0;
const startedAt = Date.now();
const deadline = startedAt + 60000;
async function foreground() {
  const target = missions[foregroundSamples % missions.length];
  const begin = performance.now();
  try { await missionDetail(user.id, target.missionId); foregroundLatency.push(performance.now() - begin); }
  catch { foregroundFailures++; foregroundLatency.push(performance.now() - begin); }
  foregroundSamples++;
}
const foregroundTimer = setInterval(() => { void foreground(); }, 100);
async function workerLoop(worker: number) {
  while (Date.now() < deadline) {
    let worked = false;
    for (const item of missions) {
      if (!["READY", "STALE_RUNNING"].includes(item.state)) continue;
      const current = await db.agentMission.findUniqueOrThrow({ where: { id: item.missionId } });
      if (!["READY", "RUNNING"].includes(current.status)) continue;
      const begin = performance.now();
      try {
        const claimed = await runMissionSlice({ id: item.missionId, provider: item.provider, workerId: "load-" + worker });
        if (!claimed) continue;
        worked = true; item.claims++;
        if (item.acceptedMs === undefined) { item.acceptedMs = Date.now() - item.createdAt; accepted.push(item.acceptedMs); }
        if (item.queuedMs === undefined) { item.queuedMs = Date.now() - item.createdAt; queue.push(item.queuedMs); }
        if (!item.firstResultMs) {
          const outputs = await db.agentMissionOutput.count({ where: { missionId: item.missionId } });
          if (outputs > 0) { item.firstResultMs = Date.now() - item.createdAt; firstResult.push(item.firstResultMs); }
        }
      } catch (error) {
        const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : "UNKNOWN");
        if (/SQLITE_BUSY|P1008|P2028|P2034/.test(String(code))) busyErrors.push(String(code));
      }
      if (item.claims >= 6) item.state = "OBSERVATION";
    }
    if (!worked) {
      let runnable = false;
      for (const item of missions) {
        if (item.state === "RUNNING") continue;
        const row = await db.agentMission.findUnique({ where: { id: item.missionId }, select: { status: true } });
        if (row && ["READY", "RUNNING"].includes(row.status)) { runnable = true; break; }
      }
      if (!runnable) break;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }
}
await Promise.all([workerLoop(1), workerLoop(2)]);
clearInterval(foregroundTimer);
const final = await db.agentMission.findMany({ where: { ownerUserId: user.id }, select: { id: true, status: true, budgetUsedJson: true } });
for (const mission of final) {
  const outputs = await db.agentMissionOutput.count({ where: { missionId: mission.id } });
  const item = missions.find(entry => entry.missionId === mission.id);
  if (item) item.outputs = outputs;
}
const budget = final.reduce((total, mission) => { const value = mission.budgetUsedJson as Record<string, number> ?? {}; return {
  models: total.models + (value.models ?? 0), tools: total.tools + (value.tools ?? 0), inputTokens: total.inputTokens + (value.inputTokens ?? 0),
  outputTokens: total.outputTokens + (value.outputTokens ?? 0), unknownCalls: total.unknownCalls + (value.unknownCalls ?? 0),
  reservedOutputTokens: total.reservedOutputTokens + (value.reservedOutputTokens ?? 0) }; }, { models: 0, tools: 0, inputTokens: 0, outputTokens: 0, unknownCalls: 0, reservedOutputTokens: 0 });
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
const claims = missions.map(item => item.claims);
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), count, states: missions.reduce<Record<string, number>>((acc, item) => { acc[item.state] = (acc[item.state] ?? 0) + 1; return acc; }, {}),
  target: { p95AcceptedMs: 2000, p90FirstLocalResultMs: 120000 },
  accepted: { samples: accepted.length, p50Ms: percentile(accepted, 0.5), p95Ms: percentile(accepted, 0.95), targetMet: (percentile(accepted, 0.95) ?? 0) < 2000 },
  queue: { samples: queue.length, p95Ms: percentile(queue, 0.95) },
  firstLocalResult: { samples: firstResult.length, p50Ms: percentile(firstResult, 0.5), p90Ms: percentile(firstResult, 0.9), targetMet: (percentile(firstResult, 0.9) ?? 0) < 120000 },
  foreground: { samples: foregroundSamples, failures: foregroundFailures, p50Ms: percentile(foregroundLatency, 0.5), p95Ms: percentile(foregroundLatency, 0.95) },
  failureRate: missions.filter(item => item.claims === 0 && ["READY", "STALE_RUNNING"].includes(item.state)).length / Math.max(1, missions.filter(item => ["READY", "STALE_RUNNING"].includes(item.state)).length),
  fairness: { claimsMin: Math.min(...claims), claimsMax: Math.max(...claims) },
  busyErrors: busyErrors.length, usage: budget, durationMs: Date.now() - startedAt,
  provider: "INJECTED_LOAD_FIXTURE (in-process, no paid call)", limitation: "Local mock throughput is not real cloud capacity; RUNNING rows with live leases stay untouched by design." };
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await db.$disconnect();
