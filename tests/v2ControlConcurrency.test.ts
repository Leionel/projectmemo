import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-controls"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { commandMission, createMission, editContinuationPolicy, missionDetail } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";
import { missionWorkspaceSummary } from "@/lib/mission/workspaceSummary";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";

Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: "ctl-" + crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: label, description: "隔离控制竞态", goal: "整理持续报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: label + "：第一版资料，结果仍待核对。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理持续报告", llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 100, maxTools: 100, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  let selected = capture.id;
  const provider = fixtureSkillProvider(async () => {
    const source = await readProjectMaterial(project.id, "capture:" + selected);
    return { sourceId: source!.id, sourceHash: source!.hash };
  });
  return { user, project, mission, capture, provider, select: (id: string) => { selected = id; } };
}
async function settle(f: Awaited<ReturnType<typeof fixture>>) {
  for (let index = 0; index < 8; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: row.id, provider: f.provider });
  }
  return db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
}
async function checkpointed(f: Awaited<ReturnType<typeof fixture>>) {
  await settle(f);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(row.status).toBe("WAITING_INPUT");
  return row;
}
async function addMaterial(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  const capture = await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: text } });
  f.select(capture.id);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  return capture;
}
const outputs = (missionId: string) => db.agentMissionOutput.count({ where: { missionId } });
const budget = async (missionId: string) => (await db.agentMission.findUniqueOrThrow({ where: { id: missionId } })).budgetUsedJson as Record<string, number>;

test("new material arriving concurrently with pause never dispatches after the stop", async () => {
  const f = await fixture("暂停竞态");
  const row = await checkpointed(f);
  await addMaterial(f, "暂停竞态：新材料到达，同时用户暂停。");
  const [scan] = await Promise.all([
    processInvestigationDelegations(32),
    commandMission(f.user.id, f.mission.id, "pause", { requestId: "pause-race", expectedVersion: row.version }),
  ]);
  void scan;
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("PAUSED");
  const respected = await runMissionSlice({ id: f.mission.id, provider: f.provider });
  expect(respected).toBe(false);
  expect(await outputs(f.mission.id)).toBe(1);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "TOOL_STARTED", seq: { gt: 0 } } })).toBeLessThanOrEqual(2);
});

test("new material arriving concurrently with cancel cannot produce a draft", async () => {
  const f = await fixture("取消竞态");
  const row = await checkpointed(f);
  await addMaterial(f, "取消竞态：新材料到达，同时用户取消。");
  await Promise.all([
    processInvestigationDelegations(32),
    commandMission(f.user.id, f.mission.id, "cancel", { requestId: "cancel-race", expectedVersion: row.version }),
  ]);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("CANCELLED");
  expect(await runMissionSlice({ id: f.mission.id, provider: f.provider })).toBe(false);
  expect(await outputs(f.mission.id)).toBe(1);
});

test("a redirect directive racing a new material wake produces one revision with the new objective bound", async () => {
  const f = await fixture("改道竞态");
  const row = await checkpointed(f);
  await addMaterial(f, "改道竞态：第二版材料，新增条件仍待核对。");
  const session = await createSession(f.user.id);
  const actor = { userId: f.user.id, sessionId: session.session.id };
  const conversation = await createConversation(actor, { requestId: "race-conv", scope: "PROJECT", projectId: f.project.id });
  const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
  await Promise.all([
    processInvestigationDelegations(32),
    submitDirective(actor, conversation.id, { commandId: "race-redirect", expectedSeq: user.continuitySeq,
      scope: { projectId: f.project.id, missionId: f.mission.id }, operation: "SET", quote: "今天先核对第二版交付依据", timezone: "Asia/Shanghai", admission: "LITERAL" }),
  ]);
  await settle(f);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("WAITING_INPUT");
  expect(await outputs(f.mission.id)).toBe(2);
  const detail = await missionDetail(f.user.id, f.mission.id);
  expect(detail.workingObjective).toBe("今天先核对第二版交付依据");
  expect(after.contextVersion).toBeGreaterThan(row.contextVersion);
});

test("explicit ownership revocation stops the mission before dispatch and keeps the draft", async () => {
  const f = await fixture("撤权");
  await checkpointed(f);
  await db.projectMembership.deleteMany({ where: { projectId: f.project.id, userId: f.user.id } });
  await addMaterial(f, "撤权：新材料到达，但项目权限已撤销。");
  const scan = await processInvestigationDelegations(32);
  void scan;
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("PAUSED");
  expect(["AUTHORIZATION_REVOKED", "REVIEW_REQUIRED"]).toContain((after.lastErrorJson as { code?: string } | null)?.code ?? "REVIEW_REQUIRED");
  expect(await outputs(f.mission.id)).toBe(1);
  expect(await runMissionSlice({ id: f.mission.id, provider: f.provider })).toBe(false);
});

test("expired bounded permission holds the next check instead of consuming a model call", async () => {
  const f = await fixture("许可到期");
  const row = await checkpointed(f);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { continuationPolicyJson: {
    ...(row.continuationPolicyJson as object), expiresAt: new Date(Date.now() - 1000).toISOString() } } });
  await addMaterial(f, "许可到期：新材料不应再开新周期。");
  const before = await budget(f.mission.id);
  await processInvestigationDelegations(32);
  const held = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(held.status).toBe("PAUSED");
  const event = await db.agentMissionEvent.findFirst({ where: { missionId: f.mission.id, type: "INVESTIGATION_HELD" }, orderBy: { seq: "desc" } });
  expect((event?.payloadJson as { reason?: string }).reason).toBe("DELEGATION_EXPIRED");
  expect(await budget(f.mission.id)).toEqual(before);
  expect(await outputs(f.mission.id)).toBe(1);
});

test("long-running cycles settle reservations, known usage and unknown calls without resetting budgets", async () => {
  const f = await fixture("长期结算");
  await checkpointed(f);
  let previous = await budget(f.mission.id);
  for (let cycle = 0; cycle < 4; cycle++) {
    await addMaterial(f, "长期结算：第 " + (cycle + 2) + " 版材料，仍待核对。");
    await processInvestigationDelegations(32);
    const row = await settle(f);
    expect(row.status).toBe("WAITING_INPUT");
    const used = await budget(f.mission.id);
    expect(used.models).toBeGreaterThanOrEqual(previous.models + 3);
    expect(used.reservedOutputTokens).toBe(0);
    expect(used.unknownCalls).toBe(0);
    expect(used.inputTokens).toBeGreaterThanOrEqual(previous.inputTokens);
    expect(used.outputTokens).toBeGreaterThanOrEqual(previous.outputTokens);
    previous = used;
  }
  expect(await outputs(f.mission.id)).toBe(5);
  // A failed call with unknown usage is settled as an unknown call; it never resets cumulative usage.
  const failureProvider = async () => { throw new (await import("@/lib/api")).AppError("MODEL_TIMEOUT", "模型超时", 504); };
  let row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  const wake = await addMaterial(f, "长期结算：第六版材料，触发一次未知用量失败。");
  void wake;
  await processInvestigationDelegations(32);
  const detailBeforeFailure = await budget(f.mission.id);
  await runMissionSlice({ id: f.mission.id, provider: failureProvider });
  row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  const failedUsage = await budget(f.mission.id);
  expect(failedUsage.models).toBeGreaterThanOrEqual(detailBeforeFailure.models + 1);
  expect(failedUsage.unknownCalls).toBeGreaterThanOrEqual(detailBeforeFailure.unknownCalls);
  expect(failedUsage.inputTokens).toBeGreaterThanOrEqual(detailBeforeFailure.inputTokens);
  expect(row.status).toBe("PAUSED");
});

test("many observation-waiting missions cannot crowd a real user decision out of the project summary", async () => {
  const user = await db.user.create({ data: { username: "sum-" + crypto.randomUUID(), displayName: "摘要", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "摘要项目", description: "隔离测试", goal: "摘要", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const observationPolicy = { mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 24, maxTools: 32, maxMetadataRequests: 0, allowedTools: ["read_project_material"], connectionIds: [], timezone: "Asia/Shanghai" };
  const question = await db.agentMission.create({ data: { ownerUserId: user.id, projectId: project.id, createRequestId: "question",
    createPayloadHash: "q", goal: "需要用户判断", status: "WAITING_INPUT", runtimeProtocolVersion: 2, successCriteriaJson: ["DRAFT_EXISTS"],
    constraintsJson: {}, continuationPolicyJson: observationPolicy, budgetJson: {}, planRevision: 1, contextVersion: 1,
    waitStateJson: { waitingFor: "USER", questionId: "q1", question: "请补充验收口径", startedAt: new Date(0).toISOString() },
    updatedAt: new Date(Date.now() - 3600000) } as never });
  for (let index = 0; index < 20; index++) {
    const observation = await db.agentMission.create({ data: { ownerUserId: user.id, projectId: project.id, createRequestId: "obs-" + index,
      createPayloadHash: "o", goal: "持续观察 " + index, status: "WAITING_INPUT", runtimeProtocolVersion: 2, successCriteriaJson: ["DRAFT_EXISTS"],
      constraintsJson: {}, continuationPolicyJson: observationPolicy, budgetJson: {}, planRevision: 1, contextVersion: 1,
      waitStateJson: { waitingFor: "OBSERVATION", startedAt: new Date().toISOString() } } });
    const event = await db.agentMissionEvent.create({ data: { missionId: observation.id, seq: 1, type: "CHECKPOINT_REACHED", payloadJson: {} } });
    void event;
  }
  const summary = await missionWorkspaceSummary(user.id, project.id);
  expect(summary.items.length).toBeGreaterThan(0);
  expect(summary.items[0].id).toBe(question.id);
  expect(summary.items.some(item => item.id === question.id)).toBe(true);
});
