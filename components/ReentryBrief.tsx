"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BookmarkCheck, CalendarClock, LoaderCircle, TriangleAlert } from "lucide-react";
import { subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import type { ReentryData, ReentryPrimaryAction } from "@/lib/types/reentry";

const primaryActionTarget: Record<ReentryPrimaryAction, { href: string; label: string }> = {
  VIEW_CHANGES: { href: "#project-state", label: "查看这次有什么变化" },
  ADD_EVIDENCE: { href: "#capture-box", label: "补一条记录或证据" },
  RESOLVE_BLOCKED: { href: "#action-board", label: "处理受阻的待办" },
  START_ACTION: { href: "#action-board", label: "开始下一个待办" },
};

/** 设备日历状态如实展示：Web 只保存应用内安排，写入系统日历要在鸿蒙客户端完成 */
const calendarLabels: Record<string, string> = {
  NONE: "应用内安排；尚未写入系统日历（需在鸿蒙客户端完成）",
  PENDING: "日历写入中，等待鸿蒙客户端回执",
  SYNCED: "已写入系统日历",
  FAILED: "系统日历写入失败，仅应用内有效",
  REVOKED: "已从系统日历撤销",
};

const freshnessLabels: Record<ReentryData["freshness"], { label: string; className: string }> = {
  FRESH: { label: "数据新鲜", className: "bg-[var(--teal-pale)] text-[var(--teal-strong)]" },
  STALE: { label: "部分数据不是最新", className: "bg-[var(--amber)]/15 text-[var(--amber)]" },
  EMPTY: { label: "还没有可汇总的内容", className: "bg-[var(--paper-strong)] text-[var(--muted)]" },
  FAILED: { label: "部分数据读取失败", className: "bg-[var(--brick-pale)] text-[var(--brick)]" },
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 60 秒再入场：与鸿蒙客户端、桌面卡片读取同一个只读聚合。
 *
 * 这里只做汇总，不另存一份项目事实；每个分区都带自己的状态，
 * 局部失败时如实标注并保留其余部分，不伪造一个空项目。
 */
export function ReentryBrief({ projectId, enabled, episodesEnabled, stateEnabled, schedulingEnabled }: { projectId: string; enabled: boolean; episodesEnabled: boolean; stateEnabled: boolean; schedulingEnabled: boolean }) {
  const [data, setData] = useState<ReentryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/reentry`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "读取再入场摘要失败");
      setData(payload as ReentryData);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取再入场摘要失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);

  // 这份摘要聚合了检查点、状态与安排：任一写入后都要重新拉取，否则会继续展示旧结论
  useEffect(() => {
    if (!enabled) return;
    return subscribeWorkspaceChange(
      projectId,
      ["episodes", "state", "schedule", "cards", "actions", "interventions", "artifacts", "projects"],
      () => void load(),
    );
  }, [enabled, load, projectId]);

  if (!enabled) return null;

  if (loading) {
    return <section id="reentry-brief" aria-label="回到项目" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
      <p className="flex items-center gap-2 text-sm text-[var(--ink-soft)]"><LoaderCircle size={15} className="animate-spin" />正在汇总上次做到哪…</p>
    </section>;
  }

  if (error || !data) {
    return <section id="reentry-brief" aria-label="回到项目" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--brick)]">{error || "再入场摘要暂时读不到。"}</p>
        <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
      </div>
    </section>;
  }

  const target = data.primaryAction === "VIEW_CHANGES" && !stateEnabled
    ? { href: "#capture-box", label: "补充项目进展" }
    : primaryActionTarget[data.primaryAction] ?? primaryActionTarget.START_ACTION;
  const freshness = freshnessLabels[data.freshness] ?? freshnessLabels.EMPTY;

  return <section id="reentry-brief" aria-labelledby="reentry-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div className="min-w-0">
        <p className="archive-label">60 秒回到项目</p>
        <h2 id="reentry-title" className="mt-2 text-lg font-black">{data.primaryMessage}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">汇总于 {formatTime(data.generatedAt)} · 与鸿蒙客户端、桌面卡片读取同一份结果</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + freshness.className}>{freshness.label}</span>
        <a href={target.href} className="focus-ring editorial-button text-xs">{target.label}<ArrowRight size={14} /></a>
      </div>
    </div>

    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-[var(--navy)]"><BookmarkCheck size={13} className="text-[var(--teal-strong)]" />阶段检查点</p>
        {data.episode.revision === null
          ? <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{episodesEnabled ? "还没有已确认的检查点。整理一版后，这里会显示结论与之后的变化。" : "当前部署未开启阶段检查点。"}</p>
          : <>
            <p className="mt-1.5 text-xs font-bold text-[var(--navy)]">V{data.episode.revision} · {data.episode.title}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">确认于 {formatTime(data.episode.confirmedAt)} · 冻结来源 {data.episode.sourceCount} 个</p>
            {data.episode.changesSince.length > 0
              ? <ul className="mt-1.5 space-y-1">{data.episode.changesSince.map((change) => <li key={change} className="text-[11px] leading-5 text-[var(--ink-soft)]">· {change}</li>)}</ul>
              : <p className="mt-1.5 text-[11px] leading-5 text-[var(--muted)]">检查点之后暂无已确认变化。</p>}
          </>}
        {data.episode.meta.status !== "OK" && data.episode.meta.message && <p className="mt-1.5 text-[11px] font-semibold text-[var(--amber)]">{data.episode.meta.message}</p>}
        {episodesEnabled && <a href="#episode-checkpoint" className="focus-ring mt-2 inline-block text-[11px] font-black text-[var(--teal-strong)] underline underline-offset-2">打开阶段检查点 →</a>}
      </div>

      <div className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-[var(--navy)]"><TriangleAlert size={13} className="text-[var(--brick)]" />最大风险或未知</p>
        {data.risk.text
          ? <p className="mt-1.5 text-xs leading-5 text-[var(--ink-soft)]">
            {data.risk.severity && <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (data.risk.severity === "HIGH" ? "bg-[var(--brick-pale)] text-[var(--brick)]" : data.risk.severity === "MEDIUM" ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--paper-strong)] text-[var(--muted)]")}>{data.risk.severity === "HIGH" ? "高" : data.risk.severity === "MEDIUM" ? "中" : "低"}</span>}
            {data.risk.text}
          </p>
          : <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">当前没有已确认的风险；信息不足的部分会保留为未知，不会被当成「没有风险」。</p>}
        {data.risk.meta.status !== "OK" && data.risk.meta.message && <p className="mt-1.5 text-[11px] font-semibold text-[var(--amber)]">{data.risk.meta.message}</p>}
        <a href="#interventions" className="focus-ring mt-2 inline-block text-[11px] font-black text-[var(--teal-strong)] underline underline-offset-2">查看提醒与依据 →</a>
      </div>

      <div className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-[var(--navy)]"><CalendarClock size={13} className="text-[var(--teal-strong)]" />下一个安排</p>
        {data.schedule.start
          ? <>
            <p className="mt-1.5 text-xs font-bold text-[var(--navy)]">{data.schedule.actionTitle ?? "已安排时段"}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{formatTime(data.schedule.start)} – {formatTime(data.schedule.end)}</p>
            <p className="mt-1 text-[11px] font-semibold leading-5 text-[var(--ink-soft)]">{calendarLabels[data.schedule.calendarStatus ?? "NONE"] ?? data.schedule.calendarStatus}</p>
          </>
          : <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">还没有已确认的时间安排。</p>}
        {data.schedule.meta.status !== "OK" && data.schedule.meta.message && <p className="mt-1.5 text-[11px] font-semibold text-[var(--amber)]">{data.schedule.meta.message}</p>}
        {schedulingEnabled && <a href="#schedule-planner" className="focus-ring mt-2 inline-block text-[11px] font-black text-[var(--teal-strong)] underline underline-offset-2">安排未来几天 →</a>}
      </div>
    </div>

    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      浏览器不能写系统日历：这里显示的是忆程里的应用内安排与设备同步状态。要收到设备提醒，请在鸿蒙客户端的这条待办里完成日历写入。
    </p>
  </section>;
}
