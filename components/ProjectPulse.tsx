import { CalendarClock, CheckSquare, Gauge, Goal, Sparkles } from "lucide-react";
import type { ProjectDashboard } from "@/lib/projectDashboard";

export function ProjectPulse({ dashboard, goal, deadlineLabel }: { dashboard: ProjectDashboard; goal: string; deadlineLabel: string }) {
  const deadlineCritical = dashboard.deadline.kind === "overdue" || dashboard.deadline.kind === "urgent";
  const items = [
    { label: "截止状态", value: dashboard.deadline.label, icon: CalendarClock, critical: deadlineCritical },
    { label: "当前提醒", value: `${dashboard.activeReminderCount} 条`, icon: Sparkles, critical: dashboard.highestReminderSeverity >= 4 },
    { label: "未完成行动", value: `${dashboard.activeActionCount} 项`, icon: CheckSquare, critical: false },
    { label: "参赛准备度", value: `${dashboard.readiness.percentage}%`, icon: Gauge, critical: dashboard.readiness.blockingRiskCount > 0 },
  ];
  return <>
    <section aria-label="项目关键状态" className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] p-2 sm:grid-cols-4">{items.map(({ label, value, icon: Icon, critical }) => <div key={label} className={"rounded-xl px-3 py-3 " + (critical ? "bg-[var(--brick-pale)]" : "bg-[var(--paper-strong)]")}><div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--muted)]"><Icon size={13} className={critical ? "text-[var(--brick)]" : "text-[var(--teal-strong)]"} />{label}</div><p className={"mt-1 text-sm font-black " + (critical ? "text-[var(--brick)]" : "text-[var(--navy)]")}>{value}</p></div>)}</section>
    <details className="mt-3 rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] px-4 py-3 lg:hidden"><summary className="focus-ring cursor-pointer list-none rounded-lg text-sm font-black text-[var(--navy)]">查看项目目标与时间</summary><div className="mt-3 space-y-3 border-t archive-rule pt-3 text-sm leading-6 text-[var(--ink-soft)]"><p className="flex gap-2"><Goal size={16} className="mt-1 shrink-0 text-[var(--teal-strong)]" /><span><strong className="text-[var(--navy)]">项目目标：</strong>{goal}</span></p><p className="flex gap-2"><CalendarClock size={16} className="mt-1 shrink-0 text-[var(--teal-strong)]" /><span><strong className="text-[var(--navy)]">截止日期：</strong>{deadlineLabel}</span></p></div></details>
  </>;
}
