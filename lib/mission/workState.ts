import type { WorkState, WorkStateStopRequest, WorkStateTerminal, WorkStateUnsettledEffect } from "@/lib/types/workState";
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const iso = (v: unknown): string | null => {
  const n = v instanceof Date ? +v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
type MissionStateInput = {
  delegationEnabled?:boolean; id: string; status: string; version: number; waitStateJson?: unknown; planJson?: unknown;
  continuationPolicyJson?: unknown; lastErrorJson?: unknown; leaseUntil?: Date | null; nextAttemptAt?: Date | null;
  /** 原终态时间与最后修订时间；用于 terminal.atSource，不参与任何“本次读取”时间。 */
  finishedAt?: Date | string | null; updatedAt?: Date | string | null;
  /** 原停止请求与暂停原因（用户暂停为 "USER"）；只表示请求已收到，不表示已结算。 */
  pauseRequestedAt?: Date | string | null; cancelRequestedAt?: Date | string | null; pauseReason?: string | null;
  /** 原 Step 中仍未结算的 UNKNOWN 数量；缺省时只依据 lastErrorJson。 */
  unknownSteps?: number;
  events?: Array<{ id: string; type?: string; payloadJson: unknown }>;
  approvals?: Array<{ id: string; expiresAt?: Date; proposalJson?: unknown }>;
};

const STOP_IN_FLIGHT_TEXT = "已收到停止请求，等待本轮调用结算，不会继续派发新步骤";
const STOP_IN_FLIGHT_ACTION = "核对停止结算";

/** 停止请求维度：用户请求、结算状态与结算对象分开；RUNNING 时的在途请求不改变生命周期。 */
function stopRequestOf(m: MissionStateInput, pauseAt: string | null, cancelAt: string | null): WorkStateStopRequest {
  const pauseByUser = m.pauseReason === "USER";
  if (m.status === "CANCELLED" && cancelAt)
    return { state: "CANCEL_SETTLED", requestedAt: cancelAt, settled: true, note: "取消请求已结算：原委托已取消，历史结果保留，不能视为成功完成" };
  if (m.status === "SUCCEEDED")
    return { state: "NONE", requestedAt: pauseAt ?? cancelAt, settled: true, note: "原委托已完成；停止请求不再具有执行含义" };
  if (m.status === "PAUSED" && (pauseAt || pauseByUser))
    return { state: "PAUSE_SETTLED", requestedAt: pauseAt, settled: true, note: "暂停请求已结算：原委托已暂停，不会继续派发新步骤" };
  if (cancelAt)
    return { state: "CANCEL_REQUESTED", requestedAt: cancelAt, settled: false, note: "已收到取消请求，等待本轮调用结算，不会继续派发新步骤" };
  if (pauseAt || (pauseByUser && m.status === "RUNNING"))
    return { state: "PAUSE_REQUESTED", requestedAt: pauseAt, settled: false, note: STOP_IN_FLIGHT_TEXT };
  return { state: "NONE", requestedAt: null, settled: true, note: null };
}

/** One pure projection shared by Focus, detail, workspace and handoff. No dispatch or model. */
export function missionWorkState(m: MissionStateInput, now = new Date()): WorkState {
  const wait = record(m.waitStateJson), delegation = record(record(m.planJson).delegation), policy = record(m.continuationPolicyJson);
  const error = record(m.lastErrorJson), latest = m.events?.[0];
  const question = m.events?.find(e => !e.type || e.type === "QUESTION");
  const pending = m.approvals?.find(a => !a.expiresAt || +a.expiresAt > +now);
  const errorCode = typeof error.code === "string" && error.code ? error.code : null;
  const unknownByError = !!errorCode && /UNKNOWN/.test(errorCode);
  const unknownSteps = Number.isFinite(m.unknownSteps) ? Math.max(0, Math.trunc(m.unknownSteps as number)) : 0;
  const terminalStatus = m.status === "SUCCEEDED" || m.status === "CANCELLED" ? m.status : null;
  const finishedAt = iso(m.finishedAt), updatedAt = iso(m.updatedAt);
  // terminal.at 只取原终态/最后修订时间；与 checkedAt（本次读取）和 observedAt（成功观察）分开。
  const terminalFact: WorkStateTerminal | null = terminalStatus ? {
    status: terminalStatus,
    at: finishedAt ?? updatedAt,
    atSource: finishedAt ? "FINISHED_AT" : updatedAt ? "UPDATED_AT" : "NO_TIME",
    reasonCode: terminalStatus,
  } : null;
  // 未结算效果是事实维度：终态不能把它擦掉，UNKNOWN 也不能擦掉终态。
  const unsettledEffectFact: WorkStateUnsettledEffect = unknownByError || unknownSteps > 0 ? {
    present: true,
    code: unknownByError ? errorCode : null,
    source: unknownByError ? "LAST_ERROR" : "STEP",
    reasonText: unknownByError ? "原请求或外部效果尚未结算，读取不会自动核销" : `原 ${unknownSteps} 个步骤结果尚未结算，读取不会自动核销`,
    resolvedByRead: false,
  } : { present: false, code: null, source: "NONE", reasonText: null, resolvedByRead: false };
  const stopRequestFact = stopRequestOf(m, iso(m.pauseRequestedAt), iso(m.cancelRequestedAt));
  const result: WorkState = {
    phase: "UNKNOWN", nextActor: "UNKNOWN", requiresUser: false, reasonCode: "WAIT_CONDITION_UNKNOWN",
    reasonText: "等待条件需核对，原进度已保留", actionLabel: "核对当前状态",
    originalRef: { kind: "MISSION", id: m.id, version: m.version }, exactQuestionRef: null, exactApprovalRef: null,
    // checkedAt 是本次读取时间；observedAt 只来自 delegation.lastObservedAt（成功观察），读取绝不推进它。
    checkedAt: now.toISOString(), observedAt: iso(delegation.lastObservedAt), nextCheckAt: iso(m.nextAttemptAt),
    nextBoundary: iso(policy.expiresAt), freshness: "FRESH",
    terminal: terminalFact, unsettledEffect: unsettledEffectFact, stopRequest: stopRequestFact,
  };
  const set = (phase: WorkState["phase"], nextActor: WorkState["nextActor"], reasonCode: string, reasonText: string, actionLabel: string) =>
    Object.assign(result, { phase, nextActor, requiresUser: nextActor === "USER", reasonCode, reasonText, actionLabel });
  const stopInFlight = !stopRequestFact.settled;
  if (terminalStatus) {
    // 终态优先于 UNKNOWN：先保留原终态，再并列显示未结算效果；取消不得显示成功或可恢复。
    const cancelled = terminalStatus === "CANCELLED";
    if (unsettledEffectFact.present) set("COMPLETED", "USER", terminalStatus,
      cancelled ? "原委托已取消，历史结果保留；仍有未知调用结果未结算，不能视为成功完成" : "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
      cancelled ? "查看取消前原结果并核对未知调用" : "查看原结果并核对未知调用");
    else set("COMPLETED", "NONE", terminalStatus,
      cancelled ? "原委托已取消，历史结果与草稿保留，不能视为成功完成" : "委托完成条件已通过，现实效果以原结果为准",
      cancelled ? "查看取消前的原结果" : "查看原结果");
  }
  else if (m.status === "RUNNING" && m.leaseUntil && +m.leaseUntil > +now && stopInFlight) {
    // 停止请求在途优先于非终态 UNKNOWN：同一用户不能一边看到“查询原请求”、一边看到“核对停止结算”。
    // UNKNOWN 事实仍由 unsettledEffect 字段并列保留，客户端可同时展示。
    set("RUNNING", "SYSTEM", "STOP_REQUESTED_IN_FLIGHT", STOP_IN_FLIGHT_TEXT, STOP_IN_FLIGHT_ACTION);
  }
  else if (unknownByError) set("UNKNOWN", "SYSTEM", String(errorCode), "原请求状态待核对，已用预算保留", "查询原请求");
  else if (m.status === "PAUSED" || m.status === "FAILED") set(m.status, m.status === "PAUSED" ? "USER" : "SYSTEM", String(error.code ?? m.status), typeof error.message === "string" ? error.message : m.status === "PAUSED" ? "调查已暂停，恢复前需核对原条件" : "这一步未完成，已保存进度", "查看原因与恢复条件");
  else if (m.status === "READY" && latest?.type === "DAILY_BUDGET_WAITING" && m.nextAttemptAt && +m.nextAttemptAt > +now) set("QUEUED", "AGENT", "DAILY_BUDGET_WAITING", "今日调用额度已用完，等待许可时区的次日；累计用量保留", "查看下次检查时间");
  else if (m.status === "READY") set("QUEUED", "AGENT", "READY", "委托已保存，等待执行", "查看委托进展");
  else if (m.status === "RUNNING") {
    if (m.leaseUntil && +m.leaseUntil > +now) {
      // 停止请求在途已在更前面优先处理；这里只剩没有停止请求的正常执行。
      set("RUNNING", "AGENT", "LEASE_ACTIVE", "正在调查，进展来自已保存步骤", "查看委托进展");
    } else { set("UNAVAILABLE", "SYSTEM", "LEASE_UNCONFIRMED", "执行状态需重新核对，已保存步骤保留", "核对执行状态"); result.freshness = "UNAVAILABLE"; }
  } else if (m.status === "WAITING_APPROVAL") {
    set("WAITING_APPROVAL", "USER", pending ? "APPROVAL_PENDING" : "APPROVAL_EXPIRED", pending ? "请审阅原执行提案，确认后才会执行" : "原提案已过期，请重新核对依据", pending ? "审阅待批准提案" : "重新核对提案");
    result.exactApprovalRef = pending?.id ?? null;
    if (pending?.expiresAt) result.nextBoundary = pending.expiresAt.toISOString();
  } else if (m.status === "WAITING_INPUT") {
    const observation = wait.waitingFor === "OBSERVATION" || latest?.type === "INVESTIGATION_NO_NEW_INFORMATION";
    const pendingId=wait.resolved!==true&&typeof wait.questionId==="string"?wait.questionId:question?.id;
    const unresolved=wait.resolved!==true&&pendingId&&(typeof wait.questionId==="string"||!observation);
    if (unresolved && wait.waitingFor!=="OBSERVATION") {
      set("WAITING_USER", "USER", "QUESTION_PENDING", String(wait.question ?? record(question?.payloadJson).question ?? "请补充原问题所需资料"), "回答原问题");
      result.exactQuestionRef = pendingId??null;
    } else if(observation&&m.delegationEnabled===false){set("UNAVAILABLE","SYSTEM","DELEGATION_DISABLED","持续跟进服务当前不可用，原许可与进度保留","查看跟进条件");result.freshness="UNAVAILABLE";
    } else if (observation && policy.mode === "BOUNDED_INVESTIGATION" && Date.parse(String(policy.expiresAt)) > +now) {
      set("WAITING_OBSERVATION", "AGENT", "OBSERVATION_PENDING", "等待新变化，将按已授权条件检查", "查看跟进条件");
    } else if (observation) set("PAUSED", "USER", "DELEGATION_EXPIRED", "持续跟进许可需重新核对", "核对跟进许可");
    else result.freshness = "PARTIAL";
  }
  if(m.status==="RUNNING"&&m.leaseUntil&&+m.leaseUntil>+now)result.nextBoundary=m.leaseUntil.toISOString();
  return result;
}
