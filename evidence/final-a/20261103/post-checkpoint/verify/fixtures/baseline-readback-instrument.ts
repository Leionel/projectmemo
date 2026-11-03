/**
 * BEFORE_FIX 独立特征化 4/4：readMissionBack 的事务数/查询特征/重读上限/SourcePolicy≤8/GET 零副作用/无跨请求缓存。
 *
 * 运行（干净 shadow 根目录）：npx.cmd tsx verify-fixtures/baseline-readback-instrument.ts <输出JSON绝对路径>
 *
 * 观测手段不改产品源码：在 import lib/db 之前把自建 PrismaClient（使用同一 better-sqlite3 adapter、
 * 打开 query 事件日志）挂到 globalThis.prisma；lib/db 会复用该实例。然后包装该实例的 $transaction
 * 以计数（已用 probe 验证 own writable property）。所有 fixture 写在 mkdtemp 临时 SQLite，
 * migrations 按序重放，不读 .env、无模型/网络/外部写入。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx baseline-readback-instrument.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-base-instr-"));
const dbFile = path.join(dir, "verify.db");
process.env.DATABASE_URL = "file:" + dbFile.replaceAll("\\", "/");
Object.assign(process.env, {
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true",
  SEMANTIC_MEMORY_ENABLED: "false", LLM_MODE: "mock", WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
});
const sql = new Database(dbFile);
sql.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const m = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(m)) sql.exec(fs.readFileSync(m, "utf8"));
}
sql.close();

/* ---------- 注入带 query 日志的 PrismaClient + $transaction 计数 ---------- */
const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
const { PrismaClient } = await import("@/lib/generated/prisma/client");
const client: any = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL }), log: [{ emit: "event", level: "query" }] });
let queryBuffer: string[] = [];
client.$on("query", (event: { query: string }) => { queryBuffer.push(event.query); });
const origTransaction = client.$transaction.bind(client);
let txCount = 0;
let txHook: ((index: number) => Promise<void> | void) | null = null;
const patchedTransaction = async (...args: any[]) => {
  txCount += 1;
  const index = txCount;
  if (txHook) await txHook(index);
  return origTransaction(...args);
};
client.$transaction = patchedTransaction;
(globalThis as any).prisma = client;

const { db } = await import("@/lib/db");
const { createMission } = await import("@/lib/mission/missionService");
const { readMissionBack } = await import("@/lib/mission/readback");
const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
const { event } = await import("@/lib/mission/repository");
const { createSession } = await import("@/lib/auth/session");
const { GET: readbackGet } = await import("@/app/api/missions/[id]/readback/route");
const { AppError } = await import("@/lib/api");

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normQuery = (q: string) => q.replace(/\s+/g, " ").replace(/"[^"]*"/g, '"?"').replace(/\b-?\d+(\.\d+)?\b/g, "N").slice(0, 180);

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-instr-${label}-${randomUUID()}`, displayName: `独立验收 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: { title: `独立验收 readback 量测 ${label}`, description: "SYNTHETIC_POST_VERIFY_INSTRUMENT", goal: "readback 事务/查询量测", scenario: "RESEARCH" as never, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { user, project };
}
async function addEvent(missionId: string, type: string, payload: unknown) {
  const m = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: m.nextEventSeq, type, payloadJson: payload as never } });
}
async function createFor(userId: string, projectId: string, goal: string) {
  return createMission(userId, {
    projectId, requestId: `req-${randomUUID()}`, goal, successCriteria: ["DRAFT_EXISTS"],
    missionConstraints: {}, researchScope: {}, llmContextApproved: false, continuationPolicy: { mode: "MANUAL" },
  });
}
async function missionSnapshot(id: string) {
  const m = await db.agentMission.findUniqueOrThrow({ where: { id } });
  const [events, steps, approvals, outputs, receipts] = await Promise.all([
    db.agentMissionEvent.count({ where: { missionId: id } }), db.agentMissionStep.count({ where: { missionId: id } }),
    db.agentMissionApproval.count({ where: { missionId: id } }), db.agentMissionOutput.count({ where: { missionId: id } }),
    db.missionArtifactReceipt.count({ where: { missionId: id } }),
  ]);
  return plain({ version: m.version, status: m.status, updatedAt: m.updatedAt, nextEventSeq: m.nextEventSeq, budgetUsedJson: m.budgetUsedJson, lastErrorJson: m.lastErrorJson, counts: { events, steps, approvals, outputs, receipts } });
}
async function measured<T>(fn: () => Promise<T>) {
  queryBuffer = []; txCount = 0;
  const started = process.hrtime.bigint();
  const value = await fn();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { value, transactions: txCount, queries: queryBuffer.length, queryShapes: [...new Set(queryBuffer.map(normQuery))], elapsedMs: Math.round(elapsedMs * 100) / 100 };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "BEFORE_FIX readback 事务数/查询特征/重读上限/SourcePolicy≤8/GET 零副作用/跨请求缓存 独立量测",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace HEAD 4b69614 via git archive shadow",
  instrumentation: { method: "自建 PrismaClient(query event log) 注入 globalThis.prisma；包装 $transaction 计数；不改产品源码", db: dbFile },
  scenarios: {},
};

/* ---------- 场景 A：稳定读回 + 10 个来源（SourcePolicy 上限 8） ---------- */
{
  const { user, project } = await owner("stable");
  const m = await createFor(user.id, project.id, "独立验收：readback 稳定量测");
  const q = await addEvent(m.id, "QUESTION", { question: "稳定量测问题：显存是否超限？", missing: "PRIVATE", requirements: {} });
  const pointers: Array<{ id: string; hash: string }> = [];
  for (let i = 0; i < 10; i += 1) {
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: `2026-10-30 量测记录 ${i}：推理显存 ${5 + i * 0.3} GB，演示数据。` } });
    const source = await readProjectMaterial(project.id, `capture:${capture.id}`);
    if (!source) throw new Error("readProjectMaterial 失败");
    const pointer = { id: source.id, hash: source.hash };
    pointers.push(pointer);
    await addEvent(m.id, "SOURCE_ASSOCIATED", { questionId: q.id, pointers: [pointer] });
  }
  await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_INPUT", version: { increment: 1 }, waitStateJson: { waitingFor: "USER", questionId: q.id, question: "稳定量测问题：显存是否超限？", missing: "PRIVATE", requirements: {}, startedAt: new Date().toISOString() } } });
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const before = await missionSnapshot(m.id);
  const calls: any[] = [];
  for (let i = 0; i < 12; i += 1) {
    calls.push(await measured(() => readMissionBack(user.id, m.id, { questionId: q.id })));
  }
  const after = await missionSnapshot(m.id);
  const rb = calls[0].value;
  const ms = calls.map((c) => c.elapsedMs).sort((a, b) => a - b);
  const sources = (rb.materialUses?.items ?? []).map((item: any) => ({ id: item.sourcePointer.id, availability: item.availability, currentUse: item.currentUse?.state ?? null, revisionAvailability: item.revisionAvailability }));
  result.scenarios.stableReadback = {
    missionId: m.id, missionVersion: mission.version, questionId: q.id, sourcesPrepared: pointers.length,
    perCall: calls.map((c) => ({ transactions: c.transactions, queries: c.queries, elapsedMs: c.elapsedMs })),
    transactions: [...new Set(calls.map((c) => c.transactions))],
    queries: [...new Set(calls.map((c) => c.queries))],
    latencyMs: { min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] },
    queryShapesFirstCall: calls[0].queryShapes,
    consistency: rb.workPacket?.snapshot?.consistency ?? null, retries: rb.workPacket?.snapshot?.retries ?? null,
    materialUseItems: sources.length, sourceLimit: rb.materialUses?.coverage?.sourceLimit ?? null,
    sourceLimitReached: rb.materialUses?.coverage?.sourceLimitReached ?? null,
    currentUseStates: sources.map((s: any) => s.currentUse), availabilityStates: sources.map((s: any) => s.availability),
    sourcePolicyChecks: rb.materialUses?.coverage?.sourcePolicyChecks ?? null,
    materialCoverage: rb.materialUses?.coverage ?? null,
    evidenceWindow: (rb.workPacket?.coverage?.windows ?? []).find((w: any) => w.name === "EVIDENCE_REVIEWS") ?? null,
    readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) },
  };
}

/* ---------- 场景 B：一次版本推进 → 重读 1 次（RETRIED） ---------- */
{
  const { user, project } = await owner("retry1");
  const m = await createFor(user.id, project.id, "独立验收：readback 单次重读");
  // hook：第 2 个事务（第二只读复查事务）执行前推进版本一次
  let bumped = false;
  txHook = async (index) => { if (index === 2 && !bumped) { bumped = true; await origTransaction((tx: any) => tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 } } })); } };
  const run = await measured(() => readMissionBack(user.id, m.id));
  txHook = null;
  result.scenarios.retryOnce = {
    missionId: m.id, transactions: run.transactions, queries: run.queries, consistency: run.value.workPacket?.snapshot?.consistency ?? null,
    retries: run.value.workPacket?.snapshot?.retries ?? null, observedMissionVersion: run.value.missionVersion,
  };
}

/* ---------- 场景 C：持续推进 → 重读 2 次后停止（VERSION_ADVANCED，最多 2 次重读） ---------- */
{
  const { user, project } = await owner("retry2");
  const m = await createFor(user.id, project.id, "独立验收：readback 连续推进");
  txHook = async (index) => { if (index === 2 || index === 4 || index === 6) { await origTransaction((tx: any) => tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 } } })); } };
  const run = await measured(() => readMissionBack(user.id, m.id));
  txHook = null;
  result.scenarios.continuousAdvance = {
    missionId: m.id, transactions: run.transactions, queries: run.queries, consistency: run.value.workPacket?.snapshot?.consistency ?? null,
    retries: run.value.workPacket?.snapshot?.retries ?? null, observedMissionVersion: run.value.missionVersion,
    advancedBlocker: (run.value.workPacket?.blockers ?? []).some((b: any) => b.code === "SNAPSHOT_VERSION_ADVANCED"),
  };
}

/* ---------- 场景 D：两次 GET 不共享版本（无跨请求缓存）+ GET 零副作用 ---------- */
{
  const { user, project } = await owner("cache");
  const m = await createFor(user.id, project.id, "独立验收：GET 无跨请求缓存");
  const session = await createSession(user.id);
  const hdrs = { cookie: `pm_session=${session.token}` };
  const before = await missionSnapshot(m.id);
  const first = await measured(async () => {
    const res = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m.id}/readback`, { headers: hdrs }), { params: Promise.resolve({ id: m.id }) });
    return { status: res.status, cacheControl: res.headers.get("cache-control"), body: plain(await res.json()) };
  });
  await db.agentMission.update({ where: { id: m.id }, data: { version: { increment: 5 }, planRevision: { increment: 2 } } });
  await sleep(5);
  const second = await measured(async () => {
    const res = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m.id}/readback`, { headers: hdrs }), { params: Promise.resolve({ id: m.id }) });
    return { status: res.status, cacheControl: res.headers.get("cache-control"), body: plain(await res.json()) };
  });
  const after = await missionSnapshot(m.id);
  result.scenarios.crossRequestCache = {
    missionId: m.id,
    first: { status: first.value.status, cacheControl: first.value.cacheControl, transactions: first.transactions, queries: first.queries, version: first.value.body.readback?.missionVersion, readAt: first.value.body.readback?.readAt, planRevision: first.value.body.readback?.workPacket?.identity?.planRevision ?? null },
    second: { status: second.value.status, cacheControl: second.value.cacheControl, transactions: second.transactions, queries: second.queries, version: second.value.body.readback?.missionVersion, readAt: second.value.body.readback?.readAt, planRevision: second.value.body.readback?.workPacket?.identity?.planRevision ?? null },
    seenNewVersionAfterDbBump: second.value.body.readback?.missionVersion === first.value.body.readback?.missionVersion + 5,
    readAtDiffers: first.value.body.readback?.readAt !== second.value.body.readback?.readAt,
    sideEffectsOnlyFromOwnBump: { before, after, expectedVersionDelta: 5, expectedPlanRevisionDelta: 2 },
    getWrittenFieldsUnchangedExceptOwnBump: after.counts.events === before.counts.events && after.counts.steps === before.counts.steps && after.counts.outputs === before.counts.outputs && JSON.stringify(after.budgetUsedJson) === JSON.stringify(before.budgetUsedJson),
  };
}

/* ---------- 结论 ---------- */
function oldPackets() {
  // 兼容旧 A3 修改后脚本仍可复用：只依赖 readback 返回值。
  return undefined;
}
const a = result.scenarios.stableReadback, b = result.scenarios.retryOnce, c = result.scenarios.continuousAdvance, d = result.scenarios.crossRequestCache;
result.verdict = {
  stableTransactions: a.transactions, stableQueries: a.queries,
  retryOnceTransactions: b.transactions, retryOnceConsistency: b.consistency, retryOnceRetries: b.retries,
  continuousTransactions: c.transactions, continuousConsistency: c.consistency, continuousRetries: c.retries, maxTwoRetriesRespected: c.retries === 2 && c.transactions === 6,
  materialUseItemsAtMost8: a.materialUseItems <= 8 && a.sourceLimit === 8 && a.sourceLimitReached === true,
  sourcePolicyChecks: a.sourcePolicyChecks,
  sourcePolicyChecksAtMostItems: a.sourcePolicyChecks === null || a.sourcePolicyChecks <= a.materialUseItems,
  readbackZeroSideEffect: a.readOnly.identical && d.getWrittenFieldsUnchangedExceptOwnBump,
  crossRequestCacheAbsent: d.seenNewVersionAfterDbBump && d.readAtDiffers,
  noStoreHeader: d.first.cacheControl === "no-store" && d.second.cacheControl === "no-store",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, verdict: result.verdict }, null, 2));


