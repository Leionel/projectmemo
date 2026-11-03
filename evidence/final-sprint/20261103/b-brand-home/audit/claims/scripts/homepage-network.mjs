// Phase 0 baseline network audit: anonymous homepage load + HomeJourney session.
// Read-only: no login, no business writes. All observations are recorded as JSON.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");
const jsonDir = path.join(auditDir, "json");
const shotDir = path.join(auditDir, "shots");
fs.mkdirSync(jsonDir, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });

const requests = [];
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

function classify(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { origin: "invalid", kind: "invalid", path: url };
  }
  const local = u.host === "127.0.0.1:34111" || u.host === "localhost:34111";
  const isWs = u.protocol === "ws:" || u.protocol === "wss:";
  let kind = "static";
  if (isWs) kind = "websocket";
  else if (u.pathname.startsWith("/api/")) kind = "api";
  else if (u.pathname.startsWith("/_next/")) kind = "next-static";
  else if (u.pathname.startsWith("/home/") || u.pathname.startsWith("/fonts/")) kind = "asset";
  else if (u.pathname === "/" || u.pathname.startsWith("/login") || u.pathname.startsWith("/focus")) kind = "document";
  return { local, origin: u.origin, protocol: u.protocol, path: u.pathname, kind };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await context.newPage();

page.on("request", (req) => {
  const cls = classify(req.url());
  requests.push({
    phase: "load",
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
    ...cls,
    at: new Date().toISOString(),
  });
});
page.on("requestfailed", (req) => {
  failedRequests.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText ?? null });
});
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleMessages.push({ type: msg.type(), text: msg.text() });
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

const steps = [];
async function step(name, fn) {
  try {
    const value = await fn();
    steps.push({ name, ok: true, value: value ?? null });
    console.log(`[OK] ${name}${value === undefined ? "" : " => " + JSON.stringify(value)}`);
    return value;
  } catch (err) {
    steps.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
    console.log(`[FAIL] ${name}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

// 1. anonymous load
await step("goto-home", async () => {
  const res = await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200);
  return { status: res?.status(), url: page.url(), title: await page.title() };
});

await step("read-main-claims", async () => {
  return {
    h1: await page.locator("h1").first().innerText(),
    positioning: await page.locator("main p").first().innerText().catch(() => null),
    bodyText: (await page.locator("main").innerText()).slice(0, 12000),
  };
});

await step("font-and-image-checks", async () => {
  return await page.evaluate(async () => {
    await document.fonts.ready;
    const fonts = Array.from(document.fonts).map((f) => ({
      family: f.family,
      weight: f.weight,
      status: f.status,
    }));
    const images = Array.from(document.querySelectorAll("img")).map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }));
    return {
      editorialLoaded: document.fonts.check('500 48px "PM Editorial"'),
      brandLoaded: document.fonts.check('400 16px "PM Brand"'),
      fonts,
      images,
    };
  });
});

// 2. hero CTA scroll to #experience
await step("click-hero-primary-cta", async () => {
  await page.getByRole("link", { name: /体验项目接续/ }).first().click();
  await page.waitForTimeout(900);
  return await page.evaluate(() => {
    const el = document.getElementById("experience");
    const header = document.querySelector("header");
    const heading = document.getElementById("story-heading");
    const r = el?.getBoundingClientRect();
    const h = header?.getBoundingClientRect();
    const hr = heading?.getBoundingClientRect();
    return {
      hash: location.hash,
      scrollY: window.scrollY,
      experienceTop: r?.top ?? null,
      headerBottom: h?.bottom ?? null,
      headingTop: hr?.top ?? null,
      headingOccludedByHeader: hr && h ? hr.top < h.bottom : null,
    };
  });
});

// 3. HomeJourney interactions: tabs, dialog, confirm, receipt, reset
await step("demo-tab-walk", async () => {
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  const seen = [];
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(250);
    seen.push({
      index: i,
      selected: await tabs.nth(i).getAttribute("aria-selected"),
      panelLabel: await page.getByRole("tabpanel").getAttribute("aria-labelledby"),
      panelText: (await page.getByRole("tabpanel").innerText()).slice(0, 500),
    });
  }
  return { tabCount: count, seen };
});

await step("open-source-dialog", async () => {
  await page.getByRole("tab").nth(1).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /查看原文：比赛材料/ }).first().click();
  await page.waitForTimeout(500);
  const open = await page.locator("dialog[open]").count();
  const text = (await page.locator("dialog[open]").innerText()).slice(0, 500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return { dialogOpen: open, text, dialogOpenAfterEsc: await page.locator("dialog[open]").count() };
});

await step("confirm-example-action", async () => {
  await page.getByRole("tab").nth(3).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /在示例中确认行动/ }).click();
  await page.waitForTimeout(300);
  const panel = await page.getByRole("tabpanel").innerText();
  return { panelText: panel.slice(0, 600) };
});

await step("save-simulated-receipt", async () => {
  await page.getByRole("tab").nth(4).click();
  await page.waitForTimeout(250);
  const textarea = page.getByRole("textbox", { name: /填写一段模拟完成结果/ });
  await textarea.fill("审计示例：假设已录入一条记录并生成草稿，来源还需要逐项核对。");
  await page.getByRole("button", { name: /保存模拟回执/ }).click();
  await page.waitForTimeout(400);
  return { panelText: (await page.getByRole("tabpanel").innerText()).slice(0, 700) };
});

await step("back-to-evidence", async () => {
  await page.getByRole("button", { name: /回到依据页查看/ }).click();
  await page.waitForTimeout(300);
  return { panelText: (await page.getByRole("tabpanel").innerText()).slice(0, 700) };
});

await step("reset-demo", async () => {
  await page.getByRole("button", { name: /重置示例/ }).click();
  await page.waitForTimeout(300);
  return {
    panelText: (await page.getByRole("tabpanel").innerText()).slice(0, 300),
    statusText: await page.getByRole("status").first().innerText().catch(() => null),
  };
});

// 4. CTA href inventory (anonymous)
await step("cta-hrefs-anonymous", async () => {
  const hero = await page.locator("main a", { hasText: /进入工作台|回到我的工作台/ }).allInnerTexts();
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main a, header a")).map((a) => ({
      text: (a.textContent || "").trim(),
      href: a.getAttribute("href"),
    }))
  );
  return { heroTexts: hero, hrefs };
});

await step("screenshot-desktop", async () => {
  await page.screenshot({ path: path.join(shotDir, "baseline-home-1440x900.png"), fullPage: true });
  return "saved";
});

const finishTime = new Date().toISOString();
const external = requests.filter((r) => r.origin && !r.local);
const apiRequests = requests.filter((r) => r.kind === "api");
const apiWrites = apiRequests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
const modelHints = requests.filter((r) => /model|llm|chat|openai|anthropic|completion/i.test(r.url));

const report = {
  generatedAt: finishTime,
  base: BASE,
  mode: "anonymous-playwright-chromium-read-only",
  summary: {
    totalRequests: requests.length,
    apiRequests: apiRequests.length,
    apiWriteRequests: apiWrites.length,
    externalRequests: external.length,
    modelHintRequests: modelHints.length,
    failedRequests: failedRequests.length,
    pageErrors: pageErrors.length,
    consoleErrorsWarnings: consoleMessages.length,
  },
  steps,
  apiRequests,
  apiWrites,
  external,
  modelHints,
  failedRequests,
  pageErrors,
  consoleMessages,
  requests,
};
fs.writeFileSync(path.join(jsonDir, "baseline-network.json"), JSON.stringify(report, null, 2));
console.log("SUMMARY " + JSON.stringify(report.summary, null, 2));
await browser.close();
