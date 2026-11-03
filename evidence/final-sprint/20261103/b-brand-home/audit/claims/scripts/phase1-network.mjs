// Phase 1 network audit — B2 candidate anonymous full journey.
// Read-only browser interactions on local mock server; no credentials.
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
const pageErrors = [];
const consoleMessages = [];
const failed = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await context.newPage();

let phase = "load";
await context.route("**/*", async (route) => {
  const req = route.request();
  let u = null;
  try { u = new URL(req.url()); } catch { /* ignore */ }
  requests.push({
    phase,
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
    origin: u ? u.origin : "invalid",
    path: u ? u.pathname : req.url(),
    local: u ? u.host === "127.0.0.1:34111" || u.host === "localhost:34111" : false,
    at: new Date().toISOString(),
  });
  try { await route.continue(); } catch { /* page closed */ }
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleMessages.push({ type: m.type(), text: m.text() }); });
page.on("requestfailed", (r) => failed.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

const steps = [];
async function step(name, fn) {
  try {
    const value = await fn();
    steps.push({ name, ok: true, value: value ?? null });
    console.log(`[OK] ${name} => ${JSON.stringify(value).slice(0, 500)}`);
    return value;
  } catch (err) {
    steps.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
    console.log(`[FAIL] ${name}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

await step("load-home", async () => {
  const res = await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.fonts.ready);
  return { status: res?.status(), title: await page.title(), url: page.url() };
});

let heroBackRows = null;
await step("hero-default-stage", async () => {
  const tabs = page.locator("#home-heading [role=tab]");
  const count = await tabs.count();
  const selected = await page.locator('#home-heading [role=tab][aria-selected="true"]').innerText();
  const rows = await page.locator("#home-heading .lensRows, #home-heading [data-animate]").first().innerText().catch(() => "");
  const panel = await page.locator('#home-heading [role="tabpanel"]').innerText();
  return { tabCount: count, selected: selected.replace(/\s+/g, " "), rows, panel };
});

await step("hero-stage-switch", async () => {
  const tabs = page.locator("#home-heading [role=tab]");
  const out = [];
  for (const index of [0, 1, 2]) {
    await tabs.nth(index).click();
    await page.waitForTimeout(450);
    const selected = await page.locator('#home-heading [role=tab][aria-selected="true"]').innerText();
    const panel = await page.locator('#home-heading [role="tabpanel"]').innerText();
    out.push({ index, selected: selected.replace(/\s+/g, " "), panel });
  }
  heroBackRows = out[2].panel;
  // rapid 20 switches must not lose the last state
  for (let i = 0; i < 20; i++) {
    await tabs.nth(i % 3).click();
  }
  await tabs.nth(2).click();
  await page.waitForTimeout(600);
  const finalSelected = await page.locator('#home-heading [role=tab][aria-selected="true"]').innerText();
  const finalPanel = await page.locator('#home-heading [role="tabpanel"]').innerText();
  return {
    panels: out,
    finalSelected: finalSelected.replace(/\s+/g, " "),
    finalMatchesBack: finalPanel.replace(/\s+/g, " ") === heroBackRows.replace(/\s+/g, " "),
  };
});

await step("hero-evidence-expand", async () => {
  await page.waitForTimeout(600);
  const button = page.locator("#home-heading button[aria-expanded]").first();
  const textBefore = await button.innerText();
  await button.click();
  await page.waitForTimeout(600);
  const panel = page.locator("#hero-evidence");
  const text = await panel.innerText();
  const quoteCount = await page.locator("#hero-evidence q").count();
  const expanded = await button.getAttribute("aria-expanded");
  const textExpanded = await button.innerText();
  await button.click();
  await page.waitForTimeout(500);
  const collapsed = await button.getAttribute("aria-expanded");
  return { textBefore, textExpanded, expanded, collapsed, quoteCount, text };
});

await step("hero-primary-cta-anchor", async () => {
  await page.getByRole("link", { name: /体验一段项目接续/ }).first().click();
  await page.waitForTimeout(900);
  return await page.evaluate(() => {
    const section = document.getElementById("experience");
    const header = document.querySelector("header");
    const heading = document.getElementById("experience-title");
    const sr = section?.getBoundingClientRect();
    const hr = header?.getBoundingClientRect();
    const tr = heading?.getBoundingClientRect();
    return {
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      sectionTop: sr ? Math.round(sr.top * 10) / 10 : null,
      headerBottom: hr ? Math.round(hr.bottom * 10) / 10 : null,
      headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
      headingOccluded: tr && hr ? tr.top < hr.bottom : null,
      headerPosition: header ? getComputedStyle(header).position : null,
    };
  });
});

await step("demo-receipt-gate-before-confirm", async () => {
  const tabs = page.locator("#experience [role=tab]");
  await tabs.nth(4).click();
  await page.waitForTimeout(400);
  const panel = await page.locator("#experience [role=tabpanel]").innerText();
  return { panel, gateVisible: /先确认行动/.test(panel) };
});

await step("demo-confirm-action", async () => {
  const tabs = page.locator("#experience [role=tab]");
  await tabs.nth(3).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: /在示例中确认行动/ }).click();
  await page.waitForTimeout(350);
  const panel = await page.locator("#experience [role=tabpanel]").innerText();
  return { panel };
});

await step("demo-save-simulated-receipt", async () => {
  const tabs = page.locator("#experience [role=tab]");
  await tabs.nth(4).click();
  await page.waitForTimeout(350);
  await page.getByRole("textbox", { name: /填写一段模拟完成结果/ }).fill("审计示例：假设已录入一条记录并生成草稿，来源还需要逐项核对。");
  await page.getByRole("button", { name: /保存模拟回执/ }).click();
  await page.waitForTimeout(500);
  const panel = await page.locator("#experience [role=tabpanel]").innerText();
  return { panel };
});

await step("demo-back-to-evidence-and-reset", async () => {
  await page.getByRole("button", { name: /回到依据页查看/ }).click();
  await page.waitForTimeout(400);
  const evidencePanel = await page.locator("#experience [role=tabpanel]").innerText();
  const receiptReflected = /审计示例/.test(evidencePanel) && /模拟回执/.test(evidencePanel);
  await page.getByRole("button", { name: /重置示例/ }).click();
  await page.waitForTimeout(400);
  const resetPanel = await page.locator("#experience [role=tabpanel]").innerText();
  const status = await page.getByRole("status").first().innerText().catch(() => null);
  return { receiptReflected, evidencePanel: evidencePanel.slice(0, 400), resetOk: !/审计示例/.test(resetPanel), status };
});

await step("demo-source-dialog", async () => {
  const tabs = page.locator("#experience [role=tab]");
  await tabs.nth(1).click();
  await page.waitForTimeout(350);
  const btn = page.locator("#experience").getByRole("button", { name: /查看原文：/ }).first();
  await btn.click();
  await page.waitForTimeout(500);
  const dialogOpen = await page.locator("dialog[open]").count();
  const dialogText = await page.locator("dialog[open]").innerText();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const dialogClosed = await page.locator("dialog[open]").count();
  const focusAfter = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName, label: el.getAttribute("aria-label"), text: (el.textContent || "").trim().slice(0, 60) } : null;
  });
  return { dialogOpen, dialogText, dialogClosed, focusAfter };
});

await step("scroll-motion-sweep", async () => {
  phase = "scroll";
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((height * i) / steps));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    docHeight: document.documentElement.scrollHeight,
    railProgress: (document.querySelector("[data-rail]")?.style.getPropertyValue("--rail-progress") || "").trim(),
    activeRailSteps: document.querySelectorAll("[data-rail-step][data-active]").length,
    progressTransform: document.querySelector("[data-scroll-progress]") ? getComputedStyle(document.querySelector("[data-scroll-progress]")).transform : null,
    dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null,
  }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return state;
});

await step("video-link-attributes", async () => {
  const mainLink = page.locator("#demo a[href*='bilibili.com']");
  const footerLink = page.locator("footer a[href*='bilibili.com']");
  const mainCount = await mainLink.count();
  const footerCount = await footerLink.count();
  const read = async (loc) => ({
    href: await loc.getAttribute("href"),
    target: await loc.getAttribute("target"),
    rel: await loc.getAttribute("rel"),
    title: await loc.getAttribute("title"),
    ariaLabel: await loc.getAttribute("aria-label"),
    text: (await loc.innerText()).replace(/\s+/g, " "),
  });
  return {
    mainCount, footerCount,
    main: mainCount ? await read(mainLink.first()) : null,
    footer: footerCount ? await read(footerLink.first()) : null,
    iframes: await page.locator("iframe").count(),
    videos: await page.locator("video, audio").count(),
    autoplay: await page.locator("[autoplay]").count(),
  };
});

function attachPopupCapture() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    page.waitForEvent("popup", { timeout: 7500 }).then(async (popup) => {
      clearTimeout(timer);
      const url = popup.url();
      let status = null;
      try {
        const r = await popup.waitForLoadState("domcontentloaded", { timeout: 4000 }).then(() => null, () => null);
        status = r;
      } catch { /* ignore */ }
      await popup.close().catch(() => {});
      resolve({ url });
    }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

await step("video-main-click", async () => {
  const mainLink = page.locator("#demo a[href*='bilibili.com']").first();
  await mainLink.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const beforeUrl = page.url();
  const popupPromise = attachPopupCapture();
  phase = "video-click";
  await mainLink.click();
  const popup = await popupPromise;
  await page.waitForTimeout(600);
  return { popup, mainPageUrl: page.url(), mainPageUnchanged: page.url() === beforeUrl };
});

await step("video-footer-click", async () => {
  const footerLink = page.locator("footer a[href*='bilibili.com']").first();
  await footerLink.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const beforeUrl = page.url();
  const popupPromise = attachPopupCapture();
  await footerLink.click();
  const popup = await popupPromise;
  await page.waitForTimeout(400);
  return { popup, mainPageUrl: page.url(), mainPageUnchanged: page.url() === beforeUrl };
});

await step("screenshots", async () => {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(shotDir, "phase1-home-1440x900.png"), fullPage: true });
  return "saved";
});

const api = requests.filter((r) => r.path.startsWith("/api/"));
const apiWrites = api.filter((r) => !["GET", "HEAD"].includes(r.method));
const external = requests.filter((r) => !r.local);
const externalBeforeVideo = external.filter((r) => r.phase !== "video-click");
const images = requests.filter((r) => r.resourceType === "image");
const localImages = images.filter((r) => r.local);
const externalImagesAfterClick = images.filter((r) => !r.local && r.phase === "video-click");
// model calls = local /api/* model endpoints OR known AI provider hosts, counted only before explicit external navigation
const AI_HOST = /openai\.com|anthropic\.com|deepseek\.com|api\.openai|generativelanguage|huggingface|dashscope|moonshot|bigmodel\.cn/i;
const modelHints = requests.filter(
  (r) => r.phase !== "video-click" && (AI_HOST.test(r.url) || (r.path.startsWith("/api/") && /model|llm|chat|completion/i.test(r.url)))
);
const postClickExternalNonGet = external.filter((r) => r.phase === "video-click" && !["GET", "HEAD"].includes(r.method));
const oldHeroImages = requests.filter((r) => /workspace-(desktop|mobile)\.jpg/.test(r.path));

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  candidateSha: process.env.AUDIT_SHA || null,
  mode: "anonymous playwright chromium 1440x900 read-only",
  notes: {
    externalAfterClick: "用户显式点击 Bilibili 外链后，由外部站点自行发起的请求不计入本站加载/交互阶段；其中包含外部站点的非 GET 请求（其自身行为，非本站发起）。",
    popupCanonicalization: "Bilibili 将 /video/BV1Qaxb6PE7G?vd_source=... 规范化为 /video/BV1Qaxb6PE7G/?vd_source=...（仅补斜杠，参数保留）。",
    logoImage: "首页仍加载页头品牌 logo.png（既有 BrandLink <Image priority unoptimized>）；无旧 workspace-*.jpg 请求。",
  },
  summary: {
    totalRequests: requests.length,
    apiRequests: api.length,
    apiWrites: apiWrites.length,
    externalRequests: external.length,
    externalBeforeVideoClick: externalBeforeVideo.length,
    externalNonGetAfterVideoClick: postClickExternalNonGet.length,
    modelHintRequests: modelHints.length,
    imageRequests: images.length,
    localImageRequests: localImages.length,
    externalImagesAfterClick: externalImagesAfterClick.length,
    oldHeroImageRequests: oldHeroImages.length,
    failedRequests: failed.length,
    pageErrors: pageErrors.length,
    consoleErrorsWarnings: consoleMessages.length,
  },
  assertions: {
    noApiTraffic: api.length === 0,
    noApiWrites: apiWrites.length === 0,
    noExternalBeforeVideoClick: externalBeforeVideo.length === 0,
    noModelCallsBeforeVideoClick: modelHints.length === 0,
    noOldHeroImages: oldHeroImages.length === 0,
  },
  videoLinks: (() => {
    const v = steps.find((s) => s.name === "video-link-attributes");
    return v?.ok ? v.value : null;
  })(),
  steps,
  api,
  apiWrites,
  externalRequests: external,
  externalNonGetAfterVideoClick: postClickExternalNonGet,
  modelHints,
  imageRequests: images,
  failed,
  pageErrors,
  consoleMessages,
  requests,
};
fs.writeFileSync(path.join(jsonDir, "network-audit.json"), JSON.stringify(report, null, 2));
console.log("SUMMARY " + JSON.stringify(report.summary, null, 2));
console.log("ASSERTIONS " + JSON.stringify(report.assertions, null, 2));
await browser.close();
