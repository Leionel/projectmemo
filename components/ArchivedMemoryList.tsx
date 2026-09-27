"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, LoaderCircle } from "lucide-react";
import { emitWorkspaceChange, subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import { knowledgeTypeLabels, type KnowledgeTypeValue } from "@/lib/types";

type ArchivedCard = {
  id: string;
  title: string;
  summary: string;
  type: string;
  archivedAt: string | null;
  temporalState: string;
  displayReason: string;
};

const temporalLabels: Record<string, string> = {
  CURRENT: "当前有效",
  SUPERSEDED: "已被取代",
  CONTESTED: "存在争议",
  UNKNOWN: "暂不能确定",
};

/**
 * 已归档记忆：归档只是展示偏好，恢复不会改变事实的时态状态，
 * 也不会把已经被取代的旧结论重新变成当前事实。
 */
export function ArchivedMemoryList({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<ArchivedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/cards/archived`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取已归档记忆失败");
      setCards(data.cards ?? []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取已归档记忆失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return subscribeWorkspaceChange(projectId, ["cards"], () => void load());
  }, [load, projectId]);

  async function restore(card: ArchivedCard) {
    setBusy(card.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/cards/${card.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESTORE", reason: "从已归档列表恢复" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "恢复失败，请稍后重试");
      setCards((old) => old.filter((item) => item.id !== card.id));
      setNotice(`《${card.title}》已恢复到项目记忆；它的时态状态保持原样。`);
      emitWorkspaceChange(projectId, ["cards", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  // 没有已归档记忆时不占位；归档动作会通过工作区事件把新条目带回来
  if (cards.length === 0 && !error && !notice) return null;

  return <section id="archived-memory" aria-labelledby="archived-memory-title" className="card-surface scroll-mt-24 rounded-[1.45rem] p-5 sm:p-6">
    <details>
      <summary className="focus-ring cursor-pointer list-none">
        <p className="archive-label">已归档记忆</p>
        <h2 id="archived-memory-title" className="mt-2 flex items-center gap-2 text-base font-black text-[var(--navy)]"><ArchiveRestore size={17} className="text-[var(--teal-strong)]" />已归档记忆{cards.length > 0 && <span className="ml-1 rounded-md bg-[var(--paper-strong)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--muted)]">{cards.length}</span>}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">归档只影响列表展示，不改变事实的时态状态；恢复后不会复活已被取代的旧事实。</p>
      </summary>

      {loading && <p className="mt-3 text-xs text-[var(--muted)]">正在读取已归档记忆…</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{notice}</p>}
      {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
        <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
      </div>}

      {!loading && cards.length > 0 && <ul className="mt-3 space-y-2">
        {cards.map((card) => <li key={card.id} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[var(--paper-strong)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-soft)]">{knowledgeTypeLabels[card.type as KnowledgeTypeValue] ?? card.type}</span>
            <span className="text-sm font-bold text-[var(--navy)]">{card.title}</span>
            <span className="text-[11px] text-[var(--muted)]">{card.archivedAt ? `归档于 ${new Date(card.archivedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">时态：{temporalLabels[card.temporalState] ?? card.temporalState} · {card.displayReason}</p>
          <button type="button" onClick={() => void restore(card)} disabled={busy !== null} className="focus-ring mt-2 rounded-md bg-[var(--teal-pale)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">
            {busy === card.id ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : <ArchiveRestore size={12} className="mr-1 inline" />}恢复
          </button>
        </li>)}
      </ul>}
      {!loading && cards.length === 0 && <p className="mt-3 text-xs text-[var(--muted)]">当前没有已归档的记忆。</p>}
    </details>
  </section>;
}
