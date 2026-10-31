import { z } from "zod";
import { AppError } from "@/lib/api";
import { CALENDAR_SCOPE } from "./contracts";

export type FeishuCalendarEndpoints = {
  authorize: string; token: string; userinfo: string; calendarList: string; events: (calendarId: string) => string;
};
export const feishuEndpoints: FeishuCalendarEndpoints = {
  authorize: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
  token: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
  userinfo: "https://open.feishu.cn/open-apis/authen/v1/user_info",
  calendarList: "https://open.feishu.cn/open-apis/calendar/v4/calendars",
  events: calendarId => `https://open.feishu.cn/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
};
export type CalendarFetch = (url: string, init: RequestInit & { signal?: AbortSignal }) => Promise<Response>;

export function feishuCalendarConfig() {
  const clientId = process.env.FEISHU_CALENDAR_APP_ID?.trim(), clientSecret = process.env.FEISHU_CALENDAR_APP_SECRET?.trim();
  const redirectUri = process.env.FEISHU_CALENDAR_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) throw new AppError("CALENDAR_NOT_CONFIGURED", "服务端尚未配置飞书日历 OAuth", 503);
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new AppError("CALENDAR_NOT_CONFIGURED", "飞书 OAuth 回调地址格式不正确", 503); }
  if (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && ["127.0.0.1", "localhost"].includes(redirect.hostname)))
    throw new AppError("CALENDAR_NOT_CONFIGURED", "OAuth 回调必须是 HTTPS（开发环回除外）", 503);
  return { clientId, clientSecret, redirectUri: redirect.href };
}

const tokenSchema = z.object({ code: z.number().int(), msg: z.string().optional(), access_token: z.string().min(1).optional(), expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(), refresh_token_expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(), token_type: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }).passthrough();
export type FeishuToken = z.infer<typeof tokenSchema>;

async function postToken(body: Record<string, string>, fetcher: CalendarFetch, signal?: AbortSignal): Promise<FeishuToken> {
  const response = await fetcher(feishuEndpoints.token, { method: "POST", redirect: "error", signal: signal ?? AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text.slice(0, 65536)); } catch { throw new AppError("CALENDAR_OAUTH_FAILED", "飞书授权响应格式不正确", 503); }
  const parsed = tokenSchema.parse(value);
  if (!response.ok || parsed.code !== 0 || !parsed.access_token)
    throw new AppError(response.status === 429 ? "CALENDAR_RATE_LIMITED" : "CALENDAR_OAUTH_REJECTED", "飞书未完成本次日历授权，请重新连接", response.status === 429 ? 429 : 409,
      { providerStatus: response.status, providerCode: parsed.code });
  return parsed;
}

export function feishuAuthorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string; scope?: string }) {
  const url = new URL(feishuEndpoints.authorize);
  url.search = new URLSearchParams({ client_id: feishuCalendarConfig().clientId, response_type: "code", redirect_uri: input.redirectUri,
    scope: input.scope ?? CALENDAR_SCOPE, state: input.state, code_challenge: input.codeChallenge, code_challenge_method: "S256", prompt: "consent" }).toString();
  return url.href;
}
export async function exchangeFeishuCode(input: { code: string; codeVerifier: string; redirectUri: string }, fetcher: CalendarFetch = fetch, signal?: AbortSignal) {
  const { clientId, clientSecret } = feishuCalendarConfig();
  return postToken({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code: input.code,
    redirect_uri: input.redirectUri, code_verifier: input.codeVerifier }, fetcher, signal);
}
export async function refreshFeishuToken(refreshToken: string, fetcher: CalendarFetch = fetch, signal?: AbortSignal) {
  const { clientId, clientSecret } = feishuCalendarConfig();
  return postToken({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }, fetcher, signal);
}
export function assertFeishuCalendarScope(scope: string | undefined, mode: "READ" | "WRITE" = "READ") {
  const values = (scope ?? "").split(/\s+/).filter(Boolean);
  const required = mode === "WRITE" ? "calendar:calendar" : "calendar:calendar:readonly";
  if (!values.includes(required) || !values.includes("offline_access"))
    throw new AppError("CALENDAR_SCOPE_MISSING", mode === "WRITE" ? "飞书未授予日历写入权限，请重新授权" : "飞书未授予日历只读或离线访问权限，请重新连接", 409);
}
export async function readFeishuIdentity(accessToken: string, fetcher: CalendarFetch = fetch, signal?: AbortSignal) {
  const response = await fetcher(feishuEndpoints.userinfo, { redirect: "error", signal: signal ?? AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!response.ok) throw new AppError("CALENDAR_IDENTITY_UNAVAILABLE", "无法确认授权的飞书账号身份", 503, { providerStatus: response.status });
  const value = z.object({ code: z.number().int(), msg: z.string().optional(), data: z.object({ open_id: z.string().min(1), union_id: z.string().optional(),
    name: z.string().optional(), email: z.string().optional(), enterprise_email: z.string().optional() }).optional() }).passthrough().parse(await response.json());
  if (value.code !== 0 || !value.data?.open_id) throw new AppError("CALENDAR_IDENTITY_UNAVAILABLE", "飞书账号信息不完整", 503, { providerCode: value.code });
  return { accountId: value.data.open_id, name: value.data.name?.slice(0, 200) ?? "", email: (value.data.enterprise_email ?? value.data.email ?? "").slice(0, 320) };
}
