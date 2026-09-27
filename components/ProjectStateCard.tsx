"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, Check, LoaderCircle, ListChecks, RefreshCw, TriangleAlert } from "lucide-react";
import { StateDiffView } from "@/components/StateDiffView";
import { getDeviceKey } from "@/lib/client/deviceKey";
import { emitWorkspaceChange, subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import { hasUnreadChange, healthSummary, nextStepText, topConfirmedRisk } from "@/lib/client/projectStateView";
import type { ProjectChangeBrief, ProjectStateDiff, ProjectStateFreshnessData, ProjectStatePayload } from "@/lib/types/projectState";

type SnapshotData = {
  id: string;
  sequence: number;
  evaluatedAt: string;
  policyVersion: string;
  payload: ProjectStatePayload;
};

type Phase = "loading" | "empty" | "ready" | "error";

const evidenceHref: Record<string, string> = {
  card: "#knowledge-assets",
  action: "#action-board",
  deliverable: "#competition-readiness",
  attachment: "#capture-box",
};

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleDateString("zh-CN");
}

/**
 * 状态与变化：快照、未读变化、变化简报与「已了解」游标。
 *
 * 基线来自服务端游标（consumerKey = 浏览器安装标识），不在本地另存一份「上次看到哪」；
 * 读取失败时保留未读状态，不冒充「没有变化」。
 */
export function ProjectStateCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [freshness, setFreshness] = useState<ProjectStateFreshnessData | null>(null);
  const [lastSeenSnapshotId, setLastSeenSnapshotId] = useState<string | null>(null);
  const [diff, setDiff] = useState<ProjectStateDiff | null>(null);
  const [brief, setBrief] = useState<ProjectChangeBrief | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showBrief, setShowBrief] = useState(false);

  const loadDiff = useCallback(async (from: string | null, to: string) => {
    if (!from || from === to) {
      setDiff(null);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${projectId}/state/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "变化详情暂时无法获取");
      setDiff(data.diff as ProjectStateDiff);
    } catch (caught) {
      // 拉取失败不冒充「没有变化」：保留未读提示，由用户重试
      setDiff(null);
      setNotice(caught instanceof Error ? caught.message : "变化详情暂时无法获取，可点击刷新重试。");
    }
  }, [projectId]);

  const readState = useCallback(async (options?: { refresh?: boolean }) => {
    const consumerKey = getDeviceKey();
    try {
      const response = await fetch(`/api/projects/${projectId}/state?consumerKey=${encodeURIComponent(consumerKey)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取项目状态失败");
      setLastSeenSnapshotId(data.lastSeenSnapshotId ?? null);
      let nextSnapshot: SnapshotData | null = data.snapshot ?? null;
      let nextFreshness: ProjectStateFreshnessData = data.freshness;
      let message = "";
      // 首次进入或上一份快照已过期时显式刷新一次；GET 本身不会隐式生成快照
      if (options?.refresh || !nextSnapshot || nextFreshness.status !== "FRESH") {
        const refreshed = await fetch(`/api/projects/${projectId}/state/refresh`, { method: "POST" });
        const refreshData = await refreshed.json().catch(() => null);
        if (refreshed.ok) {
          nextSnapshot = refreshData.snapshot ?? nextSnapshot;
          nextFreshness = refreshData.freshness ?? nextFreshness;
          if (refreshData.status === "BASELINE_CREATED") message = "这是第一份状态记录，后续变化都会与它对比。";
        } else if (refreshData?.status === "STALE") {
          nextSnapshot = refreshData.snapshot ?? nextSnapshot;
          nextFreshness = refreshData.freshness ?? nextFreshness;
          message = refreshData.error?.message ?? "状态刷新失败，当前展示上一份快照；可稍后重试。";
        } else {
          message = refreshData?.error?.message ?? "状态刷新失败，当前展示上一份快照；可稍后重试。";
        }
      }
      if (!nextSnapshot) {
        setSnapshot(null);
        setFreshness(nextFreshness);
        setPhase("empty");
        setError("");
        return;
      }
      if (nextFreshness.status === "STALE" || nextFreshness.status === "FAILED") {
        message = message || nextFreshness.errorMessage || "当前快照不是最新评估结果，系统保留了上一份状态；刷新成功后再更新。";
      }
      setSnapshot(nextSnapshot);
      setFreshness(nextFreshness);
      setNotice(message);
      setError("");
      setPhase("ready");
      await loadDiff(data.lastSeenSnapshotId ?? null, nextSnapshot.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取项目状态失败");
      setPhase((current) => (current === "ready" ? "ready" : "error"));
    }
  }, [loadDiff, projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void readState();
  }, [enabled, readState]);

  // 记录、待办、成果或检查点变化后重新评估：变化简报要比对的必须是最新快照，而不是进页面时那一份
  useEffect(() => {
    if (!enabled) return;
    return subscribeWorkspaceChange(
      projectId,
      ["cards", "actions", "artifacts", "episodes", "schedule"],
      () => void readState({ refresh: true }),
    );
  }, [enabled, projectId, readState]);

  if (!enabled) return null;

  async function refresh() {
    setBusy("refresh");
    setNotice("");
    setError("");
    await readState({ refresh: true });
    // 新快照会影响 60 秒再入场摘要里的风险与结论，广播一次
    emitWorkspaceChange(projectId, ["state"]);
    setBusy(null);
  }

  async function openBrief() {
    if (!snapshot) return;
    if (showBrief) {
      setShowBrief(false);
      return;
    }
    setBusy("brief");
    setError("");
    try {
      const from = lastSeenSnapshotId ?? "";
      const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(snapshot.id)}`;
      const response = await fetch(`/api/projects/${projectId}/state/brief?${query}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取变化简报失败");
      setBrief(data.brief as ProjectChangeBrief);
      setShowBrief(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取变化简报失败");
    } finally {
      setBusy(null);
    }
  }

  /** 「已了解」推进服务端游标；失败时保留未读状态，用户可重试 */
  async function markRead() {
    if (!snapshot) return;
    setBusy("read");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/state/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayedSnapshotId: snapshot.id, consumerKey: getDeviceKey() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "标记已读失败，请重试");
      setLastSeenSnapshotId(data.lastSeenSnapshotId ?? snapshot.id);
      setDiff(null);
      setNotice(data.status === "ALREADY_SEEN" ? "这份状态此前已经读过，未读标记保持在更新的一份上。" : "已记录你读到了这份状态。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "标记已读失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  if (phase === "loading") {
    return <section id="project-state" aria-label="状态与变化" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
      <p className="flex items-center gap-2 text-sm text-[var(--ink-soft)]"><LoaderCircle size={15} className="animate-spin" />正在读取项目状态…</p>
    </section>;
  }

  if (phase === "error") {
    return <section id="project-state" aria-label="状态与变化" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
      <p className="archive-label">状态与变化</p>
      <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
        <button type="button" onClick={() => void refresh()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
      </div>
    </section>;
  }

  if (phase === "empty" || !snapshot) {
    return <section id="project-state" aria-label="状态与变化" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
      <p className="archive-label">状态与变化</p>
      <h2 className="mt-2 flex items-center gap-2 text-lg font-black"><Activity size={18} className="text-[var(--teal-strong)]" />还没有状态记录</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">生成第一份状态快照后，忆程会把每次回到项目时的变化与它对比，并逐句给出依据。</p>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}
      <button type="button" onClick={() => void refresh()} disabled={busy !== null} className="focus-ring editorial-button mt-4 text-xs disabled:opacity-50">
        {busy === "refresh" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}生成第一份状态记录
      </button>
    </section>;
  }

  const payload = snapshot.payload;
  const health = healthSummary(payload);
  const risk = topConfirmedRisk(payload);
  const unknown = payload.unknowns[0];
  const unread = hasUnreadChange(lastSeenSnapshotId, snapshot.id);
  const stale = freshness?.status === "STALE" || freshness?.status === "FAILED";

  return <section id="project-state" aria-labelledby="project-state-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div className="min-w-0">
        <p className="archive-label">状态与变化</p>
        <h2 id="project-state-title" className="mt-2 flex items-center gap-2 text-lg font-black"><Activity size={18} className="text-[var(--teal-strong)]" />自上次查看以来</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">评估于 {formatDay(snapshot.evaluatedAt)} · 事实句逐条带来源；信息不足会保留为未知，不当作「没有发生」。</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
        {busy === "refresh" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}刷新状态
      </button>
    </div>

    {stale && <p role="status" className="mt-3 flex items-start gap-1.5 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-[11px] font-semibold text-[var(--brick)]">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />{freshness?.errorMessage || "当前快照不是最新评估结果，系统保留了上一份状态；刷新成功后再更新。"}
    </p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}

    <div className="mt-4">
      <p className="text-xs font-black text-[var(--navy)]">本次变化</p>
      {!unread && <p className="mt-1.5 text-xs text-[var(--muted)]">· 没有未读的重要变化</p>}
      {unread && !lastSeenSnapshotId && <p className="mt-1.5 text-xs leading-5 text-[var(--ink-soft)]">这是你在这台浏览器上第一次查看状态：下面的内容是当前事实全貌，点「已了解」后，下次只显示变化。</p>}
      {unread && lastSeenSnapshotId && diff && <div className="mt-2"><StateDiffView diff={diff} limit={showAll ? undefined : 3} /></div>}
      {unread && lastSeenSnapshotId && !diff && <p className="mt-1.5 text-xs text-[var(--muted)]">变化详情尚未取到，可点「刷新状态」重试。</p>}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {diff && diff.items.length > 3 && <button type="button" onClick={() => setShowAll((value) => !value)} className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">
          <ChevronDown size={13} className={showAll ? "rotate-180" : ""} />{showAll ? "收起变化清单" : `查看全部 ${diff.items.length} 项变化与依据`}
        </button>}
        <button type="button" onClick={() => void openBrief()} disabled={busy !== null} className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">
          {busy === "brief" ? <LoaderCircle size={13} className="animate-spin" /> : <ChevronDown size={13} className={showBrief ? "rotate-180" : ""} />}查看简报（变化 / 影响 / 建议）
        </button>
      </div>
    </div>

    {showBrief && brief && <div className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
      <p className="text-xs font-black text-[var(--navy)]">{brief.headline}</p>
      {!brief.materialChange && <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">没有需要处理的变化。你可以继续推进当前待办，或刷新状态查看最新评估。</p>}
      <ul className="mt-2 space-y-2">
        {brief.sentences.map((sentence) => <li key={sentence.changeKey} className="rounded-lg bg-[var(--paper-strong)] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-black text-[var(--navy)]">变化</span>
            <span className="text-[11px] text-[var(--muted)]">依据 {sentence.evidenceCount} 项</span>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ink)]">{sentence.text}</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">影响：{sentence.impact}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-[var(--teal-strong)]">建议：{sentence.suggestion}</p>
          {sentence.evidence.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">
            {sentence.evidence.slice(0, 3).map((ref, index) => <a key={`${ref.entityId}-${index}`} href={ref.entityKind === "card" ? `#card-${ref.entityId}` : evidenceHref[ref.entityKind] ?? "#project-state"} className="focus-ring rounded bg-[var(--teal-pale)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--teal-strong)]">
              {ref.entityKind === "card" ? "记忆" : ref.entityKind === "action" ? "行动" : ref.entityKind === "deliverable" ? "交付物" : ref.entityKind} · {ref.field || "版本证据"}
            </a>)}
            {sentence.evidence.length > 3 && <span className="px-1 py-0.5 text-[10px] text-[var(--muted)]">+{sentence.evidence.length - 3}</span>}
          </p>}
        </li>)}
      </ul>
      <p className="mt-2 text-[11px] text-[var(--muted)]">简报由服务端确定性模板生成；读简报不会创建行动，也不会改动项目。</p>
    </div>}

    <div className="mt-4 border-t archive-rule pt-4">
      <p className={"text-sm font-bold " + (health.tone === "bad" ? "text-[var(--brick)]" : health.tone === "ok" ? "text-[var(--teal-strong)]" : "text-[var(--ink-soft)]")}>
        {health.tone === "bad" ? "! " : health.tone === "ok" ? "✓ " : "? "}{health.label}
      </p>
      {risk ? <p className="mt-1 text-xs leading-5 text-[var(--brick)]">最大风险：[{risk.severity === "HIGH" ? "高" : risk.severity === "MEDIUM" ? "中" : "低"}] {risk.text}</p>
        : unknown ? <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">未知项：{unknown.text}</p> : null}
      <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">建议下一步：{nextStepText(payload)}</p>
      {payload.facts.length > 0 && <details className="mt-2 rounded-lg bg-[var(--paper-strong)] p-2.5">
        <summary className="focus-ring cursor-pointer text-[11px] font-bold text-[var(--navy)]">当前事实句（{payload.facts.length}）与依据</summary>
        <ul className="mt-2 space-y-1.5">
          {payload.facts.map((fact) => <li key={fact.key} className="text-[11px] leading-5 text-[var(--ink-soft)]">
            <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (fact.truth === "TRUE" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : fact.truth === "FALSE" ? "bg-[var(--brick-pale)] text-[var(--brick)]" : "bg-[var(--amber)]/15 text-[var(--amber)]")}>
              {fact.truth === "TRUE" ? "成立" : fact.truth === "FALSE" ? "不成立" : "未知"}
            </span>
            {fact.text}
            <span className="ml-1.5 text-[10px] text-[var(--muted)]">依据 {fact.evidenceRefs.length} 项{fact.displayReason ? ` · ${fact.displayReason}` : ""}</span>
          </li>)}
        </ul>
      </details>}
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={() => void markRead()} disabled={busy !== null || !unread} className="focus-ring editorial-button text-xs disabled:opacity-50">
        {busy === "read" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{unread ? "已了解" : "已读至最新"}
      </button>
      <a href="#action-board" className="focus-ring editorial-button-secondary inline-flex text-xs"><ListChecks size={14} />去处理待办</a>
    </div>
  </section>;
}
