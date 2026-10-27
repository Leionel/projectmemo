import { z } from "zod";
import type { Source } from "@/lib/mission/contracts";

const pointer = z.object({ id: z.string().min(1).max(160), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const changeReviewInput = z.object({
  requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive(),
  sources: z.array(pointer).min(1).max(5), llmContextApproved: z.literal(true),
}).strict();
export const dynamicReviewInput = z.object({
  requestId: z.string().min(1).max(128), reviewId: z.string().min(1),
  llmContextApproved: z.literal(true), feedback: z.string().trim().max(500).default(""),
  retry: z.boolean().default(false),
  rejectedCandidateIds: z.array(z.string().min(1).max(64)).max(3).default([]),
}).strict();
export const quoteRef = z.object({ ref: z.string().min(1).max(240), quote: z.string().min(1).max(500) }).strict();
export const changeAnswerSchema = z.object({
  decision: z.enum(["ATTEND", "KEEP_PLAN", "UNKNOWN"]),
  summary: z.string().min(1).max(800),
  candidates: z.array(z.object({
    premise: z.string().min(1).max(300), goalQuote: z.string().min(1).max(300), question: z.string().min(1).max(500),
    changeKind: z.enum(["PREMISE_CHANGED", "CONFLICT", "UNKNOWN", "UPDATE", "UNRELATED"]),
    relevance: z.enum(["DIRECT", "PLAUSIBLE", "UNCLASSIFIED", "UNRELATED"]),
    goalLink: z.enum(["PROJECT_OBSERVATION", "APPLICABLE_REQUIREMENT", "APPLICABLE_METHOD", "BACKGROUND_ONLY", "UNESTABLISHED"]),
    reason: z.string().min(1).max(500), evidence: z.array(quoteRef).min(1).max(8),
    unknown: z.array(z.string().max(200)).max(8),
  }).strict()).max(3),
}).strict();
export const dynamicAnswerSchema = z.object({
  summary: z.string().min(1).max(800),
  candidates: z.array(z.object({
    kind: z.enum(["READ_EXISTING", "ASK_USER", "PROPOSE_VERIFICATION", "KEEP_PLAN"]),
    title: z.string().min(1).max(160), reason: z.string().min(1).max(500),
    question: z.string().max(500).nullable(), sourceIds: z.array(z.string().max(160)).max(5),
    expectedObservation: z.string().max(500), stopCondition: z.string().min(1).max(300),
    branches: z.array(z.object({ observation: z.string().min(1).max(200), consequence: z.string().min(1).max(300) }).strict()).max(4),
    evidence: z.array(quoteRef).max(8),
  }).strict()).min(1).max(3),
}).strict();
export const dynamicAdoptSchema = z.object({
  requestId: z.string().min(1).max(128), proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  candidateId: z.string().min(1), expectedVersion: z.number().int().positive(), confirmed: z.literal(true),
}).strict();
export type EvidenceSlice = { ref: string; source: Source; title: string; role: "CURRENT" | "HISTORICAL"; text: string; readScope: "SUMMARY" | "EXCERPT" };
export type ReviewBase = {
  schemaVersion: 2; rootReviewKey: string; attempt: number; missionId: string; projectId: string;
  expectedVersion: number; goalHash: string; successHash: string; constraintsHash: string;
  scopeHash: string; planRevision: number; policyVersion: string; providerVersion: string;
  sourcePointers: Array<{ id: string; hash: string }>; evidence: EvidenceSlice[];
  goal: string; projectGoalHash: string; successCriteria: unknown; constraints: unknown;
  coverage: { complete: false; changedSources: number; historicalSources: number; limits: { changes: 5; excerpts: 8 } };
  reservation?: { outputTokens: number; activeMs: number; settled: boolean; sent: boolean };
  readAttempts?: number;
  rejectedCandidateIds?: string[];
  goalStateHash?: string;
  goalState?: Awaited<ReturnType<typeof import("@/lib/decision/goalState").reviewGoalState>>["snapshot"];
};
export type ChangeCandidate = z.infer<typeof changeAnswerSchema>["candidates"][number] & { candidateId: string };
export type ChangeReviewResult = { schemaVersion: 2; decision: "ATTEND" | "KEEP_PLAN" | "UNKNOWN"; summary: string; candidates: ChangeCandidate[]; provider: string; usageUnknown: boolean };
export type DynamicCandidate = z.infer<typeof dynamicAnswerSchema>["candidates"][number] & {
  candidateId: string; feasibility: "READY" | "UNKNOWN" | "UNMET"; feasibilityReasons: string[];
  estimatedMinutes: null; cost: null; estimateSource: "UNKNOWN";
};
export type DynamicReviewResult = { schemaVersion: 2; summary: string; candidates: DynamicCandidate[]; provider: string; usageUnknown: boolean };
export type ReviewView = {
  id: string; missionId: string; projectId: string; purpose: string; status: string; proposalHash: string;
  base: ReviewBase; result: ChangeReviewResult | DynamicReviewResult | null; stale: boolean;
  receipt: unknown; createdAt: string;
  toolAttempts: number;
};
export type ConversationReviews = {
  enabled: boolean;
  materials: Array<{ sourcePointer: { id: string; hash: string }; title: string; excerpt: string; readable: boolean; extractionStatus: string }>;
  change: ReviewView | null; dynamic: ReviewView | null;
};
