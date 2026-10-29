"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ConversationSource } from "@/lib/types/conversation";
import { researchReadLevelLabel } from "@/lib/conversation/researchLabels";
import { DocumentSourceView } from "@/components/DocumentSourceView";

export default function WebSourcePage() {
  const p = useParams<{ conversationId: string; turnId: string; sourceId: string }>();
  const [source, setSource] = useState<ConversationSource | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const control = new AbortController();
    // Client route params can retain escaped segments; normalize once before constructing the API URL.
    const sourceId = decodeURIComponent(p.sourceId);
    fetch(`/api/conversations/${encodeURIComponent(p.conversationId)}/turns/${encodeURIComponent(p.turnId)}/sources/${encodeURIComponent(sourceId)}`, { signal: control.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "来源已不可访问"); setSource(body.data?.source ?? body.source); })
      .catch(e => { if (!control.signal.aborted) setError(e.message); });
    return () => control.abort();
  }, [p.conversationId, p.turnId, p.sourceId]);
  return <main className="mx-auto max-w-3xl px-6 py-10">
    <a className="workspace-link" href={`/focus?conversation=${encodeURIComponent(p.conversationId)}`}>← 返回原讨论</a>
    {error ? <p role="alert">{error}</p> : source ? <>
      <h1 className="mt-6 text-2xl font-semibold">{source.title}</h1>
      {source.document?<DocumentSourceView projectId={source.projectId} document={source.document} text={source.excerpt}/>:<>
      <p className="mt-3 text-sm">{researchReadLevelLabel(source.external?.readLevel)} · 抓取于 {source.external?.fetchedAt.slice(0, 10)}{source.external?.publishedAt ? ` · 发布于 ${source.external.publishedAt.slice(0, 10)}` : ""}</p>
      <p className="mt-2 text-sm">{source.external?.truncated ? "所读内容有截断；" : ""}下方为当时保存的片段，适用版本与生效状态需结合原文判断。</p>
      <pre className="my-6 whitespace-pre-wrap break-words font-sans leading-8">{source.excerpt || "尚未取得可读正文"}</pre>
      <a className="workspace-link" target="_blank" rel="noopener noreferrer" href={source.external?.requestedUrl}>打开原网页 ↗</a>
      </>}
    </> : <p className="mt-6" role="status">正在核对来源…</p>}
  </main>;
}
