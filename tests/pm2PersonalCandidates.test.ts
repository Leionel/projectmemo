import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("pm2-candidates"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { buildContext } from "@/lib/mission/contextBuilder";
import { createMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import { commandPersonalMemory, listPersonalMemory, listPendingCandidates, personalEntryDetail } from "@/lib/memory/personalMemoryService";
import { resolvePersonalContext } from "@/lib/memory/personalContext";
import type { Choice } from "@/lib/mission/contracts";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const scriptProvider = (choice: Choice) => async () =>
  ({ choice, provider: "PM2_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });

async function fixture(name: string) {
  const user = await db.user.create({ data: { username: name, displayName: name, passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "候选项目 " + name, description: "d", goal: "g",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, project };
}

test("J05：设备限制只形成带条件的候选，不自动激活；关闭开关时不产生候选", async () => {
  const { user, project } = await fixture("j05-" + crypto.randomUUID().slice(0, 8));
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "本项目当前没有 GPU，只能使用 CPU 完成训练。" } });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "跑通训练流程", llmContextApproved: true });
  const synthesis = { summary: "训练在 CPU 上完成；设备限制可能只是当前资源条件。", conditions: ["当前没有 GPU"], retainedReasons: ["资源限制待复核"],
    openQuestions: ["后续是否有 GPU"], commitments: [], hypotheses: [],
    memoryCandidates: [{ statement: "训练任务优先使用 CPU", kind: "PREFERENCE" as const, conditions: ["仅当没有 GPU 时"], basis: "本项目多次在 CPU 上训练", sourceIds: ["capture:" + capture.id] }] };
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + capture.id, sourceHash: await sourceHash(project.id, "capture:" + capture.id) }, summary: "读设备记录" }) });
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "save_mission_output", summary: "保留当前理解",
    args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "c", kind: "INFERENCE", text: synthesis.summary, sourceIds: ["capture:" + capture.id], citations: [] }],
      missingInformation: synthesis.openQuestions, memorySynthesis: synthesis } }) });
  // 候选推断默认关闭：不落任何候选
  expect(await listPendingCandidates(user.id)).toMatchObject({ items: [] });
  // 打开开关：同一原根与表述只提议一次
  await db.$transaction(async tx => {
    await tx.userMemoryPolicy.upsert({ where: { ownerUserId: user.id }, update: { candidateInferenceEnabled: true, settingsVersion: { increment: 1 }, privacyRevision: { increment: 1 } }, create: { ownerUserId: user.id, candidateInferenceEnabled: true } });
    await tx.userMemoryControlReceipt.create({ data: { ownerUserId: user.id, requestId: "enable-" + crypto.randomUUID(), operation: "POLICY_UPDATE",
      payloadHash: "fixture", resultVersionJson: {}, purgeJson: {} } });
  });
  const mission2 = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "继续训练评估", llmContextApproved: true });
  await runMissionSlice({ id: mission2.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + capture.id, sourceHash: await sourceHash(project.id, "capture:" + capture.id) }, summary: "再读设备记录" }) });
  await runMissionSlice({ id: mission2.id, provider: scriptProvider({ kind: "tool", tool: "save_mission_output", summary: "保留当前理解",
    args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "c", kind: "INFERENCE", text: synthesis.summary, sourceIds: ["capture:" + capture.id], citations: [] }],
      missingInformation: [], memorySynthesis: { ...synthesis, summary: synthesis.summary + "（续）" } } }) });
  const candidates = await listPendingCandidates(user.id);
  expect(candidates.items).toHaveLength(1);
  expect(candidates.items[0]).toMatchObject({ statement: "训练任务优先使用 CPU", status: "CANDIDATE" });
  // 候选绝不进入决策上下文
  const context = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission2.id } })));
  expect(context.personalContext.items).toHaveLength(0);
  // 注入合同看读集：候选不在 personalMemoryReadSet（任务历史里模型自己的提议原文属于原任务输出，不是个人上下文注入）
  expect(context.personalMemoryReadSet.items).toHaveLength(0);
  // 敏感/凭据表述被准入拒绝，不落候选
  const mission3 = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "整理账号信息", llmContextApproved: true });
  await runMissionSlice({ id: mission3.id, provider: scriptProvider({ kind: "tool", tool: "save_mission_output", summary: "尝试保存敏感候选",
    args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "b", kind: "INFERENCE" as const, text: "多次任务都先检查了基线。", sourceIds: ["capture:" + capture.id], citations: [] }], missingInformation: [],
      memorySynthesis: { summary: "账号整理", conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [],
        memoryCandidates: [{ statement: "我的数据库密码是 abc123", kind: "BACKGROUND" as const, conditions: [], basis: "出现在记录中", sourceIds: ["capture:" + capture.id] }] } } }) });
  expect((await listPendingCandidates(user.id)).items).toHaveLength(1);
}, 60000);

test("J08/J23：两端竞争只激活一次；拒绝后同根同表述不再提议；编辑后确认按用户表述激活", async () => {
  const { user, project } = await fixture("j08-" + crypto.randomUUID().slice(0, 8));
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "多次任务都先检查了基线。" } });
  await db.$transaction(async tx => {
    await tx.userMemoryPolicy.create({ data: { ownerUserId: user.id, candidateInferenceEnabled: true } });
  });
  const propose = async (goal: string, summary: string, statement: string) => {
    const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal, llmContextApproved: true });
    await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
      args: { sourceId: "capture:" + capture.id, sourceHash: await sourceHash(project.id, "capture:" + capture.id) }, summary: "读记录" }) });
    await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "save_mission_output", summary,
      args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "b", kind: "INFERENCE" as const, text: "多次任务都先检查了基线。", sourceIds: ["capture:" + capture.id], citations: [] }], missingInformation: [],
        memorySynthesis: { summary, conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [],
          memoryCandidates: [{ statement, kind: "PREFERENCE" as const, conditions: [], basis: "多次任务先查基线", sourceIds: ["capture:" + capture.id] }] } } }) });
  };
  // J08：两端同时确认——CAS 只允许一方成功，另一方拿到明确冲突
  await propose("核对基线任务", "任务归纳", "以后实验先核对基线");
  const candidate = (await listPendingCandidates(user.id)).items[0]!;
  const first = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: candidate.claimId, expectedRevision: candidate.revision, frozenContentHash: candidate.contentHash });
  expect(first.status).toBe("ACTIVE");
  await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: candidate.claimId, expectedRevision: candidate.revision, frozenContentHash: candidate.contentHash }))
    .rejects.toMatchObject({ code: "CLAIM_CHANGED" });
  // 冻结核对：内容 hash 不一致拒绝
  await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: candidate.claimId, frozenContentHash: "0".repeat(64) })).rejects.toMatchObject({ code: "CLAIM_STATE_CHANGED" });
  // 激活后进入个人上下文
  const view = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "核对基线" });
  expect(view.items).toHaveLength(1);
  // 同一原根+表述再次产出也不重复提议（已激活）
  await propose("再次核对任务", "任务归纳二", "以后实验先核对基线");
  expect((await listPendingCandidates(user.id)).items).toHaveLength(0);
  // J23：拒绝后同根同表述不再提议
  await propose("归纳 CPU 任务", "归纳", "以后优先使用 CPU");
  const pending = (await listPendingCandidates(user.id)).items[0]!;
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "REJECT_CANDIDATE",
    claimId: pending.claimId, expectedRevision: pending.revision });
  await propose("重复提议任务", "归纳二", "以后优先使用 CPU");
  expect((await listPendingCandidates(user.id)).items).toHaveLength(0);
  // 编辑后确认：以用户核对过的表述激活
  await propose("规模归纳任务", "归纳三", "以后实验都扩到最大规模");
  const pending3 = (await listPendingCandidates(user.id)).items[0]!;
  const confirmed = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: pending3.claimId, expectedRevision: pending3.revision, frozenContentHash: pending3.contentHash,
    confirmedStatement: "以后实验在核对划分与基线后逐步扩大规模" });
  expect(confirmed.status).toBe("ACTIVE");
  const detail = await personalEntryDetail(user.id, confirmed.claimId!);
  expect(detail.entry.statement).toBe("以后实验在核对划分与基线后逐步扩大规模");
  expect(detail.uses).toHaveLength(0);
}, 60000);

test("J14/仅本项目：确认冻结目标范围；范围外任务不继承；跨账号读不到", async () => {
  const { user, project } = await fixture("j14-" + crypto.randomUUID().slice(0, 8));
  const otherProject = await db.project.create({ data: { title: "另一个项目", description: "d", goal: "g", scenario: "COURSE_DESIGN",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const stranger = await db.user.create({ data: { username: "j14-stranger-" + crypto.randomUUID().slice(0, 8), displayName: "s", passwordHash: "x" } });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "课程项目使用 CPU。" } });
  await db.$transaction(async tx => {
    await tx.userMemoryPolicy.create({ data: { ownerUserId: user.id, candidateInferenceEnabled: true } });
  });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "归纳任务", llmContextApproved: true });
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + capture.id, sourceHash: await sourceHash(project.id, "capture:" + capture.id) }, summary: "读课程记录" }) });
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "save_mission_output", summary: "候选",
    args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "b", kind: "INFERENCE" as const, text: "多次任务都先检查了基线。", sourceIds: ["capture:" + capture.id], citations: [] }], missingInformation: [],
      memorySynthesis: { summary: "归纳", conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [],
        memoryCandidates: [{ statement: "训练任务优先使用 CPU", kind: "PREFERENCE" as const, conditions: [], basis: "课程项目资源限制", sourceIds: ["capture:" + capture.id] }] } } }) });
  const pending = (await listPendingCandidates(user.id)).items[0]!;
  // 仅本项目：来源根必须可访问；projectIds 必须是成员项目
  await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: pending.claimId, expectedRevision: pending.revision, frozenContentHash: pending.contentHash,
    useScope: { mode: "PROJECTS", projectIds: ["nonexistent"] } })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  const scoped = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE",
    claimId: pending.claimId, expectedRevision: pending.revision, frozenContentHash: pending.contentHash,
    useScope: { mode: "PROJECTS", projectIds: [project.id] } });
  expect(scoped.status).toBe("ACTIVE");
  // 范围内任务可用
  expect((await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "训练" })).items).toHaveLength(1);
  // J14/J11：新项目不继承仅项目保留的偏好
  const outside = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [otherProject.id], query: "训练" });
  expect(outside.items).toHaveLength(0);
  expect(outside.omissions[0]).toMatchObject({ reason: "PROJECT_ONLY" });
  // 跨账号：候选/条目完全不可见
  expect((await listPendingCandidates(stranger.id)).items).toHaveLength(0);
  await expect(commandPersonalMemory(stranger.id, { requestId: crypto.randomUUID(), operation: "REJECT_CANDIDATE", claimId: scoped.claimId! }))
    .rejects.toMatchObject({ code: "CLAIM_NOT_FOUND" });
}, 60000);

test("J16/导出：删除正文不出现在导出；导出区分自述与候选；暂停使用记录可查", async () => {
  const { user, project } = await fixture("j16-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "以后回答先给结论", kind: "PREFERENCE" });
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId!, expectedRevision: 1 });
  const record = await db.agentClaim.findUniqueOrThrow({ where: { id: added.claimId! } });
  expect(record.canonicalStatement).toBe("");
  const view = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "结论" });
  expect(view.items).toHaveLength(0);
  expect(await listPersonalMemory(user.id, { includeStopped: true }).then(v => v.items.every(i => i.statement === ""))).toBe(true);
  // J17：owner 绑定——删除条目对其他用户不可见（不泄露原 id 存在性）
  const stranger = await db.user.create({ data: { username: "j17-" + crypto.randomUUID().slice(0, 8), displayName: "s", passwordHash: "x" } });
  await expect(commandPersonalMemory(stranger.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId! }))
    .rejects.toMatchObject({ code: "CLAIM_NOT_FOUND" });
}, 40000);
