import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("pm1-consume"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { buildContext } from "@/lib/mission/contextBuilder";
import { createMission, commandMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { completeProjectAction } from "@/lib/services/actionService";
import { assertPersonalMemoryReadSet } from "@/lib/memory/userMemoryPolicy";
import { commandPersonalMemory } from "@/lib/memory/personalMemoryService";
import { resolvePersonalContext } from "@/lib/memory/personalContext";
import type { Choice } from "@/lib/mission/contracts";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const scriptProvider = (choice: Choice, seen: { context?: string } = {}) => async (context: string) => {
  seen.context = context;
  return { choice, provider: "PM1_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } };
};

async function fixture(name: string) {
  const user = await db.user.create({ data: { username: name, displayName: name, passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "个人上下文项目 " + name, description: "d", goal: "核对数据划分与基线",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, project };
}

test("Mission 上下文注入符合条件的个人条目；PROJECT_ONLY 与账户关闭都排除；readSet 绑定策略与条目版本", async () => {
  const { user, project } = await fixture("consume-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后实验方案先核对数据划分与基线，再比较指标", kind: "PREFERENCE" });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "评估增强策略", llmContextApproved: true });
  const withPersonal = JSON.parse(await buildContext(mission));
  expect(withPersonal.personalContext.items).toHaveLength(1);
  expect(withPersonal.personalContext.items[0]).toMatchObject({ claimId: added.claimId, authority: "USER_STATED_PREFERENCE" });
  expect(withPersonal.personalContext.processingAllowed).toBe(true);
  expect(withPersonal.personalMemoryReadSet.items[0]).toMatchObject({ claimId: added.claimId, revision: 1 });
  await assertPersonalMemoryReadSet(user.id, withPersonal.personalMemoryReadSet);
  // J29：远端处理 + 账户未允许云处理个人正文 → 上下文排除，遗漏原因明确
  const remote = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "评估增强策略", remoteProcessing: true });
  expect(remote.items).toHaveLength(0);
  expect(remote.omissions[0]).toMatchObject({ reason: "PROCESSING_PERMISSION" });
  expect(remote.readSet?.items).toHaveLength(1);
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId! });
  const paused = JSON.parse(await buildContext(mission));
  expect(paused.personalContext.items).toHaveLength(0);
  // 账户关闭使用：全局关闭优先于项目 ALLOW（J18）
  const membership = await db.projectMembership.findUniqueOrThrow({ where: { userId_projectId: { userId: user.id, projectId: project.id } } });
  await db.projectMembership.update({ where: { id: membership.id }, data: { personalMemoryMode: "ALLOW" } });
  await db.$transaction(async tx => {
    await tx.userMemoryPolicy.update({ where: { ownerUserId: user.id }, data: { useInContextEnabled: false, settingsVersion: { increment: 1 }, privacyRevision: { increment: 1 } } });
    await tx.userMemoryControlReceipt.create({ data: { ownerUserId: user.id, requestId: "policy-off-" + crypto.randomUUID(), operation: "POLICY_UPDATE",
      payloadHash: "fixture", resultVersionJson: {}, purgeJson: {} } });
  });
  const policyOff = JSON.parse(await buildContext(mission));
  expect(policyOff.personalContext.items).toHaveLength(0);
  expect((await db.projectMembership.findUniqueOrThrow({ where: { id: membership.id } })).personalMemoryMode).toBe("ALLOW");
}, 40000);

test("个人记忆变更不重置原任务预算；RUNNING 委托进入原暂停语义；条目版本推进使旧读集失效", async () => {
  const { user, project } = await fixture("invalidate-" + crypto.randomUUID().slice(0, 8));
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "当前实验只有整体准确率，未记录数据划分。" } });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "核对实验方法", llmContextApproved: true });
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后实验方案先核对数据划分与基线，再比较指标", kind: "PREFERENCE" });
  const context = JSON.parse(await buildContext(mission));
  expect(context.personalContext.items).toHaveLength(1);
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + capture.id, sourceHash: "stale-probe" }, summary: "读原记录" }) });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const budgetBefore = before.budgetUsedJson;
  // 在途修改：暂停个人条目 → 原任务暂停待复核，预算不清零（J07）
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: context.personalContext.items[0]!.claimId });
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  expect(after.status).toBe("PAUSED");
  expect(after.pauseReason).toBe("REVIEW_REQUIRED");
  expect(after.version).toBeGreaterThan(before.version);
  expect(after.budgetUsedJson).toEqual(budgetBefore);
  // 旧读集失配：同步守卫要求重协调，旧上下文不能继续派发或发布
  await expect(assertPersonalMemoryReadSet(user.id, context.personalMemoryReadSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
}, 40000);

test("会话在途轮次：条目删除把活跃 Turn 标记 INVALIDATED；assertTurnCurrent 拒绝旧 generation 派发；未携带读集的旧轮次不追溯", async () => {
  const { user, project } = await fixture("turn-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后回答先给结论", kind: "PREFERENCE" });
  const context = await resolvePersonalContext(user.id, { purpose: "CONVERSATION", projectIds: [project.id], query: "先给结论" });
  expect(context.items).toHaveLength(1);
  const conversation = await db.conversation.create({ data: { ownerUserId: user.id, createRequestId: crypto.randomUUID(),
    createInputHash: "fixture", scope: "WORKSPACE" } });
  const carrying = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: crypto.randomUUID(),
    inputHash: "fixture", inputJson: {}, baseVersion: 1, status: "OBSERVING",
    readManifestJson: { coordination: { generation: 3, state: "ACTIVE", scopes: [{ projectId: project.id }], bindings: [] },
      personalMemoryReadSet: context.readSet } } });
  const legacy = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: crypto.randomUUID(),
    inputHash: "fixture", inputJson: {}, baseVersion: 1, status: "OBSERVING",
    readManifestJson: { coordination: { generation: 1, state: "ACTIVE", scopes: [{ projectId: project.id }], bindings: [] } } } });
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId! });
  const invalidated = await db.conversationTurn.findUniqueOrThrow({ where: { id: carrying.id } });
  const coord = (invalidated.readManifestJson as { coordination?: { state?: string; pendingEvents?: string[] } }).coordination;
  expect(coord?.state).toBe("INVALIDATED");
  expect((coord?.pendingEvents ?? []).length).toBeGreaterThan(0);
  expect(await db.conversationTurn.findUniqueOrThrow({ where: { id: legacy.id } }).then(t => (t.readManifestJson as { coordination?: { state?: string } }).coordination?.state)).toBe("ACTIVE");
  // 同步守卫：依赖旧读集的派发/发布在此被阻断（J09）
  const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: carrying.id } });
  const { assertTurnCurrent } = await import("@/lib/continuity/turnCoordination");
  await expect(assertTurnCurrent(turn, user.id, 3)).rejects.toMatchObject({ code: "TURN_RECOORDINATE" });
}, 40000);

test("完整旅程：个人偏好进入原 Mission 上下文 → 原批准创建 Action → 原完成服务留下 resultCardId（脚本模型，明确标注）", async () => {
  const { user, project } = await fixture("journey-" + crypto.randomUUID().slice(0, 8));
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "实验记录缺少数据划分说明。" } });
  const entry = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后实验方案先核对数据划分与基线，再比较指标", kind: "PREFERENCE" });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "评估增强策略", llmContextApproved: true });
  const seen: { context?: string } = {};
  // UX2/PM1 脚本模型：这里的"先核对划分"由脚本按注入上下文返回，验证上下文传播与执行链，不是真实模型收益。
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + capture.id, sourceHash: "journey-probe" }, summary: "读原实验记录" }, seen) });
  expect(seen.context).toContain("以后实验方案先核对数据划分与基线");
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "propose_action",
    args: { title: "先核对数据划分与基线", description: "按你的协作偏好，在比较指标前补齐数据划分说明与基线记录" }, summary: "按个人偏好提出核对行动" }, seen) });
  const detail = await missionDetail(user.id, mission.id);
  const approval = detail.approvals[0];
  expect(approval).toBeTruthy();
  expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  await commandMission(user.id, mission.id, "approval", { requestId: crypto.randomUUID(), expectedVersion: detail.version,
    decision: "APPROVED", proposalHash: approval.proposalHash }, approval.id);
  await runMissionSlice({ id: mission.id });
  const action = await db.actionItem.findFirstOrThrow({ where: { projectId: project.id, isSimulated: false } });
  const completed = await completeProjectAction(project.id, action.id, "已补齐数据划分说明并记录基线，指标比较推迟到划分核对后。");
  expect(completed.resultCardId).toBeTruthy();
  // 删除个人条目后，原 Action 与结果卡不受影响；新上下文不再包含该偏好
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: entry.claimId!, expectedRevision: 1 });
  const mission2 = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "继续后续实验", llmContextApproved: true });
  const contextAfter = JSON.parse(await buildContext(mission2));
  expect(contextAfter.personalContext.items).toHaveLength(0);
  expect(await db.actionItem.findUniqueOrThrow({ where: { id: action.id } }).then(a => a.resultCardId)).toBeTruthy();
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson).toMatchObject({ models: 2 });
}, 60000);
