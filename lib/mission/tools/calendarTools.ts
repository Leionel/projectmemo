import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { readCalendarWindow } from "@/lib/services/calendarConnectionService";
import { CALENDAR_PROVIDER, calendarWindowInputSchema } from "@/lib/calendar/contracts";
import type { Source } from "../contracts";
import { fenced, reserveCalendar, settleCalendarUsage, type Lease } from "../runtimeStore";
import type { ToolSet } from "../tools";

const CALENDAR_HTTP_RESERVATION = 3;
const schema = calendarWindowInputSchema;
export type CalendarDependencies = { fetcher?: typeof fetch };
export function calendarTools(lease: Lease, deps: CalendarDependencies = {}): ToolSet {
  if (!isFeatureEnabled("CALENDAR_CONNECTIONS_ENABLED", false)) return {};
  return {
    calendar_read: {
      version: "1",
      description: "只读已连接的飞书日历在限定时间窗口内的日程，用于核对项目期限或时间冲突。仅返回窗口内可见字段；重复规则、取消与例外事件保留原状态，窗口不完整时不能当作全局无冲突。",
      schema, effects: { businessWrite: false, cacheWrite: false, externalDisclosure: true },
      run: async (actor, raw) => {
        const input = schema.parse(raw);
        const { mission } = await db.$transaction(async tx => ({ mission: await fenced(tx, lease) }));
        const connection = await db.calendarConnection.findFirst({ where: { id: input.connectionId, projectId: mission.projectId, ownerUserId: mission.ownerUserId, status: "ACTIVE", revokedAt: null } });
        if (!connection) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在、已撤销或不属于当前项目", 404);
        await reserveCalendar(lease, CALENDAR_HTTP_RESERVATION);
        const read = await readCalendarWindow(mission.ownerUserId, { ...input, projectId: mission.projectId }, { missionId: mission.id, fetcher: deps.fetcher });
        await settleCalendarUsage(lease, CALENDAR_HTTP_RESERVATION, read.httpRequests);
        const sources: Source[] = read.sources.map(source => ({ id: "calendar:" + source.observationId, kind: "EXTERNAL", entityType: "EXTERNAL_SOURCE",
          revision: source.meta.eventRevision, hash: source.meta.eventRevision, identityKey: "calendar:" + read.result.calendarId, text: source.excerpt,
          observedAt: source.meta.observedAt, knowledgeClass: "EXTERNAL_REFERENCE", temporalState: "UNKNOWN", calendar: source.meta }));
        return { data: { provider: CALENDAR_PROVIDER, connectionId: read.connection.id, calendarId: read.result.calendarId, calendarSummary: read.result.calendarSummary,
          coverage: read.result.coverage, httpRequests: read.httpRequests }, sources,
          coverage: { complete: read.result.coverage.complete, description: `飞书日历窗口读取；${read.result.coverage.truncated ? "窗口内仍有更多日程，未读取部分不能当作不存在" : "窗口内日程已枚举"}${read.result.coverage.malformedCount ? `；${read.result.coverage.malformedCount} 项缺少可解析时间` : ""}` } };
      },
    },
  };
}
