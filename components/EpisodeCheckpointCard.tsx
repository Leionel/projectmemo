"use client";

import { useCallback, useEffect, useState } from "react";
import { BookmarkCheck, Check, ChevronDown, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";

type EpisodeSourceRef = { refId: string; kind: string; entityId: string; revisionIndex: number | null; observedAt: string; title: string };
type EpisodeClaim = { claimId: string; kind: string; section: string; text: string; sourceRefIds: string[] };
type EpisodeRevisionData = {
  id: string; revision: number; sourceHash: string; status: string; createdAt: string;
  sourceRefs: EpisodeSourceRef[]; claims: EpisodeClaim[];
  summary: { sections: Array<{ section: string; text: string }> };
  generationMode: string;
};
type EpisodeData = {
  id: string; title: string; status: string; windowStart: string; windowEnd: string;
  revisions: EpisodeRevisionData[];
  freshness?: { status: string; affectedClaims: Array<{ claimId: string; reason: string }>; sources: Array<{ refId: string; state: string; displayReason: string }> };
};
type ScopeReport = { includedCount: number; excludedReasons: string[]; contestedCount: number; unknownCount: number };

const kindLabels: Record<string, string> = { CARD: "记录", ATTACHMENT_REVISION: "附件修订", ACTION_RESULT: "行动结果", SNAPSHOT: "状态快照" };
const sectionLabels: Record<string, string> = {
  GOALS: "阶段目标", CONFIRMED_CHANGES: "已确认变化", DECISION_TRAIL: "决策演化",
  COMPLETED_ACTIONS: "完成行动", OPEN_QUESTIONS: "争议与未知", NEXT_STEPS: "下一步建议",
};
const sectionOrder = ["GOALS", "CONFIRMED_CHANGES", "DECISION_TRAIL", "COMPLETED_ACTIONS", "OPEN_QUESTIONS", "NEXT_STEPS"];

function revisionTitle(revision: EpisodeRevisionData, episode: EpisodeData) {
  const first = revision.claims.find((claim) => claim.section === "CONFIRMED_CHANGES");
  return first?.text ?? episode.title;
}

export function EpisodeCheckpointCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [preview, setPreview] = useState<{ episode: EpisodeData; scope: ScopeReport } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "加载检查点失败");
      setEpisodes(data.episodes ?? []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载检查点失败");
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

  const current = episodes.find((item) => item.status !== "DRAFT") ?? null;
  const currentRevision = current ? current.revisions[current.revisions.length - 1] : null;
  const stale = current && (current.status === "PARTIALLY_STALE" || current.status === "STALE");
  const affectedIds = new Set((current?.freshness?.affectedClaims ?? []).map((item) => item.claimId));

  async function generate() {
    setBusy("preview");
    setMessage("");
    try {
      const windowEnd = new Date().toISOString();
      const windowStart = current
        ? current.windowEnd
        : new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
      const response = await fetch(`/api/projects/${projectId}/episodes/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowStart, windowEnd }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成预览失败");
      setPreview(data);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成预览失败");
    } finally {
      setBusy(null);
    }
  }

  async function refreshCurrent() {
    if (!current) return;
    setBusy("refresh");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${current.id}/refresh`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "刷新失败");
      setPreview({ episode: data.episode, scope: { includedCount: 0, excludedReasons: [], contestedCount: 0, unknownCount: 0 } });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刷新失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    const revision = preview.episode.revisions[preview.episode.revisions.length - 1];
    setBusy("confirm");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${preview.episode.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.revision, requestId: crypto.randomUUID(), expectedSourceHash: revision.sourceHash }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "确认失败");
      setPreview(null);
      setMessage("阶段检查点已确认。");
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认失败");
    } finally {
      setBusy(null);
    }
  }

  return <section id="episode-checkpoint" aria-labelledby="episode-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div>
        <p className="archive-label">阶段检查点</p>
        <h2 id="episode-title" className="mt-2 flex items-center gap-2 text-lg font-black"><BookmarkCheck size={18} className="text-[var(--teal-strong)]" />整理阶段进展</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">把散乱记忆收束为可确认版本；每条结论都能回到当时的来源。</p>
      </div>
      {!preview && <button type="button" onClick={() => void generate()} disabled={busy === "preview" || loading} className="focus-ring editorial-button-secondary disabled:opacity-50">
        {busy === "preview" ? <LoaderCircle size={15} className="animate-spin" /> : <BookmarkCheck size={15} />}
        {current ? "整理新阶段" : "整理最近 7 天"}
      </button>}
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}

    {loading && <p className="mt-4 text-sm text-[var(--ink-soft)]">正在读取检查点…</p>}

    {!loading && !preview && !current && <div className="mt-4 rounded-xl bg-[var(--paper-strong)] p-5 text-center">
      <p className="text-sm font-bold text-[var(--ink-soft)]">还没有阶段检查点。</p>
      <p className="mt-1 text-xs text-[var(--muted)]">隔几天回到项目时，先用 60 秒看清上次做到哪、哪些结论仍有效。</p>
    </div>}

    {!loading && !preview && current && currentRevision && <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-black text-[var(--navy)]">{revisionTitle(currentRevision, current)}</h3>
        <span className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + (stale ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--teal-pale)] text-[var(--teal-strong)]")}>
          {current.status === "PARTIALLY_STALE" ? "部分结论来源已变化" : current.status === "STALE" ? "基线已失效，请重新整理" : "结论仍然有效"}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">评估于 {new Date(currentRevision.createdAt).toLocaleString("zh-CN")} · 依据截至 {new Date(current.windowEnd).toLocaleDateString("zh-CN")}</p>

      <ul className="mt-3 space-y-2">
        {currentRevision.claims.filter((claim) => claim.kind === "FACT").slice(0, 3).map((claim) => <li key={claim.claimId} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3 text-xs leading-5">
          <span className={affectedIds.has(claim.claimId) ? "text-[var(--amber)] line-through decoration-[var(--amber)]/60" : ""}>{claim.text}</span>
          {affectedIds.has(claim.claimId) && <span className="mt-1 block font-bold text-[var(--amber)]">{current.freshness?.affectedClaims.find((item) => item.claimId === claim.claimId)?.reason}</span>}
        </li>)}
      </ul>

      {(stale || currentRevision.claims.length > 3) && <details className="mt-3">
        <summary className="focus-ring w-fit cursor-pointer list-none rounded-lg text-xs font-bold text-[var(--teal-strong)]"><ChevronDown size={13} className="mr-1 inline" />
          {stale ? `查看受影响结论（${affectedIds.size} 条）与全部内容` : "查看全部结论"}
        </summary>
        <div className="mt-3 space-y-3">
          {sectionOrder.map((section) => {
            const claims = currentRevision.claims.filter((claim) => claim.section === section);
            if (!claims.length) return null;
            return <div key={section}>
              <p className="text-xs font-black text-[var(--navy)]">{sectionLabels[section]}</p>
              <ul className="mt-1.5 space-y-1.5">
                {claims.map((claim) => <li key={claim.claimId} className={"rounded-lg border p-2.5 text-xs leading-5 " + (affectedIds.has(claim.claimId) ? "border-[var(--amber)]/50 bg-[var(--amber)]/10" : "border-[var(--rule)] bg-[var(--card-bg)]")}>
                  <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (claim.kind === "FACT" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : claim.kind === "RULE" ? "bg-[var(--paper-strong)] text-[var(--ink-soft)]" : "bg-[var(--navy)]/10 text-[var(--navy)]")}>
                    {claim.kind === "FACT" ? "事实" : claim.kind === "RULE" ? "系统判断" : "建议"}
                  </span>
                  <span className={affectedIds.has(claim.claimId) ? "text-[var(--amber)]" : ""}>{claim.text}</span>
                  {affectedIds.has(claim.claimId) && <span className="mt-1 block font-bold text-[var(--amber)]">{current.freshness?.affectedClaims.find((item) => item.claimId === claim.claimId)?.reason}</span>}
                  <ClaimSources claim={claim} refs={currentRevision.sourceRefs} freshness={current.freshness} />
                </li>)}
              </ul>
            </div>;
          })}
        </div>
      </details>}

      <div className="mt-4 flex flex-wrap gap-2">
        <a href="#action-board" className="focus-ring editorial-button text-xs">继续推进<Check size={14} /></a>
        <button type="button" onClick={() => void refreshCurrent()} disabled={Boolean(busy)} className="focus-ring editorial-button-secondary text-xs">{busy === "refresh" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}根据最新来源重新整理</button>
      </div>
    </div>}

    {preview && <div className="mt-4">
      <p className="rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
        预览未生效：确认后才成为当前阶段判断。纳入 {preview.scope.includedCount} 个来源
        {preview.scope.excludedReasons.length > 0 && `；${preview.scope.excludedReasons.join("；")}`}
        {(preview.scope.contestedCount > 0 || preview.scope.unknownCount > 0) && `；争议 ${preview.scope.contestedCount} 条、证据不足 ${preview.scope.unknownCount} 条已如实标注`}
      </p>
      <div className="mt-3 space-y-3">
        {sectionOrder.map((section) => {
          const revision = preview.episode.revisions[preview.episode.revisions.length - 1];
          const claims = revision.claims.filter((claim) => claim.section === section);
          if (!claims.length) return null;
          return <div key={section}>
            <p className="text-xs font-black text-[var(--navy)]">{sectionLabels[section]}</p>
            <ul className="mt-1.5 space-y-1.5">
              {claims.map((claim) => <li key={claim.claimId} className="rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-2.5 text-xs leading-5">
                <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (claim.kind === "FACT" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : claim.kind === "RULE" ? "bg-[var(--paper-strong)] text-[var(--ink-soft)]" : "bg-[var(--navy)]/10 text-[var(--navy)]")}>
                  {claim.kind === "FACT" ? "事实" : claim.kind === "RULE" ? "系统判断" : "建议"}
                </span>
                {claim.text}
                <ClaimSources claim={claim} refs={revision.sourceRefs} freshness={undefined} />
              </li>)}
            </ul>
          </div>;
        })}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setPreview(null)} className="focus-ring editorial-button-secondary text-xs">取消</button>
        <button type="button" onClick={() => void confirm()} disabled={busy === "confirm"} className="focus-ring editorial-button text-xs">
          {busy === "confirm" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}确认这一版
        </button>
      </div>
    </div>}
  </section>;
}

function ClaimSources({ claim, refs, freshness }: { claim: EpisodeClaim; refs: EpisodeSourceRef[]; freshness?: EpisodeData["freshness"] }) {
  const sources = claim.sourceRefIds
    .map((refId) => refs.find((ref) => ref.refId === refId))
    .filter((ref): ref is EpisodeSourceRef => Boolean(ref));
  if (!sources.length) return null;
  return <details className="mt-2">
    <summary className="focus-ring w-fit cursor-pointer list-none rounded text-[11px] font-bold text-[var(--muted)] hover:text-[var(--teal-strong)]">
      <TriangleAlert size={11} className="mr-1 inline" />来源（{sources.length}）
    </summary>
    <ul className="mt-1.5 space-y-1">
      {sources.map((ref) => {
        const state = freshness?.sources.find((item) => item.refId === ref.refId);
        return <li key={ref.refId} className="rounded-md bg-[var(--paper-strong)] px-2 py-1.5 text-[11px] leading-4 text-[var(--ink-soft)]">
          <span className="font-bold text-[var(--navy)]">{kindLabels[ref.kind] ?? ref.kind}：</span>{ref.title || ref.entityId}
          <span className="ml-1 text-[var(--muted)]">观察于 {new Date(ref.observedAt).toLocaleDateString("zh-CN")}</span>
          {state && state.state !== "AVAILABLE" && <span className="ml-1 font-bold text-[var(--amber)]">{state.displayReason}</span>}
        </li>;
      })}
    </ul>
  </details>;
}
