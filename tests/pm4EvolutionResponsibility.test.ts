import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("pm4-evolution"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { buildContext } from "@/lib/mission/contextBuilder";
import { createMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import { readMissionResponsibility } from "@/lib/mission/responsibility";
import { commandPersonalMemory } from "@/lib/memory/personalMemoryService";
import { assertPersonalMemoryReadSet } from "@/lib/memory/userMemoryPolicy";
import type { Choice } from "@/lib/mission/contracts";
import { jsonHash } from "@/lib/mission/contracts";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const scriptProvider = (choice: Choice) => async () =>
  ({ choice, provider: "PM4_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });

async function fixture(name: string) {
  const user = await db.user.create({ data: { username: name, displayName: name, passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "演化项目 " + name, description: "d", goal: "持续核对实验条件",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "当前实验记录缺少数据划分说明。" } });
  return { user, project, capture };
}

/** 让一个委托真正消费个人上下文：跑一次读步骤，步骤 protocol 记录 readSet。 */
async function consumePersonal(user: string, projectId: string, captureId: string, goal: string) {
  const mission = await createMission(user, { requestId: crypto.randomUUID(), projectId, goal, llmContextApproved: true });
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: "capture:" + captureId, sourceHash: await sourceHash(projectId, "capture:" + captureId) }, summary: "读原记录" }) });
  return mission;
}

test("J27/分级扇出：新增表达默认不暂停在途委托；条目级变化只影响引用它的委托", async () => {
  const { user, project, capture } = await fixture("fanout-" + crypto.randomUUID().slice(0, 8));
  const first = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后实验方案先核对数据划分与基线", kind: "PREFERENCE" });
  const consuming = await consumePersonal(user.id, project.id, capture.id, "核对实验条件");
  const beforePolicy = await db.userMemoryPolicy.findUniqueOrThrow({ where: { ownerUserId: user.id } });
  const beforeMission = await db.agentMission.findUniqueOrThrow({ where: { id: consuming.id } });
  // 另一条从不使用个人上下文的委托（个人条目在该时刻不存在或未被引用）
  const plain = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id,
    goal: "仅整理项目材料", llmContextApproved: true });
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后回答保持简明", kind: "PREFERENCE" });
  // ADD 是"仅表达默认"：不推进 privacyRevision，不暂停任何在途委托
  const afterAddPolicy = await db.userMemoryPolicy.findUniqueOrThrow({ where: { ownerUserId: user.id } });
  expect(afterAddPolicy.privacyRevision).toBe(beforePolicy.privacyRevision);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: consuming.id } })).status).toBe(beforeMission.status);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: plain.id } })).status).not.toBe("PAUSED");
  // 条目级变化：只暂停引用了这条条目的委托
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: first.claimId! });
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: consuming.id } })).status).toBe("PAUSED");
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: plain.id } })).status).not.toBe("PAUSED");
  // 预算不清零、UNKNOWN 不回退
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: consuming.id } })).budgetUsedJson)
    .toEqual(beforeMission.budgetUsedJson);
}, 60000);

test("J15/边界守卫：无新事件跨过 validUntil，派发前读集守卫拒绝；责任视图暴露最早边界", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const { user, project, capture } = await fixture("boundary-" + crypto.randomUUID().slice(0, 8));
    const expiring = new Date(Date.now() + 3600_000).toISOString();
    const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: "本季度实验统一使用 CPU", kind: "BACKGROUND", expiresAt: expiring });
    const mission = await consumePersonal(user.id, project.id, capture.id, "准备下一轮实验");
    // 责任视图：依赖可见（仅元数据，不含原话），并给出最早边界
    const view = await readMissionResponsibility(user.id, mission.id);
    expect(view.personalMemory.dependencyCount).toBe(1);
    expect(view.personalMemory.items[0]).toMatchObject({ claimId: added.claimId, status: "ACTIVE", inUse: true });
    expect(view.personalMemory.nextBoundary).toBe(expiring);
    expect(view.effectiveNextCheckAt).toBe(expiring);
    expect(JSON.stringify(view)).not.toContain("本季度实验统一使用 CPU");
    // 拖过边界：没有新事件
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: mission.id, status: "SUCCEEDED" } });
    const readSet = (step.protocolJson as { personalMemoryReadSet: unknown }).personalMemoryReadSet;
    await assertPersonalMemoryReadSet(user.id, readSet);
    vi.setSystemTime(new Date(Date.now() + 2 * 3600_000));
    await expect(assertPersonalMemoryReadSet(user.id, readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
    // 过期条目不再进入新上下文（新解析即资格重算）
    const fresh = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "边界后新任务", llmContextApproved: true });
    const context = JSON.parse(await buildContext(fresh));
    expect(context.personalContext.items).toHaveLength(0);
    expect(context.personalCoverage.omissions.some((o: { reason: string }) => o.reason === "EXPIRED")).toBe(true);
  } finally { vi.useRealTimers(); }
}, 60000);

test("J07/在途：模型在途时暂停条目，旧读集不发布、原消耗保留；恢复后新读集可续", async () => {
  const { user, project, capture } = await fixture("inflight-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后讨论先核对数据划分", kind: "PREFERENCE" });
  const mission = await consumePersonal(user.id, project.id, capture.id, "在途核对任务");
  const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: mission.id, status: "SUCCEEDED" } });
  const readSet = (step.protocolJson as { personalMemoryReadSet: unknown }).personalMemoryReadSet;
  const usedBefore = (await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson;
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId! });
  // 旧读集在此被同步守卫拦下（不是靠 UI 禁用）
  await expect(assertPersonalMemoryReadSet(user.id, readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
  const paused = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  expect(paused.status).toBe("PAUSED");
  expect(paused.pauseReason).toBe("REVIEW_REQUIRED");
  expect(paused.budgetUsedJson).toEqual(usedBefore);
  // 恢复条目后重新解析产生新读集；旧快照仍不复活
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "RESUME", claimId: added.claimId!, expectedRevision: 2 });
  await expect(assertPersonalMemoryReadSet(user.id, readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
  const fresh = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));
  expect(fresh.personalContext.items).toHaveLength(1);
  await assertPersonalMemoryReadSet(user.id, fresh.personalMemoryReadSet);
}, 60000);

test("J12/外写边界：删除个人条目只停止使用，不声称撤销已派发外部效果", async () => {
  const { user, project, capture } = await fixture("external-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后提醒我改用飞书日历", kind: "PREFERENCE" });
  const mission = await consumePersonal(user.id, project.id, capture.id, "外部写入前置核对");
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId! });
  const view = await readMissionResponsibility(user.id, mission.id);
  // 删除后依赖仍在（历史事实），但条目已不再 inUse；对外部效果的表述必须保留 UNKNOWN 语义
  expect(view.personalMemory.items.every(item => item.claimId !== added.claimId || item.inUse === false)).toBe(true);
  expect(JSON.stringify(view)).not.toMatch(/"revoked":true|"externalRevoked":true|"compensated":true/);
  // 没有任何外部写回执被伪造
  expect(await db.agentMissionApproval.count({ where: { missionId: mission.id, status: "CONSUMED" } })).toBe(0);
}, 60000);

test("D1→D3 工程旅程：个人偏好→原批准→Action→resultCardId→Handoff；停用后新任务不再消费", async () => {
  const { user, project, capture } = await fixture("journey-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后实验方案先核对数据划分与基线，再比较指标", kind: "PREFERENCE" });
  const mission = await consumePersonal(user.id, project.id, capture.id, "评估新指标是否可比较");
  const seen: { context?: string } = {};
  const capturing = async (context: string) => {
    seen.context = context;
    return scriptProvider({ kind: "tool", tool: "propose_action",
      args: { title: "先核对数据划分", description: "按你的协作偏好，先补齐划分与基线记录" }, summary: "按个人偏好提出核对行动" })( );
  };
  await runMissionSlice({ id: mission.id, provider: capturing });
  expect(seen.context).toContain("先核对数据划分与基线");
  const detail = await (await import("@/lib/mission/missionService")).missionDetail(user.id, mission.id);
  const approval = detail.approvals[0]!;
  expect(approval).toBeTruthy();
  expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  const { commandMission } = await import("@/lib/mission/missionService");
  await commandMission(user.id, mission.id, "approval", { requestId: crypto.randomUUID(), expectedVersion: detail.version,
    decision: "APPROVED", proposalHash: approval.proposalHash }, approval.id);
  await runMissionSlice({ id: mission.id });
  const action = await db.actionItem.findFirstOrThrow({ where: { projectId: project.id, isSimulated: false } });
  const { completeProjectAction } = await import("@/lib/services/actionService");
  const completed = await completeProjectAction(project.id, action.id, "已补齐划分说明并记录基线。");
  expect(completed.resultCardId).toBeTruthy();
  // 原责任视图/HANDOFF 读回原结果指针，而不是副本
  const responsibility = await readMissionResponsibility(user.id, mission.id);
  expect(JSON.stringify(responsibility.workState)).toBeDefined();
  const completionSource = await db.knowledgeCard.findFirst({ where: { projectId: project.id, id: completed.resultCardId! } });
  expect(completionSource).not.toBeNull();
  // 停用个人条目：新任务上下文不再包含；原 Action/结果卡保持有效
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId!, expectedRevision: 1 });
  const next = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "后续比较指标", llmContextApproved: true });
  const context = JSON.parse(await buildContext(next));
  expect(context.personalContext.items).toHaveLength(0);
  expect((await db.actionItem.findUniqueOrThrow({ where: { id: action.id } })).resultCardId).toBeTruthy();
  expect(jsonHash({ stale: true })).toBeDefined();
}, 90000);
