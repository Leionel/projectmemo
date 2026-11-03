// Production-mode probe against the built .next-build server (port 34112).
// Anonymous only; records redirect final URLs and external requests before any click.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34112";
const here = path.dirname(fileURLToPath(import.meta.url));
const jsonDir = path.join(path.resolve(here, ".."), "json");
fs.mkdirSync(jsonDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
const requests = [];
page.on("request", (r) => {
  let u = null;
  try { u = new URL(r.url()); } catch { /* ignore */ }
  requests.push({ method: r.method(), url: r.url(), resourceType: r.resourceType(), local: u ? ["127.0.0.1:34112", "localhost:34112"].includes(u.host) : false, origin: u ? u.origin : "invalid" });
});
const docs = [];
page.on("response", (res) => { const req = res.request(); if (req.resourceType() === "document") docs.push({ url: res.url(), status: res.status() }); });

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
const home = {
  url: page.url(),
  title: await page.title(),
  boundaryVisible: await page.getByText(/公开示例 · 不调用模型 · 不写入你的项目/).first().isVisible().catch(() => false),
  externalBeforeClick: requests.filter((r) => !r.local).length,
  videoLinks: await page.locator("a[href*='bilibili.com']").count(),
};

docs.length = 0;
await page.locator("header a[href='/focus']").click();
await page.waitForTimeout(2500);
const headerCta = { finalUrl: page.url(), docs: [...docs], loginFormVisible: await page.getByRole("textbox").first().isVisible().catch(() => false) };

docs.length = 0;
await page.goto(BASE + "/focus", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
const directFocus = { finalUrl: page.url(), title: await page.title(), h1: await page.locator("h1").first().innerText().catch(() => null), docs: [...docs] };

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  mode: "production-next-start .next-build anonymous read-only",
  home,
  headerCta,
  directFocus,
  totalRequests: requests.length,
  externalRequestsBeforeClick: requests.filter((r) => !r.local).map((r) => r.url),
  docsAll: docs,
};
fs.writeFileSync(path.join(jsonDir, "production-route-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 4000));
await browser.close();
