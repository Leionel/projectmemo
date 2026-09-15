"use client";

import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Link2, ListChecks, LoaderCircle, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { CardEditor } from "@/components/CardEditor";
import { knowledgeTypeLabels, getKnowledgeTypeColor, type KnowledgeTypeValue, type TemporalEvidenceRef, type TemporalTopLevelState } from "@/lib/types";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type Related = { id: string; title: string; reason: string; score: number };
export type KnowledgeCardTemporalData = {
  topLevelState: TemporalTopLevelState;
  reasonCode: string;
  displayReason: string;
  evidenceRefs: TemporalEvidenceRef[];
};
export type KnowledgeCardData = { id: string; type: string; title: string; summary: string; keywords: unknown; relatedTasks: unknown; nextActions: unknown; importance: number; createdAt: Date | string; capture: { rawText: string; sourceType: string | null }; outgoingLinks: Array<{ reason: string; score: number; relatedCard: { id: string; title: string } }>; incomingLinks: Array<{ reason: string; score: number; currentCard: { id: string; title: string } }>; temporal?: KnowledgeCardTemporalData };

const temporalLabels: Record<TemporalTopLevelState, string> = {
  CURRENT: "当前有效",
  SUPERSEDED: "已被取代",
  CONTESTED: "存在争议",
  UNKNOWN: "暂不能确定",
};

const temporalStyles: Record<TemporalTopLevelState, string> = {
  CURRENT: "bg-[var(--teal-pale)] text-[var(--teal-strong)]",
  SUPERSEDED: "bg-[var(--paper-strong)] text-[var(--muted)]",
  CONTESTED: "bg-[var(--brick-pale)] text-[var(--brick)]",
  UNKNOWN: "bg-[var(--amber)]/10 text-[var(--amber)]",
};

export function KnowledgeCardView({ card, projectId, compact = false, forcedOpen = false, onReveal, onImportanceChange }: { card: KnowledgeCardData; projectId: string; compact?: boolean; forcedOpen?: boolean; onReveal: (cardId: string) => void; onImportanceChange: (cardId: string, importance: number) => void }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(forcedOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [addedActions, setAddedActions] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const type = card.type as KnowledgeTypeValue;
  const keywords = Array.isArray(card.keywords) ? card.keywords as string[] : [];
  const relatedTasks = Array.isArray(card.relatedTasks) ? card.relatedTasks as string[] : [];
  const nextActions = Array.isArray(card.nextActions) ? card.nextActions as string[] : [];
  const temporal = card.temporal;
  const related: Related[] = [...card.outgoingLinks.map((link) => ({ id: link.relatedCard.id, title: link.relatedCard.title, reason: link.reason, score: link.score })), ...card.incomingLinks.map((link) => ({ id: link.currentCard.id, title: link.currentCard.title, reason: link.reason, score: link.score }))].slice(0, 3);
  const showFull = !compact || expanded || forcedOpen;

  async function setImportance(nextImportance: number) {
    if (nextImportance === card.importance || busy) return;
    const previous = card.importance;
    setBusy("importance"); setError(""); setMessage("");
    onImportanceChange(card.id, nextImportance);
    try {
      const response = await fetch(`/api/projects/${projectId}/cards/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importance: nextImportance }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "重要性更新失败");
      setMessage(`已将重要性调整为 ${nextImportance}/5`);
      emitWorkspaceChange(projectId, ["cards", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      onImportanceChange(card.id, previous);
      setError(caught instanceof Error ? caught.message : "重要性更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function addAction(title: string) {
    setBusy(`action:${title}`); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: `来自知识卡片《${card.title}》`, priority: card.importance, sourceCardId: card.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "加入待办失败");
      setAddedActions((old) => new Set(old).add(title));
      setMessage(data.reused ? "这条建议已在行动板中，未重复创建。" : "已加入行动板。");
      emitWorkspaceChange(projectId, ["actions", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入待办失败");
    } finally {
      setBusy(null);
    }
  }

  return <article id={`card-${card.id}`} tabIndex={-1} className="timeline-entry card-surface min-w-0 scroll-mt-24 rounded-[1.35rem] p-5 break-words focus:outline-none focus:ring-4 focus:ring-[rgba(45,139,116,.18)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${getKnowledgeTypeColor(type)}`}>{knowledgeTypeLabels[type]}</span><span className="text-xs text-[var(--muted)]">{new Date(card.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
      <div role="group" aria-label={`调整《${card.title}》的重要性`} className="flex items-center rounded-lg border border-[var(--rule)] bg-[var(--paper-strong)] p-1">{[1,2,3,4,5].map((value) => <button key={value} type="button" aria-label={`将重要性设为 ${value}`} aria-pressed={card.importance === value} disabled={busy === "importance"} onClick={() => void setImportance(value)} className="focus-ring rounded p-1 disabled:opacity-50"><Star size={14} className={value <= card.importance ? "text-[var(--amber)]" : "text-[var(--rule-strong)]"} fill={value <= card.importance ? "currentColor" : "none"} /></button>)}</div>
    </div>
    <h3 className="mt-4 text-xl font-bold leading-7 [overflow-wrap:anywhere]">{card.title}</h3>
    {temporal && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-md px-2 py-1 font-bold ${temporalStyles[temporal.topLevelState]}`}>时态：{temporalLabels[temporal.topLevelState]}</span>{showFull && <span className="text-[var(--muted)]">{temporal.displayReason}</span>}</div>}
    <p className={(showFull ? "mt-2.5 leading-7 " : "mt-2 line-clamp-2 text-sm leading-6 ") + "text-[var(--ink-soft)] [overflow-wrap:anywhere]"}>{card.summary}</p>
    <div className="mt-4 flex flex-wrap gap-2">{keywords.slice(0, showFull ? keywords.length : 4).map((keyword, index) => <span key={`${keyword}-${index}`} className="paper-tab px-2.5 py-1 text-xs font-medium text-[var(--ink-soft)]">#{keyword}</span>)}{!showFull && keywords.length > 4 && <span className="px-2 py-1 text-xs font-bold text-[var(--muted)]">+{keywords.length - 4}</span>}</div>

    {!showFull && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t archive-rule pt-3"><span className="text-xs text-[var(--muted)]">{nextActions.length} 条下一步 · {related.length} 条关联</span><button type="button" onClick={() => setExpanded(true)} className="focus-ring inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black text-[var(--teal-strong)] hover:bg-[var(--teal-pale)]"><ChevronDown size={14} />展开卡片</button></div>}

    {showFull && <>
      {relatedTasks.length > 0 && <div className="mt-4 flex items-start gap-2 text-sm leading-6 text-[var(--ink-soft)]"><ListChecks size={16} className="mt-1 shrink-0 text-[var(--navy)]" /><span><strong className="text-[var(--ink)]">识别出的任务：</strong>{relatedTasks.join("；")}</span></div>}
      <div className="mt-5 rounded-xl border-l-2 border-[var(--teal)] bg-[var(--teal-pale)] p-4"><p className="text-xs font-black uppercase tracking-wider text-[var(--teal-strong)]">下一步建议</p><ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">{nextActions.map((action, index) => <li key={`${action}-${index}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-[var(--paper-strong)] px-2.5 py-2 shadow-sm border border-[var(--rule)]"><span className="flex min-w-0 flex-1 gap-2"><ArrowUpRight size={15} className="mt-1 shrink-0 text-[var(--teal)]" />{action}</span><button type="button" onClick={() => void addAction(action)} disabled={Boolean(busy) || addedActions.has(action)} className="focus-ring shrink-0 rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-black text-[var(--teal-strong)] border border-[var(--rule)] disabled:opacity-60">{busy === `action:${action}` ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : addedActions.has(action) ? <Check size={12} className="mr-1 inline" /> : <Plus size={12} className="mr-1 inline" />}{addedActions.has(action) ? "已在待办" : "加入待办"}</button></li>)}</ul></div>
      {related.length > 0 && <div className="mt-5 border-t archive-rule pt-4"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--muted)]"><Link2 size={14} /> 相关知识资产</div><div className="mt-3 space-y-2">{related.map((item) => <a href={`#card-${item.id}`} onClick={(event) => { event.preventDefault(); onReveal(item.id); }} key={item.id} className="focus-ring block border-l border-[var(--rule-strong)] bg-[var(--paper-strong)] px-3.5 py-3 text-sm transition hover:border-l-[var(--teal)] hover:bg-[var(--teal-pale)]"><span className="font-bold text-[var(--navy)]">《{item.title}》</span><span className="text-[var(--ink-soft)]">：{item.reason}</span><span className="ml-2 text-xs font-bold text-[var(--teal)]">定位卡片 →</span></a>)}</div></div>}
      {compact && !forcedOpen && <button type="button" onClick={() => setExpanded(false)} className="focus-ring mt-4 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper-strong)]"><ChevronDown size={14} className="rotate-180" />收起卡片</button>}
      <CardEditor card={card} />
    </>}
    {(message || error) && <p role={error ? "alert" : "status"} className={"mt-3 rounded-lg px-3 py-2 text-xs font-semibold " + (error ? "bg-[var(--brick-pale)] text-[var(--brick)]" : "bg-[var(--teal-pale)] text-[var(--teal-strong)]")}>{error || message}{message.includes("行动板") && <a href="#action-board" className="ml-2 underline underline-offset-3">前往行动板 →</a>}</p>}
  </article>;
}
