"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellDot, BookOpen, Check, FileText, GitCompareArrows, MessageSquareText, Plus } from "lucide-react";
import { evidenceTime } from "@/lib/client/sourceDisplay";
import type { ReentryBrief } from "@/lib/types/reentryBrief";
import type { WorkbenchOutput } from "@/lib/types/workbench";
import styles from "./ReentryBrief.module.css";

type Receipt = { requestId: string; seenSeq: number; seenOutputRevision: number; handledItemIds: string[] };
const icons = { NEEDS_DECISION: MessageSquareText, OUTPUT_UPDATED: FileText, SOURCE_CHANGED: BellDot };

export function ReentryBriefPanel({ missionId, projectId, outputs, onOpenRevision, onAddMaterial, onOpenQuestion }: {
  missionId: string;
  projectId: string;
  outputs: WorkbenchOutput[];
  onOpenRevision: (revision: number, compare: boolean, baseline?: number) => void;
  onAddMaterial: () => void;
  onOpenQuestion: (questionId: string) => void;
}) {
  const [brief, setBrief] = useState<ReentryBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(false);
  const request = useRef<Receipt | null>(null);
  const readInFlight = useRef<AbortController | null>(null);
  const url = "/api/missions/" + encodeURIComponent(missionId) + "/reentry-brief";
  const read = useCallback(async () => {
    if (request.current || readInFlight.current) return;
    const controller = new AbortController();
    readInFlight.current = controller;
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const value = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setBrief(null);
        throw new Error(value.error?.message ?? "回访变化暂时不可读");
      }
      setBrief(value);
      setReadError("");
    } catch (cause) {
      if (!controller.signal.aborted) setReadError(cause instanceof Error ? cause.message : "回访变化暂时不可读");
    } finally {
      if (readInFlight.current === controller) readInFlight.current = null;
    }
  }, [url]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void read(); };
    const first = setTimeout(() => void read(), 0);
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      readInFlight.current?.abort();
      readInFlight.current = null;
    };
  }, [read]);

  async function acknowledge(handledItemIds: string[] = []) {
    if (!brief || busy) return;
    request.current ??= { requestId: crypto.randomUUID(), seenSeq: brief.cursor.seq,
      seenOutputRevision: brief.cursor.outputRevision, handledItemIds };
    const receipt = request.current;
    readInFlight.current?.abort();
    readInFlight.current = null;
    setBusy(true); setWriteError(""); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receipt) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          request.current = null;
          if ([401, 403, 404].includes(response.status)) setBrief(null);
          else void read();
        }
        throw new Error(value.error?.message ?? "回执保存未确认");
      }
      request.current = null;
      setBrief(value); setReadError("");
      setNotice(receipt.handledItemIds.length ? "已标记这项变化为已处理。" : "已记录你看到了这次变化；任务进度没有因此前进。");
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : "回执保存未确认");
    } finally {
      setBusy(false);
      setRetry(request.current !== null);
    }
  }

  if (!brief && !readError && !writeError) return null;
  if (brief && !brief.items.length && brief.readState === "SEEN" && !notice && !readError && !writeError) return null;
  const unreadCount = brief?.items.filter(item => !item.read).length ?? 0;
  const pendingQuestion = brief?.items.some(item => item.questionId);
  return <section className={styles.brief} aria-label="回访变化">
    <header className={styles.head}>
      <div className={styles.heading}><span className={styles.headIcon}><BellDot size={19} aria-hidden /></span>
        <div><h2>回访简报</h2>{unreadCount ? <p>{unreadCount} 项变化待查看</p> : pendingQuestion && <p>有一个原问题需要答复</p>}</div></div>
      {!!unreadCount && <button type="button" className={styles.secondary} disabled={busy || retry} onClick={() => void acknowledge()}>
        <Check size={15} aria-hidden />我已看过
      </button>}
    </header>
    {brief && (brief.items.length === 0 ? <p>上次已读后暂无新的成果变化。</p> : <ol className={styles.items}>{brief.items.map(item => {
      const Icon = icons[item.kind];
      const revision = item.revision;
      const questionId = item.questionId;
      const output = outputs.find(row => row.id === item.outputId && row.revision === revision);
      const canCompare = !!output && outputs.some(row => row.revision < output.revision);
      const seen = brief.lastSeenOutputRevision;
      const baseline = output && seen && seen < output.revision ? seen : undefined;
      const recorded = evidenceTime(item.recordedAt, true);
      return <li key={item.id} data-kind={item.kind}>
        <div className={styles.itemHead}><Icon size={16} aria-hidden /><time dateTime={item.recordedAt}>{recorded}</time></div>
        <h3>{item.title}</h3>
        <p>{item.why}</p>
        {item.occurredAt !== item.recordedAt && <p className={styles.occurred}>变化发生于 <time dateTime={item.occurredAt}>{evidenceTime(item.occurredAt, true)}</time></p>}
        <div className={styles.actions}>
          {output && <button type="button" className={styles.action} onClick={() => onOpenRevision(output.revision, canCompare, baseline)}>
            {canCompare ? <GitCompareArrows size={15} aria-hidden /> : <BookOpen size={15} aria-hidden />}
            {canCompare ? "查看第 " + output.revision + " 版修改" : "打开第 " + output.revision + " 版"}<ArrowRight size={14} aria-hidden />
          </button>}
          {questionId && <button type="button" className={styles.action} onClick={() => onOpenQuestion(questionId)}>
            <MessageSquareText size={15} aria-hidden />回答原问题<ArrowRight size={14} aria-hidden />
          </button>}
          {item.kind === "NEEDS_DECISION" && !item.questionId && <Link prefetch={false} className={styles.action}
            href={`/projects/${encodeURIComponent(projectId)}/missions?${new URLSearchParams({ mission: missionId, ...(item.approvalId ? { approvalId: item.approvalId } : {}) })}`}>
            查看原委托<ArrowRight size={14} aria-hidden />
          </Link>}
          {item.kind === "SOURCE_CHANGED" && <button type="button" className={styles.action} onClick={onAddMaterial}>
            <Plus size={15} aria-hidden />补充资料<ArrowRight size={14} aria-hidden />
          </button>}
          {!item.questionId && !item.handled && <button type="button" className={styles.secondary}
            disabled={busy || retry} onClick={() => void acknowledge([item.id])}>标记已处理</button>}
        </div>
      </li>;
    })}</ol>)}
    {notice && <p role="status">{notice}</p>}
    {(writeError || readError) && <div className={styles.feedback}>
      <p role="alert">{writeError || readError}</p>
      {retry ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void acknowledge()}>重试原回执</button>
        : readError && <button type="button" className={styles.secondary} onClick={() => void read()}>重新读取</button>}
    </div>}
  </section>;
}
