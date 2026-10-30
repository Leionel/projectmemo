import { createHash } from "node:crypto";
import type { ProjectAgentContext, AgentAttentionKind, AgentEntityRef } from "./types/projectAgentContext";

export type AgentCandidate = { kind: AgentEntityRef["kind"]; id: string; status: string; title: string; reason: string; updatedAt: string;
  version?: number; planRevision?: number; questionId?: string | null; approvalId?: string | null; outputRevision?: number | null; sourceChanged?: boolean; workState?: import("./types/workState").WorkState; dueAt?:string|null; severity?: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function candidatePriority(c: AgentCandidate): number {
  if(c.dueAt && Date.parse(c.dueAt)<=Date.now()+86400000)return 5;
  if(c.kind === "INTERVENTION")return (c.severity??0)>=4?8:65;
  if(c.kind === "ACTION")return 25;
  if(c.sourceChanged)return 18;
  if(c.workState){const w=c.workState;return w.phase==="WAITING_USER"?10:w.phase==="WAITING_APPROVAL"?15:w.phase==="UNKNOWN"?30:w.requiresUser?40:["QUEUED","RUNNING"].includes(w.phase)?55:75;}
  return c.status === "WAITING_INPUT"?10:c.status === "WAITING_APPROVAL"?15:["PAUSED","FAILED"].includes(c.status)?40:55;
}
/** Same facts produce the same decision on all entry points; wall clock is not hashed. */
export function selectProjectAgentContext(input: { projectId: string; projectTitle: string; projectGoal: string; projectUpdatedAt: string;
  candidates: AgentCandidate[]; focusMissionId?: string | null; failures?: string[]; generatedAt?: string; hasRecords?: boolean }): ProjectAgentContext {
  const selected = [...input.candidates].sort((a,b) => candidatePriority(a)-candidatePriority(b)
    || Number(b.id === input.focusMissionId)-Number(a.id === input.focusMissionId) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  const failures = input.failures ?? [], unavailable = failures.length > 0 && (!selected || selected.kind!=="MISSION");
  const c = unavailable ? undefined : selected, mission = c?.kind === "MISSION" ? c : input.candidates.find(c=>c.kind==="MISSION"&&c.id===input.focusMissionId);
  const base = `/projects/${encodeURIComponent(input.projectId)}`;
  const attentionKind: AgentAttentionKind = unavailable ? "UNAVAILABLE" : !c ? "CAPTURE" : c.kind === "MISSION"
    ? c.sourceChanged ? "SOURCE_CHANGED" : ["PAUSED", "FAILED"].includes(c.status) ? "STOPPED" : c.status as AgentAttentionKind
    : c.kind === "ACTION" ? "ACTION" : "REMINDER";
  const labels: Record<AgentAttentionKind,string> = { WAITING_INPUT:"补充委托资料", WAITING_APPROVAL:"审阅行动提案", SOURCE_CHANGED:"核对来源与进度", STOPPED:"查看原因与进度", RUNNING:"查看执行进度", READY:"查看原委托", REMINDER:"查看提醒依据", ACTION:"打开行动", CAPTURE:"记录项目进展", UNAVAILABLE:"重新读取项目" };
  const href = !c ? unavailable ? base : `${base}/records` : c.kind === "MISSION" ? `${base}/missions?mission=${encodeURIComponent(c.id)}` : `${base}/actions#${c.kind === "ACTION" ? "action" : "intervention"}-${encodeURIComponent(c.id)}`;
  const result: Omit<ProjectAgentContext,"observationHash"> = { schemaVersion:1, projectId:input.projectId, projectTitle:input.projectTitle,
    goalRef:{projectGoalHash:hash(input.projectGoal),missionId:mission?.id ?? null,planRevision:mission?.planRevision ?? null},
    goal:mission?.title ?? input.projectGoal, focusMissionId:input.focusMissionId ?? null,
    nextStep:{workState:c?.workState,attentionKind,status:c?.status??"",entityRef:{kind:c?.kind ?? "PROJECT",id:c?.id ?? input.projectId,version:c?.version ?? null,questionId:c?.questionId ?? null,approvalId:c?.approvalId ?? null,outputRevision:c?.outputRevision ?? null},
      title:unavailable ? "当前下一步暂时无法完整读取" : c?.title ?? "记录一条新进展",reason:unavailable ? "部分项目摘要读取失败，请重试后再决定下一步。已有委托仍保留。" : c?.reason || "记录已完成的事或待解决的问题，再继续推进项目。",
      actionLabel:c?.workState?.actionLabel ?? (attentionKind==="CAPTURE"&&!input.hasRecords?"记录第一条资料":labels[attentionKind]),href,evidenceRefs:c ? [`${c.kind.toLowerCase()}:${c.id}`] : [],priority:unavailable ? 0 : c ? candidatePriority(c) : 90},
    observedAt:c?.updatedAt ?? input.projectUpdatedAt,generatedAt:input.generatedAt ?? new Date().toISOString(),freshness:failures.length ? unavailable ? "UNAVAILABLE" : "PARTIAL" : "FRESH",fallbackReason:failures.length ? failures.join(",") : null };
  return {...result,observationHash:hash({...result,generatedAt:undefined,nextStep:{...result.nextStep,workState:result.nextStep.workState?{...result.nextStep.workState,checkedAt:undefined}:undefined}})};
}
