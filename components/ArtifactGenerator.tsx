"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Clipboard, Code2, Download, Eye, FileOutput, LoaderCircle, Save, X } from "lucide-react";
import { artifactTypeLabels, artifactTypes, type ArtifactTypeValue } from "@/lib/types";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

type Artifact = { id: string; artifactType: string; content: string; createdAt: Date | string };

export function ArtifactGenerator({ projectId, initialArtifacts }: { projectId: string; initialArtifacts: Artifact[] }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryType = search.get("type") as ArtifactTypeValue | null;
  const initialType = queryType && artifactTypes.includes(queryType) ? queryType : "weekly_report";
  const [type, setType] = useState<ArtifactTypeValue>(initialType);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [current, setCurrent] = useState<Artifact | null>(initialArtifacts.find((item) => item.artifactType === initialType) ?? null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [editContent, setEditContent] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const history = useMemo(() => artifacts.filter((item) => item.artifactType === type), [artifacts, type]);
  const busy = loading || saving;

  function selectType(nextType: ArtifactTypeValue) {
    if (busy || editing) return;
    setType(nextType); setCurrent(artifacts.find((artifact) => artifact.artifactType === nextType) ?? null); setError(""); setFeedback("");
    router.replace(`${pathname}?type=${nextType}`, { scroll: false });
  }

  async function generate() {
    const requestedType = type;
    setLoading(true); setError(""); setFeedback("");
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifactType: requestedType }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成失败，请稍后重试");
      if (data.artifact?.artifactType !== requestedType) throw new Error("生成结果类型不一致，请重新生成");
      setArtifacts((old) => [data.artifact, ...old]); setCurrent(data.artifact); setFeedback("新版本已生成");
      emitWorkspaceChange(projectId, ["artifacts", "interventions", "metrics", "projects"]);
      router.refresh();
      window.setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); resultRef.current?.focus({ preventScroll: true }); }, 80);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败，请稍后重试"); }
    finally { setLoading(false); }
  }

  function startEditing() {
    if (!current || busy) return;
    setEditContent(current.content);
    setEditing(true);
    setViewMode("source");
    setError("");
    setFeedback("");
  }

  function cancelEditing() {
    if (saving) return;
    setEditing(false);
    setViewMode("preview");
    setEditContent(current?.content ?? "");
    setError("");
    setFeedback("已取消编辑，原版本未修改");
  }

  async function saveEditing() {
    if (!current || saving || !editContent.trim()) return;
    const requestedType = current.artifactType as ArtifactTypeValue;
    setSaving(true); setError(""); setFeedback("");
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactType: requestedType, content: editContent }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "保存失败，请稍后重试");
      if (data.artifact?.artifactType !== requestedType) throw new Error("保存结果类型不一致，请重新保存");
      setArtifacts((old) => [data.artifact, ...old]);
      setCurrent(data.artifact);
      setEditContent(data.artifact.content);
      setEditing(false);
      setViewMode("preview");
      setFeedback("润色内容已保存为新版本");
      emitWorkspaceChange(projectId, ["artifacts", "interventions", "metrics", "projects"]);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!current || busy || editing) return;
    try { await navigator.clipboard.writeText(current.content); setFeedback("已复制到剪贴板"); }
    catch { setError("浏览器未允许访问剪贴板，请使用下载或手动选择文本"); }
  }

  function download() {
    if (!current || busy || editing) return;
    const blob = new Blob([current.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${artifactTypeLabels[current.artifactType as ArtifactTypeValue]}.md`; link.click();
    URL.revokeObjectURL(url); setFeedback("Markdown 文件已导出");
  }

  return <div className="mt-9 grid min-w-0 items-start gap-6 lg:grid-cols-[268px_minmax(0,1fr)]">
    <aside className="card-surface min-w-0 rounded-[1.4rem] p-4 lg:sticky lg:top-24">
      <p className="archive-label px-2 pb-3">成果目录</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:block lg:space-y-1 lg:overflow-visible">{artifactTypes.map((item) => <button key={item} type="button" aria-pressed={type === item} disabled={busy || editing} onClick={() => selectType(item)} className={`focus-ring flex shrink-0 items-center justify-between gap-3 rounded-lg border-l-2 px-3 py-3 text-left text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 lg:w-full ${type === item ? "border-l-[var(--teal-strong)] bg-[#edf3ef] text-[var(--navy)]" : "border-l-transparent bg-[var(--card-bg)] text-[var(--ink-soft)] hover:bg-[#f3f1ea]"}`}><span>{artifactTypeLabels[item]}</span><FileOutput size={15} /></button>)}</div>
      <button onClick={generate} disabled={busy || editing} className="focus-ring editorial-button mt-4 w-full disabled:cursor-not-allowed disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={17} /> : <FileOutput size={17} />}{loading ? `正在生成${artifactTypeLabels[type]}…` : "生成新版本"}</button>
      {error && <p role="alert" className="mt-3 rounded-xl bg-[var(--brick-pale)] p-3 text-sm text-[var(--brick)]">{error}</p>}
      <details className="mt-5 border-t archive-rule pt-4 lg:open" open><summary className="focus-ring cursor-pointer rounded-md px-2 text-xs font-black uppercase tracking-[.14em] text-[var(--teal-strong)]">历史版本 · {history.length}</summary><div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">{history.length ? history.map((item, index) => <button key={item.id} type="button" aria-pressed={current?.id === item.id} disabled={busy || editing} onClick={() => { setCurrent(item); setFeedback(""); setError(""); }} className={`focus-ring w-full rounded-lg border px-3 py-2.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${current?.id === item.id ? "border-[var(--teal)] bg-[var(--teal-pale)] text-[var(--ink)]" : "border-transparent text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]"}`}><span className="font-bold">版本 {history.length - index}</span><br />{new Date(item.createdAt).toLocaleString("zh-CN")}</button>) : <p className="px-2 py-3 text-xs leading-5 text-[var(--muted)]">该类型还没有历史成果。</p>}</div></details>
    </aside>
    <section ref={resultRef} tabIndex={-1} aria-busy={busy} className="card-surface min-h-[560px] min-w-0 scroll-mt-24 rounded-[1.55rem] p-5 outline-none focus:ring-4 focus:ring-[rgba(45,139,116,.16)] sm:p-8 lg:min-h-[640px]">
      <div className="sr-only" aria-live="polite">{feedback}</div>
      {current ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b archive-rule pb-5">
          <div><p className="archive-label">生成结果</p><h2 className="mt-3 text-xl font-black">{artifactTypeLabels[current.artifactType as ArtifactTypeValue]}</h2><p className="mt-1 text-xs text-[var(--muted)]">{new Date(current.createdAt).toLocaleString("zh-CN")} · 可直接润色并保存为新版本</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="成果查看模式" className="inline-flex rounded-xl border border-[var(--rule-strong)] bg-[var(--paper-strong)] p-1">
              <button type="button" aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")} className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${viewMode === "preview" ? "bg-[var(--card-bg)] text-[var(--teal-strong)] shadow-[var(--shadow-sm)]" : "text-[var(--muted)] hover:text-[var(--navy)]"}`}><Eye size={15} />渲染预览</button>
              <button type="button" aria-pressed={viewMode === "source"} disabled={busy} onClick={() => editing ? setViewMode("source") : startEditing()} className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${viewMode === "source" ? "bg-[var(--navy)] text-white shadow-[var(--shadow-sm)]" : "text-[var(--muted)] hover:text-[var(--navy)]"}`}><Code2 size={15} />Markdown 编辑</button>
            </div>
            <button onClick={copy} disabled={busy || editing} className="focus-ring editorial-button-secondary disabled:cursor-not-allowed disabled:opacity-60"><Clipboard size={16} />复制文本</button>
            <button onClick={download} disabled={busy || editing} className="focus-ring editorial-button-secondary disabled:cursor-not-allowed disabled:opacity-60"><Download size={16} />导出 .md</button>
          </div>
        </div>
        {feedback && <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-sm font-bold text-[var(--teal-strong)]"><Check size={16} />{feedback}</p>}
        <div className="mt-6">
          {editing && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--teal)] bg-[var(--teal-pale)] px-4 py-3"><span className="text-sm font-black text-[var(--teal-strong)]">正在编辑未保存的 Markdown 草稿</span><span className="text-xs text-[var(--ink-soft)]">可切换预览检查排版；保存后新增版本，原版本不变</span></div>}
          {viewMode === "source" && editing
            ? <><label htmlFor="artifact-editor" className="sr-only">Markdown 源码编辑器</label><textarea id="artifact-editor" autoFocus maxLength={50000} spellCheck={false} value={editContent} onChange={(event) => setEditContent(event.target.value)} disabled={saving} className="focus-ring editorial-input min-h-[480px] w-full resize-y p-4 font-mono text-sm leading-7" /></>
            : <MarkdownRenderer content={editing ? editContent : current.content} />}
          {editing && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t archive-rule pt-4"><span className="text-xs text-[var(--muted)]">{editContent.length.toLocaleString("zh-CN")} / 50,000 字符{viewMode === "preview" ? " · 正在预览草稿" : ""}</span><div className="flex gap-2"><button type="button" onClick={cancelEditing} disabled={saving} className="focus-ring editorial-button-secondary disabled:cursor-wait disabled:opacity-60"><X size={16} />取消</button><button type="button" onClick={saveEditing} disabled={saving || !editContent.trim()} className="focus-ring editorial-button disabled:cursor-not-allowed disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? "保存中…" : "保存为新版本"}</button></div></div>}
        </div>
      </> : <div className="grid min-h-[480px] place-items-center text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--teal-pale)] text-[var(--teal-strong)]"><FileOutput size={25} /></span><p className="archive-label mt-6 justify-center">准备生成</p><h2 className="mt-3 text-xl font-black">准备生成{artifactTypeLabels[type]}</h2><p className="mx-auto mt-2 max-w-md leading-7 text-[var(--ink-soft)]">忆程会读取当前项目的知识卡片，整理真实进展、任务、风险和下一步。</p><button onClick={generate} disabled={busy} className="focus-ring editorial-button mt-6">{loading ? <LoaderCircle className="animate-spin" size={17} /> : null}{loading ? "正在生成…" : "开始生成"}</button></div></div>}
    </section>
  </div>;
}
