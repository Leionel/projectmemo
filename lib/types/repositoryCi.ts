import { z } from "zod";
const id = z.string().min(1).max(160), sha = z.string().regex(/^[0-9a-f]{40}$/);
export const repositoryCiToolSchemas = [
  z.object({ tool: z.literal("read_repository_ci"), projectId: id, connectionId: id, sha, revision: id }).strict(),
  z.object({ tool: z.literal("read_ci_jobs"), projectId: id, sourceId: id, revision: id, runId: z.number().int().positive(), attempt: z.number().int().positive() }).strict(),
  z.object({ tool: z.literal("read_ci_log"), projectId: id, sourceId: id, revision: id, jobId: z.number().int().positive() }).strict(),
] as const;
export type RepositoryCiCall = z.infer<typeof repositoryCiToolSchemas[number]>;
export type RepositorySourceMeta = {
  connectionId: string; connectionRevision: number; repo: string; sha: string;
  kind: "STATUS" | "JOBS" | "LOG"; observedAt: string;
  conversationId?: string; turnId?: string; missionId?: string;
  runId?: number; attempt?: number; jobId?: number;
  runs?: Array<{ id: number; attempt: number; conclusion: string | null }>;
  jobs?: Array<{ id: number; name: string; status: string; conclusion: string | null }>;
};
