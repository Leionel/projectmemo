"use client";
import { useEffect, useRef, useState } from "react";
import { MissionMetricInput } from "./MissionMetricInput";
import styles from "./MissionPanel.module.css";
import type { EvidenceReview, FitPremise, EvidenceFit, FitExcerpt } from "@/lib/types/missionEvidenceFit";
import { MissionEvidenceReview, MissionEvidenceResult } from "./MissionEvidenceReview";

type Pointer = { id: string; hash: string };
type Candidate = { sourcePointer: Pointer; readable: boolean; excerpt: string; observedAt: string; title?: string; coverage?: { truncated: boolean; extractionStatus: string } };
type Preview = { assessmentHash: string; assessment: string; remaining: string[]; materials: Array<{ id: string; text: string }>; evidenceFit?:EvidenceFit; fitHash?:string; observationExcerpts?:FitExcerpt[] };
async function request(path: string, body?: unknown) {
  const r = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await r.json();
  if (!r.ok) throw Object.assign(new Error(value.error?.message ?? "材料接续失败"), { status: r.status });
  return value;
}
const assessmentLabels: Record<string, string> = { SUFFICIENT: "材料字段齐备，仍需您核对含义", INSUFFICIENT: "尚缺必要信息", CONFLICT: "原问题涉及冲突，需先明确解决", UNKNOWN: "尚不能判断，请核对材料并明确答复" };
export function MissionContinuation({ id, questionId, version, contextVersion, onContinued, onAnswer, projectId, prompt, metric, initialSourceId, disabled = false, evidencePremise }: {
  id: string; questionId: string; version: number; contextVersion: number; onContinued: () => Promise<void>;
  onAnswer?: (answer: string, review?:EvidenceReview) => Promise<void>; projectId?: string; prompt?: string; initialSourceId?: string; disabled?: boolean; evidencePremise?:FitPremise|null;
  metric?: { name: string; unit: string; period: string };
}) {
  const keys = useRef(new Map<string, string>()), generation = useRef(0), autoSelected = useRef(new Set<string>());
  const [previewVersion, setPreviewVersion] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]), [selected, setSelected] = useState<Pointer[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null), [answer, setAnswer] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [showMaterials, setShowMaterials] = useState(!onAnswer || !!initialSourceId), [existing, setExisting] = useState(false);
  const [lookupSource, setLookupSource] = useState(initialSourceId ?? ""), [reload, setReload] = useState(0), [unavailable, setUnavailable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [reviewMode,setReviewMode]=useState<EvidenceReview["mode"]>("CONDITIONAL_ANALYSIS"),[reviewedPremiseHash,setReviewedPremiseHash]=useState("");
  const premiseConfirmed=!!evidencePremise&&reviewedPremiseHash===evidencePremise.premiseHash;
  const review:EvidenceReview|undefined=evidencePremise&&premiseConfirmed&&answer.trim()?{schemaVersion:1,mode:reviewMode,note:answer.trim().slice(0,1000),premiseHash:evidencePremise.premiseHash,confirmedPremise:true}:undefined;
  useEffect(() => { const scope = ++generation.current; return () => { generation.current = scope + 1; }; }, [id, questionId]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      const params = new URLSearchParams();
      if (lookupSource || existing) params.set("questionId", questionId);
      if (lookupSource) params.set("sourceId", lookupSource);
      if (existing) params.set("includeExisting", "1");
      try {
        const v = await request(`/api/missions/${encodeURIComponent(id)}/continuations${params.size ? `?${params}` : ""}`);
        if (!live) return;
        const rows: Candidate[] = v.candidates ?? [];
        setCandidates(rows); setTruncated(v.coverage?.truncated ?? false); setUnavailable(false); setError("");
        const returned = rows.find(c => c.sourcePointer.id === lookupSource);
        if (returned?.readable && !autoSelected.current.has(returned.sourcePointer.id)) {
          autoSelected.current.add(returned.sourcePointer.id);
          setSelected(old => old.some(p => p.id === returned.sourcePointer.id) ? old : [...old, returned.sourcePointer].slice(0, 8));
          setAnswer(old => old || `请根据这份原记录重新判断，保留尚未核对的内容：\n${returned.excerpt}`.slice(0, 3000));
        }
      } catch (e) {
        if (!live) return;
        const failure = e as Error & { status?: number };
        setError(failure.message);
        if ([401, 403, 404, 409].includes(failure.status ?? 0)) { setPreview(null); setUnavailable(true); }
        if ([401, 403].includes(failure.status ?? 0)) { setCandidates([]); setSelected([]); setAnswer(""); setConfirmed(false); keys.current.clear(); }
      }
    };
    void load(); const timer = setInterval(() => void load(), 15000);
    return () => { live = false; clearInterval(timer); };
  }, [id, questionId, lookupSource, existing, reload]);
  const selectionAvailable = selected.every(p => candidates.some(c => c.readable && c.sourcePointer.id === p.id && c.sourcePointer.hash === p.hash));
  const currentPreview = selectionAvailable && previewVersion === `${version}:${contextVersion}` && (!evidencePremise||premiseConfirmed&&preview?.evidenceFit?.premise.premiseHash===evidencePremise.premiseHash) ? preview : null;
  function requestKey(body: object) { const binding = JSON.stringify(body); let value = keys.current.get(binding); if (!value) { value = crypto.randomUUID(); keys.current.set(binding, value); } return value; }
  async function perform(work: () => Promise<void>) {
    if (busy || disabled || unavailable) return;
    const current = generation.current;
    setBusy(true); setError("");
    try { await work(); }
    catch (e) {
      if (current !== generation.current) return;
      const failure = e as Error & { status?: number };
      setError(failure.message || "网络结果尚未确认，请重新读取原委托"); setPreview(null);
      if ([401, 403].includes(failure.status ?? 0)) { setCandidates([]); setSelected([]); setAnswer(""); setConfirmed(false); keys.current.clear(); setUnavailable(true); }
    } finally { if (current === generation.current) setBusy(false); }
  }
  function select(candidate: Candidate, checked: boolean) {
    setSelected(old => checked ? [...old.filter(p => p.id !== candidate.sourcePointer.id), candidate.sourcePointer].slice(0, 8) : old.filter(p => p.id !== candidate.sourcePointer.id));
    setPreview(null); setConfirmed(false);
    if (checked) setAnswer(old => old || `请根据所选资料重新判断：\n${candidate.excerpt}`.slice(0, 3000));
  }
  if (!onAnswer && !candidates.length && !error) return null;
  const locked = disabled || busy || unavailable;
  return <div id={`mission-question-${questionId}`} className={styles.questionInput}>
    {onAnswer && <><h4>需要你补充</h4><p>{prompt}</p></>}
    {projectId && <div className={styles.actions}>
      <button type="button" disabled={locked} aria-expanded={showMaterials} onClick={() => { setExisting(true); setShowMaterials(v => !v); }}>从项目资料选取</button>
      <a className="workspace-link focus-ring" href={`/projects/${encodeURIComponent(projectId)}/records?${new URLSearchParams({ mission: id, questionId })}`}>保存新记录或附件 →</a>
    </div>}
    {metric && projectId && <details open><summary>填写明确的实验指标</summary><MissionMetricInput projectId={projectId} {...metric} onSaved={sourceId => { setLookupSource(sourceId); setShowMaterials(true); }}/></details>}
    {showMaterials && <div className={styles.materialCandidates}>
      {!candidates.length && !error && <p className={styles.muted}>还没有可选资料。可先保存记录或附件，再返回这里。</p>}
      {candidates.map(c => <label className={styles.materialCandidate} key={c.sourcePointer.id + c.sourcePointer.hash}>
        <input name="mission-material" type="checkbox" disabled={locked || !c.readable || selected.length >= 8 && !selected.some(p => p.id === c.sourcePointer.id)} checked={selected.some(p => p.id === c.sourcePointer.id && p.hash === c.sourcePointer.hash)} onChange={e => select(c, e.target.checked)}/>
        <span><strong>{c.title ?? (c.sourcePointer.id.startsWith("attachment:") ? "附件" : "项目记录")}</strong><span className={styles.materialExcerpt}>{c.excerpt || "正文尚不可读，原件仍保留"}</span><small>{c.readable ? c.coverage?.truncated ? "正文已截取，未读部分不作判断" : "可读取" : "等待解析或解析失败"} · {new Date(c.observedAt).toLocaleString("zh-CN")}</small></span>
      </label>)}
      {truncated && <p className={styles.muted}>这里只列出有限范围的资料；更早资料可从原项目资料入口返回。</p>}
    </div>}
    {(onAnswer || selected.length > 0) && <label>{selected.length ? "材料说明与当前问题答复" : "补充信息"}<textarea name="mission-answer" rows={3} disabled={locked} value={answer} onChange={e => { setAnswer(e.target.value); setConfirmed(false); if(evidencePremise)setPreview(null); }} maxLength={3000}/></label>}
    {evidencePremise&&<MissionEvidenceReview premise={evidencePremise} mode={reviewMode} confirmed={premiseConfirmed} disabled={locked} onMode={v=>{setReviewMode(v);setPreview(null);setConfirmed(false);}} onConfirm={v=>{setReviewedPremiseHash(v?evidencePremise.premiseHash:"");setPreview(null);setConfirmed(false);}}/>}
    {selected.length > 0 && <>
      {!selectionAvailable && <p role="status">所选资料已变化或不在当前读取范围，请重新选择；答复仍保留。</p>}
      {preview && !currentPreview && <p role="status">委托版本已变化，请重新评估材料；已保留答复。</p>}
      {!currentPreview && <button type="button" className={styles.primary} disabled={locked || !selectionAvailable || !!evidencePremise&&!review} onClick={() => void perform(async () => { const scope = generation.current; const value = await request(`/api/missions/${id}/continuations/preview`, { questionId, sourcePointers: selected,...(review?{evidenceReview:review}:{}) }); if (scope !== generation.current) return; setPreview(value); setPreviewVersion(`${version}:${contextVersion}`); setConfirmed(false); })}>评估选中材料</button>}
      {currentPreview && <div className={styles.materialReview}>
        <p>{assessmentLabels[currentPreview.assessment]}</p>
        {currentPreview.evidenceFit&&<MissionEvidenceResult fit={currentPreview.evidenceFit} excerpts={currentPreview.observationExcerpts}/>}
        {currentPreview.remaining.length > 0 && <p>待补：{currentPreview.remaining.join("、")}</p>}
        <details><summary>核对所选原文</summary>{currentPreview.materials.map(m => <pre className={styles.materialExcerpt} key={m.id}>{m.text}</pre>)}</details>
        <label className={styles.consent}><input name="material-confirmed" type="checkbox" disabled={locked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对材料与该问题的关系，确认以上答复</label>
        <button type="button" className={styles.primary} disabled={locked || !confirmed || !answer.trim()} onClick={() => void perform(async () => {
          const body = { questionId, sourcePointers: selected, expectedVersion: version, expectedContextVersion: contextVersion, assessmentHash: currentPreview.assessmentHash, answer, confirmedGap: true,...(review?{evidenceReview:review,fitHash:currentPreview.fitHash}:{}) };
          const value = await request(`/api/missions/${id}/continuations/confirm`, { ...body, requestId: requestKey(body) });
          await onContinued();
          if (!value.continued) { setError(`委托继续等待：${assessmentLabels[value.reason] ?? (value.reason === "BUDGET_EXHAUSTED" ? "预算已用完" : "请先检查云模型许可")}`); return; }
        })}>确认材料并继续委托</button>
      </div>}
    </>}
    {onAnswer && !selected.length && <button type="button" className={styles.primary} disabled={locked || !answer.trim() || !!evidencePremise&&(!review||reviewMode!=="CONDITIONAL_ANALYSIS")} onClick={() => void perform(() => onAnswer(answer,review))}>补充并继续</button>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setReload(v => v + 1)}>重新读取资料</button></p>}
  </div>;
}
