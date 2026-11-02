"use client";

import { useState } from "react";
import type { IntakeCoverage, IntakeCoverageItem } from "@/lib/intake/coverage";

/**
 * “模型实际读到了多少”的只读呈现。
 *
 * 上传字符数不等于已读字符数：这里把上一轮真正送入的正文与当前材料下次会送入的范围
 * 分开显示，并为每份材料提供按页的原文核对入口。未送入的原文仍保留在草稿或原项目里。
 */

const numberText = (value: number) => value.toLocaleString("zh-CN");

function itemState(item: IntakeCoverageItem): string {
  if (item.reason === "NO_READABLE_TEXT") return "没有可读文本";
  if (item.reason === "ADDED_AFTER_UNDERSTANDING") return `之后新增，还没送入（计划 ${numberText(item.plannedChars)} 字）`;
  if (item.reason === "OVER_BUDGET") return `超出本轮总量，未送入（共 ${numberText(item.availableChars)} 字）`;
  if (item.lastSentChars === null) return `待送入 ${numberText(item.plannedChars)} 字 / 共 ${numberText(item.availableChars)} 字`;
  if (item.lastSentChars === 0) return `未送入（共 ${numberText(item.availableChars)} 字）`;
  if (item.lastSentTruncated) return `送入 ${numberText(item.lastSentChars)} 字 / 共 ${numberText(item.availableChars)} 字（截取）`;
  return `已送入 ${numberText(item.lastSentChars)} 字`;
}

export function IntakeCoveragePanel({ draftId, coverage, materials }: { draftId: string; coverage: IntakeCoverage;
  materials: Array<{ id: string; revision: number; contentHash: string }> }) {
  const [openMaterial, setOpenMaterial] = useState("");
  const [pages, setPages] = useState<Record<string, { text: string; offset: number; total: number; hasMore: boolean }>>({});
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  async function loadPage(materialId: string, offset: number) {
    setLoading(`${materialId}:${offset}`); setError("");
    try {
      const response = await fetch(`/api/intake/${encodeURIComponent(draftId)}/materials/${encodeURIComponent(materialId)}?offset=${offset}&limit=4000`,
        { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "读取原文失败");
      const expected = materials.find(material => material.id === materialId);
      if (!expected || body.materialId !== materialId || body.revision !== expected.revision || body.contentHash !== expected.contentHash)
        throw new Error("原文版本已变化或无法核对，请刷新材料预览后重新打开原文");
      setPages(current => {
        const previous = offset > 0 ? current[materialId] : undefined;
        return { ...current, [materialId]: { text: (previous ? previous.text : "") + body.text,
          offset: body.offset + body.text.length, total: body.totalChars, hasMore: body.hasMore } };
      });
    } catch (reason) {
      setPages(current => { const next = { ...current }; delete next[materialId]; return next; });
      setError(reason instanceof Error ? reason.message : "读取原文失败");
    }
    finally { setLoading(""); }
  }

  const last = coverage.lastSent;
  const truncated = coverage.current.items.some(item => (item.lastSentChars ?? 0) > 0 && item.lastSentTruncated);
  const unsent = coverage.current.items.some(item => item.lastSentChars === 0 || item.reason === "ADDED_AFTER_UNDERSTANDING");
  return <div role="group" aria-label="材料覆盖与原文核对" className="mt-5 rounded-md border border-[var(--rule)] px-4 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="archive-label">模型实际读到的范围</p>
      <p className="text-xs text-[var(--muted)]">
        {last
          ? `${last.understandingPublished ? "上一版送入" : "上一版送过但未形成理解"} ${numberText(last.totalSentChars)} 字 / 材料共 ${numberText(last.totalAvailableChars)} 字`
          : `尚未送入 · 下次会送入 ${numberText(coverage.current.totalSentChars)} 字 / 共 ${numberText(coverage.current.totalAvailableChars)} 字`}
      </p>
    </div>
    <ul className="mt-3 space-y-2">
      {coverage.current.items.map(item => <li key={item.materialId} className="rounded-md bg-[var(--surface)] px-3 py-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span>{item.label}{item.type ? ` · ${item.type}` : ""}</span>
          <span className="text-xs text-[var(--muted)]">{itemState(item)}</span>
        </div>
        {item.availableChars > 0 && <button type="button" className="focus-ring mt-1 text-xs font-semibold text-[var(--navy)] underline-offset-2 hover:underline"
          aria-expanded={openMaterial === item.materialId}
          onClick={() => {
            if (openMaterial === item.materialId) { setOpenMaterial(""); return; }
            setOpenMaterial(item.materialId);
            if (!pages[item.materialId]) void loadPage(item.materialId, 0);
          }}>
          {openMaterial === item.materialId ? "收起原文" : `核对原文（${numberText(item.availableChars)} 字）`}
        </button>}
        {openMaterial === item.materialId && <div className="mt-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 py-2">
          {pages[item.materialId]
            ? <>
              <p className="whitespace-pre-wrap text-xs leading-6">{pages[item.materialId].text}</p>
              <p className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
                <span>已显示 {numberText(pages[item.materialId].text.length)} / {numberText(pages[item.materialId].total)} 字</span>
                {pages[item.materialId].hasMore && <button type="button" className="focus-ring font-semibold text-[var(--navy)]"
                  disabled={loading === `${item.materialId}:${pages[item.materialId].offset}`}
                  onClick={() => void loadPage(item.materialId, pages[item.materialId].offset)}>
                  {loading === `${item.materialId}:${pages[item.materialId].offset}` ? "加载中…" : "继续读"}
                </button>}
              </p>
            </>
            : <p className="text-xs text-[var(--muted)]">{loading ? "正在读取原文…" : "暂无原文页"}</p>}
        </div>}
      </li>)}
    </ul>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{coverage.note}</p>
    {!coverage.consentGranted && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">同意云处理后才会送入材料；撤回同意不会再次送入。</p>}
    {(truncated || unsent) && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
      {truncated ? "被截取的部分没有送给模型，仍完整保留；" : ""}
      {unsent ? "之后新增的材料还没有送入；" : ""}
      建立项目后可在项目中继续深读全文，不需要先自己裁好材料。
    </p>}
    {error && <p role="status" className="mt-2 text-xs text-[var(--brick)]">{error}</p>}
  </div>;
}

