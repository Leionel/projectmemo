// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ConversationPanel", () => ({ ConversationPanel: () => createElement("div", null, "验收讨论区域") }));
import { FocusAgentWorkspace } from "@/components/FocusAgentWorkspace";
import { readableProjectNotice } from "@/lib/projectNotice";
import type { GlobalFocus } from "@/lib/types/globalFocus";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("零项筛选说明真实原因并可恢复，不用空白卡片或悬浮入口遮挡内容", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, projected: 0, discussions: [] }) })));
  const focus = { schemaVersion: 1, missionEnabled: true, archived: false, hasMore: false, primaryContext: null, discussions: [], counts: { waiting: 0, running: 0, actions: 0, reminders: 1 }, waiting: [], running: [], actions: [], records: [],
    reminders: [{ id: "r", projectId: "p", projectTitle: "验收项目", title: "核对原始依据", detail: "目前缺少验证结果", status: "OPEN" }] } as unknown as GlobalFocus;
  render(createElement(FocusAgentWorkspace, { focus }));
  await waitFor(() => expect(screen.getByText("验收讨论区域")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "待回应 0" }));
  expect(screen.getByRole("status").textContent).toContain("目前没有等待你回应的委托");
  fireEvent.click(screen.getByRole("button", { name: "查看全部事项" }));
  expect(screen.getByRole("button", { name: "全部" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("heading", { name: "核对原始依据" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "问忆程，打开项目协作对话" })).toBeNull();
});
it("生成的缺口列表显示中文类别，原始文本与其他英文资料名保持原样", () => {
  const original = "目前尚缺少：paper_note、reflection。建议补充记录。";
  const shown = readableProjectNotice(original);
  expect(shown).not.toMatch(/paper_note|reflection/);
  expect(shown).toContain("目前尚缺少：");
  expect(original).toBe("目前尚缺少：paper_note、reflection。建议补充记录。");
  expect(readableProjectNotice("请打开 paper_note.md 核对 requirement 字段")).toBe("请打开 paper_note.md 核对 requirement 字段");
  expect(readableProjectNotice("目前尚缺少：custom_type。" )).toBe("目前尚缺少：custom_type。");
});
