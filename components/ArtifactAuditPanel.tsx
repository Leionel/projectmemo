"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ScanSearch, ShieldCheck, TriangleAlert, X } from "lucide-react";
import type { ArtifactAuditResponse } from "@/lib/types";

const claimsStatusCopy: Record<ArtifactAuditResponse["claimsStatus"], string> = {
  TEMPLATE_BOUND: "逐句引用已保存：每条结论都能回到生成时引用的记录",
  UNMAPPED_MODEL: "模型文案未逐句映射：只能核对生成时引用的记录，不能逐句回溯",
  LEGACY_NO_CLAIMS: "旧成果没有保存逐句映射：重新生成后可逐句回溯",
  NONE: "这份成果没有保存引用映射",
};

const stateTone: Record<string, string> = {
  CURRENT: "bg-[var(--teal-pale)] text-[var(--teal-strong)]",
  SUPERSEDED: "bg-[var(--paper-strong)] text-[var(--muted)]",
  CONTESTED: "bg-[var(--brick-pale)] text-[var(--brick)]",
  UNKNOWN: "bg-[var(--amber)]/15 text-[var(--amber)]",
  UNCONFIRMED: "bg-[var(--amber)]/15 text-[var(--amber)]",
  MISSING: "bg-[var(--brick-pale)] text-[var(--brick)]",
  UNVERIFIED: "bg-[var(--amber)]/15 text-[var(--amber)]",
};

function readError(data: unknown, fallback: string) {
  const message = (data as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message ? message : fallback;
}

/**
 * 成果证据透视：每次打开都重新向服务端核对，不缓存上一次的结论。
 *
 * 生成时冻结的引用与当前重检结果分开展示；被取代的记录会给出取代链
 * （原决策 → 替代决策 + 确认时间与原因），不会把历史版本当成当前事实。
 */
export function ArtifactAuditPanel({ projectId, artifactId, onClose }: { projectId: string; artifactId: string; onClose: () => void }) {
  const [audit, setAudit] = useState<ArtifactAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${artifactId}/audit`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data, "证据审计获取失败"));
      setAudit(data as ArtifactAuditResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "证据审计获取失败");
    } finally {
      setLoading(false);
    }
  }, [artifactId, projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return <div className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-black text-[var(--navy)]"><ScanSearch size={15} className="text-[var(--teal-strong)]" />证据透视</p>
        {audit && <p className="mt-1 text-[11px] text-[var(--muted)]">重新核对于 {new Date(audit.recheckedAt).toLocaleString("zh-CN", { hour12: false })} · 生成于 {new Date(audit.generatedAt).toLocaleString("zh-CN", { hour12: false })}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void reload()} disabled={loading} className="focus-ring rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">{loading ? <LoaderCircle size={12} className="animate-spin" /> : "重新核对"}</button>
        <button type="button" onClick={onClose} aria-label="收起证据透视" className="focus-ring rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper-strong)]"><X size={14} /></button>
      </div>
    </div>

    {loading && <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--ink-soft)]"><LoaderCircle size={13} className="animate-spin" />正在逐句核对当前记录状态…</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}

    {audit && <>
      <p className="mt-3 rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-[11px] leading-5 text-[var(--ink-soft)]">{audit.message}</p>
      <p className={"mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold " + (audit.untraceable ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--teal-pale)] text-[var(--teal-strong)]")}>
        {audit.untraceable ? <TriangleAlert size={12} /> : <ShieldCheck size={12} />}{claimsStatusCopy[audit.claimsStatus] ?? audit.claimsStatus}
      </p>

      {audit.claims.length > 0 && <div className="mt-3">
        <p className="text-[11px] font-black text-[var(--navy)]">逐句核验（{audit.claims.length}）</p>
        <ul className="mt-1.5 space-y-1.5">
          {audit.claims.map((claim) => <li key={claim.claimId} className="rounded-lg bg-[var(--paper-strong)] p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (stateTone[claim.state] ?? "bg-[var(--paper-strong)] text-[var(--muted)]")}>{claim.stateLabel}</span>
              <span className="rounded bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ink-soft)]">{claim.verification === "TEMPLATE_BOUND" ? "模板绑定" : "语义未核验"}</span>
              {claim.section && <span className="text-[10px] text-[var(--muted)]">{claim.section}</span>}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--ink)]">{claim.text}</p>
            {claim.cardStates.length > 0 && <ul className="mt-1.5 space-y-1">
              {claim.cardStates.map((state) => <li key={state.cardId} className="rounded bg-[var(--card-bg)] px-2 py-1 text-[10px] leading-4 text-[var(--ink-soft)]">
                <a href={`#card-${state.cardId}`} className="focus-ring font-bold text-[var(--teal-strong)] underline underline-offset-2">{state.statusLabel}</a>
                {state.displayReason ? ` · ${state.displayReason}` : ""}
              </li>)}
            </ul>}
            {claim.cardIds.length === 0 && <p className="mt-1 text-[10px] font-semibold text-[var(--amber)]">这句话没有绑定可核验的记录</p>}
          </li>)}
        </ul>
      </div>}

      {audit.recheck.length > 0 && <div className="mt-3">
        <p className="text-[11px] font-black text-[var(--navy)]">生成时引用的记录 · 当前重检（{audit.recheck.length}）</p>
        <ul className="mt-1.5 space-y-1.5">
          {audit.recheck.map((item) => <li key={item.cardId} className="rounded-lg bg-[var(--paper-strong)] p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (stateTone[item.topLevelState] ?? "bg-[var(--paper-strong)] text-[var(--muted)]")}>{item.statusLabel}</span>
              <a href={`#card-${item.cardId}`} className="focus-ring text-[11px] font-bold text-[var(--navy)] underline underline-offset-2">{item.titleSnapshot}</a>
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--ink-soft)]">冻结摘要：{item.summarySnapshot}</p>
            {item.displayReason && <p className="mt-1 text-[10px] font-semibold text-[var(--amber)]">{item.displayReason}</p>}
            {item.supersededByTitle && <p className="mt-1 rounded bg-[var(--card-bg)] px-2 py-1 text-[10px] leading-4 text-[var(--ink-soft)]">
              已被「{item.supersededByTitle}」取代{item.supersededConfirmedAt ? ` · 确认于 ${new Date(item.supersededConfirmedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}{item.supersededReason ? ` · 原因：${item.supersededReason}` : ""}
            </p>}
          </li>)}
        </ul>
      </div>}

      {audit.generationRefs.length > 0 && <details className="mt-3 rounded-lg bg-[var(--paper-strong)] p-2.5">
        <summary className="focus-ring cursor-pointer text-[11px] font-bold text-[var(--ink-soft)]">生成时冻结的引用快照（{audit.generationRefs.length}）</summary>
        <ul className="mt-1.5 space-y-1.5">
          {audit.generationRefs.map((ref) => <li key={ref.cardId} className="rounded bg-[var(--card-bg)] p-2 text-[10px] leading-4 text-[var(--ink-soft)]">
            <span className="font-bold text-[var(--navy)]">{ref.titleSnapshot}</span>
            <span className="ml-1.5 text-[var(--muted)]">观察于 {ref.observedAt ? new Date(ref.observedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</span>
            <span className="mt-0.5 block line-clamp-2">{ref.summarySnapshot}</span>
          </li>)}
        </ul>
        <p className="mt-1.5 text-[10px] text-[var(--muted)]">快照保存生成当时的记录内容，不随后续编辑变化；当前状态以上面的重检结果为准。</p>
      </details>}

      {!audit.untraceable && audit.claims.length === 0 && audit.recheck.length === 0 && <p className="mt-3 rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-[11px] leading-5 text-[var(--ink-soft)]">这份成果没有可核对的引用：它可能是在项目还没有记忆时生成的。补充记录后重新生成，就能逐句回溯。</p>}
    </>}
  </div>;
}
