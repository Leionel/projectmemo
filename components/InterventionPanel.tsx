"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Clock3, LoaderCircle, Play, RotateCcw, ShieldAlert, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { InterventionData, ProposedAction } from "@/lib/types";
import { interventionStatusLabels, interventionTriggerLabels } from "@/lib/types";
import { emitWorkspaceChange, subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import { isInterventionActive } from "@/lib/projectDashboard";

type Scenario = "deadline_48h" | "stale_72h" | "risk_cluster";

const triggerIcon = {
  DEADLINE_NEAR: CalendarClock,
  RISK_UNHANDLED: AlertTriangle,
  PROJECT_STALE: Clock3,
  EXPERIMENT_GAP: ShieldAlert,
  MATERIAL_GAP: Sparkles,
  DELIVERABLE_GAP: ShieldAlert,
} as const;

export function InterventionPanel({ projectId, initialInterventions, demoEnabled = true }: { projectId: string; initialInterventions: InterventionData[]; demoEnabled?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initialInterventions);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; href?: string; linkLabel?: string } | null>(null);

  async function evaluate(scenario?: Scenario, clearSimulation = false) {
    setBusy(clearSimulation ? "clear" : scenario ?? "evaluate");
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/evaluate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, clearSimulation }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "评估失败，请稍后重试");
      setItems(data.interventions ?? []);
      emitWorkspaceChange(projectId, ["interventions", "actions", "metrics"]);
      setNotice({ text: scenario ? "演示情境已加载，模拟数据不会计入真实项目指标。" : clearSimulation ? "模拟数据已清除。" : "已重新评估项目上下文。" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "评估失败，请稍后重试" });
    } finally {
      setBusy(null);
    }
  }

  async function update(id: string, payload: Record<string, unknown>) {
    setBusy(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/interventions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "操作失败，请稍后重试");
      if (data.intervention) setItems((old) => old.map((item) => item.id === id ? { ...item, status: data.intervention.status, handledAt: data.intervention.handledAt, snoozedUntil: data.intervention.snoozedUntil, actions: data.action ? [data.action, ...(item.actions ?? [])] : item.actions } : item));
      emitWorkspaceChange(projectId, payload.status === "ACCEPTED" ? ["interventions", "actions", "metrics"] : ["interventions", "metrics"]);
      if (payload.status === "ACCEPTED") {
        setNotice({ text: "已创建行动项；完成后写下回执即可形成可追溯闭环。", href: "#action-board", linkLabel: "前往行动板" });
      } else if (payload.status === "SNOOZED") {
        const until = typeof payload.snoozedUntil === "string" ? new Date(payload.snoozedUntil).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "稍后";
        setNotice({ text: `已收起提醒，将在 ${until} 后再次出现。` });
      } else {
        setNotice({ text: "提醒已移入最近处理。" });
      }
      router.refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "操作失败，请稍后重试" });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const reload = subscribeWorkspaceChange(projectId, ["interventions"], () => {
      void fetch(`/api/projects/${projectId}/interventions`).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (data?.interventions) setItems(data.interventions);
      });
    });
    const reevaluate = subscribeWorkspaceChange(projectId, ["cards", "artifacts"], () => void evaluate());
    return () => { reload(); reevaluate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openItems = items.filter((item) => isInterventionActive(item));
  const historyItems = items.filter((item) => !isInterventionActive(item)).slice(0, 8);
  return <section id="interventions" aria-labelledby="interventions-title" className="scroll-mt-24 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-2 flex flex-wrap items-center gap-2"><Sparkles size={18} className="text-[var(--teal-strong)]" /><h2 id="interventions-title" className="text-lg font-black">忆程主动提醒</h2><span className="paper-tab px-2 py-1 text-xs font-bold text-[var(--teal-strong)]">上下文 Agent</span></div><p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">提醒不是静态建议：每条都有触发规则、证据卡片和可确认的行动，完成后会自动沉淀复盘。</p></div>
      <button type="button" onClick={() => void evaluate()} disabled={Boolean(busy)} className="focus-ring editorial-button-secondary disabled:opacity-60"><RotateCcw size={15} className={busy === "evaluate" ? "animate-spin" : ""} />重新评估</button>
    </div>

    {demoEnabled && <details className="rounded-2xl border border-dashed border-[var(--teal)] bg-[var(--teal-pale)] px-4 py-3.5"><summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl"><span><span className="block text-sm font-black text-[var(--navy)]">演示控制</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-soft)]">比赛演示时可模拟截止逼近、停滞或风险集中；不会影响真实项目数据。</span></span><Play size={16} className="shrink-0 text-[var(--teal-strong)]" /></summary><div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--teal)]/20 pt-3"><ScenarioButton label="截止 48 小时" active={busy === "deadline_48h"} onClick={() => void evaluate("deadline_48h")} /><ScenarioButton label="停滞 72 小时" active={busy === "stale_72h"} onClick={() => void evaluate("stale_72h")} /><ScenarioButton label="风险集中" active={busy === "risk_cluster"} onClick={() => void evaluate("risk_cluster")} /><ScenarioButton label="清除模拟" active={busy === "clear"} onClick={() => void evaluate(undefined, true)} /></div></details>}

    {notice && <p role="status" className="rounded-xl bg-[var(--teal-pale)] px-4 py-3 text-sm font-semibold text-[var(--teal-strong)]">{notice.text}{notice.href && <a href={notice.href} className="ml-2 underline underline-offset-4">{notice.linkLabel ?? "查看"} →</a>}</p>}
    {openItems.length ? <div className="grid gap-3 md:grid-cols-2">{openItems.map((item) => <InterventionCard key={item.id} item={item} busy={busy === item.id} onAccept={() => void update(item.id, { status: "ACCEPTED", actionIndex: 0 })} onSnooze={() => void update(item.id, { status: "SNOOZED", snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })} onDismiss={() => void update(item.id, { status: "DISMISSED", dismissReason: "用户暂时忽略" })} />)}</div> : <div className="card-surface rounded-2xl p-6 text-center"><Check className="mx-auto text-[var(--teal)]" /><p className="mt-3 font-bold">当前没有待处理提醒</p><p className="mt-1 text-sm text-[var(--ink-soft)]">继续捕获项目碎片，或点击重新评估检查新的上下文变化。</p></div>}
    {historyItems.length > 0 && <details className="rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] px-4 py-3.5"><summary className="focus-ring cursor-pointer list-none rounded-xl text-sm font-black text-[var(--navy)]">最近处理 <span className="ml-1 text-xs text-[var(--muted)]">{historyItems.length} 条</span></summary><div className="mt-3 space-y-2 border-t archive-rule pt-3">{historyItems.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--paper-strong)] px-3 py-2.5 text-xs"><div><span className="font-bold text-[var(--navy)]">{item.title}</span><span className="ml-2 text-[var(--muted)]">{interventionStatusLabels[item.status]}{item.status === "SNOOZED" && item.snoozedUntil ? ` · ${new Date(item.snoozedUntil).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 再提醒` : ""}</span></div>{item.status === "ACCEPTED" && <a href="#action-board" className="font-black text-[var(--teal-strong)] underline underline-offset-3">查看行动 →</a>}</div>)}</div></details>}
  </section>;
}

function ScenarioButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={active} className="focus-ring rounded-lg bg-[var(--card-bg)] px-2.5 py-2 text-xs font-bold text-[var(--navy)] shadow-sm transition hover:bg-[var(--paper-strong)] disabled:opacity-60">{active ? <LoaderCircle size={13} className="mr-1 inline animate-spin" /> : <Play size={13} className="mr-1 inline" />}{label}</button>;
}

function InterventionCard({ item, busy, onAccept, onSnooze, onDismiss }: { item: InterventionData; busy: boolean; onAccept: () => void; onSnooze: () => void; onDismiss: () => void }) {
  const Icon = triggerIcon[item.triggerType] ?? Sparkles;
  const evidence = item.evidence;
  const proposed = item.proposedActions?.[0] as ProposedAction | undefined;
  return <article className={"flex min-w-0 flex-col rounded-2xl border p-4 " + (item.isSimulated ? "border-dashed border-[var(--amber)] bg-[var(--amber)]/10" : "border-[var(--rule)] bg-[var(--card-bg)]")}>
    <div className="flex items-start justify-between gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--teal-pale)] text-[var(--teal-strong)]"><Icon size={18} /></span><div className="flex flex-wrap justify-end gap-1.5"><span className="rounded-full bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--ink-soft)]">{interventionTriggerLabels[item.triggerType]}</span>{item.isSimulated && <span className="rounded-full bg-[#fff0c7] px-2 py-1 text-[11px] font-bold text-[var(--amber)]">模拟数据</span>}</div></div>
    <h3 className="mt-3 font-black text-[var(--navy)]">{item.title}</h3><p className="mt-1.5 flex-1 text-sm leading-6 text-[var(--ink-soft)]">{item.content}</p>
    <details className="mt-3 rounded-xl bg-[var(--paper-strong)] p-3 text-xs"><summary className="focus-ring cursor-pointer rounded font-bold text-[var(--navy)]">查看触发依据与判断</summary><div className="mt-2 space-y-1.5 leading-5 text-[var(--ink-soft)]"><p><span className="font-bold">规则：</span>{evidence.rule}</p>{evidence.facts.map((fact) => <p key={fact}>· {fact}</p>)}{evidence.cardIds?.length ? <p><span className="font-bold">引用卡片：</span>{evidence.cardIds.map((id) => <a key={id} href={`#card-${id}`} className="ml-1 underline underline-offset-2">查看</a>)}</p> : null}</div></details>
    {proposed && <div className="mt-3 rounded-xl border border-[var(--teal)]/30 bg-[var(--teal-pale)] p-3 text-xs"><p className="font-black text-[var(--teal-strong)]">建议行动</p><p className="mt-1 font-bold text-[var(--navy)]">{proposed.title}</p><p className="mt-1 leading-5 text-[var(--ink-soft)]">{proposed.description}</p></div>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onAccept} disabled={busy || item.status === "ACCEPTED"} className="focus-ring editorial-button flex-1 justify-center text-xs disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{item.status === "ACCEPTED" ? "已创建行动" : "接受并创建行动"}</button><button type="button" onClick={onSnooze} disabled={busy} className="focus-ring editorial-button-secondary text-xs"><Clock3 size={14} />稍后</button><button type="button" onClick={onDismiss} disabled={busy} aria-label="忽略提醒" className="focus-ring rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--brick-pale)] hover:text-[var(--brick)]"><X size={15} /></button></div>
    <p className="mt-2 text-[11px] text-[var(--muted)]">状态：{interventionStatusLabels[item.status]}</p>
  </article>;
}
