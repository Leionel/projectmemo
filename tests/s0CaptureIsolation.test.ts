// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureBox } from "@/components/CaptureBox";
import { UserNav } from "@/components/UserNav";
import { bindCaptureDraftOwner, captureDraftKey, clearCaptureDrafts, writeCaptureDraft, captureOwner } from "@/lib/client/captureDrafts";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/AttachmentInbox", () => ({ AttachmentInbox: () => null }));
afterEach(() => { cleanup(); clearCaptureDrafts(); localStorage.clear(); vi.unstubAllGlobals(); });

it("不把无 owner 的旧草稿交给当前用户", async () => {
  localStorage.setItem("projectmemo:capture:p", JSON.stringify({ text: "另一个账号的旧原文" }));
  bindCaptureDraftOwner("B");
  render(createElement(CaptureBox, { projectId: "p", ownerId: "B" }));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
  expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).value).toBe("");
  expect(localStorage.getItem("projectmemo:capture:p")).toBeNull();
});
it("会话身份迟到时等身份核对，不永久禁用表单", async () => {
  render(createElement(CaptureBox, { projectId: "p", ownerId: "A" }));
  expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(true);
  act(() => bindCaptureDraftOwner("A"));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
});
it("换项目重建表单，不把上一项目文字写入新 key", async () => {
  bindCaptureDraftOwner("A");
  const view = render(createElement(CaptureBox, { projectId: "one", ownerId: "A" }));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("碎片内容"), { target: { value: "项目一的私有草稿" } });
  view.rerender(createElement(CaptureBox, { projectId: "two", ownerId: "A" }));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
  expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).value).toBe("");
  expect(localStorage.getItem(captureDraftKey("A", "two"))).toBeNull();
});
it("换账号或退出后，迟到保存不得显示旧卡片或复活草稿", async () => {
  bindCaptureDraftOwner("A");
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const onSaved = vi.fn();
  render(createElement(CaptureBox, { projectId: "shared", ownerId: "A", onMaterialSaved: onSaved }));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("碎片内容"), { target: { value: "账号A尚未完成的原文" } });
  fireEvent.submit(screen.getByLabelText("碎片内容").closest("form")!);
  act(() => bindCaptureDraftOwner("B"));
  await act(async () => resolve(Response.json({ card: { id: "private-card", captureId: "private-capture", title: "A的结果" } })));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByText(/A的结果/)).toBeNull();
  writeCaptureDraft(captureDraftKey("A", "shared"), "A", { text: "迟到写入" });
  expect(localStorage.getItem(captureDraftKey("A", "shared"))).toBeNull();
});
it("其他标签页换账号后旧表单立即停止写入", async () => {
  bindCaptureDraftOwner("A");
  render(createElement(CaptureBox, { projectId: "p", ownerId: "A" }));
  await waitFor(() => expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(false));
  act(() => {
    localStorage.setItem("projectmemo:capture-owner", "B");
    window.dispatchEvent(new StorageEvent("storage", { key: "projectmemo:capture-owner", newValue: "B" }));
  });
  expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByLabelText("碎片内容") as HTMLTextAreaElement).value).toBe("");
});
it("迟到的 auth/me 回包不能把新账号重新绑定为旧账号", async () => {
  bindCaptureDraftOwner("A");
  const resolvers: Array<(value: Response) => void> = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolvers.push(done); })));
  render(createElement(UserNav));
  await waitFor(() => expect(resolvers).toHaveLength(1));
  act(() => {
    localStorage.setItem("projectmemo:capture-owner", "B");
    window.dispatchEvent(new StorageEvent("storage", { key: "projectmemo:capture-owner", newValue: "B" }));
  });
  await waitFor(() => expect(resolvers).toHaveLength(2));
  await act(async () => resolvers[0](Response.json({ user: { id: "A", username: "A", displayName: "旧账号" } })));
  expect(captureOwner()).toBe("B");
  await act(async () => resolvers[1](Response.json({ user: { id: "B", username: "B", displayName: "当前账号" } })));
  expect(screen.getByText("当前账号")).toBeTruthy();
  expect(captureOwner()).toBe("B");
});
