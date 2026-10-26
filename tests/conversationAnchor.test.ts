import { afterAll, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-f3-anchor-")), file = path.join(dir, "test.db");
  Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", MISSION_ENABLED: "true", MISSION_EVENT_CONTINUATION_ENABLED: "true", LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file);
  for (const n of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", n, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation } from "@/lib/conversation/service";
import { listConversationAnchors, commandConversationAnchor, syncConversationAnchors, readAnchorInbox, syncWorkspaceAnchors } from "@/lib/conversation/anchorService";
import { createMission, missionDetail, commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { scanWaitingMaterials } from "@/lib/mission/sourceSignals";
import { currentGoalQuestion, interactGoalQuestion } from "@/lib/decision/questions";
import type { Choice } from "@/lib/mission/contracts";
import { bindRefs } from "@/lib/conversation/service";
import { previewConversationWork } from "@/lib/conversation/workService";
import { confirmConversationProposal } from "@/lib/conversation/missionCommands";
import { readConversationWork } from "@/lib/conversation/workService";
import { prepareActionResult, commitActionResult } from "@/lib/services/actionService";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "F3隔离验证", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "证据核对", description: "隔离来源", goal: "核对实验", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const reminder = await db.agentIntervention.create({ data: { projectId: project.id, triggerType: "MATERIAL_GAP", dedupeKey: crypto.randomUUID(), severity: 3,
    title: "核对实验来源", content: "尚缺设备信息", evidence: {}, proposedActions: [], isSimulated: false } });
  return { actor, project, reminder, entry: { kind: "INTERVENTION" as const, id: reminder.id, projectId: project.id } };
}
it("reopens one reminder topic, appends a changed origin once, and preserves the old explanation", async () => {
  const f = await fixture(), first = await createConversation(f.actor, { requestId: "first", scope: "WORKSPACE", entry: f.entry });
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { content: "已有设备记录，仍缺目标阶段的复测" } });
  const second = await createConversation(f.actor, { requestId: "revision", scope: "WORKSPACE", entry: f.entry });
  expect(second.id).toBe(first.id);
  const view = await readConversation(f.actor, first.id);
  expect(view.messages).toHaveLength(2);
  expect(view.messages[0].content).toContain("尚缺设备信息");
  expect(view.messages[1].content).toContain("仍缺目标阶段");
  await createConversation(f.actor, { requestId: "repeat", scope: "WORKSPACE", entry: f.entry });
  expect((await readConversation(f.actor, first.id)).messages).toHaveLength(2);
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function slice(id: string, choice: Choice) {
  await runMissionSlice({ id, provider: async () => ({ choice, provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
}
async function missionFixture() {
  const f = await fixture();
  const m = await createMission(f.actor.userId, { projectId: f.project.id, requestId: "mission", goal: "核对10月本地实验", llmContextApproved: true });
  await slice(m.id, { kind: "ask", question: "请补充10月本地实验 Dice 数值", missing: "PRIVATE", requirements: { terms: ["Dice", "10月"], sourceType: "CAPTURE", unit: "%", period: "10月" } });
  const q = (await currentGoalQuestion(f.actor, f.project.id)).question!;
  expect(q).toBeTruthy();
  const entry = { kind: "GOAL_QUESTION" as const, id: q.questionId, projectId: f.project.id };
  const c = await createConversation(f.actor, { requestId: "entry", scope: "WORKSPACE", entry });
  return { ...f, m, q, entry, id: c.id };
}
async function control(f: {actor: Fixture["actor"]; id: string}, action: "FOLLOW" | "LATER" | "STOP" | "ACK", extra = {}) {
  const a = (await listConversationAnchors(f.actor, f.id)).anchors[0];
  return commandConversationAnchor(f.actor, f.id, a.id, { requestId: crypto.randomUUID(), expectedVersion: a.version, action, ...extra });
}
it("does not create topics while listing Focus, and manual entries never subscribe implicitly", async () => {
  const f = await fixture(); expect(await readAnchorInbox(f.actor.userId)).toEqual([]);
  expect(await db.conversation.count({ where: { ownerUserId: f.actor.userId } })).toBe(0);
  const c = await createConversation(f.actor, { requestId: "open", scope: "WORKSPACE", entry: f.entry });
  expect((await listConversationAnchors(f.actor, c.id)).anchors[0]).toMatchObject({ mode: "MANUAL", unread: 0 });
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { content: "后来发生的变化" } });
  expect((await syncConversationAnchors(f.actor, c.id)).projected).toBe(0);
});
it("projects one reminder revision after explicit follow, preserves unread until ACK, and handles concurrent replay", async () => {
  const f = await fixture(), c = await createConversation(f.actor, { requestId: "open", scope: "WORKSPACE", entry: f.entry });
  const scope = { actor: f.actor, id: c.id };
  await control(scope, "FOLLOW");
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { content: "复测资料已到，仍需核对" } });
  await Promise.all([syncConversationAnchors(f.actor, c.id), syncConversationAnchors(f.actor, c.id)]);
  let a = (await listConversationAnchors(f.actor, c.id)).anchors[0];
  expect(a.unread).toBe(1); expect((await readConversation(f.actor, c.id)).messages).toHaveLength(2);
  expect((await listConversationAnchors(f.actor, c.id)).anchors[0].unread).toBe(1);
  await expect(control(scope, "ACK", { seenSeq: a.projectedSeq + 1 })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await control(scope, "ACK", { seenSeq: a.projectedSeq });
  a = (await listConversationAnchors(f.actor, c.id)).anchors[0]; expect(a.unread).toBe(0);
  expect(await db.agentRun.count({ where: { conversationId: c.id } })).toBe(0);
});
it("repairs a missing chat projection without repeating the source mutation or original effect", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  const paused = await db.agentMission.update({ where: { id: f.m.id }, data: { status: "PAUSED", version: { increment: 1 } } });
  const r = await syncConversationAnchors(f.actor, f.id), message = r.conversation.messages.at(-1)!;
  expect(r.projected).toBe(1);
  await db.agentMessage.delete({ where: { id: message.id } });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(1);
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).version).toBe(paused.version);
});
it("reuses one Mission topic across a different question and refuses reused entry request payloads", async () => {
  const f = await missionFixture(), old = await missionDetail(f.actor.userId, f.m.id);
  await commandMission(f.actor.userId, f.m.id, "input", { requestId: "answer", expectedVersion: old.version, questionId: f.q.questionId, answer: "已有记录，需继续核对" });
  await slice(f.m.id, { kind: "ask", question: "再核对实际设备型号", missing: "PRIVATE" });
  const q = (await currentGoalQuestion(f.actor, f.project.id)).question!;
  const entry = { ...f.entry, id: q.questionId };
  expect((await createConversation(f.actor, { requestId: "revision", scope: "WORKSPACE", entry })).id).toBe(f.id);
  expect(await db.conversation.count({ where: { ownerUserId: f.actor.userId } })).toBe(1);
  expect((await createConversation(f.actor, { requestId: "entry", scope: "WORKSPACE", entry: f.entry })).id).toBe(f.id);
  await db.conversationEntryRequest.delete({ where: { ownerUserId_requestId: { ownerUserId: f.actor.userId, requestId: "entry" } } });
  expect((await createConversation(f.actor, { requestId: "entry", scope: "WORKSPACE", entry: f.entry })).id).toBe(f.id);
  await expect(createConversation(f.actor, { requestId: "revision", scope: "WORKSPACE", entry: f.entry })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  await expect(createConversation(f.actor, { requestId: "revision", scope: "WORKSPACE", title: "另一个创建请求" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
});
it("filters unrelated and stale materials; one relevant source revision yields one qualified snapshot", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await db.capture.create({ data: { projectId: f.project.id, rawText: "今天的课程安排" } });
  const material = await db.capture.create({ data: { projectId: f.project.id, rawText: "10月本地实验 Dice 82%" } });
  await scanWaitingMaterials(100);
  const r = await syncConversationAnchors(f.actor, f.id);
  expect(r.projected).toBe(1); expect(r.conversation.messages.at(-1)?.sources[0]).toMatchObject({ projectId: f.project.id, sourceId: "capture:" + material.id });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).status).toBe("WAITING_INPUT");
  expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(0);
});
it("keeps LATER quiet until its persisted expiry, and STOP survives the new origin revision", async () => {
  const f = await fixture(), c = await createConversation(f.actor, { requestId: "open", scope: "WORKSPACE", entry: f.entry }), scope = { actor: f.actor, id: c.id };
  await control(scope, "FOLLOW"); await control(scope, "LATER");
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { content: "延后期间的资料修订" } });
  expect((await syncConversationAnchors(f.actor, c.id)).projected).toBe(0);
  const a = (await listConversationAnchors(f.actor, c.id)).anchors[0];
  await db.conversationAnchor.update({ where: { id: a.id }, data: { snoozedUntil: new Date(0) } });
  expect((await syncConversationAnchors(f.actor, c.id)).projected).toBe(1);
  await control(scope, "STOP");
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { content: "停止之后的修订" } });
  expect((await syncConversationAnchors(f.actor, c.id)).projected).toBe(0);
  expect((await listConversationAnchors(f.actor, c.id)).anchors[0].mode).toBe("STOPPED");
});
it("delegates Mission STOP to the original preference and will not bypass it with FOLLOW", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await control(f, "STOP");
  expect((await currentGoalQuestion(f.actor, f.project.id)).question).toBeNull();
  expect(await db.goalQuestionPreference.count({ where: { userId: f.actor.userId, missionId: f.m.id, questionId: "*", mode: "STOP" } })).toBe(1);
  await expect(control(f, "FOLLOW")).rejects.toMatchObject({ code: "ORIGINAL_TOPIC_STOPPED" });
});
it("honors a STOP from the original UI before projecting any later event", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await interactGoalQuestion(f.actor, f.project.id, { requestId: "original-stop", action: "STOP", questionId: f.q.questionId, contextHash: f.q.contextHash });
  await db.capture.create({ data: { projectId: f.project.id, rawText: "10月本地实验 Dice 81%" } });
  await scanWaitingMaterials(100);
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
});
it("closes a terminal Mission topic after its actual output and status projection", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  const before = await missionDetail(f.actor.userId, f.m.id);
  await commandMission(f.actor.userId, f.m.id, "input", { requestId: "input", expectedVersion: before.version, questionId: f.q.questionId, answer: "保留未知，整理条件分析" });
  await slice(f.m.id, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "note", kind: "INFERENCE", text: "仍需核对真实测量，不作效果结论", sourceIds: [] }] }, summary: "保存草稿" });
  const d = await missionDetail(f.actor.userId, f.m.id);
  await slice(f.m.id, { kind: "finish", outputId: d.outputs[0].id });
  const r = await syncConversationAnchors(f.actor, f.id);
  expect(r.anchors[0].mode).toBe("STOPPED");
  expect(r.conversation.messages.some(m => m.content.includes("服务端成功条件已验收"))).toBe(true);
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
  const last = r.conversation.messages.at(-1)!;
  await db.agentMessage.delete({ where: { id: last.id } });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(1);
  expect((await listConversationAnchors(f.actor, f.id)).anchors[0].mode).toBe("STOPPED");
});
it("targets original LATER at the anchored Mission even when another Mission is selected", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  const other = await createMission(f.actor.userId, { projectId: f.project.id, requestId: "other", goal: "另一科研目标", llmContextApproved: true });
  await slice(other.id, { kind: "ask", question: "另一项待补充信息", missing: "PRIVATE" });
  await db.projectMembership.update({ where: { userId_projectId: { userId: f.actor.userId, projectId: f.project.id } }, data: { focusMissionId: other.id } });
  await control(f, "LATER");
  expect(await db.goalQuestionPreference.count({ where: { userId: f.actor.userId, missionId: f.m.id, questionId: f.q.questionId, mode: "LATER" } })).toBe(1);
  expect(await db.goalQuestionPreference.count({ where: { userId: f.actor.userId, missionId: other.id } })).toBe(0);
});
it("does not let an old resolved question's LATER suppress the next question", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await interactGoalQuestion(f.actor, f.project.id, { requestId: "later", action: "LATER", questionId: f.q.questionId, contextHash: f.q.contextHash });
  const before = await missionDetail(f.actor.userId, f.m.id);
  await commandMission(f.actor.userId, f.m.id, "input", { requestId: "next", expectedVersion: before.version, questionId: f.q.questionId, answer: "继续保留未知，换一个待核对问题" });
  await slice(f.m.id, { kind: "ask", question: "下一阶段还缺什么资料？", missing: "PRIVATE" });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(1);
});
it("rotates workspace synchronization past the first eight conversations", async () => {
  const f = await fixture(), ids: string[] = [];
  for (let i = 0; i < 9; i++) {
    const row = await db.agentIntervention.create({ data: { projectId: f.project.id, triggerType: "MATERIAL_GAP", dedupeKey: crypto.randomUUID(), severity: 3, title: "主题" + i, content: "原始观察", evidence: {}, proposedActions: [], isSimulated: false } });
    const c = await createConversation(f.actor, { requestId: "entry" + i, scope: "WORKSPACE", entry: { kind: "INTERVENTION", id: row.id, projectId: f.project.id } });
    await control({ actor: f.actor, id: c.id }, "FOLLOW"); ids.push(c.id);
    await db.agentIntervention.update({ where: { id: row.id }, data: { content: "新修订" + i } });
  }
  await syncWorkspaceAnchors(f.actor); await syncWorkspaceAnchors(f.actor);
  for (const id of ids) expect((await listConversationAnchors(f.actor, id)).anchors[0].unread).toBe(1);
});
it("does not discard valid output revisions behind the per-sync event limit", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await db.$transaction(async tx => {
    const { event } = await import("@/lib/mission/repository");
    for (let i = 1; i <= 45; i++) {
      const output = await tx.agentMissionOutput.create({ data: { missionId: f.m.id, revision: i, kind: "DRAFT", contentJson: { blocks: [{ text: "保留未知的条件分析" + i }] }, sourceRefsJson: [], claimChecksJson: [] } });
      await event(tx, f.m.id, "TOOL_FINISHED", { result: { data: { outputId: output.id } } });
    }
    await tx.agentMission.update({ where: { id: f.m.id }, data: { status: "SUCCEEDED" } });
  });
  const first = await syncConversationAnchors(f.actor, f.id);
  expect(first.anchors[0].mode).toBe("FOLLOWING");
  const second = await syncConversationAnchors(f.actor, f.id);
  expect(second.anchors[0].mode).toBe("STOPPED");
  const rows = await db.agentMessage.findMany({ where: { conversationId: f.id } });
  expect(rows.filter(m => m.content.includes("版成果。验证状态"))).toHaveLength(45);
});
it("drains existing action snapshots before closing a cancelled topic", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await db.$transaction(async tx => {
    const { event } = await import("@/lib/mission/repository");
    for (let i = 0; i < 9; i++) {
      const action = await tx.actionItem.create({ data: { projectId: f.project.id, title: "原行动" + i } });
      await event(tx, f.m.id, "ACTION_CREATED", { actionId: action.id });
    }
    await tx.agentMission.update({ where: { id: f.m.id }, data: { status: "CANCELLED" } });
  });
  expect((await syncConversationAnchors(f.actor, f.id)).anchors[0].mode).toBe("FOLLOWING");
  expect((await syncConversationAnchors(f.actor, f.id)).anchors[0].mode).toBe("STOPPED");
  expect(await db.conversationAnchorProjection.count({ where: { anchor: { conversationId: f.id }, revisionKey: { startsWith: "action:" }, seq: { gt: 0 } } })).toBe(9);
});
it("follows completion of an older existing Action beyond the initial eight", async () => {
  const f = await missionFixture(), ids: string[] = [];
  await db.$transaction(async tx => {
    const { event } = await import("@/lib/mission/repository");
    for (let i = 0; i < 9; i++) {
      const a = await tx.actionItem.create({ data: { projectId: f.project.id, title: "已有待办" + i } }); ids.push(a.id);
      await event(tx, f.m.id, "ACTION_CREATED", { actionId: a.id });
    }
  });
  await control(f, "FOLLOW");
  const prepared = await prepareActionResult(f.project.id, ids[0], "最早一条原行动的真实复测已经完成。", true);
  await db.$transaction(tx => commitActionResult(tx, prepared));
  await syncConversationAnchors(f.actor, f.id); const r = await syncConversationAnchors(f.actor, f.id);
  expect(r.conversation.messages.some(m => m.content.includes("最早一条原行动的真实复测"))).toBe(true);
});
it("rechecks access before feedback replays, projection repair, and inbox reads", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  await db.projectMembership.delete({ where: { userId_projectId: { userId: f.actor.userId, projectId: f.project.id } } });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
  expect((await listConversationAnchors(f.actor, f.id)).anchors).toEqual([]);
  expect(await readAnchorInbox(f.actor.userId)).toEqual([]);
  expect((await readConversation(f.actor, f.id)).messages.every(m => m.restricted)).toBe(true);
});
it("keeps sync off under its feature flag and GET never manufactures unread work", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  process.env.FOCUS_AGENT_FOLLOW_ENABLED = "false";
  try {
    await db.agentMission.update({ where: { id: f.m.id }, data: { status: "PAUSED" } });
    expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
    expect((await listConversationAnchors(f.actor, f.id)).enabled).toBe(false);
    expect((await readConversation(f.actor, f.id)).messages).toHaveLength(1);
  } finally { process.env.FOCUS_AGENT_FOLLOW_ENABLED = "true"; }
});
it("does not repeat a result already committed by the same conversation", async () => {
  const f = await missionFixture(); await control(f, "FOLLOW");
  const action = await db.actionItem.create({ data: { projectId: f.project.id, title: "本地复测" } });
  await db.$transaction(async tx => {
    const { event } = await import("@/lib/mission/repository");
    await event(tx, f.m.id, "ACTION_CREATED", { actionId: action.id });
    await bindRefs(tx, f.id, [{ kind: "ACTION", id: action.id, projectId: f.project.id, title: action.title, href: "/projects/" + f.project.id + "/actions" }]);
  });
  await syncConversationAnchors(f.actor, f.id);
  const ref = { kind: "ACTION" as const, id: action.id, projectId: f.project.id }, w = await readConversationWork(f.actor, f.id, ref), c = await readConversation(f.actor, f.id);
  const preview = await previewConversationWork(f.actor, f.id, { requestId: "complete", expectedConversationVersion: c.version, ref, versionToken: w.versionToken, operation: "complete_action", answer: "本地复测通过，记录真实观察结果。" });
  const p = preview.conversation.messages.at(-1)!.proposal!;
  await confirmConversationProposal(f.actor, f.id, p.executionId, { requestId: "confirm", proposalHash: p.proposalHash, confirmed: true });
  expect((await syncConversationAnchors(f.actor, f.id)).projected).toBe(0);
});
