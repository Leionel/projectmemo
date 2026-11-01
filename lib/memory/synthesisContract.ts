import { z } from "zod";
export const hypothesisUpdateSchema = z.object({
  claimId: z.string().min(1).max(180).optional(), expectedRevision: z.number().int().positive().optional(),
  statement: z.string().trim().min(1).max(1000), conditions: z.array(z.string().max(300)).min(1).max(8),
  state: z.enum(["PROPOSED", "INVESTIGATING", "SUPPORTED", "REFUTED", "INCONCLUSIVE", "EXPIRED"]),
  explanation: z.string().min(1).max(1000), nextInformationNeed: z.string().max(500), validUntil: z.string().datetime().optional(),
  evidence: z.array(z.object({ sourceId: z.string().min(1).max(240), role: z.enum(["TRIGGER", "BACKGROUND", "SUPPORT", "COUNTER"]),
    quote: z.string().min(1).max(1000) }).strict()).max(12),
}).strict();
export type HypothesisUpdate = z.infer<typeof hypothesisUpdateSchema>;
/** Produced inside the original reasoning/output call, not by an unmetered background model. */
export const memorySynthesisSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  conditions: z.array(z.string().max(300)).max(8),
  retainedReasons: z.array(z.string().max(500)).max(8),
  openQuestions: z.array(z.string().max(300)).max(12),
  commitments: z.array(z.object({ actionId: z.string().max(180).optional(), missionId: z.string().max(180).optional(),
    note: z.string().min(1).max(500) }).strict()).max(12),
  hypotheses: z.array(hypothesisUpdateSchema).max(8).default([]),
  // PM-2: account-level candidate understandings proposed inside the original output call.
  // Candidates are never active: creation requires the account policy switch and each entry
  // keeps its source manifest; activation happens only through the user's frozen confirmation.
  memoryCandidates: z.array(z.object({
    statement: z.string().trim().min(1).max(500),
    kind: z.enum(["PREFERENCE", "BACKGROUND", "FOCUS"]).default("PREFERENCE"),
    conditions: z.array(z.string().max(200)).max(6).default([]),
    basis: z.string().max(300),
    sourceIds: z.array(z.string().min(1).max(240)).max(8).default([]),
  }).strict()).max(3).optional(),
}).strict();
export type MemorySynthesis = z.infer<typeof memorySynthesisSchema>;
