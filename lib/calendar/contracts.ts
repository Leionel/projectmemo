import { z } from "zod";

export const CALENDAR_PROVIDER = "FEISHU_CALENDAR" as const;
export const CALENDAR_SCOPE = "calendar:calendar:readonly offline_access";
export const CALENDAR_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
export const CALENDAR_MAX_PAGES = 4;
export const CALENDAR_PAGE_SIZE = 50;

const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/, "需要带时区的 ISO 时间");
export const calendarWindowInputSchema = z.object({
  connectionId: z.string().min(1).max(160), timeMin: isoDateTime, timeMax: isoDateTime, maxResults: z.number().int().min(1).max(CALENDAR_PAGE_SIZE).default(20),
}).strict();
export const calendarReadInputSchema = calendarWindowInputSchema.extend({ projectId: z.string().min(1).max(160) }).strict().superRefine((value, ctx) => {
  const start = Date.parse(value.timeMin), end = Date.parse(value.timeMax);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) ctx.addIssue({ code: "custom", message: "读取窗口必须按先后顺序" });
  else if (end - start > CALENDAR_MAX_WINDOW_MS) ctx.addIssue({ code: "custom", message: "单次日历读取窗口最多 31 天" });
});
export type CalendarReadInput = z.infer<typeof calendarReadInputSchema>;

export const calendarConnectionStartSchema = z.object({ requestId: z.string().min(1).max(128) }).strict();
export const calendarConnectionActionSchema = z.object({
  action: z.literal("REVOKE"), requestId: z.string().min(1).max(128), reason: z.string().trim().max(200).optional(),
}).strict();

export type CalendarEvent = {
  eventKey: string; eventId: string; recurringEventId: string | null; status: "confirmed" | "tentative" | "cancelled";
  title: string; startAt: string | null; endAt: string | null; allDay: boolean; startDate: string | null; endDate: string | null;
  startLocalDate: string | null; endLocalDate: string | null;
  timeZone: string | null; transparency: string | null; recurrence: string | null; isException: boolean; updatedAt: string | null; etag: string | null; revision: string;
};
export type CalendarWindowCoverage = {
  windowStart: string; windowEnd: string; pages: number; complete: boolean; truncated: boolean; eventCount: number;
  malformedCount: number; nextPageTokenPresent: boolean;
};
export type CalendarReadResult = {
  connectionId: string; provider: typeof CALENDAR_PROVIDER; accountEmail: string; calendarId: string; calendarSummary: string;
  calendarTimeZone: string; events: CalendarEvent[]; coverage: CalendarWindowCoverage; observedAt: string;
  providerStatus: number; syncTokenPresent: boolean;
};

export const calendarSourceMetaSchema = z.object({
  provider: z.literal(CALENDAR_PROVIDER), accountEmail: z.string().max(320), accountName: z.string().max(200), calendarId: z.string().max(200), calendarSummary: z.string().max(300),
  calendarTimeZone: z.string().max(100), accessRole: z.string().max(40), eventId: z.string().max(200), recurringEventId: z.string().max(200).nullable(),
  eventStatus: z.enum(["confirmed", "tentative", "cancelled"]), title: z.string().max(300), recurrence: z.string().max(2000).nullable(), isException: z.boolean(),
  startAt: z.string().datetime().nullable(), endAt: z.string().datetime().nullable(), allDay: z.boolean(),
  startDate: z.string().max(10).nullable(), endDate: z.string().max(10).nullable(), timeZone: z.string().max(100).nullable(), transparency: z.string().max(20).nullable(),
  eventUpdatedAt: z.string().datetime().nullable(), eventRevision: z.string().regex(/^[a-f0-9]{64}$/), connectionRevision: z.number().int().nonnegative(),
  authGeneration: z.number().int().positive(), observedAt: z.string().datetime(),
  window: z.object({ start: z.string().datetime(), end: z.string().datetime(), complete: z.boolean(), pages: z.number().int().nonnegative(),
    truncated: z.boolean(), eventCount: z.number().int().nonnegative(), malformedCount: z.number().int().nonnegative() }).strict(),
  conversationId: z.string().max(160).optional(), turnId: z.string().max(160).optional(),
}).strict();
export type CalendarSourceMeta = z.infer<typeof calendarSourceMetaSchema>;

export type CalendarConnectionView = {
  id: string; provider: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string; calendarTimeZone: string;
  accessRole: string; scope: string; status: string; revokedAt: string | null; revokedReason: string | null;
  lastFetchedAt: string | null; lastStatus: string | null; lastError: string | null; revision: number; connected: boolean;
};
export type CalendarOAuthStart = { authorizationUrl: string; expiresAt: string; scope: string; redirectUri: string };
export const calendarToolSchemas = [
  z.object({ tool: z.literal("calendar_read"), projectId: z.string().min(1).max(160), connectionId: z.string().min(1).max(160),
    timeMin: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
    timeMax: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
    maxResults: z.number().int().min(1).max(CALENDAR_PAGE_SIZE).default(20) }).strict(),
] as const;
