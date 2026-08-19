import { AlertTriangle, CalendarClock, Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Suggestion } from "@/lib/types";

const styles = { risk: [AlertTriangle, "border-l-[var(--brick)] bg-[var(--brick-pale)] text-[var(--brick)]"], deadline: [CalendarClock, "border-l-[#ad862e] bg-[var(--amber)]/10 text-[var(--amber)]"], action: [Lightbulb, "border-l-[var(--navy)] bg-[var(--paper)] text-[var(--navy)]"], insight: [Sparkles, "border-l-[var(--teal)] bg-[var(--teal-pale)] text-[var(--teal)]"] } as const;

function actionFor(projectId: string, id: string) {
  if (id === "risks") return { href: `/projects/${projectId}?cardType=risk#knowledge-assets`, label: "查看风险卡片" };
  if (id === "deadline") return { href: `/projects/${projectId}/generate?type=competition_outline`, label: "生成材料大纲" };
  if (id === "reflect") return { href: `/projects/${projectId}/generate?type=weekly_report`, label: "生成阶段周报" };
  if (id === "artifact") return { href: `/projects/${projectId}/generate?type=weekly_report`, label: "检验沉淀质量" };
  return { href: "#capture-box", label: id === "experiment" ? "记录最小实验" : "继续补充记录" };
}

export function ProactiveSuggestions({ projectId, suggestions }: { projectId: string; suggestions: Suggestion[] }) {
  return <section aria-labelledby="suggestions-title"><div className="mb-4 flex flex-wrap items-center gap-2"><Sparkles size={18} className="text-[var(--teal-strong)]" /><h2 id="suggestions-title" className="text-lg font-black">忆程主动提醒</h2><span className="paper-tab px-2 py-1 text-xs font-bold text-[var(--teal-strong)]">Agent 主动发现</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{suggestions.map((item) => { const [Icon, style] = styles[item.tone]; const action = actionFor(projectId, item.id); return <article key={item.id} className={`flex min-w-0 flex-col border border-[var(--rule)] border-l-4 p-4 ${style}`}><Icon size={18} /><h3 className="mt-3 font-bold">{item.title}</h3><p className="mt-1.5 flex-1 text-sm leading-6 opacity-90">{item.content}</p><Link href={action.href} className="focus-ring mt-4 inline-flex w-fit items-center rounded-lg bg-[var(--card-bg)] px-3 py-2 text-xs font-black shadow-sm transition hover:bg-[var(--paper-strong)]">{action.label} →</Link></article>; })}</div></section>;
}
