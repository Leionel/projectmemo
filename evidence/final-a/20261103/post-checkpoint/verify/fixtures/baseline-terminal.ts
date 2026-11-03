/**
 * BEFORE_FIX 独立特征化 1/3：终态（SUCCEEDED/CANCELLED）+ lastErrorJson EXTERNAL_UNKNOWN 的可达性。
 *
 * 运行（干净 shadow 根目录）：npx.cmd tsx verify-fixtures/baseline-terminal.ts <输出JSON绝对路径>
 *
 * 隔离：top-level 只 import node 内建 + better-sqlite3；先 mkdtemp 建临时 SQLite、WAL、按序重放
 * prisma/migrations，设置 DATABASE_URL 等 env，之后才动态 import lib/。不读 .env、不碰真实库、
 * LLM_MODE=mock、无模型/网络/外部写入。全部断言由独立验收编写，不复用实现者测试断言。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx baseline-terminal.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-base-terminal-"));
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
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();

const { db } = await import("@/lib/db");
const { createMission } = await import("@/lib/mission/missionService");
const { missionDetail } = await import("@/lib/mission/missionService");
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

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-base-${label}-${randomUUID()}`, displayName: `独立验收 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: {
      title: `独立验收终端入口 ${label}`, description: "SYNTHETIC_POST_VERIFY_TERMINAL", goal: "验证终态+未结算UNKNOWN入口可达性",
      scenario: "RESEARCH" as never,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { user, project };
}
// createMission 需要 userId；单独封装
async function createFor(userId: string, projectId: string, goal: string) {
  const m = await createMission(userId, {
    projectId, requestId: `req-${randomUUID()}`, goal,
    successCriteria: ["DRAFT_EXISTS"], missionConstraints: {}, researchScope: {}, llmContextApproved: false,
    continuationPolicy: { mode: "MANUAL" },
  });
  return m;
}

async function snapshotMission(id: string) {
  const m = await db.agentMission.findUniqueOrThrow({ where: { id } });
  const [events, steps, approvals, outputs] = await Promise.all([
    db.agentMissionEvent.count({ where: { missionId: id } }),
    db.agentMissionStep.count({ where: { missionId: id } }),
    db.agentMissionApproval.count({ where: { missionId: id } }),
    db.agentMissionOutput.count({ where: { missionId: id } }),
  ]);
  return {
    status: m.status, version: m.version, updatedAt: iso(m.updatedAt), finishedAt: iso(m.finishedAt),
    planRevision: m.planRevision, contextVersion: m.contextVersion, constraintsVersion: m.constraintsVersion,
    researchScopeVersion: m.researchScopeVersion, nextEventSeq: m.nextEventSeq, lastErrorJson: plain(m.lastErrorJson),
    counts: { events, steps, approvals, outputs },
  };
}

function workStateBrief(ws: Record<string, any> | null | undefined) {
  if (!ws) return null;
  return {
    phase: ws.phase, nextActor: ws.nextActor, requiresUser: ws.requiresUser, reasonCode: ws.reasonCode,
    reasonText: ws.reasonText, actionLabel: ws.actionLabel, checkedAt: ws.checkedAt, observedAt: ws.observedAt,
    terminal: ws.terminal ?? null, unsettledEffect: ws.unsettledEffect ?? null, stopRequest: ws.stopRequest ?? null,
    originalRef: ws.originalRef ?? null, exactQuestionRef: ws.exactQuestionRef ?? null,
  };
}
function packetBrief(packet: Record<string, any> | null | undefined) {
  if (!packet) return null;
  return {
    contractVersion: packet.contractVersion, schemaVersion: packet.schemaVersion,
    identity: packet.identity, snapshot: packet.snapshot,
    observations: packet.observations,
    stoppedUnknownEffect: packet.stopped?.unknownEffect ?? null,
    primaryAction: packet.next?.primaryAction ?? null,
    waitingOn: packet.next?.waitingOn ?? null,
    blockerCodes: (packet.blockers ?? []).map((b: any) => `${b.kind}:${b.code}`),
    coverageWindows: (packet.coverage?.windows ?? []).map((w: any) => ({ name: w.name, limit: w.limit, returned: w.returned, truncated: w.truncated })),
  };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "BEFORE_FIX 终态+未结算UNKNOWN 入口可达性独立特征化",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace HEAD 4b69614 via git archive shadow",
  db: { kind: "temporary sqlite (mkdtemp) + prisma migrations replayed", path: dbFile },
  scenarios: {},
};

/* ---------- 场景 A：SUCCEEDED + EXTERNAL_UNKNOWN ---------- */
{
  const { user, project } = await owner("succeeded");
  const m = await createFor(user.id, project.id, "独立验收：已完成但外部调用结果未知");
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "SUCCEEDED", finishedAt: new Date(),
      lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部写入结果未知，读取不会自动核销", phase: "TOOL" },
    },
  });
  const before = await snapshotMission(m.id);
  const session = await createSession(user.id);
  const cookie = { cookie: `pm_session=${session.token}` };

  const summary = await missionWorkspaceSummary(user.id, project.id);
  const focus = await loadGlobalFocus(user.id);
  const detail = await missionDetail(user.id, m.id);
  const readback1 = await readMissionBack(user.id, m.id);
  const readback2 = await readMissionBack(user.id, m.id);

  const summaryRes = await summaryGet(new Request(`https://fixture.invalid/api/missions/summary?projectId=${project.id}`, { headers: cookie }));
  const summaryBody = plain(await summaryRes.json());
  const focusRes = await focusGet(new Request("https://fixture.invalid/api/workspace/focus", { headers: cookie }));
  const focusBody = plain(await focusRes.json());
  const readbackRes = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m.id}/readback`, { headers: cookie }), { params: Promise.resolve({ id: m.id }) });
  const readbackBody = plain(await readbackRes.json());

  const after = await snapshotMission(m.id);
  const nonOwner = await db.user.create({ data: { username: `post-base-nonowner-${randomUUID()}`, displayName: "非 Owner", passwordHash: "unused" } });
  const nonOwnerSession = await createSession(nonOwner.id);
  const nonOwnerRes = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m.id}/readback`, { headers: { cookie: `pm_session=${nonOwnerSession.token}` } }), { params: Promise.resolve({ id: m.id }) });
  const nonOwnerBody = plain(await nonOwnerRes.json());

  result.scenarios.succeededUnknown = {
    missionId: m.id,
    missionRow: { status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN" }, finishedAt: before.finishedAt },
    summary: {
      service: { enabled: summary.enabled, totalActive: summary.totalActive, itemIds: summary.items.map((i: any) => i.id), itemKeys: summary.items.map((i: any) => Object.keys(i)) },
      route: { status: summaryRes.status, body: summaryBody, missionFound: JSON.stringify(summaryBody).includes(m.id) },
    },
    focus: {
      missionFound: JSON.stringify(focusBody).includes(m.id),
      counts: focusBody.counts, waiting: focusBody.waiting?.map((w: any) => ({ id: w.id, status: w.status, actionLabel: w.actionLabel })),
      running: focusBody.running?.map((w: any) => ({ id: w.id, status: w.status, actionLabel: w.actionLabel })),
      coverage: focusBody.coverage, primaryContextProjectId: focusBody.primaryContext?.projectId ?? null,
    },
    detail: {
      status: detail.status, error: plain(detail.error), workState: workStateBrief(detail.workState),
    },
    readback1: {
      missionStatus: readback1.missionStatus, missionVersion: readback1.missionVersion,
      workState: workStateBrief(readback1.workState), observation: readback1.observation,
      workPacket: packetBrief(readback1.workPacket),
    },
    readback2Stable: {
      versionSame: readback2.missionVersion === readback1.missionVersion,
      observationLastSuccessfulAtSame: readback2.observation?.lastSuccessfulAt === readback1.observation?.lastSuccessfulAt,
      observedAtIsReadTime: readback2.observedAt !== readback1.observedAt,
      packetConsistency: readback2.workPacket?.snapshot?.consistency,
      primaryActionKindSame: readback2.workPacket?.next?.primaryAction?.kind === readback1.workPacket?.next?.primaryAction?.kind,
    },
    routeEvidence: {
      readbackGet: { status: readbackRes.status, hasReadback: !!readbackBody.readback, packetKind: readbackBody.readback?.workPacket?.next?.primaryAction?.kind ?? null },
      nonOwner: { status: nonOwnerRes.status, code: nonOwnerBody?.error?.code ?? null },
    },
    readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) },
  };
}

/* ---------- 场景 B：CANCELLED + EXTERNAL_UNKNOWN ---------- */
{
  const { user, project } = await owner("cancelled");
  const m = await createFor(user.id, project.id, "独立验收：已取消但外部调用结果未知");
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "CANCELLED", finishedAt: new Date(), cancelRequestedAt: new Date(),
      lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "取消在途的外部写入结果未知", phase: "TOOL" },
    },
  });
  const before = await snapshotMission(m.id);
  const summary = await missionWorkspaceSummary(user.id, project.id);
  const focus = await loadGlobalFocus(user.id);
  const detail = await missionDetail(user.id, m.id);
  const readback = await readMissionBack(user.id, m.id);
  const after = await snapshotMission(m.id);
  result.scenarios.cancelledUnknown = {
    missionId: m.id,
    summary: { totalActive: summary.totalActive, itemIds: summary.items.map((i: any) => i.id), missionFound: JSON.stringify(plain(summary)).includes(m.id) },
    focus: { missionFound: JSON.stringify(plain(await loadGlobalFocus(user.id))).includes(m.id) },
    detail: { status: detail.status, error: plain(detail.error), workState: workStateBrief(detail.workState) },
    readback: { missionStatus: readback.missionStatus, workState: workStateBrief(readback.workState), workPacket: packetBrief(readback.workPacket) },
    readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) },
  };
}

/* ---------- 结论 ---------- */
const s = result.scenarios.succeededUnknown, c = result.scenarios.cancelledUnknown;
const summaryFinds = (x: any) => (x.summary.itemIds ?? x.summary.service?.itemIds ?? []).includes(x.missionId);
const focusFinds = (x: any) => x.focus.missionFound;
const expressesTerminal = (ws: any, status: string) => ws?.terminal?.status === status;
const expressesUnsettled = (ws: any) => ws?.unsettledEffect?.present === true && ws?.unsettledEffect?.resolvedByRead === false;
result.verdict = {
  summaryCanFindSucceeded: summaryFinds(s), summaryCanFindCancelled: summaryFinds(c),
  focusCanFindSucceeded: focusFinds(s), focusCanFindCancelled: focusFinds(c),
  detailExpressesSucceededTerminal: expressesTerminal(s.detail.workState, "SUCCEEDED"), detailExpressesCancelledTerminal: expressesTerminal(c.detail.workState, "CANCELLED"),
  detailExpressesUnsettledSucceeded: expressesUnsettled(s.detail.workState), detailExpressesUnsettledCancelled: expressesUnsettled(c.detail.workState),
  readbackExpressesSucceededTerminal: expressesTerminal(s.readback1.workState, "SUCCEEDED"),
  readbackExpressesCancelledTerminal: expressesTerminal(c.readback.workState, "CANCELLED"),
  readbackExpressesUnsettledSucceeded: expressesUnsettled(s.readback1.workState), readbackExpressesUnsettledCancelled: expressesUnsettled(c.readback.workState),
  readbackPrimaryActionKinds: { succeeded: s.readback1.workPacket?.primaryAction?.kind, cancelled: c.readback.workPacket?.primaryAction?.kind },
  readOnlyZeroChange: s.readOnly.identical && c.readOnly.identical,
  nonOwner404: s.routeEvidence.nonOwner.status === 404,
  conclusion: "入口缺口：missionWorkspaceSummary/GlobalFocus 只查非终态状态集，终态+未结算UNKNOWN任务完全不在摘要/Focus 结果中；但同一 workState 投影在 detail/readback 已能并列表达 terminal+unsettledEffect，故不是“状态不可表达”。",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, verdict: result.verdict }, null, 2));

