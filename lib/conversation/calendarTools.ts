import {sourceUse} from "@/lib/continuity/sourcePolicy";
import {assertTurnCurrent} from "@/lib/continuity/turnCoordination";
import {currentGeneration,generationCallId} from "./turnRuntime";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { calendarToolSchemas } from "@/lib/calendar/contracts";
import { readCalendarWindow } from "@/lib/services/calendarConnectionService";
import { assertProject, record } from "./repository";
import { mutateTurn, turnOperation } from "./turnRuntime";
import type { ConversationActor, ConversationSource } from "@/lib/types/conversation";
import type { z } from "zod";

type CalendarCall = z.infer<(typeof calendarToolSchemas)[number]>;
const MAX_CALENDAR_CONTEXT_CHARS = 20000;

export async function readConversationCalendarTool(actor: ConversationActor, conversationId: string, turnId: string, operationId: string, raw: unknown, fetcher: typeof fetch = fetch) {
  const call = calendarToolSchemas[0].parse(raw) as CalendarCall;
  await assertProject(actor, call.projectId);
  const observed = await turnOperation(actor, conversationId, turnId, operationId, "CALENDAR_READ",
    { connectionId: call.connectionId, timeMin: call.timeMin, timeMax: call.timeMax, maxResults: call.maxResults }, async () => {
      const result = await readCalendarWindow(actor.userId, { projectId: call.projectId, connectionId: call.connectionId, timeMin: call.timeMin,
        timeMax: call.timeMax, maxResults: call.maxResults }, { conversationTurnId: turnId, fetcher,beforeRequest:async()=>{
        await mutateTurn(actor,conversationId,turnId,async(manifest,tx)=>{
          await assertTurnCurrent(await tx.conversationTurn.findUniqueOrThrow({where:{id:turnId}}),actor.userId,currentGeneration(),tx,"EXTERNAL_READ");
          const operations=record(manifest.operations),id=generationCallId(operationId),operation=record(operations[id]);
          const count=Object.values(operations).filter(o=>record(o).kind==="CALENDAR_READ"&&!record(o).reusedFrom).reduce<number>((n,o)=>n+Number(record(o).requestUnits??0),0);
          if(count>=6)throw new AppError("CALENDAR_TURN_LIMIT","本轮日历累计HTTP额度已用完",409);
          return {...manifest,operations:{...operations,[id]:{...operation,requestUnits:Number(operation.requestUnits??0)+1}}};
        });
      } });
      return { sources: result.sources, coverage: result.result.coverage, httpRequests: result.httpRequests, connection: result.connection };
    }, true, operations => {
      const reads = Object.values(operations).filter(operation => operation.kind === "CALENDAR_READ");
      if (reads.length >= 2) throw new AppError("CALENDAR_TURN_LIMIT", "本轮最多执行两次日历窗口读取", 409);
      const requests = reads.reduce((total, operation) => total + (Number((operation.result as { httpRequests?: number } | undefined)?.httpRequests) || 0), 0);
      if (requests >= 6) throw new AppError("CALENDAR_TURN_LIMIT", "本轮日历请求额度已用完", 409);
    });
  for(const source of observed.sources)if((await sourceUse(actor.userId,call.projectId,"calendar:"+source.observationId,db,{conversationId})).state!=="ALLOWED")throw new AppError("SOURCE_SUPPRESSED","原日历观察已撤回或过期，请重新调查",409);
  const sources: ConversationSource[] = observed.sources.map(source => {
    const excerpt = source.excerpt.slice(0, 3000);
    return { id: call.projectId + "/calendar:" + source.observationId, projectId: call.projectId, sourceId: "calendar:" + source.observationId,
      revision: source.meta.eventRevision, title: source.title.slice(0, 300), excerpt, observedAt: source.meta.observedAt, temporalState: "UNKNOWN",
      knowledgeClass: "EXTERNAL_REFERENCE", start: 0, end: excerpt.length, excerptHash: jsonHash(excerpt), readScope: "STRUCTURED", calendar: { ...source.meta, conversationId, turnId } };
  });
  await mutateTurn(actor, conversationId, turnId, manifest => {
    const old = (manifest.webSources ?? []) as ConversationSource[];
    const next = [...new Map([...old, ...sources].map(source => [source.sourceId, source])).values()];
    if (next.length > 24 || next.reduce((total, source) => total + source.excerpt.length, 0) > MAX_CALENDAR_CONTEXT_CHARS + 4000)
      throw new AppError("CONTEXT_LIMIT", "本轮日历与网页来源达到容量上限", 409);
    return { ...manifest, webSources: next };
  });
  const current = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
  const manifest = record(current.readManifestJson);
  const stopRequested = manifest.stopRequested === true;
  if (stopRequested) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
  return { data: { sources, calendar: { connection: observed.connection, coverage: observed.coverage, httpRequests: observed.httpRequests } }, sources,
    coverage: { complete: observed.coverage.complete, description: `飞书日历窗口读取；${observed.coverage.truncated ? "窗口内仍有更多日程，未读取部分不能当作不存在" : "窗口内日程已枚举"}${observed.coverage.malformedCount ? `；${observed.coverage.malformedCount} 项缺少可解析时间` : ""}` },
    discovered: [] };
}
