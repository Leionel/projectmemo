import { z } from "zod";
export const boundedInvestigationPolicySchema=z.object({mode:z.literal("BOUNDED_INVESTIGATION"),schemaVersion:z.literal(1),
  expiresAt:z.string().datetime(),checkEveryMinutes:z.number().int().min(1).max(1440),
  maxModels:z.number().int().min(1).max(24),maxTools:z.number().int().min(1).max(64),maxMetadataRequests:z.number().int().min(0).max(96),
  allowedTools:z.array(z.enum(["inspect_project","search_memory","read_project_material","inspect_action","web_search","web_fetch","read_repository_ci","read_ci_jobs","read_ci_log","save_mission_output","propose_action"])).min(1).max(11),
  connectionIds:z.array(z.string().min(1).max(160)).max(3).default([]),timezone:z.string().max(80).default("Asia/Shanghai"),
  quietStart:z.number().int().min(0).max(23).default(22),quietEnd:z.number().int().min(0).max(23).default(8),attention:z.enum(["INBOX","IMPORTANT_ONLY"]).default("IMPORTANT_ONLY")}).strict();
export const continuationPolicySchema=z.discriminatedUnion("mode",[z.object({mode:z.literal("MANUAL")}).strict(),z.object({mode:z.literal("LOW_RISK_READ_ANALYZE")}).strict(),boundedInvestigationPolicySchema]);
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
