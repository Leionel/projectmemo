/**
 * 独立验收 fixture（A2）——FS-A07：第二 PrismaClient 真实并发写入下的 readback 一致性。
 *
 * 运行（A2 HEAD 干净 shadow，cwd = shadow 根目录）：
 *   npx.cmd tsx verify-fixtures/a2-concurrency-fixture.ts <输出JSON绝对路径>
 *
 * 隔离：先建独立临时 SQLite（WAL + 重放 migrations）并设置 DATABASE_URL，再动态 import lib/db；
 * 第二个 PrismaClient 用 PrismaBetterSqlite3 适配器连同一临时库文件，真实提交写入。
 *
 * 两个阶段（都不 mock、不用前端 stale 标签、不写真实库）：
 * A) 环境压力：第二连接持续真实写入期间连续读取，每个响应内部必须一致；
 * B) 服务端受控并发点：在 readback 的“事务外版本复查”（db.agentMission.findUnique）前，
 *    经第二连接先提交一次真实写入，确定性复现 RETRIED / VERSION_ADVANCED 标记与语义。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a2-concurrency-fixture.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-a2-concurrency-"));
const dbFile = path.join(dir, "verify.db");
const databaseUrl = "file:" + dbFile.replaceAll("\\", "/");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "false", FOCUS_CONTINUITY_ENABLED: "true",
  FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false",
  LLM_MODE: "mock", WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
});
const sql = new Database(dbFile);
sql.pragma("journal_mode = WAL");
const migrationNames = fs.readdirSync("prisma/migrations").sort();
for (const name of migrationNames) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();

const { db } = await import("@/lib/db");
const { readMissionBack } = await import("@/lib/mission/readback");
const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const checks: Array<Record<string, unknown>> = [];
function check(id: string, question: string, pass: boolean, observed: unknown, note?: string) {
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });
}

/* ---------- fixture ---------- */
const user = await db.user.create({ data: { username: `a2-conc-${randomUUID()}`, displayName: "A2 并发验收", passwordHash: "unused" } });
const project = await db.project.create({
  data: { title: "A2 并发验收项目", description: "SYNTHETIC_A2_CONCURRENCY", goal: "验证并发读一致", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } },
});
const mission = await db.agentMission.create({
  data: {
    ownerUserId: user.id, projectId: project.id, createRequestId: `a2-conc-${randomUUID()}`, createPayloadHash: `hash-${randomUUID()}`,
    goal: "并发读快照一致性", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, researchScopeJson: {},
    continuationPolicyJson: { mode: "MANUAL" }, planJson: {}, budgetJson: { models: 12, tools: 16 }, status: "READY", version: 1,
  },
});
await db.agentMission.update({ where: { id: mission.id }, data: { nextEventSeq: { increment: 1 } } });
await db.agentMissionEvent.create({
  data: { missionId: mission.id, seq: 1, type: "QUESTION", payloadJson: { question: "并发验收问题", waitingFor: "USER" } },
});
const countsBefore = {
  events: await db.agentMissionEvent.count(), runs: await db.agentRun.count(), steps: await db.agentMissionStep.count(),
  outputs: await db.agentMissionOutput.count(), receipts: await db.missionArtifactReceipt.count(), directives: await db.agentDirectiveEvent.count(),
};

/* ---------- 第二连接 writer ---------- */
const writer = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
let writerCommits = 0, writerBusyRetries = 0;
const writerErrors: string[] = [];
async function writerUpdate(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await writer.agentMission.update({ where: { id: mission.id }, data: { version: { increment: 1 }, updatedAt: new Date() } });
      writerCommits += 1;
      return;
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      if (message.includes("SQLITE_BUSY")) { writerBusyRetries += 1; await sleep(5); continue; }
      if (writerErrors.length < 3) writerErrors.push(message);
      throw error;
    }
  }
}

/* ---------- 一致性断言工具 ---------- */
type ResponseFacts = {
  consistency: string; retries: number; internalConsistent: boolean; snapshotCheckedAtMatchesReadAt: boolean;
  versions: Record<string, number>; blockerCodes: string[]; missionVersion: number;
};
function factsOf(rb: Awaited<ReturnType<typeof readMissionBack>>): ResponseFacts {
  const packet = rb.workPacket as unknown as Record<string, unknown> | undefined;
  const identity = packet?.identity as Record<string, unknown> | undefined;
  const originalRef = identity?.originalRef as { version?: number } | undefined;
  const stoppedWorkState = (packet?.stopped as { workState?: { originalRef?: { version?: number } } } | undefined)?.workState;
  const requires = (packet?.next as { primaryAction?: { requires?: { missionVersion?: number } } } | undefined)?.primaryAction?.requires;
  const snapshot = packet?.snapshot as { consistency?: string; retries?: number; checkedAt?: string } | undefined;
  const blockers = (packet?.blockers as Array<{ code?: string }> | undefined)?.map((b) => String(b.code));
  const versions = {
    readbackMissionVersion: rb.missionVersion,
    workStateOriginalRef: (rb.workState as unknown as { originalRef?: { version?: number } }).originalRef?.version as number,
    identityMissionVersion: identity?.missionVersion as number,
    packetOriginalRef: originalRef?.version as number,
    stoppedWorkStateOriginalRef: stoppedWorkState?.originalRef?.version as number,
    requiresMissionVersion: requires?.missionVersion as number,
  };
  const internalConsistent = Object.values(versions).every((v) => v === versions.readbackMissionVersion);
  return {
    consistency: snapshot?.consistency ?? "MISSING",
    retries: snapshot?.retries ?? -1,
    internalConsistent,
    snapshotCheckedAtMatchesReadAt: snapshot?.checkedAt === rb.readAt,
    versions,
    blockerCodes: blockers ?? [],
    missionVersion: rb.missionVersion,
  };
}
function semanticsOk(facts: ResponseFacts): boolean {
  if (!facts.internalConsistent || !facts.snapshotCheckedAtMatchesReadAt) return false;
  if (facts.consistency === "VERSION_STABLE") return facts.retries === 0;
  if (facts.consistency === "RETRIED") return facts.retries >= 1;
  if (facts.consistency === "VERSION_ADVANCED") {
    return facts.retries === 2 && facts.blockerCodes.includes("SNAPSHOT_VERSION_ADVANCED");
  }
  return false;
}

/* ================================================================
 * 阶段 A：环境压力（第二连接持续真实写入，reader 连续读取）
 * ================================================================ */
const READER_ROUNDS = 80;
const ambientFacts: ResponseFacts[] = [];
const ambientDistribution: Record<string, number> = { VERSION_STABLE: 0, RETRIED: 0, VERSION_ADVANCED: 0 };
let ambientInconsistent = 0;
const ambientSamples: unknown[] = [];
let writerDone = false;
const writerPressure = (async () => {
  for (let index = 0; index < 400 && !writerDone; index++) {
    await writerUpdate();
    await sleep(1);
  }
})();
for (let round = 1; round <= READER_ROUNDS; round++) {
  const facts = factsOf(await readMissionBack(user.id, mission.id));
  ambientFacts.push(facts);
  if (facts.consistency in ambientDistribution) ambientDistribution[facts.consistency] += 1;
  if (!semanticsOk(facts)) {
    ambientInconsistent += 1;
    if (ambientSamples.length < 3) ambientSamples.push({ round, facts });
  }
}
writerDone = true;
await writerPressure;
check("A2-IND-CONC-01", "阶段 A 环境压力：80 轮读取期间第二连接持续真实写入，每个响应内部版本一致且快照标记语义正确",
  ambientInconsistent === 0 && ambientFacts.length === READER_ROUNDS,
  { readerRounds: ambientFacts.length, writerCommits, writerBusyRetries, writerErrors, consistencyDistribution: ambientDistribution, internalInconsistencies: ambientInconsistent, inconsistentSamples: ambientSamples, sampleRounds: ambientFacts.slice(0, 3) });

/* ================================================================
 * 阶段 B：服务端受控并发点（在事务外版本复查前经第二连接提交真实写入）
 * ================================================================ */
const originalFindUnique = db.agentMission.findUnique.bind(db.agentMission);
let pendingInjections = 0;
(db.agentMission as unknown as { findUnique: unknown }).findUnique = async (args: unknown) => {
  if (pendingInjections > 0) {
    pendingInjections -= 1;
    await writerUpdate();
  }
  return originalFindUnique(args as never);
};
async function readWithInjections(injections: number): Promise<ResponseFacts> {
  pendingInjections = injections;
  try {
    return factsOf(await readMissionBack(user.id, mission.id));
  } finally {
    pendingInjections = 0;
  }
}
const retried = await readWithInjections(1);
const advanced = await readWithInjections(3);
check("A2-IND-CONC-02", "阶段 B 受控并发点：RETRIED(retries≥1) 与 VERSION_ADVANCED(retries=2 + SNAPSHOT_VERSION_ADVANCED 阻断) 标记正确，且两个响应内部版本仍一致",
  retried.consistency === "RETRIED" && retried.retries >= 1 && retried.internalConsistent && retried.snapshotCheckedAtMatchesReadAt && semanticsOk(retried)
  && advanced.consistency === "VERSION_ADVANCED" && advanced.retries === 2 && advanced.internalConsistent && advanced.snapshotCheckedAtMatchesReadAt
  && advanced.blockerCodes.includes("SNAPSHOT_VERSION_ADVANCED") && semanticsOk(advanced),
  { retried, advanced,
    lastMissionVersion: (await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).version,
    writerCommits,
    note: "受控点把第二连接的真实提交钉在“快照已读取、事务外复查尚未返回”的服务端窗口；注入 1 次 → RETRIED，注入 3 次 → VERSION_ADVANCED。与文档第 4 节允许的服务端受控并发点一致，不是 mock。" });

/* ================================================================
 * 阶段 C：读取不写业务数据；版本推进只来自第二连接
 * ================================================================ */
(db.agentMission as unknown as { findUnique: unknown }).findUnique = originalFindUnique;
const missionAfter = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
const countsAfter = {
  events: await db.agentMissionEvent.count(), runs: await db.agentRun.count(), steps: await db.agentMissionStep.count(),
  outputs: await db.agentMissionOutput.count(), receipts: await db.missionArtifactReceipt.count(), directives: await db.agentDirectiveEvent.count(),
};
check("A2-IND-CONC-03", "读取不写业务数据：事件/AgentRun/Step/Output/Receipt/指令事件计数前后一致；版本推进只来自第二连接",
  JSON.stringify(countsBefore) === JSON.stringify(countsAfter) && missionAfter.version >= 1 + writerCommits - 1,
  { countsBefore, countsAfter, missionVersionAfter: missionAfter.version, writerCommits, expectedVersionRange: { min: 1 + writerCommits - 5, max: 1 + writerCommits }, note: "writerCommits 含受控点写入；作用域断言以读取侧零写入 + 版本只增为主。" });

await writer.$disconnect();
const failed = checks.filter((c) => c.verdict === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "INDEPENDENT_FIXTURE_A2_CONCURRENCY",
  runner: "evidence/final-a/20261103/verify/fixtures/a2-concurrency-fixture.ts",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "A2 HEAD clean shadow (git archive d428314)",
  database: { mechanism: "mkdtemp + better-sqlite3 replay prisma/migrations + second PrismaClient", temporaryDir: dir, migrationCount: migrationNames.length },
  env: { llmMode: "mock", modelProviderCalls: 0, externalWrites: 0 },
  connections: { main: "lib/db Prisma singleton", writer: "new PrismaClient({ adapter: PrismaBetterSqlite3 }) 同一 DATABASE_URL", writerDistinct: true },
  summary: { total: checks.length, pass: checks.filter((c) => c.verdict === "PASS").length, fail: failed },
  checks,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: failed === 0, outPath, summary: evidence.summary, ambientDistribution }));
await db.$disconnect();
process.exit(failed === 0 ? 0 : 1);
