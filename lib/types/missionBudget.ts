import { z } from "zod";
export const missionBudgetReviewCaps = { metadataRequests:960, models:240, tools:640, activeMs:86400000, reservedOutputTokens:480000 } as const;
/** New cumulative totals; never a fresh allowance or a retry authorization. */
export const missionBudgetReviewSchema = z.object({
  requestId:z.string().min(1).max(128), expectedVersion:z.number().int().positive(),
  totals:z.object({metadataRequests:z.number().int().min(1).max(missionBudgetReviewCaps.metadataRequests).optional(),models:z.number().int().min(1).max(missionBudgetReviewCaps.models),tools:z.number().int().min(1).max(missionBudgetReviewCaps.tools),activeMs:z.number().int().min(1).max(missionBudgetReviewCaps.activeMs),reservedOutputTokens:z.number().int().min(1).max(missionBudgetReviewCaps.reservedOutputTokens)}).strict(),
}).strict();
