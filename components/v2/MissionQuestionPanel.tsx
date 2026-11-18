"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { MissionContinuation } from "@/components/MissionContinuation";
import type { EvidenceReview, FitPremise } from "@/lib/types/missionEvidenceFit";
import styles from "./WorkbenchActions.module.css";

type QuestionDetail = {
  version: number;
  contextVersion: number;
  question: { id: string; payloadJson: { question: string; requirements?: { metric?: { name: string; unit: string; period: string } } } } | null;
  evidencePremise?: FitPremise | null;
};

export function MissionQuestionPanel({ missionId, projectId, version, onAnswered }: {
  missionId: string;
  projectId: string;
  version: number;
  onAnswered: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [readError, setReadError] = useState("");
  const [retryRead, setRetryRead] = useState(0);
  const pending = useRef<{ questionId: string; binding: string; requestId: string; expectedVersion: number } | null>(null);
  const base = "/api/missions/" + encodeURIComponent(missionId);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(base, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setDetail(null);
        throw new Error(result.error?.message ?? "原问题读取失败");
      }
      setDetail(result.mission);
      setReadError("");
    }).catch(cause => {
      if (!controller.signal.aborted) setReadError(cause instanceof Error ? cause.message : "原问题暂时不可读");
    });
    return () => controller.abort();
  }, [base, version, retryRead]);

  const question = detail?.question;
  async function answer(text: string, review?: EvidenceReview) {
    if (!question || !detail || detail.version !== version) throw new Error("原问题正在更新，请核对后再提交");
    const body = { questionId: question.id, answer: text.trim(), ...(review ? { evidenceReview: review } : {}) };
    const binding = JSON.stringify(body);
    if (pending.current && pending.current.questionId !== question.id) pending.current = null;
    if (pending.current && pending.current.binding !== binding) {
      throw new Error("原答复结果尚未确认，请使用原来的答复重试。");
    }
    pending.current ??= { questionId: question.id, binding, requestId: crypto.randomUUID(), expectedVersion: detail.version };
    const response = await fetch(base + "/input", { method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000), body: JSON.stringify({ ...body, expectedVersion: pending.current.expectedVersion, requestId: pending.current.requestId }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status < 500 && response.status !== 408) pending.current = null;
      throw Object.assign(new Error(result.error?.message ?? "原问题答复未确认"), { status: response.status });
    }
    pending.current = null;
    await onAnswered();
  }

  return <section id="workbench-question" className={styles.question} aria-label="原问题答复" tabIndex={-1}>
    <h2><MessageSquareText size={19} aria-hidden />待你判断</h2>
    {readError && <p role="alert">{readError} <button type="button" className={styles.button} onClick={() => setRetryRead(value => value + 1)}>重读原问题</button></p>}
    {question && detail ? <MissionContinuation key={question.id} id={missionId} projectId={projectId}
      questionId={question.id} version={detail.version} contextVersion={detail.contextVersion}
      prompt={question.payloadJson.question} metric={question.payloadJson.requirements?.metric}
      evidencePremise={detail.evidencePremise} disabled={!!readError || detail.version !== version}
      onAnswer={answer} onContinued={onAnswered} />
      : !readError && <p role="status">{detail ? "原问题已变化，正在刷新委托。" : "正在读取原问题…"}</p>}
  </section>;
}
