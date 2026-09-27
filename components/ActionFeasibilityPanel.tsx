"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleSlash, Clock3, LoaderCircle, Plus, ShieldQuestion, Trash2, TriangleAlert } from "lucide-react";
import type { ActionItemData } from "@/lib/types";

type TargetKind = "action" | "card" | "deliverable";
type DependentState = "MET" | "UNMET" | "UNKNOWN" | "MISSING";

type Dependency = {
  requirementId: string;
  targetKind: TargetKind;
  targetId: string;
  targetTitle: string | null;
  hard: boolean;
  state: DependentState;
  note: string;
};

type Assessment = {
  actionId: string;
  dependencyVersion: number;
  feasibility: "READY" | "BLOCKED" | "UNKNOWN";
  dependencies: Dependency[];
  overdue: boolean;
  deadline: string | null;
  estimateMinutes: number | null;
  estimateNote: string;
  assessedAt: string;
  summary: string;
};

type Candidate = { kind: TargetKind; id: string; title: string };

const kindLabels: Record<TargetKind, string> = { action: "行动", card: "记录卡", deliverable: "交付物" };

const stateLabels: Record<DependentState, { label: string; className: string }> = {
  MET: { label: "已满足", className: "bg-[var(--teal-pale)] text-[var(--teal-strong)]" },
  UNMET: { label: "未完成", className: "bg-[var(--brick-pale)] text-[var(--brick)]" },
  UNKNOWN: { label: "待确认", className: "bg-[var(--amber)]/15 text-[var(--amber)]" },
  MISSING: { label: "已找不到", className: "bg-[var(--paper-strong)] text-[var(--muted)]" },
};

const verdictCopy: Record<Assessment["feasibility"], { label: string; className: string; icon: typeof Clock3 }> = {
  READY: { label: "可以开始", className: "bg-[var(--teal-pale)] text-[var(--teal-strong)]", icon: Clock3 },
  BLOCKED: { label: "还有事情需要先完成", className: "bg-[var(--brick-pale)] text-[var(--brick)]", icon: CircleSlash },
  UNKNOWN: { label: "暂时无法确认能否开始", className: "bg-[var(--amber)]/15 text-[var(--amber)]", icon: ShieldQuestion },
};

/**
 * 待办的可执行前提：结论、前置依赖与预计用时。
 *
 * 结论以服务端每次重新评估的结果为准，这里不持久化评估结论；编辑一律带上读到的
 * dependencyVersion，版本冲突时刷新为最新版本并保留用户填写的内容，让用户再确认一次。
 * 估时缺失时保持「未估算」，系统不编造估时——这也是它进不了排程的真实原因。
 */
export function ActionFeasibilityPanel({ projectId, action, otherActions, onActionCreated }: {
  projectId: string;
  action: ActionItemData;
  otherActions: ActionItemData[];
  onActionCreated: () => void;
}) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [estimate, setEstimate] = useState("");
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [draft, setDraft] = useState<{ kind: TargetKind; targetId: string; hard: boolean; note: string }>({ kind: "action", targetId: "", hard: true, note: "" });

  const load = useCallback(async (options?: { preserveDraft?: boolean }) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/actions/feasibility?actionId=${encodeURIComponent(action.id)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取可执行前提失败");
      setAssessment(data as Assessment);
      if (!options?.preserveDraft) setEstimate(data?.estimateMinutes != null ? String(data.estimateMinutes) : "");
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取可执行前提失败");
      return false;
    } finally {
      setLoading(false);
    }
  }, [action.id, projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(payload: Record<string, unknown>, success: string, keepEditing = false) {
    if (!assessment) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/actions/feasibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actionId: action.id, expectedVersion: assessment.dependencyVersion }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // 版本冲突：刷新到最新版本，保留用户填写的内容，让用户再点一次保存
        if (data?.error?.code === "FEASIBILITY_VERSION_CONFLICT") {
          const refreshed = await load({ preserveDraft: true });
          setError(refreshed
            ? `${data?.error?.message ?? "依赖已被其他编辑更新"}。你填写的内容已保留，请再保存一次。`
            : "依赖版本已变化，最新状态暂时读不到；输入仍在，请重新评估后再保存。");
          return;
        }
        throw new Error(data?.error?.message ?? "保存失败，请稍后重试");
      }
      setAssessment(data as Assessment);
      setEstimate(data?.estimateMinutes != null ? String(data.estimateMinutes) : "");
      setNotice(success);
      if (!keepEditing) setEditing(false);
      onActionCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  async function loadCandidates() {
    if (candidates) return;
    setBusy("candidates");
    try {
      const [projectResponse, deliverableResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/deliverables`),
      ]);
      const projectData = await projectResponse.json().catch(() => null);
      const deliverableData = await deliverableResponse.json().catch(() => null);
      const cards: Candidate[] = projectResponse.ok
        ? (projectData?.project?.cards ?? []).map((card: { id: string; title: string }) => ({ kind: "card" as const, id: card.id, title: card.title }))
        : [];
      const deliverables: Candidate[] = deliverableResponse.ok
        ? (deliverableData?.deliverables ?? []).map((item: { id: string; title: string }) => ({ kind: "deliverable" as const, id: item.id, title: item.title }))
        : [];
      setCandidates([...cards, ...deliverables]);
      if (!projectResponse.ok && !deliverableResponse.ok) setError("候选记录暂时读不到，可稍后重试。");
    } catch {
      setError("候选记录暂时读不到，可稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  /** 解阻待办：与鸿蒙端同一命名约定，已存在同类待办时不重复创建 */
  async function createUnblockAction(dependency: Dependency) {
    const reason = dependency.note || dependency.targetTitle || "前置条件";
    const title = `先解决依赖：${reason}`.slice(0, 60);
    if (otherActions.some((item) => item.title.startsWith("先解决依赖：") && item.status !== "DONE" && item.status !== "CANCELLED")) {
      setNotice("已存在「先解决依赖」待办，未重复创建。");
      return;
    }
    setBusy("unblock");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: `该待办因「${reason}」被判定为受阻，先解决这个前置条件。`, priority: 1 }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "创建解阻待办失败");
      setNotice(data.reused ? "已存在同样的未完成待办，未重复创建。" : `已创建解阻待办「${title}」。先完成它，原来的待办才有开始条件。`);
      onActionCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建解阻待办失败");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]"><LoaderCircle size={13} className="animate-spin" />正在评估这条待办能不能开始…</p>;

  if (!assessment) return <div className="mt-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">
    {error || "可执行前提暂时读不到。"}
    <button type="button" onClick={() => void load()} className="focus-ring ml-2 rounded-md bg-[var(--card-bg)] px-2 py-1 font-bold">重试</button>
  </div>;

  const verdict = verdictCopy[assessment.feasibility];
  const VerdictIcon = verdict.icon;
  const blocking = assessment.dependencies.filter((dependency) => dependency.hard && (dependency.state === "UNMET" || dependency.state === "MISSING"));
  const options = draft.kind === "action"
    ? otherActions.filter((item) => item.id !== action.id && item.status !== "DONE" && item.status !== "CANCELLED").map((item) => ({ kind: "action" as const, id: item.id, title: item.title }))
    : (candidates ?? []).filter((candidate) => candidate.kind === draft.kind);

  return <div className="mt-2 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className={"inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-black " + verdict.className}><VerdictIcon size={13} />{verdict.label}</span>
      {assessment.estimateMinutes === null
        ? <span className="rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--amber)]">还没有填写预计用时</span>
        : <span className="rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--ink-soft)]">预计用时：{assessment.estimateMinutes} 分钟</span>}
      {assessment.overdue && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--brick-pale)] px-2 py-1 text-[11px] font-bold text-[var(--brick)]"><TriangleAlert size={12} />截止时间已过</span>}
    </div>
    <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-soft)]">{assessment.summary}</p>
    <p className="mt-0.5 text-[11px] text-[var(--muted)]">{assessment.estimateNote} · 评估于 {new Date(assessment.assessedAt).toLocaleString("zh-CN", { hour12: false })}</p>

    {notice && <p role="status" className="mt-2 rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--teal-strong)]">{notice}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-[var(--brick-pale)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brick)]">{error}</p>}

    <div className="mt-2.5">
      <p className="text-[11px] font-black text-[var(--navy)]">前置事项（{assessment.dependencies.length}）</p>
      {assessment.dependencies.length === 0
        ? <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">没有需要先完成的事项。实际完成时间仍可能受临时情况影响。</p>
        : <ul className="mt-1.5 space-y-1.5">
          {assessment.dependencies.map((dependency) => {
            const state = stateLabels[dependency.state] ?? stateLabels.UNKNOWN;
            return <li key={dependency.requirementId} className="rounded-lg bg-[var(--card-bg)] px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ink-soft)]">{kindLabels[dependency.targetKind] ?? dependency.targetKind}</span>
                <span className="text-[11px] font-bold text-[var(--navy)]">{dependency.targetTitle ?? "（目标已不存在）"}</span>
                <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + state.className}>{state.label}</span>
                <span className="text-[10px] font-bold text-[var(--muted)]">{dependency.hard ? "必须先完成" : "仅供参考"}</span>
                <button type="button" onClick={() => void save({ removeRequirementIds: [dependency.requirementId] }, "已移除这条前置事项。")} disabled={busy !== null} aria-label={`移除前置事项 ${dependency.targetTitle ?? dependency.requirementId}`} className="focus-ring ml-auto rounded p-1 text-[var(--muted)] hover:bg-[var(--brick-pale)] hover:text-[var(--brick)] disabled:opacity-50"><Trash2 size={12} /></button>
              </div>
              {dependency.note && <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{dependency.note}</p>}
            </li>;
          })}
        </ul>}
    </div>

    {blocking.length > 0 && <div className="mt-2.5 rounded-lg bg-[var(--brick-pale)] p-2.5">
      <p className="text-[11px] font-semibold leading-5 text-[var(--brick)]">受阻的待办不会进入「安排未来 7 天」，也不会被写入设备日历。</p>
      <button type="button" onClick={() => void createUnblockAction(blocking[0])} disabled={busy !== null} className="focus-ring mt-1.5 rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">
        {busy === "unblock" ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : <Plus size={12} className="mr-1 inline" />}创建「先解决依赖」待办
      </button>
    </div>}

    {!editing ? <div className="mt-2.5 flex flex-wrap gap-2">
      <button type="button" onClick={() => setEditing(true)} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--navy)]">{assessment.dependencies.length === 0 && assessment.estimateMinutes === null ? "填写预计用时或前置事项" : "修改前置事项或用时"}</button>
      <button type="button" onClick={() => void load()} disabled={busy !== null} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--muted)] disabled:opacity-50">重新评估</button>
    </div> : <div className="mt-2.5 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-2.5">
      <label className="block text-[11px] font-bold text-[var(--ink-soft)]">预计需要多久？（分钟）
        <span className="mt-1 flex items-center gap-2">
          <input type="number" min={1} max={100000} value={estimate} onChange={(event) => setEstimate(event.target.value)} className="focus-ring w-28 rounded-lg border border-[var(--rule)] bg-[var(--paper-strong)] px-2 py-1.5 text-xs" />
          <button type="button" onClick={() => void save({ estimatedMinutes: estimate.trim() === "" ? null : Number(estimate) }, estimate.trim() === "" ? "已清除预计用时；这条待办在补齐用时前不会进入排程。" : "预计用时已保存。")} disabled={busy !== null} className="focus-ring rounded-md bg-[var(--teal-pale)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">
            {busy === "save" ? <LoaderCircle size={12} className="animate-spin" /> : null}保存用时
          </button>
          {assessment.estimateMinutes !== null && <button type="button" onClick={() => { setEstimate(""); void save({ estimatedMinutes: null }, "已清除预计用时。"); }} disabled={busy !== null} className="focus-ring rounded-md px-2 py-1 text-[11px] font-bold text-[var(--muted)] disabled:opacity-50">清除</button>}
        </span>
      </label>

      <div className="mt-2.5 border-t archive-rule pt-2.5">
        <p className="text-[11px] font-bold text-[var(--ink-soft)]">添加前置事项</p>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-bold text-[var(--muted)]">类型
            <select value={draft.kind} onChange={(event) => { const kind = event.target.value as TargetKind; setDraft({ ...draft, kind, targetId: "" }); if (kind !== "action") void loadCandidates(); }} className="focus-ring editorial-input mt-1 w-full px-2 py-1.5 text-xs">
              {(["action", "card", "deliverable"] as TargetKind[]).map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-[var(--muted)]">目标
            <select value={draft.targetId} onChange={(event) => setDraft({ ...draft, targetId: event.target.value })} onFocus={() => { if (draft.kind !== "action") void loadCandidates(); }} className="focus-ring editorial-input mt-1 w-full px-2 py-1.5 text-xs">
              <option value="">{busy === "candidates" ? "正在读取候选…" : "选择一个目标"}</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-[var(--muted)] sm:col-span-2">说明（选填，最多 200 字）
            <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={200} className="focus-ring editorial-input mt-1 w-full px-2 py-1.5 text-xs" placeholder="例如：需要先拿到对照组数据" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ink-soft)]">
            <input type="checkbox" checked={draft.hard} onChange={(event) => setDraft({ ...draft, hard: event.target.checked })} className="focus-ring size-3.5" />必须先完成（取消勾选则仅供参考）
          </label>
          <button type="button" onClick={() => void save({ addRequirements: [{ targetKind: draft.kind, targetId: draft.targetId, hard: draft.hard, note: draft.note.trim() || undefined }] }, "前置事项已添加，结论已重新评估。", true)} disabled={busy !== null || !draft.targetId} className="focus-ring rounded-md bg-[var(--navy)] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50">
            {busy === "save" ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : <Plus size={12} className="mr-1 inline" />}添加
          </button>
          <button type="button" onClick={() => setEditing(false)} className="focus-ring rounded-md px-2 py-1 text-[11px] font-bold text-[var(--muted)]">收起</button>
        </div>
      </div>
    </div>}
  </div>;
}
