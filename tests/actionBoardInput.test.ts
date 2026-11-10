// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionBoard } from "@/components/ActionBoard";

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
