import { BarChart3, CheckCircle2, Link2, Network, Target } from "lucide-react";
import type { ProjectMetrics } from "@/lib/types";

export function AgentMetrics({ metrics, compact = false }: { metrics: ProjectMetrics; compact?: boolean }) {
  const items = [
    { label: "知识关联率", value: metrics.associationRate + "%", icon: Link2 },
    { label: "可追溯率", value: metrics.traceabilityRate + "%", icon: Network },
    { label: "提醒采纳率", value: metrics.acceptanceRate + "%", icon: Target },
    { label: "行动完成率", value: metrics.actionCompletionRate + "%", icon: CheckCircle2 },
    { label: "闭环回执", value: String(metrics.closedLoopCount), icon: BarChart3 },
  ];
  return <section aria-label="Agent 效果指标"><div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-5"}>{items.map(({ label, value, icon: Icon }, index) => <div key={label} className={"rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] px-3 py-3 " + (compact && index === items.length - 1 ? "col-span-2" : "")}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-[var(--muted)]">{label}</span><Icon size={14} className="text-[var(--teal-strong)]" /></div><p className="mt-1 text-lg font-black text-[var(--navy)]">{value}</p></div>)}</div>{metrics.simulatedExcluded > 0 && <p className="mt-2 text-right text-[11px] font-semibold text-[var(--amber)]">已排除 {metrics.simulatedExcluded} 条模拟数据，不计入真实指标</p>}</section>;
}
