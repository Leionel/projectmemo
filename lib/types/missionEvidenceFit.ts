import { z } from "zod";

const text = z.string().trim().min(1).max(120);
export const fitCheckSchema = z.object({
  id: z.enum(["SUBJECT", "STAGE", "CONDITION_1", "CONDITION_2"]),
  expected: text,
  basis: z.object({ kind: z.enum(["QUESTION", "CONSTRAINT"]), quote: z.string().trim().min(1).max(500) }).strict(),
}).strict();
// Candidate conditions only. They are not accepted premises until the user reviews them.
export const evidenceFitRequirementSchema = z.object({
  schemaVersion: z.literal(1), domain: z.literal("TECH_RESOURCE_MEASUREMENT"),
  measurement: z.object({ name: z.literal("GPU_MEMORY"), unit: z.enum(["GB", "MB"]), period: z.string().trim().min(1).max(80).optional(), upperLimit: z.number().finite().positive().optional() }).strict(),
  checks: z.array(fitCheckSchema).min(2).max(4),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.checks.map(c => c.id)).size !== v.checks.length || !v.checks.some(c => c.id === "SUBJECT") || !v.checks.some(c => c.id === "STAGE"))
    ctx.addIssue({ code: "custom", message: "核对项需含唯一的主体和阶段，至多两个附加条件" });
});
export const evidenceReviewSchema = z.object({
  schemaVersion: z.literal(1), mode: z.enum(["ANSWERING_EVIDENCE", "BACKGROUND_ONLY", "CONDITIONAL_ANALYSIS"]),
  note: z.string().trim().min(1).max(1000), premiseHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedPremise: z.literal(true),
}).strict();
export type EvidenceFitRequirement = z.infer<typeof evidenceFitRequirementSchema>;
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;
export type FitPremise = EvidenceFitRequirement & {
  questionId: string; goalHash: string; constraintsVersion: number; scopeVersion: number;
  premiseHash: string; basisStatus: "GROUNDED" | "UNRESOLVED";
};
export type FitSpan = { start: number; end: number; excerptHash: string };
export type FitExcerpt=FitSpan&{sourceId:string;hash:string;revision:string;observationGroup:string;text:string;truncated:boolean};
export type FitMaterial = {
  id: string; hash: string; revision: string; text: string;
  sourceState: "CURRENT" | "SUPERSEDED" | "CONTESTED" | "UNKNOWN" | "UNREADABLE";
  coverage: { loadedCharacters: number; totalCharacters: number; truncated: boolean };
};
export type FitCheckResult = { checkId: string; expected: string; observed: string | null; status: "MATCH" | "MISMATCH" | "UNKNOWN"; reasonCode: string; spans: FitSpan[] };
export type FitGroup = {
  sourceId: string; hash: string; revision: string; observationGroup: string;
  sourceState: FitMaterial["sourceState"]; origin: "USER_RECORD" | "USER_PROVIDED_REFERENCE";
  basis: "E0_EXPLICIT_TEXT"; checks: FitCheckResult[]; spans: FitSpan[];
  fitStatus: "FIT" | "NOT_FIT" | "UNKNOWN"; reasonCodes: string[];
  measurementValue: number | null; measurementResult: "WITHIN_LIMIT" | "EXCEEDS_LIMIT" | "UNKNOWN";
};
export type EvidenceFit = {
  schemaVersion: 1; ruleVersion: string; normalizationVersion: "RAW_UTF16_V1"; premise: FitPremise;
  fitStatus: "FIT" | "NOT_FIT" | "UNKNOWN"; groups: FitGroup[];
  eligibleGroups: string[]; excludedGroups: string[]; unresolvedChecks: string[]; conflicts: string[];
  coverage: { sourceCount: number; truncatedSourceIds: string[]; groupLimitSourceIds: string[] };
  semanticVerification: "NOT_CHECKED";
};
