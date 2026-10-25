import { z } from "zod";
import { evidenceFitRequirementSchema } from "@/lib/types/missionEvidenceFit";
export const metricRequirementSchema=z.object({name:z.string().trim().min(1).max(80),unit:z.string().trim().min(1).max(40),period:z.string().trim().min(1).max(80)}).strict();
export const metricRecordSchema=metricRequirementSchema.extend({schemaVersion:z.literal(1),kind:z.literal("PROJECT_METRIC"),projectId:z.string().min(1),subject:z.literal("LOCAL_EXPERIMENT"),value:z.number().finite()}).strict();
export function parseMetricRecord(text:string){try{return metricRecordSchema.safeParse(JSON.parse(text));}catch{return null;}}
// Requirements describe literal evidence to look for; matching is not semantic verification.
export const gapRequirementsSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  unit: z.string().trim().max(40).default(""),
  period: z.string().trim().max(80).default(""),
  sourceType: z.enum(["CAPTURE", "ATTACHMENT", "EITHER"]).default("EITHER"),
  metric: metricRequirementSchema.optional(),
  evidenceFitV1: evidenceFitRequirementSchema.optional(),
}).strict();
export const sourcePointerSchema = z.object({
  id: z.string().min(1).max(180), hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GapRequirements = z.infer<typeof gapRequirementsSchema>;
export type WaitState = {
  gapId: string; questionId: string; question: string; missing: string; startedAt: string;
  requirements: GapRequirements; sourceCursor?: { capture: string; attachment: string };
  readSet?: unknown; resolved?: boolean;
  evidenceFitReview?: unknown; evidenceFitEventId?: string;
  evidencePremiseContext?: { constraintsVersion:number; scopeVersion:number; goalHash:string };
};
