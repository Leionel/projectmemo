import { describe, expect, it } from "vitest";
import { buildMissionWorkPacket, type WorkPacketInput } from "@/lib/mission/workPacket";
import { missionWorkState } from "@/lib/mission/workState";
import { reviewProgressOf } from "@/lib/mission/reviewProgress";
import type {
  WorkPacket,
  WorkPacketMaterialUseItem,
  WorkPacketMaterialUses,
} from "@/lib/types/workPacket";

/**
 * A1 四问工作包冻结 DTO/纯构造器合同测试。
 * 不连数据库、不调模型、不使用真实时间；输入为已收集事实，now 显式传入。
 * 覆盖冲突组合与负例：终态×UNKNOWN、停止在途、过期批准、额度等待、时间跨界、
 * 观察失败/来源不可用、乱序阻断、旧 WorkState/旧后端缺字段。
 */

const NOW = new Date("2026-11-03T04:00:00.000Z");
const LATER = new Date(+NOW + 3 * 60 * 60 * 1000);
const POLICY_EXPIRES = "2026-11-07T00:00:00.000Z";
const HASH = "a".repeat(64);

const missionFacts = {
  missionId: "m-1",
  projectId: "p-1",
  missionVersion: 9,
  missionStatus: "WAITING_INPUT",
  planRevision: 4,
  contextVersion: 5,
  constraintsVersion: 2,
  researchScopeVersion: 3,
};
const wsBase = { id: missionFacts.missionId, version: missionFacts.missionVersion };
const project = (extra: { status: string } & Record<string, unknown>, at: Date = NOW) => missionWorkState({ ...wsBase, ...extra }, at);
const observationState = () => project({
  status: "WAITING_INPUT",
  waitStateJson: { waitingFor: "OBSERVATION" },
  planJson: { delegation: { lastObservedAt: "2026-11-02T00:00:00.000Z" } },
  continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: POLICY_EXPIRES },
});

const materialItem = (overrides: Partial<WorkPacketMaterialUseItem> & { id: string }): WorkPacketMaterialUseItem => ({
  sourcePointer: { id: overrides.id, hash: HASH },
  title: "项目记录",
  availability: "CURRENT",
  facts: [{ kind: "SAVED", refId: overrides.id }],
  coverage: null,
  bodyCoverage: "NOT_RECORDED",
  excerpt: "原摘录",
  ...overrides,
});
const materialUsesFixture = (items: WorkPacketMaterialUseItem[]): WorkPacketMaterialUses => ({
  schemaVersion: 1,
  questionId: "q-1",
  items,
  // 覆盖字段来自原 MaterialUseProjection；本测试只需 sourceLimit/sourceLimitReached 语义，
  // 用最小 fixture 构造，避免与 A2 服务层并行的窗口字段演进耦合。
  coverage: {
    eventLimit: 80, eventsTruncated: false, stepLimit: 40, stepsTruncated: false,
    outputLimit: 20, outputsTruncated: false, receiptsTruncated: false,
    projectRunLimit: 40, runsTruncated: false, sourceLimit: 8, sourceLimitReached: false,
    mapping: "DIRECT_SOURCE_POINTERS_ONLY",
  } as unknown as WorkPacketMaterialUses["coverage"],
});
const currentAllowed = {
  state: "ALLOWED" as const, independentEvidence: false, reason: "ORIGINAL_OBSERVATION",
  policy: "SOURCE_POLICY_APPLIED", checkedAt: NOW.toISOString(), appliesTo: "CURRENT_USE_ONLY" as const,
};
const evidenceReviewsFixture = {
  items: [{ eventId: "ev-1", observedAt: "2026-11-02T00:00:00.000Z", fitHash: "fit-hash", fitStatus: "FIT", ruleVersion: "1", truthVerified: false as const }],
  truncated: false,
};
const stepsFixture = Array.from({ length: 7 }, (_, index) => ({
  id: `step-${index + 1}`, ordinal: index + 1, toolName: "search_project_memory",
  status: "SUCCEEDED", at: "2026-11-02T00:00:00.000Z", note: "原工具步骤",
}));
const receiptsFixture = [
  { actionId: "act-1", title: "补充对照组", status: "DONE", resultCardId: "card-1", completedAt: "2026-11-01T00:00:00.000Z", isSimulated: false },
  { actionId: "act-2", title: "演示行动", status: "DONE", resultCardId: null, completedAt: "2026-11-02T00:00:00.000Z", isSimulated: true },
];

const baseInput = (overrides: Partial<WorkPacketInput> = {}): WorkPacketInput => ({
  mission: { ...missionFacts },
  workState: observationState(),
  responsibility: {
    controlVersion: "control-hash-1",
    permissionState: "WITHIN_TIME_BOUNDARY",
    permissionExpiresAt: "2026-11-05T00:00:00.000Z",
    deadline: "2026-11-06T00:00:00.000Z",
    workerPresence: "RECENT",
    effectiveNextCheckAt: "2026-11-04T00:00:00.000Z",
    personalMemoryNextBoundary: "2026-11-03T12:00:00.000Z",
    budget: {
      limits: { models: 10, tools: 20, metadataRequests: 24 },
      cumulativeUsed: { models: 3, tools: 5, metadataRequests: null },
      policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
      monetaryCost: null,
    },
  },
  observations: {
    lastSuccessfulAt: "2026-11-02T00:00:00.000Z",
    lastFailedAt: null,
    lastNoNewInformationAt: "2026-11-02T00:00:00.000Z",
    nextCheckAt: "2026-11-04T00:00:00.000Z",
  },
  work: {
    steps: stepsFixture, stepsLimit: 5,
    latestOutput: { id: "out-1", revision: 3, createdAt: "2026-11-02T01:00:00.000Z" },
    actionReceipts: receiptsFixture,
    progress: reviewProgressOf({ steps: [], outputs: [], actions: [] }),
  },
  basis: {
    questionId: "q-1",
    materialUses: materialUsesFixture([materialItem({ id: "capture:c-1", currentUse: currentAllowed })]),
    evidenceReviews: evidenceReviewsFixture,
    currentUsePolicy: "SOURCE_POLICY_APPLIED",
  },
  coverage: { windows: [{ name: "RECENT_STEPS", limit: 5, returned: 7, truncated: true }, { name: "MATERIAL_USES", limit: 8, returned: 1, truncated: false }] },
  snapshot: { consistency: "VERSION_STABLE", retries: 0, checkedAt: NOW.toISOString() },
  ...overrides,
});
const build = (overrides: Partial<WorkPacketInput> = {}, at: Date = NOW) => buildMissionWorkPacket(baseInput(overrides), at);

describe("四问结构完整性", () => {
  it("identity/snapshot/authority/observations/done/basis/stopped/next/blockers/coverage 全部有值", () => {
    const packet = build();
    expect(Object.keys(packet).sort()).toEqual([
      "authority", "basis", "blockers", "contractVersion", "coverage", "done", "identity",
      "next", "observations", "readAt", "realityOutcome", "schemaVersion", "snapshot", "stopped",
    ]);
    expect(packet.contractVersion).toBe("final-a-workpacket-v1");
    expect(packet.schemaVersion).toBe(1);
    expect(packet.readAt).toBe(NOW.toISOString());
    expect(packet.realityOutcome).toBe("NOT_INFERRED");
    expect(packet.identity).toEqual({
      ...missionFacts, controlVersion: "control-hash-1",
      originalRef: { kind: "MISSION", id: "m-1", version: 9 },
    });
    expect(packet.snapshot).toMatchObject({ mode: "SINGLE_READ_TRANSACTION", consistency: "VERSION_STABLE", retries: 0, checkedAt: NOW.toISOString() });
    expect(packet.authority).toEqual({
      controlVersion: "control-hash-1",
      permissionState: "WITHIN_TIME_BOUNDARY",
      permissionExpiresAt: "2026-11-05T00:00:00.000Z",
      deadline: "2026-11-06T00:00:00.000Z",
      nextBoundary: "2026-11-03T12:00:00.000Z",
      effectiveNextCheckAt: "2026-11-04T00:00:00.000Z",
      workerPresence: "RECENT",
      budget: {
        limits: { models: 10, tools: 20, metadataRequests: 24 },
        cumulativeUsed: { models: 3, tools: 5, metadataRequests: null },
        policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
        monetaryCost: null,
      },
      note: "VIEW_ONLY_NO_EXECUTION_PERMISSION",
    });
    expect(packet.observations).toMatchObject({
      readAt: NOW.toISOString(), state: "OBSERVED",
      lastSuccessfulAt: "2026-11-02T00:00:00.000Z", lastFailedAt: null,
      lastNoNewInformationAt: "2026-11-02T00:00:00.000Z",
      nextCheckAt: "2026-11-04T00:00:00.000Z", authority: "ORIGINAL_DELEGATION_RECORDS_ONLY",
    });
    expect(packet.done.recentSteps.map(step => step.ordinal)).toEqual([7, 6, 5, 4, 3]);
    expect(packet.done.coverage).toEqual({ limit: 5, truncated: true });
    expect(packet.done.recentSteps[0]).toMatchObject({ id: "step-7", toolName: "search_project_memory", status: "SUCCEEDED" });
    expect(packet.done.latestOutput).toEqual({ id: "out-1", revision: 3, createdAt: "2026-11-02T01:00:00.000Z" });
    expect(packet.done.actionReceipts.map(receipt => receipt.actionId)).toEqual(["act-2", "act-1"]);
    expect(packet.done.actionReceipts[0].isSimulated).toBe(true);
    expect(packet.done.progress?.policy).toBe("PROJECTION_FROM_EXISTING_STEPS_OUTPUTS_ACTIONS_RECEIPTS_NOT_REALITY_COMPLETION");
    expect(packet.basis).toMatchObject({ questionId: "q-1", currentUsePolicy: "SOURCE_POLICY_APPLIED" });
    expect(packet.basis.materialUses?.items[0]).toMatchObject({ sourcePointer: { id: "capture:c-1", hash: HASH }, availability: "CURRENT" });
    expect(packet.basis.evidenceReviews?.items[0]).toMatchObject({ eventId: "ev-1", truthVerified: false });
    expect(packet.basis.note).toContain("历史留痕保留原身份");
    expect(packet.stopped.missionStatus).toBe("WAITING_INPUT");
    expect(packet.stopped.workState.phase).toBe("WAITING_OBSERVATION");
    expect(packet.stopped.unknownEffect).toBeNull();
    expect(packet.stopped.stopRequest).toMatchObject({ state: "NONE", settled: true });
    expect(packet.stopped.blockers).toEqual([]);
    expect(packet.next.nextActor).toBe("AGENT");
    expect(packet.next.primaryAction?.kind).toBe("WAIT_FOR_OBSERVATION");
    expect(packet.next.waitingOn).toBe("SYSTEM_OBSERVATION");
    expect(packet.next.primaryAction).toMatchObject({
      label: "等待下次观察", readOnly: true,
      submissionGuard: "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY",
      target: { kind: "MISSION", id: "m-1", version: 9 },
    });
    expect(packet.next.primaryAction?.requires).toEqual({
      missionVersion: 9, planRevision: 4, contextVersion: 5, constraintsVersion: 2, researchScopeVersion: 3,
      controlVersion: "control-hash-1", questionId: "q-1", approvalId: null, proposalHash: null,
      requiredSourceRevisions: [`capture:c-1@${HASH}`], boundaryAt: "2026-11-03T12:00:00.000Z",
    });
    expect(packet.coverage.policy).toBe("NOT_FOUND_IS_NOT_NEVER");
    expect(packet.coverage.windows).toHaveLength(2);
  });

  it("NO_CHANGE 只是观察结论，可与 WAITING_OBSERVATION 并存", () => {
    const packet = build();
    expect(packet.observations.state).toBe("OBSERVED");
    expect(packet.done.note).toContain("无新变化");
    expect(packet.done.note).toContain("不是委托生命周期");
    expect(packet.next.note).toContain("未发现新变化");
    expect(packet.next.note).toContain("观察结论");
    expect(packet.stopped.workState.phase).toBe("WAITING_OBSERVATION");
  });

  it("旧后端缺 workPacket 时客户端可退回原详情（类型可选性断言）", () => {
    type LegacyReadbackShape = { missionId: string; workState: unknown; realityOutcome: "NOT_INFERRED"; workPacket?: WorkPacket };
    const legacy: LegacyReadbackShape = { missionId: "m-1", workState: null, realityOutcome: "NOT_INFERRED" };
    expect(legacy.workPacket).toBeUndefined();
    const withPacket: LegacyReadbackShape = { ...legacy, workPacket: build() };
    expect(withPacket.workPacket?.contractVersion).toBe("final-a-workpacket-v1");
  });
});

describe("终态与 UNKNOWN 并列，不互相覆盖", () => {
  it("取消不显示成功；取消与成功的主动作文案可区分", () => {
    const cancelledState = project({ status: "CANCELLED" });
    const cancelled = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "CANCELLED" }, workState: cancelledState,
    }, NOW);
    const succeeded = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "SUCCEEDED" },
      workState: project({ status: "SUCCEEDED" }),
    }, NOW);
    expect(cancelled.next.primaryAction?.kind).toBe("VIEW_RESULT");
    expect(cancelled.stopped.missionStatus).toBe("CANCELLED");
    expect(cancelled.stopped.workState.reasonCode).toBe("CANCELLED");
    expect(cancelled.stopped.workState.terminal?.status).toBe("CANCELLED");
    expect(cancelled.next.primaryAction?.label).toContain("取消");
    expect(cancelled.next.primaryAction?.label).not.toContain("成功");
    expect(succeeded.next.primaryAction?.label).not.toContain("取消");
    expect(cancelled.next.primaryAction?.label).not.toBe(succeeded.next.primaryAction?.label);
  });

  it("SUCCEEDED + 未结算 UNKNOWN：终态可见，未知调用也可见，主动作先核对原结果", () => {
    const workState = project({ status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部效果未结算" } });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "SUCCEEDED" },
      workState,
      work: { latestOutput: { id: "out-9", revision: 2, createdAt: "2026-11-02T02:00:00.000Z" } },
    }, NOW);
    expect(packet.stopped.workState.phase).toBe("COMPLETED");
    expect(packet.stopped.workState.reasonCode).toBe("SUCCEEDED");
    expect(packet.stopped.workState.terminal?.status).toBe("SUCCEEDED");
    expect(packet.stopped.workState.unsettledEffect?.present).toBe(true);
    expect(packet.stopped.unknownEffect).toMatchObject({ present: true, code: "EXTERNAL_UNKNOWN", source: "LAST_ERROR", resolvedByRead: false });
    expect(packet.blockers.map(blocker => blocker.kind)).toContain("UNKNOWN_EFFECT");
    expect(packet.stopped.primaryBlock?.kind).toBe("UNKNOWN_EFFECT");
    expect(packet.next.primaryAction).toMatchObject({
      kind: "CHECK_UNKNOWN_EFFECT", target: { kind: "OUTPUT", id: "out-9", version: 2 }, readOnly: true,
    });
    expect(packet.next.primaryAction?.label).toContain("核对未知调用");
    expect(packet.next.primaryAction?.requires.missionVersion).toBe(9);
    expect(packet.next.note).toContain("不会自动结算");
  });

  it("CANCELLED + UNKNOWN：取消事实与未知调用同时可见，且不出现成功/恢复语义", () => {
    const workState = project({ status: "CANCELLED", lastErrorJson: { code: "TOOL_UNKNOWN" }, cancelRequestedAt: new Date("2026-11-02T00:00:00.000Z") });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "CANCELLED" }, workState,
    }, NOW);
    expect(packet.stopped.workState.reasonCode).toBe("CANCELLED");
    expect(packet.stopped.workState.terminal).toMatchObject({ status: "CANCELLED", at: null, atSource: "NO_TIME" });
    expect(packet.stopped.workState.unsettledEffect?.present).toBe(true);
    expect(packet.stopped.stopRequest).toMatchObject({ state: "CANCEL_SETTLED", settled: true });
    expect(packet.next.primaryAction?.kind).toBe("CHECK_UNKNOWN_EFFECT");
    expect(packet.next.primaryAction?.label).toContain("取消");
    expect(packet.next.primaryAction?.label).not.toContain("成功");
    expect(packet.next.primaryAction?.label).not.toContain("恢复");
  });
});

describe("停止请求在途：主操作不是继续派发", () => {
  it("RUNNING + 有效 lease + 暂停请求在途 → 核对停止结算", () => {
    const workState = project({ status: "RUNNING", leaseUntil: new Date(+NOW + 60_000), pauseRequestedAt: new Date("2026-11-03T03:59:00.000Z") });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "RUNNING" }, workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "RECENT" },
    }, NOW);
    expect(packet.stopped.workState.phase).toBe("RUNNING");
    expect(packet.stopped.workState.reasonCode).toBe("STOP_REQUESTED_IN_FLIGHT");
    expect(packet.stopped.stopRequest).toMatchObject({ state: "PAUSE_REQUESTED", settled: false });
    expect(packet.next.primaryAction?.kind).toBe("CHECK_STOP_SETTLEMENT");
    expect(packet.next.primaryAction?.label).toBe("核对停止结算");
    expect(packet.next.primaryAction?.label).not.toContain("继续");
    expect(packet.next.primaryAction?.label).not.toContain("恢复");
    expect(packet.next.waitingOn).toBe("SYSTEM_SETTLEMENT");
    expect(packet.blockers.map(blocker => blocker.kind)).toContain("STOP_REQUEST");
    expect(packet.stopped.primaryBlock?.kind).toBe("STOP_REQUEST");
  });

  it("RUNNING + 取消请求在途 → 仍是核对停止结算，而不是恢复", () => {
    const workState = project({ status: "RUNNING", leaseUntil: new Date(+NOW + 60_000), cancelRequestedAt: new Date("2026-11-03T03:59:00.000Z") });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "RUNNING" }, workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY" },
    }, NOW);
    expect(packet.stopped.stopRequest).toMatchObject({ state: "CANCEL_REQUESTED", settled: false });
    expect(packet.next.primaryAction?.kind).toBe("CHECK_STOP_SETTLEMENT");
    expect(packet.next.primaryAction?.kind).not.toBe("RESUME_DELEGATION");
  });

  it("停止在途优先于 UNKNOWN：主操作仍是核对停止结算，UNKNOWN_EFFECT 阻断并行保留", () => {
    const workState = project({
      status: "RUNNING", leaseUntil: new Date(+NOW + 60_000),
      pauseRequestedAt: new Date("2026-11-03T03:59:00.000Z"), lastErrorJson: { code: "TOOL_UNKNOWN" },
    });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "RUNNING" }, workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "RECENT" },
    }, NOW);
    expect(packet.stopped.workState.phase).toBe("RUNNING");
    expect(packet.stopped.workState.reasonCode).toBe("STOP_REQUESTED_IN_FLIGHT");
    expect(packet.stopped.workState.unsettledEffect).toMatchObject({ present: true, code: "TOOL_UNKNOWN" });
    expect(packet.stopped.unknownEffect).toMatchObject({ present: true, code: "TOOL_UNKNOWN" });
    expect(packet.next.primaryAction?.kind).toBe("CHECK_STOP_SETTLEMENT");
    expect(packet.next.primaryAction?.label).not.toContain("查询原请求");
    expect(packet.blockers.map(blocker => blocker.kind)).toEqual(expect.arrayContaining(["STOP_REQUEST", "UNKNOWN_EFFECT"]));
    expect(packet.stopped.primaryBlock?.kind).toBe("STOP_REQUEST");
  });

  it("暂停已结算后才给出恢复动作，并保留 PAUSE_SETTLED 事实", () => {
    const workState = project({ status: "PAUSED", pauseRequestedAt: new Date("2026-11-03T02:00:00.000Z"), pauseReason: "USER" });
    const packet = buildMissionWorkPacket({ mission: { ...missionFacts, missionStatus: "PAUSED" }, workState }, NOW);
    expect(packet.stopped.stopRequest).toMatchObject({ state: "PAUSE_SETTLED", settled: true });
    expect(packet.next.primaryAction?.kind).toBe("RESUME_DELEGATION");
    expect(packet.next.note).toContain("重新核对");
  });
});

describe("问题与批准只指向当前有效 ref", () => {
  it("过期批准不给批准动作：改重核并保留 APPROVAL 阻断", () => {
    const workState = project({ status: "WAITING_APPROVAL", approvals: [] });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "WAITING_APPROVAL" },
      workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY" },
      pendingOriginalRefs: { approvals: [{ id: "old-approval", proposalHash: "old-hash", expiresAt: "2026-11-02T00:00:00.000Z", status: "PENDING" }] },
    }, NOW);
    expect(packet.stopped.workState.reasonCode).toBe("APPROVAL_EXPIRED");
    expect(packet.next.primaryAction?.kind).toBe("RECHECK_AUTHORITY");
    expect(packet.next.primaryAction?.kind).not.toBe("REVIEW_APPROVAL");
    expect(packet.blockers).toContainEqual(expect.objectContaining({ kind: "APPROVAL", code: "APPROVAL_EXPIRED", blocksActions: true }));
  });

  it("当前有效提案才给 REVIEW_APPROVAL，并携带原提案 id 与 proposalHash", () => {
    const workState = project({ status: "WAITING_APPROVAL", approvals: [{ id: "ap-1", expiresAt: new Date(+NOW + 60 * 60 * 1000) }] });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "WAITING_APPROVAL" },
      workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY" },
      pendingOriginalRefs: { approvals: [{ id: "ap-1", proposalHash: "prop-hash-1", expiresAt: "2026-11-04T00:00:00.000Z", status: "PENDING" }] },
    }, NOW);
    expect(packet.stopped.workState.exactApprovalRef).toBe("ap-1");
    expect(packet.next.primaryAction).toMatchObject({ kind: "REVIEW_APPROVAL", target: { kind: "APPROVAL", id: "ap-1", version: null } });
    expect(packet.next.primaryAction?.requires).toMatchObject({ approvalId: "ap-1", proposalHash: "prop-hash-1" });
    expect(packet.next.waitingOn).toBe("USER_APPROVAL");
  });

  it("当前有效原问题 → ANSWER_QUESTION 指向原问题 id", () => {
    const workState = project({ status: "WAITING_INPUT", waitStateJson: { questionId: "q-7", question: "请补齐对照组", waitingFor: "USER" }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: POLICY_EXPIRES } });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts }, workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY", permissionExpiresAt: "2026-11-05T00:00:00.000Z" },
    }, NOW);
    expect(packet.stopped.workState.exactQuestionRef).toBe("q-7");
    expect(packet.next.primaryAction).toMatchObject({ kind: "ANSWER_QUESTION", target: { kind: "QUESTION", id: "q-7", version: null } });
    expect(packet.next.primaryAction?.requires.questionId).toBe("q-7");
    expect(packet.next.waitingOn).toBe("USER_INPUT");
  });
});

describe("额度等待：保留 nextCheckAt 与累计预算", () => {
  it("READY + DAILY_BUDGET_WAITING → 等待额度，BUDGET 阻断，累计用量不清零", () => {
    const nextAttemptAt = new Date("2026-11-04T00:00:00.000Z");
    const workState = project({ status: "READY", events: [{ id: "budget", type: "DAILY_BUDGET_WAITING", payloadJson: {} }], nextAttemptAt });
    const input = baseInput({
      mission: { ...missionFacts, missionStatus: "READY" },
      workState,
      responsibility: {
        controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY",
        workerPresence: "RECENT",
        budget: {
          limits: { models: 10, tools: 20 },
          cumulativeUsed: { models: 3, tools: 5, metadataRequests: null },
          policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
          monetaryCost: null,
        },
      },
      observations: null,
      work: null,
      basis: null,
      coverage: null,
    });
    const before = JSON.parse(JSON.stringify(input.responsibility?.budget));
    const packet = buildMissionWorkPacket(input, NOW);
    expect(packet.next.primaryAction?.kind).toBe("WAIT_FOR_OBSERVATION");
    expect(packet.next.waitingOn).toBe("BUDGET_RESET");
    expect(packet.next.nextCheckAt).toBe(nextAttemptAt.toISOString());
    expect(packet.blockers).toContainEqual(expect.objectContaining({ kind: "BUDGET", code: "DAILY_BUDGET_WAITING", blocksActions: true }));
    expect(packet.blockers.find(blocker => blocker.kind === "BUDGET")?.text).toContain("累计用量保留");
    expect(packet.next.note).toContain("累计用量保留");
    // 构造器只读：既有累计计数原样输出，不补 0、不清零、不修改输入。
    expect(input.responsibility?.budget).toEqual(before);
    expect(packet.authority.budget.cumulativeUsed).toEqual({ models: 3, tools: 5, metadataRequests: null });
    expect(packet.authority.budget.monetaryCost).toBeNull();
    expect(packet.next.primaryAction?.label).not.toContain("继续");
  });
});

describe("覆盖说明：未找到 ≠ 从未发生", () => {
  it("空窗口与未观察不写成“没有发生”", () => {
    const packet = build({
      mission: { ...missionFacts, missionStatus: "READY" },
      workState: project({ status: "READY" }),
      observations: { lastSuccessfulAt: null, lastFailedAt: null, lastNoNewInformationAt: null, nextCheckAt: null },
      work: null,
      basis: null,
      coverage: { windows: [{ name: "MATERIAL_USES", limit: 20, returned: 0, truncated: false }] },
    });
    expect(packet.coverage.policy).toBe("NOT_FOUND_IS_NOT_NEVER");
    expect(packet.coverage.windows[0].note).toContain("未找到");
    expect(packet.coverage.windows[0].note).toContain("不等于");
    expect(packet.coverage.windows[0].note).toContain("从未发生");
    expect(packet.basis.note).toContain("未找到记录不等于从未使用");
    expect(packet.basis.note).toContain("未找到记录不等于从未发生");
    expect(packet.done.note).toContain("不等于从未发生");
    expect(packet.observations.state).toBe("NOT_OBSERVED");
    expect(packet.next.note).not.toContain("无新变化");
  });

  it("没有 coverage 输入时也输出有界窗口与同样的 policy 文案", () => {
    const packet = build({ coverage: null });
    expect(packet.coverage.policy).toBe("NOT_FOUND_IS_NOT_NEVER");
    expect(packet.coverage.windows.map(window => window.name)).toEqual(expect.arrayContaining(["RECENT_STEPS", "ACTION_RECEIPTS"]));
    for (const window of packet.coverage.windows) {
      expect(window.note).toContain("不等于");
      expect(window.note).toContain("从未发生");
    }
  });

  it("最近观察失败时不显示“未发现新变化”", () => {
    const packet = build({
      observations: {
        lastSuccessfulAt: "2026-11-02T00:00:00.000Z",
        lastFailedAt: "2026-11-03T00:00:00.000Z",
        lastNoNewInformationAt: "2026-11-02T00:00:00.000Z",
        nextCheckAt: "2026-11-04T00:00:00.000Z",
      },
    });
    expect(packet.observations.state).toBe("FAILED_LAST");
    expect(packet.next.note).toContain("观察失败");
    expect(packet.next.note).not.toContain("未发现新变化");
    expect(packet.done.note).not.toContain("无新变化");
  });

  it("来源不可用时不能显示为“无变化”", () => {
    const unavailable = materialItem({ id: "capture:gone", availability: "UNAVAILABLE", currentUse: null });
    const packet = build({
      basis: { questionId: "q-1", materialUses: materialUsesFixture([unavailable]), evidenceReviews: null, currentUsePolicy: "SOURCE_POLICY_APPLIED" },
    });
    expect(packet.observations.state).toBe("OBSERVED");
    expect(packet.next.note).not.toContain("未发现新变化");
    expect(packet.done.note).not.toContain("无新变化");
    expect(packet.blockers).toContainEqual(expect.objectContaining({ kind: "SOURCE", code: "SOURCE_UNAVAILABLE" }));
  });
});

describe("时间跨界：主操作变重核，并保留全量版本要求", () => {
  const questionState = project({
    status: "WAITING_INPUT",
    waitStateJson: { questionId: "q-1", question: "请补齐对照组", waitingFor: "USER" },
    continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-03T06:00:00.000Z" },
  });
  const inputFor = (at: Date): WorkPacketInput => baseInput({
    mission: { ...missionFacts },
    workState: questionState,
    responsibility: {
      controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY",
      permissionExpiresAt: "2026-11-03T06:00:00.000Z", workerPresence: "RECENT",
    },
    observations: null, work: null, basis: null, coverage: null,
  });

  it("边界前回答原问题，边界后同一输入改为主操作重核且不签发旧资格", () => {
    const before = buildMissionWorkPacket(inputFor(NOW), NOW);
    const after = buildMissionWorkPacket(inputFor(LATER), LATER);
    expect(before.next.primaryAction?.kind).toBe("ANSWER_QUESTION");
    expect(before.next.primaryAction?.requires.boundaryAt).toBe("2026-11-03T06:00:00.000Z");
    expect(after.next.primaryAction?.kind).toBe("RECHECK_AUTHORITY");
    expect(after.next.primaryAction?.label).toContain("重新核对");
    expect(after.blockers).toContainEqual(expect.objectContaining({ kind: "AUTHORITY", code: "PERMISSION_EXPIRED", blocksActions: true }));
    expect(after.stopped.primaryBlock?.kind).toBe("AUTHORITY");
    // 版本要求仍是全量：提交时由服务端重查，而不是沿用旧操作资格。
    expect(after.next.primaryAction?.requires).toEqual({
      missionVersion: 9, planRevision: 4, contextVersion: 5, constraintsVersion: 2, researchScopeVersion: 3,
      controlVersion: "c", questionId: "q-1", approvalId: null, proposalHash: null,
      requiredSourceRevisions: [], boundaryAt: "2026-11-03T06:00:00.000Z",
    });
  });

  it("RUNNING 租约到期只按 LEASE 等待，不误标为重新核对许可", () => {
    const workState = project({
      status: "RUNNING", leaseUntil: NOW,
      continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: POLICY_EXPIRES },
    });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "RUNNING" }, workState,
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY" },
    }, NOW);
    expect(packet.stopped.workState.reasonCode).toBe("LEASE_UNCONFIRMED");
    expect(packet.next.primaryAction?.kind).toBe("WAIT_FOR_OBSERVATION");
    expect(packet.blockers).toContainEqual(expect.objectContaining({ kind: "LEASE", code: "LEASE_UNCONFIRMED" }));
    expect(packet.blockers.map(blocker => blocker.kind)).not.toContain("AUTHORITY");
  });

  it("租约到期叠加许可越界：重核优先，但 LEASE 阻断仍保留", () => {
    const workState = project({
      status: "RUNNING", leaseUntil: NOW,
      continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-02T00:00:00.000Z" },
    });
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "RUNNING" }, workState,
      responsibility: { controlVersion: "c", permissionState: "EXPIRED", permissionExpiresAt: "2026-11-02T00:00:00.000Z" },
    }, NOW);
    expect(packet.next.primaryAction?.kind).toBe("RECHECK_AUTHORITY");
    expect(packet.blockers.map(blocker => blocker.kind)).toEqual(expect.arrayContaining(["AUTHORITY", "LEASE"]));
    expect(packet.next.primaryAction?.label).not.toContain("继续");
  });
});

describe("阻断展开：排序稳定、主操作不吞掉其他阻断", () => {
  const stormInput = () => baseInput({
    mission: { ...missionFacts, missionStatus: "READY" },
    workState: project({ status: "READY", events: [{ id: "budget", type: "DAILY_BUDGET_WAITING", payloadJson: {} }], nextAttemptAt: new Date("2026-11-04T00:00:00.000Z") }),
    responsibility: {
      controlVersion: "c", permissionState: "EXPIRED", permissionExpiresAt: "2026-11-02T00:00:00.000Z",
      deadline: "2026-11-02T00:00:00.000Z", workerPresence: "STALE",
    },
    observations: null,
    work: null,
    basis: {
      questionId: "q-1", currentUsePolicy: "SOURCE_POLICY_APPLIED",
      materialUses: materialUsesFixture([
        materialItem({ id: "capture:z", availability: "CHANGED" }),
        materialItem({ id: "capture:m", availability: "CHANGED", currentUse: { ...currentAllowed, state: "SUPPRESSED" } }),
        materialItem({ id: "capture:a", availability: "CHANGED" }),
      ]),
      evidenceReviews: null,
    },
    coverage: null,
  });

  it("乱序阻断输入按固定类别顺序与原对象 id 稳定排序", () => {
    const input = stormInput();
    const packet = buildMissionWorkPacket(input, NOW);
    const order = ["AUTHORITY", "WORK_STATE", "STOP_REQUEST", "BUDGET", "SOURCE", "APPROVAL", "QUESTION", "LEASE", "UNKNOWN_EFFECT", "FAILURE", "DELEGATION", "TIME_BOUNDARY"];
    const indexes = packet.blockers.map(blocker => order.indexOf(blocker.kind));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(packet.stopped.blockers).toEqual(packet.blockers);
    expect(packet.next.primaryAction?.kind).toBe("RECHECK_AUTHORITY");
    expect(packet.stopped.primaryBlock?.kind).toBe("AUTHORITY");
    expect(packet.blockers.some(blocker => blocker.kind === "AUTHORITY")).toBe(true);
    expect(packet.blockers.filter(blocker => blocker.code === "SOURCE_CHANGED").map(blocker => blocker.originalRef?.id))
      .toEqual(["capture:a", "capture:m", "capture:z"]);
    expect(packet.blockers.some(blocker => blocker.code === "CURRENT_USE_SUPPRESSED")).toBe(true);
  });

  it("同一输入重复构造结果完全一致，且不修改输入对象", () => {
    const input = stormInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = buildMissionWorkPacket(input, NOW);
    const second = buildMissionWorkPacket(input, NOW);
    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

describe("旧 WorkState/未知枚举降级", () => {
  const legacyWorkState = {
    phase: "UNKNOWN", nextActor: "SYSTEM", requiresUser: false, reasonCode: "WAIT_CONDITION_UNKNOWN",
    reasonText: "等待条件需核对", actionLabel: "核对当前状态",
    originalRef: { kind: "MISSION", id: "m-1", version: 9 },
    exactQuestionRef: null, exactApprovalRef: null,
    checkedAt: NOW.toISOString(), observedAt: null, nextCheckAt: null, nextBoundary: null, freshness: "PARTIAL",
  } as unknown as WorkPacket["stopped"]["workState"];

  it("旧 WorkState 缺 terminal/unsettledEffect/stopRequest 时用 mission 事实回退且不崩溃", () => {
    const packet = buildMissionWorkPacket({
      mission: { ...missionFacts, missionStatus: "SUCCEEDED", lastErrorCode: "EXTERNAL_UNKNOWN" },
      workState: legacyWorkState,
    }, NOW);
    expect(packet.stopped.workState.terminal).toBeUndefined();
    expect(packet.stopped.workState.phase).toBe("UNKNOWN");
    expect(packet.stopped.unknownEffect).toMatchObject({ present: true, code: "EXTERNAL_UNKNOWN", source: "LAST_ERROR" });
    expect(packet.stopped.stopRequest).toMatchObject({ state: "NONE", settled: true });
    expect(packet.next.primaryAction?.kind).toBe("CHECK_UNKNOWN_EFFECT");
    expect(packet.next.primaryAction?.label).not.toContain("成功");
  });

  it("未知 permissionState 映射为 UNKNOWN，不伪造成有效许可也不触发权限失效", () => {
    const packet = build({
      responsibility: { controlVersion: null, permissionState: "SOMETHING_NEW", workerPresence: "SOMETHING_NEW" },
    });
    expect(packet.authority.permissionState).toBe("UNKNOWN");
    expect(packet.authority.controlVersion).toBeNull();
    expect(packet.authority.workerPresence).toBe("SOMETHING_NEW");
    expect(packet.blockers.map(blocker => blocker.kind)).not.toContain("AUTHORITY");
    expect(packet.next.primaryAction?.kind).toBe("WAIT_FOR_OBSERVATION");
  });

  it("VERSION_ADVANCED 快照留下明确说明与阻断，不静默混用版本", () => {
    const packet = build({ snapshot: { consistency: "VERSION_ADVANCED", retries: 2, checkedAt: NOW.toISOString() } });
    expect(packet.snapshot).toMatchObject({ consistency: "VERSION_ADVANCED", retries: 2 });
    expect(packet.snapshot.note).toContain("提交前必须重新核对全部版本");
    expect(packet.blockers).toContainEqual(expect.objectContaining({ kind: "WORK_STATE", code: "SNAPSHOT_VERSION_ADVANCED" }));
    expect(packet.next.primaryAction?.requires.missionVersion).toBe(9);
  });

  it("真实 null 与缺失区分：无观察/无输出时字段存在且为 null", () => {
    const packet = build({
      mission: { ...missionFacts, missionStatus: "READY" },
      workState: project({ status: "READY" }),
      responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY" },
      observations: null, work: null, basis: null, coverage: null, snapshot: null,
    });
    expect(packet.observations.lastSuccessfulAt).toBeNull();
    expect(packet.observations.lastFailedAt).toBeNull();
    expect(packet.observations.lastNoNewInformationAt).toBeNull();
    expect(packet.observations.nextCheckAt).toBeNull();
    expect(packet.done.latestOutput).toBeNull();
    expect(packet.done.progress).toBeNull();
    expect(packet.basis.materialUses).toBeNull();
    expect(packet.basis.evidenceReviews).toBeNull();
    expect(packet.stopped.unknownEffect).toBeNull();
    expect(packet.snapshot.consistency).toBe("VERSION_STABLE");
    expect(packet.authority.permissionExpiresAt).toBeNull();
    expect(packet.authority.deadline).toBeNull();
  });
});
