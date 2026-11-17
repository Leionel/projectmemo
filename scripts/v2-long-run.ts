/**
 * Bounded long-running reliability harness for V2 continuous missions.
 *
 *   npm.cmd exec tsx -- scripts/v2-long-run.ts start --out evidence/.../long-run --interval-ms 5000 --cycles 720
 *   npm.cmd exec tsx -- scripts/v2-long-run.ts status --out ...
 *   npm.cmd exec tsx -- scripts/v2-long-run.ts material --out ... --text "新增材料"
 *   npm.cmd exec tsx -- scripts/v2-long-run.ts stop --out ...
 *   npm.cmd exec tsx -- scripts/v2-long-run.ts report --out ...
 *
 * `start --wait` is for bounded smoke tests; without --wait the worker is detached and `stop` ends it.
 * This never claims 72h real runtime unless the caller actually runs it for 72h and keeps the evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { assessRunCoverage } from "./fixtures/long-run-coverage";

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
const flag = (name: string) => {
  const index = argv.indexOf("--" + name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string) => argv.includes("--" + name);
const outDir = path.resolve(flag("out") ?? path.join("evidence/v2-first-loop/long-run", new Date().toISOString().replace(/[:.]/g, "-")));
const configPath = path.join(outDir, "run.json");
const evidencePath = path.join(outDir, "evidence.jsonl");
const logPath = path.join(outDir, "worker.log");
const dbPath = path.join(outDir, "long-run.db");

type RunConfig = { schemaVersion: 1; createdAt: string; startedAt: string; dbPath: string; ownerUserId: string; projectId: string;
  captureId: string; missionId: string; intervalMs: number; cycles: number; materialEvery: number; durationHours: number;
  workerPid?: number; schedulerTaskName?: string; stoppedAt?: string; stopRequestedAt?: string; resumedAt?: string; resumeCount?: number };
function launchWindows(config: RunConfig, mode: "Register" | "Background" = "Register") {
  if (process.platform !== "win32") throw new Error("Windows 后台宿主仅用于 Windows；其他平台使用系统服务运行 worker 子命令");
  const taskName = "ProjectMemo-V2-" + createHash("sha256").update(outDir).digest("hex").slice(0, 12);
  config.schedulerTaskName = mode === "Register" ? taskName : undefined;
  writeConfig(config);
  const result = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", path.resolve("scripts/v2-long-run-task.ps1"),
    "-Mode", mode, "-Workspace", process.cwd(), "-NodePath", process.execPath, "-OutDirectory", outDir, "-TaskName", taskName], { encoding: "utf8", windowsHide: true });
  console.log(result.trim());
}
function isAlive(pid?: number): boolean { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function readEvidence(): Array<Record<string, number | string | boolean>> {
  return fs.existsSync(evidencePath) ? fs.readFileSync(evidencePath, "utf8").trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, number | string | boolean>) : [];
}
function readConfig(): RunConfig { return JSON.parse(fs.readFileSync(configPath, "utf8")) as RunConfig; }
function writeConfig(config: RunConfig) { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); }
function databaseUrl(file: string) { return "file:" + file.replaceAll("\\", "/"); }
function applyMigrations(file: string) {
  const sql = new Database(file);
  sql.pragma("journal_mode = WAL");
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
}
function flags() {
  return { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
    MISSION_WORKBENCH_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", LLM_MODE: "mock" } as Record<string, string>;
}
function stamp() { return new Date().toISOString(); }

async function start() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    applyMigrations(dbPath);
    Object.assign(process.env, flags(), { DATABASE_URL: databaseUrl(dbPath) });
    const { db } = await import("../lib/db");
    const { createMission, editContinuationPolicy } = await import("../lib/mission/missionService");
    const user = await db.user.create({ data: { username: "long-run-" + randomUUID(), displayName: "长时运行", passwordHash: "unused" } });
    const project = await db.project.create({ data: { title: "长时运行合成项目", description: "隔离长时运行", goal: "整理持续报告", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: "长时运行：第一版资料，结果仍待核对。" } });
    const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理持续报告", llmContextApproved: true });
    const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
      mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      checkEveryMinutes: 1, maxModels: 240, maxTools: 640, maxMetadataRequests: 0,
      allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
    await db.$disconnect();
    const config: RunConfig = { schemaVersion: 1, createdAt: stamp(), startedAt: stamp(), dbPath, ownerUserId: user.id, projectId: project.id,
      captureId: capture.id, missionId: mission.id, intervalMs: Number(flag("interval-ms") ?? 60000),
      cycles: Number(flag("cycles") ?? 0), materialEvery: Number(flag("material-every") ?? 60),
      durationHours: Number(flag("duration-hours") ?? 72) };
    writeConfig(config);
  }
  const config = readConfig();
  if (isAlive(config.workerPid)) throw new Error("已有运行中的 Worker，请使用 status；不要重复启动");
  if (fs.existsSync(path.join(outDir, "stop.flag"))) throw new Error("本次运行已经请求停止；续跑请使用 resume，不要重复 start");
  if (![config.intervalMs, config.durationHours].every(value => Number.isFinite(value) && value > 0) || ![config.cycles, config.materialEvery].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("长跑参数必须为有效的有界正数");
  const wait = has("wait");
  if (has("scheduled") || has("background-host")) {
    if (wait || has("scheduled") && has("background-host")) throw new Error("--scheduled、--background-host、--wait 只能选择一种");
    launchWindows(config, has("scheduled") ? "Register" : "Background"); return;
  }
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/v2-long-run.ts"), "worker", "--out", outDir],
    { cwd: process.cwd(), env: { ...process.env, ...flags(), DATABASE_URL: databaseUrl(config.dbPath) },
      detached: !wait, stdio: wait ? ["ignore", "inherit", "inherit"] : ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")],
      windowsHide: true });
  config.workerPid = child.pid; writeConfig(config);
  if (!wait) {
    child.unref();
    console.log(JSON.stringify({ started: true, workerPid: child.pid, out: outDir, db: dbPath, intervalMs: config.intervalMs,
      cycles: config.cycles, durationHours: config.durationHours, expectedEndAt: new Date(Date.now() + config.durationHours * 3600000).toISOString() }, null, 2));
  } else {
    const code = await new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    console.log(JSON.stringify({ wait: true, exitCode: code, out: outDir }));
    process.exitCode = code === 0 ? 0 : 1;
  }
}

async function worker() {
  const config = readConfig();
  config.workerPid = process.pid; writeConfig(config);
  Object.assign(process.env, flags(), { DATABASE_URL: databaseUrl(config.dbPath) });
  const { db } = await import("../lib/db");
  const { processInvestigationDelegations } = await import("../lib/mission/investigationDelegation");
  const { runMissionSlice } = await import("../lib/mission/runner");
  const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
  const { fixtureSkillProvider } = await import("./fixtures/v2-provider");
  const stopFile = path.join(outDir, "stop.flag");
  const latestCapture = async () => db.capture.findFirst({ where: { projectId: config.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const provider = fixtureSkillProvider(async () => {
    const capture = await latestCapture();
    const source = capture ? await readProjectMaterial(config.projectId, "capture:" + capture.id) : null;
    return { sourceId: source!.id, sourceHash: source!.hash };
  });
  if (config.resumedAt === undefined) { config.resumeCount = config.resumeCount ?? 0; }
  let cycle = readEvidence().length;
  while (true) {
    if (fs.existsSync(stopFile)) break;
    if (config.cycles > 0 && cycle >= config.cycles) break;
    if (config.durationHours > 0 && Date.now() - Date.parse(config.startedAt) >= config.durationHours * 3600000) break;
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: config.missionId } });
    let woken = 0, materialAdded = false;
    if (config.materialEvery > 0 && cycle % config.materialEvery === 0) {
      await db.capture.create({ data: { projectId: config.projectId, sourceType: "TEXT",
        rawText: "长时运行第 " + (cycle + 1) + " 轮材料：结果仍待独立核对。" } });
      await db.agentMission.update({ where: { id: config.missionId }, data: { nextAttemptAt: new Date(0) } });
      materialAdded = true;
    }
    if (row.status === "WAITING_INPUT" || row.status === "READY") {
      const scan = await processInvestigationDelegations(8);
      woken = scan.woken;
    }
    if ((await db.agentMission.findUniqueOrThrow({ where: { id: config.missionId } })).status === "READY") {
      await runMissionSlice({ id: config.missionId, provider });
    }
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: config.missionId } });
    const usage = after.budgetUsedJson as Record<string, number>;
    fs.appendFileSync(evidencePath, JSON.stringify({ at: stamp(), cycle, startedAt: config.startedAt,
      elapsedHours: (Date.now() - Date.parse(config.startedAt)) / 3600000, resumeCount: config.resumeCount ?? 0, materialAdded, woken, status: after.status,
      pauseReason: after.pauseReason, outputs: await db.agentMissionOutput.count({ where: { missionId: config.missionId } }),
      artifacts: elapsedArtifacts(after.planJson), models: usage.models ?? 0, tools: usage.tools ?? 0,
      reservedOutputTokens: usage.reservedOutputTokens ?? 0, inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
      unknownCalls: usage.unknownCalls ?? 0 }) + "\n");
    await new Promise(resolve => setTimeout(resolve, config.intervalMs));
    cycle++;
  }
  await db.$disconnect();
  writeConfig({ ...readConfig(), stoppedAt: stamp() });
}
function elapsedArtifacts(planJson: unknown): number {
  const plan = planJson as { skillArtifacts?: unknown[] };
  return Array.isArray(plan.skillArtifacts) ? plan.skillArtifacts.length : 0;
}

function status() {
  const config = readConfig();
  const file = config.dbPath, sql = fs.existsSync(file) ? new Database(file, { readonly: true }) : null;
  const mission = sql?.prepare('SELECT status,pauseReason,budgetUsedJson,version,contextVersion,planRevision,updatedAt FROM "AgentMission" WHERE id=?').get(config.missionId) as Record<string, unknown> | undefined;
  const outputs = sql ? (sql.prepare('SELECT COUNT(*) c, MAX(revision) latest FROM "AgentMissionOutput" WHERE missionId=?').get(config.missionId) as { c: number; latest: number | null }) : null;
  const checkpoints = sql ? (sql.prepare('SELECT COUNT(*) c FROM "AgentMissionEvent" WHERE missionId=? AND type=?').get(config.missionId, "CHECKPOINT_REACHED") as { c: number }) : null;
  sql?.close();
  const lines = readEvidence();
  const last = lines.at(-1), gaps = lines.slice(1).map((line, index) => (Date.parse(String(line.at)) - Date.parse(String(lines[index].at))) / 1000)
    .filter(seconds => seconds > Math.max(120, config.intervalMs / 1000 * 2.5));
  console.log(JSON.stringify({ out: outDir, workerPid: config.workerPid ?? null, workerAlive: isAlive(config.workerPid),
    schedulerTaskName: config.schedulerTaskName ?? null, stopRequestedAt: config.stopRequestedAt ?? null, startedAt: config.startedAt, durationHours: config.durationHours,
    elapsedHours: (Date.now() - Date.parse(config.startedAt)) / 3600000,
    resumeCount: config.resumeCount ?? 0, mission: mission ?? null, outputs, checkpoints, evidenceLines: lines.length,
    gapsOverLimit: gaps.length, lastEvidenceAt: last ? String(last.at) : null, lastEvidence: last ?? null }, null, 2));
}

function material() {
  const config = readConfig();
  const text = flag("text") ?? "用户在长时运行期间补充的材料，结果仍待核对。";
  const sql = new Database(config.dbPath);
  const capture = sql.prepare('INSERT INTO "Capture" ("id","projectId","rawText","sourceType","createdAt") VALUES (?,?,?,?,?)')
    .run("lr-" + randomUUID(), config.projectId, text, "TEXT", stamp());
  sql.prepare('UPDATE "AgentMission" SET "nextAttemptAt"=?, "updatedAt"=? WHERE "id"=?').run(0, stamp(), config.missionId);
  sql.close();
  console.log(JSON.stringify({ addedCapture: capture.changes === 1, missionId: config.missionId, text }, null, 2));
}

function resume() {
  const config = readConfig();
  if (isAlive(config.workerPid)) { console.log(JSON.stringify({ resumed: false, reason: "ALREADY_RUNNING", workerPid: config.workerPid }, null, 2)); return; }
  if (Date.now() - Date.parse(config.startedAt) >= config.durationHours * 3600000 || config.cycles > 0 && readEvidence().length >= config.cycles)
    throw new Error("原运行窗口已结束，请保留报告并使用新目录启动");
  fs.rmSync(path.join(outDir, "stop.flag"), { force: true });
  if (has("scheduled") || has("background-host")) {
    config.resumedAt = stamp(); config.resumeCount = (config.resumeCount ?? 0) + 1;
    delete config.stopRequestedAt; delete config.stoppedAt;
    launchWindows(config, has("scheduled") ? "Register" : "Background"); return;
  }
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/v2-long-run.ts"), "worker", "--out", outDir],
    { cwd: process.cwd(), env: { ...process.env, ...flags(), DATABASE_URL: databaseUrl(config.dbPath) },
      detached: true, stdio: ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")], windowsHide: true });
  config.workerPid = child.pid; config.resumedAt = stamp(); config.resumeCount = (config.resumeCount ?? 0) + 1;
  delete config.stopRequestedAt; delete config.stoppedAt;
  writeConfig(config); child.unref();
  console.log(JSON.stringify({ resumed: true, workerPid: child.pid, resumeCount: config.resumeCount, out: outDir }, null, 2));
}

function stop() {
  const config = readConfig();
  fs.writeFileSync(path.join(outDir, "stop.flag"), stamp());
  config.stopRequestedAt = stamp();
  writeConfig(config);
  // Cooperative stop preserves an in-flight receipt and cannot kill an unrelated recycled PID.
  console.log(JSON.stringify({ stopRequested: true, workerPid: config.workerPid ?? null, out: outDir, mode: "COOPERATIVE", note: "下一个心跳检查停止标志；用 status 确认退出" }, null, 2));
}

function report() {
  const config = readConfig();
  const lines = readEvidence();
  const coverage = assessRunCoverage(config, lines);
  const statuses = lines.reduce<Record<string, number>>((counts, line) => { const key = String(line.status); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
  const models = lines.map(line => Number(line.models ?? 0)), reserved = lines.map(line => Number(line.reservedOutputTokens ?? 0));
  const gaps = lines.slice(1).map((line, index) => (Date.parse(String(line.at)) - Date.parse(String(lines[index].at))) / 1000)
    .filter(seconds => seconds > Math.max(120, config.intervalMs / 1000 * 2.5));
  const dayBuckets = lines.reduce<Record<string, { cycles: number; outputs: number; models: number; materials: number }>>((buckets, line) => {
    const day = String(line.at).slice(0, 10); const bucket = buckets[day] ?? { cycles: 0, outputs: 0, models: 0, materials: 0 };
    bucket.cycles++; bucket.outputs = Math.max(bucket.outputs, Number(line.outputs ?? 0)); bucket.models = Number(line.models ?? 0);
    if (line.materialAdded) bucket.materials++; buckets[day] = bucket; return buckets;
  }, {});
  const report = { out: outDir, db: config.dbPath, missionId: config.missionId, createdAt: config.createdAt, startedAt: config.startedAt,
    stoppedAt: config.stoppedAt ?? null, resumeCount: config.resumeCount ?? 0,
    expectedHours: config.durationHours, actualHours: (Date.now() - Date.parse(config.startedAt)) / 3600000,
    cycles: lines.length, durationMs: lines.length > 1 ? Date.parse(String(lines.at(-1)?.at)) - Date.parse(String(lines[0]?.at)) : 0,
    gapsOverLimit: gaps.length, longestGapSeconds: gaps.length ? Math.max(...gaps) : 0, dayBuckets,
    statuses, maxOutputs: Math.max(0, ...lines.map(line => Number(line.outputs ?? 0))), maxArtifacts: Math.max(0, ...lines.map(line => Number(line.artifacts ?? 0))),
    budgetMonotonic: models.every((value, index) => index === 0 || value >= models[index - 1]),
    reservedReleased: reserved.every(value => value === 0), finalUnknownCalls: Number(lines.at(-1)?.unknownCalls ?? 0),
    wallClockComplete: coverage.wallClockComplete, coverage,
    note: "This report covers only the wall-clock window actually executed; it is not a claim of 72h uptime." };
  fs.writeFileSync(path.resolve(flag("report-out") ?? path.join(outDir, "report.json")), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

try {
  if (command === "start") await start();
  else if (command === "worker") await worker();
  else if (command === "status") status();
  else if (command === "material") material();
  else if (command === "resume") resume();
  else if (command === "stop") stop();
  else if (command === "report") report();
  else { console.error("用法：start|status|material|stop|report --out <dir>"); process.exitCode = 2; }
} catch (error) {
  console.error("长时运行命令失败：" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
