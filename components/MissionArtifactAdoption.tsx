"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BookOpen, CheckCircle2, FilePlus2, Users } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";

type Preview = {
  previewHash: string;
  content: string;
  contextVersion: number;
  visibility: string;
  sourceManifest: Array<{ id: string; kind: string; observedAt?: string; excerpts: string[] }>;
};

export function MissionArtifactAdoption({ projectId, missionId, outputId, revision, savedArtifactId }: {
  projectId: string;
  missionId: string;
  outputId: string;
  revision: number;
  savedArtifactId?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const pending = useRef(false);
  const confirmation = useRef<{ previewHash: string; requestId: string } | null>(null);
  const saved = savedArtifactId || artifactId;

  async function request<T>(
    action: "artifact-preview" | "artifact-confirm", extra?: { requestId: string; previewHash: string; expectedContextVersion: number },
  ): Promise<T | undefined> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(missionId)}/outputs/${encodeURIComponent(outputId)}/${action}`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactType: "weekly_report", expectedOutputRevision: revision, ...extra }),
      });
      const data = await response.json();
      if (response.ok) return data.receipt as T;
      if (response.status >= 500 || response.status === 408) throw new Error("receipt unconfirmed");
      setError(data.error?.message ?? "成果归入失败");
      setPreview(null);
    } catch {
      setError(extra ? "保存结果尚未确认。可以重试原归入请求。" : "暂时取不到周报预览，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function openPreview() {
    const value = await request<Preview>("artifact-preview");
    if (value) setPreview(value);
  }

  async function confirm() {
    if (!preview) return;
    if (confirmation.current?.previewHash !== preview.previewHash) {
      confirmation.current = { previewHash: preview.previewHash, requestId: crypto.randomUUID() };
    }
    const value = await request<{ artifactId: string }>("artifact-confirm", {
      ...confirmation.current, expectedContextVersion: preview.contextVersion,
    });
    if (value) {
      setArtifactId(value.artifactId);
      setPreview(null);
    }
  }

  return <section aria-label="归入项目周报" className="mt-3 text-sm">
    {saved ? <p className="flex flex-wrap items-center gap-2">
      <CheckCircle2 size={16} aria-hidden />第 {revision} 版已归入项目周报
      <Link className="focus-ring text-[var(--teal-strong)] underline"
        href={`/projects/${encodeURIComponent(projectId)}/generate?type=weekly_report&artifact=${encodeURIComponent(saved)}`}>
        打开已归入的成果版本
      </Link>
    </p> : <>
      {!preview && <button type="button" className="editorial-button-secondary focus-ring" disabled={busy} onClick={() => void openPreview()}>
        <FilePlus2 size={16} aria-hidden />预览归入项目周报
      </button>}
      {preview && <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-3">
        <p className="flex items-start gap-2"><Users size={17} className="mt-0.5 shrink-0" aria-hidden />{preview.visibility}</p>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg bg-[var(--card-bg)] p-3"><MarkdownRenderer content={preview.content} /></div>
        {!!preview.sourceManifest.length && <details className="my-2">
          <summary>引用资料 · {preview.sourceManifest.length} 条</summary>
          {preview.sourceManifest.map(source => <div key={source.id} className="mt-3">
            <p className="flex flex-wrap items-center gap-2"><BookOpen size={16} aria-hidden />
              {source.kind === "EXTERNAL" ? "外部参考" : sourceDisplayName(source.id)}
              {source.observedAt && <time dateTime={source.observedAt}>{evidenceTime(source.observedAt)}</time>}
            </p>
            <blockquote className="mt-1 whitespace-pre-wrap">{source.excerpts.join("；")}</blockquote>
          </div>)}
        </details>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="editorial-button focus-ring" disabled={busy} onClick={() => void confirm()}>
            确认保存并向项目成员共享
          </button>
          <button type="button" className="editorial-button-secondary focus-ring" disabled={busy}
            onClick={() => { setPreview(null); setError(""); }}>取消归入</button>
        </div>
      </div>}
    </>}
    {!!error && <p role="alert">{error}</p>}
  </section>;
}
