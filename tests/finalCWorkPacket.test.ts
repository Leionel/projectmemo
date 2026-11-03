// @vitest-environment jsdom
/**
 * C1：原 Mission 顶部四问工作包。
 *
 * fixture 字段取自 evidence/final-a/20261103/samples/a2 的真实 readback JSON
 * （a2-running / a2-waiting-user / a2-waiting-approval / a2-stop-requested /
 * a2-observation-no-change / a2-legacy-server-without-workpacket），只保留断言需要的字段。
 * 不导入大 JSON，也不构造服务端没有的事实。
 */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionWorkPacket } from "@/components/MissionWorkPacket";
import { reviewProgressOf } from "@/lib/mission/reviewProgress";
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type { WorkState, WorkStateStopRequest, WorkStateUnsettledEffect } from "@/lib/types/workState";
import type {
  WorkPacket,
  WorkPacketBlocker,
  WorkPacketPrimaryAction,
  WorkPacketPrimaryActionKind,
  WorkPacketTarget,
} from "@/lib/types/workPacket";

const MISSION_ID = "cmw06a7kx0003is8ojres7hy2";
const PROJECT_ID = "cmw06a7ks0001is8oqm7iw9ac";
const CONTROL_VERSION = "0cbe2563faeeb339b7dd6377131b58d5f831701eb542093e5e3839851911f3c2";
const APPROVAL_ID = "cmw06a7nl000iis8o92ybtd9c";
const READ_AT = "2026-11-03T04:13:18.950Z";
const LAST_SUCCESS = "2026-11-03T04:12:19.052Z";
const LAST_FAILED = "2026-11-03T04:13:18.950Z";
const BOUNDARY = "2026-11-03T04:23:19.041Z";
const STEP_NOTE = "提议行动";
const BLOCKER_WORKER = "后台 Worker 心跳不可靠，尚未核实近期执行；心跳不等于成功观察";
const BLOCKER_QUESTION = "原问题等待你的补充；回答绑定原问题，旧问题不能替换成新问题";
const BLOCKER_UNKNOWN = "原请求或外部效果尚未结算，读取不会自动核销";
const DONE_NOTE =
  "最近工作只取原 Step/Output/Action/回执的有界窗口；执行成功、草稿存在与行动创建都不等于现实目标达成。";

const scrollSpy = vi.fn();
beforeEach(() => {
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollSpy,
  });
  scrollSpy.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function blocker(
  kind: WorkPacketBlocker["kind"],
  code: string,
  text: string,
  at: string | null = null,
): WorkPacketBlocker {
  return { kind, code, text, at, blocksActions: true, originalRef: { kind: "MISSION", id: MISSION_ID } };
}

function workState(overrides: Partial<WorkState> = {}): WorkState {
  return {
    phase: "RUNNING",
    nextActor: "AGENT",
    requiresUser: false,
    reasonCode: "LEASE_ACTIVE",
    reasonText: "正在调查，进展来自已保存步骤",
    actionLabel: "查看委托进展",
    originalRef: { kind: "MISSION", id: MISSION_ID, version: 1 },
    exactQuestionRef: null,
    exactApprovalRef: null,
    checkedAt: READ_AT,
    observedAt: null,
    nextCheckAt: null,
    nextBoundary: BOUNDARY,
    freshness: "FRESH",
    terminal: null,
    unsettledEffect: { present: false, code: null, source: "NONE", reasonText: null, resolvedByRead: false },
    stopRequest: { state: "NONE", requestedAt: null, settled: true, note: null },
    ...overrides,
  };
}

function primaryAction(
  kind: WorkPacketPrimaryActionKind,
  label: string,
  target: WorkPacketTarget | null,
): WorkPacketPrimaryAction {
  return {
    kind,
    label,
    target,
    requires: {
      missionVersion: 1,
      planRevision: 1,
      contextVersion: 1,
      constraintsVersion: 1,
      researchScopeVersion: 1,
      controlVersion: CONTROL_VERSION,
      questionId: null,
      approvalId: null,
      proposalHash: null,
      requiredSourceRevisions: [],
      boundaryAt: BOUNDARY,
    },
    submissionGuard: "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY",
    readOnly: true,
  };
}

const EMPTY_PROGRESS = reviewProgressOf({ steps: [], outputs: [], actions: [] });

function basePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    schemaVersion: 1,
    contractVersion: "final-a-workpacket-v1",
    readAt: READ_AT,
    identity: {
      missionId: MISSION_ID,
      projectId: PROJECT_ID,
      missionVersion: 1,
      missionStatus: "RUNNING",
      planRevision: 1,
      contextVersion: 1,
      constraintsVersion: 1,
      researchScopeVersion: 1,
      controlVersion: CONTROL_VERSION,
      originalRef: { kind: "MISSION", id: MISSION_ID, version: 1 },
    },
    snapshot: {
      mode: "SINGLE_READ_TRANSACTION",
      consistency: "VERSION_STABLE",
      retries: 0,
      checkedAt: READ_AT,
      note: "同一只读事务内读取；身份与版本来自同一快照。",
    },
    authority: {
      controlVersion: CONTROL_VERSION,
      permissionState: "WITHIN_TIME_BOUNDARY",
      permissionExpiresAt: null,
      deadline: null,
      nextBoundary: BOUNDARY,
      effectiveNextCheckAt: null,
      workerPresence: "UNOBSERVED",
      budget: {
        limits: { models: 12, tools: 16, activeMs: 180000 },
        cumulativeUsed: { models: null, tools: null, activeMs: null },
        policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
        monetaryCost: null,
      },
      note: "VIEW_ONLY_NO_EXECUTION_PERMISSION",
    },
    observations: {
      readAt: READ_AT,
      state: "NOT_OBSERVED",
      lastSuccessfulAt: null,
      lastFailedAt: null,
      lastNoNewInformationAt: null,
      nextCheckAt: null,
      authority: "ORIGINAL_DELEGATION_RECORDS_ONLY",
    },
    done: {
      recentSteps: [
        { id: "cmw06a7nk000his8o4ki7wqae", ordinal: 1, toolName: "propose_action", status: "WAITING_APPROVAL", at: null, note: STEP_NOTE },
      ],
      latestOutput: null,
      progress: EMPTY_PROGRESS,
      actionReceipts: [],
      note: DONE_NOTE,
      coverage: { limit: 5, truncated: false },
    },
    basis: {
      questionId: null,
      materialUses: {
        schemaVersion: 1,
        questionId: null,
        items: [],
        coverage: {
          eventLimit: 80,
          eventsInspected: 0,
          eventsTruncated: false,
          stepLimit: 40,
          stepsInspected: 0,
          stepsTruncated: false,
          outputLimit: 20,
          outputsInspected: 0,
          outputsTruncated: false,
          receiptsInspected: 0,
          receiptsTruncated: false,
          runLimit: 40,
          projectRunLimit: 40,
          runsInspected: 0,
          runsTruncated: false,
          runScope: "MISSION_FILTERED",
          sourceLimit: 8,
          sourceLimitReached: false,
          mapping: "DIRECT_SOURCE_POINTERS_ONLY",
        },
      },
      evidenceReviews: { items: [], truncated: false },
      currentUsePolicy: "SOURCE_POLICY_APPLIED",
      note: "依据只取原资料使用与证据审查投影；历史留痕保留原身份，当前可用不等于独立支持。",
    },
    stopped: {
      workState: workState(),
      missionStatus: "RUNNING",
      primaryBlock: null,
      blockers: [],
      unknownEffect: null,
      stopRequest: { state: "NONE", requestedAt: null, settled: true, note: null },
      note: "原生命周期 RUNNING；显示阶段 RUNNING；停止请求 NONE（已结算/无请求）；未结算效果不存在。工作包不改变原生命周期，也不构成执行授权。",
    },
    next: {
      nextActor: "AGENT",
      primaryAction: primaryAction("WAIT_FOR_OBSERVATION", "查看委托进展（执行中）", { kind: "MISSION", id: MISSION_ID, version: 1 }),
      nextCheckAt: null,
      nextBoundary: BOUNDARY,
      waitingOn: "SYSTEM_WORKER",
      note: "等待原委托继续处理；原许可与进度保留。",
    },
    blockers: [],
    coverage: {
      windows: [
        { name: "RECENT_STEPS", limit: 5, returned: 1, truncated: false, note: "有界窗口内未找到记录只表示覆盖不足，不等于从未发生。" },
        { name: "MISSION_MODEL_RUNS", limit: 20, returned: 0, truncated: false, note: "调用覆盖窗口先按 trace.missionId 过滤；未找到回执不等于从未发生。" },
      ],
      policy: "NOT_FOUND_IS_NOT_NEVER",
    },
    realityOutcome: "NOT_INFERRED",
    ...overrides,
  };
}

function packetWithAction(
  kind: WorkPacketPrimaryActionKind,
  label: string,
  target: WorkPacketTarget | null,
  base: WorkPacket = basePacket(),
): WorkPacket {
  return { ...base, next: { ...base.next, primaryAction: primaryAction(kind, label, target) } };
}

/** 只测工作包用到的字段；其余字段由真实服务返回，这里按 A2 样本裁剪。 */
function readbackFixture(packet: WorkPacket): ReadbackData {
  return {
    workState: packet.stopped.workState,
    schemaVersion: 1,
    missionId: packet.identity.missionId,
    projectId: packet.identity.projectId,
    missionVersion: packet.identity.missionVersion,
    missionStatus: packet.identity.missionStatus,
    observedAt: packet.readAt,
    readAt: packet.readAt,
    observation: packet.observations,
  } as unknown as ReadbackData;
}

function legacyReadback(): ReadbackData {
  return {
    workState: {
      phase: "QUEUED",
      nextActor: "AGENT",
      requiresUser: false,
      reasonCode: "DAILY_BUDGET_WAITING",
      reasonText: "今日调用额度已用完，等待许可时区的次日；累计用量保留",
      actionLabel: "查看下次检查时间",
      originalRef: { kind: "MISSION", id: MISSION_ID, version: 1 },
      exactQuestionRef: null,
      exactApprovalRef: null,
      checkedAt: READ_AT,
      observedAt: null,
      nextCheckAt: "2026-11-03T05:13:19.137Z",
      nextBoundary: null,
      freshness: "FRESH",
    },
    schemaVersion: 1,
    missionId: MISSION_ID,
    projectId: PROJECT_ID,
    missionVersion: 1,
    missionStatus: "READY",
    observedAt: READ_AT,
  } as unknown as ReadbackData;
}

/** 比 A2 legacy 样本更旧的响应：有 missionStatus，但没有 workState。 */
function legacyReadbackWithoutWorkState(): ReadbackData {
  return {
    schemaVersion: 1,
    missionId: MISSION_ID,
    projectId: PROJECT_ID,
    missionVersion: 1,
    missionStatus: "READY",
    observedAt: READ_AT,
  } as unknown as ReadbackData;
}

function renderPacket(
  packet: WorkPacket | undefined,
  options: { readback?: ReadbackData | null; disabled?: boolean; targets?: boolean } = {},
) {
  const onReload = vi.fn();
  const resumeClick = vi.fn();
  const targets = options.targets
    ? createElement(
        "div",
        null,
        createElement("section", { id: "mission-question" }, createElement("button", { type: "button" }, "补充信息")),
        createElement(
          "section",
          { "data-mission-approval-id": APPROVAL_ID },
          createElement("button", { type: "button" }, "批准提案"),
        ),
        createElement(
          "section",
          { "data-mission-approval-id": "other-approval" },
          createElement("button", { type: "button" }, "另一个提案"),
        ),
        createElement(
          "section",
          { id: "mission-error-block" },
          createElement("button", { type: "button", onClick: resumeClick }, "确认后继续执行"),
        ),
        createElement("section", { id: "mission-results" }, createElement("a", { href: "#card-1" }, "查看复盘记录")),
      )
    : null;
  const readback = options.readback === undefined ? (packet ? readbackFixture(packet) : legacyReadback()) : options.readback;
  const view = render(
    createElement(
      "div",
      null,
      targets,
      createElement(MissionWorkPacket, {
        readback,
        packet,
        missionId: MISSION_ID,
        onReload,
        disabled: options.disabled,
      }),
    ),
  );
  return { ...view, onReload, resumeClick };
}

describe("C1 四问工作包：正常状态", () => {
  it("默认展示四问、唯一主操作与观察时间，不把读取当成成功观察", () => {
    const packet = packetWithAction("ANSWER_QUESTION", "回答原问题", { kind: "QUESTION", id: "q-sample-user", version: null });
    const view = renderPacket(packet);
    const outer = screen.getByRole("region", { name: "原任务四问工作包" });
    for (const title of ["做到哪", "依据是什么", "为何停下", "现在等谁"]) {
      const question = outer.querySelector(`section[aria-label="${title}"]`);
      expect(question?.querySelector("h4")?.textContent).toBe(title);
    }
    expect(view.container.querySelectorAll("[data-mission-primary-action]")).toHaveLength(1);
    const primary = screen.getByRole("button", { name: "回答原问题" }) as HTMLButtonElement;
    expect(primary.type).toBe("button");
    expect(view.container.textContent).toContain(STEP_NOTE);
    expect(view.container.textContent).toContain("原资料使用 0 项 · 证据审查 0 条");
    expect(view.container.textContent).toContain("当前阶段：正在调查 · 原状态：正在执行");
    expect(view.container.textContent).toContain("读取于");
    expect(view.container.textContent).toContain("尚未有成功观察记录");
    expect(view.container.textContent).toContain("心跳不代表成功观察");
    expect(view.container.textContent).toContain("等待：等后台继续执行");
    expect(view.container.textContent).toContain("下次检查时间：未记录");
    expect(view.container.textContent).toContain("有效边界：");
    expect(view.container.textContent).toContain("未从委托状态推断（NOT_INFERRED）");
  });

  it("blockers 全量展开：不只显示首要阻断，原生 details 可展开", () => {
    const blockers = [
      blocker("WORK_STATE", "TOOL_UNKNOWN", BLOCKER_WORKER),
      blocker("QUESTION", "QUESTION_PENDING", BLOCKER_QUESTION),
      blocker("UNKNOWN_EFFECT", "TOOL_UNKNOWN", BLOCKER_UNKNOWN),
    ];
    const packet = basePacket({
      blockers,
      stopped: { ...basePacket().stopped, primaryBlock: blockers[0], blockers },
    });
    const view = renderPacket(packet);
    expect(view.container.textContent).toContain(BLOCKER_WORKER);
    expect(view.container.textContent).toContain(BLOCKER_QUESTION);
    expect(view.container.textContent).toContain(BLOCKER_UNKNOWN);
    const summary = screen.getByText("全部阻断（3 项）");
    const details = summary.closest("details");
    expect(details?.tagName).toBe("DETAILS");
    expect(details?.querySelectorAll("li")).toHaveLength(3);
    expect((details as HTMLDetailsElement).open).toBe(false);
    (details as HTMLDetailsElement).open = true;
    expect(details?.querySelectorAll("li")).toHaveLength(3);
  });

  it("停止请求在途与未结算效果分别呈现，不合并成一个显示状态", () => {
    const stopRequest: WorkStateStopRequest = {
      state: "PAUSE_REQUESTED",
      requestedAt: "2026-11-03T04:13:14.076Z",
      settled: false,
      note: "已收到停止请求，等待本轮调用结算，不会继续派发新步骤",
    };
    const stopBlock = blocker(
      "STOP_REQUEST",
      "PAUSE_REQUESTED",
      "已收到停止请求，等待本轮调用结算，不会继续派发新步骤",
      "2026-11-03T04:13:14.076Z",
    );
    const stopPacket = basePacket({
      stopped: {
        ...basePacket().stopped,
        workState: workState({
          nextActor: "SYSTEM",
          reasonCode: "STOP_REQUESTED_IN_FLIGHT",
          reasonText: "已收到停止请求，等待本轮调用结算，不会继续派发新步骤",
          actionLabel: "核对停止结算",
          stopRequest,
        }),
        primaryBlock: stopBlock,
        blockers: [stopBlock],
        stopRequest,
        note: "原生命周期 RUNNING；显示阶段 RUNNING；停止请求 PAUSE_REQUESTED（未结算）；未结算效果不存在。",
      },
      next: {
        ...basePacket().next,
        nextActor: "SYSTEM",
        primaryAction: primaryAction("CHECK_STOP_SETTLEMENT", "核对停止结算", { kind: "MISSION", id: MISSION_ID, version: 1 }),
        waitingOn: "SYSTEM_SETTLEMENT",
        note: "停止请求已收到但尚未结算；等待本轮调用结算后重新读取，不建议继续派发。",
      },
    });
    const view = renderPacket(stopPacket);
    expect(view.container.textContent).toContain("已请求暂停，尚未结算");
    expect(view.container.textContent).toContain("不会继续派发新步骤");
    expect(view.container.textContent).toContain("未结算效果：未记录");

    const unknownEffect: WorkStateUnsettledEffect = {
      present: true,
      code: "TOOL_UNKNOWN",
      source: "LAST_ERROR",
      reasonText: "原请求或外部效果尚未结算，读取不会自动核销",
      resolvedByRead: false,
    };
    const unknownPacket = basePacket({
      stopped: {
        ...basePacket().stopped,
        workState: workState({
          phase: "UNKNOWN",
          nextActor: "SYSTEM",
          reasonCode: "TOOL_UNKNOWN",
          reasonText: "原请求状态待核对，已用预算保留",
          actionLabel: "查询原请求",
          unsettledEffect: unknownEffect,
        }),
        missionStatus: "PAUSED",
        primaryBlock: blocker("WORK_STATE", "TOOL_UNKNOWN", "原状态需核对；已保存进度保留，读取不会自动推进"),
        blockers: [blocker("UNKNOWN_EFFECT", "TOOL_UNKNOWN", BLOCKER_UNKNOWN)],
        unknownEffect,
        note: "原生命周期 PAUSED；显示阶段 UNKNOWN；停止请求 NONE（已结算/无请求）；未结算效果存在。",
      },
    });
    view.rerender(
      createElement(MissionWorkPacket, {
        readback: readbackFixture(unknownPacket),
        packet: unknownPacket,
        missionId: MISSION_ID,
        onReload: view.onReload,
      }),
    );
    expect(view.container.textContent).toContain("当前阶段：状态待核对 · 原状态：已暂停");
    expect(view.container.textContent).toContain("未结算效果：TOOL_UNKNOWN");
    expect(view.container.textContent).toContain("读取不会核销，需要重新核对原请求");
  });

  it("观察时间分开：NOT_OBSERVED 与 FAILED_LAST 都不出现“无变化”，刷新只推进读取时间", () => {
    const notObserved = basePacket();
    const view = renderPacket(notObserved);
    expect(view.container.textContent).toContain("尚未有成功观察记录");
    expect(view.container.textContent).not.toMatch(/无变化/);

    const failedLast = basePacket({
      observations: {
        readAt: READ_AT,
        state: "FAILED_LAST",
        lastSuccessfulAt: LAST_SUCCESS,
        lastFailedAt: LAST_FAILED,
        lastNoNewInformationAt: null,
        nextCheckAt: null,
        authority: "ORIGINAL_DELEGATION_RECORDS_ONLY",
      },
    });
    view.rerender(
      createElement(MissionWorkPacket, {
        readback: readbackFixture(failedLast),
        packet: failedLast,
        missionId: MISSION_ID,
        onReload: view.onReload,
      }),
    );
    expect(view.container.textContent).toContain("最近一次观察失败，晚于最近成功观察");
    expect(view.container.textContent).not.toMatch(/无变化/);

    const laterReadAt = "2026-11-03T05:00:00.000Z";
    const refreshed = basePacket({
      observations: {
        readAt: laterReadAt,
        state: "OBSERVED",
        lastSuccessfulAt: LAST_SUCCESS,
        lastFailedAt: null,
        lastNoNewInformationAt: "2026-11-03T04:12:19.052Z",
        nextCheckAt: null,
        authority: "ORIGINAL_DELEGATION_RECORDS_ONLY",
      },
    });
    view.rerender(
      createElement(MissionWorkPacket, {
        readback: readbackFixture(refreshed),
        packet: refreshed,
        missionId: MISSION_ID,
        onReload: view.onReload,
      }),
    );
    const readAtValue = new Date(laterReadAt).toLocaleString("zh-CN");
    const lastSuccessValue = new Date(LAST_SUCCESS).toLocaleString("zh-CN");
    expect(screen.getByText("读取于").parentElement?.querySelector("dd")?.textContent).toBe(readAtValue);
    expect(screen.getByText("最近成功观察").parentElement?.querySelector("dd")?.textContent).toBe(lastSuccessValue);
  });

  it("null 累计用量与费用显示未知，不补 0", () => {
    const view = renderPacket(basePacket());
    const text = view.container.textContent ?? "";
    expect(text).toContain("上限 12 · 已记录累计 未知");
    expect(text).toContain("费用未知，未估算");
    expect(text).not.toContain("已记录累计 0");
    expect(text).not.toContain("费用 0");
    expect(text).not.toContain("费用未知，未估算（0）");
  });
  it("原状态与行动回执枚举中文化；原投影说明默认收起但仍可查", () => {
    const base = basePacket();
    const packet: WorkPacket = {
      ...base,
      identity: { ...base.identity, missionStatus: "WAITING_INPUT" },
      stopped: {
        ...base.stopped,
        missionStatus: "WAITING_INPUT",
        workState: workState({
          phase: "WAITING_USER",
          nextActor: "USER",
          requiresUser: true,
          reasonCode: "QUESTION_PENDING",
          reasonText: "需要你补充信息",
          actionLabel: "回答原问题",
        }),
        note: "原生命周期 WAITING_INPUT；显示阶段 WAITING_USER；停止请求 NONE（已结算/无请求）；未结算效果不存在。",
      },
      done: {
        ...base.done,
        actionReceipts: [
          { actionId: "action-1", title: "核对实验条件", status: "DONE", resultCardId: "card-1", completedAt: null, isSimulated: false },
        ],
      },
    };
    const view = renderPacket(packet);
    const text = view.container.textContent ?? "";
    expect(text).toContain("原状态：等待补充信息");
    expect(text).toContain("已完成");
    expect(text).toContain("已填写复盘回执");
    expect(screen.queryByText("DONE")).toBeNull();
    // 主视图（四问正文，不含默认收起的 details）不出现裸枚举
    const stoppedSection = screen
      .getByRole("region", { name: "原任务四问工作包" })
      .querySelector('section[aria-label="为何停下"]') as HTMLElement;
    const visible = Array.from(stoppedSection.children)
      .filter((node) => node.tagName !== "DETAILS")
      .map((node) => node.textContent)
      .join(" ");
    expect(visible).not.toContain("WAITING_INPUT");
    expect(visible).not.toContain("WAITING_USER");
    expect(visible).not.toContain("PAUSE_REQUESTED");
    // 原投影说明保留可查，默认收起
    const technical = screen.getByText("技术说明（原投影）").closest("details") as HTMLDetailsElement;
    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain("原生命周期 WAITING_INPUT");
  });
});

describe("C1 四问工作包：快照与旧后端", () => {
  it("VERSION_ADVANCED 显著提示并把主操作改为重新读取", () => {
    const packet = packetWithAction("ANSWER_QUESTION", "回答原问题", { kind: "QUESTION", id: "q-sample-user", version: null });
    const advanced: WorkPacket = {
      ...packet,
      snapshot: { ...packet.snapshot, consistency: "VERSION_ADVANCED", retries: 2 },
    };
    const view = renderPacket(advanced, { targets: true });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("读取期间版本已推进，提交前必须重新核对");
    const primary = screen.getByRole("button", { name: "重新读取" });
    fireEvent.click(primary);
    expect(view.onReload).toHaveBeenCalledTimes(1);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("已重新读取当前状态");
    expect(view.container.querySelectorAll("[data-mission-primary-action]")).toHaveLength(1);
  });

  it("RETRIED 说明已重读并采用同一快照", () => {
    const packet = basePacket({ snapshot: { ...basePacket().snapshot, consistency: "RETRIED", retries: 1 } });
    const view = renderPacket(packet);
    expect(view.container.textContent).toContain("已重读并采用同一快照");
  });

  it("旧后端缺 packet：只说明摘要暂未提供并保留原详情，不构造四问或成功事实", () => {
    const view = renderPacket(undefined);
    const text = view.container.textContent ?? "";
    expect(text).toContain("当前摘要暂未提供");
    expect(text).toContain("不据此推断成功或无变化");
    expect(text).toContain("等待执行");
    expect(text).toContain("今日调用额度已用完");
    expect(text).toContain("查看下次检查时间");
    expect(text).not.toContain("READY");
    expect(text).not.toContain("做到哪");
    expect(text).not.toContain("依据是什么");
    expect(text).not.toContain("为何停下");
    expect(text).not.toContain("现在等谁");
    expect(text).not.toContain("费用未知");
    expect(view.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("旧后端缺 workState 也不抛错：仍提示摘要暂未提供，不构造成功或费用事实", () => {
    let view: ReturnType<typeof renderPacket> | undefined;
    expect(() => {
      view = renderPacket(undefined, { readback: legacyReadbackWithoutWorkState() });
    }).not.toThrow();
    const text = view?.container.textContent ?? "";
    expect(text).toContain("当前摘要暂未提供");
    expect(text).toContain("不据此推断成功或无变化");
    expect(text).toContain("等待执行");
    expect(text).toContain("原状态未提供");
    expect(text).not.toContain("READY");
    expect(text).not.toContain("做到哪");
    expect(text).not.toContain("依据是什么");
    expect(text).not.toContain("为何停下");
    expect(text).not.toContain("现在等谁");
    expect(text).not.toContain("费用未知");
    expect(view?.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("readback 为 null（加载/失败）时不渲染四问，也不报成功", () => {
    const view = renderPacket(basePacket(), { readback: null });
    expect(view.container.textContent).toBe("");
    expect(view.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("读回非 fresh 时主操作禁用，且禁用不替代服务端校验", () => {
    const packet = packetWithAction("ANSWER_QUESTION", "回答原问题", { kind: "QUESTION", id: "q-sample-user", version: null });
    const view = renderPacket(packet, { disabled: true, targets: true });
    const primary = screen.getByRole("button", { name: "回答原问题" }) as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    fireEvent.click(primary);
    expect(view.onReload).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("不提交批准、执行或创建替代任务");
  });
});

describe("C1 唯一主动作：页面内定位或重新读取", () => {
  it("ANSWER_QUESTION 滚动并聚焦原问题容器内首个可聚焦控件", () => {
    const packet = packetWithAction("ANSWER_QUESTION", "回答原问题", { kind: "QUESTION", id: "q-sample-user", version: null });
    const view = renderPacket(packet, { targets: true });
    fireEvent.click(screen.getByRole("button", { name: "回答原问题" }));
    expect(scrollSpy).toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("补充信息");
    expect(view.onReload).not.toHaveBeenCalled();
  });

  it("REVIEW_APPROVAL 只聚焦匹配 approvalId 的容器，不点按钮", () => {
    const packet = packetWithAction("REVIEW_APPROVAL", "审阅待批准提案", { kind: "APPROVAL", id: APPROVAL_ID, version: null });
    const view = renderPacket(packet, { targets: true });
    fireEvent.click(screen.getByRole("button", { name: "审阅待批准提案" }));
    expect(document.activeElement?.textContent).toBe("批准提案");
    expect(view.onReload).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).not.toBe("另一个提案");
  });

  it("RESUME_DELEGATION 只聚焦恢复按钮，不替用户点击", () => {
    const packet = packetWithAction("RESUME_DELEGATION", "恢复原委托（重新核对条件）", { kind: "MISSION", id: MISSION_ID, version: 1 });
    const view = renderPacket(packet, { targets: true });
    fireEvent.click(screen.getByRole("button", { name: "恢复原委托（重新核对条件）" }));
    expect(document.activeElement?.textContent).toBe("确认后继续执行");
    expect(view.resumeClick).not.toHaveBeenCalled();
    expect(view.onReload).not.toHaveBeenCalled();
  });

  it("VIEW_RESULT 定位成果区域且不发起请求", () => {
    const packet = packetWithAction("VIEW_RESULT", "查看原结果", { kind: "MISSION", id: MISSION_ID, version: 1 });
    const view = renderPacket(packet, { targets: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "查看原结果" }));
    expect(scrollSpy).toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("查看复盘记录");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.onReload).not.toHaveBeenCalled();
  });

  it("CHECK_STOP_SETTLEMENT 等复核类动作只重新读取并提示，不播放成功动效", () => {
    const kinds: WorkPacketPrimaryActionKind[] = [
      "CHECK_STOP_SETTLEMENT",
      "WAIT_FOR_OBSERVATION",
      "RECHECK_AUTHORITY",
      "REVIEW_FAILURE",
    ];
    for (const kind of kinds) {
      const packet = packetWithAction(kind, "核对当前状态", { kind: "MISSION", id: MISSION_ID, version: 1 });
      const view = renderPacket(packet, { targets: true });
      fireEvent.click(screen.getByRole("button", { name: "核对当前状态" }));
      expect(view.onReload).toHaveBeenCalledTimes(1);
      expect(view.container.textContent).toContain("已重新读取当前状态");
      expect(scrollSpy).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("目标不存在时重新读取并提示原入口暂不可见", () => {
    const packet = packetWithAction("ANSWER_QUESTION", "回答原问题", { kind: "QUESTION", id: "q-sample-user", version: null });
    const view = renderPacket(packet, { targets: false });
    fireEvent.click(screen.getByRole("button", { name: "回答原问题" }));
    expect(view.onReload).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain("原入口暂不可见，已重新读取");
  });

  it("NONE 不渲染主操作，组件不发起任何 fetch 或写请求", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const packet = packetWithAction("NONE", "无需操作", null);
    const view = renderPacket(packet);
    expect(view.container.querySelectorAll("[data-mission-primary-action]")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
