import { z } from "zod";
export const missionBudgetReviewCaps = { models:240, tools:640, activeMs:86400000, reservedOutputTokens:480000, browserRequests:1000,browserBytes:64000000,calendarRequests:128,externalWrites:32 } as const;
/** New cumulative totals; never a fresh allowance or a retry authorization. */
export const missionBudgetReviewSchema = z.object({
  requestId:z.string().min(1).max(128), expectedVersion:z.number().int().positive(),
  totals:z.object({browserRequests:z.number().int().min(0).max(missionBudgetReviewCaps.browserRequests).optional(),browserBytes:z.number().int().min(0).max(missionBudgetReviewCaps.browserBytes).optional(),calendarRequests:z.number().int().min(0).max(missionBudgetReviewCaps.calendarRequests).optional(),externalWrites:z.number().int().min(0).max(missionBudgetReviewCaps.externalWrites).optional(),models:z.number().int().min(1).max(missionBudgetReviewCaps.models),tools:z.number().int().min(1).max(missionBudgetReviewCaps.tools),activeMs:z.number().int().min(1).max(missionBudgetReviewCaps.activeMs),reservedOutputTokens:z.number().int().min(1).max(missionBudgetReviewCaps.reservedOutputTokens)}).strict(),
}).strict();
