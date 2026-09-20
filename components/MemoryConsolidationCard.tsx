"use client";

import { useCallback, useEffect, useState } from "react";
import { Combine, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";

type CardSummary = { id: string; title: string; summary: string; importance: number; createdAt: string; topLevelState: string };
type Proposal = {
  proposalId: string;
  reason: string;
  similarityScore: number;
  masterCardId: string;
  cards: CardSummary[];
  mergedPreview: string;
  preservedSources: string[];
};
type Receipt = {
  id: string;
  masterCardId: string;
  masterCardTitle: string;
  mergedCardIds: string[];
  reason: string;
  status: string;
  createdAt: string;
  revokedAt: string | null;
};

/**
 * 可撤销归并：只提出建议，确认后归档重复卡并留下回执。
 * 原始 Capture、附件修订、关系与历史快照始终保留，撤销按回执恢复。
 */
export function MemoryConsolidationCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [proposalResponse, receiptResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/consolidation`),
        fetch(`/api/projects/${projectId}/consolidation/receipts`),
      ]);
      const proposalData = await proposalResponse.json().catch(() => null);
      const receiptData = await receiptResponse.json().catch(() => null);
      if (!proposalResponse.ok) throw new Error(proposalData?.error?.message ?? "读取归并建议失败");
      setProposals(proposalData.proposals ?? []);
      setReceipts(receiptResponse.ok ? receiptData.receipts ?? [] : []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取归并建议失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  async function confirmMerge(proposal: Proposal) {
    setBusy(proposal.proposalId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/consolidation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterCardId: proposal.masterCardId,
          mergedCardIds: proposal.cards.map((card) => card.id).filter((id) => id !== proposal.masterCardId),
          reason: proposal.reason,
          requestId: crypto.randomUUID(),
          similarityScore: proposal.similarityScore,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "归并失败");
      setMessage("已归并；原始记录仍保留，可在下方撤销。");
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归并失败");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(receipt: Receipt) {
    setBusy(receipt.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/consolidation/${receipt.id}/revoke`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "撤销失败");
      setMessage("已撤销归并，被归档的记录已恢复。");
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销失败");
    } finally {
      setBusy(null);
    }
  }

  const activeReceipts = receipts.filter((receipt) => receipt.status === "ACTIVE");

  return <section id="memory-consolidation" aria-labelledby="consolidation-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div>
        <p className="archive-label">记忆整理</p>
        <h2 id="consolidation-title" className="mt-2 flex items-center gap-2 text-lg font-black"><Combine size={18} className="text-[var(--teal-strong)]" />重复记录归并</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">只提出建议；确认后归档重复记录，原始 Capture 与关系全部保留，可随时撤销。</p>
      </div>
      <span className="text-xs font-bold text-[var(--muted)]">{proposals.length} 条待处理</span>
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
      <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
    </div>}

    {loading && <p className="mt-4 text-sm text-[var(--ink-soft)]">正在比对记录…</p>}

    {!loading && proposals.length === 0 && <p className="mt-4 rounded-xl bg-[var(--paper-strong)] p-4 text-center text-sm text-[var(--ink-soft)]">没有发现需要归并的重复记录。存在争议或取代关系的记录不会被建议合并。</p>}

    <ul className="mt-4 space-y-3">
      {proposals.map((proposal) => {
        const master = proposal.cards.find((card) => card.id === proposal.masterCardId);
        const others = proposal.cards.filter((card) => card.id !== proposal.masterCardId);
        return <li key={proposal.proposalId} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3.5">
          <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--amber)]"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{proposal.reason}</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--teal)]/40 bg-[var(--teal-pale)] p-2.5">
              <p className="text-[11px] font-black text-[var(--teal-strong)]">建议主记录</p>
              <p className="mt-1 text-xs font-bold text-[var(--navy)]">《{master?.title}》</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{master?.summary}</p>
            </div>
            <div className="rounded-lg border border-[var(--rule)] bg-[var(--paper-strong)] p-2.5">
              <p className="text-[11px] font-black text-[var(--muted)]">候选归并记录</p>
              {others.map((card) => <div key={card.id} className="mt-1">
                <p className="text-xs font-bold text-[var(--navy)]">《{card.title}》</p>
                <p className="text-xs leading-5 text-[var(--ink-soft)]">{card.summary}</p>
                <a href={`#card-${card.id}`} className="focus-ring text-[11px] font-bold text-[var(--teal-strong)] underline underline-offset-2">打开原记录</a>
              </div>)}
            </div>
          </div>
          <details className="mt-2.5">
            <summary className="focus-ring w-fit cursor-pointer list-none rounded text-[11px] font-bold text-[var(--muted)] hover:text-[var(--teal-strong)]">合并预览与保留的原始来源</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--paper-strong)] p-2.5 font-sans text-xs leading-5 text-[var(--ink-soft)]">{proposal.mergedPreview}</pre>
            <p className="mt-2 text-[11px] text-[var(--muted)]">归并后仍保留：{proposal.preservedSources.join("、")}。</p>
          </details>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setProposals((old) => old.filter((item) => item.proposalId !== proposal.proposalId))} className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper-strong)]">暂不处理</button>
            <button type="button" onClick={() => void confirmMerge(proposal)} disabled={busy === proposal.proposalId} className="focus-ring editorial-button text-xs">
              {busy === proposal.proposalId ? <LoaderCircle size={14} className="animate-spin" /> : <Combine size={14} />}确认归并
            </button>
          </div>
        </li>;
      })}
    </ul>

    {activeReceipts.length > 0 && <div className="mt-4 border-t archive-rule pt-4">
      <p className="text-xs font-black text-[var(--navy)]">已归并（可撤销）</p>
      <ul className="mt-2 space-y-1.5">
        {activeReceipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--paper-strong)] px-2.5 py-2 text-xs">
          <span className="text-[var(--ink-soft)]">主记录《{receipt.masterCardTitle || receipt.masterCardId}》 · 归并 {receipt.mergedCardIds.length} 条 · {new Date(receipt.createdAt).toLocaleDateString("zh-CN")}</span>
          <button type="button" onClick={() => void revoke(receipt)} disabled={busy === receipt.id} className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-[var(--card-bg)] px-2 py-1 font-bold text-[var(--brick)] border border-[var(--rule)]">
            {busy === receipt.id ? <LoaderCircle size={12} className="animate-spin" /> : <RotateCcw size={12} />}撤销
          </button>
        </li>)}
      </ul>
    </div>}
  </section>;
}
