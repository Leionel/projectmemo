"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, FileText, LoaderCircle, Pencil, X } from "lucide-react";
import { StateDiffView } from "@/components/StateDiffView";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import type { MeetingConfirmResult, MeetingImpactPreview, MeetingTypedChange } from "@/lib/types/meetingState";
import type { ProjectStateDiff } from "@/lib/types/projectState";

type Stage = "draft" | "preview" | "done";

const kindLabels: Record<MeetingTypedChange["kind"], string> = {
  DECISION_SUPERSEDE: "决定有变化",
  ACTION_CREATE: "新增待办",
  DEADLINE_CHANGE: "日期有变化",
  FACT_RECORD: "会议结论",
};

const kindTone: Record<MeetingTypedChange["kind"], string> = {
  DECISION_SUPERSEDE: "bg-[var(--brick-pale)] text-[var(--brick)]",
  ACTION_CREATE: "bg-[var(--teal-pale)] text-[var(--teal-strong)]",
  DEADLINE_CHANGE: "bg-[var(--amber)]/15 text-[var(--amber)]",
  FACT_RECORD: "bg-[var(--paper-strong)] text-[var(--ink-soft)]",
};

/** 确认阶段遇到这些错误码说明预览已经过期：只能回到原文重新预览，不能就地重试写入 */
const REPREVIEW_CODES = new Set(["STATE_CHANGED_REPREVIEW", "PROPOSAL_VERSION_MISMATCH", "INVALID_SELECTION"]);

const sampleText = "例如：会上决定将方案A改为方案B。张三需要跟进测试报告。截止提前到 2026-10-01。";

/**
 * 会议文本导入：识别 → 逐项勾选 → 确认写入。
 *
 * 确认绑定 proposalId + sourceTextHash + proposalVersion，任何文本或日期修改都必须重新预览；
 * 待澄清项不可勾选，因此不会被写入。重复确认由服务端返回同一份执行结果，不会二次写入。
 */
export function MeetingImportCard({ projectId, stateEnabled }: { projectId: string; stateEnabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("draft");
  const [text, setText] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [preview, setPreview] = useState<MeetingImpactPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<MeetingConfirmResult | null>(null);
  const [afterDiff, setAfterDiff] = useState<ProjectStateDiff | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const proposed = preview?.typedChanges.filter((change) => change.status === "PROPOSED") ?? [];
  const unclear = preview?.typedChanges.filter((change) => change.status === "NEEDS_CLARIFICATION") ?? [];

  function toggle(changeId: string) {
    setSelected((current) => current.includes(changeId) ? current.filter((id) => id !== changeId) : [...current, changeId]);
  }

  function backToDraft(message: string) {
    setPreview(null);
    setSelected([]);
    setResult(null);
    setAfterDiff(null);
    setShowDiff(false);
    setStage("draft");
    setNotice(message);
  }

  async function recognize() {
    if (text.trim().length < 5) {
      setError("会议文本请至少输入 5 个字");
      return;
    }
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/meetings/impact-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), meetingDate: meetingDate || null }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "识别失败，请稍后重试");
      setPreview(data as MeetingImpactPreview);
      // 与鸿蒙端一致：默认不勾选，逐项确认后才写入
      setSelected([]);
      setStage("preview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "识别失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview || selected.length === 0) return;
    setBusy("confirm");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/meetings/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: preview.proposalId,
          sourceTextHash: preview.sourceTextHash,
          proposalVersion: preview.proposalVersion,
          selectedChangeIds: selected,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = String(data?.error?.code ?? "");
        // 预览已过期：保留会议原文，要求重新识别，绝不自动确认新版本
        if (REPREVIEW_CODES.has(code)) {
          backToDraft("这次预览已不能确认，会议原文仍在；请重新点「看看识别到了什么」后再选择保存。");
          setError(data?.error?.message ?? "");
          return;
        }
        throw new Error(data?.error?.message ?? "确认失败，可重试同一次确认（不会重复写入）");
      }
      const confirmed = data as MeetingConfirmResult;
      setResult(confirmed);
      setStage("done");
      setNotice(confirmed.alreadyConfirmed
        ? "这次确认此前已经处理过，下面是当时的写入结果，没有重复写入。"
        : "");
      emitWorkspaceChange(projectId, ["cards", "actions", "interventions", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认失败，可重试同一次确认（不会重复写入）");
    } finally {
      setBusy(null);
    }
  }

  async function loadAfterDiff() {
    if (!preview || !result?.afterSnapshotId) return;
    setBusy("diff");
    setError("");
    try {
      const query = `from=${encodeURIComponent(preview.baseSnapshotId)}&to=${encodeURIComponent(result.afterSnapshotId)}`;
      const response = await fetch(`/api/projects/${projectId}/state/diff?${query}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取会后对比失败");
      setAfterDiff(data.diff as ProjectStateDiff);
      setShowDiff(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取会后对比失败");
    } finally {
      setBusy(null);
    }
  }

  return <section id="meeting-import" aria-labelledby="meeting-import-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div className="min-w-0">
        <p className="archive-label">会议更新</p>
        <h2 id="meeting-import-title" className="mt-2 flex items-center gap-2 text-lg font-black"><FileText size={18} className="text-[var(--teal-strong)]" />记录这次会议</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">粘贴会议内容。忆程会找出「改了什么、要做什么、日期有没有变化」，先给你检查，只有勾选确认后才会保存。</p>
      </div>
      {stage !== "draft" && <button type="button" onClick={() => backToDraft("")} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50"><Pencil size={14} />修改文本</button>}
    </div>

    {notice && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}

    {stage === "draft" && <div className="mt-4">
      <label htmlFor="meeting-text" className="text-xs font-bold text-[var(--ink-soft)]">会议内容</label>
      <textarea id="meeting-text" value={text} onChange={(event) => setText(event.target.value)} rows={6} maxLength={8000} disabled={busy !== null} className="focus-ring editorial-input mt-1.5 w-full resize-y p-3 text-sm leading-6" placeholder={sampleText} />
      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
        <label className="text-xs font-bold text-[var(--ink-soft)]">会议是哪一天？（可不填）
          <input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} disabled={busy !== null} className="focus-ring editorial-input mt-1.5 px-3 py-2 text-sm" />
        </label>
        <p className="text-[11px] leading-5 text-[var(--muted)]">内容里有「下周五」「三天内」这类相对日期时，请选择会议日期，否则这些日期无法解析，会被标为待澄清。</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void recognize()} disabled={busy !== null || text.trim().length < 5} className="focus-ring editorial-button text-xs disabled:opacity-50">
          {busy === "preview" ? <LoaderCircle size={14} className="animate-spin" /> : <FileText size={14} />}{busy === "preview" ? "正在识别…" : "看看识别到了什么"}
        </button>
        <span className="text-[11px] text-[var(--muted)]">{text.trim().length} 字 · 至少 5 字</span>
      </div>
    </div>}

    {stage === "preview" && preview && <div className="mt-4">
      <p className="rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ink-soft)]">
        预览未生效：{preview.summary}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-[var(--navy)]">请检查识别结果</p>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="text-[11px] font-bold text-[var(--muted)]">已选择 {selected.length}/{proposed.length} 项</span>
          {proposed.length > 0 && <button type="button" onClick={() => setSelected(selected.length === proposed.length ? [] : proposed.map((change) => change.changeId))} disabled={busy !== null} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">
            {selected.length === proposed.length ? "全不选" : "全选可保存项"}
          </button>}
        </div>
      </div>

      {preview.typedChanges.length === 0 && <p className="mt-3 rounded-xl bg-[var(--paper-strong)] p-4 text-center text-xs leading-5 text-[var(--ink-soft)]">
        没有从这段文本里识别出可确认的变化。可以把决定、负责人和日期写得更明确，或改用「记录进展」直接沉淀为项目记忆。
      </p>}

      <ul className="mt-2 space-y-2">
        {preview.typedChanges.map((change) => {
          const selectable = change.status === "PROPOSED";
          const checked = selected.includes(change.changeId);
          return <li key={change.changeId} className={"rounded-xl border p-3 " + (selectable ? checked ? "border-[var(--teal)]/40 bg-[var(--teal-pale)]" : "border-[var(--rule)] bg-[var(--card-bg)]" : "border-dashed border-[var(--amber)] bg-[var(--amber)]/10")}>
            <div className="flex items-start gap-2.5">
              {selectable
                ? <input type="checkbox" id={`meeting-${change.changeId}`} checked={checked} onChange={() => toggle(change.changeId)} disabled={busy !== null} aria-label={`勾选「${change.title}」`} className="focus-ring mt-1 size-4 shrink-0" />
                : <span className="mt-0.5 shrink-0 rounded bg-[var(--amber)]/20 px-1.5 py-0.5 text-[10px] font-black text-[var(--amber)]">信息不完整</span>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-bold " + kindTone[change.kind]}>{kindLabels[change.kind] ?? change.kind}</span>
                  <label htmlFor={selectable ? `meeting-${change.changeId}` : undefined} className="text-xs font-bold leading-5 text-[var(--navy)]">{change.title}</label>
                </div>
                <p className="mt-1 rounded-lg bg-[var(--paper-strong)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--ink-soft)]">会议原文：{change.evidenceSpan}</p>
                {change.supersededCardTitle && <p className="mt-1 text-[11px] font-semibold text-[var(--brick)]">将替换：{change.supersededCardTitle}（旧记录会保留为历史，不会被删除）</p>}
                {change.deadlineISO && <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--amber)]"><CalendarDays size={12} />新的截止日期：{change.deadlineISO}</p>}
                {change.actionTitle && <p className="mt-1 text-[11px] font-semibold text-[var(--teal-strong)]">将创建待办：{change.actionTitle}</p>}
                {change.clarification && <p className={"mt-1 text-[11px] leading-5 font-semibold " + (selectable ? "text-[var(--ink-soft)]" : "text-[var(--amber)]")}>{change.clarification}</p>}
                {change.candidateCardIds.length > 0 && <p className="mt-1 text-[11px] text-[var(--muted)]">存在 {change.candidateCardIds.length} 张相近的候选记录，需要在文本里写清楚被取代的是哪一条。</p>}
              </div>
            </div>
          </li>;
        })}
      </ul>

      {unclear.length > 0 && <p className="mt-2 text-[11px] leading-5 text-[var(--amber)]">其中 {unclear.length} 项信息不完整，不能勾选；补齐会议日期或把文本写明确后重新识别。</p>}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => backToDraft("")} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs"><X size={14} />放弃这次识别</button>
        <button type="button" onClick={() => void confirm()} disabled={busy !== null || selected.length === 0} className="focus-ring editorial-button text-xs disabled:opacity-50">
          {busy === "confirm" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{busy === "confirm" ? "保存中…" : `保存选中的 ${selected.length} 项`}
        </button>
      </div>
    </div>}

    {stage === "done" && result && <div className="mt-4">
      <p className="flex items-center gap-2 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-black text-[var(--teal-strong)]"><Check size={15} />会议内容已保存</p>
      <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">已按你的选择保存 {result.applied.length} 项，未勾选的内容没有写入。</p>
      <ul className="mt-2 space-y-1.5">
        {result.applied.map((item) => <li key={item.changeId} className="rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--ink-soft)]">
          <span className="mr-1.5 rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--navy)]">{kindLabels[item.kind as MeetingTypedChange["kind"]] ?? item.kind}</span>
          {item.newCardId && <span>已保存到记忆{item.supersededCardId ? "，旧记录转为历史版本" : ""}</span>}
          {item.newActionId && <a href="#action-board" className="focus-ring font-bold text-[var(--teal-strong)] underline underline-offset-2">已加入待办</a>}
          {item.deadlineISO && <span>截止日期改为 {item.deadlineISO}</span>}
        </li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {stateEnabled && preview?.baseSnapshotId && result.afterSnapshotId && !showDiff && <button type="button" onClick={() => void loadAfterDiff()} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
          {busy === "diff" ? <LoaderCircle size={14} className="animate-spin" /> : <CalendarDays size={14} />}查看会后变化对比
        </button>}
        {showDiff && <button type="button" onClick={() => setShowDiff(false)} className="focus-ring editorial-button-secondary text-xs">收起对比</button>}
        <a href="#knowledge-assets" className="focus-ring editorial-button-secondary text-xs">查看新记忆</a>
        <button type="button" onClick={() => { backToDraft(""); setText(""); setMeetingDate(""); }} disabled={busy !== null} className="focus-ring editorial-button text-xs">完成</button>
      </div>
      {showDiff && afterDiff && <div className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <p className="text-xs font-black text-[var(--navy)]">会前 → 会后（{afterDiff.items.length} 项变化）</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{afterDiff.summary}</p>
        <div className="mt-2"><StateDiffView diff={afterDiff} emptyText="这次确认没有改变状态快照里的事实。" /></div>
      </div>}
    </div>}
  </section>;
}
