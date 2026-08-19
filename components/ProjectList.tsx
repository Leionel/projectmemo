"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { scenarioOptions } from "@/lib/types";

type SortMode = "attention" | "updated-desc" | "updated-asc" | "cards-desc" | "cards-asc";

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: "attention", label: "需要关注" },
  { value: "updated-desc", label: "最近更新" },
  { value: "updated-asc", label: "最早更新" },
  { value: "cards-desc", label: "卡片最多" },
  { value: "cards-asc", label: "卡片最少" },
];

export function ProjectList({ projects }: { projects: ProjectCardData[] }) {
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const deferredQuery = useDeferredValue(query);

  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("zh-CN");
  const hasFilters = query.trim().length > 0 || scenario !== "ALL";

  const visibleProjects = useMemo(() => {
    const matches = projects.filter((project) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${project.title} ${project.description}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      const matchesScenario = scenario === "ALL" || project.scenario === scenario;
      return matchesQuery && matchesScenario;
    });

    return matches.sort((left, right) => {
      if (sortMode === "attention") return right.dashboard.attentionScore - left.dashboard.attentionScore || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (sortMode === "cards-desc") return right._count.cards - left._count.cards;
      if (sortMode === "cards-asc") return left._count.cards - right._count.cards;

      const timeDifference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return sortMode === "updated-desc" ? timeDifference : -timeDifference;
    });
  }, [normalizedQuery, projects, scenario, sortMode]);

  function clearFilters() {
    setQuery("");
    setScenario("ALL");
  }

  return (
    <section className="mt-10" aria-labelledby="project-list-heading">
      <h2 id="project-list-heading" className="sr-only">项目列表</h2>

      <div className="card-surface rounded-[1.35rem] p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.34fr)_minmax(10rem,0.34fr)]">
          <label className="block">
            <span className="mb-2 block text-xs font-bold text-[var(--ink-soft)]">搜索项目</span>
            <span className="relative block">
              <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="editorial-input min-h-11 w-full py-2.5 pl-10 pr-11 text-sm"
                placeholder="按标题或描述搜索"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                  aria-label="清空搜索内容"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              )}
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold text-[var(--ink-soft)]">项目场景</span>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              className="editorial-input min-h-11 w-full px-3.5 py-2.5 text-sm"
            >
              <option value="ALL">全部场景</option>
              {scenarioOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold text-[var(--ink-soft)]">排列方式</span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="editorial-input min-h-11 w-full px-3.5 py-2.5 text-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex min-h-8 flex-wrap items-center justify-between gap-3 border-t archive-rule pt-4">
          <p className="flex items-center gap-2 text-sm text-[var(--ink-soft)]" aria-live="polite" aria-atomic="true">
            <SlidersHorizontal aria-hidden="true" size={16} className="text-[var(--teal-strong)]" />
            找到 <strong className="text-[var(--ink)]">{visibleProjects.length}</strong> 个项目
            {hasFilters && <span className="text-xs">（共 {projects.length} 个）</span>}
          </p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="focus-ring rounded-lg px-2 py-1 text-sm font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal-pale)]">
              清除筛选
            </button>
          )}
        </div>
      </div>

      {visibleProjects.length > 0 ? (
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </div>
      ) : (
        <div className="card-surface mt-5 grid min-h-64 place-items-center rounded-[1.35rem] p-8 text-center" role="status">
          <div>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--teal-pale)] text-[var(--teal-strong)]">
              <Search aria-hidden="true" size={22} />
            </span>
            <h3 className="mt-4 text-lg font-bold">没有匹配的项目</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">试试更短的关键词，或查看其他项目场景。</p>
            <button type="button" onClick={clearFilters} className="focus-ring editorial-button-secondary mt-5">
              清除筛选
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
