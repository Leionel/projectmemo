"use client";

import { useRef, useState } from "react";
import { Download, FileOutput, X } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { MissionArtifactAdoption } from "@/components/MissionArtifactAdoption";
import type { WorkbenchOutput } from "@/lib/types/workbench";
import styles from "./WorkbenchActions.module.css";

type Delivery = { revision: number; filename: string; markdown: string };

export function WorkbenchDelivery({ missionId, projectId, output, baseline, adoptionEnabled }: {
  missionId: string;
  projectId: string;
  output: WorkbenchOutput;
  baseline?: number;
  adoptionEnabled?: boolean;
}) {
  const [preview, setPreview] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function prepare(download = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const query = new URLSearchParams({ revision: String(output.revision), ...(baseline ? { from: String(baseline) } : {}) });
      const response = await fetch(`/api/missions/${encodeURIComponent(missionId)}/outputs/${encodeURIComponent(output.id)}/delivery?${query}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "交付稿暂时不可读");
      const fresh = result as Delivery;
      setPreview(fresh);
      if (!download) return;
      if (fresh.markdown !== preview?.markdown) {
        setFeedback("交付稿已更新。请核对这份预览后再下载。");
        return;
      }
      const objectUrl = URL.createObjectURL(new Blob([fresh.markdown], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = objectUrl; link.download = fresh.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setFeedback("已准备第 " + fresh.revision + " 版的 Markdown 下载。");
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "交付稿暂时不可读");
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  return <section className={styles.delivery} aria-label="成果交付">
    <header><h3><FileOutput size={18} aria-hidden />交付第 {output.revision} 版</h3>
      {!preview && <button type="button" className={styles.button} disabled={busy || output.sourceAccessChanged} onClick={() => void prepare()}>
        {busy ? "读取中…" : "预览交付稿"}
      </button>}
    </header>
    {output.sourceAccessChanged && <p>来源许可已变化。请先核对当前稿件的依据。</p>}
    {preview && !output.sourceAccessChanged && <div className={styles.preview}>
      <div className={styles.previewBody}><MarkdownRenderer content={preview.markdown} /></div>
      <div className={styles.actions}>
        <button className={styles.primary} type="button" disabled={busy} onClick={() => void prepare(true)}><Download size={16} aria-hidden />下载 Markdown</button>
        <button className={styles.button} type="button" disabled={busy} onClick={() => { setPreview(null); setFeedback(""); }}><X size={14} aria-hidden />收起预览</button>
      </div>
      {adoptionEnabled && <MissionArtifactAdoption projectId={projectId} missionId={missionId} outputId={output.id} revision={output.revision} />}
    </div>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
