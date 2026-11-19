import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m3-metric-privacy"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { json } from "@/lib/mission/contracts";
import { createMission } from "@/lib/mission/missionService";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { startChallenge, commandChallenge, readChallenge } from "@/lib/challenges/service";
import { sourceUse } from "@/lib/continuity/sourcePolicy";

Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_CHALLENGES_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const metric = (runId: string, value: number, overrides: Record<string, string | null> = {}) => ({
  runId, method: "baseline", metric: "accuracy", value, unit: "%", period: "2026-11", direction: "HIGHER_BETTER",
  dataset: "classroom-v1", split: "test", seed: "42", evaluationCode: "eval-v1", environment: "local", phase: "final", batchSize: "16",
  ...overrides,
});
async function fixture(rows: unknown, kind: "EVIDENCE" | "REHEARSAL" = "REHEARSAL") {
  const user = await db.user.create({ data: { username: "metric-" + crypto.randomUUID(), displayName: "指标核查", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "指标题", description: "隔离", goal: "核对指标", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: JSON.stringify(rows) } });
  const mission = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "核对指标", llmContextApproved: true });
  const ref = (await readProjectMaterial(project.id, "capture:" + capture.id))!;
  const output = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "NOTE",
    contentJson: { blocks: [{ blockId: "metric", kind: "PROJECT_OBSERVATION", text: "两次实验记录已整理，是否可比较待核对。", sourceIds: [ref.id] }], missingInformation: ["两次实验条件是否一致"] },
    sourceRefsJson: json([ref]), claimChecksJson: [] } });
  const begin = async (challengeKind = "METRIC") => (await startChallenge(user.id, mission.id, { requestId: crypto.randomUUID(), kind: challengeKind, outputId: output.id })).session;
  return { user, project, capture, mission, output, begin, kind };
}

test("same-condition MetricRecords produce a comparable question grounded in the real rule", async () => {
  const f = await fixture([metric("a", 80), metric("b", 84)]);
  const session = await f.begin();
  expect(session.status).toBe("ACTIVE");
  expect(session.questions).toHaveLength(1);
  expect(session.questions[0].key).toBe("compare");
  expect(JSON.stringify(session)).not.toMatch(/"expected"/);
  const answer = await commandChallenge(f.user.id, f.mission.id, session.id, { action: "ANSWER", requestId: "metric-match", questionKey: "compare", selected: ["CONDITIONS_MATCH"] });
  expect(answer.session.answers[0].verdict).toBe("LINK_MATCH");
  expect(answer.session.status).toBe("COMPLETED");
});

test("unknown conditions and mismatched units cannot be forced into a unique comparison", async () => {
  const unknown = await fixture([metric("a", 80, { dataset: null }), metric("b", 84)]);
  const unknownSession = await unknown.begin();
  const unknownAnswer = await commandChallenge(unknown.user.id, unknown.mission.id, unknownSession.id, { action: "ANSWER", requestId: "unknown", questionKey: "compare", selected: ["CONDITIONS_UNKNOWN"] });
  expect(unknownAnswer.session.answers[0].verdict).toBe("LINK_MATCH");
  const differs = await fixture([metric("a", 80, { unit: "%" }), metric("b", 0.84, { unit: "ratio" })]);
  const differsSession = await differs.begin();
  const differsAnswer = await commandChallenge(differs.user.id, differs.mission.id, differsSession.id, { action: "ANSWER", requestId: "differs", questionKey: "compare", selected: ["CONDITIONS_DIFFER"] });
  expect(differsAnswer.session.answers[0].verdict).toBe("LINK_MATCH");
});

test("no metric records or only one record refuses to invent a comparability question", async () => {
  const f = await fixture([metric("a", 80)]);
  await expect(f.begin()).rejects.toMatchObject({ code: "CHALLENGE_NOT_READY" });
  const plain = await fixture([], "REHEARSAL");
  const session = await plain.begin("REHEARSAL");
  expect(session.questions).toHaveLength(3);
});

test("duplicate source references do not turn one metric record into two", async () => {
  const f = await fixture([metric("a", 80)]);
  const ref = (await readProjectMaterial(f.project.id, "capture:" + f.capture.id))!;
  await db.agentMissionOutput.update({ where: { id: f.output.id }, data: { sourceRefsJson: json([ref, ref]) } });
  await expect(f.begin()).rejects.toMatchObject({ code: "CHALLENGE_NOT_READY" });
});

test("retention expiry clears online answers on access", async () => {
  const f = await fixture([]), s = await f.begin("REHEARSAL");
  await commandChallenge(f.user.id, f.mission.id, s.id, { action: "ANSWER", requestId: "answer", questionKey: "evidence", text: "retention-canary" });
  await db.agentMissionEvent.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - 31 * 86400000) } });
  expect(await readChallenge(f.user.id, f.mission.id, s.id)).toMatchObject({ status: "STALE", answers: [] });
  const rows = await db.agentMissionEvent.findMany({ where: { missionId: f.mission.id, type: "CHALLENGE_ANSWERED" } });
  expect(JSON.stringify(rows)).not.toContain("retention-canary");
});

test("deleting an attempt is logical, exposes no answer copy, and allows a fresh answer", async () => {
  const f = await fixture([], "REHEARSAL");
  const session = await f.begin("REHEARSAL");
  await commandChallenge(f.user.id, f.mission.id, session.id, { action: "ANSWER", requestId: "a1", questionKey: session.questions[0].key, text: "canary-delete-answer 需要核对来源" });
  const deleted = await commandChallenge(f.user.id, f.mission.id, session.id, { action: "DELETE_ATTEMPT", requestId: "del1" });
  expect(deleted.session.answers).toEqual([]);
  expect(deleted.session.status).toBe("ACTIVE");
  expect(deleted.session.retentionDays).toBe(30);
  expect(deleted.session.logicalDeletionNote).toContain("不宣称已物理擦除");
  const deletionEvent = await db.agentMissionEvent.findFirstOrThrow({ where: { missionId: f.mission.id, type: "CHALLENGE_ATTEMPT_DELETED" } });
  expect(JSON.stringify(deletionEvent.payloadJson)).not.toContain("canary-delete-answer");
  // A fresh attempt uses a new request id and can answer again; the tombstone itself is idempotent.
  const replay = await commandChallenge(f.user.id, f.mission.id, session.id, { action: "DELETE_ATTEMPT", requestId: "del1" });
  expect(replay.session.answers).toEqual([]);
  const again = await commandChallenge(f.user.id, f.mission.id, session.id, { action: "ANSWER", requestId: "a2", questionKey: session.questions[0].key, text: "重新核对来源" });
  expect(again.session.answers).toHaveLength(1);
  expect(await readChallenge(f.user.id, f.mission.id)).toMatchObject({ status: "ACTIVE" });
});

test("deleting after STOP remains available and does not restart the challenge", async () => {
  const f = await fixture([], "REHEARSAL");
  const session = await f.begin("REHEARSAL");
  await commandChallenge(f.user.id, f.mission.id, session.id, { action: "ANSWER", requestId: "x", questionKey: session.questions[0].key, text: "原回答" });
  await commandChallenge(f.user.id, f.mission.id, session.id, { action: "STOP", requestId: "stop" });
  const result = await commandChallenge(f.user.id, f.mission.id, session.id, { action: "DELETE_ATTEMPT", requestId: "del" });
  expect(result.session).toMatchObject({ status: "STOPPED", answers: [] });
  await expect(commandChallenge(f.user.id, f.mission.id, session.id, { action: "DELETE_ATTEMPT", requestId: "x" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
});

test("replay beyond 24 events preserves deletion and stop", async () => {
  const f = await fixture([]);
  const s = await f.begin("REHEARSAL");
  for (let i = 0; i < 13; i++) {
    await commandChallenge(f.user.id, f.mission.id, s.id, { action: "ANSWER", requestId: "answer-" + i, questionKey: "evidence", text: "核查意见" });
    await commandChallenge(f.user.id, f.mission.id, s.id, { action: "DELETE_ATTEMPT", requestId: "delete-" + i });
  }
  await commandChallenge(f.user.id, f.mission.id, s.id, { action: "STOP", requestId: "stop" });
  expect(await readChallenge(f.user.id, f.mission.id, s.id)).toMatchObject({ status: "STOPPED", answers: [] });
});

test("metric answers require exactly one option and no free text", async () => {
  const f = await fixture([metric("a", 80), metric("b", 84)]), s = await f.begin();
  for (const answer of [{ selected: [] }, { selected: ["CONDITIONS_MATCH", "CONDITIONS_MATCH"] }, { selected: ["CONDITIONS_MATCH"], text: "hidden-answer" }]) {
    await expect(commandChallenge(f.user.id, f.mission.id, s.id, { action: "ANSWER", requestId: crypto.randomUUID(), questionKey: "compare", ...answer }))
      .rejects.toMatchObject({ code: "CHALLENGE_ANSWER_REQUIRED" });
  }
});

test("deletion after handoff clears online text and suppresses feedback descendants", async () => {
  const f = await fixture([]), s = await f.begin("REHEARSAL");
  for (const q of s.questions) await commandChallenge(f.user.id, f.mission.id, s.id, { action: "ANSWER", requestId: q.key, questionKey: q.key, text: "private-delete-canary" });
  const handoff = await commandChallenge(f.user.id, f.mission.id, s.id, { action: "HANDOFF", requestId: "handoff" });
  const sourceId = handoff.session.handoffSourceId!;
  expect((await sourceUse(f.user.id, f.project.id, sourceId, db, { missionId: f.mission.id })).state).toBe("ALLOWED");
  await commandChallenge(f.user.id, f.mission.id, s.id, { action: "DELETE_ATTEMPT", requestId: "delete" });
  expect((await sourceUse(f.user.id, f.project.id, sourceId, db, { missionId: f.mission.id })).state).toBe("SUPPRESSED");
  const capture = await db.capture.findUniqueOrThrow({ where: { id: sourceId.slice(8) } });
  const events = await db.agentMissionEvent.findMany({ where: { missionId: f.mission.id } });
  expect(JSON.stringify({ capture, events })).not.toContain("private-delete-canary");
});
