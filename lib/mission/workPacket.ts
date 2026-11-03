/**
 * 四问工作包的纯构造器。
 *
 * 输入是服务层已收集好的原事实（Mission/WorkState/责任摘要/Step/Output/回执/进展/资料使用/
 * 证据审查/观察事件时间/旧批准与问题 refs/覆盖/快照参数），通过导出的 {@link WorkPacketInput}
 * 显式传入，由服务负责在同一只读事务内收集。observations.state 与 lastSuccessfulAt/
 * lastFailedAt/lastNoNewInformationAt 由构造器依据传入时间戳与失败窗口派生。
 * 本文件不读库、不调模型、不发网络、不写任何业务状态，也绝不使用除传入 now 以外的时间来源。
 *
 * 选择唯一主操作的顺序（Lead 裁决）：
 * a. 终态 + 未结算 UNKNOWN 效果 → CHECK_UNKNOWN_EFFECT
 * b. 权限/许可/期限边界已过、个人记忆边界越过或 STOPPED → RECHECK_AUTHORITY
 * c. 停止请求在途 → CHECK_STOP_SETTLEMENT
 * d. RUNNING 执行中（无停止在途，lease 有效）→ WAIT_FOR_OBSERVATION（查看委托进展（执行中））
 * e. 当前有效原问题 / 待批准提案 → ANSWER_QUESTION / REVIEW_APPROVAL（过期批准改重核）
 * f. 额度等待 / 租约等待 / 观察等待 → WAIT_FOR_OBSERVATION（租约过期不标为许可重核）
 * g. FAILED / 未知执行 → REVIEW_FAILURE / RECHECK_AUTHORITY
 * h. 终态无未结算效果 → VIEW_RESULT（取消与成功文案区分）
 * 其余阻断全部进入 blockers[]，不因选择主操作而丢失。
 */
import {
  WORK_PACKET_CONTRACT_VERSION,
  WORK_PACKET_SCHEMA_VERSION,
  type WorkPacket,
  type WorkPacketActionReceipt,
  type WorkPacketAuthority,
  type WorkPacketBlocker,
  type WorkPacketBlockerKind,
  type WorkPacketCoverageWindow,
  type WorkPacketMaterialUses,
  type WorkPacketNext,
  type WorkPacketOutputRef,
  type WorkPacketPrimaryAction,
  type WorkPacketPrimaryActionKind,
  type WorkPacketProgress,
  type WorkPacketSnapshotConsistency,
  type WorkPacketStep,
  type WorkPacketStopped,
  type WorkPacketTarget,
  type WorkPacketWaitingOn,
  type WorkPacketEvidenceReviews,
  type WorkPacketMaterialUseItem,
  type WorkPacketUnknownEffect,
  type WorkPacketStopRequest,
} from "@/lib/types/workPacket";
import type { WorkState, WorkStateTerminal } from "@/lib/types/workState";

const iso = (v: unknown): string | null => {
  const n = v instanceof Date ? +v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const at = (v: string | null): number | null => {
  const n = v === null ? NaN : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
/** 多来源时间取最早的有效值；null 表示一个有效边界都没有，不等于时间不存在。 */
const earliest = (...values: Array<string | null | undefined>): string | null => {
  let best: { iso: string; time: number } | null = null;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (!best || parsed < best.time) best = { iso: new Date(parsed).toISOString(), time: parsed };
  }
  return best ? best.iso : null;
};
const first = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const parsed = iso(value);
    if (parsed) return parsed;
  }
  return null;
};
const limitOf = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(50, Math.trunc(value as number))) : fallback;
const count = (value: unknown, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : fallback;

/** 输入：原 Mission 关键字段。不重复传入可由原记录直接读出的完整对象。 */
export type WorkPacketMissionFacts = {
  missionId: string;
  projectId: string;
  missionVersion: number;
  missionStatus: string;
  planRevision: number;
  contextVersion: number;
  constraintsVersion: number;
  researchScopeVersion: number;
  /** 原 lastErrorJson.code；只在 workState 旧版本缺 unsettledEffect 时用于回退。 */
  lastErrorCode?: string | null;
  /** 原终态时间；workState.terminal 缺失时用于回退。 */
  finishedAt?: string | null;
  updatedAt?: string | null;
  /** 原停止请求；workState 旧版本缺 stopRequest 时用于回退。 */
  pauseRequestedAt?: string | null;
  cancelRequestedAt?: string | null;
  pauseReason?: string | null;
};

/** 输入：责任/权限摘要，只作读取事实，不构成授权。 */
export type WorkPacketResponsibilityFacts = {
  controlVersion?: string | null;
  permissionState?: "WITHIN_TIME_BOUNDARY" | "EXPIRED" | "STOPPED" | string | null;
  permissionExpiresAt?: string | null;
  deadline?: string | null;
  workerPresence?: "UNOBSERVED" | "RECENT" | "STALE" | string | null;
  effectiveNextCheckAt?: string | null;
  /** 原个人记忆依赖的最早有效边界；缺失只表示没有可展示的边界，不等于没有依赖。 */
  personalMemoryNextBoundary?: string | null;
  budget?: {
    limits: Record<string, number>;
    /** null 表示原累计计数未知，不补 0、不因重启/跨日重置。 */
    cumulativeUsed: Record<string, number | null>;
    /** 累计用量在重启/跨日不重置；工作包只读，不改计数。 */
    policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE" | string;
    monetaryCost: null;
  } | null;
};

export type WorkPacketStepFact = {
  id: string;
  ordinal: number;
  toolName: string;
  status: string;
  at?: string | null;
  /** 确定性标签（原工具/状态文案），不是模型摘要。 */
  note?: string | null;
};

export type WorkPacketReceiptFact = {
  actionId: string;
  title?: string | null;
  status: string;
  resultCardId?: string | null;
  completedAt?: string | null;
  isSimulated?: boolean;
};

export type WorkPacketInput = {
  mission: WorkPacketMissionFacts;
  /** 原 WorkState 投影；直接透传为 stopped.workState，不在工作包内二次推断生命周期。 */
  workState: WorkState;
  responsibility?: WorkPacketResponsibilityFacts | null;
  observations?: {
    lastSuccessfulAt?: string | null;
    lastFailedAt?: string | null;
    lastNoNewInformationAt?: string | null;
    nextCheckAt?: string | null;
  } | null;
  work?: {
    steps?: WorkPacketStepFact[];
    stepsLimit?: number;
    stepsTruncated?: boolean;
    latestOutput?: { id: string; revision: number; createdAt?: string | null } | null;
    actionReceipts?: WorkPacketReceiptFact[];
    actionReceiptsLimit?: number;
    actionReceiptsTruncated?: boolean;
    progress?: WorkPacketProgress | null;
  } | null;
  basis?: {
    questionId?: string | null;
    materialUses?: WorkPacketMaterialUses | null;
    evidenceReviews?: WorkPacketEvidenceReviews | null;
    currentUsePolicy?: "SOURCE_POLICY_APPLIED" | "NOT_APPLIED" | null;
  } | null;
  /** 旧问题/旧批准 refs；只有仍有效的 ref 才能生成回答/审阅动作。 */
  pendingOriginalRefs?: {
    questionId?: string | null;
    approvals?: Array<{ id: string; proposalHash?: string | null; expiresAt?: string | null; status?: string | null }>;
  } | null;
  coverage?: {
    windows?: Array<{ name: string; limit: number; returned?: number; truncated?: boolean; note?: string | null }>;
  } | null;
  snapshot?: {
    consistency?: WorkPacketSnapshotConsistency;
    retries?: number;
    checkedAt?: string | null;
  } | null;
  /** 服务层已判定为当前来源阻断的摘要；A1 不自行调用 SourcePolicy。 */
  sourceAlerts?: Array<{ code: string; text: string; at?: string | null; blocksActions?: boolean; sourceId?: string | null }> | null;
  /** 提交主操作需要复核的源修订；缺省时从当前可用资料推导。 */
  requiredSourceRevisions?: string[] | null;
};

const BLOCKER_ORDER: WorkPacketBlockerKind[] = ["AUTHORITY", "WORK_STATE", "STOP_REQUEST", "BUDGET", "SOURCE", "APPROVAL", "QUESTION", "LEASE", "UNKNOWN_EFFECT", "FAILURE", "DELEGATION", "TIME_BOUNDARY"];

const COVERAGE_NOTE_TRUNCATED = "有界窗口已截断：仅包含最近记录，未包含的记录不等于从未发生。";
const COVERAGE_NOTE_EMPTY = "有界窗口内未找到记录只表示覆盖不足，不等于从未发生。";
const coverageNote = (truncated: boolean) => truncated ? COVERAGE_NOTE_TRUNCATED : COVERAGE_NOTE_EMPTY;

const terminalOf = (workState: WorkState, mission: WorkPacketMissionFacts): WorkStateTerminal | null => {
  if (workState.terminal && workState.terminal !== null) return workState.terminal;
  if (mission.missionStatus !== "SUCCEEDED" && mission.missionStatus !== "CANCELLED") return null;
  const finishedAt = iso(mission.finishedAt), updatedAt = iso(mission.updatedAt);
  return {
    status: mission.missionStatus,
    at: finishedAt ?? updatedAt,
    // NO_TIME：原记录没有可用的终态/修订时间，不用 UPDATED_AT 伪装。
    atSource: finishedAt ? "FINISHED_AT" : updatedAt ? "UPDATED_AT" : "NO_TIME",
    reasonCode: mission.missionStatus,
  };
};

const unknownEffectOf = (workState: WorkState, mission: WorkPacketMissionFacts): WorkPacketUnknownEffect => {
  if (workState.unsettledEffect) return workState.unsettledEffect;
  const code = typeof mission.lastErrorCode === "string" && mission.lastErrorCode ? mission.lastErrorCode : null;
  if (code && /UNKNOWN/.test(code)) {
    return { present: true, code, source: "LAST_ERROR", reasonText: "原请求或外部效果尚未结算，读取不会自动核销", resolvedByRead: false };
  }
  // 旧 WorkState 只有 UNKNOWN phase 时，至少把“执行状态未知”作为未结算事实保留。
  if (workState.phase === "UNKNOWN" && workState.reasonCode !== "WAIT_CONDITION_UNKNOWN") {
    return { present: true, code: workState.reasonCode, source: "LAST_ERROR", reasonText: "原请求状态待核对，读取不会自动核销", resolvedByRead: false };
  }
  return { present: false, code: null, source: "NONE", reasonText: null, resolvedByRead: false };
};

const stopRequestOf = (workState: WorkState, mission: WorkPacketMissionFacts): WorkPacketStopRequest => {
  if (workState.stopRequest) return workState.stopRequest;
  const pauseAt = iso(mission.pauseRequestedAt), cancelAt = iso(mission.cancelRequestedAt), pauseByUser = mission.pauseReason === "USER";
  if (mission.missionStatus === "CANCELLED" && cancelAt) return { state: "CANCEL_SETTLED", requestedAt: cancelAt, settled: true, note: "取消请求已结算：原委托已取消，历史结果保留，不能视为成功完成" };
  if (mission.missionStatus === "PAUSED" && (pauseAt || pauseByUser)) return { state: "PAUSE_SETTLED", requestedAt: pauseAt, settled: true, note: "暂停请求已结算：原委托已暂停，不会继续派发新步骤" };
  if (cancelAt) return { state: "CANCEL_REQUESTED", requestedAt: cancelAt, settled: false, note: "已收到取消请求，等待本轮调用结算，不会继续派发新步骤" };
  if (pauseAt || (pauseByUser && mission.missionStatus === "RUNNING")) return { state: "PAUSE_REQUESTED", requestedAt: pauseAt, settled: false, note: "已收到停止请求，等待本轮调用结算，不会继续派发新步骤" };
  return { state: "NONE", requestedAt: null, settled: true, note: null };
};

/** 确定性组合、排序、裁剪与规则选择。无 IO、无模型、除 now 外无时间来源。 */
export function buildMissionWorkPacket(input: WorkPacketInput, now: Date = new Date()): WorkPacket {
  const nowIso = now.toISOString(), nowMs = +now;
  const mission = input.mission, workState = input.workState;
  const responsibility = input.responsibility ?? null;
  const terminal = terminalOf(workState, mission);
  const terminalStatus = terminal?.status ?? null;
  const unknownEffect = unknownEffectOf(workState, mission);
  const unknownPresent = unknownEffect.present;
  const stopRequest = stopRequestOf(workState, mission);
  const stopInFlight = !stopRequest.settled;
  const controlVersion = responsibility?.controlVersion ?? null;
  const rawPermissionState = responsibility?.permissionState ?? null;
  // 原 permissionState 只有三种有效取值；缺失/未知不当作“许可仍有效”，也不当作已过期。
  const permissionState: "WITHIN_TIME_BOUNDARY" | "EXPIRED" | "STOPPED" | "UNKNOWN" =
    rawPermissionState === "WITHIN_TIME_BOUNDARY" || rawPermissionState === "EXPIRED" || rawPermissionState === "STOPPED" ? rawPermissionState : "UNKNOWN";
  const permissionExpiresAt = iso(responsibility?.permissionExpiresAt);
  const deadline = iso(responsibility?.deadline);
  const personalMemoryNextBoundary = iso(responsibility?.personalMemoryNextBoundary);
  const workerPresence = responsibility?.workerPresence ?? null;

  const questionId = input.basis?.questionId ?? workState.exactQuestionRef ?? input.pendingOriginalRefs?.questionId ?? null;

  // 观察时间只来自原事件/原委托记录；readAt 才是本次读取。
  const lastSuccessfulAt = iso(input.observations?.lastSuccessfulAt) ?? workState.observedAt ?? null;
  const lastFailedAt = iso(input.observations?.lastFailedAt);
  const lastNoNewInformationAt = iso(input.observations?.lastNoNewInformationAt);
  const observationNextCheckAt = first(input.observations?.nextCheckAt, workState.nextCheckAt, responsibility?.effectiveNextCheckAt);
  const observationState: "OBSERVED" | "NOT_OBSERVED" | "FAILED_LAST" =
    lastFailedAt && (!lastSuccessfulAt || (at(lastFailedAt) as number) >= (at(lastSuccessfulAt) as number)) ? "FAILED_LAST"
      : lastSuccessfulAt ? "OBSERVED" : "NOT_OBSERVED";

  // 有界工作窗口：排序稳定（ordinal 倒序、id 兜底），裁剪只发生在这里。
  const stepLimit = limitOf(input.work?.stepsLimit, 5), receiptLimit = limitOf(input.work?.actionReceiptsLimit, 5);
  const allSteps = [...(input.work?.steps ?? [])].sort((a, b) =>
    b.ordinal - a.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stepsTruncated = input.work?.stepsTruncated === true || allSteps.length > stepLimit;
  const recentSteps: WorkPacketStep[] = allSteps.slice(0, stepLimit).map(step => ({
    id: step.id, ordinal: step.ordinal, toolName: step.toolName, status: step.status,
    at: iso(step.at), note: step.note ?? null,
  }));
  const allReceipts = [...(input.work?.actionReceipts ?? [])].sort((a, b) => {
    const ca = iso(a.completedAt), cb = iso(b.completedAt);
    if (ca !== cb) { if (ca === null) return 1; if (cb === null) return -1; return ca < cb ? 1 : -1; }
    return a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;
  });
  const receiptsTruncated = input.work?.actionReceiptsTruncated === true || allReceipts.length > receiptLimit;
  const actionReceipts: WorkPacketActionReceipt[] = allReceipts.slice(0, receiptLimit).map(receipt => ({
    actionId: receipt.actionId, title: receipt.title ?? null, status: receipt.status,
    resultCardId: receipt.resultCardId ?? null, completedAt: iso(receipt.completedAt), isSimulated: receipt.isSimulated === true,
  }));
  const latestOutput: WorkPacketOutputRef | null = input.work?.latestOutput ? {
    id: input.work.latestOutput.id, revision: input.work.latestOutput.revision,
    createdAt: iso(input.work.latestOutput.createdAt),
  } : null;
  const progress = input.work?.progress ?? null;

  const materialUses = input.basis?.materialUses ?? null;
  const evidenceReviews = input.basis?.evidenceReviews ?? null;
  const materialItems: WorkPacketMaterialUseItem[] = materialUses?.items ?? [];
  const sourceUnavailable = materialItems.some(item => item.availability === "UNAVAILABLE" || (item.currentUse ? item.currentUse.state !== "ALLOWED" : false));
  const currentUsePolicy: "SOURCE_POLICY_APPLIED" | "NOT_APPLIED" = input.basis?.currentUsePolicy
    ?? (materialItems.some(item => item.currentUse !== undefined) ? "SOURCE_POLICY_APPLIED" : "NOT_APPLIED");
  // NO_CHANGE 只是最近一次成功观察的结论：必须已有成功观察、“无变化”事件不早于它，且没有来源不可用。
  const canShowNoChange = observationState === "OBSERVED" && lastNoNewInformationAt !== null
    && lastSuccessfulAt !== null && (at(lastNoNewInformationAt) as number) >= (at(lastSuccessfulAt) as number)
    && !sourceUnavailable;

  // ---- 权限/边界事实 ----
  const permissionExpired = permissionState === "EXPIRED" || (permissionExpiresAt !== null && (at(permissionExpiresAt) as number) <= nowMs);
  const permissionStopped = permissionState === "STOPPED";
  const deadlinePassed = deadline !== null && (at(deadline) as number) <= nowMs;
  const projectionAuthorityLost = workState.reasonCode === "DELEGATION_EXPIRED" || workState.reasonCode === "PERMISSION_EXPIRED";
  // 租约过期由 LEASE blocker/等待处理，不标为许可边界失效；个人记忆边界越界必须重新核对。
  const boundaryPassed = workState.reasonCode !== "LEASE_UNCONFIRMED"
    && workState.nextBoundary !== null && (at(workState.nextBoundary) as number) <= nowMs;
  const personalBoundaryPassed = personalMemoryNextBoundary !== null && (at(personalMemoryNextBoundary) as number) <= nowMs;
  const authorityRecheck = !terminalStatus && (permissionExpired || permissionStopped || deadlinePassed || projectionAuthorityLost || boundaryPassed || personalBoundaryPassed);

  // ---- 旧问题/旧批准：只有当前有效 ref 才能生成回答/审阅动作 ----
  const approvalRefs = input.pendingOriginalRefs?.approvals ?? [];
  const exactApprovalId = workState.exactApprovalRef ?? null;
  const matchedApproval = exactApprovalId ? approvalRefs.find(ref => ref.id === exactApprovalId) ?? null : null;
  const approvalReferenceExpired = matchedApproval !== null && (
    (matchedApproval.expiresAt !== null && matchedApproval.expiresAt !== undefined && (Date.parse(matchedApproval.expiresAt) || 0) <= nowMs)
    || (matchedApproval.status !== null && matchedApproval.status !== undefined && matchedApproval.status !== "PENDING"));
  const approvalValid = workState.phase === "WAITING_APPROVAL" && exactApprovalId !== null
    && !approvalReferenceExpired
    // 旧服务未提供 refs 时以原 WorkState 的 current ref 为准；只有 refs 明确失效才否决。
    && (approvalRefs.length === 0 || matchedApproval !== null);

  // 最早有效边界：原审批到期、许可到期、期限、个人记忆边界与 WorkState 边界的最早值。
  const authorityNextBoundary = earliest(
    approvalValid ? matchedApproval?.expiresAt ?? null : null,
    permissionExpiresAt,
    deadline,
    personalMemoryNextBoundary,
    workState.nextBoundary,
  );
  const budgetFacts = responsibility?.budget ?? null;
  // authority 只做展示与主操作判定，不产生执行资格；累计用量原样展示，不补 0、不清零。
  const authority: WorkPacketAuthority = {
    controlVersion,
    permissionState,
    permissionExpiresAt,
    deadline,
    nextBoundary: authorityNextBoundary,
    effectiveNextCheckAt: first(responsibility?.effectiveNextCheckAt, observationNextCheckAt),
    workerPresence: workerPresence ?? "UNOBSERVED",
    budget: {
      limits: { ...(budgetFacts?.limits ?? {}) },
      cumulativeUsed: { ...(budgetFacts?.cumulativeUsed ?? {}) },
      policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
      monetaryCost: null,
    },
    note: "VIEW_ONLY_NO_EXECUTION_PERMISSION",
  };

  // ---- 主操作选择（顺序见文件头） ----
  type Draft = { kind: WorkPacketPrimaryActionKind; label: string; target: WorkPacketTarget | null };
  const missionTarget: WorkPacketTarget = { kind: "MISSION", id: mission.missionId, version: mission.missionVersion };
  const resultTarget: WorkPacketTarget | null = latestOutput ? { kind: "OUTPUT", id: latestOutput.id, version: latestOutput.revision } : null;
  const budgetWaiting = workState.reasonCode === "DAILY_BUDGET_WAITING";
  const leaseWaiting = workState.reasonCode === "LEASE_UNCONFIRMED";
  const observationWaiting = workState.phase === "WAITING_OBSERVATION";
  const delegationDisabled = workState.reasonCode === "DELEGATION_DISABLED";
  const queuedWaiting = workState.phase === "QUEUED";
  let waitingOn: WorkPacketWaitingOn = "NONE";
  let draft: Draft | null = null;
  if (terminalStatus && unknownPresent) {
    draft = { kind: "CHECK_UNKNOWN_EFFECT", label: terminalStatus === "CANCELLED" ? "查看取消前原结果并核对未知调用" : "查看原结果并核对未知调用", target: resultTarget ?? missionTarget };
  } else if (authorityRecheck) {
    draft = { kind: "RECHECK_AUTHORITY", label: permissionStopped ? "重新核对已停止的许可" : "重新核对许可与期限", target: missionTarget };
    waitingOn = "USER_RECHECK";
  } else if (stopInFlight) {
    draft = { kind: "CHECK_STOP_SETTLEMENT", label: "核对停止结算", target: missionTarget };
    waitingOn = "SYSTEM_SETTLEMENT";
  } else if (workState.phase === "RUNNING") {
    // 正在执行且没有停止在途：等待原 Worker 的进展/观察，不伪造“继续”动作。
    draft = { kind: "WAIT_FOR_OBSERVATION", label: "查看委托进展（执行中）", target: missionTarget };
    waitingOn = "SYSTEM_WORKER";
  } else if (workState.phase === "WAITING_USER" && workState.exactQuestionRef) {
    draft = { kind: "ANSWER_QUESTION", label: "回答原问题", target: { kind: "QUESTION", id: workState.exactQuestionRef, version: null } };
    waitingOn = "USER_INPUT";
  } else if (workState.phase === "WAITING_APPROVAL") {
    if (approvalValid && exactApprovalId) {
      draft = { kind: "REVIEW_APPROVAL", label: "审阅待批准提案", target: { kind: "APPROVAL", id: exactApprovalId, version: null } };
      waitingOn = "USER_APPROVAL";
    } else {
      draft = { kind: "RECHECK_AUTHORITY", label: "重新核对提案依据", target: missionTarget };
      waitingOn = "USER_RECHECK";
    }
  } else if (budgetWaiting || leaseWaiting || observationWaiting || delegationDisabled || queuedWaiting) {
    const label = budgetWaiting ? "等待额度恢复后再核对" : leaseWaiting ? "等待租约重新确认" : delegationDisabled ? "等待跟进服务可用" : observationWaiting ? "等待下次观察" : "等待原委托执行";
    draft = { kind: "WAIT_FOR_OBSERVATION", label, target: missionTarget };
    waitingOn = budgetWaiting ? "BUDGET_RESET" : leaseWaiting ? "SYSTEM_LEASE" : delegationDisabled || queuedWaiting ? "SYSTEM_WORKER" : "SYSTEM_OBSERVATION";
  } else if (workState.phase === "FAILED") {
    draft = { kind: "REVIEW_FAILURE", label: "查看失败原因与恢复条件", target: missionTarget };
    waitingOn = "SYSTEM_RECHECK";
  } else if (workState.phase === "UNKNOWN") {
    draft = { kind: "RECHECK_AUTHORITY", label: "核对当前状态", target: missionTarget };
    waitingOn = "SYSTEM_RECHECK";
  } else if (workState.phase === "PAUSED") {
    draft = stopRequest.state === "PAUSE_SETTLED"
      ? { kind: "RESUME_DELEGATION", label: "恢复原委托（重新核对条件）", target: missionTarget }
      : { kind: "RECHECK_AUTHORITY", label: "核对当前状态", target: missionTarget };
    waitingOn = "USER_RECHECK";
  } else if (terminalStatus) {
    draft = { kind: "VIEW_RESULT", label: terminalStatus === "CANCELLED" ? "查看取消前的原结果" : "查看原结果", target: resultTarget ?? missionTarget };
    waitingOn = "NONE";
  } else {
    draft = { kind: "RECHECK_AUTHORITY", label: "核对当前状态", target: missionTarget };
    waitingOn = "SYSTEM_RECHECK";
  }

  // ---- 阻断：全部保留，按固定类别顺序排序；主操作不吞掉其他阻断 ----
  const blocker = (kind: WorkPacketBlockerKind, code: string, text: string, atValue: string | null, blocksActions: boolean, originalRef: WorkPacketBlocker["originalRef"] = null): WorkPacketBlocker =>
    ({ kind, code, text, at: atValue, blocksActions, originalRef });
  const blockers: WorkPacketBlocker[] = [];
  if (!terminalStatus) {
    if (permissionStopped) blockers.push(blocker("AUTHORITY", "PERMISSION_STOPPED", "原许可已停止；恢复前需重新核对授权与来源，不会自动继续", null, true, { kind: "MISSION", id: mission.missionId }));
    else if (permissionExpired) blockers.push(blocker("AUTHORITY", "PERMISSION_EXPIRED", "原许可已到期；越界后旧操作资格不再有效，需要重新核对", permissionExpiresAt ?? workState.nextBoundary, true, { kind: "MISSION", id: mission.missionId }));
    if (deadlinePassed) blockers.push(blocker("TIME_BOUNDARY", "DEADLINE_PASSED", "原期限已过；需要重新核对范围与依据", deadline, true, { kind: "MISSION", id: mission.missionId }));
    if (personalBoundaryPassed) blockers.push(blocker("TIME_BOUNDARY", "PERSONAL_MEMORY_BOUNDARY_PASSED", "个人记忆依赖的有效边界已过；依赖该偏好的判断需重新核对，不能沿用旧依据", personalMemoryNextBoundary, true, { kind: "MISSION", id: mission.missionId }));
    if (boundaryPassed && workState.nextBoundary !== permissionExpiresAt) blockers.push(blocker("TIME_BOUNDARY", "BOUNDARY_PASSED", "原相关有效边界已过；需要重新读取后核对，旧操作资格不再有效", workState.nextBoundary, true, { kind: "MISSION", id: mission.missionId }));
    if (workState.phase === "UNKNOWN" && workState.reasonCode !== "QUESTION_PENDING" && workState.reasonCode !== "APPROVAL_PENDING")
      blockers.push(blocker("WORK_STATE", workState.reasonCode, "原状态需核对；已保存进度保留，读取不会自动推进", null, true, { kind: "MISSION", id: mission.missionId }));
    if (workerPresence !== null && workerPresence !== "RECENT")
      blockers.push(blocker("WORK_STATE", "WORKER_PRESENCE_" + String(workerPresence), "后台 Worker 心跳不可靠，尚未核实近期执行；心跳不等于成功观察", null, true, { kind: "MISSION", id: mission.missionId }));
    if (stopInFlight) blockers.push(blocker("STOP_REQUEST", stopRequest.state, stopRequest.note ?? "已收到停止请求，等待本轮调用结算，不会继续派发新步骤", stopRequest.requestedAt, true, { kind: "MISSION", id: mission.missionId }));
    if (budgetWaiting) blockers.push(blocker("BUDGET", "DAILY_BUDGET_WAITING", "今日调用额度已用完，累计用量保留；不凭日期放宽许可，到下次检查时间再核对", workState.nextCheckAt, true, { kind: "MISSION", id: mission.missionId }));
    if (leaseWaiting) blockers.push(blocker("LEASE", "LEASE_UNCONFIRMED", "执行租约未确认；需要重新核对执行状态，已保存步骤保留", null, true, { kind: "MISSION", id: mission.missionId }));
    if (workState.phase === "WAITING_USER" && workState.exactQuestionRef)
      blockers.push(blocker("QUESTION", "QUESTION_PENDING", "原问题等待你的补充；回答绑定原问题，旧问题不能替换成新问题", null, true, { kind: "QUESTION", id: workState.exactQuestionRef }));
    if (workState.phase === "WAITING_APPROVAL") {
      if (approvalValid && exactApprovalId) blockers.push(blocker("APPROVAL", "APPROVAL_PENDING", "原提案等待你的批准；旧批准不能替代当前版本", matchedApproval?.expiresAt ?? null, true, { kind: "APPROVAL", id: exactApprovalId }));
      else blockers.push(blocker("APPROVAL", "APPROVAL_EXPIRED", "原提案已过期或已失效；旧批准不能继续作为当前依据，需要重新核对", matchedApproval?.expiresAt ?? null, true, exactApprovalId ? { kind: "APPROVAL", id: exactApprovalId } : { kind: "MISSION", id: mission.missionId }));
    }
    if (workState.reasonCode === "DELEGATION_EXPIRED")
      blockers.push(blocker("DELEGATION", "DELEGATION_EXPIRED", "持续跟进许可已到期；恢复前需重新核对范围、预算与来源", workState.nextBoundary, true, { kind: "MISSION", id: mission.missionId }));
    if (delegationDisabled)
      blockers.push(blocker("DELEGATION", "DELEGATION_DISABLED", "持续跟进服务当前不可用；原许可与进度保留", null, true, { kind: "MISSION", id: mission.missionId }));
    if (workState.phase === "FAILED" || mission.missionStatus === "FAILED")
      blockers.push(blocker("FAILURE", typeof mission.lastErrorCode === "string" && mission.lastErrorCode ? mission.lastErrorCode : workState.reasonCode, "原步骤失败；原进度保留，恢复前需核对原因，不会自动重试", lastFailedAt, true, { kind: "MISSION", id: mission.missionId }));
  }
  if (unknownPresent) blockers.push(blocker("UNKNOWN_EFFECT", unknownEffect.code ?? "UNSETTLED_UNKNOWN_EFFECT", unknownEffect.reasonText ?? "原调用结果尚未结算；读取不会自动核销，需要核对原请求", lastFailedAt,
    true, latestOutput ? { kind: "OUTPUT", id: latestOutput.id } : { kind: "MISSION", id: mission.missionId }));
  // 来源阻断与终态无关：历史留痕保留，但当前是否可继续作为依据必须展开。
  for (const item of materialItems) {
    if (item.availability === "CHANGED") blockers.push(blocker("SOURCE", "SOURCE_CHANGED", "原资料修订已变化，历史留痕保留；当前依据需重新核对", null, true, { kind: "SOURCE", id: item.sourcePointer.id }));
    else if (item.availability === "UNAVAILABLE") blockers.push(blocker("SOURCE", "SOURCE_UNAVAILABLE", "原资料当前不可用，历史摘录仍按原身份保留；不能当作当前已核对", null, false, { kind: "SOURCE", id: item.sourcePointer.id }));
    if (item.currentUse?.state === "SUPPRESSED") blockers.push(blocker("SOURCE", "CURRENT_USE_SUPPRESSED", "当前来源许可已被撤回；历史留痕保留，不能作为当前独立证据", null, true, { kind: "SOURCE", id: item.sourcePointer.id }));
    else if (item.currentUse?.state === "UNKNOWN") blockers.push(blocker("SOURCE", "CURRENT_USE_UNKNOWN", "当前来源链未知；不能作为当前独立证据", null, true, { kind: "SOURCE", id: item.sourcePointer.id }));
  }
  for (const alert of input.sourceAlerts ?? []) blockers.push(blocker("SOURCE", alert.code, alert.text, iso(alert.at), alert.blocksActions !== false, alert.sourceId ? { kind: "SOURCE", id: alert.sourceId } : null));
  const consistency: WorkPacketSnapshotConsistency = input.snapshot?.consistency ?? "VERSION_STABLE";
  if (consistency === "VERSION_ADVANCED")
    blockers.push(blocker("WORK_STATE", "SNAPSHOT_VERSION_ADVANCED", "读取期间版本已推进且未在快照内收敛；提交前必须重新核对全部版本，不得混用新旧事实", nowIso, true, { kind: "MISSION", id: mission.missionId }));
  const kindIndex = (kind: WorkPacketBlockerKind) => BLOCKER_ORDER.indexOf(kind);
  // 阻断排序必须是有效比较器：先按固定类别顺序，再按 code，最后按原对象 id 兜底，保证同输入同输出。
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  blockers.sort((a, b) =>
    (kindIndex(a.kind) - kindIndex(b.kind))
    || compareText(a.code, b.code)
    || compareText(a.originalRef?.id ?? "", b.originalRef?.id ?? ""));

  // primaryBlock：优先选与主操作对应的阻断，否则取第一条阻断动作的阻断。
  const actionBlockerKinds: Partial<Record<WorkPacketPrimaryActionKind, WorkPacketBlockerKind[]>> = {
    CHECK_UNKNOWN_EFFECT: ["UNKNOWN_EFFECT"], RECHECK_AUTHORITY: ["AUTHORITY", "TIME_BOUNDARY", "APPROVAL", "DELEGATION", "WORK_STATE"],
    CHECK_STOP_SETTLEMENT: ["STOP_REQUEST"], ANSWER_QUESTION: ["QUESTION"], REVIEW_APPROVAL: ["APPROVAL"],
    WAIT_FOR_OBSERVATION: ["BUDGET", "LEASE", "DELEGATION", "WORK_STATE"], REVIEW_FAILURE: ["FAILURE", "WORK_STATE"],
  };
  const primaryBlock = draft
    ? (actionBlockerKinds[draft.kind] ?? []).map(kind => blockers.find(entry => entry.kind === kind && entry.blocksActions)).find(Boolean) ?? blockers.find(entry => entry.blocksActions) ?? null
    : blockers.find(entry => entry.blocksActions) ?? null;

  // ---- 提交要求：全量版本 + 原对象 ref + 边界；读取不授予资格 ----
  const approvalHash = draft.kind === "REVIEW_APPROVAL" ? matchedApproval?.proposalHash ?? null : null;
  const requiredSourceRevisions = input.requiredSourceRevisions
    ?? materialItems.filter(item => item.availability === "CURRENT" && (item.currentUse ? item.currentUse.state === "ALLOWED" : false))
      .map(item => `${item.sourcePointer.id}@${item.sourcePointer.hash}`);
  const requires = {
    missionVersion: mission.missionVersion,
    planRevision: mission.planRevision,
    contextVersion: mission.contextVersion,
    constraintsVersion: mission.constraintsVersion,
    researchScopeVersion: mission.researchScopeVersion,
    controlVersion,
    questionId,
    approvalId: draft.kind === "REVIEW_APPROVAL" ? exactApprovalId : null,
    proposalHash: approvalHash,
    requiredSourceRevisions,
    boundaryAt: authorityNextBoundary,
  };
  const primaryAction: WorkPacketPrimaryAction = {
    kind: draft.kind, label: draft.label, target: draft.target, requires,
    submissionGuard: "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY",
    readOnly: true,
  };

  // ---- 四问的确定性文案 ----
  const noteParts: string[] = [];
  if (draft.kind === "CHECK_UNKNOWN_EFFECT") noteParts.push("终态与未结算效果并列保留：先核对原结果与未知调用，读取工作包不会自动结算，也不能重新派发。");
  else if (draft.kind === "RECHECK_AUTHORITY") noteParts.push("原许可/期限/提案依据已变化，需重新核对；不会自动恢复执行。");
  else if (draft.kind === "CHECK_STOP_SETTLEMENT") noteParts.push("停止请求已收到但尚未结算；等待本轮调用结算后重新读取，不建议继续派发。");
  else if (draft.kind === "ANSWER_QUESTION") noteParts.push("回答绑定原问题；旧问题不能替换成新问题，提交后由服务端重查版本与来源。");
  else if (draft.kind === "REVIEW_APPROVAL") noteParts.push("只审阅当前有效提案；过期批准不能继续作为依据。");
  else if (draft.kind === "WAIT_FOR_OBSERVATION") {
    if (budgetWaiting) noteParts.push("今日额度已用完，累计用量保留；到下次检查时间再核对，不凭日期自动放行。");
    else if (leaseWaiting) noteParts.push("执行租约未确认；重新核对执行状态后再判断，后台心跳不等于成功观察。");
    else if (observationWaiting) noteParts.push(canShowNoChange ? "最近一次成功观察未发现新变化；这是观察结论，可与等待观察并存，不是生命周期终态。" : observationState === "FAILED_LAST" ? "最近一次观察失败；不能显示为无变化。" : "等待下次观察，尚未形成“无变化”结论；未观察到不等于从未发生。");
    else noteParts.push("等待原委托继续处理；原许可与进度保留。");
  }
  else if (draft.kind === "REVIEW_FAILURE") noteParts.push("失败原因与原进度保留；恢复前需核对原条件，不自动重试。");
  else if (draft.kind === "RESUME_DELEGATION") noteParts.push("暂停请求已结算；恢复会重新核对许可、预算与来源，不会跳过原守卫。");
  else if (draft.kind === "VIEW_RESULT") noteParts.push(terminalStatus === "CANCELLED" ? "原委托已取消；历史结果保留，不能视为成功完成。" : "完成条件已通过；现实效果仍以原结果为准。");
  if (observationState === "FAILED_LAST" && !noteParts.some(part => part.includes("观察失败"))) noteParts.push("最近一次观察失败，不能显示为无变化。");
  const next: WorkPacketNext = {
    nextActor: workState.nextActor,
    primaryAction,
    nextCheckAt: earliest(observationNextCheckAt, workState.nextCheckAt, responsibility?.effectiveNextCheckAt),
    nextBoundary: workState.nextBoundary,
    waitingOn,
    note: noteParts.join(" "),
  };

  const doneNote = ["最近工作只取原 Step/Output/Action/回执的有界窗口；执行成功、草稿存在与行动创建都不等于现实目标达成。",
    recentSteps.length === 0 && latestOutput === null && actionReceipts.length === 0 ? "窗口内没有工作记录，只表示覆盖不足，不等于从未发生。" : "",
    canShowNoChange ? "最近一次成功观察结论是无新变化；这只是观察结论，不是委托生命周期。" : ""].filter(Boolean).join(" ");
  const done = { recentSteps, latestOutput, progress, actionReceipts, note: doneNote, coverage: { limit: stepLimit, truncated: stepsTruncated } };

  const basisNote = ["依据只取原资料使用与证据审查投影；历史留痕保留原身份，当前可用不等于独立支持。",
    currentUsePolicy === "NOT_APPLIED" ? "本次未应用来源许可判断：availability=CURRENT 只表示版本匹配，不能当作当前可用或独立证据。" : "",
    materialUses === null ? "本次没有读取资料使用窗口，未找到记录不等于从未使用。" : "",
    evidenceReviews === null ? "本次没有读取证据审查窗口，未找到记录不等于从未发生。" : "",
    canShowNoChange ? "" : observationState === "FAILED_LAST" ? "最近观察失败，不能据此显示来源已核对或无变化。" : ""].filter(Boolean).join(" ");
  const basis = { questionId, materialUses, evidenceReviews, currentUsePolicy, note: basisNote };

  const observations = {
    readAt: nowIso, state: observationState, lastSuccessfulAt, lastFailedAt, lastNoNewInformationAt,
    nextCheckAt: observationNextCheckAt, authority: "ORIGINAL_DELEGATION_RECORDS_ONLY" as const,
  };

  const snapshot = {
    mode: "SINGLE_READ_TRANSACTION" as const, consistency, retries: count(input.snapshot?.retries),
    checkedAt: iso(input.snapshot?.checkedAt) ?? nowIso,
    note: consistency === "VERSION_STABLE" ? "同一只读事务内读取；身份与版本来自同一快照。"
      : consistency === "RETRIED" ? `读取期间版本推进，已重试 ${count(input.snapshot?.retries)} 次并采用同一快照。`
        : "读取期间版本已推进且未在快照内收敛；提交前必须重新核对全部版本，不得混用新旧事实。",
  };

  const stopped: WorkPacketStopped = {
    workState, missionStatus: mission.missionStatus, primaryBlock, blockers,
    unknownEffect: unknownPresent ? unknownEffect : null,
    stopRequest,
    note: `原生命周期 ${mission.missionStatus}；显示阶段 ${workState.phase}；停止请求 ${stopRequest.state}${stopInFlight ? "（未结算）" : "（已结算/无请求）"}；未结算效果${unknownPresent ? "存在" : "不存在"}。工作包不改变原生命周期，也不构成执行授权。`,
  };

  // ---- 覆盖：每个有界窗口都说明“未找到 ≠ 从未发生” ----
  const providedWindows = input.coverage?.windows;
  const windows: WorkPacketCoverageWindow[] = providedWindows && providedWindows.length
    ? providedWindows.map(window => ({
        name: window.name, limit: count(window.limit), returned: count(window.returned), truncated: window.truncated === true,
        note: window.note ?? coverageNote(window.truncated === true),
      }))
    : [
        { name: "RECENT_STEPS", limit: stepLimit, returned: allSteps.length, truncated: stepsTruncated, note: coverageNote(stepsTruncated) },
        { name: "ACTION_RECEIPTS", limit: receiptLimit, returned: allReceipts.length, truncated: receiptsTruncated, note: coverageNote(receiptsTruncated) },
        ...(materialUses ? [{ name: "MATERIAL_USES", limit: count(materialUses.coverage.sourceLimit, 8), returned: materialItems.length, truncated: materialUses.coverage.sourceLimitReached === true, note: coverageNote(materialUses.coverage.sourceLimitReached === true) }] : []),
        ...(evidenceReviews ? [{ name: "EVIDENCE_REVIEWS", limit: 3, returned: evidenceReviews.items.length, truncated: evidenceReviews.truncated, note: coverageNote(evidenceReviews.truncated) }] : []),
      ];

  return {
    schemaVersion: WORK_PACKET_SCHEMA_VERSION,
    contractVersion: WORK_PACKET_CONTRACT_VERSION,
    readAt: nowIso,
    identity: {
      missionId: mission.missionId, projectId: mission.projectId, missionVersion: mission.missionVersion,
      missionStatus: mission.missionStatus, planRevision: mission.planRevision, contextVersion: mission.contextVersion,
      constraintsVersion: mission.constraintsVersion, researchScopeVersion: mission.researchScopeVersion,
      controlVersion, originalRef: { kind: "MISSION", id: mission.missionId, version: mission.missionVersion },
    },
    snapshot,
    authority,
    observations,
    done,
    basis,
    stopped,
    next,
    blockers,
    coverage: { windows, policy: "NOT_FOUND_IS_NOT_NEVER" },
    realityOutcome: "NOT_INFERRED",
  };
}
