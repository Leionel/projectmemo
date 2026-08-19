import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Gauge } from "lucide-react";
import type { CompetitionReadiness as CompetitionReadinessData } from "@/lib/projectDashboard";

export function CompetitionReadiness({ readiness, compact = false }: { readiness: CompetitionReadinessData; compact?: boolean }) {
  return <section id="competition-readiness" aria-labelledby="competition-readiness-title" className={compact ? "" : "card-surface scroll-mt-24 rounded-[1.45rem] p-5 sm:p-6"}>
    <div className="flex items-start justify-between gap-3"><div><p className="archive-label">参赛准备</p><h2 id="competition-readiness-title" className="mt-2 flex items-center gap-2 text-base font-black text-[var(--navy)]"><Gauge size={17} className="text-[var(--teal-strong)]" />内部准备度</h2></div><span className="text-xl font-black text-[var(--navy)]">{readiness.percentage}%</span></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--rule)]"><div className="h-full rounded-full bg-[var(--teal)] transition-[width]" style={{ width: `${readiness.percentage}%` }} /></div>
    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">根据当前项目记忆和成果自动推导，仅作内部补缺参考，不代表官方审核结果。</p>
    {readiness.blockingRiskCount > 0 && <div className="mt-3 flex gap-2 rounded-xl bg-[var(--brick-pale)] p-3 text-xs font-bold leading-5 text-[var(--brick)]"><AlertTriangle size={15} className="mt-0.5 shrink-0" />仍有 {readiness.blockingRiskCount} 条高风险提醒未处理，请先完成风险闭环。</div>}
    <ul className="mt-4 space-y-2">{readiness.items.map((item) => <li key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--paper-strong)] px-3 py-2.5 text-xs"><span className="flex min-w-0 items-center gap-2 font-bold text-[var(--ink-soft)]">{item.complete ? <CheckCircle2 size={15} className="shrink-0 text-[var(--teal-strong)]" /> : <Circle size={15} className="shrink-0 text-[var(--muted)]" />}{item.label}</span>{item.complete ? <span className="shrink-0 text-[11px] font-black text-[var(--teal-strong)]">已具备</span> : <Link href={item.href} className="focus-ring shrink-0 rounded-md px-1.5 py-1 text-[11px] font-black text-[var(--teal-strong)] hover:bg-[var(--paper-strong)]">{item.actionLabel} →</Link>}</li>)}</ul>
  </section>;
}
