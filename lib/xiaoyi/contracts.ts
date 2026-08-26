import { z } from "zod";

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
