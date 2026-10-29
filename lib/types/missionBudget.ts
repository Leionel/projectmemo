import { z } from "zod";
/** New cumulative totals; never a fresh allowance or a retry authorization. */
export const missionBudgetReviewSchema = z.object({
  requestId:z.string().min(1).max(128), expectedVersion:z.number().int().positive(),
  totals:z.object({models:z.number().int().min(1).max(24),tools:z.number().int().min(1).max(64),activeMs:z.number().int().min(1).max(900000),reservedOutputTokens:z.number().int().min(1).max(48000)}).strict(),
}).strict();
