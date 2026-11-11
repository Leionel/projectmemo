// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionBoard } from "@/components/ActionBoard";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import type { ActionItemData } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/motionHooks", () => ({ useListFlip: () => ({ current: null }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("中文输入法确认候选词时不提前创建行动", () => {
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  render(createElement(ActionBoard, { projectId: "project", initialActions: [] }));
  const title = screen.getByRole("textbox", { name: "新增行动标题" });
  fireEvent.change(title, { target: { value: "整理实验数据" } });
  fireEvent.keyDown(title, { key: "Enter", isComposing: true });
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(title, { key: "Enter", isComposing: false });
  expect(fetch).toHaveBeenCalledTimes(1);
});

function action(id: string, title = id): ActionItemData {
  return { id, projectId: "project", title, priority: 3, status: "TODO", isSimulated: false,
    createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

it("行动列表刷新乱序返回时保留最新结果", async () => {
  const older = deferredResponse(), newer = deferredResponse();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
  render(createElement(ActionBoard, { projectId: "project", initialActions: [action("a", "最初标题")] }));
  act(() => { emitWorkspaceChange("project", ["actions"]); emitWorkspaceChange("project", ["actions"]); });
  await act(async () => { newer.resolve(Response.json({ actions: [action("a", "更新后的标题")] })); });
  expect(screen.getByText("更新后的标题")).toBeTruthy();
  await act(async () => { older.resolve(Response.json({ actions: [action("a", "过期标题")] })); });
  expect(screen.queryByText("过期标题")).toBeNull();
  expect(screen.getByText("更新后的标题")).toBeTruthy();
});

it("切换行动完成表单时迟到的提醒询问不覆盖当前行动", async () => {
  const older = deferredResponse(), newer = deferredResponse();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
  render(createElement(ActionBoard, { projectId: "project", initialActions: [
    { ...action("a"), status: "DOING" }, { ...action("b"), status: "DOING" },
  ], reminderEnabled: true }));
  const buttons = screen.getAllByRole("button", { name: "完成并写回执" });
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  const prompt = (question: string) => Response.json({ state: { completionPrompt: {
    required: true, question, options: [{ value: "KEEP", label: "保留日程" }, { value: "REMOVE", label: "移除日程" }],
  } } });
  await act(async () => { newer.resolve(prompt("当前行动的日程如何处理？")); });
  expect(screen.getByText("当前行动的日程如何处理？")).toBeTruthy();
  await act(async () => { older.resolve(prompt("旧行动的日程如何处理？")); });
  expect(screen.getByText("当前行动的日程如何处理？")).toBeTruthy();
  expect(screen.queryByText("旧行动的日程如何处理？")).toBeNull();
});
