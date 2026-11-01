"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./MissionResponsibilityPanel.module.css";

import { readConversationDraft, saveConversationDraft, clearConversationDraft } from "@/lib/client/conversationDrafts";

type WorkerPresenceDetail = {
  workerId: string | null;
  lastHeartbeatAt: string | null;
  lastScanAt: string | null;
  lastClaimAt: string | null;
  isProcessAlive?: boolean;
  isActivelyInspecting?: boolean;
  hasClaimedWork?: boolean;
};

type Responsibility = {
  schemaVersion: number;
  missionId: string;
  projectId: string;
  controlVersion: string;
  goal: string;
  successCriteria: Array<string|{type:"SOURCE_COUNT";minimum:number}>;
  successCriteriaLabels?: string[];
  workingObjective?: string | null;
  constraints: Record<string, unknown>;
  researchScope: Record<string, unknown>;
  continuationPolicy: Record<string, unknown>;
  deadline: string | null;
  permissionExpiresAt: string | null;
  permissionState: string;
  budget: {
    limits: Record<string, unknown>;
    cumulativeUsed: Record<string, number>;
    additionalUsed?: Record<string, unknown>;
    policy: string;
    monetaryCost: string | null;
  };
  workState: {
    phase: string;
    description: string;
    nextCheckAt?: string | null;
  };
  pendingOriginalRefs?: {
    questionId: string | null;
    approvalIds: string[];
  };
  nextCheckAt: string | null;
  // PM-4：个人记忆依赖与最早边界（仅元数据，不含个人原话）
  personalMemory?: {
    dependencyCount: number;
    items: Array<{ claimId: string; status: string; revision: number; expiresAt: string | null; inUse: boolean }>;
    nextBoundary: string | null;
    nextBoundarySource: "PERSONAL_MEMORY" | null;
  } | null;
  effectiveNextCheckAt?: string | null;
  workerPresence: "UNOBSERVED" | "RECENT" | "STALE";
  workerPresenceDetail?: WorkerPresenceDetail | null;
  activity: Array<{ id: string; sequence: number; kind: string; at: string }>;
};

const presenceLabels: Record<string, string> = {
  RECENT: "近期收到后台心跳",
  STALE: "心跳超时",
  UNOBSERVED: "尚未观测到后台",
};

const permissionLabels: Record<string, string> = {
  WITHIN_TIME_BOUNDARY: "在许可期内",
  EXPIRED: "许可已到期",
  STOPPED: "已由用户停止",
};

const toolLabels: Record<string, string> = {
  inspect_project: "项目资料",
  search_memory: "记忆检索",
  read_project_material: "项目材料",
  inspect_action: "行动进展",
  web_search: "网页搜索",
  web_fetch: "网页读取",
  read_repository_ci: "仓库与CI",
  read_ci_jobs: "CI作业",
  read_ci_log: "CI日志",
  inspect_document: "文档浏览",
  read_document_page: "文档页面",
  read_document_section: "文档章节",
  read_document_table: "文档表格",
  inspect_experiment_metrics: "实验指标",
  compare_experiment_metrics: "指标比对",
  read_paper_metadata: "论文元数据",
  propose_metric_verification: "指标核算提案",
  save_mission_output: "沉淀结论",
  propose_action: "建议行动",
};

const DRAFT_PREFIX = "responsibility:";

type ResponsibilityDraft = {
  requestId: string;
  initialControlVersion: string;
  goal: string;
  workingObjective: string;
  deadlineDraft: string;
  pendingPayload?: string;
};

function loadDraft(id: string): ResponsibilityDraft | null {
  try {return JSON.parse(readConversationDraft(DRAFT_PREFIX+id).directiveRequest ?? "null");}catch{return null;}
}
function persistDraft(id: string, d: ResponsibilityDraft) {
  const value=JSON.stringify(d), draft=readConversationDraft(DRAFT_PREFIX+id);
  draft.directiveRequest=value; saveConversationDraft(DRAFT_PREFIX+id,draft);
  return readConversationDraft(DRAFT_PREFIX+id).directiveRequest===value;
}
function removeDraft(id: string) { clearConversationDraft(DRAFT_PREFIX+id); }

function toLocalDatetimeString(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalDatetimeString(localString: string): string | null {
  if (!localString.trim()) return null;
  const date = new Date(localString);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function MissionResponsibilityPanel({
  missionId,
  onRevised,
}: {
  missionId: string;
  onRevised?: () => void;
}) {
  const [data, setData] = useState<Responsibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingInitialControlVersion, setEditingInitialControlVersion] = useState<string>("");
  const [revisionRequestId, setRevisionRequestId] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPayload,setPendingPayload]=useState("");
  const mounted=useRef(true);
  const mutationError=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Draft states
  const [goalDraft, setGoalDraft] = useState("");
  const [workingObjectiveDraft, setWorkingObjectiveDraft] = useState("");
  const [deadlineDraft, setDeadlineDraft] = useState("");

  // Restore persistent draft on missionId switch or mount
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const saved = loadDraft(missionId);
      if (saved) {
        setEditing(true);
        setPendingPayload(saved.pendingPayload ?? "");
        setRevisionRequestId(saved.requestId);
        setEditingInitialControlVersion(saved.initialControlVersion);
        setGoalDraft(saved.goal);
        setWorkingObjectiveDraft(saved.workingObjective);
        setDeadlineDraft(saved.deadlineDraft);
      } else {
        setEditing(false);
        setRevisionRequestId("");
        setEditingInitialControlVersion("");
        setGoalDraft("");
        setWorkingObjectiveDraft("");
        setDeadlineDraft("");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [missionId]);

  // Continuous polling that preserves user draft when editing
  useEffect(() => {
    let active = true, inFlight=false;
    const abort=new AbortController();

    const fetchResponsibility = async () => {
      if(inFlight)return;inFlight=true;
      try {
        const res = await fetch(`/api/missions/${missionId}/responsibility`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
        if([401,403,404].includes(res.status)&&active){setData(null);setEditing(false);removeDraft(missionId);}
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? "无法加载责任视图");
        }
        const body = await res.json();
        if (!active) return;
        setData(body.responsibility);
        if (!editing) {
          const saved = loadDraft(missionId);
          if (!saved) {
            setGoalDraft(body.responsibility.goal ?? "");
            setWorkingObjectiveDraft(body.responsibility.workingObjective ?? "");
            setDeadlineDraft(toLocalDatetimeString(body.responsibility.deadline));
          }
        }
        if(!mutationError.current)setError("");
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "加载失败");
        }
      } finally {
        inFlight=false;if (active) setLoading(false);
      }
    };

    void fetchResponsibility();
    const interval = setInterval(() => {
      void fetchResponsibility();
    }, 5000);

    return () => {
      active = false;abort.abort();
      clearInterval(interval);
    };
  }, [missionId, editing, refreshTrigger]);

  function startEditing() {
    if (!data) return;
    const reqId = revisionRequestId || crypto.randomUUID();
    const initVersion = data.controlVersion;
    const g = data.goal ?? "";
    const w = data.workingObjective ?? "";
    const d = toLocalDatetimeString(data.deadline);

    mutationError.current=false;setEditing(true);
    setEditingInitialControlVersion(initVersion);
    setRevisionRequestId(reqId);
    setGoalDraft(g);
    setWorkingObjectiveDraft(w);
    setDeadlineDraft(d);
    setError("");

    persistDraft(missionId, {
      requestId: reqId,
      initialControlVersion: initVersion,
      goal: g,
      workingObjective: w,
      deadlineDraft: d,
    });
  }

  function cancelEditing() {
    removeDraft(missionId);
    setEditing(false);
    setRevisionRequestId("");
    setEditingInitialControlVersion("");
    setError("");
    if (data) {
      setGoalDraft(data.goal ?? "");
      setWorkingObjectiveDraft(data.workingObjective ?? "");
      setDeadlineDraft(toLocalDatetimeString(data.deadline));
    }
  }

  function handleDraftChange(goalVal: string, objVal: string, dVal: string) {
    setGoalDraft(goalVal);
    setWorkingObjectiveDraft(objVal);
    setDeadlineDraft(dVal);
    if (editing && revisionRequestId) {
      persistDraft(missionId, {
        requestId: revisionRequestId,
        initialControlVersion: editingInitialControlVersion,
        goal: goalVal,
        workingObjective: objVal,
        deadlineDraft: dVal,
      });
    }
  }

  async function handleRevise() {
    if (!data || data.missionId!==missionId || busy) return;
    setBusy(true);
    setError("");

    const reqId = revisionRequestId || crypto.randomUUID();
    if (!revisionRequestId) setRevisionRequestId(reqId);

    const deadlineValue =
      deadlineDraft === toLocalDatetimeString(data.deadline)
        ? data.deadline
        : fromLocalDatetimeString(deadlineDraft);

    try {
      const payload = pendingPayload || JSON.stringify({
        requestId:reqId, expectedControlVersion:editingInitialControlVersion || data.controlVersion,
        goal:goalDraft.trim(),workingObjective:workingObjectiveDraft.trim(),constraints:{...data.constraints,deadline:deadlineValue}
      });
      if(!persistDraft(missionId,{requestId:reqId,initialControlVersion:editingInitialControlVersion||data.controlVersion,
        goal:goalDraft,workingObjective:workingObjectiveDraft,deadlineDraft,pendingPayload:payload}))throw new Error("草稿尚未保存，暂未提交");
      setPendingPayload(payload);
      const res = await fetch(`/api/missions/${missionId}/responsibility`, {
        signal:AbortSignal.timeout(25000),method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body:payload,
      });
      if(!mounted.current)return;
      if(res.status>=400&&res.status<500){
        setPendingPayload("");setRevisionRequestId("");
        persistDraft(missionId,{requestId:"",initialControlVersion:editingInitialControlVersion,goal:goalDraft,workingObjective:workingObjectiveDraft,deadlineDraft});
      }
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error?.message ?? "修订失败");
      removeDraft(missionId);setPendingPayload("");
      setData(resBody.responsibility);
      setEditing(false);
      setRevisionRequestId("");
      setEditingInitialControlVersion("");
      setRefreshTrigger(v => v + 1);
      onRevised?.();
    } catch (e) {
      if(!mounted.current)return;
      mutationError.current=true;setError(e instanceof Error ? e.message : "修订失败");
    } finally {
      if(mounted.current)setBusy(false);
    }
  }

  if (loading && !data || data && data.missionId!==missionId) {
    return <div className="p-4 text-sm text-[var(--muted)]">正在读取责任合同...</div>;
  }

  if (!data) {
    return error ? <div className="p-4 text-sm text-[var(--brick)]">{error}</div> : null;
  }

  const { budget, workerPresence, workerPresenceDetail, permissionState, deadline, permissionExpiresAt, workingObjective, continuationPolicy } = data;
  const isStaleConflict = Boolean(
    editing && data && editingInitialControlVersion && data.controlVersion !== editingInitialControlVersion
  );

  const modelLimit = (budget.limits.models ?? budget.limits.maxModels) as number | string | undefined;
  const toolLimit = (budget.limits.tools ?? budget.limits.maxTools) as number | string | undefined;
  const metadataLimit = (budget.limits.metadataRequests ?? budget.limits.maxMetadataRequests) as number | string | undefined;
  const dailyBurst = budget.limits.dailyBurst as { models?: number; maxModels?: number; tools?: number; maxTools?: number } | undefined;

  const policy = continuationPolicy as {
    mode?: string;
    allowedTools?: string[];
    connectionIds?: string[];
    checkEveryMinutes?: number;
    quietStart?: number;
    quietEnd?: number;
    trackBranchHead?: boolean;
  } | undefined;

  return (
    <section className={styles.panel} aria-label="运行与接续">
      <div className={styles.heading}>
        <h4 className="font-semibold text-base text-[var(--ink)]">运行与接续</h4>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-xs rounded font-medium ${
              workerPresence === "RECENT"
                ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]"
                : workerPresence === "STALE"
                ? "bg-[var(--paper)] text-[var(--amber)]"
                : "bg-[var(--paper)] text-[var(--ink-soft)]"
            }`}
          >
            {presenceLabels[workerPresence] ?? workerPresence}
          </span>
          {workerPresenceDetail && (
            <span className="text-xs text-[var(--muted)]">
              {workerPresenceDetail.isActivelyInspecting ? "近期有成功巡检" : "尚无近期巡检回执"}
              {workerPresenceDetail.hasClaimedWork ? " · 有领取记录" : ""}
            </span>
          )}
        </div>
      </div>

      {data.nextCheckAt && <p className={styles.schedule}>下次计划核对：<time dateTime={data.nextCheckAt}>{new Date(data.nextCheckAt).toLocaleString("zh-CN")}</time></p>}
      {data.personalMemory && data.personalMemory.dependencyCount > 0 && (
        <p className={styles.schedule}>
          依赖 {data.personalMemory.dependencyCount} 条个人记忆
          {data.personalMemory.items.some(item => !item.inUse) && "（其中有已暂停/停用的条目，本轮已按失效处理）"}
          {data.personalMemory.nextBoundary && `；最早有效边界 ${new Date(data.personalMemory.nextBoundary).toLocaleString("zh-CN")}`}
        </p>
      )}
      {data.effectiveNextCheckAt && data.effectiveNextCheckAt !== data.nextCheckAt && (
        <p className={styles.schedule}>个人记忆边界将使下次核对提前到：<time dateTime={data.effectiveNextCheckAt}>{new Date(data.effectiveNextCheckAt).toLocaleString("zh-CN")}</time></p>
      )}
      {error && <div className="text-[var(--brick)] bg-[var(--brick-pale)] p-2 rounded text-xs">{error}</div>}

      {isStaleConflict && (
        <div className="text-[var(--amber)] bg-[var(--paper)] border border-[var(--rule)] p-2 rounded text-xs">
          责任合同已被其他端更新，提交时可能发生冲突，请核对后再保存（本地草稿已保留）。
        </div>
      )}

      {!editing ? (
        <details className={styles.disclosure}><summary>委托范围与累计用量</summary><div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">委托目标</p>
              <div className="text-[var(--ink)] bg-[var(--paper)] p-2.5 rounded border border-[var(--rule)] font-medium">
                {data.goal}
              </div>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">当前重点</p>
              <div className="text-[var(--ink)] bg-[var(--paper)] p-2.5 rounded border border-[var(--rule)]">
                {workingObjective || "与委托目标一致"}
              </div>
            </div>
          </div>

          {Array.isArray(data.successCriteria) && data.successCriteria.length > 0 && (
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">验收准则</p>
              <div className="flex flex-wrap gap-1.5">
                {(data.successCriteriaLabels??["验收准则待读取"]).map((c, i) => (
                  <span key={i} className="px-2 py-0.5 bg-[var(--teal-pale)] text-[var(--teal-strong)] rounded text-xs">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {policy?.allowedTools && policy.allowedTools.length > 0 && (
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">允许工具</p>
              <div className="flex flex-wrap gap-1.5">
                {policy.allowedTools.map(t => (
                  <span key={t} className="px-2 py-0.5 bg-[var(--paper)] text-[var(--ink-soft)] rounded text-xs">
                    {toolLabels[t] ?? t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[var(--muted)] block text-xs">任务截止时间</span>
              <span className="font-medium text-[var(--ink)]">
                {deadline ? new Date(deadline).toLocaleString("zh-CN") : "未限定"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted)] block text-xs">巡检授权有效期</span>
              <span className="font-medium text-[var(--ink)]">
                {permissionExpiresAt ? new Date(permissionExpiresAt).toLocaleString("zh-CN") : "手动模式"}
                <span className="ml-1 text-xs text-[var(--muted)]">({permissionLabels[permissionState] ?? permissionState})</span>
              </span>
            </div>
          </div>

          {policy?.connectionIds && policy.connectionIds.length > 0 && (
            <div className="text-xs text-[var(--ink-soft)] bg-[var(--paper)] p-2 rounded border border-[var(--rule)]">
              持续巡检：关联 {policy.connectionIds.length} 个代码仓库{policy.trackBranchHead ? " · 跟踪分支 HEAD" : ""} · 每 {policy.checkEveryMinutes ?? 15} 分钟核对一次
              {typeof policy.quietStart === "number" && typeof policy.quietEnd === "number" && (
                <span> · {policy.quietStart}:00–{policy.quietEnd}:00 自动静音排队</span>
              )}
            </div>
          )}

          <div className="bg-[var(--paper)] p-3 rounded border border-[var(--rule)]">
            <span className="text-xs font-medium text-[var(--ink-soft)] block mb-2">
              累计消耗与总包（永不清零）
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-[var(--ink-soft)]">
              <div>
                模型：<span className="font-semibold text-[var(--ink)]">{budget.cumulativeUsed.models ?? 0}</span> / {modelLimit ?? "待核对"}
              </div>
              <div>
                工具：<span className="font-semibold text-[var(--ink)]">{budget.cumulativeUsed.tools ?? 0}</span> / {toolLimit ?? "待核对"}
              </div>
              <div>
                元数据：<span className="font-semibold text-[var(--ink)]">{budget.cumulativeUsed.metadataRequests ?? 0}</span> / {metadataLimit ?? "待核对"}
              </div>
              <div>
                未知请求：<span className="font-semibold text-[var(--ink)]">{budget.cumulativeUsed.unknownCalls ?? 0}</span>
              </div>
            </div>
            {dailyBurst && (
              <div className="mt-2 text-xs text-[var(--muted)]">
                每日突发上限：模型 ≤ {dailyBurst.maxModels ?? dailyBurst.models ?? "-"}，工具 ≤ {dailyBurst.maxTools ?? dailyBurst.tools ?? "-"}
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={startEditing}
              className="px-3 py-1 bg-[var(--paper)] hover:bg-[var(--paper-strong)] text-[var(--ink-soft)] rounded text-xs font-medium transition"
            >
              修订责任范围
            </button>
          </div>
        </div></details>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--ink-soft)] mb-1">委托目标</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={2}
              value={goalDraft}
              disabled={busy || !!pendingPayload}
              onChange={e => handleDraftChange(e.target.value, workingObjectiveDraft, deadlineDraft)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--ink-soft)] mb-1">当前重点（可选）</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm"
              value={workingObjectiveDraft}
              disabled={busy || !!pendingPayload}
              onChange={e => handleDraftChange(goalDraft, e.target.value, deadlineDraft)}
              placeholder="留空则沿用原目标"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--ink-soft)] mb-1">任务截止时间</label>
            <input
              type="datetime-local"
              className="border rounded p-1.5 text-sm"
              value={deadlineDraft}
              disabled={busy || !!pendingPayload}
              onChange={e => handleDraftChange(goalDraft, workingObjectiveDraft, e.target.value)}
            />
          </div>

          {isStaleConflict && !pendingPayload && <button onClick={()=>{setEditingInitialControlVersion(data.controlVersion);setRevisionRequestId(crypto.randomUUID());setError("");}}>核对最新版本，保留我的修改</button>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              disabled={busy || !!pendingPayload}
              onClick={cancelEditing}
              className="px-3 py-1.5 border rounded text-xs text-[var(--ink-soft)] hover:bg-[var(--paper)]"
            >
              取消
            </button>
            <button
              disabled={busy || !goalDraft.trim()}
              onClick={() => void handleRevise()}
              className="px-3 py-1.5 bg-[var(--teal)] text-[var(--paper-strong)] rounded text-xs font-medium hover:bg-[var(--teal-strong)] disabled:opacity-50"
            >
              {busy ? "正在保存..." : pendingPayload ? "核对上次提交结果" : "确认修订（失效原有提案）"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
