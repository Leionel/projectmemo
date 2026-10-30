"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { readEffectiveDigests } from "@/lib/memory/digestService";
import type { readExperiences } from "@/lib/experience/service";
import type { readHypotheses } from "@/lib/memory/hypothesisService";
import { ClaimCorrection } from "./ClaimCorrection";
type View = { memory: Awaited<ReturnType<typeof readEffectiveDigests>>; experience: Awaited<ReturnType<typeof readExperiences>> | null; hypotheses: Awaited<ReturnType<typeof readHypotheses>> };
const hypothesisStatus: Record<string,string> = { PROPOSED: "待核实", INVESTIGATING: "调查中", SUPPORTED: "有条件支持", REFUTED: "发现反例", INCONCLUSIVE: "尚无结论", EXPIRED: "需要重核", RESTRICTED: "暂不可读" };
export function AgentMemoryPanel({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ projectId: string; view: View } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const view = loaded && loaded.projectId === projectId ? loaded.view : null;
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, [projectId]);
  async function load() {
    const token = ++epoch.current; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agent-memory`, { signal: AbortSignal.timeout(25000) });
      const result = await response.json(); if (token !== epoch.current) return;
      if (!response.ok) { setLoaded(null); throw new Error(result.error?.message ?? "项目理解暂不可读"); }
      setLoaded({ projectId, view: result });
    } catch (e) { if (token === epoch.current) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { if (token === epoch.current) setBusy(false); }
  }
  return <details onToggle={e => { if (e.currentTarget.open && !view && !busy) void load(); }}>
    <summary>当前理解与待核实</summary>
    <button onClick={() => void load()} disabled={busy}>重新核对</button>
    {busy && <p role="status">正在核对来源与当前条件…</p>}{error && <p role="alert">{error}</p>}
    {view && <>
      {!view.memory.items.length && <p>还没有调查综合。已有记录和来源仍可在下方查看。</p>}
      {view.memory.items.map(item => <article key={item.id}>
        <p>{item.effectiveState === "CURRENT" ? "当前理解" : "历史理解 · 需要重新核对"}</p>
        <p>{item.synthesis?.summary ?? "这份综合暂不可读，请回原调查查看。"}</p>
        {item.sourceMissionId && <Link href={`/projects/${projectId}/missions?mission=${encodeURIComponent(item.sourceMissionId)}`}>查看原调查与来源</Link>}
        {item.sourceConversationId && <Link href={`/focus?conversation=${encodeURIComponent(item.sourceConversationId)}`}>回原讨论接续</Link>}
        {item.synthesis && <details><summary>依据、条件与变化</summary>
          <p>这是带来源的模型综合，不是独立证据。</p>
          {item.synthesis.conditions.map((c, i) => <p key={i}>{c}</p>)}
          {item.synthesis.retainedReasons.map((r, i) => <p key={i}>{r}</p>)}
          <h4>待核实</h4>{item.synthesis.openQuestions.map((q, i) => <p key={i}>{q}</p>)}
          {item.commitments.map((c, i) => <p key={i}>{c.note} · {c.actionStatus === "DONE" ? "已记录完成" : c.actionStatus === "DOING" ? "行动进行中" : c.missionStatus === "SUCCEEDED" ? "原委托已结束" : "查看原任务进度"}
            {c.resultCardId && <span> · 已有结果回执</span>}</p>)}
          {item.origin && typeof item.origin === "object" && !Array.isArray(item.origin) && typeof item.origin.id === "string" &&
            <ClaimCorrection key={projectId + ":memory:" + item.id} projectId={projectId} kind={item.origin.kind === "MESSAGE" ? "MESSAGE" : "MISSION_OUTPUT"} sourceId={item.origin.id} onChanged={() => void load()}/>}
        </details>}
      </article>)}
      {view.memory.coverage.hasMore && <p>这里只展示最近的部分综合；更多背景请回原任务核对。</p>}
      {view.hypotheses.items.map(h => <article key={h.id}>
        <p>{hypothesisStatus[h.effectiveStatus] ?? "待核实"}</p><p>{h.statement}</p>
        {h.effectiveStatus !== "RESTRICTED" && <details><summary>条件与依据</summary>
          {h.conditions.map((c,i)=><p key={i}>{c}</p>)}<p>{h.explanation}</p>
          {h.qualificationReason && <p>{h.qualificationReason}</p>}
          {h.evidence.map((e,i)=><blockquote key={i}>{String(e.quote)} · {e.role === "COUNTER" ? "反例" : e.role === "SUPPORT" ? "支持线索" : "背景"}{!e.qualified && " · 尚不构成独立证据"}</blockquote>)}
          {h.nextInformationNeed && <p>下一步核对：{h.nextInformationNeed}</p>}
          {h.sourceMissionId && <Link href={`/projects/${projectId}/missions?mission=${encodeURIComponent(h.sourceMissionId)}`}>回原调查继续核对</Link>}
          {h.sourceConversationId && <Link href={`/focus?conversation=${encodeURIComponent(h.sourceConversationId)}`}>回原讨论接续</Link>}
          <ClaimCorrection key={projectId + ":hypothesis:" + h.id} projectId={projectId} kind="CLAIM" sourceId={h.id} onChanged={() => void load()}/>
        </details>}
      </article>)}
      {view.hypotheses.coverage.hasMore && <p>这里只展示最近的部分推测。</p>}
      {!!view.experience?.experiences.length && <details><summary>方法经验与适用条件</summary>
        {view.experience.experiences.slice(0, 5).map(e => <div key={e.id}>
          <p>{e.statement}</p>
          <p>{e.eligibility.eligible ? "当前证据有效，可作为建议" : `未注入：${e.eligibility.reason}`} · 支持 {e.supportCount} · 反例 {e.counterCount} · 案例 {e.caseReferenceCount}{e.suppressed ? " · 来源已停止使用" : ""}</p>
          {!!e.unknownConditions.length && <p>未知条件：{e.unknownConditions.join("；")}</p>}
          {e.originMissionId && <Link href={`/projects/${projectId}/missions?mission=${encodeURIComponent(e.originMissionId)}`}>回原结果核对</Link>}
        </div>)}
        <Link href={`/projects/${projectId}/missions`}>查看适用条件与原任务</Link>
      </details>}
    </>}
  </details>;
}
