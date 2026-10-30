import { afterAll, beforeEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-revision"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { readMissionResponsibility, reviseMissionResponsibility } from "@/lib/mission/responsibility";
import { clearWorkerPresenceForTest, recordWorkerPresence } from "@/lib/mission/workerPresence";

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

  // 1. 模拟来源连接发生变更（例如 revision 递增）
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { revision: 2 },
  });

  const snapshotAfterConnChange = await readMissionResponsibility(u.id, m.id);
  expect(snapshotAfterConnChange.controlVersion).not.toBe(snapshot1.controlVersion);

  // 用旧 controlVersion 尝试扩大授权或修订，必须报 MISSION_CHANGED
  await expect(reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-stale",
    expectedControlVersion: snapshot1.controlVersion,
    goal: "尝试用过期来源版本扩大授权",
  })).rejects.toMatchObject({ code: "MISSION_CHANGED" });

  // 2. 用最新 controlVersion 修订成功
  const revised = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-ok-1",
    expectedControlVersion: snapshotAfterConnChange.controlVersion,
    goal: "更新后的责任目标",
    successCriteria: ["必须全部 CI 绿灯"],
  });
  expect(revised.goal).toBe("更新后的责任目标");
  expect(revised.successCriteria).toEqual(["必须全部 CI 绿灯"]);
  expect(revised.budget.cumulativeUsed.unknownCalls).toBe(1);

  // 3. 幂等性：同 requestId + 同 payload 返回相同快照
  const replayed = await reviseMissionResponsibility(u.id, m.id, {
    requestId: "revise-ok-1",
    expectedControlVersion: snapshotAfterConnChange.controlVersion,
    goal: "更新后的责任目标",
    successCriteria: ["必须全部 CI 绿灯"],
  });
  expect(replayed.goal).toBe("更新后的责任目标");

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
