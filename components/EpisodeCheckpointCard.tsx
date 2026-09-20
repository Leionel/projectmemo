"use client";

import { useCallback, useEffect, useState } from "react";
import { BookmarkCheck, Check, ExternalLink, FileQuestion, History, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";

type EpisodeSourceRef = {
  refId: string;
  kind: string;
  entityId: string;
  revisionIndex: number | null;
  observedAt: string;
  title: string;
  summary?: string;
};
type EpisodeClaim = { claimId: string; kind: string; section: string; text: string; sourceRefIds: string[] };
type EpisodeRevisionData = {
  id: string;
  revision: number;
  sourceHash: string;
  status: string;
  confirmedAt: string | null;
  createdAt: string;
  generationMode: string;
  provider: string | null;
  fallbackReason: string | null;
  sourceRefs: EpisodeSourceRef[];
  claims: EpisodeClaim[];
  summary: { sections: Array<{ section: string; text: string }> };
};
type SourceState = { refId: string; state: string; displayReason: string };
type EpisodeData = {
  id: string;
  title: string;
  status: string;
  windowStart: string;
  windowEnd: string;
  revisions: EpisodeRevisionData[];
  freshness?: { status: string; affectedClaims: Array<{ claimId: string; reason: string }>; sources: SourceState[] };
};
type ScopeReport = { includedCount: number; excludedReasons: string[]; contestedCount: number; unknownCount: number };

const kindLabels: Record<string, string> = {
  CARD: "记录",
  ATTACHMENT_REVISION: "附件修订",
  ACTION_RESULT: "行动结果",
  SNAPSHOT: "状态快照",
};
const stateLabels: Record<string, string> = {
  AVAILABLE: "当前有效",
  SUPERSEDED: "已被取代",
  CONTESTED: "存在争议",
  DELETED: "原来源已删除",
  POLICY_CHANGED: "评估规则已更新",
};
const sectionLabels: Record<string, string> = {
  GOALS: "阶段目标",
  CONFIRMED_CHANGES: "已确认变化",
  DECISION_TRAIL: "决策演化",
  COMPLETED_ACTIONS: "完成行动",
  OPEN_QUESTIONS: "争议与未知",
  NEXT_STEPS: "下一步建议",
};
const sectionOrder = ["GOALS", "CONFIRMED_CHANGES", "DECISION_TRAIL", "COMPLETED_ACTIONS", "OPEN_QUESTIONS", "NEXT_STEPS"];

function statusLabel(status: string) {
  if (status === "PUBLISHED") return { text: "结论有效", tone: "ok" as const };
  if (status === "PARTIALLY_STALE") return { text: "部分失效", tone: "warn" as const };
  if (status === "STALE") return { text: "已失效", tone: "bad" as const };
  if (status === "DRAFT") return { text: "草稿", tone: "muted" as const };
  return { text: status, tone: "muted" as const };
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

/** 只有仍存在、且能定位到原始记录的来源才提供跳转 */
function sourceHref(ref: EpisodeSourceRef, state?: SourceState) {
  if (state?.state === "DELETED") return null;
  if (ref.kind === "CARD" || ref.kind === "ACTION_RESULT") return `#card-${ref.entityId}`;
  return null;
}

export function EpisodeCheckpointCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [preview, setPreview] = useState<{ episode: EpisodeData; scope: ScopeReport } | null>(null);
  const [historyRevision, setHistoryRevision] = useState<number | null>(null);
  const [sourceDrawer, setSourceDrawer] = useState<{ claim: EpisodeClaim; refs: EpisodeSourceRef[]; states: SourceState[] } | null>(null);
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

  const published = episodes.filter((item) => item.status !== "DRAFT");
  const current = published[0] ?? null;
  // 当前版本 = 已发布修订中版本号最大者；历史版本只读
  const publishedRevisions = current ? current.revisions.filter((item) => item.status === "PUBLISHED") : [];
  const currentRevision = publishedRevisions.length > 0
    ? publishedRevisions.reduce((best, item) => (item.revision > best.revision ? item : best))
    : null;
  const viewingRevision = historyRevision !== null && current
    ? current.revisions.find((item) => item.revision === historyRevision) ?? currentRevision
    : currentRevision;
  const isHistoryView = viewingRevision !== null && currentRevision !== null && viewingRevision.revision !== currentRevision.revision;
  const affectedIds = new Set((current?.freshness?.affectedClaims ?? []).map((item) => item.claimId));
  const sourceStates = current?.freshness?.sources ?? [];
  const badge = current ? statusLabel(current.status) : null;

  async function generate() {
    setBusy("preview");
    setMessage("");
    setError("");
    try {
      const windowStart = current ? current.windowEnd : new Date(Date.now() - 7 * 86400000).toISOString();
      const response = await fetch(`/api/projects/${projectId}/episodes/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowStart, windowEnd: new Date().toISOString() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成预览失败");
      setPreview(data);
      setHistoryRevision(null);
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
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${current.id}/refresh`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成新版本失败");
      setPreview({ episode: data.episode, scope: { includedCount: data.episode.revisions.at(-1)?.sourceRefs.length ?? 0, excludedReasons: [], contestedCount: 0, unknownCount: 0 } });
      setHistoryRevision(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成新版本失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    const revision = preview.episode.revisions[preview.episode.revisions.length - 1];
    setBusy("confirm");
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/episodes/${preview.episode.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.revision, requestId: crypto.randomUUID(), expectedSourceHash: revision.sourceHash }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "确认失败");
      setPreview(null);
      setMessage(`已确认 V${revision.revision}，成为当前阶段判断。`);
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认失败");
    } finally {
      setBusy(null);
    }
  }

  function openSources(claim: EpisodeClaim, revision: EpisodeRevisionData) {
    const refs = claim.sourceRefIds
      .map((refId) => revision.sourceRefs.find((ref) => ref.refId === refId))
      .filter((ref): ref is EpisodeSourceRef => Boolean(ref));
    setSourceDrawer({ claim, refs, states: sourceStates });
  }

  const activeRevision = preview ? preview.episode.revisions[preview.episode.revisions.length - 1] : viewingRevision;

  return <section id="episode-checkpoint" aria-labelledby="episode-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div className="min-w-0">
        <p className="archive-label">阶段检查点</p>
        <h2 id="episode-title" className="mt-2 flex items-center gap-2 text-lg font-black">
          <BookmarkCheck size={18} className="text-[var(--teal-strong)]" />整理阶段进展
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">把散乱记忆收束为可确认版本；每条事实句都能打开当时的来源。</p>
      </div>
      {!preview && <div className="flex flex-wrap gap-2">
        {current && <button type="button" onClick={() => void refreshCurrent()} disabled={busy !== null} className="focus-ring editorial-button-secondary disabled:opacity-50">
          {busy === "refresh" ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}根据最新来源生成新版本
        </button>}
        <button type="button" onClick={() => void generate()} disabled={busy !== null || loading} className="focus-ring editorial-button-secondary disabled:opacity-50">
          {busy === "preview" ? <LoaderCircle size={15} className="animate-spin" /> : <BookmarkCheck size={15} />}
          {current ? "整理新阶段" : "整理最近 7 天"}
        </button>
      </div>}
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
      <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
    </div>}

    {loading && <p className="mt-4 text-sm text-[var(--ink-soft)]">正在读取检查点…</p>}

    {!loading && !preview && !current && <div className="mt-4 rounded-xl bg-[var(--paper-strong)] p-5 text-center">
      <p className="text-sm font-bold text-[var(--ink-soft)]">还没有阶段检查点。</p>
      <p className="mt-1 text-xs text-[var(--muted)]">隔几天回到项目时，先用 60 秒看清上次做到哪、哪些结论仍有效。</p>
    </div>}

    {!loading && !preview && current && activeRevision && <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-black text-[var(--navy)]">V{activeRevision.revision} · {current.title}</h3>
        {badge && <span className={"rounded-full px-2.5 py-1 text-[11px] font-bold " + (badge.tone === "ok" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : badge.tone === "warn" ? "bg-[var(--amber)]/15 text-[var(--amber)]" : badge.tone === "bad" ? "bg-[var(--brick-pale)] text-[var(--brick)]" : "bg-[var(--paper-strong)] text-[var(--muted)]")}>{badge.text}</span>}
        {isHistoryView && <span className="rounded-full bg-[var(--paper-strong)] px-2.5 py-1 text-[11px] font-bold text-[var(--muted)]">历史版本 · 只读</span>}
      </div>
      <p className="mt-1.5 text-xs text-[var(--muted)]">
        确认于 {formatTime(activeRevision.confirmedAt)} · 来源 {activeRevision.sourceRefs.length} 个 · 依据截至 {new Date(current.windowEnd).toLocaleDateString("zh-CN")}
        {activeRevision.generationMode === "MODEL_FALLBACK_TEMPLATE" && ` · 模型压缩失败已回退模板（${activeRevision.fallbackReason ?? "未知原因"}）`}
        {activeRevision.generationMode === "MODEL" && ` · 语言由 ${activeRevision.provider ?? "模型"} 压缩，事实与来源未改动`}
      </p>

      {current.status !== "PUBLISHED" && !isHistoryView && <p className="mt-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-xs font-semibold text-[var(--amber)]">
        {affectedIds.size} 条结论受来源变化影响，其余结论仍可阅读；可生成新版本，旧版本会保留。
      </p>}

      <div className="mt-3 space-y-3">
        {sectionOrder.map((section) => {
          const claims = activeRevision.claims.filter((claim) => claim.section === section);
          if (claims.length === 0) return null;
          return <div key={section}>
            <p className="text-xs font-black text-[var(--navy)]">{sectionLabels[section]}</p>
            <ul className="mt-1.5 space-y-1.5">
              {claims.map((claim) => <li key={claim.claimId} className={"rounded-lg border p-2.5 text-xs leading-5 " + (affectedIds.has(claim.claimId) && !isHistoryView ? "border-[var(--amber)]/50 bg-[var(--amber)]/10" : "border-[var(--rule)] bg-[var(--card-bg)]")}>
                <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (claim.kind === "FACT" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : claim.kind === "RULE" ? "bg-[var(--paper-strong)] text-[var(--ink-soft)]" : "bg-[var(--navy)]/10 text-[var(--navy)]")}>
                  {claim.kind === "FACT" ? "事实" : claim.kind === "RULE" ? "系统判断" : "建议"}
                </span>
                <span className={affectedIds.has(claim.claimId) && !isHistoryView ? "text-[var(--amber)]" : ""}>{claim.text}</span>
                {affectedIds.has(claim.claimId) && !isHistoryView && <span className="mt-1 block font-bold text-[var(--amber)]">{current.freshness?.affectedClaims.find((item) => item.claimId === claim.claimId)?.reason}</span>}
                {claim.kind === "FACT" && claim.sourceRefIds.length > 0 && <button type="button" onClick={() => openSources(claim, activeRevision)} className="focus-ring mt-1.5 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">
                  查看 {claim.sourceRefIds.length} 个来源
                </button>}
              </li>)}
            </ul>
          </div>;
        })}
      </div>

      {publishedRevisions.length > 1 && <details className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-[var(--ink-soft)]">
          <History size={13} />查看历史版本（{publishedRevisions.length}）
        </summary>
        <ul className="mt-2 space-y-1.5">
          {[...publishedRevisions].reverse().map((revision) => <li key={revision.id}>
            <button type="button" onClick={() => setHistoryRevision(revision.revision === currentRevision?.revision ? null : revision.revision)} className="focus-ring flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--paper-strong)] px-2.5 py-2 text-left text-xs">
              <span className="font-bold text-[var(--navy)]">V{revision.revision}{revision.revision === currentRevision?.revision ? " · 当前版本" : ""}</span>
              <span className="text-[var(--muted)]">确认于 {formatTime(revision.confirmedAt)} · 来源 {revision.sourceRefs.length} 个</span>
            </button>
          </li>)}
        </ul>
      </details>}

      {!isHistoryView && <div className="mt-4 flex flex-wrap gap-2">
        <a href="#action-board" className="focus-ring editorial-button text-xs">继续推进<Check size={14} /></a>
      </div>}
    </div>}

    {preview && activeRevision && <div className="mt-4">
      <p className="rounded-lg bg-[var(--paper-strong)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
        预览未生效：确认后才成为当前阶段判断。纳入 {preview.scope.includedCount} 个来源
        {preview.scope.excludedReasons.length > 0 && `；${preview.scope.excludedReasons.join("；")}`}
        {(preview.scope.contestedCount > 0 || preview.scope.unknownCount > 0) && `；争议 ${preview.scope.contestedCount} 条、证据不足 ${preview.scope.unknownCount} 条已如实标注`}
      </p>
      <div className="mt-3 space-y-3">
        {sectionOrder.map((section) => {
          const claims = activeRevision.claims.filter((claim) => claim.section === section);
          if (claims.length === 0) return null;
          return <div key={section}>
            <p className="text-xs font-black text-[var(--navy)]">{sectionLabels[section]}</p>
            <ul className="mt-1.5 space-y-1.5">
              {claims.map((claim) => <li key={claim.claimId} className="rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-2.5 text-xs leading-5">
                <span className={"mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold " + (claim.kind === "FACT" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : claim.kind === "RULE" ? "bg-[var(--paper-strong)] text-[var(--ink-soft)]" : "bg-[var(--navy)]/10 text-[var(--navy)]")}>
                  {claim.kind === "FACT" ? "事实" : claim.kind === "RULE" ? "系统判断" : "建议"}
                </span>
                {claim.text}
                {claim.kind === "FACT" && claim.sourceRefIds.length > 0 && <button type="button" onClick={() => openSources(claim, activeRevision)} className="focus-ring mt-1.5 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">
                  查看 {claim.sourceRefIds.length} 个来源
                </button>}
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

    {sourceDrawer && <div role="dialog" aria-label="来源详情" className="fixed inset-0 z-50 flex justify-end bg-[rgba(15,23,42,.35)]" onClick={() => setSourceDrawer(null)}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-[var(--paper)] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b archive-rule pb-3">
          <div className="min-w-0">
            <p className="archive-label">来源详情</p>
            <p className="mt-1.5 text-sm font-bold leading-6 text-[var(--navy)]">{sourceDrawer.claim.text}</p>
          </div>
          <button type="button" onClick={() => setSourceDrawer(null)} aria-label="关闭来源详情" className="focus-ring shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--paper-strong)]"><X size={16} /></button>
        </div>
        <ul className="mt-4 space-y-3">
          {sourceDrawer.refs.map((ref) => {
            const state = sourceDrawer.states.find((item) => item.refId === ref.refId);
            const href = sourceHref(ref, state);
            const unavailable = state?.state === "DELETED";
            return <li key={ref.refId} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-md bg-[var(--paper-strong)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-soft)]">{kindLabels[ref.kind] ?? ref.kind}{ref.revisionIndex !== null ? ` #${ref.revisionIndex}` : ""}</span>
                <span className={"text-[11px] font-bold " + (!state || state.state === "AVAILABLE" ? "text-[var(--teal-strong)]" : "text-[var(--amber)]")}>
                  {state ? stateLabels[state.state] ?? state.displayReason : "冻结版本"}
                </span>
              </div>
              <p className="mt-2 text-sm font-bold text-[var(--navy)]">{ref.title || ref.entityId}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">观察于 {formatTime(ref.observedAt)}</p>
              <p className="mt-2 rounded-lg bg-[var(--paper-strong)] p-2.5 text-xs leading-5 text-[var(--ink-soft)]">
                <span className="font-bold text-[var(--navy)]">冻结摘要：</span>{ref.summary || "（该来源没有文本摘要）"}
              </p>
              {state && state.state !== "AVAILABLE" && <p className="mt-2 text-xs font-semibold text-[var(--amber)]">{state.displayReason}</p>}
              {unavailable && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><FileQuestion size={13} />原来源已删除，以上为生成时冻结的信息</p>}
              {href && <a href={href} onClick={() => setSourceDrawer(null)} className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-xs font-bold text-[var(--teal-strong)]">
                <ExternalLink size={13} />打开原记录
              </a>}
            </li>;
          })}
        </ul>
      </div>
    </div>}
  </section>;
}
