import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m3-reentry-brief"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { json } from "@/lib/mission/contracts";
import { commandMission, createMission } from "@/lib/mission/missionService";
import { claimMission } from "@/lib/mission/runtimeStore";
import { acknowledgeReentryBrief, readProjectReturnItems, readReentryBrief } from "@/lib/mission/reentryBrief";
import { readMissionWorkbench } from "@/lib/mission/workbenchService";
import { readWorkbenchDelivery } from "@/lib/mission/workbenchDelivery";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";

Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture() {
  const user = await db.user.create({ data: { username: "reentry-" + crypto.randomUUID(), displayName: "回访", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "回访项目", description: "隔离", goal: "回访", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const mission = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理报告", llmContextApproved: true });
  const source = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: "回访来源：分享入口未验证。" } });
  const output = async (revision: number) => db.agentMissionOutput.create({ data: { missionId: mission.id, revision, kind: "NOTE",
    contentJson: { blocks: [{ blockId: "b" + revision, kind: "INFERENCE", text: "第 " + revision + " 版正文", sourceIds: ["capture:" + source.id] }],
      missingInformation: ["待补证据"] },
    sourceRefsJson: json([{ id: "capture:" + source.id, projectId: project.id, conversationId: null, kind: "capture", entityType: "capture",
      entityId: source.id, revision: "1", hash: "a".repeat(64), text: "回访来源：分享入口未验证。", observedAt: new Date().toISOString() }]), claimChecksJson: [] } });
  return { user, project, mission, source, output };
}

test("brief shows at most three changes since the last read; read and handled are separate from approval", async () => {
  const f = await fixture();
  await f.output(1);
  const first = await readReentryBrief(f.user.id, f.mission.id);
  expect(first.readState).toBe("UNREAD");
  expect(first.items).toHaveLength(1);
  expect(first.items[0].kind).toBe("OUTPUT_UPDATED");
  expect(first.items[0].approved).toBe(false);
  expect(first.items[0].occurredAt).toBeTruthy();
  expect(first.items[0].recordedAt).toBeTruthy();
  const versionBefore = (await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).version;
  const seen = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-1", seenSeq: first.cursor.seq, seenOutputRevision: 1, handledItemIds: [first.items[0].id] });
  expect(seen.readState).toBe("SEEN");
  expect(seen.items).toEqual([]);
  const versionAfter = (await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).version;
  expect(versionAfter).toBe(versionBefore);
  // A new output and a decision event become the next bounded changes; decision is listed first.
  await f.output(2);
  const question = await db.agentMissionEvent.create({ data: { missionId: f.mission.id, seq: 999, type: "QUESTION", payloadJson: { question: "需要你补充验收口径" } } });
  await db.agentMission.update({ where: { id: f.mission.id }, data: { status: "WAITING_INPUT", nextEventSeq: 999, waitStateJson: { questionId: question.id } } });
  const next = await readReentryBrief(f.user.id, f.mission.id);
  expect(next.items.length).toBeLessThanOrEqual(3);
  expect(next.items[0].kind).toBe("NEEDS_DECISION");
  expect(next.items[0].title).toContain("判断");
  expect(next.items[0].questionId).toBe(question.id);
  expect(next.items.some(item => item.kind === "OUTPUT_UPDATED" && item.revision === 2)).toBe(true);
  expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(0);
  const replay = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-1", seenSeq: first.cursor.seq, seenOutputRevision: 1, handledItemIds: [first.items[0].id] });
  expect(replay.readState).toBe("UNREAD");
  await expect(acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-1", seenSeq: 999, seenOutputRevision: 2 })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  const acknowledged = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-question", seenSeq: next.cursor.seq, seenOutputRevision: 2 });
  expect(acknowledged.items).toEqual([expect.objectContaining({ questionId: question.id, read: true })]);
  expect((await readProjectReturnItems(f.user.id, f.project.id))[0].questionId).toBe(question.id);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { waitStateJson: { questionId: question.id, resolved: true } } });
  expect(await readProjectReturnItems(f.user.id, f.project.id)).toEqual([]);
});

test("an accepted V2 answer clears the waiting timer and is immediately claimable", async () => {
  const f = await fixture();
  const question = await db.agentMissionEvent.create({ data: { missionId: f.mission.id, seq: 2, type: "QUESTION", payloadJson: { question: "验收采用哪个口径？" } } });
  const waiting = await db.agentMission.update({ where: { id: f.mission.id }, data: { status: "WAITING_INPUT", nextEventSeq: 2,
    nextAttemptAt: new Date(Date.now() + 3600000), waitStateJson: { waitingFor: "USER", questionId: question.id } } });
  const body = { requestId: "answer-now", expectedVersion: waiting.version, questionId: question.id, answer: "仅以第一批记录为准。" };
  const answered = await commandMission(f.user.id, f.mission.id, "input", body);
  expect(answered.nextAttemptAt).toBeNull();
  expect((await claimMission("answer-worker", f.mission.id))?.status).toBe("RUNNING");
  await commandMission(f.user.id, f.mission.id, "input", body);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "INPUT" } })).toBe(1);
});

test("return baselines survive the recent revision window and delivery rechecks source permission", async () => {
  const f = await fixture();
  await f.output(1);
  const first = await readReentryBrief(f.user.id, f.mission.id);
  await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "read-one", seenSeq: first.cursor.seq, seenOutputRevision: 1 });
  for (let revision = 2; revision <= 7; revision++) await f.output(revision);
  const newest = await f.output(8);
  const [notice] = await readProjectReturnItems(f.user.id, f.project.id);
  expect(notice).toMatchObject({ baseline: 1, output: { revision: 8 } });
  const workbench = await readMissionWorkbench(f.user.id, f.mission.id);
  expect(workbench.outputs.map(output => output.revision)).toEqual([8, 7, 6, 5, 4, 1]);
  const delivery = await readWorkbenchDelivery(f.user.id, f.mission.id, newest.id, 8, 1);
  expect(delivery.markdown).toContain("第 1 版 → 第 8 版");
  expect(delivery.markdown).toContain("待补证据");
  expect(delivery.markdown).toContain("引用 〔1〕");
  await expect(readWorkbenchDelivery(f.user.id, f.mission.id, newest.id, 7, 1)).rejects.toMatchObject({ code: "OUTPUT_NOT_FOUND" });

  const session = await createSession(f.user.id);
  const actor = { userId: f.user.id, sessionId: session.session.id };
  const conversation = await createConversation(actor, { requestId: "revoke-delivery", scope: "PROJECT", projectId: f.project.id });
  await submitDirective(actor, conversation.id, { commandId: "revoke-delivery", expectedSeq: 0, scope: { projectId: f.project.id, missionId: f.mission.id },
    operation: "SUPPRESS_USE", sourceIds: ["capture:" + f.source.id], timezone: "Asia/Shanghai" });
  await expect(readWorkbenchDelivery(f.user.id, f.mission.id, newest.id, 8, 1)).rejects.toMatchObject({ code: "DELIVERY_SOURCE_CHANGED" });
  expect(await readProjectReturnItems(f.user.id, f.project.id)).toEqual([]);
});

test("later duplicates are deduped and only three newest changes surface", async () => {
  const f = await fixture();
  for (let revision = 1; revision <= 5; revision++) await f.output(revision);
  const brief = await readReentryBrief(f.user.id, f.mission.id);
  expect(brief.items).toHaveLength(3);
  expect(brief.items.map(item => item.revision)).toEqual([3, 4, 5]);
  const a = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-batch", seenSeq: brief.cursor.seq, seenOutputRevision: 5 });
  const b = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "seen-batch", seenSeq: brief.cursor.seq, seenOutputRevision: 5 });
  expect(a.items).toEqual([]); expect(b.items).toEqual([]);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "REENTRY_BRIEF_SEEN" } })).toBe(1);
});

test("other users cannot read or acknowledge the brief", async () => {
  const f = await fixture();
  await f.output(1);
  const outsider = await db.user.create({ data: { username: "outsider-" + crypto.randomUUID(), displayName: "外部", passwordHash: "unused" } });
  await expect(readReentryBrief(outsider.id, f.mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  await expect(acknowledgeReentryBrief(outsider.id, f.mission.id, { requestId: "x", seenSeq: 0, seenOutputRevision: 0 })).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
});

test("late acknowledgements cannot rewind and future cursors are rejected", async () => {
  const f = await fixture(); await f.output(1);
  const old = await readReentryBrief(f.user.id, f.mission.id);
  await f.output(2);
  const latest = await readReentryBrief(f.user.id, f.mission.id);
  await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "new", seenSeq: latest.cursor.seq, seenOutputRevision: 2 });
  const late = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "late", seenSeq: old.cursor.seq, seenOutputRevision: 1 });
  expect(late.items).toEqual([]);
  await expect(acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "future", seenSeq: 999999, seenOutputRevision: 999 }))
    .rejects.toMatchObject({ code: "REENTRY_CURSOR_INVALID" });
});

test("handling one change preserves the other unread change", async () => {
  const f = await fixture(); await f.output(1); await f.output(2);
  const brief = await readReentryBrief(f.user.id, f.mission.id);
  const result = await acknowledgeReentryBrief(f.user.id, f.mission.id, { requestId: "handle-one", seenSeq: brief.cursor.seq, seenOutputRevision: 2, handledItemIds: [brief.items[0].id] });
  expect(result.items).toHaveLength(1); expect(result.items[0].revision).toBe(2); expect(result.readState).toBe("UNREAD");
});
