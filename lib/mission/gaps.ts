import { z } from "zod";
// Requirements describe literal evidence to look for; matching is not semantic verification.
export const gapRequirementsSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  unit: z.string().trim().max(40).default(""),
  period: z.string().trim().max(80).default(""),
  sourceType: z.enum(["CAPTURE", "ATTACHMENT", "EITHER"]).default("EITHER"),
}).strict();
export const sourcePointerSchema = z.object({
  id: z.string().min(1).max(180), hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GapRequirements = z.infer<typeof gapRequirementsSchema>;
export type WaitState = {
  gapId: string; questionId: string; question: string; missing: string; startedAt: string;
  requirements: GapRequirements; sourceCursor?: { capture: string; attachment: string };
  readSet?: unknown; resolved?: boolean;
};
