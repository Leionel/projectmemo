import { z } from "zod";
export const continuationSuggestionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(["ANSWER_ONLY", "OPEN_MISSION", "CREATE_MISSION"]),
    projectId: z.string(),
    sourceRunId: z.string(),
    reason: z.string(),
    goal: z.string().max(2000),
    mission: z
      .object({
        id: z.string(),
        version: z.number(),
        planRevision: z.number(),
        questionId: z.string().nullable(),
        approvalId: z.string().nullable(),
        outputId: z.string().nullable(),
        outputRevision: z.number().nullable(),
      })
      .nullable(),
  })
  .strict();
export type CopilotContinuationSuggestion = z.infer<
  typeof continuationSuggestionSchema
>;
export const continuationPreviewInput = z
  .object({
    sourceRunId: z.string().min(1),
    goal: z.string().trim().min(3).max(2000),
    llmContextApproved: z.boolean().default(false),
  })
  .strict();
export const continuationConfirmInput = z
  .object({
    sourceRunId: z.string().min(1),
    requestId: z.string().min(1).max(128),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();
export type CopilotMissionPreview = {
  schemaVersion: 1;
  projectId: string;
  sourceRunId: string;
  previewHash: string;
  goal: string;
  successCriteria: string[];
  llmContextApproved: boolean;
  readOnly: true;
  sourceHref: string;
};
export type CopilotMissionReceipt = {
  missionId: string;
  projectId: string;
  sourceRunId: string;
  receiptId: string;
  alreadyCreated: boolean;
};
