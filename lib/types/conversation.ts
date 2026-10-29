import { z } from "zod";
import type { AgentPresentation, PresentationPlan } from "./agentExperience";
import type { ExternalSourceMeta, ResearchCoverage } from "./conversationResearch";
export type ConversationChangeNotice = { anchorId: string; revisionKey: string; eventId: string; missionId: string; goalQuote: string; changeKind: "SOURCE_ARRIVED" };

const id = z.string().min(1).max(160);
export const conversationEntrySchema = z.object({
  kind: z.enum(["INTERVENTION", "GOAL_QUESTION", "IMPACT", "SOURCE_OBSERVATION"]),
  projectId: id, id, revision: z.string().max(160).optional(),
}).strict();
export const conversationCreateSchema = z.object({
  requestId: id, scope: z.enum(["WORKSPACE", "PROJECT"]),
  projectId: id.optional(), title: z.string().trim().min(1).max(100).optional(),
  entry: conversationEntrySchema.optional(),
}).strict().refine(v => v.scope !== "PROJECT" || !!v.projectId, "项目讨论需要项目");
export const conversationTurnSchema = z.object({
  requestId: id, expectedVersion: z.number().int().positive(), expectedContinuitySeq: z.number().int().nonnegative().optional(),
  message: z.string().trim().min(1).max(3000),
  replyToMessageId: id.optional(), bindingId: id.optional(), projectId: id.nullable().optional(),
  entityRef: z.object({ kind: z.enum(["MISSION", "ACTION"]), id, projectId: id }).strict().optional(),
  userProvidedUrls: z.array(z.string().min(1).max(8192)).max(5).optional(),
  llmContextApproved: z.boolean().default(false),
  investigationMode: z.enum(["QUICK", "STANDARD", "DEEP"]).optional(),
}).strict();
export const conversationConfirmSchema = z.object({
  requestId: id, proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  expectedConversationVersion: z.number().int().positive().optional(),
}).strict();
export const focusPreferenceSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  importance: z.number().int().min(1).max(5).nullable(),
  longTermGoal: z.string().trim().max(300),
  estimatedMinutes: z.number().int().positive().max(100000).nullable(),
  notes: z.string().trim().max(500),
}).strict();
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;
export type ConversationActor = { userId: string; sessionId: string; conversationId?: string; missionId?: string; missionProjectId?: string };
export type ConversationRef = {
  bindingId?: string; kind: "PROJECT" | "MISSION" | "ACTION" | "INTERVENTION" | "GOAL_QUESTION" | "IMPACT";
  id: string; projectId: string; title: string; status?: string; version?: number;
  questionId?: string | null; href: string;
};
export type ConversationSource = {
  document?: import("./document").DocumentMeta;
  repository?: import("./repositoryCi").RepositorySourceMeta;
  external?: ExternalSourceMeta;
  id: string; projectId: string; sourceId: string; revision: string;
  title: string; excerpt: string; observedAt: string; temporalState: string;
  knowledgeClass: string; start: number; end: number; excerptHash: string;
  readScope?: "SUMMARY" | "EXCERPT" | "STRUCTURED";
};
export type ConversationCitation = { sourceId: string; quote: string };
export type ConversationFileGuide = {
  document?: import("./document").DocumentMeta;
  number: number; sourceId: string; projectId: string; entityId: string;
  kind: "ATTACHMENT" | "RECORD" | "ARTIFACT" | "WEB"; title: string; revision: string;
  external?: ExternalSourceMeta;
  stale: boolean; missing: boolean; archived: boolean; temporalState: string;
  excerpt: string; quote: string | null; readScope: "SUMMARY" | "EXCERPT"; href: string;
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
  observationRef?: ConversationEntry;
  researchCoverage?: ResearchCoverage;
  schemaVersion: 1; refs: ConversationRef[]; sources: ConversationSource[];
  priorities: PriorityReason[]; proposal: ConversationProposal | null;
  provider: string; limitations: string[]; observedProjectIds: string[];
  citations?: ConversationCitation[];
  fileGuides?: ConversationFileGuide[];
  presentation?: AgentPresentation;
  presentationPlan?: PresentationPlan;
  changeNotice?: ConversationChangeNotice;
  reviewRef?: { id: string; purpose: string; missionId: string; projectId: string; status: string; proposalHash: string };
  options?: Array<{ key: string; label: string; projectId: string; missionId: string; proposalId: string; proposalHash: string; expectedVersion: number; purpose?: "DYNAMIC_PLAN"; candidateId?: string }>;
};
export type ConversationMessage = ConversationBlocks & {
  id: string; seq: number; role: string; content: string; restricted: boolean;
};
export type ConversationProgress = { sequence?: number; events?: Array<{ seq: number; phase: string; at: string; stepId: string | null }>; phase: string; mode: string; completedReads: number; readLimit: number;
  steps: Array<{ id: string; label: string; status: string }>; stopReason: string | null };
export type ConversationView = {
  continuity?: import("./continuity").ContinuityView;
  research?: { available: boolean; revision: number; projectId: string | null; scope: z.infer<typeof import("./mission").researchScopeSchema> };
  schemaVersion: 1; id: string; title: string; scope: string; version: number;
  homeProjectId: string | null; focusProjectId: string | null;
  messages: ConversationMessage[]; hasMore: boolean; beforeSeq: number | null;
  activeTurn: { id: string; requestId: string; status: string; progress?: ConversationProgress } | null;
  latestTurn?: { id: string; status: string; message: string; canRetry: boolean } | null;
  linkedProjects: Array<{ id: string; title: string }>;
};
