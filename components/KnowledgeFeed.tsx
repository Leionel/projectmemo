"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, GalleryVerticalEnd, Rows3, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { KnowledgeCardView, type KnowledgeCardData } from "@/components/KnowledgeCardView";
import { knowledgeTypeLabels, knowledgeTypes, getKnowledgeTypeColor, type KnowledgeTypeValue } from "@/lib/types";
import { subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";

type SortValue = "newest" | "importance" | "oldest";
type DisplayMode = "compact" | "full";
const PAGE_SIZE = 8;

export function KnowledgeFeed({ projectId, cards }: { projectId: string; cards: KnowledgeCardData[] }) {
  const searchParams = useSearchParams();
  const queryType = searchParams.get("cardType");
  const initialType = knowledgeTypes.includes(queryType as KnowledgeTypeValue) ? queryType as KnowledgeTypeValue : "all";
  const sortParam = searchParams.get("cardSort");
  const requestedSort: SortValue = sortParam === "importance" || sortParam === "oldest" ? sortParam : "newest";
  const [localCards, setLocalCards] = useState(cards);
  const [query, setQuery] = useState("");
  const [typeSelection, setTypeSelection] = useState<{ urlType: KnowledgeTypeValue | "all"; value: KnowledgeTypeValue | "all" }>({ urlType: initialType, value: initialType });
  const [sortSelection, setSortSelection] = useState<{ urlSort: SortValue; value: SortValue }>({ urlSort: requestedSort, value: requestedSort });
  const [displayMode, setDisplayMode] = useState<DisplayMode>(cards.length > PAGE_SIZE ? "compact" : "full");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const type = typeSelection.urlType === initialType ? typeSelection.value : initialType;
  const sort = sortSelection.urlSort === requestedSort ? sortSelection.value : requestedSort;

  useEffect(() => {
    return subscribeWorkspaceChange(projectId, ["cards"], () => {
      // router.refresh() keeps this client component mounted. Reload only when
      // another workspace action announces a card mutation, preserving filters.
      void fetch(`/api/projects/${projectId}`).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json().catch(() => null) as { project?: { cards?: KnowledgeCardData[] } } | null;
        if (data?.project?.cards) setLocalCards(data.project.cards);
      });
    });
  }, [projectId]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return localCards.filter((card) => {
      if (type !== "all" && card.type !== type) return false;
      if (!normalized) return true;
      const keywords = Array.isArray(card.keywords) ? card.keywords.join(" ") : "";
      return `${card.title} ${card.summary} ${keywords}`.toLocaleLowerCase("zh-CN").includes(normalized);
    }).sort((a, b) => {
      if (sort === "importance") return b.importance - a.importance || +new Date(b.createdAt) - +new Date(a.createdAt);
      return sort === "oldest" ? +new Date(a.createdAt) - +new Date(b.createdAt) : +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [localCards, query, sort, type]);

  const rendered = visible.slice(0, visibleLimit);
  const filtered = query.trim() || type !== "all" || sort !== "newest";

  function revealCard(cardId: string) {
    if (!localCards.some((card) => card.id === cardId)) return;
    setQuery(""); setTypeSelection({ urlType: initialType, value: "all" }); setDisplayMode("full"); setVisibleLimit(localCards.length); setFocusCardId(cardId);
    window.history.replaceState(null, "", `#card-${cardId}`);
  }

  useEffect(() => {
    const handleHash = () => {
      const match = window.location.hash.match(/^#card-(.+)$/);
      if (match && localCards.some((card) => card.id === match[1])) revealCard(match[1]);
    };
    const frame = window.requestAnimationFrame(handleHash);
    window.addEventListener("hashchange", handleHash);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", handleHash); };
    // localCards must be included so a newly created target can be revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCards]);

  useEffect(() => {
    if (!focusCardId || !rendered.some((card) => card.id === focusCardId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`card-${focusCardId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
      setFocusCardId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusCardId, rendered]);

  function clearFilters() {
    setQuery(""); setTypeSelection({ urlType: initialType, value: "all" }); setSortSelection({ urlSort: requestedSort, value: "newest" }); setVisibleLimit(PAGE_SIZE);
  }

  function updateImportance(cardId: string, importance: number) {
    setLocalCards((old) => old.map((card) => card.id === cardId ? { ...card, importance } : card));
  }

  return <section id="knowledge-assets" className="scroll-mt-24">
    <div className="mb-5 border-b archive-rule pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="archive-label">项目记忆</p><h2 className="mt-3 flex items-center gap-2 text-lg font-black"><SlidersHorizontal size={19} className="text-[var(--navy)]" /> 项目知识资产流</h2></div><span aria-live="polite" className="text-sm font-semibold text-[var(--muted)]">显示 {Math.min(rendered.length, visible.length)} / {visible.length} 张{visible.length !== localCards.length ? `（共 ${localCards.length} 张）` : ""}</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] xl:grid-cols-[minmax(0,1fr)_170px_auto_auto]">
        <label className="relative block"><span className="sr-only">搜索知识资产</span><Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(PAGE_SIZE); }} className="focus-ring editorial-input w-full py-2.5 pl-10 pr-10 text-sm" placeholder="搜索标题、摘要或关键词" />{query && <button type="button" onClick={() => { setQuery(""); setVisibleLimit(PAGE_SIZE); }} aria-label="清空搜索" className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--muted)] hover:bg-[var(--paper-strong)]"><X size={16} /></button>}</label>
        <label><span className="sr-only">按卡片类型筛选</span><select value={type} onChange={(event) => { setTypeSelection({ urlType: initialType, value: event.target.value as KnowledgeTypeValue | "all" }); setVisibleLimit(PAGE_SIZE); }} className="focus-ring editorial-input w-full px-3 py-2.5 text-sm"><option value="all">全部类型</option>{knowledgeTypes.map((value) => <option key={value} value={value} className={getKnowledgeTypeColor(value)}>{knowledgeTypeLabels[value]}</option>)}</select></label>
        <div role="group" aria-label="知识卡片排序" className="inline-flex w-fit rounded-xl border border-[var(--rule-strong)] bg-[var(--card-bg)] p-1"><button type="button" onClick={() => { setSortSelection({ urlSort: requestedSort, value: "newest" }); setVisibleLimit(PAGE_SIZE); }} aria-pressed={sort === "newest"} className={"focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold transition " + (sort === "newest" ? "bg-[var(--paper)] text-[var(--navy)]" : "text-[var(--muted)] hover:text-[var(--navy)]")}>最新</button><button type="button" onClick={() => { setSortSelection({ urlSort: requestedSort, value: "importance" }); setVisibleLimit(PAGE_SIZE); }} aria-pressed={sort === "importance"} className={"focus-ring inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition " + (sort === "importance" ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]" : "text-[var(--muted)] hover:text-[var(--teal-strong)]")}><Star size={13} />重要</button><button type="button" onClick={() => { setSortSelection({ urlSort: requestedSort, value: "oldest" }); setVisibleLimit(PAGE_SIZE); }} aria-pressed={sort === "oldest"} className={"focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold transition " + (sort === "oldest" ? "bg-[var(--paper)] text-[var(--navy)]" : "text-[var(--muted)] hover:text-[var(--navy)]")}>最早</button></div>
        <div role="group" aria-label="知识卡片显示模式" className="inline-flex w-fit rounded-xl border border-[var(--rule-strong)] bg-[var(--card-bg)] p-1"><button type="button" onClick={() => { setDisplayMode("compact"); setVisibleLimit(PAGE_SIZE); }} aria-pressed={displayMode === "compact"} className={"focus-ring inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold " + (displayMode === "compact" ? "bg-[var(--paper)] text-[var(--navy)]" : "text-[var(--muted)]")}><Rows3 size={13} />精简</button><button type="button" onClick={() => { setDisplayMode("full"); setVisibleLimit(PAGE_SIZE); }} aria-pressed={displayMode === "full"} className={"focus-ring inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold " + (displayMode === "full" ? "bg-[var(--paper)] text-[var(--navy)]" : "text-[var(--muted)]")}><GalleryVerticalEnd size={13} />完整</button></div>
      </div>
    </div>
    {rendered.length ? <><div className="timeline-rail space-y-4">{rendered.map((card) => <KnowledgeCardView key={card.id} card={card} projectId={projectId} compact={displayMode === "compact"} forcedOpen={focusCardId === card.id} onReveal={revealCard} onImportanceChange={updateImportance} />)}</div>{visible.length > rendered.length && <div className="mt-5 flex justify-center"><button type="button" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)} className="focus-ring editorial-button-secondary"><ChevronDown size={16} />继续加载 {Math.min(PAGE_SIZE, visible.length - rendered.length)} 张</button></div>}{rendered.length > PAGE_SIZE && <div className="mt-3 text-center"><button type="button" onClick={() => { setVisibleLimit(PAGE_SIZE); document.getElementById("knowledge-assets")?.scrollIntoView({ behavior: "smooth" }); }} className="focus-ring rounded-lg px-3 py-2 text-xs font-black text-[var(--muted)] hover:bg-[var(--paper-strong)]">收起到前 {PAGE_SIZE} 张</button></div>}</> : localCards.length === 0 && !filtered ? <div className="card-surface rounded-[1.5rem] p-10 text-center"><Search className="mx-auto text-[var(--teal)]" /><h2 className="mt-4 font-bold">项目记忆还是空的</h2><p className="mt-2 text-sm text-[var(--ink-soft)]">在上方输入第一条项目记录，Agent 会自动生成知识卡片。</p></div> : <div className="card-surface rounded-[1.5rem] p-10 text-center"><Search className="mx-auto text-[var(--teal)]" /><h3 className="mt-4 font-bold">没有匹配的知识资产</h3><p className="mt-2 text-sm text-[var(--ink-soft)]">换个关键词或清除筛选条件。</p>{filtered && <button type="button" onClick={clearFilters} className="focus-ring editorial-button-secondary mt-5">清除筛选</button>}</div>}
  </section>;
}
