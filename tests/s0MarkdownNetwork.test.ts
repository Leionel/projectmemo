import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { chromium } from "playwright-core";

describe("G15 Markdown 预览的隐式联网", () => {
  it("不为远程、协议相对、data 图片生成 img 或 preload", () => {
    for (const url of ["https://audit.invalid/pixel?private=synthetic", "//audit.invalid/pixel", "data:image/svg+xml,synthetic"]) {
      const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: `![示例](${url})` }));
      expect(html).not.toMatch(/<img|<link[^>]*rel="preload"/);
    }
  });
  it("保留鉴权附件图片和用户主动打开的普通链接", () => {
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
      content: "![附件](/api/projects/p/attachments/a/file)\n\n[资料](https://example.org/doc)",
      projectId: "p",
    }));
    expect(html).toContain('src="/api/projects/p/attachments/a/file"');
    expect(html).toContain('href="https://example.org/doc"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("模型不能借当前预览自动读取另一个项目的鉴权图片", () => {
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, { projectId: "allowed", content: "![越界](/api/projects/other/attachments/a/file)" }));
    expect(html).not.toMatch(/<img|rel="preload"/);
  });
  it("真实 Chromium 渲染与 preload 不向 canary 发起请求", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const requests: string[] = [];
      const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
        projectId: "allowed",
        content: "![像素](https://audit.invalid/pixel?private=synthetic)\n\n![协议相对](//audit.invalid/second)\n\n![越界附件](/api/projects/other/attachments/a/file)",
      }));
      await page.route("**/*", async route => {
        if (route.request().url() === "http://127.0.0.1:41789/s0") await route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
        else { requests.push(route.request().url()); await route.abort(); }
      });
      await page.goto("http://127.0.0.1:41789/s0", { waitUntil: "networkidle" });
      expect(await page.getByText(/未自动加载/).count()).toBe(3);
      expect(requests).toEqual([]);
    } finally { await browser.close(); }
  });
});
