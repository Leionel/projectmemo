import { createHash } from "node:crypto";
import { z } from "zod";
import { gapRequirementsSchema } from "./gaps";
import { continuationPolicySchema } from "@/lib/types/mission";
export const successCriterionSchema=z.union([z.enum(["DRAFT_EXISTS","ACTION_CREATED","APPROVAL_CONSUMED","REQUIRED_INPUT_PRESENT"]),z.object({type:z.literal("SOURCE_COUNT"),minimum:z.number().int().min(1).max(40)}).strict()]);
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}
export const jsonHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const json = (value: unknown) => JSON.parse(JSON.stringify(value));
export { constraintsSchema,researchScopeSchema } from "@/lib/types/mission";
import { constraintsSchema,researchScopeSchema } from "@/lib/types/mission";
export const createMissionSchema = z.object({
  projectId: z.string().min(1), requestId: z.string().min(1).max(128), goal: z.string().trim().min(3).max(2000),
  successCriteria: z.array(successCriterionSchema).min(1).max(8).default(["DRAFT_EXISTS"]),
  missionConstraints: constraintsSchema.default(() => constraintsSchema.parse({})),
  researchScope: researchScopeSchema.default(() => researchScopeSchema.parse({})),
  llmContextApproved: z.boolean().default(false),
  continuationPolicy: continuationPolicySchema.default({mode:"MANUAL"}),
}).strict();
export const commandSchema = z.object({ requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive(), questionId: z.string().optional(), answer: z.string().trim().min(1).max(3000).optional(), decision: z.enum(["APPROVED", "REJECTED"]).optional(), proposalHash: z.string().optional() }).strict();
export const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), tool: z.string(), args: z.unknown(), summary: z.string().max(240).default("") }).strict(),
  z.object({ kind: z.literal("ask"), question: z.string().min(1).max(500), missing: z.enum(["PRIVATE", "CRITICAL", "CONFLICT"]), requirements: gapRequirementsSchema.optional() }).strict(),
  z.object({ kind: z.literal("finish"), outputId: z.string().min(1) }).strict(),
]);
export type Choice = z.infer<typeof choiceSchema>;
export type Decision = { choice: Choice; provider: string; model: string; usage: { inputTokens: number | null; outputTokens: number | null }; protocol: string; callId?: string; serialization?: { escapedControls: number; responseHash: string } };
export type Source = { id: string; kind: "PROJECT" | "EXTERNAL"; entityType: "PROJECT" | "CARD" | "ACTION" | "ARTIFACT" | "CAPTURE" | "ATTACHMENT" | "EXTERNAL_SOURCE"; revision: string; hash: string; identityKey?: string; knowledgeClass?: "PROJECT_OBSERVATION" | "EXTERNAL_REFERENCE" | "MIXED" | "INFERENCE"; text: string; observedAt: string; temporalState?: "CURRENT" | "SUPERSEDED" | "CONTESTED" | "UNKNOWN"; assessment?: import("../evidence/assessment").EvidenceAssessment };
export type ToolResult = { data: unknown; sources: Source[]; status?: "SUCCESS" | "PARTIAL"; coverage?: Record<string, unknown> };
export type Actor = { userId: string; projectId: string; missionId: string };
export const defaultBudget = { models: 12, tools: 16, searches: 3, fetches: 4, activeMs: 180000, reservedOutputTokens: 12000 };
export type Usage = { models: number; tools: number; searches: number; fetches: number; activeMs: number; reservedOutputTokens: number; inputTokens: number; outputTokens: number; unknownCalls: number };
export function usageOf(value: unknown): Usage { return { models: 0, tools: 0, searches: 0, fetches: 0, activeMs: 0, reservedOutputTokens: 0, inputTokens: 0, outputTokens: 0, unknownCalls: 0, ...(value as Partial<Usage>) }; }
export const terminal = ["SUCCEEDED", "CANCELLED"];
