import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, it } from "vitest";

const databasePath = path.resolve("prisma/global-workspace-test.db");
beforeAll(() => {
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
  const sqlite = new Database(databasePath);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const file = path.join("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(file)) sqlite.exec(fs.readFileSync(file, "utf8"));
  }
  sqlite.close();
  process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
});
afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
});

it("全局检索只读取成员项目，保留归档筛选、稳定分页和提醒实际状态", async () => {
  const { db } = await import("@/lib/db");
  const { loadGlobalWorkspace: load } = await import("@/lib/server/globalWorkspace");
  const user = await db.user.create({ data: { username: "global-a", displayName: "甲", passwordHash: "test-only" } });
  const other = await db.user.create({ data: { username: "global-b", displayName: "乙", passwordHash: "test-only" } });
  const makeProject = (owner: string, title: string, archivedAt: Date | null = null) => db.project.create({ data: { title, description: "测试", goal: "检索", scenario: "RESEARCH", archivedAt, memberships: { create: { userId: owner } } } });
  const owned = await makeProject(user.id, "本人实验");
  const archived = await makeProject(user.id, "归档实验", new Date());
  const foreign = await makeProject(other.id, "不可泄露项目");
  for (const [projectId, title] of [[owned.id, "P95 为 118ms"], [archived.id, "历史实验"], [foreign.id, "不可泄露记忆"]]) {
    await db.capture.create({ data: { projectId, rawText: title, card: { create: { projectId, title, summary: title, type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } } } });
    await db.actionItem.create({ data: { projectId, title, status: "TODO" } });
    await db.agentIntervention.create({ data: { projectId, title, content: title, triggerType: "RISK_UNHANDLED", dedupeKey: title, evidence: [], proposedActions: [] } });
  }
  const initial = await load(user.id, "memory", {});
  expect(initial.cards.map(c => c.title)).toEqual(["P95 为 118ms"]);
  expect(initial.projects.map(p => p.id)).toEqual([owned.id]);
  expect((await load(user.id, "memory", { archived: "1" })).cards).toHaveLength(2);
  for (const mode of ["memory", "actions"] as const) {
    const denied = await load(user.id, mode, { project: foreign.id, archived: "1" });
    expect([...denied.cards, ...denied.actions, ...denied.reminders]).toEqual([]);
    const unknown = await load("unknown-user", mode, {});
    expect([...unknown.cards, ...unknown.actions, ...unknown.reminders, ...unknown.projects]).toEqual([]);
  }
  expect((await load(user.id, "memory", { q: "118ms", type: "experiment_log" })).cards).toHaveLength(1);
  expect((await load(user.id, "memory", { q: "118ms", type: "risk" })).cards).toHaveLength(0);
  expect((await load(user.id, "memory", { q: ["bad", "query"], page: ["2"] })).filters.page).toBe(1);
  for (let i = 0; i < 33; i++) await db.capture.create({ data: { projectId: owned.id, rawText: "分页", card: { create: { projectId: owned.id, title: `分页${i}`, summary: "分页", type: "idea", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } } } });
  const first = await load(user.id, "memory", {}), second = await load(user.id, "memory", { page: "2" });
  expect(first.cards).toHaveLength(30); expect(first.hasMore).toBe(true); expect(second.cards).toHaveLength(4);
  expect(first.cards.some(c => second.cards.some(s => s.id === c.id))).toBe(false);
  await db.actionItem.create({ data: { projectId: owned.id, title: "演示行动", isSimulated: true } });
  await db.actionItem.create({ data: { projectId: owned.id, title: "已完成", status: "DONE" } });
  for (const [title, status, snoozedUntil, isSimulated] of [
    ["未来静默", "SNOOZED", new Date(Date.now() + 86400000), false],
    ["静默到期", "SNOOZED", new Date(Date.now() - 86400000), false],
    ["已处理", "ACCEPTED", null, false], ["演示提醒", "OPEN", null, true],
  ] as const) await db.agentIntervention.create({ data: { projectId: owned.id, title, status, snoozedUntil, isSimulated, content: title, triggerType: "RISK_UNHANDLED", dedupeKey: title, evidence: [], proposedActions: [] } });
  const inbox = await load(user.id, "actions", {});
  expect(inbox.actions.map(a => a.title)).toEqual(["P95 为 118ms"]);
  expect(inbox.reminders.map(r => r.title).sort()).toEqual(["P95 为 118ms", "静默到期"].sort());
  expect((await load(user.id, "actions", { q: "找不到" })).actions).toEqual([]);
});

it("焦点分别投影真实状态，Mission双重归属、关闭开关和API身份均有效", async () => {
  const { db } = await import("@/lib/db");
  const { loadGlobalFocus } = await import("@/lib/server/globalFocus");
  const { GET } = await import("@/app/api/workspace/focus/route");
  const user = await db.user.findUniqueOrThrow({ where: { username: "global-a" } });
  const other = await db.user.findUniqueOrThrow({ where: { username: "global-b" } });
  const owned = await db.project.findFirstOrThrow({ where: { title: "本人实验" } });
  const archived = await db.project.findFirstOrThrow({ where: { title: "归档实验" } });
  const foreign = await db.project.findFirstOrThrow({ where: { title: "不可泄露项目" } });
  const shared = await db.project.create({ data: { title: "仅为成员", description: "测试", goal: "受控委托", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "MEMBER" } } } });
  let sequence = 0;
  const make = (projectId: string, ownerUserId: string, status: string) => db.agentMission.create({ data: { ownerUserId, projectId, status, goal: `${status}委托`, createRequestId: `focus-${++sequence}`, createPayloadHash: "test", successCriteriaJson: [], constraintsJson: {}, budgetJson: {} } });
  for (const status of ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED", "RUNNING", "READY", "SUCCEEDED", "CANCELLED"]) await make(owned.id, user.id, status);
  await make(shared.id, user.id, "WAITING_INPUT");
  await make(owned.id, other.id, "WAITING_INPUT");
  await make(foreign.id, user.id, "WAITING_INPUT");
  await make(archived.id, user.id, "WAITING_INPUT");
  const waiting = await db.agentMission.findFirstOrThrow({ where: { ownerUserId: user.id, projectId: owned.id, status: "WAITING_INPUT" } });
  await db.agentMissionEvent.create({ data: { missionId: waiting.id, seq: 1, type: "QUESTION", payloadJson: { question: "请补充实验口径" } } });
  const running = await db.agentMission.findFirstOrThrow({ where: { ownerUserId: user.id, projectId: owned.id, status: "RUNNING" } });
  await db.agentMissionOutput.create({ data: { missionId: running.id, revision: 1, kind: "RESEARCH", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
  process.env.MISSION_ENABLED = "true"; process.env.MISSION_UI_ENABLED = "true";
  const events = await db.agentMissionEvent.count();
  const focus = await loadGlobalFocus(user.id);
  expect(focus.waiting.map(m => m.status).sort()).toEqual(["FAILED", "PAUSED", "WAITING_APPROVAL", "WAITING_INPUT"]);
  expect(focus.waiting.find(m => m.id === waiting.id)?.detail).toBe("请补充实验口径");
  expect(focus.running.find(m => m.id === running.id)?.activity).toBe("草稿修订 1 已保存");
  expect(focus.running.map(m => m.status).sort()).toEqual(["READY", "RUNNING"]);
  expect(focus.actions.map(m => m.title)).toEqual(["P95 为 118ms"]);
  expect(focus.reminders.map(m => m.title).sort()).toEqual(["P95 为 118ms", "静默到期"].sort());
  expect((await loadGlobalFocus(user.id, true)).waiting).toHaveLength(5);
  const empty = await loadGlobalFocus("unknown-user");
  expect([...empty.waiting, ...empty.running, ...empty.actions, ...empty.reminders, ...empty.records]).toEqual([]);
  const anonymous = await GET(new Request("http://localhost/api/workspace/focus"));
  expect(anonymous.status).toBe(401);
  process.env.MISSION_ENABLED = "false";
  const disabled = await loadGlobalFocus(user.id);
  expect(disabled.missionEnabled).toBe(false); expect(disabled.waiting).toEqual([]); expect(disabled.running).toEqual([]);
  expect(disabled.actions).toHaveLength(1);
  expect(await db.agentMissionEvent.count()).toBe(events);
  expect(await db.agentMission.count()).toBe(12);
  delete process.env.MISSION_ENABLED; delete process.env.MISSION_UI_ENABLED;
});
