import type { WorkState } from "@/lib/types/workState";
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const iso = (v: unknown): string | null => {
  const n = v instanceof Date ? +v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
type MissionStateInput = {
  delegationEnabled?:boolean; id: string; status: string; version: number; waitStateJson?: unknown; planJson?: unknown;
  continuationPolicyJson?: unknown; lastErrorJson?: unknown; leaseUntil?: Date | null; nextAttemptAt?: Date | null;
  events?: Array<{ id: string; type?: string; payloadJson: unknown }>;
  approvals?: Array<{ id: string; expiresAt?: Date; proposalJson?: unknown }>;
};
/** One pure projection shared by Focus, detail, workspace and handoff. No dispatch or model. */
export function missionWorkState(m: MissionStateInput, now = new Date()): WorkState {
  const wait = record(m.waitStateJson), delegation = record(record(m.planJson).delegation), policy = record(m.continuationPolicyJson);
  const error = record(m.lastErrorJson), latest = m.events?.[0];
  const question = m.events?.find(e => !e.type || e.type === "QUESTION");
  const pending = m.approvals?.find(a => !a.expiresAt || +a.expiresAt > +now);
  const result: WorkState = {
    phase: "UNKNOWN", nextActor: "UNKNOWN", requiresUser: false, reasonCode: "WAIT_CONDITION_UNKNOWN",
    reasonText: "等待条件需核对，原进度已保留", actionLabel: "核对当前状态",
    originalRef: { kind: "MISSION", id: m.id, version: m.version }, exactQuestionRef: null, exactApprovalRef: null,
    checkedAt: now.toISOString(), observedAt: iso(delegation.lastObservedAt), nextCheckAt: iso(m.nextAttemptAt),
    nextBoundary: iso(policy.expiresAt), freshness: "FRESH",
  };
  const set = (phase: WorkState["phase"], nextActor: WorkState["nextActor"], reasonCode: string, reasonText: string, actionLabel: string) =>
    Object.assign(result, { phase, nextActor, requiresUser: nextActor === "USER", reasonCode, reasonText, actionLabel });
  if (/UNKNOWN/.test(String(error.code ?? ""))) set("UNKNOWN", "SYSTEM", String(error.code), "原请求状态待核对，已用预算保留", "查询原请求");
  else if (m.status === "SUCCEEDED" || m.status === "CANCELLED") set("COMPLETED", "NONE", m.status, m.status === "SUCCEEDED" ? "委托完成条件已通过，现实效果以原结果为准" : "委托已取消，历史结果保留", "查看原结果");
  else if (m.status === "PAUSED" || m.status === "FAILED") set(m.status, m.status === "PAUSED" ? "USER" : "SYSTEM", String(error.code ?? m.status), typeof error.message === "string" ? error.message : m.status === "PAUSED" ? "调查已暂停，恢复前需核对原条件" : "这一步未完成，已保存进度", "查看原因与恢复条件");
  else if (m.status === "READY") set("QUEUED", "AGENT", "READY", "委托已保存，等待执行", "查看委托进展");
  else if (m.status === "RUNNING") {
    if (m.leaseUntil && +m.leaseUntil > +now) set("RUNNING", "AGENT", "LEASE_ACTIVE", "正在调查，进展来自已保存步骤", "查看委托进展");
    else { set("UNAVAILABLE", "SYSTEM", "LEASE_UNCONFIRMED", "执行状态需重新核对，已保存步骤保留", "核对执行状态"); result.freshness = "UNAVAILABLE"; }
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
