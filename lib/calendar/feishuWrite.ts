import { AppError } from "@/lib/api";
import { feishuEndpoints, type CalendarFetch } from "./feishuOAuth";
import { normalizeFeishuEvent } from "./feishuCalendar";
import type { CalendarEvent } from "./contracts";

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
export async function createFeishuCalendarEvent(input: { accessToken: string; calendarId: string; title: string; description: string; startAt: string; endAt: string; timeZone: string; idempotencyKey: string },
  fetcher: CalendarFetch = fetch, signal?: AbortSignal): Promise<CreatedCalendarEvent> {
  const startSeconds = Math.floor(Date.parse(input.startAt) / 1000), endSeconds = Math.floor(Date.parse(input.endAt) / 1000);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) throw new AppError("CALENDAR_WINDOW_INVALID", "日程时间无效", 422);
  const url = new URL(feishuEndpoints.events(input.calendarId));
  url.searchParams.set("idempotency_key", input.idempotencyKey.slice(0, 64));
  const response = await fetcher(url.href, { method: "POST", redirect: "error", signal: signal ?? AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify({ summary: input.title, description: input.description, start_time: { timestamp: String(startSeconds), timezone: input.timeZone },
      end_time: { timestamp: String(endSeconds), timezone: input.timeZone } }) });
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
