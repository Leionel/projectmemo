import { afterAll, beforeEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-threeday"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, commandMission } from "@/lib/mission/missionService";
import { initializeDelegation, processInvestigationDelegations, investigationInputHash } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { readMissionResponsibility } from "@/lib/mission/responsibility";
import { clearWorkerPresenceForTest } from "@/lib/mission/workerPresence";
import { claimMission, fenced, type Lease } from "@/lib/mission/runtimeStore";
import { completeProjectAction } from "@/lib/services/actionService";
import { jsonHash } from "@/lib/mission/contracts";
import type { ToolSet } from "@/lib/mission/tools";
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

test("UX-3D: 三日纵向完整旅程 (D1交代->D2动态调查与重启保持->D3手机纠正与Web读回) 及跨天预算不变量", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  process.env.MISSION_WRITES_ENABLED = "true";

  // -------------------------------------------------------------
  // D1: 用户交代持续责任、范围、期限、总包预算与安静时段
  // -------------------------------------------------------------
  const d1Time = new Date("2026-10-28T10:00:00+08:00");
  vi.setSystemTime(d1Time);

  const u = await db.user.create({
    data: { username: crypto.randomUUID(), displayName: "三日旅程用户", passwordHash: "fixture" },
  });
  const p = await db.project.create({
    data: {
      title: "三日长期委托项目",
      goal: "全旅程可靠接续",
      description: "测试数据",
      scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const conn = await db.sourceConnection.create({
    data: {
      projectId: p.id,
      ownerUserId: u.id,
      repo: "hongmen/core-repo",
      ref: "main",
      signalKind: "COMMITS_AND_CI",
      status: "ACTIVE",
      revision: 1,
      cursorSha: "commit-d1-100",
    },
  });

  // 初始已知基线 commit
  await db.externalSignal.create({
    data: {
      connectionId: conn.id,
      projectId: p.id,
      ownerUserId: u.id,
      sha: "commit-d1-100",
      title: "初始基线提交",
      authorName: "git",
      url: "https://github.com/hongmen/core-repo/commit/commit-d1-100",
      status: "ADOPTED",
      fetchedAt: d1Time,
    },
  });

  const deadline = new Date("2026-10-31T18:00:00+08:00").toISOString();
  const expiresAt = new Date("2026-11-04T18:00:00+08:00").toISOString();

  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "req-threeday-1",
    goal: "持续追踪核心性能问题并提出优化Action",
    missionConstraints: { deadline },
    llmContextApproved: true,
  });

  const policy = {
    mode: "BOUNDED_INVESTIGATION" as const,
    schemaVersion: 1 as const,
    expiresAt,
    checkEveryMinutes: 15,
    maxModels: 100,
    maxTools: 200,
    maxMetadataRequests: 300,
    allowedTools: ["inspect_project", "read_repository_ci", "propose_action"],
    connectionIds: [conn.id],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY" as const,
  };

  const initDelegation = await db.$transaction(tx =>
    initializeDelegation(tx, { ...m, continuationPolicyJson: policy } as Parameters<typeof initializeDelegation>[1], policy)
  );

  // 记录初始条件推测 h1
  const h1 = await db.agentClaim.create({
    data: {
      ownerUserId: u.id,
      projectId: p.id,
      scopeKey: "scope-d1",
      originKey: "origin-d1",
      originJson: {},
      kind: "HYPOTHESIS",
      canonicalStatement: "h1: 编译耗时主要由未命中构建缓存引起",
      conditionsJson: ["在冷启动环境下"],
      statusProjection: "SUPPORTED",
      currentRevision: 1,
    },
  });

  await db.agentClaimEvent.create({
    data: {
      claimId: h1.id,
      ownerUserId: u.id,
      revision: 1,
      requestId: "claim-event-d1",
      payloadHash: "hash-d1",
      targetHash: "target-d1",
      eventKind: "MODEL_PROPOSED",
      actorKind: "MODEL",
      validUntil: new Date("2026-11-01T00:00:00+08:00"),
      evidenceManifestJson: [],
      assessmentJson: {
        root: { allowedProjectIds: [p.id], sourceRevisionReadSet: [] },
        statement: h1.canonicalStatement,
        effectiveState: "SUPPORTED",
      },
    },
  });

  const baselineSnapshotHash = jsonHash({
    sha: "commit-d1-100",
    checks: [{ id: 1, name: "ci", status: "SUCCESS" }],
    runs: [],
    coverage: "90%",
  });

  const d1Input = await investigationInputHash({ ...m, continuationPolicyJson: policy } as Parameters<typeof investigationInputHash>[0]);
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      continuationPolicyJson: policy,
      budgetUsedJson: { models: 2, tools: 4, unknownCalls: 0, metadataRequests: 1 },
      planJson: {
        delegation: {
          ...initDelegation,
          inputHash: d1Input.hash,
          remoteSnapshots: { [conn.id]: baselineSnapshotHash },
        },
      },
    },
  });

  // 核对 D1 责任快照
  const d1Responsibility = await readMissionResponsibility(u.id, m.id);
  expect(d1Responsibility.goal).toBe("持续追踪核心性能问题并提出优化Action");
  expect(d1Responsibility.permissionState).toBe("WITHIN_TIME_BOUNDARY");
  expect(d1Responsibility.deadline).toBe(deadline);
  expect(d1Responsibility.permissionExpiresAt).toBe(expiresAt);
  expect(d1Responsibility.budget.cumulativeUsed.models).toBe(2);
  expect(d1Responsibility.budget.cumulativeUsed.tools).toBe(4);

  // -------------------------------------------------------------
  // D2: 跨天（2026-10-29）。无变化时保持安静，预算永不清零
  // -------------------------------------------------------------
  const d2QuietTime = new Date("2026-10-29T02:00:00+08:00"); // 凌晨 2:00 安静时段
  vi.setSystemTime(d2QuietTime);

  // 1. 到达轮询周期，唤醒一次去执行确定性 CI 观察
  const quietPoll = await processInvestigationDelegations(8);
  expect(quietPoll.woken).toBe(1);

  const mockObsTools: ToolSet = {
    read_repository_ci: {
      description: "mock repo CI observation tool",
      effects: { businessWrite: false, cacheWrite: false, externalDisclosure: false },
      schema: z.object({ connectionId: z.string(), sha: z.string() }),
      version: "1",
      run: async () => ({
        data: {
          observation: {
            sha: "commit-d1-100",
            connectionRevision: 1,
            checks: [{ id: 1, name: "ci", status: "SUCCESS" }],
            runs: [],
            coverage: "90%",
          },
        },
        sources: [],
      }),
    },
  };

  // 执行观察切片：零新增模型调用（如果尝试调用模型则抛错）
  await runMissionSlice({ id: m.id, tools: mockObsTools, provider: async () => { throw new Error("零变化不应调用模型"); } });
  await runMissionSlice({ id: m.id, tools: mockObsTools, provider: async () => { throw new Error("零变化不应调用模型"); } });

  const mAfterQuietCheck = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(mAfterQuietCheck.status).toBe("WAITING_INPUT");
  expect((mAfterQuietCheck.waitStateJson as { waitingFor?: string })?.waitingFor).toBe("OBSERVATION");

  // 再次轮询：在下次周期前保持安静，不再唤醒
  const quietPoll2 = await processInvestigationDelegations(8);
  expect(quietPoll2.woken).toBe(0);

  // 跨天后累积预算严格保留（永不跨天归零）
  const d2Responsibility = await readMissionResponsibility(u.id, m.id);
  expect(d2Responsibility.budget.cumulativeUsed.models).toBe(2); // 零新增模型调用
  expect(d2Responsibility.budget.cumulativeUsed.tools).toBeGreaterThanOrEqual(4); // tools 记录了观察消耗

  // 2. 模拟上午到达新提交 commit-d2-200
  const d2WorkTime = new Date("2026-10-29T11:00:00+08:00");
  vi.setSystemTime(d2WorkTime);

  await db.sourceConnection.update({
    where: { id: conn.id },
    data: { cursorSha: "commit-d2-200" },
  });

  // D2 新原始提交观察到达；远端head读取另由A-J10经原Worker验证。
  await db.externalSignal.create({data:{connectionId:conn.id,projectId:p.id,ownerUserId:u.id,sha:"commit-d2-200",
    title:"D2新提交观察",authorName:"fixture",url:"https://github.com/hongmen/demo/commit/commit-d2-200",status:"CANDIDATE"}});
  // 重新检查唤醒
  await db.agentMission.update({
    where: { id: m.id },
    data: { nextAttemptAt: new Date(d2WorkTime.getTime() - 1000) },
  });

  const wakeResult = await processInvestigationDelegations(8);
  expect(wakeResult.woken).toBe(1);

  // 验证 CANDIDATE 信号生成
  const candidateSignal = await db.externalSignal.findFirst({
    where: { connectionId: conn.id, sha: "commit-d2-200" },
  });
  expect(candidateSignal?.status).toBe("CANDIDATE");

  // 3. Worker 重启与 UNKNOWN 保持：模拟一个产生 proposal 的 slice
  const curM = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const currentPlanRevision = curM.planRevision;
  const lastStep = await db.agentMissionStep.aggregate({ where: { missionId: m.id }, _max: { ordinal: true } });
  const nextOrdinal = (lastStep._max.ordinal ?? 0) + 1;
  const step = await db.agentMissionStep.create({
    data: {
      missionId: m.id,
      ordinal: nextOrdinal,
      planRevision: currentPlanRevision,
      status: "WAITING_APPROVAL",
      toolName: "propose_action",
      toolVersion: "1",
      canonicalInputJson: { title: "引入构建缓存优化Action" },
      inputHash: "hash-step-d2",
      readSetJson: [],
      protocolJson: {},
      effectKey: "action:dedupe:d2",
    },
  });

  const proposalJson = { args: { title: "引入构建缓存优化Action", description: "在流水线开启构建缓存" } };
  const approval = await db.agentMissionApproval.create({
    data: {
      missionId: m.id,
      stepId: step.id,
      status: "PENDING",
      proposalHash: jsonHash(proposalJson),
      proposalJson,
      expiresAt: new Date(d2WorkTime.getTime() + 48 * 3600000), // 48小时有效期
      expectedPlanRevision: currentPlanRevision,
      readSetJson: [],
    },
  });

  await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_APPROVAL",
      version: { increment: 1 },
      budgetUsedJson: { models: 5, tools: 8, unknownCalls: 1, metadataRequests: 3 },
    },
  });

  // -------------------------------------------------------------
  // D3: 第三天（2026-10-30）。手机端纠正推测并批准方案，Web 读回同一 Action 链
  // -------------------------------------------------------------
  const d3Time = new Date("2026-10-30T14:00:00+08:00");
  vi.setSystemTime(d3Time);

  // 手机端纠正推测
  await db.agentClaim.update({
    where: { id: h1.id },
    data: {
      currentRevision: 2,
      canonicalStatement: "h1修订: 耗时不仅是构建缓存，还有依赖解析重试",
      statusProjection: "SUPPORTED",
    },
  });
  await db.agentClaimEvent.create({
    data: {
      claimId: h1.id,
      ownerUserId: u.id,
      revision: 2,
      requestId: "claim-event-d3",
      payloadHash: "hash-d3",
      targetHash: "target-d3",
      eventKind: "USER_CORRECTION",
      actorKind: "USER",
      userQuote: "注意依赖解析也有重试耗时",
      evidenceManifestJson: [],
      assessmentJson: {
        root: { allowedProjectIds: [p.id], sourceRevisionReadSet: [] },
        statement: "h1修订: 耗时不仅是构建缓存，还有依赖解析重试",
        effectiveState: "SUPPORTED",
      },
    },
  });

  const mBeforeApproval = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });

  // 手机端显式批准提案
  const approvalRes = await commandMission(
    u.id,
    m.id,
    "approval",
    {
      requestId: "req-approve-d3",
      expectedVersion: mBeforeApproval.version,
      decision: "APPROVED",
      proposalHash: jsonHash(proposalJson),
    },
    approval.id
  );
  expect(approvalRes.status).toBe("READY");

  // Runner 执行批准的 Action 写入（commitApprovedAction）
  const sliceExecuted = await runMissionSlice({
    id: m.id,
    provider: async () => ({
      choice: { kind: "finish", outputId: "finish-output" },
      provider: "SCRIPTED_LOCAL",
      model: "fixture",
      protocol: "JSON_CHOICE",
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
  });
  expect(sliceExecuted).toBe(true);

  // 验证 Action 已持久化并生成关联
  const executedApproval = await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } });
  expect(executedApproval.status).toBe("CONSUMED");

  const executedStep = await db.agentMissionStep.findUniqueOrThrow({ where: { id: step.id } });
  expect(executedStep.status).toBe("SUCCEEDED");

  const stepResult = executedStep.resultJson as { data?: { actionId?: string; resultCardId?: string } };
  expect(stepResult?.data?.actionId).toBeTruthy();

  const createdAction = await db.actionItem.findUniqueOrThrow({ where: { id: stepResult.data!.actionId } });
  expect(createdAction.title).toBe("引入构建缓存优化Action");

  const outcome=await completeProjectAction(p.id,createdAction.id,"已在隔离测试环境记录构建缓存验证结果，结果仍为用户报告。");
  expect(outcome.resultCardId).toBeTruthy();
  const replayed=await completeProjectAction(p.id,createdAction.id,"同一原行动结果重放，不新增回执。");
  expect(replayed.resultCardId).toBe(outcome.resultCardId);
  expect((await db.actionItem.findUniqueOrThrow({where:{id:createdAction.id}})).status).toBe("DONE");
  // 服务读回同一责任快照与累积预算；真实Web/鸿蒙另有交互验收。
  const d3FinalResponsibility = await readMissionResponsibility(u.id, m.id);
  expect(d3FinalResponsibility.budget.cumulativeUsed.models).toBeGreaterThanOrEqual(5);
  expect(d3FinalResponsibility.budget.cumulativeUsed.tools).toBeGreaterThanOrEqual(8);
  expect(d3FinalResponsibility.budget.cumulativeUsed.unknownCalls).toBe(1);
});

test("A-J06: 迟到旧 generation/lease 模型调用不发布，状态变更拒绝旧租约提交", async () => {
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "租约测试用户", passwordHash: "fixture" } });
  const p = await db.project.create({
    data: {
      title: "租约测试项目", goal: "防止旧调用写回", description: "测试数据", scenario: "RESEARCH",
      memberships: { create: { userId: u.id, role: "OWNER" } },
    },
  });

  const m = await createMission(u.id, {
    projectId: p.id,
    requestId: "req-lease-1",
    goal: "租约隔离验证",
    llmContextApproved: true,
  });

  // 1. Worker 1 抢占任务，获取租约 lease1 (epoch: 1)
  const claimed1 = await claimMission("worker-lease-1", m.id);
  expect(claimed1).toBeTruthy();
  const lease1: Lease = {
    id: m.id,
    owner: claimed1!.leaseOwner!,
    epoch: claimed1!.leaseEpoch,
    contextVersion: claimed1!.contextVersion,
    planRevision: claimed1!.planRevision,
  };

  // 此时在 lease1 有效期内，fenced 校验通过
  const fencedOk = await db.$transaction(tx => fenced(tx, lease1));
  expect(fencedOk.id).toBe(m.id);

  // 2. 模拟 Worker 1 的模型调用延迟返回，期间任务被重新抢占（如超时或重启）
  // 强制递增 leaseEpoch 并由 worker-2 接管
  await db.agentMission.update({
    where: { id: m.id },
    data: {
      leaseOwner: "worker-lease-2",
      leaseEpoch: { increment: 1 },
      leaseUntil: new Date(Date.now() + 60000),
    },
  });

  // 3. Worker 1 的旧调用迟到返回，尝试调用 fenced 提交结果
  // 必须被 409 LEASE_LOST 拦截拒绝，绝不能发布旧模型生成内容！
  await expect(db.$transaction(tx => fenced(tx, lease1))).rejects.toThrow("执行租约已失效");

  // 4. 上下文版本变迁防护：即使 leaseEpoch 相同，但 contextVersion 或 planRevision 已递增，也抛出 CONTEXT_CHANGED
  const claimed2 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const lease2: Lease = {
    id: m.id,
    owner: claimed2.leaseOwner!,
    epoch: claimed2.leaseEpoch,
    contextVersion: claimed2.contextVersion,
    planRevision: claimed2.planRevision,
  };

  // 外部输入推进 contextVersion
  await db.agentMission.update({
    where: { id: m.id },
    data: { contextVersion: { increment: 1 } },
  });

  await expect(db.$transaction(tx => fenced(tx, lease2))).rejects.toThrow("委托上下文已变化");
});
