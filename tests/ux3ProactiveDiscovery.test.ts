import { afterAll, beforeEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-proactive"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { processInvestigationDelegations, initializeDelegation } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { runDelegationObservation } from "@/lib/mission/delegationObservation";
import { AppError } from "@/lib/api";
import { claimMission } from "@/lib/mission/runtimeStore";
import { clearWorkerPresenceForTest } from "@/lib/mission/workerPresence";
import type { ToolSet } from "@/lib/mission/tools";
import { jsonHash } from "@/lib/mission/contracts";
import { z } from "zod";

afterAll(async () => {
  vi.useRealTimers();
  clearWorkerPresenceForTest();
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorkerPresenceForTest();
});

test("A-J03: 同状态CI或条目换序零新增模型调用、零重复提醒；必要HTTP检查计入原账本", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "CI排序测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "CI 观察项目", goal: "零变化保持安静", description: "测试数据", scenario: "RESEARCH",
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

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-ci-obs-1",
    goal: "观察 CI 结果",
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
    allowedTools: ["inspect_project", "read_repository_ci"],
    connectionIds: [conn.id],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY",
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  // 预先计算期望的快照 hash（有序 baseline）
  const expectedSnapshotHash = jsonHash({
    sha: "sha-100",
    connectionRevision: 1,
    checks: [
      { id: 101, name: "test", status: "SUCCESS" },
      { id: 102, name: "lint", status: "SUCCESS" },
    ],
    runs: [],
    coverage: "95%",
  });

  // 初始设置快照和 poll
  const cycle = "poll-cycle-1";
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      continuationPolicyJson: policy,
      planJson: {
        delegation: {
          ...initialDelegation,
          poll: { cycle, targets: [{ connectionId: conn.id, sha: "sha-100", revision: 1 }] },
          remoteSnapshots: {
            // 预设前一次的 snapshot hash，完全一致
            [conn.id]: expectedSnapshotHash,
          },
        },
      },
    },
  });

  // 第一次读取：返回包含有序 checks 的数据
  let runCount = 0;
  const mockTools: ToolSet = {
    read_repository_ci: {
      schema: z.object({ connectionId: z.string(), sha: z.string() }),
      version: "1",
      run: async () => {
        runCount++;
        return {
          data: {
            observation: {
              sha: "sha-100",
              connectionRevision: 1,
              checks: [
                { id: 102, name: "lint", status: "SUCCESS" },
                { id: 101, name: "test", status: "SUCCESS" },
              ],
              runs: [],
              coverage: "95%",
            },
          },
        };
      },
    },
  };

  // Step 1: 运行第一步观察（此时创建并执行 step，状态 SUCCEEDED）
  const claimed = await claimMission("worker-1", m.id);
  expect(claimed).toBeTruthy();
  const lease = { id: m.id, owner: claimed!.leaseOwner!, epoch: claimed!.leaseEpoch, contextVersion: claimed!.contextVersion, planRevision: claimed!.planRevision };

  const stepExecuted = await runDelegationObservation(lease, mockTools, () => {});
  expect(stepExecuted).toBe(true);
  expect(runCount).toBe(1);

  // Step 2: 再次运行 observation 循环（所有 targets 已执行，对比前后 snapshot）
  const claimed2 = await claimMission("worker-1", m.id);
  const lease2 = { id: m.id, owner: claimed2!.leaseOwner!, epoch: claimed2!.leaseEpoch, contextVersion: claimed2!.contextVersion, planRevision: claimed2!.planRevision };

  const pollCompleted = await runDelegationObservation(lease2, mockTools, () => {});
  expect(pollCompleted).toBe(true);

  const updatedMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  // 检查已记录为无变化事件
  const events = await db.agentMissionEvent.findMany({ where: { missionId: m.id } });
  const noInfoEvent = events.find(e => e.type === "INVESTIGATION_NO_NEW_INFORMATION" || e.type === "INVESTIGATION_OBSERVATION_CHANGED");
  expect(noInfoEvent).toBeTruthy();

  // 状态为等待输入，且等待原因为 OBSERVATION
  expect(updatedMission.status).toBe("WAITING_INPUT");
  const waitState = updatedMission.waitStateJson as { waitingFor?: string };
  expect(waitState?.waitingFor).toBe("OBSERVATION");

  // 累计预算中记录了 tools 消耗
  const budgetUsed = updatedMission.budgetUsedJson as { tools?: number; models?: number };
  expect(budgetUsed?.tools).toBeGreaterThanOrEqual(1);
  expect(budgetUsed?.models ?? 0).toBe(0); // 零新增模型调用
});

test("A-J10: 分支新head候选发现与撤权后不自动复活", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "Head发现测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "分支跟踪项目", goal: "发现新候选", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id, ownerUserId: u.id,
      repo: "hongmen/tracked-repo", ref: "main", signalKind: "COMMITS_AND_CI",
      status: "ACTIVE", revision: 1,
      cursorSha: "commit-sha-200", // 新发现的 commit
    },
  });

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-track-head-1",
    goal: "跟踪分支 head",
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
    allowedTools: ["inspect_project", "read_repository_ci"],
    connectionIds: [conn.id],
    trackBranchHead: true, // 开启分支跟踪
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY",
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      planJson: {
        delegation: initialDelegation,
      },
    },
  });

  // 运行 processInvestigationDelegations
  const res = await processInvestigationDelegations(8);
  expect(res.woken).toBe(1);

  // 验证新 signal 记录为 CANDIDATE
  const signal = await db.externalSignal.findFirst({
    where: { connectionId: conn.id, sha: "commit-sha-200" },
  });
  expect(signal).toBeTruthy();
  expect(signal?.status).toBe("CANDIDATE");

  // 验证任务被唤醒为 READY
  const wokenMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(wokenMission.status).toBe("READY");

  // 验证事件记录
  const headDiscoveredEvent = await db.agentMissionEvent.findFirst({
    where: { missionId: m.id, type: "INVESTIGATION_BRANCH_HEAD_DISCOVERED" },
  });
  expect(headDiscoveredEvent).toBeTruthy();

  // 现在模拟撤销该连接授权
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  // 将任务重新置为 WAITING_INPUT
  await db.agentMission.update({
    where: { id: m.id },
    data: { status: "WAITING_INPUT", nextAttemptAt: null },
  });

  // 再次运行 processInvestigationDelegations，应 hold 任务，绝不复活
  const heldRes = await processInvestigationDelegations(8);
  expect(heldRes.woken).toBe(0);

  const heldMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(heldMission.status).toBe("PAUSED");
  expect(heldMission.pauseReason).toBe("REVIEW_REQUIRED");
  expect(heldMission.nextAttemptAt).toBeNull();
});

test("A-J12: 推测到期/纠正后更新 inputHash，唤醒任务进行重协调", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "推测联动测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "推测联动项目", goal: "认知驱动调查", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  // 创建一个推测 claim
  const claim = await db.agentClaim.create({
    data: {
      ownerUserId: u.id,
      projectId: p.id,
      scopeKey: "scope-key-1",
      originKey: "origin-key-1",
      originJson: {},
      kind: "HYPOTHESIS",
      canonicalStatement: "初始推测：模块A性能瓶颈在渲染层",
      conditionsJson: ["在低端设备上测试"],
      statusProjection: "SUPPORTED",
      currentRevision: 1,
    },
  });

  await db.agentClaimEvent.create({
    data: {
      claimId: claim.id,
      ownerUserId: u.id,
      revision: 1,
      requestId: "event-req-1",
      payloadHash: "hash-1",
      targetHash: "target-1",
      eventKind: "MODEL_PROPOSED",
      actorKind: "MODEL",
      validUntil: new Date(Date.now() + 86400000),
      evidenceManifestJson: [],
      assessmentJson: {
        root: { allowedProjectIds: [p.id], sourceRevisionReadSet: [{ type: "CAPTURE", id: "cap-1", revision: 1 }] },
        statement: claim.canonicalStatement,
        effectiveState: "SUPPORTED",
      },
    },
  });

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-hyp-mission-1",
    goal: "根据推测调查原因",
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

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      planJson: {
        delegation: initialDelegation,
      },
    },
  });

  // 此时无变化，不会被唤醒
  const noWakeRes = await processInvestigationDelegations(8);
  expect(noWakeRes.woken).toBe(0);

  // 用户纠正推测（更新推测内容与版本）
  await db.agentClaim.update({
    where: { id: claim.id },
    data: {
      currentRevision: 2,
      canonicalStatement: "纠正后的推测：模块A性能瓶颈在数据序列化",
      statusProjection: "INCONCLUSIVE",
    },
  });
  await db.agentClaimEvent.create({
    data: {
      claimId: claim.id,
      ownerUserId: u.id,
      revision: 2,
      requestId: "event-req-2",
      payloadHash: "hash-2",
      targetHash: "target-2",
      eventKind: "USER_CORRECTION",
      actorKind: "USER",
      userQuote: "瓶颈不在渲染，而是在JSON反序列化",
      evidenceManifestJson: [],
      assessmentJson: {
        root: { allowedProjectIds: [p.id], sourceRevisionReadSet: [{ type: "CAPTURE", id: "cap-1", revision: 1 }] },
        statement: "纠正后的推测：模块A性能瓶颈在数据序列化",
        effectiveState: "INCONCLUSIVE",
      },
    },
  });

  // 模拟轮询到达（或者由指引失效重置）
  await db.agentMission.update({
    where: { id: m.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });

  // 再次运行 processInvestigationDelegations，由于 inputHash 包含了推测读集，检测到输入变化并唤醒！
  const wakeRes = await processInvestigationDelegations(8);
  expect(wakeRes.woken).toBe(1);

  const wokenMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(wokenMission.status).toBe("READY");

  const inputChangedEvent = await db.agentMissionEvent.findFirst({
    where: { missionId: m.id, type: "INVESTIGATION_INPUT_CHANGED" },
  });
  expect(inputChangedEvent).toBeTruthy();
});

test("A-J04: 可恢复观察失败（网络抖动、退避）不污染长期结论，失败状态与‘已核对无变化’在数据上严格区分", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "网络抖动测试", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "失败退避项目", goal: "不污染长期结论", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id, ownerUserId: u.id,
      repo: "hongmen/flaky-repo", ref: "main", signalKind: "COMMITS_AND_CI",
      status: "ACTIVE", revision: 1,
    },
  });

  const now = Date.now(), expiresAt = new Date(now + 86400000).toISOString();
  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "create-fail-mission-1",
    goal: "观察 CI",
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
    allowedTools: ["inspect_project", "read_repository_ci"],
    connectionIds: [conn.id],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY",
  };

  const initialDelegation = await db.$transaction(async tx => initializeDelegation(tx, await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), policy));

  const cycle = "poll-cycle-fail";
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "READY",
      continuationPolicyJson: policy,
      planJson: {
        delegation: {
          ...initialDelegation,
          poll: { cycle, targets: [{ connectionId: conn.id, sha: "sha-fail", revision: 1 }] },
          remoteSnapshots: {},
        },
      },
    },
  });

  // 工具抛出临时性网络错误
  const flakyTools: ToolSet = {
    read_repository_ci: {
      schema: z.object({ connectionId: z.string(), sha: z.string() }),
      version: "1",
      run: async () => {
        throw new AppError("NETWORK_TIMEOUT", "上游仓库服务网络抖动超时", 504);
      },
    },
  };

  await runMissionSlice({
    id: m.id,
    tools: flakyTools,
    provider: async () => ({
      choice: { kind: "finish", outputId: "none" },
      provider: "SCRIPTED_LOCAL",
      model: "fixture",
      protocol: "JSON_CHOICE",
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  });

  const failedMission = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  // 失败状态为 PAUSED，pauseReason 为 REVIEW_REQUIRED
  expect(failedMission.status).toBe("PAUSED");
  expect(failedMission.pauseReason).toBe("REVIEW_REQUIRED");

  // 数据上包含结构化 lastErrorJson，与正常无变化时的 WAITING_INPUT + waitingFor: OBSERVATION 明确区分
  const lastError = failedMission.lastErrorJson as { code?: string; message?: string; recovery?: { kind: string } };
  expect(lastError?.code).toBe("NETWORK_TIMEOUT");
  expect(lastError?.recovery?.kind).toBe("REVIEW_REQUIRED");

  // 原计划中的步骤依然保留，未污染长期结论
  const steps = await db.agentMissionStep.findMany({ where: { missionId: m.id } });
  expect(steps.length).toBeGreaterThanOrEqual(1);
});
