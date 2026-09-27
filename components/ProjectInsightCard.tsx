"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import { isInterventionActive } from "@/lib/projectDashboard";
import { interventionTriggerLabels, type InterventionData } from "@/lib/types";

function severityCopy(severity: number) {
  if (severity >= 4) return { label: "高风险", className: "bg-[var(--brick-pale)] text-[var(--brick)]" };
  if (severity >= 3) return { label: "需要留意", className: "bg-[var(--amber)]/15 text-[var(--amber)]" };
  return { label: "供参考", className: "bg-[var(--paper-strong)] text-[var(--ink-soft)]" };
}

/**
 * 工作台首屏判断：当前最该看的一条主动提醒。
 *
 * 只承载「判断 + 依据入口」，接受/稍后/忽略仍在下面的主动提醒区完成，
 * 避免同一份提醒出现两套可写入口。
 */
export function ProjectInsightCard({ projectId, intervention }: { projectId: string; intervention: InterventionData | null }) {
  const [current, setCurrent] = useState(intervention);
  const [refreshError, setRefreshError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/interventions`, { cache: "no-store" });
      if (!response.ok) throw new Error("提醒读取失败");
      const data = await response.json();
      setCurrent((data.interventions as InterventionData[]).find((item) => isInterventionActive(item)) ?? null);
      setRefreshError(false);
    } catch {
      // 不把上一轮判断继续展示为「当前最该看」的提醒。
      setCurrent(null);
      setRefreshError(true);
    }
  }, [projectId]);

  useEffect(() => subscribeWorkspaceChange(projectId, ["interventions"], () => void reload()), [projectId, reload]);

  if (refreshError) return <section id="project-insight" aria-label="ProjectMemo Insight" className="rounded-xl bg-[var(--brick-pale)] p-4 text-sm text-[var(--brick)]">
    当前提醒暂时无法更新。<button type="button" onClick={() => void reload()} className="focus-ring ml-2 font-bold underline">重试</button>
  </section>;
  if (!current) return null;
  const severity = severityCopy(current.severity);
  return <section id="project-insight" aria-labelledby="project-insight-title" className={"scroll-mt-24 rounded-[1.5rem] border p-5 sm:p-6 " + (current.severity >= 4 ? "border-[var(--brick)]/35 bg-[var(--brick-pale)]/40" : "border-[var(--rule)] bg-[var(--card-bg)]")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs font-black tracking-[.14em] text-[var(--navy)] uppercase"><Sparkles size={15} className="text-[var(--teal-strong)]" />ProjectMemo Insight</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={"rounded-full px-2 py-0.5 text-[11px] font-bold " + severity.className}>{severity.label}</span>
        <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-soft)]">{interventionTriggerLabels[current.triggerType] ?? current.triggerType}</span>
        {current.isSimulated && <span className="rounded-full bg-[#fff0c7] px-2 py-0.5 text-[11px] font-bold text-[var(--amber)]">模拟数据</span>}
      </div>
    </div>
    <h2 id="project-insight-title" className="mt-3 text-base font-black leading-6 text-[var(--navy)] sm:text-lg">{current.title}</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{current.content}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">依据可查看</span>
      <span className="rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--ink-soft)]">系统生成的建议</span>
      <a href="#interventions" className="focus-ring editorial-button-secondary ml-auto text-xs">查看依据并处理</a>
    </div>
    {current.isSimulated && <p className="mt-2 text-[11px] font-semibold text-[var(--amber)]">这是演示情境生成的模拟提醒，不计入真实项目指标。</p>}
  </section>;
}
