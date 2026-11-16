import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-first"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy, missionDetail, commandMission } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { buildContext } from "@/lib/mission/contextBuilder";
import { readMissionResponsibility, reviseMissionResponsibility } from "@/lib/mission/responsibility";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { effectiveContinuity, assertDirectiveEffect, submitDirective } from "@/lib/continuity/directiveService";
import { readMissionWorkbench } from "@/lib/mission/workbenchService";
import { planSkillSequence } from "@/lib/skills/router";
import { json } from "@/lib/mission/contracts";
import { saveOutput } from "@/lib/mission/outputService";
import { workspaceDirectory } from "@/lib/services/workspaceContextService";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";
import type { Decision } from "@/lib/mission/contracts";
Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture(cohort: string) {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: cohort, passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: cohort, description: "隔离合成资料", goal: "准备一份有来源的阶段成果",
    scenario: "RESEARCH", memberships: { create: { userId: u.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: p.id, rawText: cohort + "：第一版资料，结果仍待核对。", sourceType: "TEXT" } });
  const created = await createMission(u.id, { runtimeProtocolVersion: 2, projectId: p.id, requestId: p.id,
    goal: "整理阶段汇报成果", llmContextApproved: true });
  const m = await editContinuationPolicy(u.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 1, maxModels: 24, maxTools: 32, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], timezone: "Asia/Singapore" } });
  let selected = capture.id;
  const provider = fixtureSkillProvider(async () => {
    const source = await readProjectMaterial(p.id, "capture:" + selected);
    return { sourceId: source!.id, sourceHash: source!.hash };
  });
  return { u, p, m, capture, provider, select: (id: string) => { selected = id; } };
}
async function cycle(f: Awaited<ReturnType<typeof fixture>>) {
  for (let i = 0; i < 4; i++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: row.id, provider: f.provider });
  }
  return missionDetail(f.u.id, f.m.id);
}
test.each(["独立开发版本", "客户交付项目", "科研实验汇报", "学生课程项目"])("%s: persisted research→creation, restart, new material and same-Mission draft v2", async cohort => {
  const f = await fixture(cohort), first = await cycle(f);
  expect(first.status, JSON.stringify(first.error)).toBe("WAITING_INPUT");
  expect(first.outputs).toHaveLength(1);
  expect(first.workState.phase).toBe("WAITING_OBSERVATION");
  expect(first.evidencePremise).toBeNull();
  expect((first.delegation as { attention: { needsUser: boolean } }).attention.needsUser).toBe(false);
  expect(JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))).completionReadback)
    .toMatchObject({ canFinish: false, canCheckpoint: true, note: expect.stringContaining("await_event") });
  expect(first.outputs[0].sourceRefsJson).toEqual(expect.arrayContaining([expect.objectContaining({ id: "capture:" + f.capture.id })]));
  expect((first.used as { reservedOutputTokens: number }).reservedOutputTokens).toBe(0);
  const before = first.used;
  const newer = await db.capture.create({ data: { projectId: f.p.id, sourceType: "TEXT", rawText: cohort + "：第二版新增限制，需要修订交付说明。" } });
  f.select(newer.id);
  await db.agentMission.update({ where: { id: f.m.id }, data: { nextAttemptAt: new Date(0) } });
  expect((await processInvestigationDelegations(32)).woken).toBeGreaterThanOrEqual(1);
  // No UI callback: the existing scanner and real runner own continuation.
  const second = await cycle(f);
  expect(second.id).toBe(first.id);
  expect(second.outputs).toHaveLength(2);
  expect(second.outputs[0].sourceRefsJson).toEqual(expect.arrayContaining([expect.objectContaining({ id: "capture:" + newer.id })]));
  expect(second.used).toMatchObject({ models: (before as { models: number }).models + 3, tools: 4 });
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "SKILL_HANDOFF" } })).toBe(2);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "CHECKPOINT_REACHED" } })).toBe(2);
  await db.agentMission.update({ where: { id: f.m.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32); await processInvestigationDelegations(32);
  expect((await missionDetail(f.u.id, f.m.id)).outputs).toHaveLength(2);
});
test("all four shipped Skills route, while creation cannot bypass the evidence gate", async () => {
  expect(planSkillSequence("制定计划并拆解")).toEqual(["project-planning"]);
  expect(planSkillSequence("复盘失败原因")).toEqual(["project-review"]);
  expect(planSkillSequence("核查并整理阶段稿")).toEqual(["evidence-research", "deliverable-creation"]);
  const f = await fixture("门槛测试");
  // "只做计划，报告不要动" must stay a planning request: the fixed R→D chain cannot force a rewrite.
  await db.agentMission.update({ where: { id: f.m.id }, data: { goal: "这次只做计划，报告不要动" } });
  await runMissionSlice({ id: f.m.id, provider: async () => ({ choice: { kind: "tool", tool: "save_mission_output",
    summary: "越过计划改稿", args: { blocks: [{ blockId: "x", kind: "INFERENCE", text: "无来源稿", sourceIds: [] }] } },
    provider: "INJECTED_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  expect((await missionDetail(f.u.id, f.m.id)).error).toMatchObject({ code: "SKILL_OUTPUT_RESTRICTED" });
  expect(await db.agentMissionOutput.count({ where: { missionId: f.m.id } })).toBe(0);
});
test("an identical immediate draft is kept as the same version instead of a meaningless new revision", async () => {
  const f = await fixture("重复稿");
  const step = (ordinal: number, hash: string) => db.agentMissionStep.create({ data: {
    missionId: f.m.id, ordinal, planRevision: 1, toolName: "save_mission_output", status: "SUCCEEDED",
    canonicalInputJson: {}, inputHash: hash, readSetJson: [], finishedAt: new Date() } });
  const firstStep = await step(101, "dup-1"), secondStep = await step(102, "dup-2");
  const body = { blocks: [{ blockId: "same", kind: "INFERENCE" as const, text: "同一份私有稿", sourceIds: [] as string[] }] };
  const first = await saveOutput(db, f.m.id, firstStep.id, body, []);
  const second = await saveOutput(db, f.m.id, secondStep.id, body, []);
  expect(second.id).toBe(first.id);
  expect(await db.agentMissionOutput.count({ where: { missionId: f.m.id } })).toBe(1);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "OUTPUT_UNCHANGED" } })).toBe(1);
});
test("v2 user question does not auto-resolve when new material arrives; cancel never revives", async () => {
  const f = await fixture("待判断");
  await runMissionSlice({ id: f.m.id, provider: async () => ({ choice: { kind: "ask", question: "采用哪一种口径？", missing: "CRITICAL" },
    provider: "INJECTED_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  await db.capture.create({ data: { projectId: f.p.id, rawText: "第三方建议采用第一种口径" } });
  await db.agentMission.update({ where: { id: f.m.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32);
  const waiting = await missionDetail(f.u.id, f.m.id);
  expect(waiting.workState.phase).toBe("WAITING_USER");
  await commandMission(f.u.id, f.m.id, "cancel", { requestId: "stop", expectedVersion: waiting.version });
  await processInvestigationDelegations(32);
  expect((await missionDetail(f.u.id, f.m.id)).status).toBe("CANCELLED");
});
test("natural compound veto persists through original Conversation/Directive services", async () => {
  const f = await fixture("自然交互"), session = await createSession(f.u.id);
  await cycle(f);
  const actor = { userId: f.u.id, sessionId: session.session.id };
  const c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: f.p.id });
  await submitConversationTurn(actor, c.id, { requestId: "veto", expectedVersion: 1, expectedContinuitySeq: 0,
    message: "继续整理，但不要联网", entityRef: { kind: "MISSION", id: f.m.id, projectId: f.p.id } }, undefined, { defer: true });
  const view = await effectiveContinuity(f.u.id, { projectId: f.p.id, missionId: f.m.id });
  expect(() => assertDirectiveEffect(view, "EXTERNAL_READ")).toThrow();
  const restricted = await missionDetail(f.u.id, f.m.id);
  expect(restricted.workState.phase).toBe("WAITING_OBSERVATION");
  const newLocal = await db.capture.create({ data: { projectId: f.p.id, rawText: "已按用户限制补充本地资料" } }); f.select(newLocal.id);
  await db.agentMission.update({ where: { id: f.m.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32);
  expect((await cycle(f)).outputs).toHaveLength(2);
  expect((await missionDetail(f.u.id, f.m.id)).used).toMatchObject({ models: 6 });
});

test("bounded literal objective redirects v2 immediately without changing authority or resetting usage", async () => {
  const f = await fixture("改道后接续"); await cycle(f);
  const actor = { userId: f.u.id, sessionId: (await createSession(f.u.id)).session.id };
  const c = await createConversation(actor, { requestId: "redirect-c", scope: "PROJECT", projectId: f.p.id });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  await submitDirective(actor, c.id, { commandId: "objective", expectedSeq: 0, scope: { projectId: f.p.id, missionId: f.m.id },
    operation: "SET", quote: "今天先核对第二版交付依据", timezone: "Asia/Shanghai", admission: "LITERAL" });
  const updated = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  expect(updated.status).toBe("READY");
  expect(updated.continuationPolicyJson).toEqual(before.continuationPolicyJson);
  expect(updated.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect((await cycle(f)).outputs).toHaveLength(2);
  expect(JSON.stringify((await missionDetail(f.u.id, f.m.id)).outputs[0].contentJson)).toContain("今天先核对第二版交付依据");
});
test.each(["responsibility", "literal"])("%s correction fences a late model result and retains its usage", async mode => {
  const f = await fixture("晚到结果");
  await runMissionSlice({ id: f.m.id, provider: f.provider });
  let unblock!: (d: Decision) => void, started = false;
  const running = runMissionSlice({ id: f.m.id, provider: async raw => {
    const result = await f.provider(raw, {}); started = true;
    return new Promise<Decision>(resolve => { unblock = () => resolve(result); });
  } });
  await vi.waitFor(() => expect(started).toBe(true));
  if (mode === "responsibility") {
    const contract = await readMissionResponsibility(f.u.id, f.m.id);
    await reviseMissionResponsibility(f.u.id, f.m.id, { requestId: "redirect", expectedControlVersion: contract.controlVersion,
      workingObjective: "先核对第二版资料" });
  } else {
    const actor = { userId: f.u.id, sessionId: (await createSession(f.u.id)).session.id };
    const c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: f.p.id });
    await submitDirective(actor, c.id, { commandId: "redirect", expectedSeq: 0, scope: { projectId: f.p.id, missionId: f.m.id },
      operation: "SET", quote: "今天先核对第二版资料", admission: "LITERAL", timezone: "Asia/Shanghai" });
  }
  unblock({} as Decision); await running;
  const result = await missionDetail(f.u.id, f.m.id);
  expect(result.outputs).toHaveLength(0);
  expect((result.used as { models: number }).models).toBe(2);
});

test("a new responsibility cycle cannot checkpoint the previous version", async () => {
  const f = await fixture("新周期"), first = await cycle(f);
  expect(first.outputs).toHaveLength(1);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  const plan = row.planJson as { skillCursor: Record<string, unknown> };
  const cursor = { ...plan.skillCursor };
  delete cursor.outputId;
  await db.agentMission.update({ where: { id: f.m.id }, data: { contextVersion: { increment: 1 }, planRevision: { increment: 1 }, planJson: json({ ...plan, skillCursor: cursor }) } });
  const context = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))) as { completionReadback: { canCheckpoint: boolean; reason?: string } };
  expect(context.completionReadback).toMatchObject({ canCheckpoint: false, reason: "CURRENT_VERSION_REQUIRED" });
});
test("a method-gate rejection gets one guided retry with the repair hint", async () => {
  const f = await fixture("门槛重试"), good = f.provider;
  let first = true;
  const provider = async (raw: string) => {
    if (first) { first = false; return { choice: { kind: "tool" as const, tool: "save_mission_output", args: { blocks: [{ blockId: "x", kind: "INFERENCE" as const, text: "越过阶段", sourceIds: [] as string[] }] }, summary: "越过阶段" },
      provider: "INJECTED_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }; }
    return good(raw, {});
  };
  for (let index = 0; index < 8; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: row.id, provider });
  }
  expect((await missionDetail(f.u.id, f.m.id)).status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: f.m.id } })).toBe(1);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id, type: "SKILL_REPAIR_REQUESTED" } })).toBe(1);
});
test("natural continue never revives a deliberately paused v2 Mission", async () => {
  const f = await fixture("暂停边界"), current = await cycle(f);
  await commandMission(f.u.id, f.m.id, "pause", { requestId: "pause", expectedVersion: current.version });
  const actor = { userId: f.u.id, sessionId: (await createSession(f.u.id)).session.id };
  const c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: f.p.id });
  await submitDirective(actor, c.id, { commandId: "veto", expectedSeq: 0, scope: { projectId: f.p.id, missionId: f.m.id },
    operation: "SET", quote: "继续整理，但不要联网", admission: "LITERAL", timezone: "Asia/Shanghai" });
  await processInvestigationDelegations(32);
  expect((await missionDetail(f.u.id, f.m.id)).status).toBe("PAUSED");
  expect((await missionDetail(f.u.id, f.m.id)).used).toMatchObject({ models: 3 });
});

test("workbench reads frozen versions without writes, rejects outsiders and withholds suppressed material", async () => {
  process.env.MISSION_WORKBENCH_ENABLED = "true";
  const f = await fixture("私有稿边界"), first = await cycle(f);
  const original = first.outputs[0];
  await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "修订原记录：仅供新的版本使用" } });
  await db.agentMission.update({ where: { id: f.m.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32); await cycle(f);
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
  const view = await readMissionWorkbench(f.u.id, f.m.id);
  expect(view.outputs).toHaveLength(2);
  expect(view.sources).toHaveLength(2);
  expect(view.sources.map(s => s.hash)[0]).not.toBe(view.sources.map(s => s.hash)[1]);
  const old = view.outputs.find(o => o.id === original.id)!;
  expect(view.sources.find(s => old.sourceKeys.includes(s.key))).toMatchObject({ current: false, text: expect.stringContaining("第一版资料") });
  expect(view.outputs.every(o => o.presentation.schemaVersion === 1 && !o.presentation.allowedActions.length)).toBe(true);
  expect(await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).toEqual(before);
  const outsider = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "访客", passwordHash: "unused" } });
  await expect(readMissionWorkbench(outsider.id, f.m.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  const actor = { userId: f.u.id, sessionId: (await createSession(f.u.id)).session.id };
  expect((await workspaceDirectory(actor, "PROJECT", f.p.id)).summaries[0].waiting).toBe(0);
  const legacy = await createMission(f.u.id, { projectId: f.p.id, requestId: "legacy-question", goal: "核对旧协议问题" });
  await runMissionSlice({ id: legacy.id, provider: async () => ({ choice: { kind: "ask", question: "请给出评估口径", missing: "CRITICAL" },
    provider: "INJECTED_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  expect((await workspaceDirectory(actor, "PROJECT", f.p.id)).summaries[0].waiting).toBe(1);
  const c = await createConversation(actor, { requestId: "suppress-c", scope: "PROJECT", projectId: f.p.id });
  await submitDirective(actor, c.id, { commandId: "suppress", expectedSeq: 0, scope: { projectId: f.p.id, missionId: f.m.id },
    operation: "SUPPRESS_USE", sourceIds: ["capture:" + f.capture.id] });
  const suppressed = await readMissionWorkbench(f.u.id, f.m.id);
  expect(suppressed.sources).toEqual([]);
  expect(suppressed.outputs.every(o => !o.sourceKeys.length && o.blocks.every(b => b.text === "相关来源的使用许可已变化，请重新核对。"))).toBe(true);
  expect(JSON.stringify(suppressed)).not.toContain("第一版资料");
  process.env.MISSION_WORKBENCH_ENABLED = "false";
  await expect(readMissionWorkbench(f.u.id, f.m.id)).rejects.toMatchObject({ code: "WORKBENCH_DISABLED" });
});
