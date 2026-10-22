// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureBox } from "@/components/CaptureBox";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/AttachmentInbox", () => ({ AttachmentInbox: () => null }));
afterEach(() => { cleanup(); localStorage.clear(); });
it("恢复草稿前表单不可编辑，恢复后新输入不被迟到的初始化覆盖", async () => {
  localStorage.setItem("projectmemo:capture:p", JSON.stringify({ text: "昨天保存的实验记录", sourceType: "实验记录", requestId: "old-request" }));
  render(createElement(CaptureBox, { projectId: "p" }));
  const field = screen.getByLabelText("碎片内容") as HTMLTextAreaElement;
  expect(field.disabled).toBe(true);
  await waitFor(() => expect(field.disabled).toBe(false));
  expect(field.value).toBe("昨天保存的实验记录");
  fireEvent.change(field, { target: { value: "今天补充了完整的实验口径" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("projectmemo:capture:p")!).text).toBe("今天补充了完整的实验口径"));
  expect(field.value).toBe("今天补充了完整的实验口径");
});
