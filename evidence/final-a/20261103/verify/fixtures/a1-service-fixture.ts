/**
 * 独立验收 fixture（A1）：不依赖实现者测试，自己造最小服务级 fixture。
 *
 * 运行方式（必须在 A1-HEAD 干净 shadow 树内运行，cwd = shadow 根目录）：
 *   npx.cmd tsx <此文件> <输出JSON绝对路径>
 *
 * 隔离：top-level 只 import node 内建 + better-sqlite3；先建临时 SQLite 并重放
 * prisma/migrations，再设置 DATABASE_URL 等 env，之后才动态 import lib/。
 * 不读 .env、不 touch prisma/final-preparation.db、LLM_MODE=mock、无网络/模型/外部写入。
 *
 * 覆盖：FS-A01（SUCCEEDED/CANCELLED + UNKNOWN 并存、取消不显示成功/可恢复）、
 * FS-A02（RUNNING + pause/cancel 请求在途、结算后、UNKNOWN 并存）、
 * FS-A04（读取时间 vs 成功观察时间）、FS-A03（纯投影额度等待）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a1-service-fixture.ts <输出JSON绝对路径>");

/* ---------- 1) 独立临时库（在 import lib/db 之前） ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-a1-verify-service-"));
const dbFile = path.join(dir, "verify.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"),
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
const schemaTables = (sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
sql.close();

/* ---------- 2) 动态 import 真实服务 ---------- */
const { db } = await import("@/lib/db");
const { readMissionBack } = await import("@/lib/mission/readback");
const { missionDetail, commandMission } = await import("@/lib/mission/missionService");
const { missionWorkspaceSummary } = await import("@/lib/mission/workspaceSummary");
const { missionWorkState } = await import("@/lib/mission/workState");

/* ---------- 3) 最小 fixture 构造 ---------- */
const checks: Array<Record<string, unknown>> = [];
function check(id: string, question: string, pass: boolean, observed: unknown, note?: string) {
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });
}
const iso = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const wsFacts = (ws: Record<string, unknown>) => ({
  phase: ws.phase, nextActor: ws.nextActor, requiresUser: ws.requiresUser,
  reasonCode: ws.reasonCode, reasonText: ws.reasonText, actionLabel: ws.actionLabel,
  checkedAt: ws.checkedAt, observedAt: ws.observedAt, nextCheckAt: ws.nextCheckAt, nextBoundary: ws.nextBoundary,
  freshness: ws.freshness, terminal: ws.terminal ?? null, unsettledEffect: ws.unsettledEffect ?? null,
  stopRequest: ws.stopRequest ?? null,
});

const owner = await db.user.create({ data: { username: "a1-verify-owner", displayName: "独立验收", passwordHash: "unused" } });
const project = await db.project.create({
  data: {
    title: "A1 独立验收最小项目", description: "SYNTHETIC_FIXTURE", scenario: "RESEARCH", goal: "验证四问合同事实",
    memberships: { create: { userId: owner.id, role: "OWNER" } },
  },
});
let seq = 0;
const missionBase = (status: string, extra: Record<string, unknown> = {}) => ({
  ownerUserId: owner.id, projectId: project.id,
  createRequestId: `a1-verify-${++seq}`, createPayloadHash: "fixture-hash",
  goal: "验证 A1 合同最小事实", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, budgetJson: {},
  budgetUsedJson: { models: 1, tools: 2, inputTokens: 30, outputTokens: 10, unknownCalls: 0 },
  status, version: 3, ...extra,
});

/* ========================= FS-A01 ========================= */
const finished = new Date("2026-11-02T12:00:00.000Z");
const mSucc = await db.agentMission.create({ data: missionBase("SUCCEEDED", { finishedAt: finished, updatedAt: finished, lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部写入结果未确认" } }) as never });
const mSuccPlain = await db.agentMission.create({ data: missionBase("SUCCEEDED", { finishedAt: finished, updatedAt: finished }) as never });
const mCanc = await db.agentMission.create({ data: missionBase("CANCELLED", { finishedAt: finished, updatedAt: finished, cancelRequestedAt: finished, lastErrorJson: { code: "TOOL_UNKNOWN" } }) as never });
const mCancPlain = await db.agentMission.create({ data: missionBase("CANCELLED", { finishedAt: finished, updatedAt: finished, cancelRequestedAt: finished }) as never });

const rbSucc = await readMissionBack(owner.id, mSucc.id);
const rbSuccPlain = await readMissionBack(owner.id, mSuccPlain.id);
const rbCanc = await readMissionBack(owner.id, mCanc.id);
const rbCancPlain = await readMissionBack(owner.id, mCancPlain.id);
const wSucc = wsFacts(rbSucc.workState as unknown as Record<string, unknown>);
const wSuccPlain = wsFacts(rbSuccPlain.workState as unknown as Record<string, unknown>);
const wCanc = wsFacts(rbCanc.workState as unknown as Record<string, unknown>);
const wCancPlain = wsFacts(rbCancPlain.workState as unknown as Record<string, unknown>);

check("A1-IND-FS-A01-01", "SUCCEEDED + UNKNOWN：终态与未结算效果同时可见", 
  wSucc.phase === "COMPLETED" && wSucc.reasonCode === "SUCCEEDED"
  && (wSucc.terminal as { status?: string } | null)?.status === "SUCCEEDED"
  && (wSucc.unsettledEffect as { present?: boolean; code?: string | null; resolvedByRead?: boolean } | null)?.present === true
  && (wSucc.unsettledEffect as { code?: string | null } | null)?.code === "EXTERNAL_UNKNOWN"
  && (wSucc.unsettledEffect as { resolvedByRead?: boolean } | null)?.resolvedByRead === false,
  { outerMissionStatus: rbSucc.missionStatus, workState: wSucc });

check("A1-IND-FS-A01-02", "SUCCEEDED 无 UNKNOWN：终态可见且未结算效果明确为不存在（对照）",
  wSuccPlain.phase === "COMPLETED" && (wSuccPlain.terminal as { status?: string } | null)?.status === "SUCCEEDED"
  && (wSuccPlain.unsettledEffect as { present?: boolean } | null)?.present === false,
  { workState: wSuccPlain });

check("A1-IND-FS-A01-03", "CANCELLED + UNKNOWN：取消事实保留、不显示成功、未结算效果并列",
  wCanc.phase === "COMPLETED" && wCanc.reasonCode === "CANCELLED"
  && (wCanc.terminal as { status?: string } | null)?.status === "CANCELLED"
  && (wCanc.unsettledEffect as { present?: boolean } | null)?.present === true
  && !String(wCanc.reasonText).includes("完成条件已通过")
  && String(wCanc.reasonText).includes("不能视为成功完成")
  && !String(wCanc.actionLabel).includes("成功"),
  { outerMissionStatus: rbCanc.missionStatus, workState: wCanc });

check("A1-IND-FS-A01-04", "CANCELLED：不可恢复/不出现继续派发主动作，且停止请求已结算",
  !String(wCanc.actionLabel).includes("恢复") && !String(wCanc.actionLabel).includes("继续")
  && (wCanc.stopRequest as { state?: string; settled?: boolean } | null)?.state === "CANCEL_SETTLED"
  && (wCanc.stopRequest as { settled?: boolean } | null)?.settled === true,
  { actionLabel: wCanc.actionLabel, stopRequest: wCanc.stopRequest });

check("A1-IND-FS-A01-05", "CANCELLED 无 UNKNOWN（对照）：不可恢复且不显示成功",
  wCancPlain.phase === "COMPLETED" && wCancPlain.reasonCode === "CANCELLED"
  && !String(wCancPlain.actionLabel).includes("成功") && !String(wCancPlain.actionLabel).includes("恢复")
  && (wCancPlain.unsettledEffect as { present?: boolean } | null)?.present === false,
  { workState: wCancPlain });

const detailSucc = await missionDetail(owner.id, mSucc.id);
const detailCanc = await missionDetail(owner.id, mCanc.id);
check("A1-IND-FS-A01-06", "missionDetail 服务路径与 readback 一致（终态/取消与 UNKNOWN 均可读）",
  (detailSucc.workState as unknown as { terminal?: { status?: string } }).terminal?.status === "SUCCEEDED"
  && (detailSucc.workState as unknown as { unsettledEffect?: { present?: boolean } }).unsettledEffect?.present === true
  && (detailCanc.workState as unknown as { terminal?: { status?: string } }).terminal?.status === "CANCELLED"
  && detailCanc.status === "CANCELLED",
  { detailSucc: wsFacts(detailSucc.workState as unknown as Record<string, unknown>), detailCanc: wsFacts(detailCanc.workState as unknown as Record<string, unknown>) });

const rbSuccAgain = await readMissionBack(owner.id, mSucc.id);
check("A1-IND-FS-A01-07", "重复读取不核销 UNKNOWN（读取无副作用）",
  (rbSuccAgain.workState as unknown as { unsettledEffect?: { present?: boolean } }).unsettledEffect?.present === true,
  { secondReadUnsettled: (rbSuccAgain.workState as unknown as { unsettledEffect?: unknown }).unsettledEffect });

/* ========================= FS-A02 ========================= */
const clock = new Date();
const lease = new Date(+clock + 10 * 60 * 1000);
const runningP = await db.agentMission.create({ data: missionBase("RUNNING", { version: 2, leaseUntil: lease, nextAttemptAt: lease }) as never });
await commandMission(owner.id, runningP.id, "pause", { requestId: randomUUID(), expectedVersion: 2 });
const storedP = await db.agentMission.findUniqueOrThrow({ where: { id: runningP.id } });
const rbP = await readMissionBack(owner.id, runningP.id);
const wP = wsFacts(rbP.workState as unknown as Record<string, unknown>);
const detailP = await missionDetail(owner.id, runningP.id);
check("A1-IND-FS-A02-01", "RUNNING + pauseRequestedAt：持久层仍 RUNNING 且请求时间已落库（原保护保留）",
  storedP.status === "RUNNING" && storedP.pauseRequestedAt !== null,
  { status: storedP.status, version: storedP.version, pauseRequestedAt: iso(storedP.pauseRequestedAt), cancelRequestedAt: iso(storedP.cancelRequestedAt) });

check("A1-IND-FS-A02-02", "readback 显示“停止请求在途”：STOP_REQUESTED_IN_FLIGHT + 核对停止结算 + 不继续派发",
  wP.phase === "RUNNING" && wP.reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && (wP.stopRequest as { state?: string; settled?: boolean } | null)?.state === "PAUSE_REQUESTED"
  && (wP.stopRequest as { settled?: boolean } | null)?.settled === false
  && wP.actionLabel === "核对停止结算"
  && String(wP.reasonText).includes("不会继续派发")
  && !String(wP.actionLabel).includes("继续") && !String(wP.actionLabel).includes("恢复")
  && wP.nextBoundary === lease.toISOString(),
  { workState: wP });

check("A1-IND-FS-A02-03", "missionDetail 服务路径同样显示停止请求在途",
  (detailP.workState as unknown as { reasonCode?: string }).reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && detailP.status === "RUNNING",
  { detailWorkState: wsFacts(detailP.workState as unknown as Record<string, unknown>), detailStatus: detailP.status });

const runningC = await db.agentMission.create({ data: missionBase("RUNNING", { version: 2, leaseUntil: lease }) as never });
await commandMission(owner.id, runningC.id, "cancel", { requestId: randomUUID(), expectedVersion: 2 });
const storedC = await db.agentMission.findUniqueOrThrow({ where: { id: runningC.id } });
const rbC = await readMissionBack(owner.id, runningC.id);
const wC = wsFacts(rbC.workState as unknown as Record<string, unknown>);
check("A1-IND-FS-A02-04", "RUNNING + cancelRequestedAt：持久层仍 RUNNING，readback 显示取消请求在途",
  storedC.status === "RUNNING" && storedC.cancelRequestedAt !== null
  && wC.phase === "RUNNING" && wC.reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && (wC.stopRequest as { state?: string } | null)?.state === "CANCEL_REQUESTED"
  && wC.actionLabel === "核对停止结算",
  { status: storedC.status, cancelRequestedAt: iso(storedC.cancelRequestedAt), workState: wC });

const runningU = await db.agentMission.create({ data: missionBase("RUNNING", { version: 2, leaseUntil: lease, pauseRequestedAt: new Date(+clock - 30_000), pauseReason: "USER", lastErrorJson: { code: "TOOL_UNKNOWN" } }) as never });
const rbU = await readMissionBack(owner.id, runningU.id);
const wU = wsFacts(rbU.workState as unknown as Record<string, unknown>);
check("A1-IND-FS-A02-05", "停止在途优先于非终态 UNKNOWN：主操作仍是核对停止结算，UNKNOWN 事实并列保留",
  wU.phase === "RUNNING" && wU.reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && (wU.unsettledEffect as { present?: boolean; code?: string | null } | null)?.present === true
  && (wU.unsettledEffect as { code?: string | null } | null)?.code === "TOOL_UNKNOWN"
  && !String(wU.actionLabel).includes("查询原请求"),
  { workState: wU });

await db.agentMission.update({ where: { id: runningP.id }, data: { status: "PAUSED", pauseReason: "USER" } });
const rbSettled = await readMissionBack(owner.id, runningP.id);
const wSettled = wsFacts(rbSettled.workState as unknown as Record<string, unknown>);
check("A1-IND-FS-A02-06", "暂停结算后（PAUSED）：PAUSE_SETTLED 且不再是“在途”",
  wSettled.phase === "PAUSED"
  && (wSettled.stopRequest as { state?: string; settled?: boolean } | null)?.state === "PAUSE_SETTLED"
  && (wSettled.stopRequest as { settled?: boolean } | null)?.settled === true
  && wSettled.reasonCode !== "STOP_REQUESTED_IN_FLIGHT",
  { workState: wSettled });

/* workspaceSummary 是 A2 写作用域的消费方；A1-HEAD 未含 pause/cancel select，记录为待 A2 项。 */
const runningS = await db.agentMission.create({ data: missionBase("RUNNING", { version: 2, leaseUntil: lease, pauseRequestedAt: new Date(), pauseReason: "USER" }) as never });
const summary = await missionWorkspaceSummary(owner.id, project.id);
const summaryItem = summary.items.find((item) => item.id === runningS.id) ?? null;
checks.push({
  id: "A1-IND-FS-A02-07", question: "Focus 摘要（workspaceSummary）是否也显示停止请求在途",
  verdict: "NOT_RUN",
  observed: {
    summaryEnabled: summary.enabled, totalActive: summary.totalActive,
    containsThisRunningMission: summaryItem !== null,
    summaryWorkState: summaryItem ? wsFacts(summaryItem.workState as unknown as Record<string, unknown>) : null,
  },
  note: "workspaceSummary.ts 属 A2 写作用域；A1-HEAD 的 missionSummarySelect 未包含 pauseRequestedAt/cancelRequestedAt，摘要仍按 LEASE_ACTIVE 投影。列为 A2 必查残余风险，不算 A1 实现失败，也不能当作已签收。",
});

/* ========================= FS-A04（读取时间 vs 成功观察） ========================= */
const observedAt = "2026-11-01T00:00:00.000Z";
const mObs = await db.agentMission.create({ data: missionBase("READY", { version: 2, planJson: { delegation: { lastObservedAt: observedAt } }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-12-01T00:00:00.000Z" } }) as never });
const rbObs1 = await readMissionBack(owner.id, mObs.id);
await new Promise((resolve) => setTimeout(resolve, 25));
const rbObs2 = await readMissionBack(owner.id, mObs.id);
const wsObs1 = rbObs1.workState as unknown as Record<string, unknown>, wsObs2 = rbObs2.workState as unknown as Record<string, unknown>;
check("A1-IND-FS-A04-01", "反复 GET：workState.observedAt 固定、checkedAt 前进、readback.observedAt 是读取时刻",
  wsObs1.observedAt === observedAt && wsObs2.observedAt === observedAt
  && Date.parse(String(wsObs2.checkedAt)) > Date.parse(String(wsObs1.checkedAt))
  && Date.parse(rbObs2.observedAt) > Date.parse(rbObs1.observedAt),
  { first: { readbackObservedAt: rbObs1.observedAt, workState: wsFacts(wsObs1) }, second: { readbackObservedAt: rbObs2.observedAt, workState: wsFacts(wsObs2) } });

await db.agentMission.update({ where: { id: mObs.id }, data: { status: "FAILED", version: { increment: 1 }, lastErrorJson: { code: "TOOL_FAILED", message: "工具执行失败" } } });
const rbFail = await readMissionBack(owner.id, mObs.id);
const wFail = wsFacts(rbFail.workState as unknown as Record<string, unknown>);
check("A1-IND-FS-A04-02", "失败后成功观察时间不前进，且不显示“无变化/刚检查成功”",
  wFail.observedAt === observedAt && String(wFail.reasonCode) !== "NO_CHANGE"
  && wFail.phase === "FAILED",
  { workState: wFail });

/* ========================= FS-A03（纯投影额度等待） ========================= */
const now = new Date("2026-11-03T04:00:00.000Z");
const nextAttemptAt = new Date(+now + 6 * 60 * 60 * 1000);
const pureBudget = missionWorkState({
  id: "pure-budget-mission", version: 4, status: "READY", nextAttemptAt,
  events: [{ id: "ev-budget", type: "DAILY_BUDGET_WAITING", payloadJson: {} }],
} as never, now) as unknown as Record<string, unknown>;
check("A1-IND-FS-A03-01", "纯投影：READY+DAILY_BUDGET_WAITING+未来 nextAttemptAt → QUEUED/等待额度、budget 事件保留",
  pureBudget.phase === "QUEUED" && pureBudget.reasonCode === "DAILY_BUDGET_WAITING"
  && pureBudget.nextCheckAt === nextAttemptAt.toISOString()
  && String(pureBudget.reasonText).includes("累计用量保留"),
  { workState: wsFacts(pureBudget) });

/* ---------- 4) 写证据 + 退出码 ---------- */
const failed = checks.filter((item) => item.verdict === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "INDEPENDENT_FIXTURE_A1",
  runner: "evidence/final-a/20261103/verify/fixtures/a1-service-fixture.ts",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "A1-HEAD clean shadow (git archive 543162f)",
  database: { mechanism: "mkdtemp + better-sqlite3 replay prisma/migrations", temporaryDir: dir, migrationCount: migrationNames.length, schemaTables },
  env: { llmMode: "mock", modelProviderCalls: 0, externalWrites: 0 },
  summary: { total: checks.length, pass: checks.filter((c) => c.verdict === "PASS").length, fail: failed, notRun: checks.filter((c) => c.verdict === "NOT_RUN").length },
  checks,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: failed === 0, outPath, summary: evidence.summary }));
await db.$disconnect();
process.exit(failed === 0 ? 0 : 1);
