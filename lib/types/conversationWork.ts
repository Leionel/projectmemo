import { z } from "zod";
import { evidenceReviewSchema } from "./missionEvidenceFit";
import type { FitPremise } from "./missionEvidenceFit";
export const workRefSchema = z.object({ kind: z.enum(["MISSION", "ACTION"]), id: z.string().min(1), projectId: z.string().min(1) }).strict();
export const workPreviewSchema = z.object({
  requestId: z.string().min(1).max(128), expectedConversationVersion: z.number().int().positive(),
  ref: workRefSchema, versionToken: z.string(),
  operation: z.enum(["input", "approval", "resume", "continuation", "adopt_scenario", "adopt_artifact", "complete_action"]),
  answer: z.string().trim().min(1).max(3000).optional(), decision: z.enum(["APPROVED", "REJECTED"]).optional(),
  sourcePointers: z.array(z.object({ id: z.string(), hash: z.string() }).strict()).min(1).max(8).optional(),
  evidenceReview: evidenceReviewSchema.optional(),
  scenarioProposalId: z.string().optional(), scenarioKey: z.enum(["VERIFY_FIRST", "DELIVER_FIRST"]).optional(),
  outputId: z.string().optional(), outputRevision: z.number().int().positive().optional(),
}).strict();
export type ConversationWorkRef = z.infer<typeof workRefSchema>;
export type ConversationWorkPreview = z.infer<typeof workPreviewSchema>;
export type ConversationWork = {
  ref: ConversationWorkRef; title: string; status: string; versionToken: string;
  version: number; contextVersion: number; planRevision: number;
  question: { id: string; text: string; premise: FitPremise | null } | null;
  approval: { id: string; proposalHash: string; title: string; description: string } | null;
  output: { id: string; revision: number; title: string; verificationStatus: string } | null;
  resultText: string | null; resultCardId: string | null;
  candidates: Array<{ sourcePointer: { id: string; hash: string }; title: string; excerpt: string; readable: boolean }>;
  scenario: { id: string; proposalHash: string; expectedVersion: number; stale: boolean; status: string;
    choices: Array<{ key: string; title: string; tradeoff: string; feasibility: string; reasons: string[] }> } | null;
};
