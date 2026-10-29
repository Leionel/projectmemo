"use client";
import { useRef, useState } from "react";
import type { ImpactAssessment } from "@/lib/decision/impact";
const edgeLabels: Record<string, string> = {
  CARD_SOURCE: "记录提炼",
  DECLARED_SUPPORT: "声明支持",
  PROVENANCE: "来源追溯",
  REQUIREMENT: "执行依赖",
  ALTERNATIVE_EVIDENCE: "备选证据",
  BLOCK_CITATION: "段落引用",
  MISSION_OUTPUT: "委托草稿",
  MISSION_READSET: "委托读取",
};
const labels = {
  SUPPORT_CHANGED: "支持变化",
  NEEDS_REVIEW: "需要复核",
  HARD_PREREQUISITE_UNMET: "硬前提未满足",
  PLAN_STALE: "计划需重评",
};
export function ProjectImpact({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{
      assessment: ImpactAssessment;
      pendingJobs: number;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${projectId}/impact`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const v = await r.json();
      if (g !== generation.current) return;
      if (!r.ok) {
        if ([401, 403, 404].includes(r.status)) setData(null);
        throw new Error(v.error?.message ?? "影响摘要暂不可用");
      }
      if (v.enabled) setData(v);
    } catch (e) {
      if (g === generation.current)
        setError(e instanceof Error ? e.message : "影响读取失败");
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  return (
    <details
      className="rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-4"
      onToggle={(e) => {
        if (e.currentTarget.open && !data && !busy) void load();
      }}
    >
      <summary className="focus-ring cursor-pointer text-sm font-bold">
        新资料影响了哪些计划与成果
      </summary>
      <div className="mt-3 space-y-2 text-sm leading-6">
        {error && (
          <p role="status" className="text-[var(--brick)]">
            {error}
            {data ? "；以下为上次读取结果。" : ""}
          </p>
        )}
        <button
          className="workspace-tool focus-ring"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "正在读取影响路径…" : "重新读取影响"}
        </button>
        {data && (
          <>
            <p>
              读取于{" "}
              {new Date(data.assessment.observedAt).toLocaleString("zh-CN")} ·{" "}
              {data.assessment.coverage.state === "COMPLETE"
                ? "当前窄范围已覆盖"
                : "范围不完整，部分影响未知"}
              {data.pendingJobs > 0
                ? ` · ${data.pendingJobs} 项影响处理待完成`
                : ""}
            </p>
            <p>{data.assessment.note}</p>
            {data.assessment.items.length === 0 ? (
              <p>
                当前范围内没有找到相关影响路径；未映射来源的旧文稿不在自动判断范围。
              </p>
            ) : (
              data.assessment.items.slice(0, 8).map((i) => (
                <article
                  key={i.target}
                  className="border-t border-[var(--rule)] pt-2"
                >
                  <strong>
                    {labels[i.kind]} · {i.title}
                  </strong>
                  {i.historical && <span>（历史记录保留）</span>}
                  <ol className="mt-1 text-xs text-[var(--muted)]">
                    {i.path.map((e, n) => (
                      <li key={n} className="break-all">
                        {e.fromTitle ?? e.from} →{" "}
                        {edgeLabels[e.kind] ?? "相关联系"} → {e.toTitle ?? e.to}
                      </li>
                    ))}
                  </ol>
                </article>
              ))
            )}
            {data.assessment.items.length > 8 && (
              <p>
                共 {data.assessment.items.length}{" "}
                个相关对象，进入原委托或成果查看相应版本。
              </p>
            )}
            <p className="text-xs text-[var(--muted)]">
              尚未覆盖外部语义核验及无来源映射的旧文稿。
            </p>
          </>
        )}
      </div>
    </details>
  );
}
