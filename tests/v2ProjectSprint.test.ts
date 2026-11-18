import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("project-sprint"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { claimMission } from "@/lib/mission/runtimeStore";
import { readProjectSprint, commandProjectSprint } from "@/lib/mission/sprintService";
Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_CHALLENGES_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "冲刺", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "真实成果冲刺", description: "合成项目", goal: "核查报告", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const mission = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "核查报告" });
  return { user, mission, project };
}
test("idle Mission refuses a fake two-person sprint", async () => {
  const f = await fixture();
  expect((await readProjectSprint(f.user.id, f.mission.id)).canStart).toBe(false);
  await expect(commandProjectSprint(f.user.id, f.mission.id, { action: "START", requestId: "start", objective: "核对引用", minutes: 5 })).rejects.toMatchObject({ code: "SPRINT_NOT_READY" });
});
test("real lease, durable receipts, self report and independent end are idempotent", async () => {
  const f = await fixture(); await claimMission("sprint-worker", f.mission.id);
  try {
    const body = { action: "START", requestId: "start", objective: "核对引用", minutes: 5 };
    const started = await commandProjectSprint(f.user.id, f.mission.id, body), id = started.session!.id;
    expect(started.session!.agent).toMatchObject({ working: true, completedSteps: 0, newOutputs: 0 });
    expect((await commandProjectSprint(f.user.id, f.mission.id, body)).replayed).toBe(true);
    await db.agentMissionStep.create({ data: { missionId: f.mission.id, ordinal: 1, planRevision: 1, toolName: "read_project_material", status: "SUCCEEDED", canonicalInputJson: {}, inputHash: "fixture", readSetJson: [], finishedAt: new Date() } });
    await db.agentMissionOutput.create({ data: { missionId: f.mission.id, revision: 1, kind: "NOTE",
      contentJson: { blocks: [], missingInformation: ["真机分享仍待核对"] }, sourceRefsJson: [], claimChecksJson: [] } });
    await db.agentMissionEvent.create({ data: { missionId: f.mission.id, seq: 999, type: "CHALLENGE_SOURCE_OPENED",
      payloadJson: { challengeId: "synthetic", sourceKey: "capture:record@hash" } } });
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    const report = await commandProjectSprint(f.user.id, f.mission.id, { action: "SELF_REPORT", requestId: "done", sprintId: id, done: true });
    expect(report.session).toMatchObject({ selfReportedDone: true, agent: { completedSteps: 1, newOutputs: 1, latestNewRevision: 1, openedSources: 0, openItems: ["真机分享仍待核对"] } });
    expect(report.session!.agent.receipts.map(receipt => receipt.label)).toEqual(expect.arrayContaining(["读取资料", "保存新稿 · 第 1 版"]));
    const ended = await commandProjectSprint(f.user.id, f.mission.id, { action: "END", requestId: "end", sprintId: id });
    expect(ended.session!.status).toBe("ENDED");
    await db.agentMissionOutput.create({ data: { missionId: f.mission.id, revision: 2, kind: "NOTE", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
    const afterEnd = await readProjectSprint(f.user.id, f.mission.id);
    expect(afterEnd.session!.agent.newOutputs).toBe(1);
    expect(afterEnd.session!.agent.latestNewRevision).toBe(1);
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(after.status).toBe("RUNNING"); expect(after.version).toBe(before.version); expect(after.pauseRequestedAt).toBeNull();
    await expect(commandProjectSprint(f.user.id, f.mission.id, { action: "SELF_REPORT", requestId: "late", sprintId: id, done: false })).rejects.toMatchObject({ code: "SPRINT_ENDED" });
    await expect(commandProjectSprint(f.user.id, f.mission.id, { ...body, objective: "另一件事" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    const outsider = await fixture();
    await expect(readProjectSprint(outsider.user.id, f.mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  } finally { await db.agentMission.update({ where: { id: f.mission.id }, data: { executionSlot: null, status: "PAUSED" } }); }
});
test("elapsed and lease expiry never manufacture progress", async () => {
  const f = await fixture(); await claimMission("sprint-worker", f.mission.id);
  try {
    const start = await commandProjectSprint(f.user.id, f.mission.id, { action: "START", requestId: "start", objective: "核对", minutes: 5 });
    await db.agentMissionEvent.update({ where: { id: start.session!.id }, data: { payloadJson: { objective: "核对", endsAt: new Date(0).toISOString(), baselineRevision: 0 } } });
    await db.agentMission.update({ where: { id: f.mission.id }, data: { leaseUntil: new Date(0) } });
    const view = await readProjectSprint(f.user.id, f.mission.id);
    expect(view).toMatchObject({ canStart: false, session: { status: "ELAPSED", agent: { working: false, completedSteps: 0, newOutputs: 0 } } });
  } finally { await db.agentMission.update({ where: { id: f.mission.id }, data: { executionSlot: null, status: "PAUSED" } }); }
});

test("visit receipts count sources opened in this sprint and summaries respect source revocation", async () => {
  const f = await fixture(); await claimMission("sprint-worker", f.mission.id);
  try {
    const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
    const { json } = await import("@/lib/mission/contracts");
    const { createSession } = await import("@/lib/auth/session");
    const { createConversation } = await import("@/lib/conversation/service");
    const { submitDirective } = await import("@/lib/continuity/directiveService");
    const capture = await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "待核对原文" } });
    const ref = (await readProjectMaterial(f.project.id, "capture:" + capture.id))!;
    const { session } = await commandProjectSprint(f.user.id, f.mission.id, { action: "START", requestId: "start", objective: "核对", minutes: 5 });
    await db.agentMissionOutput.create({ data: { missionId: f.mission.id, revision: 1, kind: "NOTE", contentJson: { blocks: [], missingInformation: ["对此来源的私有备注"] }, sourceRefsJson: json([ref]), claimChecksJson: [] } });
    const input = { action: "OPEN_SOURCE", requestId: "open", sprintId: session!.id, sourceKey: ref.id + "@" + ref.hash };
    expect((await commandProjectSprint(f.user.id, f.mission.id, input)).session!.agent.openedSources).toBe(1);
    expect((await commandProjectSprint(f.user.id, f.mission.id, { ...input, requestId: "open-again" })).session!.agent.openedSources).toBe(1);
    const actor = { userId: f.user.id, sessionId: (await createSession(f.user.id)).session.id };
    const conversation = await createConversation(actor, { requestId: "sprint-suppress", scope: "PROJECT", projectId: f.project.id });
    await submitDirective(actor, conversation.id, { commandId: "suppress", expectedSeq: 0, scope: { projectId: f.project.id, missionId: f.mission.id }, operation: "SUPPRESS_USE", sourceIds: [ref.id] });
    expect((await readProjectSprint(f.user.id, f.mission.id)).session!.agent.openItems).toEqual([]);
    await expect(commandProjectSprint(f.user.id, f.mission.id, { ...input, requestId: "after-suppression" })).rejects.toMatchObject({ status: 409 });
  } finally { await db.agentMission.update({ where: { id: f.mission.id }, data: { executionSlot: null, status: "PAUSED" } }); }
});
