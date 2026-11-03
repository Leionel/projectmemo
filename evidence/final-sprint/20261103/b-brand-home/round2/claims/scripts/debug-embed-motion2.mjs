// Debug: click-to-load Bilibili iframe visual/response + reduced-motion hot switch (fresh context, no default preference).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(path.resolve(here, ".."), "shots");
fs.mkdirSync(shotDir, { recursive: true });
const BASE = "http://127.0.0.1:34111";
const browser = await chromium.launch();

// A. iframe load probe
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const iframeResponses = [];
  page.on("response", async (res) => {
    if (/player\.bilibili\.com/.test(res.url())) iframeResponses.push({ url: res.url(), status: res.status(), headers: { "x-frame-options": res.headers()["x-frame-options"] ?? null, "content-security-policy": res.headers()["content-security-policy"] ?? null, "content-type": res.headers()["content-type"] ?? null } });
  });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1800);
  const facade = page.locator("#demo button[aria-label*='播放']").first();
  await facade.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await facade.click();
  await page.waitForTimeout(5000);
  await page.locator("#demo").screenshot({ path: path.join(shotDir, "round2-video-embed-clicked.png") }).catch(() => {});
  const frame = page.frames().find((f) => /player\.bilibili\.com/.test(f.url()));
  let frameBody = null;
  if (frame) {
    try { frameBody = (await frame.locator("body").innerText()).slice(0, 500); } catch { frameBody = "<cross-origin unreadable>"; }
  }
  console.log(JSON.stringify({ iframeResponses, frameUrl: frame?.url() ?? null, frameBody }, null, 2));
  await ctx.close();
}

// B. reduced motion hot switch from default no-preference, both directions
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1800);
  const state = () => page.evaluate(() => ({
    dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null,
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    active: document.querySelectorAll("[data-rail-step][data-active]").length,
    heroTranslate: getComputedStyle(document.querySelector("[data-hero-copy]")).translate,
  }));
  const s0 = await state();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(1500);
  const s1 = await state();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await page.waitForTimeout(800);
  const s2 = await state();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(1500);
  const s3 = await state();
  console.log(JSON.stringify({ s0, s1, s2, s3 }, null, 2));
  await ctx.close();
}
await browser.close();
