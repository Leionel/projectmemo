"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Eye, LoaderCircle, Pencil, Save, Trash2, X } from "lucide-react";
import { knowledgeTypeLabels, knowledgeTypes, getKnowledgeTypeColor, type KnowledgeTypeValue } from "@/lib/types";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type EditableCard = {
  id: string;
  type: string;
  title: string;
  summary: string;
  keywords: unknown;
  relatedTasks: unknown;
  nextActions: unknown;
  importance: number;
  capture: { rawText: string; sourceType: string | null };
};

type Panel = "source" | "edit" | null;

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function keywords(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim().replace(/^#/, "")).filter(Boolean);
}

export function CardEditor({ card }: { card: EditableCard }) {
  const router = useRouter();
  const { id: projectId } = useParams<{ id: string }>();
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.summary);
  const [type, setType] = useState(card.type as KnowledgeTypeValue);
  const [importance, setImportance] = useState(card.importance);
  const [keywordText, setKeywordText] = useState(stringList(card.keywords).join("，"));
  const [taskText, setTaskText] = useState(stringList(card.relatedTasks).join("\n"));
  const [actionText, setActionText] = useState(stringList(card.nextActions).join("\n"));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function open(next: Exclude<Panel, null>) {
    setPanel((current) => current === next ? null : next);
    setConfirmDelete(false);
    setError("");
    setNotice("");
  }

  async function save() {
    setError("");
    setNotice("");
    const payload = {
      title,
      summary,
      type,
      importance,
      keywords: keywords(keywordText),
      relatedTasks: lines(taskText),
      nextActions: lines(actionText),
    };
    const result = knowledgeCardDraftSchema.safeParse(payload);
    if (!result.success) {
      const issue = result.error.issues[0];
      const labels: Record<string, string> = { title: "标题", summary: "摘要", type: "类型", importance: "重要性", keywords: "关键词", relatedTasks: "关联任务", nextActions: "下一步建议" };
      setError(`${labels[String(issue.path[0])] ?? "卡片内容"}不符合要求：${issue.message}`);
      return;
    }

    setBusy("save");
    try {
      const response = await fetch(`/api/projects/${projectId}/cards/${card.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok) throw new Error(data?.error?.message ?? "保存失败，请稍后重试");
      setNotice("知识卡片已更新");
      setPanel(null);
      emitWorkspaceChange(projectId, ["cards", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/cards/${card.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        throw new Error(data?.error?.message ?? "删除失败，请稍后重试");
      }
      emitWorkspaceChange(projectId, ["cards", "actions", "interventions", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败，请稍后重试");
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  return <div className="mt-5 border-t archive-rule pt-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => open("source")} aria-expanded={panel === "source"} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--navy)]"><Eye size={15} /> 查看原文</button>
      <button type="button" onClick={() => open("edit")} aria-expanded={panel === "edit"} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--navy)]"><Pencil size={15} /> 纠正卡片</button>
      <span role="status" aria-live="polite" className="ml-auto text-xs font-bold text-[var(--teal-strong)]">{notice}</span>
    </div>

    {panel === "source" && <section aria-label="碎片原文" className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-wider text-[var(--muted)]">Agent 处理前的原始记录</p>{card.capture.sourceType && <span className="paper-tab px-2 py-1 text-xs text-[var(--ink-soft)]">{card.capture.sourceType}</span>}</div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{card.capture.rawText}</p>
    </section>}

    {panel === "edit" && <section aria-label="纠正知识卡片" className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-[var(--ink)]">纠正 Agent 识别结果</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">每行填写一项任务或建议；关键词用逗号分隔。</p></div><button type="button" onClick={() => setPanel(null)} aria-label="关闭卡片编辑" className="focus-ring rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--paper-strong)]"><X size={16} /></button></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="text-xs font-bold text-[var(--ink-soft)]">标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2.5 text-sm" /><span className="mt-1 block text-right text-[11px] text-[var(--muted)]">{title.length}/60</span></label>
        <label><span className="text-xs font-bold text-[var(--ink-soft)]">类型</span><select value={type} onChange={(event) => setType(event.target.value as KnowledgeTypeValue)} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2.5 text-sm">{knowledgeTypes.map((value) => <option key={value} value={value} className={getKnowledgeTypeColor(value)}>{knowledgeTypeLabels[value]}</option>)}</select></label>
        <label><span className="text-xs font-bold text-[var(--ink-soft)]">重要性</span><select value={importance} onChange={(event) => setImportance(Number(event.target.value))} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2.5 text-sm">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label className="sm:col-span-2"><span className="text-xs font-bold text-[var(--ink-soft)]">摘要</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={300} rows={3} className="focus-ring editorial-input mt-1.5 w-full resize-y px-3 py-2.5 text-sm leading-6" /><span className="mt-1 block text-right text-[11px] text-[var(--muted)]">{summary.length}/300</span></label>
        <label className="sm:col-span-2"><span className="text-xs font-bold text-[var(--ink-soft)]">关键词（1–8 个，每个不超过 30 字）</span><input value={keywordText} onChange={(event) => setKeywordText(event.target.value)} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2.5 text-sm" /></label>
        <label><span className="text-xs font-bold text-[var(--ink-soft)]">识别出的任务（最多 6 项）</span><textarea value={taskText} onChange={(event) => setTaskText(event.target.value)} rows={4} className="focus-ring editorial-input mt-1.5 w-full resize-y px-3 py-2.5 text-sm leading-6" /></label>
        <label><span className="text-xs font-bold text-[var(--ink-soft)]">下一步建议（1–6 项）</span><textarea value={actionText} onChange={(event) => setActionText(event.target.value)} rows={4} className="focus-ring editorial-input mt-1.5 w-full resize-y px-3 py-2.5 text-sm leading-6" /></label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-sm font-semibold text-[var(--brick)]">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t archive-rule pt-4">
        {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-[var(--brick)] transition hover:bg-[var(--brick-pale)] disabled:opacity-50"><Trash2 size={15} /> 删除这条记录</button> : <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2"><AlertTriangle size={15} className="text-[var(--brick)]" /><span className="text-xs font-bold text-[var(--brick)]">会同时删除原始碎片，确定吗？</span><button type="button" onClick={remove} disabled={busy !== null} className="focus-ring rounded-md bg-[var(--brick)] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === "delete" ? "删除中…" : "确认删除"}</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy !== null} className="focus-ring rounded-md px-2 py-1.5 text-xs font-bold text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]">取消</button></div>}
        <div className="ml-auto flex gap-2"><button type="button" onClick={() => setPanel(null)} disabled={busy !== null} className="focus-ring editorial-button-secondary">取消</button><button type="button" onClick={save} disabled={busy !== null} className="focus-ring editorial-button">{busy === "save" ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{busy === "save" ? "保存中…" : "保存纠正"}</button></div>
      </div>
    </section>}
  </div>;
}
