"use client";
import type { EvidenceReview, FitPremise, EvidenceFit, FitExcerpt } from "@/lib/types/missionEvidenceFit";
import { fitReasonLabel } from "@/lib/client/evidenceFitLabels";
export const fitStatusLabel = { FIT: "条件对应，可用于回答这次测量", NOT_FIT: "观察条件不符，不能直接回答", UNKNOWN: "仍有未决项，尚不能直接回答" };
export function MissionEvidenceReview({ premise, mode, confirmed, disabled, onMode, onConfirm }: {
  premise: FitPremise; mode: EvidenceReview["mode"]; confirmed: boolean; disabled: boolean;
  onMode: (value: EvidenceReview["mode"]) => void; onConfirm: (value: boolean) => void;
}) {
  return <fieldset disabled={disabled} className="my-3 space-y-3 border-t border-[var(--rule)] pt-3">
    <legend className="font-semibold">核对这次测量的条件</legend>
    <p className="text-sm">GPU 内存 · {premise.measurement.period??"期间待核对"} · {premise.measurement.upperLimit===undefined?`单位 ${premise.measurement.unit}`:`预算上限 ${premise.measurement.upperLimit} ${premise.measurement.unit}`}</p>
    <dl className="space-y-2 text-sm">{premise.checks.map(c=><div key={c.id}><dt className="text-[var(--ink-soft)]">{c.id==="SUBJECT"?"观察主体":c.id==="STAGE"?"阶段":"必要条件"}</dt><dd>{c.expected}</dd></div>)}</dl>
    {premise.basisStatus!=="GROUNDED"&&<p role="status">部分条件尚不能对应原问题或约束，先保留未知分析。</p>}
    <label className="block">这份资料用于<select className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--rule)] bg-[var(--paper)] px-3" value={mode} onChange={e=>onMode(e.target.value as EvidenceReview["mode"])}>
      <option value="ANSWERING_EVIDENCE">回答这次测量问题</option><option value="CONDITIONAL_ANALYSIS">保留未知，继续条件分析</option><option value="BACKGROUND_ONLY">仅作背景，继续等待</option>
    </select></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>onConfirm(e.target.checked)}/>我已核对以上条件与原问题的关系</label>
  </fieldset>;
}
export function MissionEvidenceResult({fit,excerpts=[]}:{fit:EvidenceFit;excerpts?:FitExcerpt[]}) {
  return <div className="space-y-2 border-t border-[var(--rule)] pt-3"><strong>{fitStatusLabel[fit.fitStatus]}</strong>
    <details><summary>核对原文与观察条件 · {fit.groups.length}</summary>{fit.groups.map((g,index)=><div className="my-3 space-y-2 text-sm" key={g.observationGroup}>
      <p>观察 {index+1} · {g.origin==="USER_PROVIDED_REFERENCE"?"用户提供的外部参考":"用户提供的记录"} · {fitStatusLabel[g.fitStatus]}</p>
      {g.measurementResult==="EXCEEDS_LIMIT"&&<p>测量超出约定预算，负结果保留。</p>}
      {excerpts.filter(e=>e.observationGroup===g.observationGroup).map(e=><blockquote className="whitespace-pre-wrap border-l-2 border-[var(--rule)] pl-3" key={e.excerptHash}>{e.text||"这份资料中尚无明确观察"}{e.truncated&&<p>此段仅展示部分内容，未读部分保持未知。</p>}</blockquote>)}
    </div>)}</details>
    {fit.unresolvedChecks.length>0&&<details><summary>查看未决项与原文范围</summary><ul>{[...new Set(fit.unresolvedChecks.map(fitReasonLabel))].map(c=><li key={c}>{c}</li>)}</ul></details>}
    <p className="text-sm text-[var(--ink-soft)]">条件对应不代表结果真实，仍按原目标重评。</p>
  </div>;
}
