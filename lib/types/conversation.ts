import { z } from "zod";

const id = z.string().min(1).max(160);
export const conversationEntrySchema = z.object({
  kind: z.enum(["INTERVENTION", "GOAL_QUESTION", "IMPACT"]),
  projectId: id, id, revision: z.string().max(160).optional(),
}).strict();
export const conversationCreateSchema = z.object({
  requestId: id, scope: z.enum(["WORKSPACE", "PROJECT"]),
  projectId: id.optional(), title: z.string().trim().min(1).max(100).optional(),
  entry: conversationEntrySchema.optional(),
}).strict().refine(v => v.scope !== "PROJECT" || !!v.projectId, "项目讨论需要项目");
export const conversationTurnSchema = z.object({
  requestId: id, expectedVersion: z.number().int().positive(),
  message: z.string().trim().min(1).max(3000),
  replyToMessageId: id.optional(), bindingId: id.optional(), projectId: id.nullable().optional(),
  entityRef: z.object({ kind: z.enum(["MISSION", "ACTION"]), id, projectId: id }).strict().optional(),
  llmContextApproved: z.boolean().default(false),
}).strict();
export const conversationConfirmSchema = z.object({
  requestId: id, proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
}).strict();
export const focusPreferenceSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  importance: z.number().int().min(1).max(5).nullable(),
  longTermGoal: z.string().trim().max(300),
  estimatedMinutes: z.number().int().positive().max(100000).nullable(),
  notes: z.string().trim().max(500),
}).strict();
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;
export type ConversationActor = { userId: string; sessionId: string };
export type ConversationRef = {
  bindingId?: string; kind: "PROJECT" | "MISSION" | "ACTION" | "INTERVENTION" | "GOAL_QUESTION" | "IMPACT";
  id: string; projectId: string; title: string; status?: string; version?: number;
  questionId?: string | null; href: string;
};
export type ConversationSource = {
  id: string; projectId: string; sourceId: string; revision: string;
  title: string; excerpt: string; observedAt: string; temporalState: string;
  knowledgeClass: string; start: number; end: number; excerptHash: string;
};
export type PriorityReason = {
  projectId: string; importance: string; urgency: string; blocking: string;
  effort: string; preference: string; tradeoff: string; unknown: string[];
  basis: "USER_AND_STATE" | "MODEL_ADVICE";
};
export type ConversationProposal = {
  tool?: string;
  executionId: string; projectId: string; title: string; description: string;
  proposalHash: string; status: string; resultId: string | null;
  actionStatus?: string | null; resultCardId?: string | null;
  receiptText?: string | null;
};
export type ConversationBlocks = {
  schemaVersion: 1; refs: ConversationRef[]; sources: ConversationSource[];
  priorities: PriorityReason[]; proposal: ConversationProposal | null;
  provider: string; limitations: string[]; observedProjectIds: string[];
  options?: Array<{ key: string; label: string; projectId: string; missionId: string; proposalId: string; proposalHash: string; expectedVersion: number }>;
};
export type ConversationMessage = ConversationBlocks & {
  id: string; seq: number; role: string; content: string; restricted: boolean;
};
export type ConversationView = {
  schemaVersion: 1; id: string; title: string; scope: string; version: number;
  homeProjectId: string | null; focusProjectId: string | null;
  messages: ConversationMessage[]; hasMore: boolean; beforeSeq: number | null;
  activeTurn: { id: string; requestId: string; status: string } | null;
  linkedProjects: Array<{ id: string; title: string }>;
};
