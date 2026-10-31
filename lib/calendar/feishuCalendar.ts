import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { CALENDAR_PAGE_SIZE, CALENDAR_PROVIDER, type CalendarEvent } from "./contracts";
import { feishuEndpoints, type CalendarFetch } from "./feishuOAuth";

export type FeishuCalendar = { calendarId: string; summary: string; type: string; role: string; permissions: string; isDeleted: boolean; isThirdParty: boolean };
export type FeishuEventPage = { events: CalendarEvent[]; hasMore: boolean; pageToken: string | null; syncToken: string | null; malformedCount: number; status: number };

const defaultTimeZone = () => process.env.FEISHU_CALENDAR_DEFAULT_TIMEZONE?.trim() || "Asia/Shanghai";
function sanitizeTitle(raw: unknown) {
  const firstLine = String(raw ?? "").split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || "(无标题)").slice(0, 300);
}
function localDate(iso: string | null, timeZone: string | null) {
  if (!iso) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || defaultTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
  catch { return iso.slice(0, 10); }
}
function providerError(status: number, code: number, message: string): never {
  if (status === 401 || code === 99991663 || code === 20005) throw new AppError("CALENDAR_TOKEN_EXPIRED", "飞书日历授权已失效，请重新连接", 401, { providerStatus: status, providerCode: code });
  if (status === 429 || [190004, 190005, 190010].includes(code)) throw new AppError("CALENDAR_RATE_LIMITED", "飞书日历请求被限流，请稍后再试", 429, { providerStatus: status, providerCode: code });
  if ([190008].includes(code)) throw new AppError("CALENDAR_CURSOR_INVALID", "飞书日历分页或增量游标已失效，需要重新读取", 409, { providerCode: code });
  if ([191000, 191001, 191003].includes(code)) throw new AppError("CALENDAR_NOT_FOUND", "选择的飞书日历已不可用，请重新连接或核对日历权限", 409, { providerCode: code });
  if (code === 191002) throw new AppError("CALENDAR_ACCESS_DENIED", "当前飞书账号已没有该日历的读取权限", 409, { providerCode: code });
  throw new AppError("CALENDAR_PROVIDER_ERROR", message.slice(0, 160) || "飞书日历返回错误", 503, { providerStatus: status, providerCode: code });
}
async function readJson(response: Response): Promise<unknown> {
  try { return JSON.parse((await response.text()).slice(0, 524288)); } catch { throw new AppError("CALENDAR_PROVIDER_FORMAT", "飞书日历返回格式不正确", 503); }
}

export async function listFeishuCalendars(accessToken: string, fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<FeishuCalendar[]> {
  const url = new URL(feishuEndpoints.calendarList); url.searchParams.set("page_size", "50");
  const response = await fetcher(url.href, { redirect: "error", signal: signal ?? AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const body = await readJson(response) as { code?: number; msg?: string; data?: { calendar_list?: Array<Record<string, unknown>> } };
  if (!response.ok || body.code !== 0) providerError(response.status, Number(body.code), String(body.msg ?? ""));
  return (body.data?.calendar_list ?? []).flatMap(raw => {
    const calendarId = String(raw.calendar_id ?? "");
    if (!calendarId || calendarId.length > 300) return [];
    return [{ calendarId, summary: sanitizeTitle(raw.summary), type: String(raw.type ?? ""), role: String(raw.role ?? ""),
      permissions: String(raw.permissions ?? ""), isDeleted: raw.is_deleted === true, isThirdParty: raw.is_third_party === true }];
  });
}
/** Prefer the user's primary calendar; never auto-expand to other calendars after the user selected a resource. */
export function choosePrimaryFeishuCalendar(calendars: FeishuCalendar[]) {
  const usable = calendars.filter(calendar => !calendar.isDeleted && !calendar.isThirdParty && ["owner", "writer", "reader"].includes(calendar.role));
  return usable.find(calendar => calendar.type === "primary") ?? usable.find(calendar => calendar.role === "owner") ?? usable[0] ?? null;
}

export function normalizeFeishuEvent(raw: Record<string, unknown>, calendarTimeZone: string): { event: CalendarEvent | null; malformed: boolean } {
  const eventId = String(raw.event_id ?? "");
  if (!eventId || eventId.length > 300) return { event: null, malformed: true };
  const start = raw.start_time as { date?: unknown; timestamp?: unknown; timezone?: unknown } | undefined;
  const end = raw.end_time as { date?: unknown; timestamp?: unknown; timezone?: unknown } | undefined;
  const startDate = typeof start?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start.date) ? start.date : null;
  const endDate = typeof end?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(end.date) ? end.date : null;
  const allDay = !!startDate;
  const toIso = (timestamp: unknown) => {
    const seconds = Number(timestamp);
    return Number.isFinite(seconds) && seconds > 0 && seconds <= 16725225600 ? new Date(seconds * 1000).toISOString() : null;
  };
  const startAt = allDay ? null : toIso(start?.timestamp), endAt = allDay ? null : toIso(end?.timestamp);
  if (!allDay && (!startAt || !endAt)) return { event: null, malformed: true };
  if (allDay && (!startDate || !endDate)) return { event: null, malformed: true };
  const timeZone = allDay ? "UTC" : (typeof start?.timezone === "string" ? start.timezone.slice(0, 100) : calendarTimeZone);
  const statusRaw = String(raw.status ?? "confirmed");
  if(!["confirmed","tentative","cancelled"].includes(statusRaw))return {event:null,malformed:true};
  const status=statusRaw as CalendarEvent["status"];
  const recurrence = typeof raw.recurrence === "string" && raw.recurrence.trim() ? raw.recurrence.trim().slice(0, 2000) : null;
  const isException = raw.is_exception === true;
  const recurringEventId = isException && typeof raw.recurring_event_id === "string" ? raw.recurring_event_id.slice(0, 300) : null;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.map(item => item && typeof item === "object" ? String((item as { file_token?: unknown }).file_token ?? "") : "")
    .filter(token => token.length > 0 && token.length <= 200).slice(0, 10) : [];
  const startKey = startDate ?? startAt!, endKey = endDate ?? endAt!;
  const event: CalendarEvent = {
    eventKey: `${eventId}|${recurringEventId ?? ""}|${startKey}|${endKey}`, eventId, recurringEventId, status,
    title: sanitizeTitle(raw.summary), startAt, endAt, allDay, startDate, endDate,
    startLocalDate: allDay ? startDate : localDate(startAt, timeZone), endLocalDate: allDay ? endDate : localDate(endAt, timeZone),
    description: String(raw.description ?? "").slice(0, 8192),
    timeZone, transparency: typeof raw.free_busy_status === "string" ? raw.free_busy_status.slice(0, 20) : null,
    recurrence, isException, updatedAt: null, etag: null, attachments,
    revision: jsonHash({ provider: CALENDAR_PROVIDER, eventId, recurringEventId, status, title: sanitizeTitle(raw.summary), startAt, endAt, startDate, endDate,
      description: String(raw.description ?? "").slice(0, 8192), recurrence, isException, freeBusy: raw.free_busy_status ?? null, attachments }),
  };
  return { event, malformed: false };
}

export async function readFeishuEvents(input: { accessToken: string; calendarId: string; timeMin: string; timeMax: string; maxResults?: number; calendarTimeZone?: string }, fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<FeishuEventPage> {
  const url = new URL(feishuEndpoints.events(input.calendarId));
  const startSeconds = Math.floor(Date.parse(input.timeMin) / 1000), endSeconds = Math.floor(Date.parse(input.timeMax) / 1000);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) throw new AppError("CALENDAR_WINDOW_INVALID", "日历读取窗口无效", 422);
  url.searchParams.set("start_time", String(startSeconds)); url.searchParams.set("end_time", String(endSeconds));
  url.searchParams.set("page_size", String(Math.max(CALENDAR_PAGE_SIZE, Math.min(1000, input.maxResults ?? CALENDAR_PAGE_SIZE))));
  const response = await fetcher(url.href, { redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } });
  const body = await readJson(response) as { code?: number; msg?: string; data?: { has_more?: boolean; page_token?: string; sync_token?: string; items?: Array<Record<string, unknown>> } };
  if (!response.ok || body.code !== 0) providerError(response.status, Number(body.code), String(body.msg ?? ""));
  if(!Array.isArray(body.data?.items))throw new AppError("CALENDAR_PROVIDER_FORMAT","飞书没有返回可核对的日程列表，不能当作空窗口",503);
  let malformedCount = 0; const events: CalendarEvent[] = [];
  const limit=Math.min(200,Math.max(1,input.maxResults??CALENDAR_PAGE_SIZE));
  for (const raw of body.data.items) {
    const normalized = normalizeFeishuEvent(raw, input.calendarTimeZone ?? defaultTimeZone());
    if (normalized.malformed || !normalized.event) { malformedCount++; continue; }
    if (events.length >= limit) break;
    events.push(normalized.event);
  }
  return { events, hasMore: body.data.has_more !== false || body.data.items.length > limit || body.data.items.length >= Number(url.searchParams.get("page_size")), pageToken: body.data?.page_token || null, syncToken: body.data?.sync_token || null, malformedCount, status: response.status };
}
