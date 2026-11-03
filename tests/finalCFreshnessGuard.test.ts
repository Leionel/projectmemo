// @vitest-environment jsdom
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissionReadback } from "@/components/MissionReadback";
import { MissionWorkPacket } from "@/components/MissionWorkPacket";
import type { MissionReadback as Readback } from "@/lib/mission/readback";

const now = Date.parse("2026-11-03T10:00:00Z");
function fixture() {
  const data = JSON.parse(readFileSync("evidence/final-a/20261103/samples/a2/a2-waiting-user.json", "utf8")).readback as Readback;
  data.readAt = new Date(now).toISOString();
  data.workPacket!.readAt = data.readAt;
  data.workPacket!.next.nextBoundary = null;
  data.workPacket!.authority.nextBoundary = null;
  data.workPacket!.authority.deadline = null;
  data.workPacket!.authority.permissionExpiresAt = null;
  data.workPacket!.next.primaryAction!.requires.boundaryAt = null;
  return data;
}
function ok(data: Readback) { return { ok: true, status: 200, json: async () => ({ readback: data }) }; }
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("原问题不在DOM时不跳到新问题，保留焦点并请求重读，不能提前声称已读成功", () => {
  const data = fixture(), reload = vi.fn();
  render(createElement("div", null,
    createElement("section", { id: "mission-question" }, createElement("div", { id: "mission-question-new" }, createElement("input", { "aria-label": "新问题" }))),
    createElement(MissionWorkPacket, { readback: data, packet: data.workPacket, missionId: data.missionId, onReload: reload })));
  const button = screen.getByRole("button", { name: "回答原问题" });
  button.focus(); fireEvent.click(button);
  expect(document.activeElement).toBe(button);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/已重新读取/)).toBeNull();
});

it("外层版本已推进而新读回仍在途时禁用旧包动作；正常重读不移动焦点", async () => {
  const data = fixture();
  const fetch = vi.fn().mockResolvedValueOnce(ok(data)).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetch);
  const view = render(createElement(MissionReadback, { missionId: data.missionId, missionVersion: 1 }));
  await flush();
  const button = screen.getByRole("button", { name: "回答原问题" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  const refresh = screen.getByRole("button", { name: "重新读取状态与回执" });
  refresh.focus();
  view.rerender(createElement(MissionReadback, { missionId: data.missionId, missionVersion: 2 }));
  expect(button.disabled).toBe(true);
  expect(document.activeElement).toBe(refresh);
});

it("工作包复核按钮只发起重读，不把异步请求描述为已经成功", () => {
  const data = fixture();
  data.workPacket!.snapshot.consistency = "VERSION_ADVANCED";
  const reload = vi.fn();
  render(createElement(MissionWorkPacket, { readback: data, packet: data.workPacket, missionId: data.missionId, onReload: reload }));
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("已重新读取当前状态")).toBeNull();
});

it("无新事件跨越边界即失效且只读重查；失败后切回标签页可恢复，过期回包不触发死循环", async () => {
  const data = fixture();
  data.workPacket!.next.nextBoundary = new Date(now + 1000).toISOString();
  let rejectPending: ((e: Error) => void) | undefined;
  const fetch = vi.fn().mockResolvedValueOnce(ok(data))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPending = reject; }))
    .mockResolvedValue(ok(data));
  vi.stubGlobal("fetch", fetch);
  render(createElement(MissionReadback, { missionId: data.missionId, missionVersion: 1 }));
  await flush();
  const primary = screen.getByRole("button", { name: "回答原问题" }) as HTMLButtonElement;
  expect(primary.disabled).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(primary.disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/有效边界已越过/)).toBeTruthy();
  await act(async () => rejectPending!(new Error("离线")));
  expect(screen.getByText(/离线/)).toBeTruthy();
  expect(primary.disabled).toBe(true);
  fireEvent(document, new Event("visibilitychange"));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(primary.disabled).toBe(true);
});

it("连发只读重查时迟到旧包不能覆盖最新包，后台重读不抢焦点", async () => {
  const data = fixture();
  let resolveOld: ((value: ReturnType<typeof ok>) => void) | undefined;
  const latest = structuredClone(data); latest.missionVersion = 3;
  latest.workPacket!.identity.missionVersion = 3;
  const fetch = vi.fn().mockResolvedValueOnce(ok(data))
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(ok(latest));
  vi.stubGlobal("fetch", fetch);
  render(createElement(MissionReadback, { missionId: data.missionId })); await flush();
  const refresh = screen.getByRole("button", { name: "重新读取状态与回执" });
  refresh.focus(); fireEvent.click(refresh); fireEvent(window, new Event("focus")); await flush();
  await act(async () => resolveOld!(ok(data))); await flush();
  expect(screen.getByText(/委托版本 3/)).toBeTruthy();
  expect(document.activeElement).toBe(refresh);
});
