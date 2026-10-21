import { z } from "zod";
export const continuationPolicySchema=z.object({mode:z.enum(["MANUAL","LOW_RISK_READ_ANALYZE"])}).strict();
export const constraintsSchema = z.object({
  availableMinutes: z.number().int().positive().max(100000).nullable().default(null),
  resourceLimits: z.array(z.string().min(1).max(160)).max(12).default([]),
  costCeiling: z.object({ amount: z.number().nonnegative(), currency: z.enum(["CNY","USD"]) }).nullable().default(null),
  deadline: z.string().datetime().nullable().default(null), priority: z.number().int().min(1).max(5).nullable().default(null),
  forbiddenApproaches: z.array(z.string().min(1).max(160)).max(12).default([]),
  rejectedActions: z.array(z.string().min(1).max(160)).max(12).default([]),
  executionBoundary: z.enum(["READ_ANALYZE", "PROPOSE_ACTION"]).default("PROPOSE_ACTION"),
}).strict();
export const researchScopeSchema = z.object({
  enabled: z.boolean().default(false), topic: z.string().trim().max(300).default(""),
  publicTerms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  allowedCategories: z.array(z.enum(["PUBLIC_TOPIC", "PUBLIC_SOURCE"])).max(2).default(["PUBLIC_TOPIC"]),
  excludedTerms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  allowedHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/i).max(253)).max(20).default([]),
}).strict().refine(s => !s.enabled || (s.topic.length > 0 && s.publicTerms.length > 0), "请确认公开研究主题及公开概念");
export type MissionConstraints = z.infer<typeof constraintsSchema>;
