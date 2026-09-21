"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, Info, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";

type HealthSeverity = "ACTION_REQUIRED" | "ATTENTION" | "INFO";

type HealthFinding = {
  findingCode: string;
  severity: HealthSeverity;
  objectType: string;
  objectId: string;
  title: string;
  explanation: string;
  observedAt: string;
  suggestedAction: string;
  suggestedTarget: { kind: string; id: string | null; fallback?: string | null };
};

type HealthReport = {
  findings: HealthFinding[];
  severityCounts: Record<HealthSeverity, number>;
  groups: Array<{ severity: HealthSeverity; count: number; findingCodes: string[] }>;
  primaryAction: HealthFinding | null;
  primaryMessage: string;
  unavailable: Array<{ section: string; errorCode: string; message: string }>;
  generatedAt: string;
  readOnly: boolean;
};

const severityCopy: Record<HealthSeverity, { label: string; className: string; icon: typeof Info }> = {
  ACTION_REQUIRED: { label: "需要马上处理", className: "bg-[var(--brick-pale)] text-[var(--brick)]", icon: ShieldAlert },
  ATTENTION: { label: "需要留意", className: "bg-[var(--amber)]/15 text-[var(--amber)]", icon: AlertTriangle },
  INFO: { label: "供参考", className: "bg-[var(--paper-strong)] text-[var(--ink-soft)]", icon: Info },
};

/**
 * 修复入口映射。
 * 项目页已有的分节锚点就是各问题的修复入口，不新增一级导航，也不新建独立页面。
 */
const targetHref: Record<string, string> = {
  episode: "#episode-checkpoint",
  action: "#action-board",
  reminder: "#action-board",
  state: "#capture-box",
  meeting: "#interventions",
  deliverable: "#competition-readiness",
  card: "#knowledge-assets",
  attachment: "#knowledge-assets",
  memory: "#knowledge-assets",
};

function hrefFor(finding: HealthFinding): string {
  return targetHref[finding.suggestedTarget.kind] ?? "#main-content";
}

/** 项目体检：只读聚合的当前问题清单，不展示「健康度 87 分」这类综合评分 */
export function ProjectHealthCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/health`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取项目体检失败");
      setReport(data.report as HealthReport);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取项目体检失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 都发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  const total = report?.findings.length ?? 0;
  const primary = report?.primaryAction ?? null;

  return <section id="project-health" aria-labelledby="project-health-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div className="min-w-0">
        <p className="archive-label">项目体检</p>
        <h2 id="project-health-title" className="mt-2 flex items-center gap-2 text-lg font-black">
          <ClipboardCheck size={18} className="text-[var(--teal-strong)]" />检查项目当前问题
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">只读检查，不改动项目；每条问题都能直接跳到修复入口。</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
        {loading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}重新检查
      </button>
    </div>

    {loading && <p className="mt-4 flex items-center gap-1.5 text-sm text-[var(--ink-soft)]"><LoaderCircle size={14} className="animate-spin" />正在检查项目当前状态…</p>}

    {!loading && error && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
      <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
    </div>}

    {!loading && !error && report && total === 0 && <p className="mt-4 rounded-xl bg-[var(--paper-strong)] p-5 text-center text-sm font-bold text-[var(--ink-soft)]">
      当前没有需要立即处理的问题
    </p>}

    {!loading && !error && report && total > 0 && primary && <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + severityCopy[primary.severity].className}>{severityCopy[primary.severity].label}</span>
        <span className="text-[11px] font-bold text-[var(--muted)]">共 {total} 个待处理问题</span>
        {report.groups.map((group) => <span key={group.severity} className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">
          {severityCopy[group.severity].label} {group.count}
        </span>)}
      </div>
      <p className="mt-2 text-sm font-black text-[var(--navy)]">{primary.title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{primary.explanation}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={hrefFor(primary)} className="focus-ring editorial-button text-xs">处理最重要的问题</a>
        <button type="button" onClick={() => setShowAll((previous) => !previous)} className="focus-ring editorial-button-secondary text-xs">
          {showAll ? "收起检查结果" : "查看全部检查结果"}
        </button>
      </div>

      {showAll && <ul className="mt-3 space-y-2">
        {report.findings.map((finding) => {
          const copy = severityCopy[finding.severity];
          const Icon = copy.icon;
          return <li key={`${finding.findingCode}-${finding.objectId}`} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold " + copy.className}>
                <Icon size={11} />{copy.label}
              </span>
              <span className="text-xs font-black text-[var(--navy)]">{finding.title}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{finding.explanation}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <a href={hrefFor(finding)} className="focus-ring rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">{finding.suggestedAction}</a>
              <span className="text-[11px] text-[var(--muted)]">发现于 {new Date(finding.observedAt).toLocaleString("zh-CN", { hour12: false })}</span>
            </div>
          </li>;
        })}
      </ul>}
    </div>}

    {!loading && report && report.unavailable.length > 0 && <div className="mt-3 rounded-lg bg-[var(--amber)]/10 px-3 py-2">
      {report.unavailable.map((item) => <p key={item.section} className="text-[11px] font-semibold text-[var(--amber)]">{item.message}</p>)}
      <p className="mt-1 text-[11px] text-[var(--muted)]">其余检查结果仍然有效，以上部分暂不可用。</p>
    </div>}
  </section>;
}
