import { afterAll, describe, expect, expectTypeOf, it, vi } from "vitest";
// 独立临时库必须在 import lib/db 之前设置；文件内串行，不开文件并行。
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("final-a-workpacket-service"));
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { readMissionBack, type MissionReadback } from "@/lib/mission/readback";
import { missionDetail } from "@/lib/mission/missionService";
import { missionWorkspaceSummary } from "@/lib/mission/workspaceSummary";
import { sourceHash } from "@/lib/mission/repository";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { WorkPacket, WorkPacketOptionalDelta } from "@/lib/types/workPacket";

// 后台 Worker 心跳写到临时目录：不污染工作树 .runtime/，也不影响“读回无副作用”的断言。
process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "worker-presence.json");
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

type ProbeOwner = { userId: string; projectId: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
let counter = 0;
async function ownerProject(label: string): Promise<ProbeOwner> {
  counter += 1;
  const user = await db.user.create({ data: { username: `final-a-${label}-${counter}-${crypto.randomUUID().slice(0, 8)}`, displayName: `A2 服务 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: `A2 服务项目 ${label}`, description: "SYNTHETIC_FINAL_A_SERVICE", goal: "核对工作包服务投影", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { userId: user.id, projectId: project.id };
}
async function createMissionRow(owner: ProbeOwner, overrides: Record<string, unknown> = {}) {
  const data = {
    projectId: owner.projectId, ownerUserId: owner.userId,
    createRequestId: `req-${crypto.randomUUID()}`, createPayloadHash: "synthetic-final-a",
    goal: "核对四问工作包", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, researchScopeJson: {},
    continuationPolicyJson: { mode: "MANUAL" }, planJson: {}, budgetJson: {},
    ...overrides,
  } as unknown as Prisma.AgentMissionUncheckedCreateInput;
  return db.agentMission.create({ data });
}
/** 按真实 event() 的 nextEventSeq 递增方式追加原事件。 */
async function addEvent(missionId: string, type: string, payload: unknown, at?: Date) {
  const mission = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: mission.nextEventSeq, type, payloadJson: json(payload), ...(at ? { createdAt: at } : {}) } });
}
function boundedPolicy(expiresAt: Date | string) {
  return { mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(expiresAt).toISOString(), checkEveryMinutes: 30,
    maxModels: 5, maxTools: 10, maxMetadataRequests: 5, dailyBurst: { maxModels: 2, maxTools: 4 }, allowedTools: ["inspect_project"],
    connectionIds: [], trackBranchHead: false, timezone: "Asia/Shanghai", quietStart: 22, quietEnd: 8, attention: "IMPORTANT_ONLY" };
}
async function withDelegation<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED;
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED; else process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = previous;
  }
}
/** 造一条原委托资料链：SOURCE_ARRIVED 事件 + SUCCEEDED 的 bind_project_sources。 */
async function bindMaterial(owner: ProbeOwner, missionId: string, questionId: string, text = "10月推理显存6.2GB，用户提供的记录") {
  const capture = await db.capture.create({ data: { projectId: owner.projectId, rawText: text, sourceType: "实验记录" } });
  const hash = (await sourceHash(owner.projectId, `capture:${capture.id}`))!;
  const pointer = { id: `capture:${capture.id}`, hash };
  await addEvent(missionId, "SOURCE_ARRIVED", { questionId, sourcePointer: pointer, readable: true, observedAt: new Date().toISOString() });
  const step = await db.agentMissionStep.create({ data: {
    missionId, ordinal: 1, planRevision: 1, toolName: "bind_project_sources", toolVersion: "1",
    canonicalInputJson: json({ questionId, sourceId: pointer.id }), inputHash: `bind-${crypto.randomUUID()}`, readSetJson: json([]),
    status: "SUCCEEDED", finishedAt: new Date(),
    resultJson: json({ data: { questionId }, sources: [{ id: pointer.id, kind: "PROJECT", entityType: "CAPTURE", revision: hash, hash, text, observedAt: new Date().toISOString() }] }),
  } });
  return { capture, pointer, step };
}
function packet(back: MissionReadback): WorkPacket {
  expect(back.workPacket).toBeDefined();
  return back.workPacket!;
}

describe("A2 四问工作包：同一只读事务组合", () => {
  it("运行/排队：原生命周期与版本进入同一快照，读取只给只读投影", async () => {
    const runningOwner = await ownerProject("running");
    const running = await createMissionRow(runningOwner, { status: "RUNNING", version: 2, leaseUntil: new Date(Date.now() + 60_000) });
    const runningBack = await readMissionBack(runningOwner.userId, running.id);
    expect(runningBack.workState).toMatchObject({ phase: "RUNNING", nextActor: "AGENT", reasonCode: "LEASE_ACTIVE" });
    const runningPacket = packet(runningBack);
    expect(runningPacket.schemaVersion).toBe(1);
    expect(runningPacket.contractVersion).toBe("final-a-workpacket-v1");
    expect(runningPacket.identity).toMatchObject({ missionId: running.id, projectId: runningOwner.projectId, missionVersion: 2, missionStatus: "RUNNING", originalRef: { kind: "MISSION", id: running.id, version: 2 } });
    expect(runningPacket.snapshot).toMatchObject({ mode: "SINGLE_READ_TRANSACTION", consistency: "VERSION_STABLE", retries: 0 });
    expect(runningPacket.snapshot.checkedAt).toBe(runningBack.readAt);
    expect(runningPacket.observations.readAt).toBe(runningBack.readAt);
    expect(runningPacket.next.primaryAction).toMatchObject({ readOnly: true, submissionGuard: "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY" });
    // A1-fix（b243f62）：RUNNING 且 lease 有效时主操作是等待执行中进展，不是“重核许可”。
    expect(runningPacket.next.primaryAction).toMatchObject({ kind: "WAIT_FOR_OBSERVATION", label: "查看委托进展（执行中）" });
    expect(runningPacket.next.waitingOn).toBe("SYSTEM_WORKER");
    expect(runningPacket.next.primaryAction!.requires).toMatchObject({ missionVersion: 2, planRevision: running.planRevision, contextVersion: running.contextVersion, constraintsVersion: running.constraintsVersion, researchScopeVersion: running.researchScopeVersion });
    expect(runningPacket.stopped.workState.phase).toBe("RUNNING");
    expect(runningPacket.stopped.missionStatus).toBe("RUNNING");
    expect(runningPacket.realityOutcome).toBe("NOT_INFERRED");
    expect(runningPacket.authority.note).toBe("VIEW_ONLY_NO_EXECUTION_PERMISSION");

    const queuedOwner = await ownerProject("queued");
    const queued = await createMissionRow(queuedOwner, { status: "READY" });
    const queuedPacket = packet(await readMissionBack(queuedOwner.userId, queued.id));
    expect(queuedPacket.stopped.workState.phase).toBe("QUEUED");
    expect(queuedPacket.next.primaryAction).toMatchObject({ kind: "WAIT_FOR_OBSERVATION", target: { kind: "MISSION", id: queued.id } });
    expect(queuedPacket.next.waitingOn).toBe("SYSTEM_WORKER");
  });

  it("等待用户/等待批准：主操作只指向当前原问题或当前有效提案", async () => {
    const userOwner = await ownerProject("waiting-user");
    const waitingUser = await createMissionRow(userOwner, { status: "WAITING_INPUT",
      waitStateJson: { questionId: "q-pending", question: "请补充对照实验指标", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
    await addEvent(waitingUser.id, "QUESTION", { question: "请补充对照实验指标" });
    const userBack = await readMissionBack(userOwner.userId, waitingUser.id);
    expect(userBack.workState).toMatchObject({ phase: "WAITING_USER", exactQuestionRef: "q-pending", requiresUser: true });
    const userPacket = packet(userBack);
    expect(userPacket.next.primaryAction).toMatchObject({ kind: "ANSWER_QUESTION", target: { kind: "QUESTION", id: "q-pending", version: null } });
    expect(userPacket.next.waitingOn).toBe("USER_INPUT");
    expect(userPacket.next.primaryAction!.requires.questionId).toBe("q-pending");
    expect(userPacket.blockers.some(blocker => blocker.code === "QUESTION_PENDING" && blocker.blocksActions)).toBe(true);
    expect(userBack.selected.question).toBeNull();

    const approvalOwner = await ownerProject("waiting-approval");
    const waitingApproval = await createMissionRow(approvalOwner, { status: "WAITING_APPROVAL" });
    const step = await db.agentMissionStep.create({ data: { missionId: waitingApproval.id, ordinal: 1, planRevision: waitingApproval.planRevision,
      toolName: "propose_action", toolVersion: "1", canonicalInputJson: json({ title: "验证一次新实验" }), inputHash: "approval-step", readSetJson: json([]), status: "WAITING_APPROVAL" } });
    const proposalHash = "b".repeat(64);
    await db.agentMissionApproval.create({ data: { missionId: waitingApproval.id, stepId: step.id, proposalHash,
      proposalJson: json({ tool: "create_action", args: { title: "验证一次新实验" } }), expectedPlanRevision: waitingApproval.planRevision,
      readSetJson: json([]), status: "PENDING", expiresAt: new Date(Date.now() + 600_000) } });
    const approvalBack = await readMissionBack(approvalOwner.userId, waitingApproval.id);
    expect(approvalBack.workState).toMatchObject({ phase: "WAITING_APPROVAL", requiresUser: true });
    expect(approvalBack.workState.exactApprovalRef).toBeTruthy();
    const approvalPacket = packet(approvalBack);
    expect(approvalPacket.next.primaryAction).toMatchObject({ kind: "REVIEW_APPROVAL", target: { kind: "APPROVAL", id: approvalBack.workState.exactApprovalRef!, version: null } });
    expect(approvalPacket.next.primaryAction!.requires).toMatchObject({ approvalId: approvalBack.workState.exactApprovalRef!, proposalHash });
    expect(approvalPacket.blockers.some(blocker => blocker.code === "APPROVAL_PENDING" && blocker.blocksActions)).toBe(true);
  });

  it("观察无变化：无变化只是最近成功观察的结论，不是生命周期终态", async () => {
    const owner = await ownerProject("observation-no-change");
    const observedAt = new Date(Date.now() - 60_000);
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      planJson: { delegation: { lastObservedAt: observedAt.toISOString() } },
      continuationPolicyJson: boundedPolicy(new Date(Date.now() + 3_600_000)),
      waitStateJson: { questionId: "q-observation", resolved: true, waitingFor: "OBSERVATION" } });
    await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
    const back = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(back.workState).toMatchObject({ phase: "WAITING_OBSERVATION", nextActor: "AGENT" });
    const workPacket = packet(back);
    expect(workPacket.observations).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: observedAt.toISOString(), lastFailedAt: null });
    expect(workPacket.observations.lastNoNewInformationAt).toBeTruthy();
    expect(workPacket.next.primaryAction).toMatchObject({ kind: "WAIT_FOR_OBSERVATION" });
    expect(workPacket.next.waitingOn).toBe("SYSTEM_OBSERVATION");
    expect(workPacket.next.note).toContain("未发现新变化");
    expect(workPacket.done.note).toContain("无新变化");
    // 原 readback 顶层 observation 与工作包 observations 同源。
    expect(back.observation).toEqual(workPacket.observations);
  });

  it("失败/停止请求在途/已暂停/UNKNOWN：四维并列，主操作不吞掉其他阻断", async () => {
    const failedOwner = await ownerProject("failed");
    const failed = await createMissionRow(failedOwner, { status: "FAILED", lastErrorJson: { code: "TOOL_FAILED", message: "这一步未完成", phase: "TOOL" } });
    const failedPacket = packet(await readMissionBack(failedOwner.userId, failed.id));
    expect(failedPacket.stopped.workState.phase).toBe("FAILED");
    expect(failedPacket.next.primaryAction).toMatchObject({ kind: "REVIEW_FAILURE" });
    expect(failedPacket.blockers.some(blocker => blocker.kind === "FAILURE" && blocker.code === "TOOL_FAILED")).toBe(true);

    const stopOwner = await ownerProject("stop-in-flight");
    const stopRequestedAt = new Date(Date.now() - 5_000);
    const stopping = await createMissionRow(stopOwner, { status: "RUNNING", leaseUntil: new Date(Date.now() + 60_000), pauseRequestedAt: stopRequestedAt });
    const stopBack = await readMissionBack(stopOwner.userId, stopping.id);
    expect(stopBack.workState).toMatchObject({ phase: "RUNNING", reasonCode: "STOP_REQUESTED_IN_FLIGHT", nextActor: "SYSTEM" });
    const stopPacket = packet(stopBack);
    expect(stopPacket.stopped.stopRequest).toMatchObject({ state: "PAUSE_REQUESTED", settled: false, requestedAt: stopRequestedAt.toISOString() });
    expect(stopPacket.next.primaryAction).toMatchObject({ kind: "CHECK_STOP_SETTLEMENT" });
    expect(stopPacket.next.waitingOn).toBe("SYSTEM_SETTLEMENT");
    expect(stopPacket.blockers.some(blocker => blocker.kind === "STOP_REQUEST" && blocker.blocksActions)).toBe(true);

    const pausedOwner = await ownerProject("paused");
    const paused = await createMissionRow(pausedOwner, { status: "PAUSED", pauseRequestedAt: new Date(Date.now() - 60_000), pauseReason: "USER" });
    const pausedPacket = packet(await readMissionBack(pausedOwner.userId, paused.id));
    expect(pausedPacket.stopped.workState.phase).toBe("PAUSED");
    expect(pausedPacket.stopped.stopRequest).toMatchObject({ state: "PAUSE_SETTLED", settled: true });
    expect(pausedPacket.next.primaryAction).toMatchObject({ kind: "RESUME_DELEGATION" });

    const unknownOwner = await ownerProject("unknown");
    const unknown = await createMissionRow(unknownOwner, { status: "PAUSED", lastErrorJson: { code: "TOOL_UNKNOWN", message: "原请求结果未知" } });
    const unknownPacket = packet(await readMissionBack(unknownOwner.userId, unknown.id));
    expect(unknownPacket.stopped.workState.phase).toBe("UNKNOWN");
    expect(unknownPacket.stopped.unknownEffect).toMatchObject({ present: true, code: "TOOL_UNKNOWN", resolvedByRead: false });
    expect(unknownPacket.next.primaryAction).toMatchObject({ kind: "RECHECK_AUTHORITY" });
    expect(unknownPacket.blockers.some(blocker => blocker.kind === "UNKNOWN_EFFECT")).toBe(true);
  });

  it("取消/成功：终态可见且取消不显示成功；额度等待：QUEUED 与累计预算保留", async () => {
    const cancelOwner = await ownerProject("cancelled");
    const cancelled = await createMissionRow(cancelOwner, { status: "CANCELLED", finishedAt: new Date(Date.now() - 30_000) });
    const cancelBack = await readMissionBack(cancelOwner.userId, cancelled.id);
    const cancelPacket = packet(cancelBack);
    expect(cancelBack.workState).toMatchObject({ phase: "COMPLETED", reasonCode: "CANCELLED" });
    expect(cancelPacket.stopped.workState.terminal).toMatchObject({ status: "CANCELLED", atSource: "FINISHED_AT", reasonCode: "CANCELLED" });
    expect(cancelPacket.next.primaryAction).toMatchObject({ kind: "VIEW_RESULT", label: "查看取消前的原结果" });
    expect(cancelPacket.next.note).toContain("原委托已取消");

    const successOwner = await ownerProject("succeeded");
    const succeeded = await createMissionRow(successOwner, { status: "SUCCEEDED", finishedAt: new Date(Date.now() - 30_000) });
    const successPacket = packet(await readMissionBack(successOwner.userId, succeeded.id));
    expect(successPacket.stopped.workState.phase).toBe("COMPLETED");
    expect(successPacket.next.primaryAction).toMatchObject({ kind: "VIEW_RESULT", label: "查看原结果" });

    const budgetOwner = await ownerProject("budget-waiting");
    const nextAttemptAt = new Date(Date.now() + 3_600_000);
    const budget = await createMissionRow(budgetOwner, { status: "READY", nextAttemptAt,
      budgetUsedJson: { models: 3, tools: 2, inputTokens: 10, outputTokens: 5, unknownCalls: 1 } });
    await addEvent(budget.id, "DAILY_BUDGET_WAITING", { nextAttemptAt: nextAttemptAt.toISOString(), budgetRetained: true });
    const budgetBack = await readMissionBack(budgetOwner.userId, budget.id);
    expect(budgetBack.workState).toMatchObject({ phase: "QUEUED", reasonCode: "DAILY_BUDGET_WAITING", nextCheckAt: nextAttemptAt.toISOString() });
    const budgetPacket = packet(budgetBack);
    expect(budgetPacket.next.primaryAction).toMatchObject({ kind: "WAIT_FOR_OBSERVATION" });
    expect(budgetPacket.next.waitingOn).toBe("BUDGET_RESET");
    expect(budgetPacket.next.nextCheckAt).toBe(nextAttemptAt.toISOString());
    expect(budgetPacket.authority.budget.cumulativeUsed).toMatchObject({ models: 3, tools: 2, inputTokens: 10, outputTokens: 5, unknownCalls: 1 });
    expect(budgetPacket.authority.budget).toMatchObject({ policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE", monetaryCost: null });
  });

  it("旧 readback 字段与语义保留；新增 readAt/observation 只是增量，workPacket 可选", async () => {
    const owner = await ownerProject("legacy-compat");
    const mission = await createMissionRow(owner, { status: "READY" });
    const back = await readMissionBack(owner.userId, mission.id);
    for (const key of ["workState", "schemaVersion", "missionId", "projectId", "missionVersion", "missionStatus", "observedAt", "missionUpdatedAt", "materialUses", "evidenceReviews", "reviewProgress", "callCoverage", "resourceUsage", "sourceConversation", "selected", "adoptions", "actionReceipts", "realityOutcome"] as const)
      expect(Object.prototype.hasOwnProperty.call(back, key)).toBe(true);
    expect(back.schemaVersion).toBe(1);
    expect(back.realityOutcome).toBe("NOT_INFERRED");
    expect(back.resourceUsage.pricingState).toBe("UNPRICED");
    expect(back.readAt).toBe(back.observedAt);
    expect(Array.isArray(back.adoptions)).toBe(true);
    expect(Array.isArray(back.actionReceipts)).toBe(true);
    // 旧后端没有 workPacket 时客户端可退回原详情：类型上可缺省，缺失不构造成功事实。
    expectTypeOf<MissionReadback["workPacket"]>().toEqualTypeOf<WorkPacket | undefined>();
    const legacyView: WorkPacketOptionalDelta = {};
    expect(legacyView.workPacket).toBeUndefined();
    const { workPacket: _packet, readAt: _readAt, observation: _observation, ...withoutDelta } = back;
    expect(withoutDelta.workState).toEqual(back.workState);
    expect(withoutDelta.missionVersion).toBe(back.missionVersion);
  });

  it("真实 null 与未知枚举不崩溃：不补零、不把缺失当允许、不把未找到当从未发生", async () => {
    const owner = await ownerProject("nulls-and-unknown");
    const mission = await createMissionRow(owner, { status: "FUTURE_STATUS_NOT_IN_ENUM" });
    await addEvent(mission.id, "FUTURE_EVENT_TYPE", { payload: "synthetic" });
    const back = await readMissionBack(owner.userId, mission.id);
    expect(back.missionStatus).toBe("FUTURE_STATUS_NOT_IN_ENUM");
    expect(back.workState.phase).toBe("UNKNOWN");
    const workPacket = packet(back);
    expect(workPacket.identity.missionStatus).toBe("FUTURE_STATUS_NOT_IN_ENUM");
    expect(workPacket.next.primaryAction).toMatchObject({ kind: "RECHECK_AUTHORITY" });
    // budgetUsedJson 缺失 → 用量未知，不补 0。
    expect(back.resourceUsage.models).toBeNull();
    expect(workPacket.authority.budget.cumulativeUsed).toMatchObject({ models: null, tools: null, inputTokens: null, outputTokens: null, unknownCalls: null });
    // 四个观察时间字段显式输出真实 null，且 JSON 序列化后仍保留键。
    const serialized = JSON.parse(JSON.stringify(back));
    for (const key of ["lastSuccessfulAt", "lastFailedAt", "lastNoNewInformationAt", "nextCheckAt"]) {
      expect(Object.prototype.hasOwnProperty.call(serialized.workPacket.observations, key)).toBe(true);
      expect(serialized.workPacket.observations[key]).toBeNull();
    }
    expect(serialized.workState.observedAt).toBeNull();
    expect(serialized.workState.unsettledEffect).toMatchObject({ present: false, code: null, source: "NONE" });
    expect(serialized.missionUpdatedAt).toBe(back.missionUpdatedAt);
    // 覆盖说明保留“未找到 ≠ 从未发生”。
    expect(workPacket.coverage.policy).toBe("NOT_FOUND_IS_NOT_NEVER");
    expect(workPacket.coverage.windows.every(window => typeof window.note === "string" && window.note.length > 0)).toBe(true);
  });
});

describe("A2 负例：原 owner/项目/目标绑定语义不回归", () => {
  it("异 Owner、非 Owner 成员、匿名与跨项目来源均拒绝", async () => {
    const owner = await ownerProject("negative-owner");
    const other = await ownerProject("negative-other");
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT", waitStateJson: { questionId: "q-negative", question: "原问题", waitingFor: "USER", resigned: false } });
    await addEvent(mission.id, "QUESTION", { question: "原问题" });
    await expect(readMissionBack(other.userId, mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    const member = await db.user.create({ data: { username: `final-a-member-${crypto.randomUUID()}`, displayName: "非 Owner 成员", passwordHash: "unused" } });
    await db.projectMembership.create({ data: { projectId: owner.projectId, userId: member.id, role: "MEMBER" } });
    await expect(readMissionBack(member.id, mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    await expect(readMissionBack("", mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    const foreignCapture = await db.capture.create({ data: { projectId: other.projectId, rawText: "别的项目资料" } });
    await expect(readMissionBack(owner.userId, mission.id, { sourceId: `capture:${foreignCapture.id}` })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND", status: 404 });
  });

  it("原问题/提案/成果/回执目标不匹配维持原 404/409 语义", async () => {
    const owner = await ownerProject("negative-targets");
    const mission = await createMissionRow(owner, { status: "WAITING_APPROVAL" });
    await expect(readMissionBack(owner.userId, mission.id, { questionId: "missing-question" })).rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });
    await expect(readMissionBack(owner.userId, mission.id, { approvalId: "missing-approval" })).rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });
    await expect(readMissionBack(owner.userId, mission.id, { revision: 99 })).rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });
    await expect(readMissionBack(owner.userId, mission.id, { receiptId: "missing-receipt" })).rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });
    const output = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "RESEARCH", contentJson: json({ blocks: [] }), sourceRefsJson: json([]), claimChecksJson: json([]) } });
    const otherOutput = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 2, kind: "RESEARCH", contentJson: json({ blocks: [] }), sourceRefsJson: json([]), claimChecksJson: json([]) } });
    const artifact = await db.generatedArtifact.create({ data: { projectId: owner.projectId, artifactType: "weekly_report", content: "合成成果", sourceRefs: json({ sources: [] }) } });
    const receipt = await db.missionArtifactReceipt.create({ data: { projectId: owner.projectId, missionId: mission.id, outputId: output.id, outputRevision: output.revision,
      outputHash: "c".repeat(64), artifactId: artifact.id, artifactType: "weekly_report", sourceManifestJson: json({ sources: [] }), blockMapJson: json({}), verificationSnapshotJson: json({}), createdByUserId: owner.userId, requestId: "receipt", payloadHash: "d".repeat(64) } });
    await expect(readMissionBack(owner.userId, mission.id, { outputId: otherOutput.id, receiptId: receipt.id })).rejects.toMatchObject({ code: "MISSION_TARGET_MISMATCH", status: 409 });
    const withReceipt = await readMissionBack(owner.userId, mission.id, { outputId: output.id, receiptId: receipt.id });
    expect(withReceipt.selected.output?.id).toBe(output.id);
    expect(withReceipt.selected.receipt).toMatchObject({ id: receipt.id, artifactId: artifact.id, outputRevision: output.revision });
  });
});

describe("A2 FS-A03/04/05/06/07 服务修复", () => {
  it("FS-A03：detail/summary/readback 对额度等待一致解释，累计预算不清零", async () => {
    const owner = await ownerProject("fs-a03");
    const nextAttemptAt = new Date(Date.now() + 3_600_000);
    const used = { models: 4, tools: 3, inputTokens: 40, outputTokens: 16, unknownCalls: 2 };
    const mission = await createMissionRow(owner, { status: "READY", nextAttemptAt, budgetUsedJson: used });
    await addEvent(mission.id, "DAILY_BUDGET_WAITING", { nextAttemptAt: nextAttemptAt.toISOString(), budgetRetained: true });
    const detail = await missionDetail(owner.userId, mission.id);
    const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
    const back = await readMissionBack(owner.userId, mission.id);
    expect(detail.workState).toMatchObject({ phase: "QUEUED", reasonCode: "DAILY_BUDGET_WAITING", nextCheckAt: nextAttemptAt.toISOString() });
    const summaryItem = summary.items.find(item => item.id === mission.id);
    expect(summaryItem?.workState).toMatchObject({ phase: "QUEUED", reasonCode: "DAILY_BUDGET_WAITING", nextCheckAt: nextAttemptAt.toISOString() });
    expect(back.workState).toMatchObject({ phase: "QUEUED", reasonCode: "DAILY_BUDGET_WAITING", nextCheckAt: nextAttemptAt.toISOString() });
    expect(back.workPacket!.next.nextCheckAt).toBe(nextAttemptAt.toISOString());
    expect(back.workPacket!.next.waitingOn).toBe("BUDGET_RESET");
    // 三处都不清零、不凭日期放行；读回本身不改预算与版本。
    expect(back.workPacket!.authority.budget.cumulativeUsed).toMatchObject({ models: 4, tools: 3, inputTokens: 40, outputTokens: 16, unknownCalls: 2 });
    expect(detail.used).toEqual(used);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(current.budgetUsedJson).toEqual(used);
    expect(current.nextAttemptAt).toEqual(nextAttemptAt);
  });

  it("FS-A04：反复读取只推进 readAt，不推进成功观察时间；失败观察不得显示无变化", async () => {
    const owner = await ownerProject("fs-a04");
    const observedAt = new Date(Date.now() - 120_000);
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      planJson: { delegation: { lastObservedAt: observedAt.toISOString() } },
      continuationPolicyJson: boundedPolicy(new Date(Date.now() + 3_600_000)),
      waitStateJson: { questionId: "q-observed", resolved: true, waitingFor: "OBSERVATION" } });
    await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
    const first = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(first.workState.observedAt).toBe(observedAt.toISOString());
    expect(second.workState.observedAt).toBe(observedAt.toISOString());
    expect(first.workPacket!.observations.lastSuccessfulAt).toBe(observedAt.toISOString());
    expect(second.workPacket!.observations.lastSuccessfulAt).toBe(observedAt.toISOString());
    expect(Date.parse(second.readAt)).toBeGreaterThan(Date.parse(first.readAt));
    expect(second.workPacket!.observations.state).toBe("OBSERVED");
    // 失败晚于成功观察：不得显示“无变化”。
    const failedAt = new Date(Date.now() - 1_000);
    await addEvent(mission.id, "EXECUTION_STOPPED", { code: "TOOL_FAILED" }, failedAt);
    const failed = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(failed.workPacket!.observations.state).toBe("FAILED_LAST");
    expect(failed.workPacket!.observations.lastFailedAt).toBe(failedAt.toISOString());
    expect(failed.workPacket!.observations.lastSuccessfulAt).toBe(observedAt.toISOString());
    expect(failed.workPacket!.next.note).toContain("观察失败");
    expect(failed.workPacket!.next.note).not.toContain("无新变化");
    expect(failed.workPacket!.done.note).not.toContain("无新变化");
  });

  it("FS-A05：SUPPRESS_USE 后当前使用 SUPPRESSED、历史 facts 保留、不称独立证据", async () => {
    const owner = await ownerProject("fs-a05");
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      waitStateJson: { questionId: "q-suppress", question: "请补充 10 月推理显存", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
    const material = await bindMaterial(owner, mission.id, "q-suppress");
    const before = await readMissionBack(owner.userId, mission.id);
    const beforeItem = before.materialUses.items.find(item => item.sourcePointer.id === material.pointer.id)!;
    expect(beforeItem).toMatchObject({ availability: "CURRENT", availabilityMeaning: "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION" });
    expect(beforeItem.currentUse).toMatchObject({ state: "ALLOWED", policy: "SOURCE_POLICY_V1", appliesTo: "CURRENT_USE_ONLY" });
    expect(beforeItem.facts.map(fact => fact.kind)).toEqual(expect.arrayContaining(["SAVED", "CANDIDATE", "BOUND"]));
    expect(before.workPacket!.basis.currentUsePolicy).toBe("SOURCE_POLICY_APPLIED");
    expect(before.workPacket!.next.primaryAction!.requires.requiredSourceRevisions).toEqual([`${material.pointer.id}@${material.pointer.hash}`]);
    const beforeControlVersion = before.workPacket!.identity.controlVersion;
    // 真实用户指令路径：mission 范围 USE_SUPPRESSION。
    const session = await createSession(owner.userId);
    const actor = { userId: owner.userId, sessionId: session.session.id };
    const conversation = await createConversation(actor, { requestId: "conversation-suppress", scope: "PROJECT", projectId: owner.projectId });
    await submitDirective(actor, conversation.id, { commandId: "suppress-use", expectedSeq: 0, scope: { projectId: owner.projectId, missionId: mission.id }, operation: "SUPPRESS_USE", sourceIds: [material.pointer.id] });
    const after = await readMissionBack(owner.userId, mission.id);
    const afterItem = after.materialUses.items.find(item => item.sourcePointer.id === material.pointer.id)!;
    expect(afterItem.currentUse).toMatchObject({ state: "SUPPRESSED", independentEvidence: false, reason: expect.any(String) });
    expect(afterItem.facts).toEqual(beforeItem.facts);
    expect(afterItem.availability).toBe(beforeItem.availability);
    expect(after.workPacket!.blockers.some(blocker => blocker.code === "CURRENT_USE_SUPPRESSED" && blocker.blocksActions)).toBe(true);
    expect(after.workPacket!.next.primaryAction!.requires.requiredSourceRevisions).toEqual([]);
    expect(after.workPacket!.identity.controlVersion).not.toBe(beforeControlVersion);
    // 来源链未知：指针指向已不存在材料 → UNKNOWN，仍不得称独立证据。
    const ghostOwner = owner;
    const ghostMission = await createMissionRow(ghostOwner, { status: "WAITING_INPUT",
      waitStateJson: { questionId: "q-ghost", question: "请补充另一份记录", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
    const ghostPointer = { id: "capture:deleted-source", hash: "a".repeat(64) };
    await addEvent(ghostMission.id, "SOURCE_ARRIVED", { questionId: "q-ghost", sourcePointer: ghostPointer, readable: true });
    const ghost = await readMissionBack(ghostOwner.userId, ghostMission.id);
    const ghostItem = ghost.materialUses.items.find(item => item.sourcePointer.id === ghostPointer.id)!;
    expect(ghostItem.currentUse).toMatchObject({ state: "UNKNOWN", independentEvidence: false });
    expect(ghostItem.facts.map(fact => fact.kind)).toEqual(["CANDIDATE"]);
    expect(ghost.workPacket!.blockers.some(blocker => blocker.code === "CURRENT_USE_UNKNOWN")).toBe(true);
  });

  it("FS-A05/FS-A07：许可变化但 mission.version 未变时，工作包仍要求重核并携带 controlVersion/来源修订", async () => {
    const owner = await ownerProject("fs-a05-control-version");
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      waitStateJson: { questionId: "q-control", question: "请补充控制实验", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
    const material = await bindMaterial(owner, mission.id, "q-control", "控制实验记录：同一批样本");
    const before = await readMissionBack(owner.userId, mission.id);
    const beforeMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    // 直接持久化一条 mission 级 USE_SUPPRESSION 控制事实（不经过会顺带推进 Mission 版本的失效联动），
    // 用来复现“许可已变、mission.version 未变”的读取窗口。
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    await db.agentDirectiveEvent.create({ data: {
      ownerUserId: owner.userId, seq: user.continuitySeq + 1, commandId: `suppress-${crypto.randomUUID()}`, eventIndex: 0,
      inputHash: "e".repeat(64), directiveId: crypto.randomUUID(), projectId: owner.projectId, missionId: mission.id,
      kind: "USE_SUPPRESSION", operation: "SET", quote: "停止使用这条资料",
      sourceJson: json({ origin: "A2_SERVICE_TEST" }), admissionJson: json({ status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION" }),
      sourceIdsJson: json([material.pointer.id]), validFrom: new Date(), timezone: "Asia/Shanghai",
    } });
    await db.user.update({ where: { id: owner.userId }, data: { continuitySeq: { increment: 1 } } });
    const after = await readMissionBack(owner.userId, mission.id);
    const afterMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(afterMission.version).toBe(beforeMission.version);
    expect(afterMission.status).toBe(beforeMission.status);
    expect(after.missionVersion).toBe(before.missionVersion);
    expect(after.workPacket!.identity.controlVersion).not.toBe(before.workPacket!.identity.controlVersion);
    expect(after.materialUses.items.find(item => item.sourcePointer.id === material.pointer.id)!.currentUse).toMatchObject({ state: "SUPPRESSED", independentEvidence: false });
    expect(after.workPacket!.blockers.some(blocker => blocker.code === "CURRENT_USE_SUPPRESSED")).toBe(true);
    expect(after.workPacket!.next.primaryAction!.requires.controlVersion).toBe(after.workPacket!.identity.controlVersion);
    expect(after.workPacket!.next.primaryAction!.requires.requiredSourceRevisions).toEqual([]);
    // 版本复查只覆盖 Mission 版本字段（这里确实稳定），许可守卫由 requires.controlVersion + 提交时服务端复查承担。
    expect(after.workPacket!.snapshot.consistency).toBe("VERSION_STABLE");
  });

  it("FS-A06：项目内 45 条无关 CHAT 运行不能挤掉本委托窗口；本委托超过窗口时明确截断", async () => {
    const owner = await ownerProject("fs-a06");
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      waitStateJson: { questionId: "q-runs", question: "请补充运行记录", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
    const material = await bindMaterial(owner, mission.id, "q-runs");
    await db.agentRun.create({ data: { projectId: owner.projectId, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      trace: json({ missionId: mission.id, contextManifest: { sourcePointers: [material.pointer], includedStepIds: [material.step.id] } }) } });
    const base = Date.now();
    for (let index = 0; index < 45; index++) await db.agentRun.create({ data: { projectId: owner.projectId, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      createdAt: new Date(base + 10_000 + index), trace: json({ purpose: "DYNAMIC_PLAN_REVIEW", reviewProposalId: `p-${index}` }) } });
    const squeezed = await readMissionBack(owner.userId, mission.id);
    const squeezedItem = squeezed.materialUses.items.find(item => item.sourcePointer.id === material.pointer.id)!;
    expect(squeezedItem.facts.map(fact => fact.kind)).toContain("CONTEXT_POINTER");
    expect(squeezed.materialUses.coverage).toMatchObject({ runScope: "MISSION_FILTERED", runsTruncated: false, runsInspected: 1 });
    expect(squeezed.callCoverage).toMatchObject({ runScope: "MISSION_FILTERED", inspected: { truncated: false }, models: { total: 1 } });
    // 本委托自己的调用超过 40/20 条窗口时才截断，并且保留“未找到≠从未发生”的说明。
    for (let index = 0; index < 45; index++) await db.agentRun.create({ data: { projectId: owner.projectId, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      createdAt: new Date(base + 20_000 + index), trace: json({ missionId: mission.id, usage: { inputTokens: 1, outputTokens: 1 } }) } });
    const bounded = await readMissionBack(owner.userId, mission.id);
    expect(bounded.materialUses.coverage).toMatchObject({ runScope: "MISSION_FILTERED", runsTruncated: true, runsInspected: 40 });
    expect(bounded.callCoverage.inspected.truncated).toBe(true);
    expect(bounded.callCoverage.models.total).toBe(20);
    const runWindow = bounded.workPacket!.coverage.windows.find(window => window.name === "MATERIAL_MISSION_RUNS")!;
    expect(runWindow).toMatchObject({ truncated: true, limit: 40 });
    expect(runWindow.note).toContain("未找到不等于从未使用");
    const callWindow = bounded.workPacket!.coverage.windows.find(window => window.name === "MISSION_MODEL_RUNS")!;
    expect(callWindow.truncated).toBe(true);
  });

  it("FS-A07：无新事件但越过许可/期限/审批边界时权限 EXPIRED、主操作变重核", async () => {
    const owner = await ownerProject("fs-a07-boundary");
    const expiresAt = new Date(Date.now() + 1_500);
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      planJson: { delegation: { lastObservedAt: new Date(Date.now() - 60_000).toISOString() } },
      continuationPolicyJson: boundedPolicy(expiresAt),
      waitStateJson: { questionId: "q-boundary", resolved: true, waitingFor: "OBSERVATION" } });
    await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
    const eventCount = await db.agentMissionEvent.count({ where: { missionId: mission.id } });
    const within = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(within.workState.phase).toBe("WAITING_OBSERVATION");
    expect(within.workPacket!.authority.permissionState).toBe("WITHIN_TIME_BOUNDARY");
    expect(within.workPacket!.next.primaryAction!.kind).toBe("WAIT_FOR_OBSERVATION");
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const crossed = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(crossed.workPacket!.authority.permissionState).toBe("EXPIRED");
    expect(crossed.workState).toMatchObject({ phase: "PAUSED", reasonCode: "DELEGATION_EXPIRED" });
    expect(crossed.workPacket!.next.primaryAction!.kind).toBe("RECHECK_AUTHORITY");
    expect(crossed.workPacket!.blockers.some(blocker => blocker.kind === "AUTHORITY" && blocker.code === "PERMISSION_EXPIRED")).toBe(true);
    expect(crossed.workPacket!.next.primaryAction!.requires.boundaryAt).toBe(expiresAt.toISOString());
    // 没有新增事件，也不是靠客户端时间：同一请求内服务端读取时刻重新判定。
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id } })).toBe(eventCount);
    expect(crossed.missionVersion).toBe(within.missionVersion);

    // 原期限越界：不新增事件也必须重核。
    const deadlineOwner = await ownerProject("fs-a07-deadline");
    const deadline = await createMissionRow(deadlineOwner, { status: "READY", constraintsJson: { deadline: new Date(Date.now() - 60_000).toISOString() } });
    const deadlineBack = await readMissionBack(deadlineOwner.userId, deadline.id);
    expect(deadlineBack.workPacket!.next.primaryAction!.kind).toBe("RECHECK_AUTHORITY");
    expect(deadlineBack.workPacket!.blockers.some(blocker => blocker.code === "DEADLINE_PASSED" && blocker.blocksActions)).toBe(true);

    // 原审批到期：跨过 expiresAt 后旧批准不再生成审阅动作。
    const approvalOwner = await ownerProject("fs-a07-approval");
    const approvalMission = await createMissionRow(approvalOwner, { status: "WAITING_APPROVAL" });
    const step = await db.agentMissionStep.create({ data: { missionId: approvalMission.id, ordinal: 1, planRevision: approvalMission.planRevision,
      toolName: "propose_action", toolVersion: "1", canonicalInputJson: json({}), inputHash: "approval-boundary", readSetJson: json([]), status: "WAITING_APPROVAL" } });
    await db.agentMissionApproval.create({ data: { missionId: approvalMission.id, stepId: step.id, proposalHash: "f".repeat(64),
      proposalJson: json({ tool: "create_action", args: { title: "边界提案" } }), expectedPlanRevision: approvalMission.planRevision,
      readSetJson: json([]), status: "PENDING", expiresAt: new Date(Date.now() + 1_500) } });
    const approvalWithin = await readMissionBack(approvalOwner.userId, approvalMission.id);
    expect(approvalWithin.workPacket!.next.primaryAction!.kind).toBe("REVIEW_APPROVAL");
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const approvalCrossed = await readMissionBack(approvalOwner.userId, approvalMission.id);
    expect(approvalCrossed.workState.reasonCode).toBe("APPROVAL_EXPIRED");
    expect(approvalCrossed.workPacket!.next.primaryAction!.kind).toBe("RECHECK_AUTHORITY");
    expect(approvalCrossed.workPacket!.blockers.some(blocker => blocker.code === "APPROVAL_EXPIRED" && blocker.blocksActions)).toBe(true);
  });

  it("GET 前后无业务写入：版本/状态/预算/事件/运行/步骤/草稿/回执/控制序号全不变", async () => {
    const owner = await ownerProject("no-side-effects");
    const nextAttemptAt = new Date(Date.now() + 3_600_000);
    const used = { models: 2, tools: 1, inputTokens: 20, outputTokens: 8, unknownCalls: 1 };
    const mission = await createMissionRow(owner, { status: "READY", nextAttemptAt, budgetUsedJson: used });
    await addEvent(mission.id, "QUESTION", { question: "旧的已解决问句" });
    await addEvent(mission.id, "DAILY_BUDGET_WAITING", { nextAttemptAt: nextAttemptAt.toISOString(), budgetRetained: true });
    await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "RESEARCH", contentJson: json({ blocks: [] }), sourceRefsJson: json([]), claimChecksJson: json([]) } });
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    const counts = {
      events: await db.agentMissionEvent.count({ where: { missionId: mission.id } }),
      runs: await db.agentRun.count(),
      outputs: await db.agentMissionOutput.count({ where: { missionId: mission.id } }),
      receipts: await db.missionArtifactReceipt.count({ where: { missionId: mission.id } }),
      steps: await db.agentMissionStep.count({ where: { missionId: mission.id } }),
      directives: await db.agentDirectiveEvent.count({ where: { ownerUserId: owner.userId } }),
    };
    await readMissionBack(owner.userId, mission.id);
    await readMissionBack(owner.userId, mission.id);
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    const afterUser = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    for (const key of ["version", "status", "planRevision", "contextVersion", "constraintsVersion", "researchScopeVersion", "nextAttemptAt", "updatedAt", "budgetUsedJson", "lastErrorJson", "waitStateJson"] as const)
      expect(after[key as keyof typeof after]).toEqual(before[key as keyof typeof before]);
    expect(afterUser.continuitySeq).toBe(beforeUser.continuitySeq);
    expect({
      events: await db.agentMissionEvent.count({ where: { missionId: mission.id } }),
      runs: await db.agentRun.count(),
      outputs: await db.agentMissionOutput.count({ where: { missionId: mission.id } }),
      receipts: await db.missionArtifactReceipt.count({ where: { missionId: mission.id } }),
      steps: await db.agentMissionStep.count({ where: { missionId: mission.id } }),
      directives: await db.agentDirectiveEvent.count({ where: { ownerUserId: owner.userId } }),
    }).toEqual(counts);
  });

  it("FS-A07：个人记忆边界越过参与重核与 TIME_BOUNDARY 阻断（A1-fix b243f62）", async () => {
    const owner = await ownerProject("fs-a07-personal-memory");
    const memoryExpiresAt = new Date(Date.now() - 60_000);
    const mission = await createMissionRow(owner, { status: "WAITING_INPUT",
      planJson: { delegation: { lastObservedAt: new Date(Date.now() - 120_000).toISOString() } },
      continuationPolicyJson: boundedPolicy(new Date(Date.now() + 3_600_000)),
      waitStateJson: { questionId: "q-personal", resolved: true, waitingFor: "OBSERVATION" } });
    await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
    const claim = await db.agentClaim.create({ data: {
      ownerUserId: owner.userId, scopeType: "ACCOUNT", scopeKey: `acct-${crypto.randomUUID()}`, originKey: `origin-${crypto.randomUUID()}`,
      originJson: json({ kind: "MESSAGE", id: crypto.randomUUID() }), kind: "PREFERENCE", canonicalStatement: "用户偏好：先给结论",
      conditionsJson: json({ expiresAt: memoryExpiresAt.toISOString() }), statusProjection: "ACTIVE",
    } });
    await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 2, planRevision: mission.planRevision,
      toolName: "search_memory", toolVersion: "1", canonicalInputJson: json({}), inputHash: "personal-memory-read", readSetJson: json([]),
      status: "SUCCEEDED", protocolJson: json({ personalMemoryReadSet: { items: [{ claimId: claim.id }] } }) } });
    const back = await withDelegation(() => readMissionBack(owner.userId, mission.id));
    expect(back.workState.phase).toBe("WAITING_OBSERVATION");
    expect(back.workPacket!.authority.nextBoundary).toBe(memoryExpiresAt.toISOString());
    expect(back.workPacket!.next.primaryAction!.kind).toBe("RECHECK_AUTHORITY");
    expect(back.workPacket!.blockers.some(blocker => blocker.kind === "TIME_BOUNDARY" && blocker.code === "PERSONAL_MEMORY_BOUNDARY_PASSED" && blocker.blocksActions)).toBe(true);
    expect(back.workPacket!.next.primaryAction!.requires.boundaryAt).toBe(memoryExpiresAt.toISOString());
    expect(back.observation.state).toBe("OBSERVED");
  });

  it("A1-RESIDUAL-01：停止请求在途时 Focus 摘要/详情/读回一致，且不建议继续或恢复", async () => {
    for (const request of ["pause", "cancel"] as const) {
      const owner = await ownerProject(`stop-request-summary-${request}`);
      const requestedAt = new Date(Date.now() - 5_000);
      const mission = await createMissionRow(owner, { status: "RUNNING", leaseUntil: new Date(Date.now() + 60_000),
        ...(request === "pause" ? { pauseRequestedAt: requestedAt } : { cancelRequestedAt: requestedAt }) });
      const expectedState = request === "pause" ? "PAUSE_REQUESTED" : "CANCEL_REQUESTED";
      // Focus/工作台摘要：select 必须带上 stop 请求字段，否则会退回 LEASE_ACTIVE。
      const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
      const item = summary.items.find(candidate => candidate.id === mission.id);
      expect(item).toBeDefined();
      const summaryState = item!.workState;
      expect(summaryState).toBeDefined();
      expect(summaryState).toMatchObject({ phase: "RUNNING", nextActor: "SYSTEM", reasonCode: "STOP_REQUESTED_IN_FLIGHT" });
      expect(summaryState!.stopRequest).toMatchObject({ state: expectedState, settled: false, requestedAt: requestedAt.toISOString() });
      expect(summaryState!.actionLabel).toContain("核对停止结算");
      expect(summaryState!.actionLabel).not.toMatch(/继续|恢复/);
      expect(summaryState!.reasonText).not.toMatch(/请继续|可以继续|建议继续|请恢复|可以恢复|建议恢复/);
      // 详情与读回同一解释。
      const detail = await missionDetail(owner.userId, mission.id);
      expect(detail.workState).toMatchObject({ phase: "RUNNING", reasonCode: "STOP_REQUESTED_IN_FLIGHT", stopRequest: { state: expectedState, settled: false } });
      const back = await readMissionBack(owner.userId, mission.id);
      expect(back.workState).toMatchObject({ phase: "RUNNING", reasonCode: "STOP_REQUESTED_IN_FLIGHT", stopRequest: { state: expectedState, settled: false } });
      expect(back.workPacket!.stopped.stopRequest).toMatchObject({ state: expectedState, settled: false });
      expect(back.workPacket!.next.primaryAction).toMatchObject({ kind: "CHECK_STOP_SETTLEMENT", label: "核对停止结算" });
      expect(back.workPacket!.next.primaryAction!.label).not.toMatch(/继续|恢复/);
    }
  });
});


