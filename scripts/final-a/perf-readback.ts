/**
 * A-新3：readback 查询数/事务数/SourcePolicy 检查数/JSON 字节/延迟量测（BEFORE/AFTER 对照）。
 *
 * 量测口径（方法在证据 method 字段中同样声明）：
 * - 只测“真实服务调用”：在独立临时 SQLite 上造代表性 Mission（6 份材料、证据审查事件、
 *   输出、成果回执、动作回执、观察事件、CHAT 运行回执），再真实调用 readMissionBack。
 * - 查询数用驱动级 SQL 语句计数：本脚本进程内包装 better-sqlite3 的
 *   Database.prototype.prepare/exec，只在本脚本进程+本次临时库生效；**不修改产品代码，
 *   不加 PRISMA_QUERY_LOG 门控，不影响 lib/db.ts、生产行为或其他测试**。
 * - BEGIN/COMMIT/ROLLBACK 单独计数（事务数），另用 db.$transaction 进程内 spy 交叉核对。
 * - SourcePolicy 检查数取 readback.materialUses.coverage.sourcePolicyChecks
 *   （materialUseProjection 每个 item 的 currentUse 判定次数，只读数字）。
 * - JSON 字节 = Buffer.byteLength(JSON.stringify(readback), "utf8")（Date 序列化为 ISO）。
 * - 延迟用 performance.now() 墙钟；N=30 最近邻百分位；SQLite 单机本地口径，
 *   不是线上/墙钟性能承诺。
 * - 零写入：量测窗口内驱动级 INSERT/UPDATE/DELETE/DDL 语句数 + 读前后业务表行数/
 *   Mission version/updatedAt 快照对比；受控重试的写入走第二连接，并在计数窗口内暂停
 *   计数，单独记录。
 *
 * 受控重试：spy db.$transaction，在“快照已读取、第二只读复查事务尚未返回”的窗口用第二
 * 连接真实提交 Mission 版本推进（写法与 tests/finalAConcurrencyService.test.ts 一致），
 * 分别得到 RETRIED(retries=1) 与 VERSION_ADVANCED(retries=2)。
 *
 * 证据审查窗口覆盖检查：fixture 造 3 条较早的目标 question 审查 + 24 条更新的其他
 * question 审查。BEFORE 代码“先取最近 21 条再按 questionId 过滤”，目标审查被挤出 →
 * hits=0（缺陷复现）；AFTER 代码“先按 questionId 过滤再限额” → hits=3（修复生效）。
 *
 * 运行：
 *   npx.cmd tsx scripts/final-a/perf-readback.ts --phase=BEFORE   # 检查点原始 readback
 *   npx.cmd tsx scripts/final-a/perf-readback.ts --phase=AFTER    # 仅证据审查窗口先筛后限
 *   npx.cmd tsx scripts/final-a/perf-readback.ts --phase=AFTER2   # 窗口修复 + 同请求只读复用
 *   npx.cmd tsx scripts/final-a/perf-readback.ts --merge          # 合并 BEFORE/AFTER/AFTER2 三栏对照
 * 退出码：0 = 量测完成且阶段内期望全部成立；非零 = 脚本失败或期望未成立（证据仍写出）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { MissionReadback } from "../../lib/mission/readback";
import type { Prisma, PrismaClient } from "../../lib/generated/prisma/client";
import {
  setupIsolatedDatabase,
  gitHead,
  probeSourceTree,
  writeEvidence,
  evidenceAbs,
  errorFacts,
  sha256,
  plain,
  repoRoot,
} from "./lib/probeSupport";
import { createOwner, createMission, addBoundSourcesStep, addAgentRun, DEFAULT_BUDGET } from "./lib/probeFixtures";

const EVIDENCE_BASE = "post-checkpoint/perf";
const RUNS_REL = (phase: string) => `${EVIDENCE_BASE}/runs/readback-perf-${phase}.json`;
const MERGED_REL = `${EVIDENCE_BASE}/readback-perf.json`;
const N_RUNS = Number(process.env.PERF_N ?? 30);
const WARMUP = Number(process.env.PERF_WARMUP ?? 3);
/** 契约窗口：先取最近 20 条（多取 1 条判断截断），每个问题最多展示 3 条。 */
const REVIEW_WINDOW = 20;
const REVIEW_DISPLAY = 3;
const TARGET_REVIEW_COUNT = 3;
const OTHER_QUESTION_REVIEW_COUNT = 24;

/* ===================== 1. 驱动级 SQL 语句计数（仅本进程） ===================== */

type SqlKind = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "DDL" | "BEGIN" | "COMMIT" | "ROLLBACK" | "PRAGMA" | "OTHER";
type SqlStatement = { sql: string; kind: SqlKind };
type Meter = { statements: SqlStatement[]; txCalls: number };

let meter: Meter | null = null;
const QUERY_KINDS: ReadonlySet<SqlKind> = new Set(["SELECT", "PRAGMA"]);

function classifySql(sql: string): SqlKind {
  const stripped = sql
    .replace(/^\s*(\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*/, "")
    .trim();
  const first = (stripped.split(/\s+/, 1)[0] ?? "").toUpperCase();
  if (first === "SELECT" || first === "WITH" || first === "EXPLAIN") return "SELECT";
  if (first === "INSERT" || first === "REPLACE") return "INSERT";
  if (first === "UPDATE") return "UPDATE";
  if (first === "DELETE") return "DELETE";
  if (["CREATE", "ALTER", "DROP", "VACUUM", "ANALYZE"].includes(first)) return "DDL";
  if (first === "BEGIN") return "BEGIN";
  if (first === "COMMIT" || first === "END") return "COMMIT";
  if (first === "ROLLBACK") return "ROLLBACK";
  if (first === "PRAGMA") return "PRAGMA";
  return "OTHER";
}

const sqlitePrototype = (Database as unknown as {
  prototype: { prepare: (...args: unknown[]) => unknown; exec: (...args: unknown[]) => unknown };
}).prototype;
const originalPrepare = sqlitePrototype.prepare;
const originalExec = sqlitePrototype.exec;
sqlitePrototype.prepare = function patchedPrepare(this: unknown, ...args: unknown[]) {
  if (meter) {
    const sql = String(args[0] ?? "");
    meter.statements.push({ sql, kind: classifySql(sql) });
  }
  return originalPrepare.apply(this, args);
};
sqlitePrototype.exec = function patchedExec(this: unknown, ...args: unknown[]) {
  if (meter) {
    const sql = String(args[0] ?? "");
    // exec 只出现在建库/迁移等非量测路径；量测窗口内出现即视为异常写入。
    meter.statements.push({ sql, kind: "OTHER" });
  }
  return originalExec.apply(this, args);
};

/* ============================ 2. 统计与工具函数 ============================ */

const WRITE_KINDS: ReadonlySet<SqlKind> = new Set(["INSERT", "UPDATE", "DELETE", "DDL"]);

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)]!;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length ? Math.round((sum / sorted.length) * 1000) / 1000 : 0,
    method: "nearest-rank percentiles over recorded runs",
  };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const rawSha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const roundMs = (value: number) => Math.round(value * 1000) / 1000;
const uniqueSorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

type ReadMeasure = {
  label: string;
  run: number;
  /** 驱动级查询语句数（SELECT/PRAGMA，不含事务语句）。 */
  queries: number;
  selectQueries: number;
  statementsTotal: number;
  byKind: Record<string, number>;
  /** 驱动级 BEGIN 数（事务数，主连接）。 */
  beginStatements: number;
  commitStatements: number;
  /** db.$transaction 调用数（主连接 spy）。 */
  transactionCalls: number;
  /** SourcePolicy currentUse 判定次数（materialUseProjection 只读数字）。 */
  sourcePolicyChecks: number | null;
  jsonBytes: number;
  jsonBytesBreakdown: { readback: number; workPacket: number; materialUses: number; evidenceReviews: number; callCoverage: number };
  latencyMs: number;
  writeStatements: number;
  consistency: string | null;
  retries: number | null;
};

async function measureRead(label: string, run: number, read: () => Promise<MissionReadback>): Promise<{ readback: MissionReadback; measure: ReadMeasure }> {
  const current: Meter = { statements: [], txCalls: 0 };
  const startedAt = performance.now();
  meter = current;
  try {
    const readback = await read();
    const elapsed = performance.now() - startedAt;
    const statements = current.statements;
    const byKind: Record<string, number> = {};
    for (const statement of statements) byKind[statement.kind] = (byKind[statement.kind] ?? 0) + 1;
    const materialCoverage = readback.materialUses.coverage as { sourcePolicyChecks?: number };
    const measure: ReadMeasure = {
      label,
      run,
      queries: statements.filter(statement => QUERY_KINDS.has(statement.kind)).length,
      selectQueries: byKind.SELECT ?? 0,
      statementsTotal: statements.length,
      byKind,
      beginStatements: byKind.BEGIN ?? 0,
      commitStatements: byKind.COMMIT ?? 0,
      transactionCalls: current.txCalls,
      sourcePolicyChecks: typeof materialCoverage.sourcePolicyChecks === "number" ? materialCoverage.sourcePolicyChecks : null,
      jsonBytes: jsonBytes(readback),
      jsonBytesBreakdown: {
        readback: jsonBytes(readback),
        workPacket: jsonBytes(readback.workPacket ?? null),
        materialUses: jsonBytes(readback.materialUses),
        evidenceReviews: jsonBytes(readback.evidenceReviews),
        callCoverage: jsonBytes(readback.callCoverage),
      },
      latencyMs: roundMs(elapsed),
      writeStatements: statements.filter(statement => WRITE_KINDS.has(statement.kind)).length,
      consistency: readback.workPacket?.snapshot?.consistency ?? null,
      retries: readback.workPacket?.snapshot?.retries ?? null,
    };
    return { readback, measure };
  } finally {
    meter = null;
  }
}

function aggregateMeasures(measures: ReadMeasure[]) {
  const queries = measures.map(measure => measure.queries);
  const transactions = measures.map(measure => measure.beginStatements);
  return {
    runs: measures.length,
    queryStats: stats(queries),
    queryUniqueValues: uniqueSorted(queries),
    selectQueryStats: stats(measures.map(measure => measure.selectQueries)),
    statementTotalStats: stats(measures.map(measure => measure.statementsTotal)),
    byKindTotals: measures.reduce<Record<string, number>>((totals, measure) => {
      for (const [kind, count] of Object.entries(measure.byKind)) totals[kind] = (totals[kind] ?? 0) + count;
      return totals;
    }, {}),
    transactionStats: stats(transactions),
    transactionUniqueValues: uniqueSorted(transactions),
    transactionCallsMatchBegin: measures.every(measure => measure.transactionCalls === measure.beginStatements),
    commitMatchBegin: measures.every(measure => measure.commitStatements === measure.beginStatements),
    sourcePolicyCheckStats: stats(measures.map(measure => measure.sourcePolicyChecks ?? 0)),
    sourcePolicyCheckUniqueValues: uniqueSorted(measures.map(measure => measure.sourcePolicyChecks ?? 0)),
    latencyMsStats: stats(measures.map(measure => measure.latencyMs)),
    jsonBytesStats: stats(measures.map(measure => measure.jsonBytes)),
    jsonBytesUniqueValues: uniqueSorted(measures.map(measure => measure.jsonBytes)),
    jsonBytesBreakdownMedian: {
      readback: measures[0]?.jsonBytesBreakdown.readback ?? 0,
      workPacket: measures[0]?.jsonBytesBreakdown.workPacket ?? 0,
      materialUses: measures[0]?.jsonBytesBreakdown.materialUses ?? 0,
      evidenceReviews: measures[0]?.jsonBytesBreakdown.evidenceReviews ?? 0,
      callCoverage: measures[0]?.jsonBytesBreakdown.callCoverage ?? 0,
    },
    consistencyDistribution: measures.reduce<Record<string, number>>((totals, measure) => {
      const key = measure.consistency ?? "NONE";
      totals[key] = (totals[key] ?? 0) + 1;
      return totals;
    }, {}),
    writeStatementsTotal: measures.reduce((total, measure) => total + measure.writeStatements, 0),
    runsDetail: measures,
  };
}

function queryHotspots(rawSql: SqlStatement[][], top = 25) {
  const counter = new Map<string, { count: number; kind: string; sample: string }>();
  for (const statements of rawSql) {
    for (const statement of statements) {
      const shape = statement.sql.replace(/\s+/g, " ").trim();
      const entry = counter.get(shape) ?? { count: 0, kind: statement.kind, sample: shape.length > 300 ? `${shape.slice(0, 300)}…` : shape };
      entry.count += 1;
      counter.set(shape, entry);
    }
  }
  const runs = Math.max(1, rawSql.length);
  return [...counter.entries()]
    .map(([, entry]) => ({ ...entry, perRead: Math.round((entry.count / runs) * 100) / 100 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

/* ============================== 3. 行数/副作用快照 ============================== */

async function sideEffectSnapshot(db: PrismaClient, missionId: string, projectId: string) {
  const [mission, events, steps, outputs, receipts, artifacts, actions, runs, approvals, directiveEvents] = await Promise.all([
    db.agentMission.findUniqueOrThrow({ where: { id: missionId }, select: { version: true, updatedAt: true, nextEventSeq: true, status: true, planRevision: true, contextVersion: true } }),
    db.agentMissionEvent.count({ where: { missionId } }),
    db.agentMissionStep.count({ where: { missionId } }),
    db.agentMissionOutput.count({ where: { missionId } }),
    db.missionArtifactReceipt.count({ where: { missionId } }),
    db.generatedArtifact.count({ where: { projectId } }),
    db.actionItem.count({ where: { projectId } }),
    db.agentRun.count({ where: { projectId } }),
    db.agentMissionApproval.count({ where: { missionId } }),
    db.agentDirectiveEvent.count({ where: { ownerUserId: (await db.agentMission.findUniqueOrThrow({ where: { id: missionId }, select: { ownerUserId: true } })).ownerUserId } }),
  ]);
  return {
    counts: { events, steps, outputs, receipts, artifacts, actions, runs, approvals, directiveEvents },
    mission: { version: mission.version, updatedAt: mission.updatedAt.toISOString(), nextEventSeq: mission.nextEventSeq, status: mission.status, planRevision: mission.planRevision, contextVersion: mission.contextVersion },
  };
}

function diffSnapshots(before: Awaited<ReturnType<typeof sideEffectSnapshot>>, after: Awaited<ReturnType<typeof sideEffectSnapshot>>) {
  const changed: Array<{ key: string; before: number | string; after: number | string }> = [];
  for (const key of Object.keys(before.counts) as Array<keyof typeof before.counts>) {
    if (before.counts[key] !== after.counts[key]) changed.push({ key: `counts.${key}`, before: before.counts[key], after: after.counts[key] });
  }
  for (const key of Object.keys(before.mission) as Array<keyof typeof before.mission>) {
    if (before.mission[key] !== after.mission[key]) changed.push({ key: `mission.${key}`, before: before.mission[key], after: after.mission[key] });
  }
  return changed;
}

/* ================================ 4. fixture ================================ */

const FIT_RULE_VERSION = "evidence-fit-v1";

/**
 * 造 evidenceFit 事件载荷：形状按 fitContextSummary() 的输入（assessEvidenceFit 结果）构造，
 * readback 会再用 fitContextSummary() 投影成证据审查摘要。
 */
function evidenceFitPayload(questionId: string, seed: number) {
  const fitStatus = seed % 4 === 0 ? "NOT_FIT" : seed % 3 === 0 ? "PARTIAL" : "FIT";
  return {
    fitHash: sha256({ purpose: "evidence-fit", questionId, seed }),
    review: { mode: seed % 3 === 0 ? "ANSWERING_EVIDENCE" : "CHECKING_EVIDENCE", reviewedAt: new Date(Date.now() - seed * 60_000).toISOString() },
    observationExcerpts: [{ observationGroup: "group-1", excerpt: `证据审查摘录 #${seed}：排队时长与样本数需同条件复核。` }],
    evidenceFit: {
      ruleVersion: FIT_RULE_VERSION,
      fitStatus,
      premise: {
        questionId,
        premiseHash: sha256({ purpose: "premise", questionId, seed }),
        constraintsVersion: 2,
        scopeVersion: 2,
        measurement: "SAMPLE_COUNT",
        checks: [{ id: "check-count", expected: "至少 2 条独立观察" }],
      },
      groups: [{
        sourceId: `capture:evidence-${seed}`,
        hash: sha256({ purpose: "group", seed }),
        revision: 1,
        observationGroup: "group-1",
        origin: "PROJECT_OBSERVATION",
        sourceState: "CURRENT",
        fitStatus,
        measurementValue: seed % 3,
        measurementResult: fitStatus === "FIT" ? "MATCH" : fitStatus === "PARTIAL" ? "INSUFFICIENT" : "EXCEEDS_LIMIT",
        spans: [],
        checks: [{ checkId: "check-count", status: fitStatus === "FIT" ? "PASS" : "UNRESOLVED", reasonCode: fitStatus === "FIT" ? null : "INSUFFICIENT_OBSERVATIONS" }],
      }],
      eligibleGroups: fitStatus === "NOT_FIT" ? [] : ["group-1"],
      excludedGroups: fitStatus === "NOT_FIT" ? ["group-1"] : [],
      unresolvedChecks: fitStatus === "FIT" ? [] : ["check-count"],
      conflicts: [],
      coverage: { groupsInspected: 1, groupsEligible: 1, omittedGroups: 0 },
    },
  };
}

type PerfFixture = Awaited<ReturnType<typeof buildFixture>>;

async function buildFixture(db: PrismaClient, phase: string) {
  const owner = await createOwner(db, `perf-readback-${phase.toLowerCase()}`);
  const projectId = owner.projectId;
  const now = Date.now();
  const mission = await createMission(db, owner, {
    status: "WAITING_INPUT",
    goal: "核对演示环境启动成功率并形成同条件对照记录",
    version: 7,
    planRevision: 3,
    contextVersion: 4,
    constraintsVersion: 2,
    constraintsJson: {
      deadline: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
      executionBoundary: "READ_ANALYZE",
      llmContextApproved: true,
    },
    continuationPolicyJson: { mode: "MANUAL" },
    planJson: { delegation: { lastObservedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() } },
    budgetJson: DEFAULT_BUDGET,
    budgetUsedJson: { models: 4, tools: 6, inputTokens: 9000, outputTokens: 1800, metadataRequests: 3, unknownCalls: 0 },
  });
  const missionId = mission.id;

  let seq = 0;
  const addEventRaw = async (type: string, payloadJson: unknown, createdAt?: Date) => {
    seq += 1;
    return db.agentMissionEvent.create({
      data: { missionId, seq, type, payloadJson: payloadJson as Prisma.InputJsonValue, ...(createdAt ? { createdAt } : {}) },
    });
  };

  // 原问题（readMissionBack 的 questionId 必须是真实 QUESTION 事件 id）。
  const question = await addEventRaw("QUESTION", { question: "请补充启动日志的原始对照记录：同一环境、同一条目至少 2 次。", requirements: { sourceType: "EITHER" } });
  const questionId = question.id;

  // 6 份项目材料：SOURCE_ARRIVED/SOURCE_ASSOCIATED 事件 + bind_project_sources 成功步骤。
  const materials: Array<{ captureId: string; pointer: { id: string; hash: string }; text: string; bindStepId: string }> = [];
  const { readProjectMaterial } = await import("../../lib/mission/sourceSignals");
  for (let index = 0; index < 6; index++) {
    const rawText = [
      `2026-10-${String(20 + index).padStart(2, "0")} 原始记录 #${index + 1}：演示环境启动日志需现场核对，安装自报不等于启动成功。`,
      `记录人：项目成员 ${index + 1}；观察窗口：20:0${index}–20:2${index}；样本数：${index + 1}。`,
      `备注：本条只作为原记录片段，是否支持结论仍以同条件对照为准。`,
    ].join("\n");
    const capture = await db.capture.create({ data: { projectId, rawText, sourceType: "记录" } });
    const source = await readProjectMaterial(projectId, `capture:${capture.id}`);
    if (!source) throw new Error(`readProjectMaterial 失败：capture:${capture.id}`);
    const pointer = { id: source.id, hash: source.hash };
    const bindStep = await addBoundSourcesStep(db, { missionId, questionId, pointer, text: source.text.slice(0, 300), ordinal: index + 1 });
    if (index < 5) await addEventRaw("SOURCE_ARRIVED", { questionId, sourcePointer: pointer, readable: true }, new Date(now - (6 - index) * 60_000));
    if (index < 2) await addEventRaw("SOURCE_ASSOCIATED", { questionId, pointers: [pointer] }, new Date(now - (6 - index) * 30_000));
    materials.push({ captureId: capture.id, pointer, text: source.text, bindStepId: bindStep.id });
  }

  // 输出与回执：2 个成果版本，每个带 EXACT_QUOTE 引用与成果采纳回执。
  const outputRows: Array<{ id: string; revision: number }> = [];
  const receipts: Array<{ id: string; artifactId: string }> = [];
  for (let index = 0; index < 2; index++) {
    const picks = materials.slice(index, index + 3);
    const blocks = picks.map((material) => ({
      kind: "SUMMARY",
      text: `对照记录 ${material.captureId.slice(0, 6)}：已记录原始观察。`,
      sourceIds: [material.pointer.id],
      citations: [{ sourceId: material.pointer.id, start: 0, end: 24, excerptHash: rawSha256(material.text.slice(0, 24)) }],
    }));
    const sourceRefsJson = picks.map((material) => ({
      id: material.pointer.id, kind: "PROJECT", entityType: "CAPTURE", revision: material.pointer.hash, hash: material.pointer.hash, text: material.text,
    }));
    const output = await db.agentMissionOutput.create({
      data: {
        missionId,
        revision: index + 1,
        kind: "DRAFT",
        contentJson: { blocks } as Prisma.InputJsonValue,
        sourceRefsJson: sourceRefsJson as Prisma.InputJsonValue,
        claimChecksJson: {} as Prisma.InputJsonValue,
      },
    });
    outputRows.push({ id: output.id, revision: output.revision });
    const artifact = await db.generatedArtifact.create({
      data: { projectId, artifactType: "weekly_report", content: `成果版本 ${index + 1}：启动日志同条件对照记录。`, sourceRefs: { sources: sourceRefsJson.map(({ id, hash, text }) => ({ id, hash, text })) } as Prisma.InputJsonValue },
    });
    const receipt = await db.missionArtifactReceipt.create({
      data: {
        projectId, missionId, outputId: output.id, outputRevision: output.revision,
        outputHash: sha256({ output: output.id, revision: output.revision }),
        artifactId: artifact.id, artifactType: "weekly_report",
        sourceManifestJson: { sources: sourceRefsJson.map(({ id, hash }) => ({ id, hash })) } as Prisma.InputJsonValue,
        blockMapJson: {} as Prisma.InputJsonValue,
        verificationSnapshotJson: { verificationStatus: output.verificationStatus } as Prisma.InputJsonValue,
        createdByUserId: owner.userId,
        requestId: `perf-receipt-${index}-${randomUUID()}`,
        payloadHash: sha256({ receipt: index }),
      },
    });
    receipts.push({ id: receipt.id, artifactId: artifact.id });
  }

  // 动作回执：3 个已完成行动，对应 SUCCEEDED 步骤（resultJson.data.actionId）。
  const actionRows: Array<{ id: string; title: string }> = [];
  for (let index = 0; index < 3; index++) {
    const action = await db.actionItem.create({
      data: {
        projectId,
        title: `按原记录补一次同条件观测 #${index + 1}`,
        status: "DONE",
        completedAt: new Date(now - (index + 1) * 60_000),
        isSimulated: false,
      },
    });
    actionRows.push({ id: action.id, title: action.title });
    await db.agentMissionStep.create({
      data: {
        missionId, ordinal: 7 + index, planRevision: 3, toolName: "create_action", status: "SUCCEEDED",
        canonicalInputJson: { actionId: action.id } as Prisma.InputJsonValue,
        inputHash: `perf-action-input-${index}-${randomUUID()}`, readSetJson: [] as Prisma.InputJsonValue,
        resultJson: { data: { actionId: action.id } } as Prisma.InputJsonValue,
        finishedAt: new Date(now - (index + 1) * 120_000),
      },
    });
  }

  // 本委托的 CHAT 运行回执 + COPILOT_HANDOFF：调用覆盖/materialUses CONTEXT_POINTER 需要。
  const runs: Array<{ id: string }> = [];
  for (let index = 0; index < 3; index++) {
    const run = await addAgentRun(db, {
      projectId,
      createdAt: new Date(now - (index + 1) * 5 * 60_000),
      trace: {
        purpose: "MISSION_INVESTIGATION",
        missionId,
        contextManifest: {
          includedStepIds: materials.slice(0, 2).map(material => material.bindStepId),
          sourcePointers: materials.slice(0, 2).map(material => material.pointer),
        },
      },
    });
    runs.push(run);
  }
  await addEventRaw("COPILOT_HANDOFF", { sourceRunId: runs[0]!.id, questionId }, new Date(now - 20 * 60_000));

  // 观察事件：成功观察、无新信息、明确声明的工具观察失败、用户停止（不是观察失败）。
  await addEventRaw("INVESTIGATION_NO_NEW_INFORMATION", { questionId }, new Date(now - 90 * 60_000));
  await addEventRaw("EXECUTION_STOPPED", { purpose: "DECLARED_OBSERVATION", phase: "TOOL", category: "TOOL_FAILURE", code: "TOOL_TIMEOUT", recovery: { kind: "RETRYABLE" } }, new Date(now - 70 * 60_000));
  await addEventRaw("EXECUTION_STOPPED", { purpose: "DECLARED_OBSERVATION", phase: "TOOL", category: "TOOL_FAILURE", code: "STOP_REQUESTED", recovery: { kind: "STOP_REQUESTED" } }, new Date(now - 60 * 60_000));
  await addEventRaw("INVESTIGATION_OBSERVATION_CHANGED", { questionId }, new Date(now - 30 * 60_000));

  // 待批提案（责任视图 pendingOriginalRefs）：需要一个 WAITING_APPROVAL 步骤承载。
  const approvalStep = await db.agentMissionStep.create({
    data: {
      missionId, ordinal: 20, planRevision: 3, toolName: "propose_correction", status: "WAITING_APPROVAL",
      canonicalInputJson: {} as Prisma.InputJsonValue, inputHash: `perf-approval-input-${randomUUID()}`, readSetJson: [] as Prisma.InputJsonValue,
    },
  });
  await db.agentMissionApproval.create({
    data: {
      missionId, stepId: approvalStep.id, proposalHash: sha256({ proposal: "perf" }),
      proposalJson: { questionId, correction: "把样本数改为 2 次同条件观测" } as Prisma.InputJsonValue,
      expectedPlanRevision: 3, readSetJson: [] as Prisma.InputJsonValue,
      status: "PENDING", expiresAt: new Date(now + 60 * 60 * 1000),
    },
  });

  // 证据审查事件：先插入目标 question 的 3 条较早记录，再插入 24 条其他 question 的更新记录。
  // BEFORE 代码取最近 21 条后过滤 → 目标 question 被挤出（缺陷）；AFTER 代码先过滤再限额 → 命中。
  const targetReviewEventIds: string[] = [];
  for (let index = 0; index < TARGET_REVIEW_COUNT; index++) {
    const row = await addEventRaw("EVIDENCE_FIT_REVIEWED", evidenceFitPayload(questionId, 100 + index), new Date(now - (10 - index) * 24 * 60 * 60 * 1000));
    targetReviewEventIds.push(row.id);
  }
  const otherReviewEventIds: string[] = [];
  for (let index = 0; index < OTHER_QUESTION_REVIEW_COUNT; index++) {
    const row = await addEventRaw("EVIDENCE_FIT_REVIEWED", evidenceFitPayload(`other-question-${index}`, 200 + index), new Date(now - (index + 1) * 60 * 60 * 1000));
    otherReviewEventIds.push(row.id);
  }

  await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: seq, waitStateJson: { questionId, waitingFor: "USER", startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() } as Prisma.InputJsonValue } });

  return {
    owner,
    missionId,
    questionId,
    materials,
    outputRows,
    receipts,
    actionRows,
    runs,
    targetReviewEventIds,
    otherReviewEventIds,
    eventCount: seq,
    expected: {
      materialItems: 6,
      materialItemFacts: ["SAVED", "BOUND", "CANDIDATE", "ASSOCIATED", "OUTPUT_REFERENCE", "EXACT_QUOTE", "ARTIFACT_ADOPTION", "CONTEXT_POINTER"],
      sourcePolicyChecks: 6,
      targetReviewsInDb: TARGET_REVIEW_COUNT,
      otherReviewsInDb: OTHER_QUESTION_REVIEW_COUNT,
    },
  };
}

/* ============================== 5. 受控重试量测 ============================== */

async function measureInjectedRead(
  db: PrismaClient,
  writer: PrismaClient,
  fixture: PerfFixture,
  label: string,
  injections: number,
  read: () => Promise<MissionReadback>,
) {
  let remaining = injections;
  let calls = 0;
  let writerWrites = 0;
  const innerTransaction = (db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> }).$transaction;
  const outerTransaction = (async (...args: unknown[]) => {
    calls += 1;
    // 偶数次调用 = 第二只读复查事务前：用第二连接真实推进版本，复现 RETRIED/VERSION_ADVANCED。
    if (calls % 2 === 0 && remaining > 0) {
      remaining -= 1;
      const saved = meter;
      meter = null; // 写入不属于读取量测窗口，暂停计数后单独记录。
      try {
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await writer.agentMission.update({ where: { id: fixture.missionId }, data: { version: { increment: 1 }, updatedAt: new Date() } });
            writerWrites += 1;
            break;
          } catch (error) {
            const code = String((error as { code?: string }).code ?? "");
            if (code.includes("SQLITE_BUSY") || String(error).includes("SQLITE_BUSY")) {
              await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
              continue;
            }
            throw error;
          }
        }
      } finally {
        meter = saved;
      }
    }
    return innerTransaction(...args);
  }) as never;
  (db as unknown as { $transaction: unknown }).$transaction = outerTransaction;
  const beforeVersion = (await db.agentMission.findUniqueOrThrow({ where: { id: fixture.missionId }, select: { version: true } })).version;
  try {
    const measured = await measureRead(label, 0, read);
    const afterVersion = (await db.agentMission.findUniqueOrThrow({ where: { id: fixture.missionId }, select: { version: true } })).version;
    return {
      ...measured,
      injectedWrites: injections,
      writerWrites,
      writerWriteWindow: "第二只读复查事务前（快照已读取、复查尚未返回）",
      transactionCallsObserved: calls,
      missionVersionBefore: beforeVersion,
      missionVersionAfter: afterVersion,
    };
  } finally {
    (db as unknown as { $transaction: unknown }).$transaction = innerTransaction;
  }
}

/* ================================ 6. 主量测 ================================ */

function sourceFileHashes() {
  const files = [
    "lib/mission/readback.ts",
    "lib/mission/materialUseProjection.ts",
    "lib/mission/responsibility.ts",
    "lib/continuity/sourcePolicy.ts",
    "lib/db.ts",
    "lib/mission/workPacket.ts",
    "scripts/final-a/perf-readback.ts",
  ];
  return Object.fromEntries(files.map((file) => {
    try {
      return [file, sha256(fs.readFileSync(path.join(repoRoot, file), "utf8"))];
    } catch {
      return [file, "UNREADABLE"];
    }
  }));
}

function environmentFacts(env: ReturnType<typeof setupIsolatedDatabase>, phase: string) {
  let gitStatus = "";
  let gitBranch = "";
  try {
    gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim();
    gitBranch = execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    gitStatus = "UNKNOWN";
  }
  return {
    phase,
    capturedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai (UTC+8)",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      packageManager: "npm.cmd",
      typescriptRunner: "tsx",
      betterSqlite3: (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(repoRoot, "node_modules/better-sqlite3/package.json"), "utf8")).version as string;
        } catch {
          return "UNKNOWN";
        }
      })(),
    },
    git: { head: gitHead(), branch: gitBranch || "UNKNOWN", statusPorcelainEntries: gitStatus ? gitStatus.split("\n").length : 0, statusPorcelain: gitStatus ? gitStatus.split("\n").slice(0, 80) : [] },
    sourceTree: probeSourceTree() === "working-tree" ? `working-tree @${gitHead()} (${phase})` : probeSourceTree(),
    worktree: repoRoot,
    database: {
      kind: "isolated-temporary-sqlite",
      url: env.databaseUrl,
      temporaryDir: env.dir,
      journalMode: "WAL",
      migrationsApplied: env.migrationsApplied,
      schemaTables: env.schemaTables,
      seededFrom: "prisma/migrations/*/migration.sql replayed with better-sqlite3 + WAL",
    },
    provider: { llmMode: process.env.LLM_MODE, modelProviderCalls: 0, networkCalls: 0 },
    worker: { started: false, workerPresenceFile: process.env.WORKER_PRESENCE_FILE },
  };
}

async function runPhase(phase: string): Promise<number> {
  const startedAt = Date.now();
  const env = setupIsolatedDatabase(`perf-readback-${phase.toLowerCase()}`);
  const { db } = await import("../../lib/db");
  const { readMissionBack } = await import("../../lib/mission/readback");
  const { PrismaClient } = await import("../../lib/generated/prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  const writer: PrismaClient = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: env.databaseUrl }) });

  // 事务计数用 db.$transaction 进程内 spy；驱动级 BEGIN/COMMIT 作为交叉核对。
  const baseTransaction = (db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> }).$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  const instrumentedTransaction = ((...args: unknown[]) => {
    if (meter) meter.txCalls += 1;
    return baseTransaction(...args);
  }) as never;
  (db as unknown as { $transaction: unknown }).$transaction = instrumentedTransaction;

  const checks: Array<{ name: string; expected: unknown; actual: unknown; pass: boolean }> = [];
  const check = (name: string, expected: unknown, actual: unknown) => checks.push({ name, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) });

  try {
    const fixture = await buildFixture(db, phase);
    const read = () => readMissionBack(fixture.owner.userId, fixture.missionId, { questionId: fixture.questionId });
    const readAfterWarmup = async () => {
      const back = await read();
      if (!back.workPacket) throw new Error("workPacket 缺失：readback 构建失败");
      return back;
    };

    // 3 次预热（不计入 N），随后 N=30 稳定读取。
    for (let index = 0; index < WARMUP; index++) await readAfterWarmup();
    const beforeSnapshot = await sideEffectSnapshot(db, fixture.missionId, fixture.owner.projectId);
    const stableMeasures: ReadMeasure[] = [];
    let lastStable: MissionReadback | null = null;
    for (let index = 0; index < N_RUNS; index++) {
      const measured = await measureRead("stable", index + 1, readAfterWarmup);
      stableMeasures.push(measured.measure);
      lastStable = measured.readback;
    }
    const afterSnapshot = await sideEffectSnapshot(db, fixture.missionId, fixture.owner.projectId);

    const stableAggregate = aggregateMeasures(stableMeasures);
    const readback = lastStable!;
    // 单独采集一次读取的完整 SQL 原文（用于热点聚合；不影响稳定统计）。
    const hotspotStatements: SqlStatement[] = [];
    {
      const current: Meter = { statements: hotspotStatements, txCalls: 0 };
      meter = current;
      try {
        await readAfterWarmup();
      } finally {
        meter = null;
      }
    }
    const hotspots = queryHotspots([hotspotStatements], 25);

    // 受控重试：1 次写入 → RETRIED(retries=1)；3 次写入 → VERSION_ADVANCED(retries=2)。
    const retried = await measureInjectedRead(db, writer, fixture, "retried", 1, readAfterWarmup);
    const advanced = await measureInjectedRead(db, writer, fixture, "advanced", 3, readAfterWarmup);

    const material = readback.materialUses;
    const evidenceReviews = readback.evidenceReviews;
    const reviewsCoverage = (evidenceReviews as { coverage?: Record<string, unknown> }).coverage ?? null;
    const questionFiltered = Boolean((evidenceReviews as { questionFiltered?: boolean }).questionFiltered);
    const targetHits = evidenceReviews.items.length;
    const targetHitQuestionIds = [...new Set(evidenceReviews.items.map(item => (item as { premise?: { questionId?: string } }).premise?.questionId))];
    const windowStatus = phase === "BEFORE"
      ? targetHits === 0 ? "REPRODUCED_SQUEEZE_BY_OTHER_QUESTIONS" : "UNEXPECTED_NOT_SQUEEZED"
      : targetHits === TARGET_REVIEW_COUNT && questionFiltered ? "FIXED_QUESTION_FILTERED_FIRST" : "UNEXPECTED_WINDOW_RESULT";
    const expectedWindowStatus = phase === "BEFORE" ? "REPRODUCED_SQUEEZE_BY_OTHER_QUESTIONS" : "FIXED_QUESTION_FILTERED_FIRST";

    check("stable.runs", N_RUNS, stableMeasures.length);
    check("stable.consistency.all.VERSION_STABLE", N_RUNS, stableMeasures.filter(measure => measure.consistency === "VERSION_STABLE").length);
    check("stable.transactions.perRead", [2], stableAggregate.transactionUniqueValues);
    check("stable.transactionCallsMatchBegin", true, stableAggregate.transactionCallsMatchBegin);
    check("stable.commitMatchBegin", true, stableAggregate.commitMatchBegin);
    check("stable.sourcePolicyChecks", [fixture.expected.sourcePolicyChecks], stableAggregate.sourcePolicyCheckUniqueValues);
    check("stable.materialItems", fixture.expected.materialItems, material.items.length);
    check("stable.writeStatementsTotal", 0, stableAggregate.writeStatementsTotal);
    check("stable.sideEffects", [], diffSnapshots(beforeSnapshot, afterSnapshot));
    check("retried.consistency", "RETRIED", retried.measure.consistency);
    check("retried.retries", 1, retried.measure.retries);
    check("retried.transactions", 4, retried.measure.beginStatements);
    check("retried.transactionCalls", 4, retried.transactionCallsObserved);
    check("advanced.consistency", "VERSION_ADVANCED", advanced.measure.consistency);
    check("advanced.retries", 2, advanced.measure.retries);
    check("advanced.transactions", 6, advanced.measure.beginStatements);
    check("advanced.transactionCalls", 6, advanced.transactionCallsObserved);
    check("window.status", expectedWindowStatus, windowStatus);

    // 证据审查窗口覆盖事实（BEFORE 记录缺陷，AFTER 记录修复）。
    const windowCorrectness = {
      selectedQuestionId: fixture.questionId,
      targetReviewEventsInDb: fixture.expected.targetReviewsInDb,
      newerOtherQuestionReviewEventsInDb: fixture.expected.otherReviewsInDb,
      phase,
      status: windowStatus,
      hits: targetHits,
      hitQuestionIds: targetHitQuestionIds,
      questionFilteredFieldPresent: questionFiltered,
      truncated: evidenceReviews.truncated,
      returnedItems: evidenceReviews.items.length,
      reviewWindow: REVIEW_WINDOW,
      reviewDisplayLimit: REVIEW_DISPLAY,
      coverage: plain(reviewsCoverage),
      note: phase === "BEFORE"
        ? "BEFORE 代码先取全 Mission 最近 21 条 EVIDENCE_FIT_REVIEWED 再按 questionId 过滤：24 条更新的其他问题审查会挤出 3 条较早的目标问题审查，hits=0（缺陷复现，不是“从未发生”）。"
        : "AFTER 代码先用 json_extract(payloadJson,'$.evidenceFit.premise.questionId') 按选中 questionId 过滤再限额 21/20：hits=3，truncated 只表示目标问题窗口溢出。",
    };

    const byKind = stableAggregate.byKindTotals;
    const perRead = (kind: string) => Math.round(((byKind[kind] ?? 0) / Math.max(1, stableMeasures.length)) * 100) / 100;
    const failedChecks = checks.filter(item => !item.pass);
    const exitCode = failedChecks.length === 0 ? 0 : 1;

    const payload = {
      status: failedChecks.length === 0 ? "PROBE_COMPLETED" : "PROBE_COMPLETED_WITH_FAILED_CHECKS",
      exitCode,
      durationMs: Date.now() - startedAt,
      command: `npx.cmd tsx scripts/final-a/perf-readback.ts --phase=${phase}`,
      method: {
        subject: "真实 readMissionBack(userId, missionId, {questionId})，独立临时 SQLite + 代表性 fixture；不调用模型/网络/Worker。",
        queryCount: "每次读取期间主连接在 better-sqlite3 驱动层实际 prepare 的 SQL 语句数（SELECT/PRAGMA 计为查询，BEGIN/COMMIT 单独计为事务语句）。",
        meterScope: "仅本脚本进程 + 本次临时库：启动时包装 better-sqlite3 Database.prototype.prepare/exec；不修改产品代码、lib/db.ts、Prisma schema 或其他测试，默认行为不变。",
        classification: "按 SQL 首关键字：SELECT/INSERT/UPDATE/DELETE/DDL/BEGIN/COMMIT/ROLLBACK/PRAGMA/OTHER。",
        transactionCount: "主连接 db.$transaction 进程内 spy 调用数，并与驱动级 BEGIN/COMMIT 语句数交叉核对。",
        sourcePolicyChecks: "readback.materialUses.coverage.sourcePolicyChecks：materialUseProjection 每个 item 的 currentUse 判定次数（只读数字，不改变判定）。",
        jsonBytes: "Buffer.byteLength(JSON.stringify(readback),'utf8')；Date 序列化为 ISO 字符串。",
        latency: "performance.now() 墙钟毫秒；百分位为最近邻法；SQLite 单机本地口径，不是线上/墙钟性能承诺。",
        zeroWrites: "量测窗口内驱动级 INSERT/UPDATE/DELETE/DDL 语句数 + 读前后业务表行数/Mission version/updatedAt 快照对比；受控重试写入由第二连接执行，量测窗口内暂停计数并单独记录。",
        controlledRetry: "spy db.$transaction：在快照已读取、第二只读复查事务返回前，用第二 PrismaClient（同一临时库文件）真实提交 Mission 版本推进；写法参照 tests/finalAConcurrencyService.test.ts。",
      },
      environment: { ...environmentFacts(env, phase), sourceFilesSha256: sourceFileHashes() },
      fixture: {
        label: "代表性 Mission：6 份项目材料 + 证据审查事件 + 2 个输出/成果回执 + 3 个动作回执 + 3 个 CHAT 运行回执 + 观察事件 + 1 个待批提案",
        missionId: fixture.missionId,
        projectId: fixture.owner.projectId,
        questionId: fixture.questionId,
        eventCount: fixture.eventCount,
        materialCount: fixture.materials.length,
        materialPointerIds: fixture.materials.map(material => material.pointer.id),
        outputRevisions: fixture.outputRows.map(output => output.revision),
        receiptIds: fixture.receipts.map(receipt => receipt.id),
        actionReceiptIds: fixture.actionRows.map(action => action.id),
        runIds: fixture.runs.map(run => run.id),
        targetReviewEventIds: fixture.targetReviewEventIds,
        otherQuestionReviewEventIds: fixture.otherReviewEventIds.slice(0, 5).concat(["…"]),
        expected: fixture.expected,
        materialUseItems: material.items.length,
        materialUseFacts: [...new Set(material.items.flatMap(item => item.facts.map(fact => fact.kind)))],
        workPacketPresent: Boolean(readback.workPacket),
        workPacketConsistency: readback.workPacket?.snapshot?.consistency ?? null,
        workPacketRetries: readback.workPacket?.snapshot?.retries ?? null,
        workPacketEvidenceRows: readback.workPacket?.coverage.windows.length ?? null,
      },
      stable: {
        warmup: WARMUP,
        ...stableAggregate,
        queriesPerRead: { select: perRead("SELECT"), begin: perRead("BEGIN"), commit: perRead("COMMIT"), statementsTotal: Math.round((stableAggregate.statementTotalStats.mean) * 100) / 100 },
        jsonBytesBreakdown: stableAggregate.jsonBytesBreakdownMedian,
        zeroWrites: {
          writeStatementsTotal: stableAggregate.writeStatementsTotal,
          sideEffectDiff: diffSnapshots(beforeSnapshot, afterSnapshot),
          snapshotBefore: plain(beforeSnapshot),
          snapshotAfter: plain(afterSnapshot),
        },
      },
      retried: {
        consistency: retried.measure.consistency,
        retries: retried.measure.retries,
        queries: retried.measure.queries,
        selectQueries: retried.measure.selectQueries,
        byKind: retried.measure.byKind,
        transactions: retried.measure.beginStatements,
        transactionCalls: retried.transactionCallsObserved,
        sourcePolicyChecks: retried.measure.sourcePolicyChecks,
        jsonBytes: retried.measure.jsonBytes,
        latencyMs: retried.measure.latencyMs,
        injectedWrites: retried.injectedWrites,
        writerWrites: retried.writerWrites,
        writerWriteWindow: retried.writerWriteWindow,
        missionVersionBefore: retried.missionVersionBefore,
        missionVersionAfter: retried.missionVersionAfter,
      },
      versionAdvanced: {
        consistency: advanced.measure.consistency,
        retries: advanced.measure.retries,
        queries: advanced.measure.queries,
        selectQueries: advanced.measure.selectQueries,
        byKind: advanced.measure.byKind,
        transactions: advanced.measure.beginStatements,
        transactionCalls: advanced.transactionCallsObserved,
        sourcePolicyChecks: advanced.measure.sourcePolicyChecks,
        jsonBytes: advanced.measure.jsonBytes,
        latencyMs: advanced.measure.latencyMs,
        injectedWrites: advanced.injectedWrites,
        writerWrites: advanced.writerWrites,
        writerWriteWindow: advanced.writerWriteWindow,
        missionVersionBefore: advanced.missionVersionBefore,
        missionVersionAfter: advanced.missionVersionAfter,
      },
      windowCorrectness,
      queryHotspots: hotspots,
      checks: { total: checks.length, passed: checks.filter(item => item.pass).length, failed: checks.filter(item => !item.pass).length, items: checks },
      remaining: [
        "延迟是 SQLite 单机本地读数，不是线上或墙钟性能承诺；未测网络/HTTP/序列化之外的框架开销。",
        "查询数是驱动层 SQL 语句数（含 Prisma 生成的内部查询），不等于 Prisma 引擎内部工作单元数；未量测 Prisma 引擎 CPU/内存。",
        "N=30 只覆盖稳定快照；高并发多用户/大库/冷缓存不在本回执范围。",
        "证据审查窗口修复只覆盖 readback 的 EVIDENCE_FIT_REVIEWED 窗口；本回执不替 Web/鸿蒙客户端签收 UI 文案。",
      ],
    };

    const written = writeEvidence(RUNS_REL(phase), payload);
    console.log(`[perf-readback] phase=${phase} status=${payload.status} exitCode=${exitCode} 证据：${written}`);
    console.log(JSON.stringify({
      phase,
      stable: {
        runs: N_RUNS,
        queries: payload.stable.queryUniqueValues,
        queriesPerRead: payload.stable.queriesPerRead,
        transactions: payload.stable.transactionUniqueValues,
        sourcePolicyChecks: payload.stable.sourcePolicyCheckUniqueValues,
        jsonBytes: payload.stable.jsonBytesUniqueValues,
        latencyMs: payload.stable.latencyMsStats,
        writeStatementsTotal: payload.stable.writeStatementsTotal,
        consistency: payload.stable.consistencyDistribution,
      },
      retried: { consistency: payload.retried.consistency, retries: payload.retried.retries, queries: payload.retried.queries, transactions: payload.retried.transactions },
      versionAdvanced: { consistency: payload.versionAdvanced.consistency, retries: payload.versionAdvanced.retries, queries: payload.versionAdvanced.queries, transactions: payload.versionAdvanced.transactions },
      windowCorrectness: { status: payload.windowCorrectness.status, hits: payload.windowCorrectness.hits, questionFilteredFieldPresent: payload.windowCorrectness.questionFilteredFieldPresent, truncated: payload.windowCorrectness.truncated },
      checks: payload.checks,
      queryHotspots: payload.queryHotspots.slice(0, 10).map(hotspot => ({ count: hotspot.count, perRead: hotspot.perRead, kind: hotspot.kind, sample: hotspot.sample.slice(0, 140) })),
    }, null, 2));
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[perf-readback] phase=${phase} 脚本失败：${message}`);
    try {
      writeEvidence(RUNS_REL(phase), {
        mode: "PERF_MEASUREMENT",
        probe: "perf-readback",
        phase,
        status: "SCRIPT_ERROR",
        generatedAt: new Date().toISOString(),
        command: `npx.cmd tsx scripts/final-a/perf-readback.ts --phase=${phase}`,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        error: { ...errorFacts(error), stack: error instanceof Error ? error.stack?.split("\n").slice(0, 12).join("\n") : undefined },
        method: { meterScope: "仅本脚本进程 + 本次临时库的 better-sqlite3 驱动层计数；不改产品代码。" },
      });
    } catch {
      /* 证据写不出时只保留控制台输出 */
    }
    return 1;
  } finally {
    await db.$disconnect();
    await writer.$disconnect();
  }
}

/* ================================ 7. 合并对照 ================================ */

function readRun(phase: string) {
  const rel = RUNS_REL(phase);
  const abs = evidenceAbs(rel);
  if (!fs.existsSync(abs)) throw new Error(`缺少 ${phase} 运行证据：${rel}`);
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, any>;
}

function mergePhases(): number {
  try {
    const before = readRun("BEFORE");
    const after = readRun("AFTER");
    // AFTER2 = 窗口修复 + 同请求只读复用（可选；存在时合并为三栏对照）。
    const after2Exists = fs.existsSync(evidenceAbs(RUNS_REL("AFTER2")));
    const after2 = after2Exists ? readRun("AFTER2") : null;
    if (before.status !== "PROBE_COMPLETED" || after.status !== "PROBE_COMPLETED" || (after2 && after2.status !== "PROBE_COMPLETED")) {
      throw new Error(`存在失败检查：before=${before.status} after=${after.status} after2=${after2?.status ?? "MISSING"}`);
    }
    const pick = (payload: Record<string, any>) => ({
      stable: {
        runs: payload.stable.runs,
        queriesPerRead: payload.stable.queriesPerRead,
        queries: payload.stable.queryStats,
        queriesUniqueValues: payload.stable.queryUniqueValues,
        transactions: payload.stable.transactionStats,
        transactionUniqueValues: payload.stable.transactionUniqueValues,
        sourcePolicyChecks: payload.stable.sourcePolicyCheckStats,
        sourcePolicyCheckUniqueValues: payload.stable.sourcePolicyCheckUniqueValues,
        jsonBytes: payload.stable.jsonBytesStats,
        jsonBytesUniqueValues: payload.stable.jsonBytesUniqueValues,
        latencyMs: payload.stable.latencyMsStats,
        writeStatementsTotal: payload.stable.writeStatementsTotal,
        consistencyDistribution: payload.stable.consistencyDistribution,
        byKindTotals: payload.stable.byKindTotals,
      },
      retried: payload.retried,
      versionAdvanced: payload.versionAdvanced,
      windowCorrectness: payload.windowCorrectness,
      environment: payload.environment,
      checks: payload.checks,
    });
    const beforePick = pick(before);
    const afterPick = pick(after);
    const after2Pick = after2 ? pick(after2) : null;
    const metric = (read: (payload: ReturnType<typeof pick>) => number) => ({
      before: read(beforePick),
      after: read(afterPick),
      ...(after2Pick ? { after2: read(after2Pick) } : {}),
    });
    const percent = (from: number, to: number) => (from ? Math.round(((to - from) / from) * 10000) / 100 : null);
    const comparison = {
      stableQueries: metric(payload => payload.stable.queries.p50),
      stableTransactions: metric(payload => payload.stable.transactions.p50),
      sourcePolicyChecks: metric(payload => payload.stable.sourcePolicyChecks.p50),
      jsonBytes: metric(payload => payload.stable.jsonBytes.p50),
      latencyP50Ms: metric(payload => payload.stable.latencyMs.p50),
      latencyP95Ms: metric(payload => payload.stable.latencyMs.p95),
      windowHits: metric(payload => payload.windowCorrectness.hits),
      windowStatus: { before: beforePick.windowCorrectness.status, after: afterPick.windowCorrectness.status, ...(after2Pick ? { after2: after2Pick.windowCorrectness.status } : {}) },
      deltas: {
        beforeToAfter: {
          queries: afterPick.stable.queries.p50 - beforePick.stable.queries.p50,
          transactions: afterPick.stable.transactions.p50 - beforePick.stable.transactions.p50,
          jsonBytes: afterPick.stable.jsonBytes.p50 - beforePick.stable.jsonBytes.p50,
          windowHits: afterPick.windowCorrectness.hits - beforePick.windowCorrectness.hits,
        },
        ...(after2Pick ? {
          afterToAfter2: {
            queries: after2Pick.stable.queries.p50 - afterPick.stable.queries.p50,
            queriesChangePercent: percent(afterPick.stable.queries.p50, after2Pick.stable.queries.p50),
            transactions: after2Pick.stable.transactions.p50 - afterPick.stable.transactions.p50,
            sourcePolicyChecks: after2Pick.stable.sourcePolicyChecks.p50 - afterPick.stable.sourcePolicyChecks.p50,
            jsonBytes: after2Pick.stable.jsonBytes.p50 - afterPick.stable.jsonBytes.p50,
            jsonBytesChangePercent: percent(afterPick.stable.jsonBytes.p50, after2Pick.stable.jsonBytes.p50),
            windowHits: after2Pick.windowCorrectness.hits - afterPick.windowCorrectness.hits,
          },
          beforeToAfter2: {
            queries: after2Pick.stable.queries.p50 - beforePick.stable.queries.p50,
            queriesChangePercent: percent(beforePick.stable.queries.p50, after2Pick.stable.queries.p50),
          },
        } : {}),
      },
    };
    // 可选：同阶段重复运行的对照（脚本外手动复制 run1 证据时才会出现），用于说明延迟噪声。
    const optionalRun = (phase: string) => {
      const abs = evidenceAbs(`${EVIDENCE_BASE}/runs/readback-perf-${phase}-run1.json`);
      if (!fs.existsSync(abs)) return null;
      const payload = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, any>;
      return {
        path: `${EVIDENCE_BASE}/runs/readback-perf-${phase}-run1.json`,
        stableQueries: payload.stable?.queryStats?.p50 ?? null,
        stableTransactions: payload.stable?.transactionStats?.p50 ?? null,
        sourcePolicyChecks: payload.stable?.sourcePolicyCheckStats?.p50 ?? null,
        jsonBytes: payload.stable?.jsonBytesStats?.p50 ?? null,
        latencyMs: payload.stable?.latencyMsStats ?? null,
        windowHits: payload.windowCorrectness?.hits ?? null,
      };
    };
    const repeatRuns = { before: optionalRun("BEFORE"), after: optionalRun("AFTER"), ...(after2Exists ? { after2: optionalRun("AFTER2") } : {}) };
    const latencyParts = [
      `BEFORE ${repeatRuns.before?.latencyMs?.p50 ?? "?"}/${beforePick.stable.latencyMs.p50}ms`,
      `AFTER ${repeatRuns.after?.latencyMs?.p50 ?? "?"}/${afterPick.stable.latencyMs.p50}ms`,
      ...(after2Pick ? [`AFTER2 ${repeatRuns.after2?.latencyMs?.p50 ?? "?"}/${after2Pick.stable.latencyMs.p50}ms`] : []),
    ];
    const latencyNote =
      `延迟为同机共享工作树读数，各阶段两次独立运行（N=30）的 p50 分别 ${latencyParts.join("、")}，p95 波动更大；`
      + "后台可能有其他 Agent 测试进程，延迟只作量级参考，不宣称墙钟性能提升或回归。"
      + "查询数/事务数/SourcePolicy 检查数/JSON 字节是确定性计数，重复运行完全一致。";
    const merged = {
      mode: "PERF_MEASUREMENT",
      probe: "perf-readback",
      status: "PROBE_COMPLETED",
      generatedAt: new Date().toISOString(),
      command: "npx.cmd tsx scripts/final-a/perf-readback.ts --merge",
      runs: { before: RUNS_REL("BEFORE"), after: RUNS_REL("AFTER"), ...(after2Exists ? { after2: RUNS_REL("AFTER2") } : {}) },
      repeatRuns,
      method: {
        ...before.method,
        phaseScope: "BEFORE=检查点原始 readback（含只读 sourcePolicyChecks 量测字段）；AFTER=仅证据审查窗口先筛后限；AFTER2=窗口修复+同请求只读复用（continuity view / preloaded mission）。三次运行各自独立临时库、同一 fixture 与同一量测脚本，仅产品代码不同。",
      },
      comparison,
      comparisonNote: latencyNote,
      before: beforePick,
      after: afterPick,
      ...(after2Pick ? { after2: after2Pick } : {}),
      remaining: before.remaining,
    };
    const written = writeEvidence(MERGED_REL, merged);
    console.log(`[perf-readback] merged 证据：${written}`);
    console.log(JSON.stringify({ comparison, repeatRuns, comparisonNote: latencyNote }, null, 2));
    return 0;
  } catch (error) {
    console.error(`[perf-readback] merge 失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/* ================================== 入口 ================================== */

const mergeMode = process.argv.includes("--merge");
if (mergeMode) {
  process.exitCode = mergePhases();
} else {
  const phaseArg = process.argv.find(argument => argument.startsWith("--phase="))?.split("=")[1]
    ?? (process.argv.indexOf("--phase") >= 0 ? process.argv[process.argv.indexOf("--phase") + 1] : undefined)
    ?? "BEFORE";
  const phase = phaseArg.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!phase) {
    console.error("用法：npx.cmd tsx scripts/final-a/perf-readback.ts --phase=BEFORE|AFTER|AFTER2 [--merge]");
    process.exitCode = 2;
  } else {
    process.exitCode = await runPhase(phase);
  }
}
