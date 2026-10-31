import { AppError } from "@/lib/api";
import { feishuEndpoints, type CalendarFetch } from "./feishuOAuth";
import { normalizeFeishuEvent } from "./feishuCalendar";
import type { CalendarAttendee, CalendarEvent } from "./contracts";

export type CreatedCalendarEvent = { eventId: string; event: CalendarEvent | null };
async function body(response: Response): Promise<Record<string, unknown>> {
  try { return JSON.parse((await response.text()).slice(0, 262144)) as Record<string, unknown>; }
  catch { throw new AppError("CALENDAR_PROVIDER_FORMAT", "飞书日历返回格式不正确", 503); }
}
function failure(status: number, code: number, message: string): never {
  if (status === 401 || code === 99991663 || code === 20005) throw new AppError("CALENDAR_TOKEN_EXPIRED", "飞书日历授权已失效，请重新连接", 401);
  if ([190004, 190005, 190010].includes(code) || status === 429) throw new AppError("CALENDAR_WRITE_REJECTED", "飞书限流，本次请求未确认创建；不会自动重发", 429);
  if ([191000, 191001, 191002, 191003, 191004].includes(code)) throw new AppError("CALENDAR_WRITE_REJECTED", "当前账号已没有该日历的写入权限", 409);
  if (status >= 500) throw new AppError("CALENDAR_WRITE_UNKNOWN", "飞书写入结果未知，不能当作失败后重发", 503);
  throw new AppError("CALENDAR_WRITE_REJECTED", (message.slice(0, 160) || "飞书拒绝了本次日程创建"), 409);
}

/** Feishu v4 create event supports a native idempotency key in the query string; it is unique per app+calendar. */
export async function createFeishuCalendarEvent(input: { accessToken: string; calendarId: string; title: string; description: string; startAt: string; endAt: string; timeZone: string;
  allDay?: boolean; recurrence?: string | null; attachments?: string[]; idempotencyKey: string }, fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<CreatedCalendarEvent> {
  const startSeconds = Math.floor(Date.parse(input.startAt) / 1000), endSeconds = Math.floor(Date.parse(input.endAt) / 1000);
  if (!input.allDay && (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds))) throw new AppError("CALENDAR_WINDOW_INVALID", "日程时间无效", 422);
  const url = new URL(feishuEndpoints.events(input.calendarId));
  url.searchParams.set("idempotency_key", input.idempotencyKey.slice(0, 64));
  const response = await fetcher(url.href, { method: "POST", redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify({ summary: input.title, description: input.description,
      start_time: input.allDay ? { date: input.startAt } : { timestamp: String(startSeconds), timezone: input.timeZone },
      end_time: input.allDay ? { date: input.endAt } : { timestamp: String(endSeconds), timezone: input.timeZone },
      ...(input.recurrence ? { recurrence: input.recurrence } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments.map(fileToken => ({ file_token: fileToken })) } : {}) }) });
  const parsed = await body(response), code = Number(parsed.code ?? 0);
  if (!response.ok || code !== 0) failure(response.status, code, String(parsed.msg ?? ""));
  const data = parsed.data as { event?: Record<string, unknown> } | undefined, eventId = String(data?.event?.event_id ?? "");
  if (!eventId) throw new AppError("CALENDAR_WRITE_UNKNOWN", "飞书返回成功但缺少日程身份，结果待核对", 503);
  return { eventId, event: data?.event ? normalizeFeishuEvent(data.event, input.timeZone).event : null };
}

/** Readback by provider identity; a 2xx create is never treated as success without this check. */
export async function getFeishuCalendarEvent(input: { accessToken: string; calendarId: string; eventId: string; timeZone: string }, fetcher: CalendarFetch = fetch, signal?: AbortSignal) {
  const response = await fetcher(`${feishuEndpoints.events(input.calendarId)}/${encodeURIComponent(input.eventId)}`, { redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } });
  const parsed = await body(response), code = Number(parsed.code ?? 0);
  if (!response.ok || code !== 0) {
    if (response.status === 404 || code === 191000) throw new AppError("CALENDAR_EFFECT_NOT_FOUND", "飞书没有找到本次写入的日程", 404);
    failure(response.status, code, String(parsed.msg ?? ""));
  }
  const event = (parsed.data as { event?: Record<string, unknown> } | undefined)?.event;
  if (!event) throw new AppError("CALENDAR_EFFECT_UNREADABLE", "飞书日程回读缺少对象", 503);
  const normalized = normalizeFeishuEvent(event, input.timeZone);
  if (normalized.malformed || !normalized.event) throw new AppError("CALENDAR_EFFECT_UNREADABLE", "飞书日程回读时间无法解析", 503);
  return normalized.event;
}

export type FeishuEventAttendee = { type: string; userId: string | null; email: string | null; rsvpStatus: string | null };
function attendeePayload(attendees: CalendarAttendee[]) {
  return attendees.map(item => item.type === "open_id"
    ? { type: "user", user_id: item.openId }
    : { type: "third_party", third_party_email: item.email });
}
function attendeeOf(raw: Record<string, unknown>): FeishuEventAttendee {
  return { type: String(raw.type ?? "").slice(0, 20), userId: typeof raw.user_id === "string" ? raw.user_id.slice(0, 200) : null,
    email: typeof raw.third_party_email === "string" ? raw.third_party_email.slice(0, 320) : null,
    rsvpStatus: typeof raw.rsvp_status === "string" ? raw.rsvp_status.slice(0, 20) : null };
}

/** Add invitees after creation; Feishu's create endpoint does not accept attendees. */
export async function addFeishuCalendarAttendees(input: { accessToken: string; calendarId: string; eventId: string; attendees: CalendarAttendee[]; needNotification?: boolean },
  fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<FeishuEventAttendee[]> {
  const url = new URL(`${feishuEndpoints.events(input.calendarId)}/${encodeURIComponent(input.eventId)}/attendees`);
  url.searchParams.set("user_id_type", "open_id");
  const response = await fetcher(url.href, { method: "POST", redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify({ attendees: attendeePayload(input.attendees), need_notification: input.needNotification ?? false }) });
  const parsed = await body(response), code = Number(parsed.code ?? 0);
  if (!response.ok || code !== 0) failure(response.status, code, String(parsed.msg ?? ""));
  const rows = (parsed.data as { attendees?: Array<Record<string, unknown>> } | undefined)?.attendees;
  return Array.isArray(rows) ? rows.map(attendeeOf) : [];
}

export async function listFeishuCalendarAttendees(input: { accessToken: string; calendarId: string; eventId: string },
  fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<FeishuEventAttendee[]> {
  const url = new URL(`${feishuEndpoints.events(input.calendarId)}/${encodeURIComponent(input.eventId)}/attendees`);
  url.searchParams.set("page_size", "100"); url.searchParams.set("user_id_type", "open_id");
  const response = await fetcher(url.href, { redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } });
  const parsed = await body(response), code = Number(parsed.code ?? 0);
  if (!response.ok || code !== 0) failure(response.status, code, String(parsed.msg ?? ""));
  const rows = (parsed.data as { items?: Array<Record<string, unknown>> } | undefined)?.items;
  return Array.isArray(rows) ? rows.map(attendeeOf) : [];
}

/** Provider-side delete used only as batch compensation; a missing event counts as already removed. */
export async function deleteFeishuCalendarEvent(input: { accessToken: string; calendarId: string; eventId: string; needNotification?: boolean },
  fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<{ deleted: boolean }> {
  const url = new URL(`${feishuEndpoints.events(input.calendarId)}/${encodeURIComponent(input.eventId)}`);
  url.searchParams.set("need_notification", String(input.needNotification ?? false));
  const response = await fetcher(url.href, { method: "DELETE", redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } });
  if (response.status === 404) return { deleted: false };
  const parsed = await body(response), code = Number(parsed.code ?? 0);
  if (code === 191000 || code === 193003) return { deleted: false };
  if (!response.ok || code !== 0) failure(response.status, code, String(parsed.msg ?? ""));
  return { deleted: true };
}
