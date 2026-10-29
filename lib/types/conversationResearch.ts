import { z } from "zod";
import { researchScopeSchema } from "./mission";

export const conversationResearchScopeSchema = z.object({
  expectedRevision: z.number().int().positive(), projectId: z.string().min(1).max(160),
  scope: researchScopeSchema,
}).strict();
export const researchReadLevelSchema = z.enum(["SEARCH_SNIPPET", "SEARCH_SUMMARY", "FETCH_EXCERPT", "DOCUMENT_EXTRACT", "ACADEMIC_METADATA", "UNAVAILABLE"]);
export const externalSourceMetaSchema = z.object({
  conversationId: z.string(), turnId: z.string(), scopeRevision: z.number().int().positive(),
  provenanceSourceIds:z.array(z.string().max(200)).max(4).optional(),
  origin: z.enum(["SEARCH", "USER_PROVIDED"]), provider: z.string(), requestedUrl: z.string().max(8192),
  resolvedUrl: z.string().nullable(), publishedAt: z.string().nullable(), fetchedAt: z.string(),
  readLevel: researchReadLevelSchema, retrievalMethod: z.enum(["SEARCH", "SEARCH_INLINE_CONTENT", "PROVIDER_FETCH", "DOCUMENT_PARSER", "CROSSREF_METADATA"]),
  truncated: z.boolean(), totalCharacters: z.number().int().nonnegative(),
  applicability: z.object({ edition: z.string().max(200).nullable(), effectiveFrom: z.string().nullable(), effectiveUntil: z.string().nullable(),
    status: z.enum(["CURRENT", "FUTURE", "SUPERSEDED", "CONFLICTED", "UNKNOWN"]), evidenceSourceIds: z.array(z.string()).max(8) }),
}).strict();
export type ExternalSourceMeta = z.infer<typeof externalSourceMetaSchema>;
export const researchCoverageSchema = z.object({
  schemaVersion: z.literal(1), questionHash: z.string(), scopeRevision: z.number().int().positive(), asOf: z.string(),
  facets: z.array(z.object({ id: z.string().min(1).max(80), question: z.string().min(1).max(300),
    kind: z.enum(["PUBLIC_INFORMATION", "PROJECT_FACT"]),
    coverage: z.enum(["UNSEEN", "SUMMARY_ONLY", "PARTIAL", "READ_SUFFICIENT", "CONFLICTED", "UNAVAILABLE", "UNKNOWN"]),
    sourceIds: z.array(z.string()).max(8), missing: z.array(z.string().max(300)).max(4),
    conflicts: z.array(z.object({ claim: z.string().max(300), sourceIds: z.array(z.string()).min(2).max(4) }).strict()).max(4),
  }).strict()).max(8),
  temporalAssessments: z.array(z.object({ sourceId: z.string(), quote: z.string().min(1).max(500), edition: z.string().max(160).nullable(),
    effectiveFrom: z.string().nullable(), effectiveUntil: z.string().nullable(), status: z.enum(["CURRENT", "FUTURE", "SUPERSEDED", "CONFLICTED", "UNKNOWN"]) }).strict()).max(8).optional(),
  nextDecision: z.enum(["SEARCH_PUBLIC", "READ_SOURCE", "READ_PROJECT", "ASK_USER", "HANDOFF_MISSION", "ANSWER_CONDITIONALLY", "STOP"]),
  expectedDecisionChange: z.string().max(500),
  stopReason: z.enum(["SUFFICIENT_FOR_QUESTION", "NO_NEW_INFORMATION", "NEED_PROJECT_RESULT", "CONFLICT_UNRESOLVED", "BUDGET_LIMIT", "USER_STOPPED", "PERMISSION_REVOKED"]).nullable(),
}).strict();
export type ResearchCoverage = z.infer<typeof researchCoverageSchema>;
export const researchToolSchemas = [
  z.object({tool:z.literal("read_paper_metadata"),projectId:z.string(),sourceId:z.string(),revision:z.string(),scopeRevision:z.number().int().positive()}).strict(),
  z.object({ tool: z.literal("web_search"), projectId: z.string(), scopeRevision: z.number().int().positive(),
    focus: z.enum(["METHODS", "PAPERS", "EVALUATION", "COMPARISON", "OFFICIAL_RULES", "LIMITATIONS"]),
    language: z.enum(["zh", "en"]).optional(), after: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/).optional(),
    before: z.string().regex(/^\d{4}(?:-\d{2}-\d{2})?$/).optional(), count: z.number().int().min(1).max(10).default(5),
    needContent: z.boolean().default(false),
    publicSourceIds: z.array(z.string()).max(3).optional(), publicTermIndexes: z.array(z.number().int().min(0).max(19)).max(5).optional(), hostIndexes: z.array(z.number().int().min(0).max(19)).max(3).optional(),
  }).strict(),
  z.object({ tool: z.literal("web_fetch"), projectId: z.string(), sourceId: z.string(), revision: z.string().optional(), scopeRevision: z.number().int().positive() }).strict(),
] as const;
export type ResearchToolCall = z.infer<(typeof researchToolSchemas)[number]>;
