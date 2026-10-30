import type { ConversationSource } from "@/lib/types/conversation";
export function CalendarSourceView({ source }: { source: ConversationSource }) {
  const calendar = source.calendar;
  if (!calendar) return null;
  const when = calendar.allDay ? `${calendar.startDate ?? ""} 至 ${calendar.endDate ?? ""}（全天）`
    : `${calendar.startAt?.slice(0, 16).replace("T", " ") ?? ""} → ${calendar.endAt?.slice(0, 16).replace("T", " ") ?? ""}（${calendar.timeZone ?? "未知时区"}）`;
  return <>
    <p className="mt-3 text-sm">飞书日历只读 · {calendar.accountName || calendar.accountEmail} · {calendar.calendarSummary || calendar.calendarId}</p>
    <p className="mt-2 text-sm">{when} · {calendar.eventStatus}{calendar.recurrence ? ` · 重复规则 ${calendar.recurrence}` : ""}{calendar.isException ? " · 重复例外" : ""}{calendar.transparency ? ` · ${calendar.transparency}` : ""}</p>
    <pre className="my-6 whitespace-pre-wrap break-words font-sans leading-8">{source.excerpt}</pre>
    <p className="text-sm text-ink-secondary">窗口 {calendar.window.start.slice(0, 16).replace("T", " ")} → {calendar.window.end.slice(0, 16).replace("T", " ")} · {calendar.window.complete ? "本次窗口已枚举" : "本次窗口未完整读取，不能当作全局无冲突"}{calendar.window.truncated ? " · 仍有更多日程" : ""}{calendar.window.malformedCount ? ` · ${calendar.window.malformedCount} 项缺少可解析时间` : ""}</p>
  </>;
}
