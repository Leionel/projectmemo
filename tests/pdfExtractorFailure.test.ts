import { afterEach, expect, it, vi } from "vitest";
import { extractPdfText } from "@/lib/services/attachmentService";

afterEach(() => vi.unstubAllEnvs());

it("提取器提前退出时将管道断开作为可处理的提取失败", async () => {
  // Node 不接受 pdftotext 的参数，会在读完输入前退出。
  vi.stubEnv("PDFTOTEXT_PATH", process.execPath);
  await expect(extractPdfText(Buffer.alloc(8 * 1024 * 1024, "x"))).rejects.toThrow("PDF extraction failed");
});
