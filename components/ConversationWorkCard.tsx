"use client";
import { useEffect, useRef, useState } from "react";
import { X, ArrowRight, RefreshCw, Files } from "lucide-react";
import type { ConversationView } from "@/lib/types/conversation";
import type { ConversationWork, ConversationWorkRef, ConversationWorkPreview } from "@/lib/types/conversationWork";
import type { EvidenceFit, EvidenceReview, FitExcerpt } from "@/lib/types/missionEvidenceFit";
import { MissionEvidenceReview, MissionEvidenceResult } from "./MissionEvidenceReview";
import { ConversationReviewPanel } from "./ConversationReviewPanel";
import { missionStatusLabels } from "@/lib/mission/presentation";
import styles from "./ConversationPanel.module.css";
import { readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";
async function request<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error?.message ?? "原任务暂不可读");
  return v;
}
export function ConversationWorkCard({ conversation, workRef, onChange, onClose }: {
  conversation: ConversationView; workRef: ConversationWorkRef; onChange: (v: ConversationView) => void; onClose: () => void;
}) {
  const base = "/api/conversations/" + conversation.id + "/work";
  const draftKey = `${conversation.id}:${workRef.kind}:${workRef.id}`;
  const [saved] = useState(() => readConversationDraft(draftKey));
  const [work, setWork] = useState<ConversationWork | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(saved.answer), [selected, setSelected] = useState<string[]>(saved.selected), [minutes, setMinutes] = useState(saved.minutes), [delivery, setDelivery] = useState(saved.delivery);
  const [mode, setMode] = useState<EvidenceReview["mode"]>(saved.mode === "ANSWERING_EVIDENCE" ? "ANSWERING_EVIDENCE" : saved.mode === "BACKGROUND_ONLY" ? "BACKGROUND_ONLY" : "CONDITIONAL_ANALYSIS"), [premiseHash, setPremiseHash] = useState(saved.premiseHash);
  const [reviewedVersion, setReviewedVersion] = useState(saved.versionToken);
  const [assessment, setAssessment] = useState<{ assessment: string; remaining: string[]; evidenceFit?: EvidenceFit; observationExcerpts?: FitExcerpt[] } | null>(null);
  const live = useRef(true), keys = useRef(new Map<string, string>()), loadGeneration = useRef(0);
  const query = new URLSearchParams(workRef);
  async function load() { const epoch = ++loadGeneration.current, v = await request<ConversationWork>(base + "?" + query); if (live.current && epoch === loadGeneration.current) { setWork(v); setReviewedVersion(old => old || v.versionToken); } }
  useEffect(() => { live.current = true; void load().catch(e => { if (live.current) setError(e.message); }); return () => { live.current = false; loadGeneration.current++; }; }, [base, workRef.id, workRef.kind, conversation.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveConversationDraft(draftKey, { answer, selected, minutes, delivery, mode, premiseHash, versionToken: reviewedVersion }); }, [draftKey, answer, selected, minutes, delivery, mode, premiseHash, reviewedVersion]);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { if (live.current) setError(e instanceof Error ? e.message : "操作失败"); } finally { if (live.current) setBusy(false); } }
  function key(value: unknown) { const hash = JSON.stringify(value); let k = keys.current.get(hash); if (!k) { k = crypto.randomUUID(); keys.current.set(hash, k); } return k; }
  function body(operation: ConversationWorkPreview["operation"], extra = {}): ConversationWorkPreview {
    const premise = work?.question?.premise;
    return { requestId: key({ operation, extra, answer, selected, version: work?.versionToken, mode, premiseHash }), expectedConversationVersion: conversation.version,
      ref: workRef, versionToken: work!.versionToken, operation, ...(answer.trim() ? { answer: answer.trim() } : {}),
      ...(premise && premiseHash === premise.premiseHash ? { evidenceReview: { schemaVersion: 1, mode, confirmedPremise: true, premiseHash, note: answer.trim().slice(0, 1000) } } : {}), ...extra };
  }
  async function preview(operation: ConversationWorkPreview["operation"], extra = {}) {
    if (work && reviewedVersion !== work.versionToken) { setError("原任务已有更新，草稿已保留，请先核对本次更新。"); return; }
    await run(async () => { const r = await request<{ conversation: ConversationView }>(base, body(operation, extra)); if (live.current) onChange(r.conversation); });
  }
  const pointers = work?.candidates.filter(c => selected.includes(c.sourcePointer.id)).map(c => c.sourcePointer) ?? [];
  const needsReview = !!work?.question?.premise, reviewed = !needsReview || premiseHash === work?.question?.premise?.premiseHash;
  return <section className={styles.workCard} aria-label="原任务协作">
    <div className={styles.workHeader}><span><Files size={15} aria-hidden="true"/>原任务协作</span><div><button type="button" disabled={busy} aria-label="刷新原任务" onClick={() => void run(load)}><RefreshCw size={14}/></button><button type="button" aria-label="收起原任务协作" onClick={onClose}><X size={15}/></button></div></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!work ? <p role="status">正在读取原任务…</p> : <>
      <h3>{work.title}</h3><p className={styles.workStatus}>{missionStatusLabels[work.status] ?? ({ TODO: "待办", DOING: "进行中", DONE: "已完成", CANCELLED: "已取消" } as Record<string, string>)[work.status] ?? work.status}{work.planRevision > 0 && " · 计划 " + work.planRevision}</p>
      {reviewedVersion && reviewedVersion !== work.versionToken && <div className={styles.reason} role="status">原任务已有更新，你的草稿已保留。<button type="button" className="workspace-link focus-ring" onClick={() => setReviewedVersion(work.versionToken)}>已核对本次更新</button></div>}
      {work.question && <><blockquote>{work.question.text}</blockquote>
        {!!work.candidates.length && <details><summary>从项目资料中选择 · {work.candidates.length}</summary><div className={styles.materialList}>{work.candidates.map(c => <label key={c.sourcePointer.id}><input type="checkbox" disabled={!c.readable || busy} checked={selected.includes(c.sourcePointer.id)} onChange={e => { setSelected(v => e.target.checked ? [...v, c.sourcePointer.id] : v.filter(i => i !== c.sourcePointer.id)); setAssessment(null); }}/><span><b>{c.title}</b><small>{c.excerpt}</small></span></label>)}</div></details>}
      </>}
      {(work.question || workRef.kind === "ACTION" && !["DONE", "CANCELLED"].includes(work.status)) && <label className={styles.workInput}>{workRef.kind === "ACTION" ? "实际完成结果" : "你的答复与核对结论"}<textarea aria-label={workRef.kind === "ACTION" ? "实际完成结果" : "原问题答复"} value={answer} maxLength={workRef.kind === "ACTION" ? 2000 : 3000} onChange={e => { setAnswer(e.target.value); setAssessment(null); }} disabled={busy} placeholder={workRef.kind === "ACTION" ? "做了什么，结果如何，还有什么未完成…" : "围绕上面的原问题补充…"}/></label>}
      {work.question?.premise && <MissionEvidenceReview premise={work.question.premise} mode={mode} confirmed={reviewed} disabled={busy} onMode={v => { setMode(v); setAssessment(null); }} onConfirm={v => setPremiseHash(v ? work.question!.premise!.premiseHash : "")}/>}
      {assessment && <div className={styles.reason}>{assessment.evidenceFit ? <MissionEvidenceResult fit={assessment.evidenceFit} excerpts={assessment.observationExcerpts}/> : <><p>{({ SUFFICIENT: "字段齐备，请核对含义", INSUFFICIENT: "资料仍有缺口", CONFLICT: "存在冲突", UNKNOWN: "含义仍需核对" } as Record<string, string>)[assessment.assessment]}</p><p>{assessment.remaining.join("、")}</p></>}</div>}
      {workRef.kind === "MISSION" && <ConversationReviewPanel key={conversation.id + workRef.id} conversation={conversation} work={work} busy={busy} run={run} onChange={onChange} preview={preview}/>}
      <div className={styles.actions}>
        {work.question && (pointers.length ? <><button type="button" className="workspace-tool focus-ring" disabled={busy || !reviewed || !answer.trim()} onClick={() => void run(async () => { const a = await request<NonNullable<typeof assessment>>(base + "/materials", body("continuation", { sourcePointers: pointers })); if (live.current) setAssessment(a); })}>核对所选资料</button><button type="button" className="editorial-button focus-ring" disabled={busy || !assessment || !reviewed || !answer.trim()} onClick={() => void preview("continuation", { sourcePointers: pointers })}>预览材料接续</button></> : <button type="button" className="editorial-button focus-ring" disabled={busy || !answer.trim() || !reviewed || needsReview && mode !== "CONDITIONAL_ANALYSIS"} onClick={() => void preview("input")}>预览提交答复</button>)}
        {work.status === "PAUSED" && <button type="button" className="editorial-button focus-ring" disabled={busy} onClick={() => void preview("resume")}>预览接续原委托</button>}
        {workRef.kind === "ACTION" && !["DONE", "CANCELLED"].includes(work.status) && <button type="button" className="editorial-button focus-ring" disabled={busy || answer.trim().length < 5} onClick={() => void preview("complete_action")}>预览完成与复盘<ArrowRight size={14}/></button>}
      </div>
      {work.approval && <section className={styles.reason}><strong>{work.approval.title}</strong><p>{work.approval.description}</p><div className={styles.actions}><button type="button" disabled={busy} className="editorial-button focus-ring" onClick={() => void preview("approval", { decision: "APPROVED" })}>预览批准</button><button type="button" disabled={busy} className="workspace-tool focus-ring" onClick={() => void preview("approval", { decision: "REJECTED" })}>预览拒绝</button></div></section>}
      {workRef.kind === "MISSION" && !["SUCCEEDED", "CANCELLED", "RUNNING"].includes(work.status) && <details><summary>对比推进方案</summary><div className={styles.minuteFields}><label>可用时间（分钟）<input type="number" min="1" max="100000" value={minutes} onChange={e => setMinutes(e.target.value)}/></label><label>交付所需（分钟）<input type="number" min="1" max="100000" value={delivery} onChange={e => setDelivery(e.target.value)}/></label></div><button type="button" className="workspace-tool focus-ring" disabled={busy || !Number(minutes) || !Number(delivery)} onClick={() => void run(async () => { const r = await request<{ conversation: ConversationView; work: ConversationWork }>(base + "/scenarios", { ref: workRef, versionToken: work.versionToken, requestId: key({ minutes, delivery, token: work.versionToken }), availableMinutes: Number(minutes), deliveryMinutes: Number(delivery) }); if (live.current) { onChange(r.conversation); setWork(r.work); } })}>生成方案对比</button></details>}
      {work.scenario && <div className={styles.scenarioList}>{work.scenario.stale && <p>原方案已过期或依据变化，请重新对比。</p>}{work.scenario.choices.map(c => <section className={styles.scenario} key={c.key}><span>{c.key === "BASELINE" ? "参照" : c.key === "VERIFY_FIRST" ? "01" : "02"}</span><div><strong>{c.title}</strong><p>{c.tradeoff}</p><small>{c.reasons.join("；")}</small>{c.key !== "BASELINE" && work.scenario?.status === "READY" && <button type="button" className="workspace-link focus-ring" disabled={busy || work.scenario.stale || c.feasibility !== "READY"} onClick={() => void preview("adopt_scenario", { scenarioProposalId: work.scenario!.id, scenarioKey: c.key })}>预览采用此方案 →</button>}</div></section>)}</div>}
      {work.output && <section className={styles.reason}><strong>{work.output.title}</strong><p>验证状态：{work.output.verificationStatus}</p><button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => void preview("adopt_artifact", { outputId: work.output!.id, outputRevision: work.output!.revision })}>预览归入项目成果 →</button></section>}
      {work.resultText && <blockquote>{work.resultText}<p>复盘回执：{work.resultCardId ?? "暂无"}</p></blockquote>}
    </>}
  </section>;
}
