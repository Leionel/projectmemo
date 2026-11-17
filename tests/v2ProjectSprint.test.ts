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
    await db.agentMissionOutput.create({ data: { missionId: f.mission.id, revision: 1, kind: "NOTE", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    const report = await commandProjectSprint(f.user.id, f.mission.id, { action: "SELF_REPORT", requestId: "done", sprintId: id, done: true });
    expect(report.session).toMatchObject({ selfReportedDone: true, agent: { completedSteps: 1, newOutputs: 1 } });
    const ended = await commandProjectSprint(f.user.id, f.mission.id, { action: "END", requestId: "end", sprintId: id });
    expect(ended.session!.status).toBe("ENDED");
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
