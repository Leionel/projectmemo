// @vitest-environment jsdom
// qa-cross 阶段 1 补强：上一轮四个回归文件未覆盖的两条会话附件行为。
// 1) useConversationAttachments 的 epoch 防护：切换讨论后，旧讨论仍在途的上传结果不得写回新讨论。
// 2) promote 失败时读取统一错误结构 { error: { message } }，并保留本轮附件、恢复按钮可用。
import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useConversationAttachments, type ConversationAttachmentChip } from "@/components/ConversationAttachments";
import { ConversationPanel } from "@/components/ConversationPanel";
import type { ConversationView } from "@/lib/types/conversation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ConversationAnchorPanel", () => ({ ConversationAnchorPanel: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function HookHarness({ conversationId, onChips }: { conversationId: string; onChips: (chips: ConversationAttachmentChip[]) => void }) {
  const [chips, setChips] = useState<ConversationAttachmentChip[]>([]);
  const attachments = useConversationAttachments({
    conversationId, projectId: "", disabled: false, chips,
    onChips: next => { setChips(next); onChips(next); },
    onProjectSaved: () => undefined,
    onError: () => undefined,
  });
  return createElement("div", null, attachments.button, attachments.panel);
}

it("切换讨论后，旧讨论在途的上传结果不再写回新讨论", async () => {
  let finishUpload: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finishUpload = resolve; })));
  const onChips = vi.fn();
  const rendered = render(createElement(HookHarness, { conversationId: "first", onChips }));
  fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["synthetic"], "实验.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  await waitFor(() => expect(finishUpload).toBeTypeOf("function"));
  rendered.rerender(createElement(HookHarness, { conversationId: "second", onChips }));
  await act(async () => {
    finishUpload?.(Response.json({ attachment: { id: "stale", fileName: "实验.pdf", extractionStatus: "SUCCESS", extractionError: null } }));
  });
  expect(onChips).not.toHaveBeenCalled();
  expect(screen.queryByRole("list", { name: "本轮附件" })).toBeNull();
});

const conversationView: ConversationView = {
  schemaVersion: 1, id: "first", title: "第一次讨论", scope: "WORKSPACE", version: 1,
  homeProjectId: null, focusProjectId: null, messages: [], hasMore: false, beforeSeq: null,
  activeTurn: null, linkedProjects: [],
};
const attachment = { id: "attachment-first", fileName: "实验.pdf", extractionStatus: "SUCCESS", extractionError: null };

it("转为项目资料失败时展示服务端 error.message 并保留本轮附件", async () => {
  const fetchMock = vi.fn(async (url: string): Promise<Response> => {
    if (url === "/api/conversations/capabilities") return Response.json({ cloudAvailable: false });
    if (url === "/api/conversations" || url.startsWith("/api/conversations?")) return Response.json({ conversations: [{ id: "first", title: "第一次讨论", scope: "WORKSPACE", updatedAt: "2026-11-09T00:00:00.000Z" }] });
    if (url === "/api/conversations/first") return Response.json(conversationView);
    if (url === "/api/conversations/first/attachments") return Response.json({ attachment });
    if (url === "/api/conversations/first/attachments/attachment-first/promote") {
      return Response.json({ error: { code: "ATTACHMENT_NOT_FOUND", message: "附件已被移除，请重新上传" } }, { status: 409 });
    }
    throw new Error("未预期的测试请求 " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  const rendered = render(createElement(ConversationPanel, { projectId: "project", initialConversationId: "first" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "添加附件" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["synthetic"], attachment.fileName, { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  await screen.findByRole("list", { name: "本轮附件" });
  fireEvent.click(screen.getByRole("button", { name: "转为项目资料" }));
  await screen.findByText("附件已被移除，请重新上传");
  expect(screen.getByRole("list", { name: "本轮附件" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "转为项目资料" }) as HTMLButtonElement).disabled).toBe(false);
});
