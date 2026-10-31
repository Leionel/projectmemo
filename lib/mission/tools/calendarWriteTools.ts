import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { jsonHash } from "@/lib/mission/contracts";
import { calendarEventBatchProposalSchema, calendarEventProposalSchema, CALENDAR_PROVIDER } from "@/lib/calendar/contracts";
import { fenced, type Lease } from "../runtimeStore";
import type { ToolSet } from "../tools";

export const CALENDAR_OPERATION_PREFIX = "PM-CAL";
/** Exact marker included in the user-approved description; the native idempotency key is derived from the same frozen payload. */
export const calendarOperationMarker = (input: { missionId: string; connectionId: string; title: string; description: string; startAt: string; endAt: string; timeZone: string;
  attendees: unknown[]; attachments: string[] }) =>
  `${CALENDAR_OPERATION_PREFIX}-${jsonHash(input).slice(0, 14)}`;

export function calendarWriteTools(lease: Lease): ToolSet {
  if (!isFeatureEnabled("CALENDAR_EVENT_WRITE_ENABLED", false)) return {};
  return {
    propose_calendar_event: {
      version: "1",
      description: "提出在已授权的飞书日历创建一个日程，等待用户逐项批准；本工具不写外部。只能使用已连接日历，不能指定任意账号、URL 或 token。可带参与人（飞书 open_id 或邮箱）与已上传的飞书 file_token 附件。",
      schema: calendarEventProposalSchema, effects: { businessWrite: false, cacheWrite: false, externalDisclosure: false },
      run: async (actor, raw) => {
        const input = calendarEventProposalSchema.parse(raw);
        const { mission, connection } = await db.$transaction(async tx => {
          const current = await fenced(tx, lease);
          const target = await tx.calendarConnection.findFirst({ where: { id: input.connectionId, projectId: current.projectId, ownerUserId: current.ownerUserId, status: "ACTIVE", revokedAt: null } });
          if (!target) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在、已撤销或不属于当前项目", 404);
          return { mission: current, connection: target };
        });
        const scopes = connection.scope.split(/\s+/);
        if (!scopes.includes("calendar:calendar") || !scopes.includes("offline_access"))
          throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "该连接只有只读权限，请先重新授权写入", 409);
        if (mission.constraintsJson && !(mission.constraintsJson as { externalWriteProposal?: boolean }).externalWriteProposal)
          throw new AppError("CONSTRAINT_BLOCKED", "当前委托未授权外部写入提案", 409);
        try { new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }); } catch { throw new AppError("CALENDAR_WINDOW_INVALID", "日程时区无效", 422); }
        const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
        if (!input.allDay && start < Date.now() + 60 * 1000) throw new AppError("CALENDAR_WINDOW_INVALID", "只能为至少 1 分钟后的时间创建日程", 422);
        if (!input.allDay && end - start > 24 * 60 * 60 * 1000) throw new AppError("CALENDAR_WINDOW_INVALID", "首个外部写只支持 24 小时内的定时日程", 422);
        const baseHash = jsonHash({ missionId: mission.id, connectionId: connection.id, title: input.title, description: input.description, startAt: input.startAt, endAt: input.endAt,
          timeZone: input.timeZone, allDay: input.allDay, recurrence: input.recurrence, attendees: input.attendees, attachments: input.attachments });
        const operationId = "pm-cal-" + baseHash.slice(0, 32);
        const marker = calendarOperationMarker({ missionId: mission.id, connectionId: connection.id, title: input.title, description: input.description,
          startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone, attendees: input.attendees, attachments: input.attachments });
        const finalDescription = `${input.description}${input.description ? "\n\n" : ""}ProjectMemo 操作标记：${marker}`.slice(0, 500);
        const payload = { title: input.title, description: finalDescription, startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone, allDay: input.allDay,
          recurrence: input.recurrence, attendees: input.attendees, attachments: input.attachments };
        const queryStart = input.allDay ? `${input.startAt}T00:00:00Z` : new Date(start - 60 * 60 * 1000).toISOString();
        const queryEnd = input.allDay ? `${input.endAt}T23:59:59Z` : new Date(end + 60 * 60 * 1000).toISOString();
        return { data: { connectionId: connection.id, operationId,
          target: { provider: CALENDAR_PROVIDER, accountId: connection.accountId, accountEmail: connection.accountEmail, accountName: connection.accountName,
            calendarId: connection.calendarId, calendarSummary: connection.calendarSummary, calendarTimeZone: connection.calendarTimeZone,
            connectionRevision: connection.revision, authGeneration: connection.authGeneration, scope: connection.scope },
          payload, payloadHash: jsonHash(payload), marker, effectQuery: { kind: "CALENDAR_EVENT_BY_ID_OR_MARKER", marker, timeMin: queryStart, timeMax: queryEnd } }, sources: [] };
      },
    },
    propose_calendar_events: {
      version: "1",
      description: "提出在已授权的飞书日历批量创建 2-10 个日程，等待用户逐项批准；失败按冻结批准范围逐项核对补偿；不是跨平台原子回滚。只能使用已连接日历。",
      schema: calendarEventBatchProposalSchema, effects: { businessWrite: false, cacheWrite: false, externalDisclosure: false },
      run: async (actor, raw) => {
        const input = calendarEventBatchProposalSchema.parse(raw);
        const { mission, connection } = await db.$transaction(async tx => {
          const current = await fenced(tx, lease);
          const target = await tx.calendarConnection.findFirst({ where: { id: input.connectionId, projectId: current.projectId, ownerUserId: current.ownerUserId, status: "ACTIVE", revokedAt: null } });
          if (!target) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在、已撤销或不属于当前项目", 404);
          return { mission: current, connection: target };
        });
        const scopes = connection.scope.split(/\s+/);
        if (!scopes.includes("calendar:calendar") || !scopes.includes("offline_access"))
          throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "该连接只有只读权限，请先重新授权写入", 409);
        if (mission.constraintsJson && !(mission.constraintsJson as { externalWriteProposal?: boolean }).externalWriteProposal)
          throw new AppError("CONSTRAINT_BLOCKED", "当前委托未授权外部写入提案", 409);
        const target = { provider: CALENDAR_PROVIDER, accountId: connection.accountId, accountEmail: connection.accountEmail, accountName: connection.accountName,
          calendarId: connection.calendarId, calendarSummary: connection.calendarSummary, calendarTimeZone: connection.calendarTimeZone,
          connectionRevision: connection.revision, authGeneration: connection.authGeneration, scope: connection.scope };
        const batchHash = jsonHash({ missionId: mission.id, connectionId: connection.id, events: input.events });
        const operationId = "pm-cal-b-" + batchHash.slice(0, 32);
        const events = input.events.map((event, index) => {
          try { new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone }); } catch { throw new AppError("CALENDAR_WINDOW_INVALID", "日程时区无效", 422); }
          const start = Date.parse(event.startAt), end = Date.parse(event.endAt);
          if (!event.allDay && start < Date.now() + 60 * 1000) throw new AppError("CALENDAR_WINDOW_INVALID", "只能为至少 1 分钟后的时间创建日程", 422);
          if (!event.allDay && end - start > 24 * 60 * 60 * 1000) throw new AppError("CALENDAR_WINDOW_INVALID", "单个定时日程最多 24 小时", 422);
          const itemHash = jsonHash({ missionId: mission.id, connectionId: connection.id, index, event });
          const itemOperationId = operationId + "-" + (index + 1);
          const marker = calendarOperationMarker({ missionId: mission.id, connectionId: connection.id, title: event.title, description: event.description,
            startAt: event.startAt, endAt: event.endAt, timeZone: event.timeZone, attendees: event.attendees, attachments: event.attachments });
          const finalDescription = `${event.description}${event.description ? "\n\n" : ""}ProjectMemo 操作标记：${marker}`.slice(0, 500);
          const payload = { ...event, description: finalDescription };
          const queryStart = event.allDay ? `${event.startAt}T00:00:00Z` : new Date(start - 60 * 60 * 1000).toISOString();
          const queryEnd = event.allDay ? `${event.endAt}T23:59:59Z` : new Date(end + 60 * 60 * 1000).toISOString();
          return { index, operationId: itemOperationId, itemHash, marker, payload, payloadHash: jsonHash(payload),
            effectQuery: { kind: "CALENDAR_EVENT_BY_ID_OR_MARKER", marker, timeMin: queryStart, timeMax: queryEnd } };
        });
        return { data: { connectionId: connection.id, operationId, batchHash, target, events }, sources: [] };
      },
    },
  };
}
