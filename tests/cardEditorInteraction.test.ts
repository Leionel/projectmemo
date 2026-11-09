// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardEditor } from "@/components/CardEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ id: "project" }),
}));

const card = {
  id: "card", type: "reflection", title: "完成实验核对", summary: "已核对实验记录和来源。",
  keywords: ["实验"], relatedTasks: [], nextActions: ["整理结果"], importance: 3,
  capture: { rawText: "已核对实验记录和来源。", sourceType: "实验记录" },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("确认来源成功后仍可归档同一张卡片", async () => {
  const fetch = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetch);
  const onArchived = vi.fn();
  render(createElement(CardEditor, { card, onArchived }));
  fireEvent.click(screen.getByRole("button", { name: "确认来源" }));
  await screen.findByText("已记录人工确认来源（来源声明，非事实证明）");
  const archive = screen.getByRole("button", { name: "归档" }) as HTMLButtonElement;
  expect(archive.disabled).toBe(false);
  fireEvent.click(archive);
  fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
  await waitFor(() => expect(onArchived).toHaveBeenCalledWith(card.title));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("确认来源失败后可以重试", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ error: { message: "暂时不可用" } }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({})));
  render(createElement(CardEditor, { card }));
  fireEvent.click(screen.getByRole("button", { name: "确认来源" }));
  await screen.findByText("暂时不可用");
  fireEvent.click(screen.getByRole("button", { name: "确认来源" }));
  await screen.findByText("已记录人工确认来源（来源声明，非事实证明）");
  expect((screen.getByRole("button", { name: "确认来源" }) as HTMLButtonElement).disabled).toBe(false);
});

it("仅修改行动复盘标题时，不要求补造关键词和下一步建议", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  vi.stubGlobal("fetch", fetch);
  render(createElement(CardEditor, { card: { ...card, keywords: [], nextActions: [], summary: "实验回执".repeat(100) } }));
  fireEvent.click(screen.getByRole("button", { name: "纠正卡片" }));
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: "核对后的复盘标题" } });
  fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));
  await screen.findByText("知识卡片已更新");
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ title: "核对后的复盘标题" });
});
