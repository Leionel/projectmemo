import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m3-challenges"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { createMission, commandMission, missionEvents } from "@/lib/mission/missionService";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { startChallenge, commandChallenge, readChallenge } from "@/lib/challenges/service";
import { challengeQuestions, linkVerdict } from "@/lib/challenges/rules";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { previewV2Delegation, confirmV2Delegation } from "@/lib/mission/v2DelegationService";
import { runMissionSlice } from "@/lib/mission/runner";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";
Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_CHALLENGES_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成彩排", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "科研对照与交付", goal: "交付", description: "合成", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const source = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: "合成记录：移动端输入已回归；分享入口未验证。canary-private-m3" } });
  const m = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: "fixture", goal: "整理交付报告" });
  const ref = (await readProjectMaterial(project.id, "capture:" + source.id))!;
  const content = { blocks: [{ blockId: "b", kind: "PROJECT_OBSERVATION", text: "移动端输入已回归，分享入口未验证。canary-private-m3", sourceIds: [ref.id] }], missingInformation: ["分享入口未验证"] };
  const output = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "NOTE", contentJson: content, sourceRefsJson: json([ref]), claimChecksJson: [] } });
  const begin = async (kind: "EVIDENCE" | "REHEARSAL" = "EVIDENCE") => (await startChallenge(user.id, m.id, { requestId: crypto.randomUUID(), kind, outputId: output.id })).session;
  return { user, project, source, m, ref, output, begin };
}

test("citation question binds real source, hides answer key and never writes facts", async () => {
  const f = await fixture(), before = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }), s = await f.begin();
  expect(JSON.stringify(s)).not.toMatch(/expected|groundTruth/);
  expect(JSON.stringify(await missionEvents(f.user.id, f.m.id))).not.toMatch(/expected|canary-private-m3/);
  expect(s.questions[0].options.map(o => o.key)).toContain(f.ref.id);
  const a = await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "a", questionKey: "trace", selected: [f.ref.id] });
  expect(a.session.answers[0].verdict).toBe("LINK_MATCH"); expect(a.session.status).toBe("COMPLETED");
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  expect(after.status).toBe(before.status); expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(0);
  expect(await db.capture.count({ where: { projectId: f.project.id } })).toBe(1);
});

test("concurrent answer retries converge; changed body and second round writes are rejected", async () => {
  const f = await fixture(), s = await f.begin();
  const input = { action: "ANSWER", requestId: "same", questionKey: "trace", selected: ["NO_REFERENCE"] };
  const [a, b] = await Promise.all([commandChallenge(f.user.id, f.m.id, s.id, input), commandChallenge(f.user.id, f.m.id, s.id, input)]);
  expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  expect(a.session.answers).toHaveLength(1); expect(a.session.answers[0].verdict).toBe("REVIEW");
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { ...input, selected: [f.ref.id] })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { ...input, requestId: "other" })).rejects.toMatchObject({ code: "CHALLENGE_ROUND_CHANGED" });
});

test.each(["source-change", "source-delete", "new-material", "output-change", "context-change"])("%s withdraws cached questions and refuses answers", async change => {
  const f = await fixture(), s = await f.begin();
  if (change === "source-change") await db.capture.update({ where: { id: f.source.id }, data: { rawText: "修订记录" } });
  if (change === "source-delete") await db.capture.delete({ where: { id: f.source.id } });
  if (change === "new-material") await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "新条件" } });
  if (change === "output-change") await db.agentMissionOutput.update({ where: { id: f.output.id }, data: { contentJson: { blocks: [] } } });
  if (change === "context-change") await db.agentMission.update({ where: { id: f.m.id }, data: { contextVersion: { increment: 1 } } });
  const stale = await readChallenge(f.user.id, f.m.id, s.id);
  expect(stale?.status).toBe("STALE"); expect(stale?.questions).toEqual([]); expect(stale?.sourceKeys).toEqual([]);
  expect(JSON.stringify(stale)).not.toContain("canary-private-m3");
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "late", questionKey: "trace", selected: [f.ref.id] })).rejects.toMatchObject({ code: "CHALLENGE_STALE" });
});

test("owner removal and cross-project ids reveal no challenge", async () => {
  const f = await fixture(), other = await fixture(), s = await f.begin();
  await expect(readChallenge(other.user.id, f.m.id, s.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  await expect(readChallenge(f.user.id, f.m.id, (await other.begin()).id)).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "OPEN_SOURCE", requestId: "foreign", sourceKey: other.ref.id + "@" + other.ref.hash })).rejects.toMatchObject({ code: "CHALLENGE_SOURCE_DENIED" });
  await db.projectMembership.delete({ where: { userId_projectId: { userId: f.user.id, projectId: f.project.id } } });
  await expect(readChallenge(f.user.id, f.m.id, s.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
});

test("source visits persist across reload; stop exits challenge while original Mission remains active", async () => {
  const f = await fixture(), s = await f.begin();
  const body = { action: "OPEN_SOURCE", requestId: "visit", sourceKey: f.ref.id + "@" + f.ref.hash };
  await commandChallenge(f.user.id, f.m.id, s.id, body); await commandChallenge(f.user.id, f.m.id, s.id, body);
  expect((await readChallenge(f.user.id, f.m.id))?.openedSourceKeys).toEqual([body.sourceKey]);
  await commandChallenge(f.user.id, f.m.id, s.id, { action: "STOP", requestId: "stop" });
  expect((await readChallenge(f.user.id, f.m.id))?.status).toBe("STOPPED");
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).status).toBe("READY");
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "late", questionKey: "trace", selected: [f.ref.id] })).rejects.toMatchObject({ code: "CHALLENGE_STOPPED" });
});

test("three rehearsal rounds are open questions, handoff atomically preserves unconfirmed feedback and receipt", async () => {
  const f = await fixture(), s = await f.begin("REHEARSAL");
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "HANDOFF", requestId: "early" })).rejects.toMatchObject({ code: "CHALLENGE_INCOMPLETE" });
  for (const question of s.questions) {
    const result = await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: question.key, questionKey: question.key, text: "请保留分享入口未验证，核对验收口径。" });
    expect(result.session.answers.at(-1)?.verdict).toBe("OPEN");
  }
  const body = { action: "HANDOFF", requestId: "handoff" };
  const [a, b] = await Promise.all([commandChallenge(f.user.id, f.m.id, s.id, body), commandChallenge(f.user.id, f.m.id, s.id, body)]);
  expect(a.session.handoffSourceId).toBe(b.session.handoffSourceId);
  expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  const material = await db.capture.findUniqueOrThrow({ where: { id: a.session.handoffSourceId!.slice(8) } });
  expect(material.rawText).toContain("不代表已确认变更"); expect(material.rawText).toContain("验收口径");
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "CHALLENGE_HANDED_OFF" } })).toBe(1);
  expect(await db.agentMissionOutput.findUniqueOrThrow({ where: { id: f.output.id } })).toEqual(f.output);
  const { sourceUse } = await import("@/lib/continuity/sourcePolicy");
  expect((await sourceUse(f.user.id, f.project.id, a.session.handoffSourceId!)).state).toBe("ALLOWED");
  await db.capture.delete({ where: { id: f.source.id } });
  expect((await sourceUse(f.user.id, f.project.id, a.session.handoffSourceId!)).state).not.toBe("ALLOWED");
});

test("rehearsal answers can bind a real source; foreign keys are rejected and old clients still work", async () => {
  const f = await fixture(), s = await f.begin("REHEARSAL"), key = s.sourceKeys[0];
  const first = await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "bind", questionKey: s.questions[0].key,
    text: "这条依据仍要保留，分享边界不改。", evidenceKeys: [key] });
  expect(first.session.answers[0].evidenceKeys).toEqual([key]);
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "foreign", questionKey: s.questions[1].key,
    text: "另一处边界", evidenceKeys: ["capture:not-this-mission@hash"] })).rejects.toMatchObject({ code: "CHALLENGE_SOURCE_DENIED" });
  const legacy = await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "legacy", questionKey: s.questions[1].key,
    text: "旧客户端不发送来源绑定。" });
  expect(legacy.session.answers[1].evidenceKeys).toEqual([]);
  expect(legacy.session.answers).toHaveLength(2);
});

test("handed-off answers are locked; deleting the attempt withdraws the receipt and redacts feedback", async () => {
  const f = await fixture(), s = await f.begin("EVIDENCE");
  await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "answer", questionKey: "trace", selected: [f.ref.id] });
  const handed = await commandChallenge(f.user.id, f.m.id, s.id, { action: "HANDOFF", requestId: "handoff" });
  expect(handed.session.status).toBe("COMPLETED");
  await expect(commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "late-answer", questionKey: "trace", selected: [f.ref.id] }))
    .rejects.toMatchObject({ code: "CHALLENGE_ALREADY_HANDED_OFF" });
  const feedbackId = handed.session.handoffSourceId!.slice(8);
  const deleted = await commandChallenge(f.user.id, f.m.id, s.id, { action: "DELETE_ATTEMPT", requestId: "delete" });
  expect(deleted.session.handoffSourceId).toBeNull();
  expect(deleted.session.handoffAt).toBeNull();
  expect(deleted.session.answers).toEqual([]);
  expect(deleted.session.status).toBe("ACTIVE");
  expect((await db.capture.findUniqueOrThrow({ where: { id: feedbackId } })).rawText).toBe("本轮核查回答已删除。");
  const again = await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "again", questionKey: "trace", selected: [f.ref.id] });
  expect(again.session.status).toBe("COMPLETED");
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "CHALLENGE_HANDED_OFF" } })).toBe(1);
});

test("handoff receipt survives later material and a newer draft without becoming a withdrawal", async () => {
  const f = await fixture(), s = await f.begin("REHEARSAL");
  for (const question of s.questions) await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: question.key,
    questionKey: question.key, text: "保留分享入口未验证；补一条真机验证计划。" });
  const handed = await commandChallenge(f.user.id, f.m.id, s.id, { action: "HANDOFF", requestId: "handoff" });
  expect(handed.session.handoffAt).toBeTruthy();
  await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "交回之后的另一份材料" } });
  await db.agentMissionOutput.create({ data: { missionId: f.m.id, revision: 2, kind: "NOTE", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
  const after = await readChallenge(f.user.id, f.m.id, s.id);
  expect(after?.status).toBe("COMPLETED");
  expect(after?.handoffSourceId).toBe(handed.session.handoffSourceId);
  expect(after?.handoffAt).toBe(handed.session.handoffAt);
  expect(after?.questions).toHaveLength(3);
});

test("source suppression after a completed attempt redacts both original questions and submitted answers", async () => {
  const f = await fixture(), s = await f.begin("REHEARSAL");
  await commandChallenge(f.user.id, f.m.id, s.id, { action: "ANSWER", requestId: "answer", questionKey: "evidence", text: "canary-private-m3 引用还要核对" });
  const { submitDirective } = await import("@/lib/continuity/directiveService");
  const { createConversation } = await import("@/lib/conversation/service");
  const { createSession } = await import("@/lib/auth/session");
  const actor = { userId: f.user.id, sessionId: (await createSession(f.user.id)).session.id };
  const c = await createConversation(actor, { requestId: "challenge-suppress", scope: "PROJECT", projectId: f.project.id });
  await submitDirective(actor, c.id, { commandId: "suppress", expectedSeq: 0, scope: { projectId: f.project.id, missionId: f.m.id }, operation: "SUPPRESS_USE", sourceIds: [f.ref.id] });
  const value = await readChallenge(f.user.id, f.m.id, s.id);
  expect(value?.status).toBe("STALE"); expect(value?.answers).toEqual([]); expect(JSON.stringify(value)).not.toContain("canary-private-m3");
});

test("genuine rehearsal → original scanner → same Mission new private revision", async () => {
  const f = await fixture();
  const input = { goal: "整理交付说明", materialText: "合成原文：分享入口未验证，验收口径待确认。", expiresInDays: 7 };
  const preview = await previewV2Delegation(f.user.id, f.project.id, input);
  const confirmed = await confirmV2Delegation(f.user.id, f.project.id, { ...input, requestId: "journey", expiresAt: preview.expiresAt, previewHash: preview.previewHash });
  const provider = fixtureSkillProvider(async () => {
    const capture = await db.capture.findFirstOrThrow({ where: { projectId: f.project.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const source = (await readProjectMaterial(f.project.id, "capture:" + capture.id))!; return { sourceId: source.id, sourceHash: source.hash };
  });
  async function cycle() { for (let i = 0; i < 8; i++) { if ((await db.agentMission.findUniqueOrThrow({ where: { id: confirmed.missionId } })).status !== "READY") break; await runMissionSlice({ id: confirmed.missionId, provider }); } }
  await cycle(); const output = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: confirmed.missionId }, orderBy: { revision: "desc" } });
  const s = (await startChallenge(f.user.id, confirmed.missionId, { requestId: "rehearsal", kind: "REHEARSAL", outputId: output.id })).session;
  for (const question of s.questions) await commandChallenge(f.user.id, confirmed.missionId, s.id, { action: "ANSWER", requestId: question.key, questionKey: question.key, text: "补充验收边界，同时保留分享入口未验证。" });
  await commandChallenge(f.user.id, confirmed.missionId, s.id, { action: "HANDOFF", requestId: "deliver" });
  expect((await processInvestigationDelegations(32)).woken).toBeGreaterThanOrEqual(1); await cycle();
  const next = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: confirmed.missionId }, orderBy: { revision: "desc" } });
  expect(next.revision).toBe(output.revision + 1); expect(JSON.stringify(next.contentJson)).toContain("补充验收边界");
  const m = await db.agentMission.findUniqueOrThrow({ where: { id: confirmed.missionId } });
  await commandMission(f.user.id, m.id, "cancel", { requestId: "cancel", expectedVersion: m.version });
  await expect(startChallenge(f.user.id, m.id, { requestId: "after-end", kind: "REHEARSAL", outputId: next.id })).rejects.toMatchObject({ code: "CHALLENGE_MISSION_ENDED" });
});

test("multiple cited sources require the full set; inference cannot be scored as a factual citation", () => {
  const sources = ["a", "b"].map(id => ({ id, hash: jsonHash(id), kind: "PROJECT", text: id } as Source));
  const content = { blocks: [{ kind: "PROJECT_OBSERVATION", text: "两份记录合并", sourceIds: ["a", "b"] }] };
  const [q] = challengeQuestions("EVIDENCE", content, sources);
  expect(linkVerdict(q, ["a"])).toBe("REVIEW"); expect(linkVerdict(q, ["b", "a"])).toBe("LINK_MATCH");
  expect(() => linkVerdict(q, ["foreign"])).toThrow();
  expect(() => challengeQuestions("EVIDENCE", { blocks: [{ ...content.blocks[0], kind: "INFERENCE" }] }, sources)).toThrow();
});

test("start replay stays bound to the original output; a second active session is rejected", async () => {
  const f = await fixture(), input = { requestId: "bound", kind: "EVIDENCE", outputId: f.output.id };
  const a = await startChallenge(f.user.id, f.m.id, input), b = await startChallenge(f.user.id, f.m.id, input);
  expect(a.session.id).toBe(b.session.id); expect(b.replayed).toBe(true);
  await expect(startChallenge(f.user.id, f.m.id, { ...input, kind: "REHEARSAL" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  await expect(f.begin("REHEARSAL")).rejects.toMatchObject({ code: "CHALLENGE_ACTIVE" });
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "CHALLENGE_STARTED" } })).toBe(1);
});

test("cancelled Mission stops accepting rounds; feature rollback leaves original output intact", async () => {
  const f = await fixture(), s = await f.begin();
  const m = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  await commandMission(f.user.id, m.id, "cancel", { requestId: "cancel", expectedVersion: m.version });
  expect((await readChallenge(f.user.id, m.id, s.id))?.status).toBe("STOPPED");
  await expect(commandChallenge(f.user.id, m.id, s.id, { action: "ANSWER", requestId: "late", questionKey: "trace", selected: [f.ref.id] })).rejects.toMatchObject({ code: "CHALLENGE_STOPPED" });
  process.env.MISSION_CHALLENGES_ENABLED = "false";
  try { await expect(readChallenge(f.user.id, m.id, s.id)).rejects.toMatchObject({ code: "CHALLENGE_DISABLED" }); }
  finally { process.env.MISSION_CHALLENGES_ENABLED = "true"; }
  expect(await db.agentMissionOutput.findUniqueOrThrow({ where: { id: f.output.id } })).toEqual(f.output);
});

test("paused Mission can receive a review receipt without being resumed", async () => {
  const f = await fixture(), s = await f.begin();
  const m = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  await commandMission(f.user.id, m.id, "pause", { requestId: "pause", expectedVersion: m.version });
  await commandChallenge(f.user.id, m.id, s.id, { action: "ANSWER", requestId: "a", questionKey: "trace", selected: [f.ref.id] });
  await commandChallenge(f.user.id, m.id, s.id, { action: "HANDOFF", requestId: "h" });
  await processInvestigationDelegations(32);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PAUSED");
});

test("expiry withdraws a saved question and unbound derived feedback stays unknown", async () => {
  const f = await fixture(), s = await f.begin();
  await db.agentMissionEvent.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - 86401000) } });
  expect((await readChallenge(f.user.id, f.m.id, s.id))?.status).toBe("STALE");
  const c = await db.capture.create({ data: { projectId: f.project.id, sourceType: "CHALLENGE_FEEDBACK", rawText: "缺少原始绑定的合成反馈" } });
  const { sourceUse } = await import("@/lib/continuity/sourcePolicy");
  expect((await sourceUse(f.user.id, f.project.id, "capture:" + c.id)).state).not.toBe("ALLOWED");
});
