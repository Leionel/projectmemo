"use client";
import { useEffect, useState } from "react";
import type { ReentryBrief } from "@/lib/types/reentryBrief";
import styles from "./ReentryBrief.module.css";

function when(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "时间未记录";
}

/** Up to three truthful changes since the last read. Read, handled and approved stay separate. */
export function ReentryBriefPanel({ missionId, onOpenRevision }: { missionId: string; onOpenRevision?: (revision: number) => void }) {
  const [brief, setBrief] = useState<ReentryBrief | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const url = "/api/missions/" + encodeURIComponent(missionId) + "/reentry-brief";
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" }), value = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(value.error?.message ?? "回访变化读取失败");
        setBrief(value);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "回访变化暂时不可读"); }
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  async function acknowledge(handledItemIds: string[] = []) {
    if (!brief || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), seenSeq: brief.cursor.seq,
          seenOutputRevision: brief.cursor.outputRevision, handledItemIds }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "未能保存已读回执，可重试");
      setBrief(value); setNotice(handledItemIds.length ? "已标记处理；这不等于批准或改变了项目事实。" : "已记录你看到了这次变化；任务进度没有因此前进。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "回执未确认，请重试"); }
    finally { setBusy(false); }
  }
  if (!brief) return <section className={styles.brief} aria-label="回访变化">{error && <p role="alert">{error}</p>}</section>;
  if (!brief.items.length && brief.readState === "SEEN" && notice === "") return null;
  return <section className={styles.brief} aria-label="回访变化">
    <header><h2>回访变化 <small>最多三项 · 从上次已读之后</small></h2>
      {brief.items.length > 0 && <button type="button" disabled={busy} onClick={() => void acknowledge()}>我已看过</button>}</header>
    {brief.items.length === 0 ? <p>上次已读后没有新的成果变化。</p> : <ol>{brief.items.map(item => <li key={item.id}>
      <div className={styles.heading}><strong>{item.title}</strong><span>{item.kind === "NEEDS_DECISION" ? "需要判断" : item.kind === "OUTPUT_UPDATED" ? "成果更新" : "来源变化"}</span></div>
      <p>{item.why}</p>
      <div className={styles.meta}><span>发生 {when(item.occurredAt)}</span><span>记录 {when(item.recordedAt)}</span><span>{item.approved ? "已批准" : "未批准"}</span></div>
      <div className={styles.actions}>
        {item.outputId && item.revision !== undefined && onOpenRevision && <button type="button" onClick={() => onOpenRevision(item.revision!)}>打开第 {item.revision} 版</button>}
        {!item.handled && <button type="button" disabled={busy} onClick={() => void acknowledge([item.id])}>标记已处理</button>}
        {item.handled && <span className={styles.done}>已标记处理</span>}
      </div>
    </li>)}</ol>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <details><summary>说明</summary><p>{brief.note} 批准需在原成果采纳流程单独操作，回访面板不会改变项目事实或执行权限。</p></details>
  </section>;
}
