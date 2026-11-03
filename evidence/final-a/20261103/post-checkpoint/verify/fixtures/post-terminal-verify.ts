/**
 * POST 独立复验 1/4：终态（SUCCEEDED/CANCELLED）+ 未结算 UNKNOWN 的现有摘要找回入口。
 *
 * 运行（目标提交的干净 shadow 根目录）：npx.cmd tsx verify-fixtures/post-terminal-verify.ts <输出JSON绝对路径>
 * 同一脚本可对 4b69614 基线复跑证明 BEFORE 失败（terminalUnsettled 不存在）。
 * 独立临时 SQLite + migrations 重放 + mock；真实 missionWorkspaceSummary / loadGlobalFocus / missionDetail /
 * readMissionBack / 真实 route handler + 真实 session cookie。断言全部由独立验收编写。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx post-terminal-verify.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-final-terminal-"));
const dbFile = path.join(dir, "verify.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"),
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

const { db } = await import("@/lib/db");
const { createMission, missionDetail } = await import("@/lib/mission/missionService");
const { missionWorkspaceSummary } = await import("@/lib/mission/workspaceSummary");
const { readMissionBack } = await import("@/lib/mission/readback");
const { loadGlobalFocus } = await import("@/lib/server/globalFocus");
const { createSession } = await import("@/lib/auth/session");
const { AppError } = await import("@/lib/api");
const { GET: summaryGet } = await import("@/app/api/missions/summary/route");
const { GET: focusGet } = await import("@/app/api/workspace/focus/route");
const { GET: readbackGet } = await import("@/app/api/missions/[id]/readback/route");

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const iso = (v: Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const checks: Array<{ id: string; question: string; verdict: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED"; observed: unknown; note?: string }> = [];
const check = (id: string, question: string, pass: boolean, observed: unknown, note?: string) =>
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-final-${label}-${randomUUID()}`, displayName: `独立复验 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: { title: `独立复验终态入口 ${label}`, description: "SYNTHETIC_POST_FINAL_TERMINAL", goal: "终态+未结算 UNKNOWN 摘要入口", scenario: "RESEARCH" as never, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { user, project, session: await createSession(user.id) };
}
async function createFor(userId: string, projectId: string, goal: string) {
  return createMission(userId, { projectId, requestId: `req-${randomUUID()}`, goal, successCriteria: ["DRAFT_EXISTS"], missionConstraints: {}, researchScope: {}, llmContextApproved: false, continuationPolicy: { mode: "MANUAL" } });
}
async function terminalize(missionId: string, status: "SUCCEEDED" | "CANCELLED", opts: { unknown?: boolean; stepUnknown?: boolean } = {}) {
  const data: Record<string, unknown> = { status, finishedAt: new Date() };
  if (status === "CANCELLED") data.cancelRequestedAt = new Date();
  if (opts.unknown !== false) data.lastErrorJson = { code: "EXTERNAL_UNKNOWN", message: "外部调用结果未知，读取不会自动核销", phase: "TOOL" };
  await db.agentMission.update({ where: { id: missionId }, data: data as never });
  if (opts.stepUnknown) {
    await db.agentMissionStep.create({ data: { missionId, ordinal: 1, planRevision: 1, toolName: "inspect_experiment_metrics", status: "UNKNOWN", canonicalInputJson: {}, inputHash: `h-${randomUUID()}`, readSetJson: [] } });
    await db.agentMission.update({ where: { id: missionId }, data: { lastErrorJson: null } as never });
  }
}
async function dbSnapshot(projectId: string) {
  const missions = await db.agentMission.findMany({ where: { projectId }, orderBy: { id: "asc" } });
  return plain(missions.map((m: any) => ({ id: m.id, status: m.status, version: m.version, planRevision: m.planRevision, contextVersion: m.contextVersion, constraintsVersion: m.constraintsVersion, researchScopeVersion: m.researchScopeVersion, updatedAt: m.updatedAt, nextEventSeq: m.nextEventSeq, finishedAt: m.finishedAt, cancelRequestedAt: m.cancelRequestedAt, lastErrorJson: m.lastErrorJson })));
}
const LEGACY_SUMMARY_ITEM_KEYS = ["id", "goal", "status", "version", "workState", "attention", "activity", "activityAt", "outputRevision"];
function itemOfTerminalUnsettled(summary: any, missionId: string) {
  const window = summary?.terminalUnsettled;
  if (!window || !Array.isArray(window.items)) return { window: null, item: null };
  return { window, item: window.items.find((i: any) => i.id === missionId) ?? null };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "POST 独立复验：终态+未结算 UNKNOWN 现有摘要找回入口（identity/version、旧客户端、非 Owner、零变更、截断诚实）",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace",
  commit: process.env.VERIFY_COMMIT ?? null,
  db: dbFile,
  scenarios: {},
};

/* ---------- 场景 A：SUCCEEDED/CANCELLED + lastErrorJson UNKNOWN ---------- */
{
  const { user, project, session } = await owner("main");
  const cookie = { cookie: `pm_session=${session.token}` };
  const mSucc = await createFor(user.id, project.id, "POST 复验：成功但外部结果未知");
  const mCanc = await createFor(user.id, project.id, "POST 复验：取消但外部结果未知");
  await terminalize(mSucc.id, "SUCCEEDED");
  await terminalize(mCanc.id, "CANCELLED");
  // 纯终态（无未结算效果）不应进入 terminalUnsettled
  const mPlain = await createFor(user.id, project.id, "POST 复验：普通成功无未知");
  await terminalize(mPlain.id, "SUCCEEDED", { unknown: false });
  // 非终态活跃任务：用于确认旧 items/totalActive 语义与旧 item 键不变
  const mActive = await createFor(user.id, project.id, "POST 复验：活跃任务");
  const before = await dbSnapshot(project.id);

  const summary = plain(await missionWorkspaceSummary(user.id, project.id));
  const summaryRes = await summaryGet(new Request(`https://fixture.invalid/api/missions/summary?projectId=${project.id}`, { headers: cookie }));
  const summaryRoute = plain(await summaryRes.json());
  const detailSucc = await missionDetail(user.id, mSucc.id);
  const rbSucc = await readMissionBack(user.id, mSucc.id);
  const rbCanc = await readMissionBack(user.id, mCanc.id);
  const detailCanc = await missionDetail(user.id, mCanc.id);
  const after = await dbSnapshot(project.id);

  const foundSucc = itemOfTerminalUnsettled(summary, mSucc.id);
  const foundCanc = itemOfTerminalUnsettled(summary, mCanc.id);
  const foundPlain = itemOfTerminalUnsettled(summary, mPlain.id);
  const routeWindow = summaryRoute?.terminalUnsettled;

  result.scenarios.main = {
    missions: { succeededUnknown: mSucc.id, cancelledUnknown: mCanc.id, plainSucceeded: mPlain.id },
    summaryService: { keys: Object.keys(summary), enabled: summary.enabled, totalActive: summary.totalActive, itemsIds: (summary.items ?? []).map((i: any) => i.id), terminalUnsettled: summary.terminalUnsettled ?? null },
    summaryRoute: { status: summaryRes.status, hasTerminalUnsettled: !!routeWindow, keys: Object.keys(summaryRoute), foundSucceeded: JSON.stringify(summaryRoute).includes(mSucc.id), foundCancelled: JSON.stringify(summaryRoute).includes(mCanc.id) },
    detail: { succeeded: { status: detailSucc.status, version: detailSucc.version, workState: { terminal: detailSucc.workState?.terminal, unsettledEffect: detailSucc.workState?.unsettledEffect } }, cancelled: { status: detailCanc.status, version: detailCanc.version } },
    readback: { succeeded: { missionVersion: rbSucc.missionVersion, terminal: rbSucc.workState?.terminal, unsettledEffect: rbSucc.workState?.unsettledEffect, requiresUser: rbSucc.workState?.requiresUser, primaryAction: rbSucc.workPacket?.next?.primaryAction?.kind }, cancelled: { missionVersion: rbCanc.missionVersion, terminal: rbCanc.workState?.terminal, unsettledEffect: rbCanc.workState?.unsettledEffect, requiresUser: rbCanc.workState?.requiresUser } },
    readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) },
  };

  check("PST-TERM-01", "missionWorkspaceSummary 暴露 terminalUnsettled 窗口字段", !!summary.terminalUnsettled && Array.isArray(summary.terminalUnsettled.items), { keys: Object.keys(summary), windowKeys: summary.terminalUnsettled ? Object.keys(summary.terminalUnsettled) : null });
  check("PST-TERM-02", "SUCCEEDED+EXTERNAL_UNKNOWN 能在现有摘要找回", !!foundSucc.item, foundSucc.item ?? null);
  check("PST-TERM-03", "CANCELLED+EXTERNAL_UNKNOWN 能在现有摘要找回", !!foundCanc.item, foundCanc.item ?? null);
  check("PST-TERM-04", "普通终态（无未结算 UNKNOWN）不误入 terminalUnsettled", foundPlain.item === null, { found: !!foundPlain.item });
  check("PST-TERM-05", "摘要条目与 detail/readback 同 id/version/status", !!foundSucc.item && foundSucc.item.id === mSucc.id && foundSucc.item.version === rbSucc.missionVersion && foundSucc.item.version === detailSucc.version && foundSucc.item.status === "SUCCEEDED" && foundSucc.item.status === rbSucc.missionStatus && foundSucc.item.status === detailSucc.status,
    { summaryItem: foundSucc.item ? { id: foundSucc.item.id, version: foundSucc.item.version, status: foundSucc.item.status } : null, readback: { version: rbSucc.missionVersion, status: rbSucc.missionStatus }, detail: { version: detailSucc.version, status: detailSucc.status } });
  check("PST-TERM-06", "摘要 workState 并列 terminal+unsettledEffect 且 requiresUser=true（与 readback 一致）", !!foundSucc.item && foundSucc.item.workState?.terminal?.status === "SUCCEEDED" && foundSucc.item.workState?.unsettledEffect?.present === true && foundSucc.item.workState?.unsettledEffect?.resolvedByRead === false && foundSucc.item.workState?.requiresUser === true,
    foundSucc.item?.workState ? { terminal: foundSucc.item.workState.terminal, unsettledEffect: foundSucc.item.workState.unsettledEffect, requiresUser: foundSucc.item.workState.requiresUser } : null);
  check("PST-TERM-07", "摘要 route 与 service 一致（同窗口、能找回）", summaryRes.status === 200 && !!routeWindow && JSON.stringify(summaryRoute).includes(mSucc.id) && JSON.stringify(summaryRoute).includes(mCanc.id), { status: summaryRes.status, seats: !!routeWindow });
  check("PST-TERM-08", "旧客户端字段仍存在且语义不变（enabled/totalActive/items 及旧 item 键）", typeof summary.enabled === "boolean" && typeof summary.totalActive === "number" && Array.isArray(summary.items) && (summary.items.length === 0 || LEGACY_SUMMARY_ITEM_KEYS.every((k) => k in summary.items[0])),
    { keys: Object.keys(summary), itemKeys: (summary.items[0] ? Object.keys(summary.items[0]) : null) });
  check("PST-TERM-09", "totalActive 只计活跃任务、不计终态（与 BEFORE 语义一致）", summary.totalActive === 1 && (summary.items ?? []).some((i: any) => i.id === mActive.id), { totalActive: summary.totalActive, itemsIds: (summary.items ?? []).map((i: any) => i.id) });
  check("PST-TERM-10", "读摘要/详情/读回前后数据库零变更（含终态 version/updatedAt/生命周期）", JSON.stringify(before) === JSON.stringify(after), { identical: JSON.stringify(before) === JSON.stringify(after) });
  const summaryCache = summaryRes.headers.get("cache-control");
  const readbackCacheRes = await readbackGet(new Request(`https://fixture.invalid/api/missions/${mSucc.id}/readback`, { headers: cookie }), { params: Promise.resolve({ id: mSucc.id }) });
  check("PST-TERM-22", "summary/readback GET 响应保持 no-store（不缓存终态窗口）", summaryCache === "no-store" && readbackCacheRes.headers.get("cache-control") === "no-store", { summary: summaryCache, readback: readbackCacheRes.headers.get("cache-control") });

  // 非 Owner：服务与 route 均 404（不因终态窗口泄露）
  const outsider = await db.user.create({ data: { username: `post-final-outsider-${randomUUID()}`, displayName: "非 Owner", passwordHash: "unused" } });
  const outsiderSession = await createSession(outsider.id);
  let serviceErr: any = null;
  try { await missionWorkspaceSummary(outsider.id, project.id); } catch (e) { serviceErr = e as { code?: string; status?: number }; }
  const outsiderRes = await summaryGet(new Request(`https://fixture.invalid/api/missions/summary?projectId=${project.id}`, { headers: { cookie: `pm_session=${outsiderSession.token}` } }));
  const outsiderBody = plain(await outsiderRes.json());
  const readbackOutsider = await readbackGet(new Request(`https://fixture.invalid/api/missions/${mSucc.id}/readback`, { headers: { cookie: `pm_session=${outsiderSession.token}` } }), { params: Promise.resolve({ id: mSucc.id }) });
  const readbackOutsiderBody = plain(await readbackOutsider.json());
  result.scenarios.main.accessControl = { serviceCode: serviceErr?.code ?? null, serviceStatus: serviceErr?.status ?? null, routeStatus: outsiderRes.status, routeCode: outsiderBody?.error?.code ?? null, readbackStatus: readbackOutsider.status, readbackCode: readbackOutsiderBody?.error?.code ?? null };
  check("PST-TERM-11", "非 Owner 读摘要服务/路由 404，读回 404", serviceErr?.code === "MISSION_NOT_FOUND" && serviceErr?.status === 404 && outsiderRes.status === 404 && readbackOutsider.status === 404,
    result.scenarios.main.accessControl);

  // GlobalFocus（原 Focus 入口）：终态 unsettled 窗口并入 waiting，并给出 coverage.terminalUnsettled 覆盖说明
  const focus = plain(await loadGlobalFocus(user.id));
  const focusRes = await focusGet(new Request("https://fixture.invalid/api/workspace/focus", { headers: cookie }));
  const focusBody = plain(await focusRes.json());
  const focusItems = Array.isArray(focus.waiting) ? focus.waiting : [];
  const focusSucc = focusItems.find((i: any) => i.id === mSucc.id) ?? null;
  const focusCanc = focusItems.find((i: any) => i.id === mCanc.id) ?? null;
  const focusCov = focus.coverage?.terminalUnsettled ?? null;
  const focusRouteItems = Array.isArray(focusBody.waiting) ? focusBody.waiting : [];
  result.scenarios.main.globalFocus = {
    serviceFound: !!focusSucc && !!focusCanc, routeFound: focusRouteItems.some((i: any) => i.id === mSucc.id) && focusRouteItems.some((i: any) => i.id === mCanc.id),
    counts: focusBody.counts ?? null, coverage: focusBody.coverage ?? null,
    itemSucc: focusSucc ? { id: focusSucc.id, status: focusSucc.status, workState: { terminal: focusSucc.workState?.terminal, unsettledEffect: focusSucc.workState?.unsettledEffect, requiresUser: focusSucc.workState?.requiresUser } } : null,
  };
  check("PST-TERM-17", "GlobalFocus（Focus）能找回终态+未结算 UNKNOWN 并保留 terminal+unsettledEffect/requiresUser", !!focusSucc && !!focusCanc && focusSucc.workState?.terminal?.status === "SUCCEEDED" && focusSucc.workState?.unsettledEffect?.present === true && focusSucc.workState?.unsettledEffect?.resolvedByRead === false && focusSucc.workState?.requiresUser === true && focusCanc.workState?.terminal?.status === "CANCELLED" && focusCanc.workState?.unsettledEffect?.present === true,
    result.scenarios.main.globalFocus);
  check("PST-TERM-18", "Focus route 与 service 一致（waiting 含终态项、counts.waiting 计入）", focusRes.status === 200 && result.scenarios.main.globalFocus.routeFound && (focusBody.counts?.waiting ?? 0) >= 2 && JSON.stringify(focusBody.waiting).includes(mSucc.id) && JSON.stringify(focusBody.waiting).includes(mCanc.id),
    { status: focusRes.status, counts: focusBody.counts ?? null });
  check("PST-TERM-23", "Focus GET 响应保持 no-store", focusRes.headers.get("cache-control") === "private, no-store", { cacheControl: focusRes.headers.get("cache-control") });
  check("PST-TERM-19", "Focus coverage.terminalUnsettled 覆盖说明诚实（inspected/limit/truncated/note）", !!focusCov && typeof focusCov.inspected === "number" && focusCov.limit === 6 && typeof focusCov.truncated === "boolean" && typeof focusCov.note === "string" && /未找到|不等于|窗口/.test(focusCov.note),
    focusCov);
  const FOCUS_LEGACY_KEYS = ["schemaVersion", "missionEnabled", "archived", "hasMore", "coverage", "counts", "waiting", "running", "actions", "reminders"];
  check("PST-TERM-20", "Focus 旧客户端字段仍存在、waiting 条目旧键不变（增量并入 + 可选 coverage 字段）", FOCUS_LEGACY_KEYS.every((k) => k in focusBody) && (!focusSucc || ["id", "projectId", "projectTitle", "title", "detail", "status", "activity", "activityAt", "dueAt", "projectDeadline", "recordFields", "workState", "actionLabel"].every((k) => k in focusSucc)),
    { keys: Object.keys(focusBody), itemKeys: focusSucc ? Object.keys(focusSucc) : null });
}

/* ---------- 场景 B：截断诚实（limit 外仍有终态未结算） ---------- */
{
  const { user, project } = await owner("truncation");
  const ids: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const m = await createFor(user.id, project.id, `POST 复验截断 ${i}`);
    await terminalize(m.id, i % 2 === 0 ? "SUCCEEDED" : "CANCELLED");
    ids.push(m.id);
  }
  const summary = plain(await missionWorkspaceSummary(user.id, project.id));
  const window = summary.terminalUnsettled;
  result.scenarios.truncation = {
    createdTerminalUnsettled: ids.length,
    window: window ? { itemIds: window.items.map((i: any) => i.id), inspected: window.inspected, limit: window.limit, truncated: window.truncated, note: window.note, identityNote: window.identityNote } : null,
    foundCount: window ? window.items.length : 0,
  };
  check("PST-TERM-12", "有界窗口：items ≤ limit 且 truncated 诚实", !!window && window.items.length <= window.limit && window.items.length >= 1 && window.truncated === true && window.inspected > window.limit,
    window ? { items: window.items.length, inspected: window.inspected, limit: window.limit, truncated: window.truncated } : null);
  check("PST-TERM-13", "截断说明明确“窗口内未找到≠全库没有”", !!window && typeof window.note === "string" && window.note.length > 0 && /未找到|不等于|截断/.test(window.note), window?.note ?? null);
  const after = await dbSnapshot(project.id);
  result.scenarios.truncation.readOnly = { missionCount: after.length, statuses: after.map((m: any) => m.status) };
  check("PST-TERM-14", "终态生命周期不被读取改变（仍为 SUCCEEDED/CANCELLED，无新增状态）", after.every((m: any) => m.status === "SUCCEEDED" || m.status === "CANCELLED"), after.map((m: any) => m.status));
  // Focus 侧同一有界窗口的截断诚实
  const focus = plain(await loadGlobalFocus(user.id));
  const focusCov = focus.coverage?.terminalUnsettled ?? null;
  result.scenarios.truncation.focus = { coverage: focus.coverage ?? null, counts: focus.counts ?? null, waitingLength: Array.isArray(focus.waiting) ? focus.waiting.length : null, hasMore: focus.hasMore ?? null };
  check("PST-TERM-21", "Focus 终态窗口同样有界且截断诚实（inspected>limit、truncated=true、hasMore=true、waiting 不超上限）", !!focusCov && focusCov.inspected > focusCov.limit && focusCov.truncated === true && focus.hasMore === true && Array.isArray(focus.waiting) && focus.waiting.length <= 6,
    result.scenarios.truncation.focus);
}

/* ---------- 场景 C：终态 + UNKNOWN Step（无 lastErrorJson）也能找回 ---------- */
{
  const { user, project } = await owner("step");
  const m = await createFor(user.id, project.id, "POST 复验：终态但原步骤 UNKNOWN");
  await terminalize(m.id, "SUCCEEDED", { unknown: false, stepUnknown: true });
  const summary = plain(await missionWorkspaceSummary(user.id, project.id));
  const found = itemOfTerminalUnsettled(summary, m.id);
  const rb = await readMissionBack(user.id, m.id);
  result.scenarios.stepUnknown = { summaryWindow: summary.terminalUnsettled ?? null, readbackUnsettled: rb.workState?.unsettledEffect ?? null };
  check("PST-TERM-15", "终态 + 原 Step UNKNOWN（无 lastErrorJson）也能从摘要找回", !!found.item && found.item.workState?.unsettledEffect?.present === true && rb.workState?.unsettledEffect?.present === true,
    { item: found.item ? { id: found.item.id, workState: found.item.workState } : null, readback: rb.workState?.unsettledEffect ?? null });
}

/* ---------- 场景 D：feature flag 关闭保持原行为 ---------- */
{
  const { user, project } = await owner("disabled");
  const m = await createFor(user.id, project.id, "POST 复验：feature 关闭");
  await terminalize(m.id, "SUCCEEDED");
  process.env.MISSION_ENABLED = "false";
  let summary: any = null;
  try { summary = plain(await missionWorkspaceSummary(user.id, project.id)); } finally { process.env.MISSION_ENABLED = "true"; }
  result.scenarios.disabled = { summary };
  check("PST-TERM-16", "feature 关闭时保持 enabled=false（与旧行为一致）", summary?.enabled === false && summary?.totalActive === 0 && Array.isArray(summary?.items) && (summary.terminalUnsettled === undefined || summary.terminalUnsettled.items.length === 0), summary);
}

const pass = checks.filter((c) => c.verdict === "PASS").length, fail = checks.filter((c) => c.verdict === "FAIL").length;
result.checks = checks;
result.summary = { total: checks.length, pass, fail, notRun: 0 };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, summary: result.summary, failed: checks.filter((c) => c.verdict !== "PASS").map((c) => ({ id: c.id, verdict: c.verdict })) }, null, 2));
process.exit(fail > 0 ? 1 : 0);






