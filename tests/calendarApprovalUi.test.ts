// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarEventApproval } from "@/components/CalendarEventApproval";
import { validCalendarRecurrence } from "@/lib/calendar/contracts";
afterEach(cleanup);
const payload = { title: "项目讨论", description: "完整外发内容 [pm:frozen]", startAt: "2026-11-02T02:00:00Z", endAt: "2026-11-02T02:30:00Z", timeZone: "Asia/Shanghai",
  attendees: [{ type: "email", email: "teammate@example.com" }], attachments: ["file-token-1"], recurrence: "FREQ=WEEKLY;BYDAY=MO;COUNT=4" };
it("审批显示真实本地时间与外发对象；批次逐项描述可见，旧提案不增加删除许可", () => {
  const proposal = { tool: "create_calendar_events", target: { accountName: "验收账号", calendarSummary: "验收日历" }, events: [{ index: 0, payload }, { index: 1, payload: { ...payload, title: "第二项", description: "第二项完整外发内容" } }] };
  render(createElement(CalendarEventApproval, { approval: { id: "a", proposalHash: "h", expiresAt: "2026-11-02T00:00:00Z", proposal }, checkedAt: Date.parse("2026-11-01T00:00:00Z"), busy: false, onDecision: vi.fn() }));
  expect(screen.getAllByText(/10:00/).length).toBe(2);
  expect(screen.getByText(payload.description)).toBeTruthy();
  expect(screen.getByText("第二项完整外发内容")).toBeTruthy();
  expect(screen.getAllByText(/teammate@example.com/).length).toBe(2);
  expect(screen.getAllByText(/file-token-1/).length).toBe(2);
  expect(screen.getByText("本提案不包含自动删除许可。")).toBeTruthy();
});
it("重复规则保留有界与无截止重复能力，同时拒绝矛盾、无效日期和条件注入", () => {
  for (const rule of ["FREQ=WEEKLY;BYDAY=MO", "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4", "FREQ=YEARLY;BYMONTH=2;UNTIL=20280229T235959Z"]) expect(validCalendarRecurrence(rule)).toBe(true);
  for (const rule of ["FREQ=WEEKLY;COUNT=0", "FREQ=DAILY;COUNT=3;UNTIL=20271101", "FREQ=YEARLY;UNTIL=20270230", "FREQ=WEEKLY;BYDAY=XX", "FREQ=DAILY;FREQ=WEEKLY", "FREQ=DAILY;ENDPOINT=https://evil.test"]) expect(validCalendarRecurrence(rule)).toBe(false);
});
