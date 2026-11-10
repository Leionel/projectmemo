// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentInbox } from "@/components/AttachmentInbox";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const PROJECT_ID = "project-attachment-inbox";
const LIST_URL = `/api/projects/${PROJECT_ID}/attachments`;

type Attachment = {
  id: string;
  type: string;
  fileName: string;
  size: number;
  extractedText: string | null;
  extractionStatus: string;
  extractionError: string | null;
  createdAt: string;
};

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "attachment-1",
    type: "PDF",
    fileName: "实验记录.pdf",
    size: 4096,
    extractedText: "旧版机器提取文本",
    extractionStatus: "NEEDS_OCR",
    extractionError: "PDF 暂无可可靠提取的文字，需要 OCR",
    createdAt: "2026-11-09T08:00:00.000Z",
    ...overrides,
  };
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;
let handler: FetchHandler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return handler(url, init);
});

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function renderInbox() {
  return render(createElement(AttachmentInbox, { projectId: PROJECT_ID, enabled: true }));
}

function callsTo(url: string, method?: string) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const callUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (callUrl !== url) return false;
    return method === undefined || init?.method === method;
  });
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  handler = async (url) => {
    if (url === LIST_URL) return jsonResponse([]);
    throw new Error(`未预期的测试请求 ${url}`);
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("读取附件列表失败时展示结构化 error.message，而不是泛化的“读取附件列表失败”", async () => {
  handler = async (url) => {
    if (url === LIST_URL) {
      return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, 500);
    }
    throw new Error(`未预期的测试请求 ${url}`);
  };

  renderInbox();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("服务暂时不可用，请稍后重试");
  expect(alert.textContent).not.toContain("读取附件列表失败");
});

it("兼容旧版 { error: string } 响应体，仍展示服务端字符串原因", async () => {
  handler = async (url) => {
    if (url === LIST_URL) return jsonResponse({ error: "旧版字符串错误：附件目录暂时不可读" }, 500);
    throw new Error(`未预期的测试请求 ${url}`);
  };

  renderInbox();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("旧版字符串错误：附件目录暂时不可读");
});

it("登录失效（401）时展示服务端“登录状态已失效”文案并提示重新登录", async () => {
  handler = async (url) => {
    if (url === LIST_URL) {
      return jsonResponse({ error: { code: "UNAUTHORIZED", message: "登录状态已失效，请重新登录" } }, 401);
    }
    throw new Error(`未预期的测试请求 ${url}`);
  };

  renderInbox();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("登录状态已失效，请重新登录");
  expect(alert.textContent).not.toContain("读取附件列表失败");
});

it("上传被服务端以 ATTACHMENT_INVALID 拒绝时给出专门中文说明与原因", async () => {
  handler = async (url, init) => {
    if (url === LIST_URL && (!init?.method || init.method === "GET")) return jsonResponse([]);
    if (url === LIST_URL && init?.method === "POST") {
      return jsonResponse({ error: { code: "ATTACHMENT_INVALID", message: "文件内容与扩展名不符" } }, 400);
    }
    throw new Error(`未预期的测试请求 ${url} ${init?.method ?? "GET"}`);
  };

  const rendered = renderInbox();
  await waitFor(() => expect(screen.queryByText("正在载入附件资料库…")).toBeNull());

  const fileInput = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, {
    target: { files: [new File(["synthetic"], "伪造的图片.pdf", { type: "application/pdf" })] },
  });

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("这个文件没有被接受");
  expect(alert.textContent).toContain("文件内容与扩展名不符");
  expect(callsTo(LIST_URL, "POST")).toHaveLength(1);
});

it("校对返回 409 ATTACHMENT_TEXT_CHANGED 后重新载入最新列表并提示再次校对", async () => {
  const current = attachment();
  const correctUrl = `${LIST_URL}/${current.id}/correct`;
  const revisionsUrl = `${LIST_URL}/${current.id}/revisions`;
  let listCalls = 0;
  handler = async (url, init) => {
    if (url === LIST_URL && (!init?.method || init.method === "GET")) {
      listCalls += 1;
      return jsonResponse([current]);
    }
    if (url === revisionsUrl) return jsonResponse({ revisions: [] });
    if (url === correctUrl && init?.method === "POST") {
      return jsonResponse(
        { error: { code: "ATTACHMENT_TEXT_CHANGED", message: "附件文本已被其他校对修改，请重新载入后再提交" } },
        409,
      );
    }
    throw new Error(`未预期的测试请求 ${url} ${init?.method ?? "GET"}`);
  };

  renderInbox();
  await screen.findByText("实验记录.pdf");
  fireEvent.click(screen.getByRole("button", { name: /对照原件校对内容/ }));
  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: "人工校对后的完整实验记录内容" } });
  fireEvent.click(screen.getByRole("button", { name: /提交校对并入库/ }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("附件文本已被其他校对修改");
  expect(alert.textContent).toContain("已重新载入最新内容，请再校对一次");
  await waitFor(() => expect(listCalls).toBe(2));
  // 校对面板已收起，用户需要基于最新文本重新进入校对。
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(callsTo(correctUrl, "POST")).toHaveLength(1);
});

it("重试提取失败时读取结构化错误文案（503 EXPERIMENT_OBSERVER_DISABLED）", async () => {
  const current = attachment({ type: "CSV", fileName: "指标副本.csv", extractionStatus: "FAILED" });
  const retryUrl = `${LIST_URL}/${current.id}/retry`;
  handler = async (url, init) => {
    if (url === LIST_URL && (!init?.method || init.method === "GET")) return jsonResponse([current]);
    if (url === retryUrl && init?.method === "POST") {
      return jsonResponse({ error: { code: "EXPERIMENT_OBSERVER_DISABLED", message: "实验指标读取已关闭" } }, 503);
    }
    throw new Error(`未预期的测试请求 ${url} ${init?.method ?? "GET"}`);
  };

  renderInbox();
  await screen.findByText("指标副本.csv");
  fireEvent.click(screen.getByRole("button", { name: /重试提取/ }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("实验指标读取已关闭");
  expect(alert.textContent).not.toContain("重试提取失败");
});

it("重试成功时展示“已提取并沉淀为项目记忆”，不残留错误", async () => {
  const current = attachment();
  const retryUrl = `${LIST_URL}/${current.id}/retry`;
  const succeeded = attachment({
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedText: "提取成功的实验记录文本",
  });
  handler = async (url, init) => {
    if (url === LIST_URL && (!init?.method || init.method === "GET")) return jsonResponse([current]);
    if (url === retryUrl && init?.method === "POST") return jsonResponse({ attachment: succeeded, card: null });
    throw new Error(`未预期的测试请求 ${url} ${init?.method ?? "GET"}`);
  };

  renderInbox();
  await screen.findByText("实验记录.pdf");
  fireEvent.click(screen.getByRole("button", { name: /重试提取/ }));

  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("已提取并沉淀为项目记忆");
  expect(screen.queryByRole("alert")).toBeNull();
});
