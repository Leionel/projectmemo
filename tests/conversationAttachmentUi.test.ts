// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationPanel } from "@/components/ConversationPanel";
import type { ConversationView } from "@/lib/types/conversation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ConversationAnchorPanel", () => ({ ConversationAnchorPanel: () => null }));

function conversation(id: string): ConversationView {
  return {
    schemaVersion: 1, id, title: id === "first" ? "第一次讨论" : "第二次讨论", scope: "WORKSPACE", version: 1,
    homeProjectId: null, focusProjectId: null, messages: [], hasMore: false, beforeSeq: null,
    activeTurn: null, linkedProjects: [],
  };
}
const attachment = { id: "attachment-first", fileName: "实验.pdf", extractionStatus: "SUCCESS", extractionError: null };
let finishUpload: (() => void) | undefined;
let delayUpload = false;
let rejectRemoval = false;
let turnRequests: unknown[] = [];
const fetchMock = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
  if (url === "/api/conversations/capabilities") return Response.json({ cloudAvailable: false });
  if (url === "/api/conversations") {
    if (options?.method === "POST") return Response.json({ id: "second" });
    return Response.json({ conversations: [conversation("first"), conversation("second")] });
  }
  if (url.endsWith("/attachments")) {
    if (delayUpload) await new Promise<void>(resolve => { finishUpload = resolve; });
    return Response.json({ attachment });
  }
  if (url.endsWith("/attachments/" + attachment.id)) return rejectRemoval
    ? Response.json({ error: { message: "附件移除失败，请重试" } }, { status: 503 })
    : Response.json({ deleted: true });
  if (url.endsWith("/turns")) {
    turnRequests.push(JSON.parse(String(options?.body)));
    return Response.json({ status: "OBSERVING", conversation: conversation("first") });
  }
  if (url === "/api/conversations/first") return Response.json(conversation("first"));
  if (url === "/api/conversations/second") return Response.json(conversation("second"));
  throw new Error("未预期的测试请求 " + url);
});

beforeEach(() => {
  delayUpload = false;
  finishUpload = undefined;
  rejectRemoval = false;
  turnRequests = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

async function chooseAttachment() {
  const rendered = render(createElement(ConversationPanel, { initialConversationId: "first" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "添加附件" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["synthetic"], attachment.fileName, { type: "application/pdf" })] },
  });
  return rendered;
}

it("切换历史讨论时清除属于上一讨论的附件", async () => {
  await chooseAttachment();
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  await screen.findByRole("list", { name: "本轮附件" });
  fireEvent.click(screen.getByRole("button", { name: "历史讨论" }));
  fireEvent.click(screen.getByRole("button", { name: /第二次讨论/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/conversations/second", expect.anything()));
  await waitFor(() => expect(screen.queryByRole("list", { name: "本轮附件" })).toBeNull());
});

it("上传期间不能提交缺少附件的消息或切换讨论", async () => {
  const rendered = await chooseAttachment();
  fireEvent.change(rendered.container.querySelector("textarea")!, { target: { value: "请分析这个文件" } });
  delayUpload = true;
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "新讨论" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "历史讨论" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finishUpload?.());
  await screen.findByRole("list", { name: "本轮附件" });
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
});

it("新建讨论时清除上一次尚未提交的附件", async () => {
  await chooseAttachment();
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  await screen.findByRole("list", { name: "本轮附件" });
  fireEvent.click(screen.getByRole("button", { name: "新讨论" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/conversations/second", expect.anything()));
  await waitFor(() => expect(screen.queryByRole("list", { name: "本轮附件" })).toBeNull());
});

it("移除失败保留附件并显示错误，允许重试", async () => {
  await chooseAttachment();
  fireEvent.click(screen.getByRole("button", { name: /仅用于本次讨论/ }));
  await screen.findByRole("list", { name: "本轮附件" });
  rejectRemoval = true;
  fireEvent.click(screen.getByRole("button", { name: "移除附件 实验.pdf" }));
  await screen.findByText(/附件移除失败，请重试/);
  expect(screen.getByRole("list", { name: "本轮附件" })).toBeTruthy();
  rejectRemoval = false;
  fireEvent.click(screen.getByRole("button", { name: "移除附件 实验.pdf" }));
  await waitFor(() => expect(screen.queryByRole("list", { name: "本轮附件" })).toBeNull());
});

it("后台已接收的问题清空输入，下一次相同问题使用新的请求编号", async () => {
  const rendered = await chooseAttachment();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  const field = rendered.container.querySelector("textarea")!;
  fireEvent.change(field, { target: { value: "检查项目进展" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(field.value).toBe(""));
  fireEvent.change(field, { target: { value: "检查项目进展" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(turnRequests).toHaveLength(2));
  expect((turnRequests[0] as { requestId: string }).requestId).not.toBe((turnRequests[1] as { requestId: string }).requestId);
});
