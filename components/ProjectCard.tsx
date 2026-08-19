import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, CheckSquare, FileText, Gauge, Layers3, Sparkles } from "lucide-react";
import { scenarioOptions, getScenarioColor } from "@/lib/types";
import type { ProjectDashboard } from "@/lib/projectDashboard";

export type ProjectCardData = {
  id: string;
  title: string;
  description: string;
  scenario: string;
  deadline: Date | string | null;
  updatedAt: Date | string;
  _count: { cards: number; artifacts: number };
  dashboard: ProjectDashboard;
};

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const scenario = scenarioOptions.find((item) => item.value === project.scenario)?.label ?? project.scenario;
  const dashboard = project.dashboard;
  const deadlineTone = dashboard.deadline.kind === "overdue" || dashboard.deadline.kind === "urgent" ? "bg-[var(--brick-pale)] text-[var(--brick)]" : dashboard.deadline.kind === "upcoming" ? "bg-[var(--amber)]/10 text-[var(--amber)]" : "bg-[var(--paper-strong)] text-[var(--ink-soft)]";
  return <article className="card-surface hover-lift group relative flex min-w-0 flex-col overflow-hidden rounded-[1.35rem] p-6">
    <div className="absolute right-0 top-0 h-14 w-14 border-b border-l border-[var(--rule)] bg-[var(--teal-pale)]" />
    <div className="relative flex items-start justify-between gap-4"><span className={`paper-tab px-3 py-1.5 text-xs font-bold ${getScenarioColor(project.scenario)}`}>{scenario}</span><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${deadlineTone}`}><CalendarDays size={12} className="mr-1 inline" />{dashboard.deadline.label}</span></div>
    <h2 className="relative mt-5 text-xl font-bold leading-7"><Link href={`/projects/${project.id}`} className="focus-ring rounded-lg hover:text-[var(--teal-strong)]">{project.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline text-[var(--muted)] transition group-hover:text-[var(--navy)]" size={18} /></Link></h2>
    <p className="relative mt-3 line-clamp-2 min-h-12 text-sm leading-6 text-[var(--ink-soft)]">{project.description}</p>
    <div className="relative mt-4 grid grid-cols-2 gap-2 text-xs font-bold"><span className="rounded-lg bg-[var(--paper-strong)] px-2.5 py-2 text-[var(--ink-soft)]"><Sparkles size={13} className="mr-1 inline text-[var(--teal-strong)]" />{dashboard.activeReminderCount} 条提醒</span><span className="rounded-lg bg-[var(--paper-strong)] px-2.5 py-2 text-[var(--ink-soft)]"><CheckSquare size={13} className="mr-1 inline text-[var(--navy)]" />{dashboard.activeActionCount} 项待办</span></div>
    <div className="relative mt-4 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3"><div className="flex items-center justify-between gap-2 text-xs font-bold"><span className="inline-flex items-center gap-1 text-[var(--ink-soft)]"><Gauge size={14} className="text-[var(--teal-strong)]" />参赛准备度</span><span className="text-[var(--navy)]">{dashboard.readiness.percentage}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--rule)]"><div className="h-full rounded-full bg-[var(--teal)]" style={{ width: `${dashboard.readiness.percentage}%` }} /></div>{dashboard.readiness.blockingRiskCount > 0 && <p className="mt-2 text-[11px] font-bold text-[var(--brick)]">存在 {dashboard.readiness.blockingRiskCount} 条高风险提醒待处理</p>}</div>
    <div className="relative mt-5 flex flex-wrap gap-4 border-t archive-rule pt-4 text-xs font-semibold text-[var(--ink-soft)]"><span className="flex items-center gap-1.5"><Layers3 aria-hidden="true" size={14} className="text-[var(--teal)]" /> {project._count.cards} 张卡片</span><span className="flex items-center gap-1.5"><FileText aria-hidden="true" size={14} className="text-[var(--teal)]" /> {project._count.artifacts} 份成果</span></div>
    <div className="relative mt-auto flex flex-wrap items-center justify-between gap-2 pt-5"><Link href={`/projects/${project.id}`} className="focus-ring rounded-lg px-2 py-1.5 text-xs font-black text-[var(--navy)] hover:bg-[var(--paper)]">打开项目 <ArrowRight size={14} className="ml-1 inline" /></Link><Link href={dashboard.nextAction.href} className={"focus-ring rounded-lg px-3 py-2 text-xs font-black " + (dashboard.nextAction.tone === "critical" ? "bg-[var(--brick)] text-white" : "bg-[var(--teal-pale)] text-[var(--teal-strong)]")}>{dashboard.nextAction.label} →</Link></div>
  </article>;
}
