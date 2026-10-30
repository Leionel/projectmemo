// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { ClaimCorrection } from "@/components/ClaimCorrection";
import { clearConversationDrafts } from "@/lib/client/conversationDrafts";
const props = { projectId: "p", kind: "MESSAGE" as const, sourceId: "m" };
const source = { kind: "MESSAGE", id: "m", text: "延迟52ms😀，尚未实测", contentHash: "a".repeat(64), offsetEncoding: "UTF16_CODE_UNITS", normalization: "RAW_V1" };
const controls = { ownerUserId: "owner", seq: 3, heads: [], reusePolicyHash: "reuse", nextBoundary: null };
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
afterEach(() => { cleanup(); clearConversationDrafts(); vi.unstubAllGlobals(); });
function open(container: HTMLElement) {
  const details = container.querySelector("details")!; details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: true }));
}
test("精确原文选择与丢回包后的重挂载，重放同一请求和原版本", async () => {
  const calls: unknown[] = [], changed = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      calls.push(JSON.parse(String(options.body)));
      if (calls.length === 1) throw new Error("回包丢失");
      return response({ claimId: "original", revision: 1 });
    }
    return response(url.includes("?kind=") ? source : controls);
  }));
  const first = render(createElement(ClaimCorrection, { ...props, onChanged: changed })); open(first.container);
  const original = await screen.findByRole("textbox", { name: "选择需要纠正的原文" }) as HTMLTextAreaElement;
  original.setSelectionRange(0, 8); fireEvent.select(original);
  fireEvent.change(screen.getByRole("textbox", { name: "应怎样理解" }), { target: { value: "这是自报，还未测量" } });
  fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));
  await screen.findByText("回包丢失"); first.unmount();
  const second = render(createElement(ClaimCorrection, { ...props, onChanged: changed })); open(second.container);
  await screen.findByRole("textbox", { name: "选择需要纠正的原文" });
  await waitFor(() => expect(screen.getByRole("button", { name: "核对原次提交" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "核对原次提交" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]).toMatchObject({ expectedSeq: 3, origin: { start: 0, end: 8, quote: source.text.slice(0, 8) } });
});
test("原文不可读时仍可撤回历史纠正，不将历史内容伪装成当前原文", async () => {
  const calls: unknown[] = [], changed = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") { calls.push(JSON.parse(String(options.body))); return response({}); }
    if (url.includes("?kind=")) return { ok: false, status: 404, json: async () => ({ error: { message: "原文已删除" } }) };
    return response({ ...controls, heads: [{ claimId: "c", revision: 2, origin: { ...source, text: undefined, start: 0, end: 8, quote: source.text.slice(0, 8) }, active: true, userQuote: "仅为自报" }] });
  }));
  const view = render(createElement(ClaimCorrection, { ...props, onChanged: changed })); open(view.container);
  const button = await screen.findByRole("button", { name: "撤回这次纠正" });
  fireEvent.click(button); await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(calls[0]).toMatchObject({ operation: "WITHDRAW", expectedSeq: 3, expectedRevision: 2 });
  expect(screen.queryByRole("textbox", { name: "选择需要纠正的原文" })).toBeNull();
});
