"use client";
import { useEffect, useRef, useState } from "react";
import type { ConversationView } from "@/lib/types/conversation";
import type { ConversationWork, ConversationWorkPreview } from "@/lib/types/conversationWork";
import type { ChangeReviewResult, ConversationReviews, DynamicReviewResult } from "@/lib/types/changeReview";
import styles from "./ConversationPanel.module.css";

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "复核暂不可读");
  return result;
}
export function ConversationReviewPanel({ conversation, work, busy, run, onChange, preview }: {
  conversation: ConversationView; work: ConversationWork; busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>; onChange: (view: ConversationView) => void;
  preview: (operation: ConversationWorkPreview["operation"], extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [data, setData] = useState<ConversationReviews | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState(""), [rejected, setRejected] = useState<string[]>([]);
  const keys = useRef(new Map<string, string>()), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const base = `/api/conversations/${conversation.id}/work/review`;
  const load = async () => { const next = await request<ConversationReviews>(base + "?" + new URLSearchParams(work.ref)); if (live.current) setData(next); };
  async function submit(purpose: "CHANGE_REVIEW" | "DYNAMIC_PLAN", retry = false) {
    await run(async () => {
      const body = { expectedConversationVersion: conversation.version, ref: work.ref, purpose, expectedVersion: work.version, llmContextApproved: true,
        ...(purpose === "CHANGE_REVIEW" ? { sources: data!.materials.filter(m => selected.includes(m.sourcePointer.id)).map(m => m.sourcePointer) }
          : { reviewId: data!.change!.id, feedback, retry, rejectedCandidateIds: rejected }) };
      const fingerprint = JSON.stringify(body); let key = keys.current.get(fingerprint);
      if (!key) { key = crypto.randomUUID(); keys.current.set(fingerprint, key); }
      const result = await request<{ conversation: ConversationView }>(base, { ...body, requestId: key });
      if (live.current) { onChange(result.conversation); await load(); }
    });
  }
  const change = data?.change, dynamic = data?.dynamic;
  const changeResult = change?.result as ChangeReviewResult | null, dynamicResult = dynamic?.result as DynamicReviewResult | null;
  return <details className={styles.reviewPanel} onToggle={event => { if (event.currentTarget.open && !data && !busy) void run(load); }}>
    <summary>复核资料变化</summary>
    {data && !data.enabled ? <p>变化复核尚未开启。</p> : data && <>
      <div className={styles.materialList}>{data.materials.map(material => <label key={material.sourcePointer.id}>
        <input type="checkbox" checked={selected.includes(material.sourcePointer.id)} disabled={busy || !material.readable || selected.length >= 5 && !selected.includes(material.sourcePointer.id)} onChange={event => setSelected(value => event.target.checked ? [...value, material.sourcePointer.id] : value.filter(id => id !== material.sourcePointer.id))}/>
        <span><b>{material.title}</b><small>{material.excerpt}</small></span>
      </label>)}</div>
      <p className={styles.workStatus}>最多 5 份。将向云端发送原目标、约束和相关片段，占用原委托额度。</p>
      <button type="button" className="workspace-tool focus-ring" disabled={busy || !selected.length || !["READY", "PAUSED"].includes(work.status)} onClick={() => void submit("CHANGE_REVIEW")}>云端复核所选资料</button>
      {change && <section className={styles.reason}>
        <strong>{change.stale ? "复核依据已变化" : ({ READY: "变化复核", UNKNOWN: "调用结果未知", BUILDING: "正在复核", STALE: "复核依据已变化", FAILED: "本轮未完成" } as Record<string, string>)[change.status] ?? "本轮已结束"}</strong>
        <p>{changeResult?.summary ?? "读取状态不会自动重发模型。"}</p>
        {changeResult?.candidates.map(candidate => <p key={candidate.candidateId}>{candidate.question}</p>)}
        {change.status === "READY" && !change.stale && changeResult?.decision !== "KEEP_PLAN" && !dynamic && <button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => void submit("DYNAMIC_PLAN")}>比较本轮推进方案 →</button>}
      </section>}
      {dynamic && <>
        {dynamic.stale && <p>方案依据已变化，请重新复核。</p>}
        <p>{dynamicResult?.summary ?? "方案状态：" + dynamic.status}</p>
        {dynamicResult?.candidates.map((candidate, index) => <section className={styles.scenario} key={candidate.candidateId}>
          <span>{String(index + 1).padStart(2, "0")}</span><div>
            <strong>{candidate.title}</strong><p>{candidate.reason}</p><p>{candidate.expectedObservation}</p>
            <small>{candidate.feasibilityReasons.join("；") || candidate.stopCondition}</small>
            <div className={styles.actions}>
              <button type="button" className="workspace-link focus-ring" disabled={busy || dynamic.stale || dynamic.status !== "READY" || candidate.feasibility !== "READY" || rejected.includes(candidate.candidateId)} onClick={() => void preview("adopt_dynamic", { dynamicProposalId: dynamic.id, candidateId: candidate.candidateId })}>预览采用 →</button>
              <label><input type="checkbox" disabled={busy || dynamic.base.attempt >= 2} checked={rejected.includes(candidate.candidateId)} onChange={event => setRejected(value => event.target.checked ? [...value, candidate.candidateId] : value.filter(id => id !== candidate.candidateId))}/>不采用</label>
            </div>
          </div>
        </section>)}
        {dynamic.base.attempt < 2 && dynamic.status !== "BUILDING" && !dynamic.stale && <>
          <textarea aria-label="本轮复核反馈" value={feedback} maxLength={500} placeholder="补充新观察，或说明哪些方案不合适…" disabled={busy} onChange={event => setFeedback(event.target.value)}/>
          <button type="button" className="workspace-tool focus-ring" disabled={busy || !feedback.trim() && !rejected.length && (change?.toolAttempts ?? 0) === 0} onClick={() => void submit("DYNAMIC_PLAN", true)}>带新反馈再分析一次</button>
        </>}
      </>}
      <button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => void run(load)}>读取复核状态</button>
    </>}
  </details>;
}
