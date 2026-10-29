import { AppError } from "@/lib/api";
import type { AgentMission } from "@/lib/generated/prisma/client";
import type { EvidenceReview, FitMaterial, FitPremise } from "@/lib/types/missionEvidenceFit";
import { evaluateEvidenceFit, makeFitPremise } from "./evidenceFit";
import { jsonHash, type Source } from "./contracts";
import type { WaitState } from "./gaps";
import { event, type Tx } from "./repository";
import { readProjectMaterialView } from "./sourceSignals";
import { materialTemporalStates } from "./readSetValidator";

export function premiseFor(m: AgentMission, wait: WaitState): FitPremise | null {
  if (!wait.requirements?.evidenceFitV1) return null;
  const r=wait.requirements.evidenceFitV1;
  const p=makeFitPremise({...r,measurement:{...r.measurement,...(wait.requirements.period?{period:wait.requirements.period}:{})}}, { questionId: wait.questionId, question: wait.question, goal: m.goal, constraints: m.constraintsJson, constraintsVersion: m.constraintsVersion, scopeVersion: m.researchScopeVersion });
  const frozen=wait.evidencePremiseContext;
  if(!frozen||frozen.constraintsVersion!==m.constraintsVersion||frozen.scopeVersion!==m.researchScopeVersion||frozen.goalHash!==jsonHash(m.goal))return{...p,basisStatus:"UNRESOLVED",premiseHash:jsonHash({...p,frozenContext:frozen??null,basisStatus:"UNRESOLVED"})};
  if(wait.requirements.unit&&wait.requirements.unit!==p.measurement.unit)return{...p,basisStatus:"UNRESOLVED",premiseHash:jsonHash({...p,requiredUnit:wait.requirements.unit,basisStatus:"UNRESOLVED"})};
  return p;
}
export async function assessEvidenceFit(tx: Tx, m: AgentMission, wait: WaitState, sources: Source[], review?: EvidenceReview) {
  const premise = premiseFor(m, wait);
  if (!premise) return null;
  if (review && review.premiseHash !== premise.premiseHash) throw new AppError("FIT_PREMISE_CHANGED", "原问题或约束已变化，请重新核对条件", 409);
  const states = await materialTemporalStates(m.projectId, sources, tx, true), views: FitMaterial[] = [];
  for (const source of sources) {
    const view = await readProjectMaterialView(m.projectId, source.id, tx);
    if (!view || view.source.hash !== source.hash) throw new AppError("SOURCE_CHANGED", "资料版本已变化，请重新预览", 409);
    const linked = states.filter(s => s.sourceIds.includes(source.id));
    const sourceState: FitMaterial["sourceState"] = !view.source.text.trim() ? "UNREADABLE" : linked.some(s => s.state === "SUPERSEDED") ? "SUPERSEDED" : linked.some(s => s.state === "CONTESTED") ? "CONTESTED" : linked.some(s => s.state !== "CURRENT") ? "UNKNOWN" : "CURRENT";
    views.push({ id: source.id, hash: source.hash, revision: source.revision, text: source.text, sourceState, coverage: view.coverage });
  }
  const evidenceFit = evaluateEvidenceFit(premise, views);
  if(wait.missing==="CONFLICT"){evidenceFit.fitStatus="UNKNOWN";evidenceFit.conflicts.push("QUESTION_CONFLICT");evidenceFit.unresolvedChecks.push("QUESTION_CONFLICT");}
  // The exact current ledger/read-set is recomputed on confirm, including effective-time boundaries.
  const fitHash = jsonHash({ missionId: m.id, questionId: wait.questionId, version: m.version, contextVersion: m.contextVersion, evidenceFit, review: review ?? null });
  const observationExcerpts=evidenceFit.groups.map(g=>{const source=views.find(v=>v.id===g.sourceId)!,s=g.spans[0];return{sourceId:source.id,hash:source.hash,revision:source.revision,observationGroup:g.observationGroup,...s,text:source.text.slice(s.start,s.end).slice(0,1500),truncated:s.end-s.start>1500};});
  return { evidenceFit, fitHash, observationExcerpts, review: review ?? null, hardBlocked: views.some(v => v.sourceState === "UNREADABLE" || v.sourceState === "SUPERSEDED") };
}
export function requireFitReview(fit: NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>, review?: EvidenceReview) {
  if (!review) throw new AppError("EVIDENCE_REVIEW_REQUIRED", "请在新版页面核对问题条件、资料用途和未决项后提交", 409);
  if (review.mode !== "BACKGROUND_ONLY" && fit.hardBlocked) throw new AppError("EVIDENCE_SOURCE_BLOCKED", "不可读或已被取代的资料不能作为本次继续的依据；请重取当前版本", 409);
  if (review.mode === "ANSWERING_EVIDENCE" && fit.evidenceFit.fitStatus !== "FIT") throw new AppError("EVIDENCE_FIT_UNRESOLVED", "这些资料尚不能直接回答当前问题，可保留未知作条件分析或仅作背景", 409);
  if (review.mode === "ANSWERING_EVIDENCE" && fit.evidenceFit.premise.basisStatus !== "GROUNDED") throw new AppError("EVIDENCE_PREMISE_UNRESOLVED", "问题条件尚不能对应原文，请保留未知分析", 409);
}
export async function recordFitReview(tx: Tx, m: AgentMission, fit: NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>, review: EvidenceReview) {
  return event(tx, m.id, "EVIDENCE_FIT_REVIEWED", { ...fit, review, reviewerUserId: m.ownerUserId, basis: "USER_REVIEWED", truthVerified: false });
}
/** Source containers do not establish observation ownership. */
export function fitSourceClass(fit: NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>, sourceId: string): Source["knowledgeClass"] {
  const classes=[...new Set(fitSourceScopes(fit,sourceId).map(s=>s.knowledgeClass))];
  return classes.length===1?classes[0]:classes.length?"MIXED":"INFERENCE";
}
export function fitSourceScopes(fit:NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>,sourceId:string):NonNullable<Source["observationScopes"]>{
 return fit.evidenceFit.groups.filter(g=>g.sourceId===sourceId).flatMap(g=>g.spans.map(s=>({start:s.start,end:s.end,knowledgeClass:g.origin==="USER_PROVIDED_REFERENCE"?"EXTERNAL_REFERENCE" as const:g.fitStatus==="FIT"&&fit.review?.mode==="ANSWERING_EVIDENCE"&&!fit.evidenceFit.conflicts.length?"PROJECT_OBSERVATION" as const:"INFERENCE" as const})));
}
/** Keep the essential review outside clipped answer text without exhausting the Runner context. */
export function fitContextSummary(fit: Awaited<ReturnType<typeof assessEvidenceFit>>) {
  if(!fit)return null;
  const e=fit.evidenceFit;
  return { schemaVersion:1, ruleVersion:e.ruleVersion, fitHash:fit.fitHash, premise:e.premise,
    review:fit.review, fitStatus:e.fitStatus, unresolvedChecks:e.unresolvedChecks, conflicts:e.conflicts,
    eligibleGroups:e.eligibleGroups,excludedGroups:e.excludedGroups,
    groups:[...e.groups].sort((a,b)=>Number(e.eligibleGroups.includes(b.observationGroup))-Number(e.eligibleGroups.includes(a.observationGroup))).slice(0,4).map(g=>({sourceId:g.sourceId,hash:g.hash,revision:g.revision,observationGroup:g.observationGroup,origin:g.origin,sourceState:g.sourceState,fitStatus:g.fitStatus,
      measurementValue:g.measurementValue,measurementResult:g.measurementResult,spans:g.spans,
      excerpt:fit.observationExcerpts?.find(s=>s.observationGroup===g.observationGroup),
      checks:g.checks.map(c=>({checkId:c.checkId,status:c.status,reasonCode:c.reasonCode}))})),
    coverage:{...e.coverage,omittedGroups:Math.max(0,e.groups.length-4)}, truthVerified:false };
}
export function fitReviewReference(fit: Awaited<ReturnType<typeof assessEvidenceFit>>) {
 if(!fit)return null;
 const e=fit.evidenceFit;
 return{fitHash:fit.fitHash,ruleVersion:e.ruleVersion,premiseHash:e.premise.premiseHash,questionId:e.premise.questionId,
   constraintsVersion:e.premise.constraintsVersion,scopeVersion:e.premise.scopeVersion,measurement:e.premise.measurement,
   checks:e.premise.checks.map(c=>({id:c.id,expected:c.expected})),review:fit.review,fitStatus:e.fitStatus,
   unresolvedChecks:e.unresolvedChecks,conflicts:e.conflicts,truthVerified:false};
}
