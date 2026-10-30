import { afterAll, beforeEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-attention"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, commandMission } from "@/lib/mission/missionService";
import { initializeDelegation, scopedDelegationAttention } from "@/lib/mission/investigationDelegation";
import { acknowledgeMissionAttention } from "@/lib/mission/attentionReceipt";
import { clearWorkerPresenceForTest } from "@/lib/mission/workerPresence";

afterAll(async () => {
  vi.useRealTimers();
  clearWorkerPresenceForTest();
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorkerPresenceForTest();
});

test("A-J07: 安静时段保留有效问题可见，关键紧急问题升级可见，静默结束重新判断", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "静默测试用户", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "静默测试项目", goal: "降噪与漏报平衡", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-quiet-mission-1",
    goal: "核对静默规则",
    llmContextApproved: true,
  });

  const policy = {
    mode: "BOUNDED_INVESTIGATION",
    schemaVersion: 1,
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
    attention: "IMPORTANT_ONLY",
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  // 1. 在安静时段（夜间 23:00），普通问题入队 QUEUE，不系统推送
  const quietNight = new Date("2026-10-30T23:00:00+08:00");
  vi.setSystemTime(quietNight);

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      waitStateJson: { waitingFor: "USER", questionId: "q-quiet-1", question: "需要补充次要参数吗？", missing: "PRIVATE", resolved: false },
      planJson: { delegation: initialDelegation },
    },
  });

  const quietMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const quietAttention = await db.$transaction(tx => scopedDelegationAttention(tx, quietMission, "WAITING_INPUT", quietNight));

  expect(quietAttention).toBeTruthy();
  expect(quietAttention?.level).toBe("QUEUE");
  expect(quietAttention?.systemPush).toBe(false);
  expect(quietAttention?.delivery?.status).toBe("AVAILABLE");

  // 2. 紧急问题升级：当 missing 为 CRITICAL 且距离 deadline 不足 1 小时时升级
  const criticalDeadline = new Date(quietNight.getTime() + 30 * 60000).toISOString(); // 30 分钟后到期
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      constraintsJson: { deadline: criticalDeadline },
      waitStateJson: { waitingFor: "USER", questionId: "q-urgent-1", question: "关键验收条件缺失，无法继续", missing: "CRITICAL", resolved: false },
    },
  });

  const urgentMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const urgentAttention = await db.$transaction(tx => scopedDelegationAttention(tx, urgentMission, "WAITING_INPUT", quietNight));
  expect(urgentAttention).toBeTruthy();
  // 紧急关键问题在安静时段升级为 URGENT（打扰决策 FIRE）
  expect(urgentAttention?.level).toBe("URGENT");

  // 3. 静默时段结束后（上午 09:30），普通问题转为 DIGEST
  const morningTime = new Date("2026-10-31T09:30:00+08:00");
  vi.setSystemTime(morningTime);

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      constraintsJson: { deadline: null },
      waitStateJson: { waitingFor: "USER", questionId: "q-morning-1", question: "请核对新的参考资料", missing: "PRIVATE", resolved: false },
    },
  });
  const morningMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const morningAttention = await db.$transaction(tx => scopedDelegationAttention(tx, morningMission, "WAITING_INPUT", morningTime));
  expect(morningAttention).toBeTruthy();
  expect(morningAttention?.level).toBe("DIGEST");
});

test("A-J08: 同事项跨入口共用 candidateKey，用户打扰预算只扣一次", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "预算测试用户", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "预算测试项目", goal: "打扰预算去重", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-budget-mission-1",
    goal: "预算测试",
    llmContextApproved: true,
  });

  const policy = {
    mode: "BOUNDED_INVESTIGATION",
    schemaVersion: 1,
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
    attention: "IMPORTANT_ONLY",
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  const noon = new Date("2026-10-30T12:00:00+08:00");
  vi.setSystemTime(noon);

  const deadline = new Date(noon.getTime() + 40 * 60000).toISOString(); // 40 分钟后到期
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      constraintsJson: { deadline },
      waitStateJson: { waitingFor: "USER", questionId: "q-budget-1", question: "紧急关键决策", missing: "CRITICAL", resolved: false },
      planJson: { delegation: initialDelegation },
    },
  });

  // 第一次决策：扣减预算并 FIRE
  const currentMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const decision1 = await db.$transaction(tx => scopedDelegationAttention(tx, currentMission, "WAITING_INPUT", noon));
  expect(decision1?.level).toBe("URGENT");
  const firstDecisionId = decision1?.decisionId;

  // 检查已记录一条 interventionDecision
  const decisionsBefore = await db.interventionDecision.findMany({ where: { projectId: p.id, channel: "PRIVATE_MISSION" } });
  expect(decisionsBefore.length).toBe(1);

  // 第二次决策（同事项、同 contextVersion、同问题）：直接命中 prior，不产生新的打扰决策，不重复扣预算
  const decision2 = await db.$transaction(tx => scopedDelegationAttention(tx, currentMission, "WAITING_INPUT", noon));
  expect(decision2?.level).toBe("URGENT");
  expect(decision2?.decisionId).toBe(firstDecisionId);

  const decisionsAfter = await db.interventionDecision.findMany({ where: { projectId: p.id, channel: "PRIVATE_MISSION" } });
  expect(decisionsAfter.length).toBe(1); // 数量依然是 1，未重复记录或扣预算
});

test("A-J09 & A-J14: 严格区分 AVAILABLE/PLATFORM_ACCEPTED/SEEN/APPROVED/EXECUTED，SEEN 绝不当作已批准", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "状态分离用户", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "状态机分离项目", goal: "严格状态语义", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-status-mission-1",
    goal: "状态机验证",
    llmContextApproved: true,
  });

  // 1. AVAILABLE: 初始提醒就绪
  const attention = {
    level: "DIGEST",
    reason: "WAITING_APPROVAL",
    decisionId: "dec-100",
    delivery: { channel: "PRIVATE_MISSION_INBOX", status: "AVAILABLE", seenAt: null },
  };

  // 创建一个 WAITING_APPROVAL 的 step 和一个 PENDING 的 approval
  const step = await db.agentMissionStep.create({
    data: {
      missionId: m.id,
      ordinal: 1,
      planRevision: 1,
      status: "WAITING_APPROVAL",
      toolName: "propose_action",
      toolVersion: "1",
      canonicalInputJson: { title: "审查代码" },
      inputHash: "hash-step-1",
      readSetJson: [],
      protocolJson: {},
    },
  });
  const approval = await db.agentMissionApproval.create({
    data: {
      missionId: m.id,
      stepId: step.id,
      status: "PENDING",
      proposalHash: "prop-hash-1",
      proposalJson: { action: "publish" },
      expiresAt: new Date(now + 86400000),
      expectedPlanRevision: 1,
      readSetJson: [],
    },
  });

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_APPROVAL",
      version: 1,
      planJson: {
        delegation: {
          attention,
        },
      },
    },
  });

  const m1 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const del1 = (m1.planJson as { delegation?: { attention?: { delivery?: { status: string } } } })?.delegation?.attention?.delivery;
  expect(del1?.status).toBe("AVAILABLE");

  // 2. PLATFORM_ACCEPTED: 端侧/卡片平台成功接收并回执
  const acceptedRes = await acknowledgeMissionAttention(u.id, m.id, {
    requestId: "ack-platform-1",
    expectedVersion: 1,
    decisionId: "dec-100",
    status: "PLATFORM_ACCEPTED",
  });
  expect(acceptedRes.acknowledged).toBe(true);
  expect(acceptedRes.status).toBe("PLATFORM_ACCEPTED");

  const m2 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const del2 = (m2.planJson as { delegation?: { attention?: { delivery?: { status: string; platformAcceptedAt?: string } } } })?.delegation?.attention?.delivery;
  expect(del2?.status).toBe("PLATFORM_ACCEPTED");
  expect(del2?.platformAcceptedAt).toBeTruthy();

  // 3. SEEN: 用户在客户端看见了该提醒
  const seenRes = await acknowledgeMissionAttention(u.id, m.id, {
    requestId: "ack-seen-1",
    expectedVersion: 2, // 版本已递增
    decisionId: "dec-100",
    status: "SEEN",
  });
  expect(seenRes.acknowledged).toBe(true);
  expect(seenRes.status).toBe("SEEN");

  const m3 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const del3 = (m3.planJson as { delegation?: { attention?: { delivery?: { status: string; seenAt?: string } } } })?.delegation?.attention?.delivery;
  expect(del3?.status).toBe("SEEN");
  expect(del3?.seenAt).toBeTruthy();

  // 核心安全断言：此时即便已 SEEN，方案 approval 依然是 PENDING，绝不是 APPROVED 或 EXECUTED！
  const pendingApproval = await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } });
  expect(pendingApproval.status).toBe("PENDING");

  // 4. APPROVED: 只有用户显式调用 approve 接口，方案才变为 APPROVED
  const approvedRes = await commandMission(u.id, m.id, "approval", {
    requestId: "user-approve-1",
    expectedVersion: m3.version,
    decision: "APPROVED",
    proposalHash: "prop-hash-1",
  }, approval.id);
  expect(approvedRes.status).toBe("READY");

  const finalApproval = await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } });
  expect(finalApproval.status).toBe("APPROVED");
  const approvedStep = await db.agentMissionStep.findUniqueOrThrow({ where: { id: step.id } });
  expect(approvedStep.status).toBe("READY");
});
