// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageToolbar } from "@/components/MessageToolbar";
import type { ConversationMessage } from "@/lib/types/conversation";

afterEach(cleanup);

function message(role = "ASSISTANT"): ConversationMessage {
  return { schemaVersion: 1, id: "message", seq: 1, role, content: "合成消息", restricted: false,
    refs: [], sources: [], priorities: [], proposal: null, provider: "rules", limitations: [], observedProjectIds: [] };
}

it("图标工具栏保留可访问名称、数量和各项点击操作", () => {
  const callbacks = { onSources: vi.fn(), onBasis: vi.fn(), onCorrect: vi.fn(), onAsk: vi.fn(), onMemory: vi.fn() };
  render(createElement(MessageToolbar, { message: { ...message(), memoryUse: { items: [{
    kind: "PERSONAL", id: "memory", projectId: null, title: "测试偏好", stateLabel: "有效", active: true, changedSince: false,
  }] } }, sourceCount: 4, showBasis: true, basisOpen: true, memoryOpen: false, canCorrect: true, busy: false, ...callbacks }));
  for (const [name, callback] of [
    [/资料 4/, callbacks.onSources], [/判断依据/, callbacks.onBasis], [/记忆 1/, callbacks.onMemory],
    [/纠正/, callbacks.onCorrect], [/追问/, callbacks.onAsk],
  ] as const) {
    const button = screen.getByRole("button", { name });
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    expect(callback).toHaveBeenCalledOnce();
  }
  expect(screen.getByRole("button", { name: "判断依据" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "记忆 1" }).getAttribute("aria-expanded")).toBe("false");
});

it("用户消息用铅笔图标编辑，处理中禁用编辑", () => {
  const onEdit = vi.fn();
  const props = { message: message("USER"), sourceCount: 0, showBasis: false, basisOpen: false, canCorrect: false, busy: false, onEdit };
  const rendered = render(createElement(MessageToolbar, props));
  const edit = screen.getByRole("button", { name: "编辑" });
  expect(edit.textContent).toBe("");
  fireEvent.click(edit);
  expect(onEdit).toHaveBeenCalledOnce();
  rendered.rerender(createElement(MessageToolbar, { ...props, busy: true }));
  expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(true);
});
