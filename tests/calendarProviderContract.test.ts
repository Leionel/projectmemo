import { expect, it, vi } from "vitest";
import { listFeishuCalendarAttendees } from "@/lib/calendar/feishuWrite";
import { normalizeFeishuEvent,readFeishuEvents } from "@/lib/calendar/feishuCalendar";
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const target = { accessToken: "synthetic-not-a-real-token", calendarId: "fixture-calendar", eventId: "fixture-event" };
it("参与人分页必须完整，循环游标不能冒充完整名单", async () => {
  const fetcher = vi.fn(async (url: string) => new URL(url).searchParams.has("page_token")
    ? response({ items: [{ type: "third_party", third_party_email: "b@example.com" }], has_more: false })
    : response({ items: [{ type: "third_party", third_party_email: "a@example.com" }], has_more: true, page_token: "next" }));
  expect((await listFeishuCalendarAttendees(target, fetcher)).map(row => row.email)).toEqual(["a@example.com", "b@example.com"]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const cyclic = vi.fn(async () => response({ items: [], has_more: true, page_token: "same" }));
  await expect(listFeishuCalendarAttendees(target, cyclic)).rejects.toMatchObject({ code: "CALENDAR_ATTENDEE_INCOMPLETE" });
  expect(cyclic).toHaveBeenCalledTimes(2);
});
it("未知状态不能归一化成confirmed", () => {
  const raw = { event_id: "fixture", summary: "日程", status: "unknown-new-state", start_time: { timestamp: "1793584800" }, end_time: { timestamp: "1793588400" } };
  expect(normalizeFeishuEvent(raw, "Asia/Shanghai")).toEqual({ event: null, malformed: true });
});

it("缺失列表不能当空窗口，客户端截断与到达provider上限不当完整覆盖",async()=>{
 const input={accessToken:"fixture",calendarId:"fixture",timeMin:"2026-11-02T01:00:00Z",timeMax:"2026-11-02T04:00:00Z",maxResults:1};
 await expect(readFeishuEvents(input,async()=>response({has_more:false}))).rejects.toMatchObject({code:"CALENDAR_PROVIDER_FORMAT"});
 const event={event_id:"a",summary:"日程",start_time:{timestamp:"1793584800"},end_time:{timestamp:"1793588400"}};
 const read=await readFeishuEvents(input,async()=>response({has_more:false,items:[event,{...event,event_id:"b"}]}));expect(read.events).toHaveLength(1);expect(read.hasMore).toBe(true);
 const full=await readFeishuEvents({...input,maxResults:50},async()=>response({has_more:false,items:Array.from({length:50},(_,i)=>({...event,event_id:String(i)}))}));expect(full.hasMore).toBe(true);
});
