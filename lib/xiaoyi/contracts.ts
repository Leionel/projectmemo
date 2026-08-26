import { z } from "zod";
import { knowledgeTypes } from "@/lib/types";

export const recordMemoryInputSchema = z.object({
  content: z.string().trim().min(3).max(5000),
  request_id: z.string().trim().min(1).max(128).optional(),
  source_type: z.string().trim().min(1).max(40).optional().default("xiaoyi-workflow"),
}).strict();

export const recordMemoryResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string(),
  agent_run_id: z.string(),
  project_title: z.string(),
  card_id: z.string(),
  title: z.string(),
  summary: z.string(),
  source_type: z.string(),
  created_at: z.string(),
  replayed: z.boolean(),
});

export type RecordMemoryInput = z.infer<typeof recordMemoryInputSchema>;
export type RecordMemoryResponse = z.infer<typeof recordMemoryResponseSchema>;

const xiaoyiKnowledgeTypes = [...knowledgeTypes, "all"] as [string, ...string[]];

export const queryMemoryInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  request_id: z.string().trim().min(1).max(128).optional(),
  top_k: z.number().int().min(1).max(8).optional(),
  limit: z.number().int().min(1).max(8).optional(),
  type: z.enum(xiaoyiKnowledgeTypes).optional().default("all"),
}).strict();

export const inspectProjectInputSchema = z.object({
  request_id: z.string().trim().min(1).max(128).optional(),
  refresh: z.boolean().optional().default(true),
}).strict();

export const createActionInputSchema = z.object({
  request_id: z.string().trim().min(1).max(128).optional(),
  confirmed: z.boolean().optional().default(false),
  proposal_id: z.string().trim().min(20).max(4096).optional(),
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  due_at: z.string().datetime().nullable().optional(),
  source_intervention_id: z.string().trim().min(1).nullable().optional(),
  source_card_id: z.string().trim().min(1).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (!value.confirmed && !value.title) {
    context.addIssue({ code: "custom", path: ["title"], message: "准备行动时必须提供 title" });
  }
  if (value.confirmed && !value.proposal_id) {
    context.addIssue({ code: "custom", path: ["proposal_id"], message: "确认行动时必须提供 proposal_id" });
  }
});

export const queryMemoryResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string(),
  agent_run_id: z.string(),
  query: z.string(),
  results: z.array(z.object({
    card_id: z.string(),
    title: z.string(),
    summary: z.string(),
    type: z.string(),
    score: z.number(),
    reason: z.string(),
    source: z.string(),
    retrieval_mode: z.string(),
    created_at: z.string(),
  })),
  retrieval_mode: z.string(),
  semantic_available: z.boolean(),
  replayed: z.boolean(),
}).passthrough();

export const inspectProjectResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string(),
  agent_run_id: z.string(),
  replayed: z.boolean(),
}).passthrough();

export const createActionResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string(),
  agent_run_id: z.string(),
  confirmed: z.boolean(),
  replayed: z.boolean(),
}).passthrough();

export type QueryMemoryInput = z.infer<typeof queryMemoryInputSchema>;
export type InspectProjectInput = z.infer<typeof inspectProjectInputSchema>;
export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export type QueryMemoryResponse = z.infer<typeof queryMemoryResponseSchema>;
