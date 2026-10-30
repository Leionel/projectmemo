import { afterAll, beforeEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-revision"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { readMissionResponsibility, reviseMissionResponsibility } from "@/lib/mission/responsibility";
import { clearWorkerPresenceForTest, recordWorkerPresence } from "@/lib/mission/workerPresence";
import { acknowledgeMissionAttention } from "@/lib/mission/attentionReceipt";
import { decidePrivateMissionAttention, interventionPolicyScopeForUser } from "@/lib/services/interventionPolicyService";
import { runMissionSlice } from "@/lib/mission/runner";
import { processInvestigationDelegations, validateDelegationConnections, initializeDelegation } from "@/lib/mission/investigationDelegation";
import { runDelegationObservation } from "@/lib/mission/delegationObservation";
import { jsonHash } from "@/lib/mission/contracts";

afterAll(async () => {
  vi.useRealTimers();
  clearWorkerPresenceForTest();
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorkerPresenceForTest();
});

test("UX-3A: 来源授权版本绑定进 controlVersion，撤权或来源变更拒绝旧版本修订", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "责任修订测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "持续委托项目", goal: "双端可靠接续", description: "隔离数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id, ownerUserId: u.id,
      repo: "hongmen/demo", ref: "main", signalKind: "COMMITS_AND_CI",
      status: "ACTIVE", revision: 1,
    },
  });

  const now = Date.now(), deadline = new Date(now + 100000).toISOString(), expiresAt = new Date(now + 200000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-rev-1",
    goal: "核对 CI 状态",
    missionConstraints: { deadline },
    llmContextApproved: true,
  });

  // 更新为 BOUNDED_INVESTIGATION
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      continuationPolicyJson: {
        mode: "BOUNDED_INVESTIGATION",
        schemaVersion: 1,
        expiresAt,
        checkEveryMinutes: 15,
        maxModels: 40,
        maxTools: 80,
        maxMetadataRequests: 100,
        allowedTools: ["inspect_project", "read_repository_ci"],
        connectionIds: [conn.id],
        timezone: "Asia/Shanghai",
        quietStart: 22,
        quietEnd: 8,
        attention: "IMPORTANT_ONLY",
      },
      budgetUsedJson: { models: 2, unknownCalls: 1, metadataRequests: 5 },
    },
  });

  const snapshot1 = await readMissionResponsibility(u.id, m.id);
  expect(snapshot1.controlVersion).toBeTruthy();
  expect(snapshot1.workerPresence).toBe("UNOBSERVED");

  // 1. 普通刷新（revision 递增）是合法观察，不改变责任合同与 controlVersion
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { revision: 2 },
  });

  const snapshotAfterRefresh = await readMissionResponsibility(u.id, m.id);
  expect(snapshotAfterRefresh.controlVersion).toBe(snapshot1.controlVersion);

  // 2. 真正撤权（status: REVOKED, revokedAt）改变 controlVersion
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  const snapshotAfterRevoke = await readMissionResponsibility(u.id, m.id);
  expect(snapshotAfterRevoke.controlVersion).not.toBe(snapshot1.controlVersion);

  // 用旧 controlVersion 尝试扩大授权或修订，必须报 MISSION_CHANGED
  await expect(reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-stale",
    expectedControlVersion: snapshot1.controlVersion,
    goal: "尝试用过期来源版本扩大授权",
  })).rejects.toMatchObject({ code: "MISSION_CHANGED" });

  // 恢复连接为 ACTIVE 以便测试成功修订
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { status: "ACTIVE", revokedAt: null },
  });
  const snapshotActive = await readMissionResponsibility(u.id, m.id);

  // 3. 用最新 controlVersion 修订成功（遵循 successCriterionSchema 严格校验）
  const revised = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-ok-1",
    expectedControlVersion: snapshotActive.controlVersion,
    goal: "更新后的责任目标",
    successCriteria: ["ACTION_CREATED"],
  });
  expect(revised.goal).toBe("更新后的责任目标");
  expect(revised.successCriteria).toEqual(["ACTION_CREATED"]);
  expect(revised.budget.cumulativeUsed.unknownCalls).toBe(1);

  // 4. 幂等性：同 requestId + 同 payload 返回相同快照
  const replayed = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-ok-1",
    expectedControlVersion: snapshotActive.controlVersion,
    goal: "更新后的责任目标",
    successCriteria: ["ACTION_CREATED"],
  });
  expect(replayed.goal).toBe("更新后的责任目标");

  // P1-2 校验：拒绝空数组或任意非规范字符串
  await expect(reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-empty-criteria",
    expectedControlVersion: revised.controlVersion,
    successCriteria: [],
  })).rejects.toThrow();

  await expect(reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-invalid-criteria",
    expectedControlVersion: revised.controlVersion,
    successCriteria: ["必须全部 CI 绿灯" as unknown as "ACTION_CREATED"],
  })).rejects.toThrow();

  // 4. 异载荷使用相同 requestId 必须被拒绝 409 REQUEST_ID_REUSED
  await expect(reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-ok-1",
    expectedControlVersion: revised.controlVersion,
    goal: "篡改载荷",
  })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
});

test("UX-3A: 原子修订失效待批方案与运行步骤，不留下半份授权；原累计已用与 UNKNOWN 不清零", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "方案失效测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "失效测试项目", goal: "双端接续", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const now = Date.now(), deadline = new Date(now + 50000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-fail-steps",
    goal: "长期委托目标",
    missionConstraints: { deadline },
    llmContextApproved: true,
  });

  // 创建一个 WAITING_APPROVAL 的 step 和一个 PENDING 的 approval
  const step = await db.agentMissionStep.create({
    data: {
      missionId: m.id, ordinal: 1, planRevision: 1, status: "WAITING_APPROVAL",
      toolName: "propose_action", toolVersion: "1", canonicalInputJson: {}, inputHash: "hash-step",
      readSetJson: [],
    },
  });
  const approval = await db.agentMissionApproval.create({
    data: {
      missionId: m.id, stepId: step.id, status: "PENDING", proposalHash: "prop-hash",
      proposalJson: { action: "publish" }, expiresAt: new Date(now + 60000), expectedPlanRevision: 1,
      readSetJson: [],
    },
  });

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_APPROVAL",
      budgetUsedJson: { models: 5, tools: 10, unknownCalls: 2, metadataRequests: 12 },
    },
  });

  const beforeRevise = await readMissionResponsibility(u.id, m.id);
  expect(beforeRevise.pendingOriginalRefs.approvalIds).toContain(approval.id);

  // 原子修订
  const revised = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-invalidating",
    expectedControlVersion: beforeRevise.controlVersion,
    goal: "原子修订后的新方向",
  });

  // 待批方案必须变为 EXPIRED，步骤变为 OBSOLETE
  const updatedApproval = await db.agentMissionApproval.findUnique({ where: { id: approval.id } });
  expect(updatedApproval?.status).toBe("EXPIRED");
  const updatedStep = await db.agentMissionStep.findUnique({ where: { id: step.id } });
  expect(updatedStep?.status).toBe("OBSOLETE");

  // 原累计消耗和 UNKNOWN 不清零
  expect(revised.budget.cumulativeUsed).toMatchObject({
    models: 5,
    tools: 10,
    unknownCalls: 2,
    metadataRequests: 12,
  });

  // 事件必须记录 RESPONSIBILITY_REVISED
  const revEvent = await db.agentMissionEvent.findFirst({
    where: { missionId: m.id, type: "RESPONSIBILITY_REVISED" },
    orderBy: { seq: "desc" },
  });
  expect(revEvent).not.toBeNull();
});

test("UX-3A: Worker Presence 记录与真实状态检测（UNOBSERVED -> RECENT -> STALE）", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "Presence测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "Presence项目", goal: "健康观测", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, { projectId: p.id, requestId: "presence-m", goal: "健康观测" });

  clearWorkerPresenceForTest();
  const init = await readMissionResponsibility(u.id, m.id);
  expect(init.workerPresence).toBe("UNOBSERVED");

  // Worker 发出心跳
  recordWorkerPresence({ workerId: "worker-1", scan: true, now: Date.now() });
  const recent = await readMissionResponsibility(u.id, m.id);
  expect(recent.workerPresence).toBe("RECENT");
  expect(recent.workerPresenceDetail?.workerId).toBe("worker-1");

  // 超过 60 秒变为 STALE
  // fake time past 65s
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 65000);
    const staleSnapshot = await readMissionResponsibility(u.id, m.id);
    expect(staleSnapshot.workerPresence).toBe("STALE");
  } finally {
    vi.useRealTimers();
  }
});

test("UX-3A (Issue 1): WAITING_INPUT（等待提问或巡检）修订截止时间保持 WAITING_INPUT，不错误恢复为 READY", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "等待输入测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "等待问题项目", goal: "测试保持等待", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, { projectId: p.id, requestId: "wait-m", goal: "调查实验结果", llmContextApproved: true });

  // 1. 设置为 WAITING_INPUT 且有未决问题
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      waitStateJson: {
        waitingFor: "USER",
        questionId: "q-unresolved-1",
        question: "请确认采样范围？",
        resolved: false,
      },
    },
  });

  const beforeRevise1 = await readMissionResponsibility(u.id, m.id);
  const newDeadline1 = new Date(Date.now() + 3600000).toISOString();

  // 仅修订截止时间
  await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-deadline-keep-wait",
    expectedControlVersion: beforeRevise1.controlVersion,
    constraints: {
      deadline: newDeadline1,
    },
  });

  // 状态必须依然是 WAITING_INPUT，未决提问也完整保留
  const updatedMission1 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(updatedMission1.status).toBe("WAITING_INPUT");
  expect((updatedMission1.waitStateJson as { questionId?: string })?.questionId).toBe("q-unresolved-1");

  // 2. 属于有界调查、等待下次巡检（无未决提问），仅改截止时间同样保持 WAITING_INPUT
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: {
        mode: "BOUNDED_INVESTIGATION",
        schemaVersion: 1,
        expiresAt,
        checkEveryMinutes: 15,
        maxModels: 40,
        maxTools: 80,
        maxMetadataRequests: 100,
        allowedTools: ["inspect_project"],
        connectionIds: [],
        timezone: "Asia/Shanghai",
        quietStart: 22,
        quietEnd: 8,
        attention: "IMPORTANT_ONLY",
      },
      waitStateJson: { waitingFor: "OBSERVATION" },
    },
  });

  const beforeRevise2 = await readMissionResponsibility(u.id, m.id);
  await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-deadline-observation-wait",
    expectedControlVersion: beforeRevise2.controlVersion,
    constraints: {
      deadline: new Date(Date.now() + 7200000).toISOString(),
    },
  });

  const updatedMission2 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(updatedMission2.status).toBe("WAITING_INPUT");
});

test("UX-3A (Issue 2): 修订责任合同保留 delegation 执行水印 (remoteSnapshots, pendingWake, appliedWake, wakeSeq)", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "水印测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "水印保留项目", goal: "测试状态保持", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, { projectId: p.id, requestId: "watermark-m", llmContextApproved:true, goal: "持续调查任务" });

  // 模拟已经执行过一轮巡检的水印状态
  const existingDelegation = {
    schemaVersion: 1,
    delegatedAt: new Date().toISOString(),
    remoteSnapshots: { "conn-1": { headSha: "sha-abc", lastCheckedAt: new Date().toISOString() } },
    wakeSeq: 5,
    pendingWake: { wakeSeq: 5, reason: "NEW_COMMIT" },
    appliedWake: { wakeSeq: 4, at: new Date().toISOString() },
    inputHash: "hash-stable-input",
  };

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      continuationPolicyJson: {
        mode: "BOUNDED_INVESTIGATION",
        schemaVersion: 1,
        expiresAt: new Date(Date.now() + 100000).toISOString(),
        checkEveryMinutes: 15,
        maxModels: 40,
        maxTools: 80,
        maxMetadataRequests: 100,
        allowedTools: ["inspect_project"],
        connectionIds: [],
        timezone: "Asia/Shanghai",
        quietStart: 22,
        quietEnd: 8,
        attention: "IMPORTANT_ONLY",
      },
      planJson: { delegation: existingDelegation },
    },
  });

  const beforeRevise = await readMissionResponsibility(u.id, m.id);
  await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-keep-watermarks",
    expectedControlVersion: beforeRevise.controlVersion,
    goal: "微调目标文本",
  });

  const updatedMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const afterPlan = updatedMission.planJson as { delegation?: { remoteSnapshots?: unknown; wakeSeq?: number; pendingWake?: unknown; appliedWake?: unknown; inputHash?: string } };
  const afterDelegation = afterPlan.delegation;

  // 验证水印完整保留，没有被全量重置
  expect(afterDelegation).toBeDefined();
  expect(afterDelegation!.remoteSnapshots).toEqual(existingDelegation.remoteSnapshots);
  expect(afterDelegation!.wakeSeq).toBe(5);
  expect(afterDelegation!.pendingWake).toEqual(existingDelegation.pendingWake);
  expect(afterDelegation!.appliedWake).toEqual(existingDelegation.appliedWake);
  expect(afterDelegation!.inputHash).toBe("hash-stable-input");
});

test("UX-3A ([P2-7]): 修订当前重点 workingObjective 发布 WORKING_OBJECTIVE 指令事件并推进连续性", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "重点指令测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "重点指令项目", goal: "双端协作", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, { projectId: p.id, requestId: "wo-m", goal: "推进研究" });

  const beforeRevise = await readMissionResponsibility(u.id, m.id);
  const revised = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-wo-event",
    expectedControlVersion: beforeRevise.controlVersion,
    workingObjective: "新重点：核对实验组数据对比",
  });

  expect(revised.workingObjective).toBe("新重点：核对实验组数据对比");

  // 检查是否在连续性中发布了 WORKING_OBJECTIVE 指令事件
  const directive = await db.agentDirectiveEvent.findFirst({
    where: { missionId: m.id, kind: "WORKING_OBJECTIVE" },
    orderBy: { seq: "desc" },
  });
  expect(directive).not.toBeNull();
  expect(directive?.quote).toBe("新重点：核对实验组数据对比");

  // 检查是否在任务审计事件中记录了责任修订差异
  const revEvent = await db.agentMissionEvent.findFirst({
    where: { missionId: m.id, type: "RESPONSIBILITY_REVISED" },
    orderBy: { seq: "desc" },
  });
  const revDiff = (revEvent?.payloadJson as { diff?: { workingObjective?: string } } | null)?.diff;
  expect(revDiff?.workingObjective).toBe("新重点：核对实验组数据对比");
});

test("UX-3A ([P2-9]): 关注度回执单调递增（AVAILABLE -> PLATFORM_ACCEPTED -> SEEN），拒绝逆向倒退", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "回执单调测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "回执单调项目", goal: "消息回执", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, { projectId: p.id, requestId: "att-mono-m", goal: "核对提醒流转" });

  // 初始化带有 decisionId 的 delivery
  const decisionId = "dec-test-123";
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      planJson: {
        delegation: {
          attention: {
            decisionId,
            level: "URGENT",
            delivery: { channel: "PRIVATE_MISSION_INBOX", status: "AVAILABLE" },
          },
        },
      },
    },
  });

  let currentMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });

  // 1. AVAILABLE -> PLATFORM_ACCEPTED
  await expect(acknowledgeMissionAttention(u.id, m.id, {
    requestId: "ack-step-1",
    expectedVersion: currentMission.version,
    decisionId,
    status: "PLATFORM_ACCEPTED",
  })).rejects.toMatchObject({code:"PLATFORM_RECEIPT_REQUIRED"});

  currentMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });

  // 2. PLATFORM_ACCEPTED -> SEEN
  const r2 = await acknowledgeMissionAttention(u.id, m.id, {
    requestId: "ack-step-2",
    expectedVersion: currentMission.version,
    decisionId,
    status: "SEEN",
  });
  expect(r2.status).toBe("SEEN");

  currentMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });

  // 3. 乱序重试：SEEN 之后收到 PLATFORM_ACCEPTED，状态不倒退，保持 SEEN
  await expect(acknowledgeMissionAttention(u.id, m.id, {
    requestId: "ack-step-3-out-of-order",
    expectedVersion: currentMission.version,
    decisionId,
    status: "PLATFORM_ACCEPTED",
  })).rejects.toMatchObject({code:"PLATFORM_RECEIPT_REQUIRED"});

  const finalMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const finalPlan = finalMission.planJson as { delegation?: { attention?: { delivery?: { status?: string; seenAt?: string; platformAcceptedAt?: string } } } };
  const finalDelivery = finalPlan?.delegation?.attention?.delivery;
  expect(finalDelivery?.status).toBe("SEEN");
  expect(finalDelivery?.seenAt).toBeTruthy();
  expect(finalDelivery?.platformAcceptedAt).toBeFalsy();
});

test("UX-3A ([P1-5]): 用户禁用注意力策略时，即使是紧急事项也返回 POLICY_DISABLED", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "策略禁用测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "策略禁用项目", goal: "降噪", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  // 用户设置 interventionPolicy 为 isActive: false
  const scope = interventionPolicyScopeForUser(u.id);
  await db.interventionPolicy.upsert({
    where: { scope },
    create: { scope, isActive: false },
    update: { isActive: false },
  });

  const now = new Date("2026-10-30T14:00:00+08:00");

  const result = await db.$transaction(async tx => {
    return decidePrivateMissionAttention(tx, {
      userId: u.id,
      projectId: p.id,
      candidateKey: "candidate-urgent-disabled",
      urgent: true, // 紧急事项
      level: "URGENT",
      reason: "WAITING_INPUT",
      now,
    });
  });

  // 即使 urgent 为 true，在策略禁用下也必须是 POLICY_DISABLED 与 SUPPRESS
  expect(result.reasonCode).toBe("POLICY_DISABLED");
  expect(result.level).toBe("SUPPRESS");
});

test("UX-3A (Issue 3 / 验收第3项): 模型在途修订协调（在途修改责任合同→旧判断被拒绝→新合同接续，费用保留不丢，状态不报假错）", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "在途协调测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "在途协调项目", goal: "模型执行期间修订", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "in-flight-m",
    goal: "在途修订目标",
    llmContextApproved: true,
  });

  const snapshotBefore = await readMissionResponsibility(u.id, m.id);

  // 模拟 Worker 执行 runMissionSlice：在 provider 返回前，外部用户调用 reviseMissionResponsibility
  let revisedDuringModelCall = false;
  const inFlightProvider = async () => {
    // 模拟此时用户在 Web/手机端完成了一次责任修订
    await reviseMissionResponsibility(u.id, m.id, {
      requestId: "revise-while-model-calling",
      expectedControlVersion: snapshotBefore.controlVersion,
      goal: "用户在途修订后的新目标",
      workingObjective: "在途新重点",
    });
    revisedDuringModelCall = true;

    // 模型返回试图创建行动或步骤
    return {
      choice: {
        kind: "tool" as const,
        tool: "save_mission_output",
        args: {
          schemaVersion: 1,
          kind: "NOTE",
          blocks: [{ blockId: "b1", text: "旧思考结果", kind: "INFERENCE", sourceIds: [] }],
        },
        summary: "旧执行计划",
      },
      provider: "SCRIPTED_LOCAL",
      model: "fixture-model",
      protocol: "JSON_CHOICE",
      usage: { inputTokens: 150, outputTokens: 80 },
    };
  };

  const sliceResult = await runMissionSlice({
    id: m.id,
    provider: inFlightProvider,
  });

  expect(revisedDuringModelCall).toBe(true);
  expect(sliceResult).toBe(true);

  // 验证任务状态：
  const missionAfter = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  // 1. 旧判断没有发布到数据库步骤中（save_mission_output 步骤未持久化成功）
  const steps = await db.agentMissionStep.findMany({ where: { missionId: m.id } });
  expect(steps.filter(s => s.status === "SUCCEEDED").length).toBe(0);

  // 2. 费用没有丢（inputTokens 与 outputTokens 正确计入累积消耗）
  const used = missionAfter.budgetUsedJson as { inputTokens: number; outputTokens: number; models: number };
  expect(used.inputTokens).toBe(150);
  expect(used.outputTokens).toBe(80);
  expect(used.models).toBe(1);

  // 3. 产生 CONTEXT_RECOORDINATED 事件，未报假死崩溃 EXECUTION_STOPPED
  const events = await db.agentMissionEvent.findMany({ where: { missionId: m.id } });
  const recoordEvent = events.find(e => e.type === "CONTEXT_RECOORDINATED");
  expect(recoordEvent).toBeDefined();
  const stopEvent = events.find(e => e.type === "EXECUTION_STOPPED");
  expect(stopEvent).toBeUndefined();

  // 4. 状态保持 READY，pauseReason 为 null，新合同接续执行
  expect(missionAfter.status).toBe("READY");
  expect(missionAfter.pauseReason).toBeNull();
  expect(missionAfter.lastErrorJson).toBeNull();
  expect(missionAfter.goal).toBe("用户在途修订后的新目标");
});

test("UX-3A (Issue 4 / 验收第7项): 等待提问期间到期（基础资格先校验，检查等待与观察来源分开记录，到期不假装完成观察，不热循环，原问题不解决）", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "提问到期测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "提问到期项目", goal: "测试到期边界", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const now = Date.now();
  // 持续调查有效至 2 秒后
  const expiresAt = new Date(now + 2000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "wait-expire-m",
    goal: "提问到期调查",
    llmContextApproved: true,
  });

  const policy = {
    mode: "BOUNDED_INVESTIGATION" as const,
    schemaVersion: 1 as const,
    expiresAt,
    checkEveryMinutes: 15,
    maxModels: 10,
    maxTools: 20,
    maxMetadataRequests: 50,
    allowedTools: ["inspect_project"],
    connectionIds: [],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY" as const,
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  // 设置未解决提问
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      waitStateJson: {
        waitingFor: "USER",
        questionId: "q-unanswered-abc",
        question: "请选择实验数据集？",
        resolved: false,
      },
      planJson: {
        delegation: {
          ...initialDelegation,
          lastObservedAt: null,
          lastCheckedAt: null,
        },
      },
    },
  });

  // 1. 许可有效期内扫描：检查等待状态，不更新 lastObservedAt（不假装完成来源观察）
  await processInvestigationDelegations(8);
  const checkedMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const checkedDelegation = (checkedMission.planJson as { delegation?: { lastObservedAt?: string; lastCheckedAt?: string } })?.delegation;
  expect(checkedDelegation?.lastCheckedAt).toBeTruthy();
  expect(checkedDelegation?.lastObservedAt).toBeFalsy(); // 绝不假装观察了来源
  expect(checkedMission.status).toBe("WAITING_INPUT"); // 仍然等待用户
  expect((checkedMission.waitStateJson as { resolved?: boolean })?.resolved).toBe(false); // 原问题不被意外解决

  // 2. 模拟时间推进至许可到期后
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 5000);
    await processInvestigationDelegations(8);

    const expiredMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    // 到期必须被安全 PAUSED，且进入 REVIEW_REQUIRED，nextAttemptAt 为 null，避免热循环
    expect(expiredMission.status).toBe("PAUSED");
    expect(expiredMission.pauseReason).toBe("REVIEW_REQUIRED");
    expect(expiredMission.nextAttemptAt).toBeNull();

    // 原未解决问题依然保留，不伪造回答或假装解决
    const finalWait = expiredMission.waitStateJson as { questionId?: string; resolved?: boolean };
    expect(finalWait.questionId).toBe("q-unanswered-abc");
    expect(finalWait.resolved).toBe(false);

    // 产生 INVESTIGATION_HELD 事件，原因 DELEGATION_EXPIRED
    const heldEvent = await db.agentMissionEvent.findFirst({
      where: { missionId: m.id, type: "INVESTIGATION_HELD" },
      orderBy: { seq: "desc" },
    });
    expect((heldEvent?.payloadJson as { reason?: string })?.reason).toBe("DELEGATION_EXPIRED");
  } finally {
    vi.useRealTimers();
  }
});

test("UX-3A (Issue 5 / 验收第4项): 普通刷新与撤权（普通刷新继续合法观察，撤销连接停止新派发并暂停委托）", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "刷新撤权测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "刷新撤权项目", goal: "测试来源合法性", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id, ownerUserId: u.id,
      repo: "hongmen/refresh-test", ref: "main", signalKind: "COMMITS_AND_CI",
      status: "ACTIVE", revision: 1,
    },
  });

  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "conn-refresh-m",
    goal: "普通刷新观察测试",
    llmContextApproved: true,
  });

  const policy = {
    mode: "BOUNDED_INVESTIGATION" as const,
    schemaVersion: 1 as const,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 15,
    maxModels: 10,
    maxTools: 20,
    maxMetadataRequests: 50,
    allowedTools: ["inspect_project", "read_repository_ci"],
    connectionIds: [conn.id],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY" as const,
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      planJson: { delegation: initialDelegation },
    },
  });

  // 1. 普通仓库刷新（revision 递增，例如从 1 递增到 2，3）
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { revision: 2, lastFetchedAt: new Date() },
  });

  // 调用 validateDelegationConnections：必须完全合法通过，不抛出任何异常
  await expect(db.$transaction(async tx => {
    const cur = await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    return validateDelegationConnections(cur, tx);
  })).resolves.toBeUndefined();

  // 2. 真正撤销连接（例如 status 改为 REVOKED，或 revokedAt 填充）
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  // 再次调用 validateDelegationConnections：必须抛出 DELEGATION_CONNECTION_CHANGED
  await expect(db.$transaction(async tx => {
    const cur = await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    return validateDelegationConnections(cur, tx);
  })).rejects.toMatchObject({ code: "DELEGATION_CONNECTION_CHANGED" });

  // 3. 执行巡检调度器：撤权后任务被移至 PAUSED，停止新派发
  await processInvestigationDelegations(8);
  const heldMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(heldMission.status).toBe("PAUSED");
  expect(heldMission.pauseReason).toBe("REVIEW_REQUIRED");
});

test("UX-3A (Issue 6 / 验收第8项): 新 wake 与旧 poll 完成竞争（只消费本次处理的事件，后到事件保持 pending，wakeSeq 不倒退）", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "竞争探针测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "竞争探针项目", goal: "唤醒并发安全", description: "隔离", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id, ownerUserId: u.id,
      repo: "hongmen/wake-race", ref: "main", signalKind: "COMMITS_AND_CI",
      status: "ACTIVE", revision: 1,
    },
  });

  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "wake-race-m",
    goal: "唤醒竞争测试",
    llmContextApproved: true,
  });

  const cycle = "poll-cycle-race-1";
  const targetWakeSeq = 1;
  const targetWakeKey = "wake-key-1";

  // 模拟 poll 周期已经冻结为 targetWakeSeq = 1
      const testPolicy = {
        mode: "BOUNDED_INVESTIGATION" as const,
        schemaVersion: 1,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        checkEveryMinutes: 15,
        maxModels: 10,
        maxTools: 20,
        maxMetadataRequests: 50,
        allowedTools: ["inspect_project", "read_repository_ci"],
        connectionIds: [conn.id],
        trackBranchHead: false,
        timezone: "Asia/Shanghai",
        quietStart: 22,
        quietEnd: 8,
        attention: "IMPORTANT_ONLY",
      };
      const policyHash = jsonHash(testPolicy);
      await db.agentMission.update({
        where: { id: m.id },
        data: {
          status: "RUNNING",
          planRevision: 1,
          leaseOwner: "worker-race",
          leaseEpoch: 1,
          leaseUntil: new Date(Date.now() + 60000),
          continuationPolicyJson: testPolicy,
          planJson: {
            delegation: {
              policyHash,
              connectionVersions: { [conn.id]: conn.revision },
              wakeSeq: 1,
              pendingWake: { seq: 1, key: targetWakeKey, reason: "OBSERVATION_DUE" },
              appliedWake: null,
              poll: { cycle, targets: [{ connectionId: conn.id, sha: "sha-race-1", revision: 1 }], targetWakeSeq, targetWakeKey },
              remoteSnapshots: {},
            },
          },
        },
      });

      // 创建代表当前 poll 已完成的 step
      await db.agentMissionStep.create({
        data: {
          missionId: m.id,
          ordinal: 1,
          planRevision: 1,
          status: "SUCCEEDED",
          toolName: "read_repository_ci",
          toolVersion: "1",
          canonicalInputJson: { connectionId: conn.id, sha: "sha-race-1" },
          inputHash: "hash-step-race-1",
          readSetJson: [],
          protocolJson: { delegationCycle: cycle },
          resultJson: {
            data: {
              observation: {
                sha: "sha-race-1",
                connectionRevision: 1,
                checks: [],
                runs: [],
                coverage: "100%",
              },
            },
          },
        },
      });

      // 此时外部到达了一个更高 seq 的并发唤醒（例如新 commit 事件）
      const newerWakeKey = "wake-key-newer-2";
      await db.agentMission.update({
        where: { id: m.id },
        data: {
          planJson: {
            delegation: {
              policyHash,
              connectionVersions: { [conn.id]: conn.revision },
              wakeSeq: 2,
              pendingWake: { seq: 2, key: newerWakeKey, reason: "SOURCE_CHANGED" },
              appliedWake: null,
              poll: { cycle, targets: [{ connectionId: conn.id, sha: "sha-race-1", revision: 1 }], targetWakeSeq, targetWakeKey },
              remoteSnapshots: {},
            },
          },
        },
      });

  // 观察完成，执行提交
  const lease = { id: m.id, owner: "worker-race", epoch: 1, contextVersion: 1, planRevision: 1 };
  const mockTools = {
    inspect_project: {
      description: "mock",
      effects: { businessWrite: false, cacheWrite: false, externalDisclosure: false },
      schema: { safeParse: () => ({ success: true, data: {} }), parse: () => ({}) },
      version: "1",
      run: async () => ({ data: "ok", sources: [] }),
    },
  };

  const done = await runDelegationObservation(lease, mockTools as unknown as Parameters<typeof runDelegationObservation>[1], () => {});
  expect(done).toBe(true);

  // 验证结果：
  const resultMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const resultDelegation = (resultMission.planJson as {
    delegation?: {
      appliedWake?: { seq?: number; key?: string };
      pendingWake?: { seq?: number; key?: string };
      wakeSeq?: number;
    };
  })?.delegation;

  // 1. appliedWake 准确记录为本次 poll 消费的 targetWakeSeq: 1
  expect(resultDelegation?.appliedWake?.seq).toBe(1);
  expect(resultDelegation?.appliedWake?.key).toBe(targetWakeKey);

  // 2. pendingWake 依然保留并发到达的 seq: 2 事件，未被误冲刷！
  expect(resultDelegation?.pendingWake).not.toBeNull();
  expect(resultDelegation?.pendingWake?.seq).toBe(2);
  expect(resultDelegation?.pendingWake?.key).toBe(newerWakeKey);

  // 3. wakeSeq 依然是 2，未倒退
  expect(resultDelegation?.wakeSeq).toBe(2);
});
