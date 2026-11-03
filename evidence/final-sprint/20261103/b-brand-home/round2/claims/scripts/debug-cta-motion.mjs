// Debug: CTA navigation + reduced-motion hot switch on checkpoint 4b69614.
import { chromium } from "playwright";
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const browser = await chromium.launch();

// --- CTA debug ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`console:${m.type()}:${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => logs.push(`pageerror:${String(e).slice(0, 200)}`));
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) logs.push(`nav:${f.url()}`); });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3000);
  const headerCount = await page.locator("header a[href='/focus']").count();
  const href = await page.locator("header a[href='/focus']").first().getAttribute("href");
  const box = await page.locator("header a[href='/focus']").first().boundingBox();
  await page.locator("header a[href='/focus']").first().click();
  await page.waitForTimeout(4000);
  const afterHeader = { url: page.url(), title: await page.title(), logs: logs.slice(-8) };
  logs.length = 0;
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const heroCount = await page.locator("main a[href='/login?from=%2Ffocus']").count();
  await page.locator("main a[href='/login?from=%2Ffocus']").first().click();
  await page.waitForTimeout(4000);
  const afterHero = { url: page.url(), title: await page.title(), logs: logs.slice(-8) };
  console.log(JSON.stringify({ headerCount, href, box, afterHeader, heroCount, afterHero }, null, 2));
  await ctx.close();
}

// --- hot switch debug ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => ({
    dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null,
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    active: document.querySelectorAll("[data-rail-step][data-active]").length,
    heroTranslate: getComputedStyle(document.querySelector("[data-hero-copy]")).translate,
    progress: document.querySelector("[data-scroll-progress]") ? getComputedStyle(document.querySelector("[data-scroll-progress]")).transform : null,
  }));
  const before = await state();
  await page.evaluate(() => { window.__mqEvents = []; const mq = matchMedia("(prefers-reduced-motion: reduce)"); mq.addEventListener("change", (e) => window.__mqEvents.push({ matches: e.matches, at: Date.now() })); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(1200);
  const afterReduce = await state();
  const eventsAfterReduce = await page.evaluate(() => window.__mqEvents);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(1200);
  const afterRestore = await state();
  const eventsAfterRestore = await page.evaluate(() => window.__mqEvents);
  console.log(JSON.stringify({ before, afterReduce, eventsAfterReduce, afterRestore, eventsAfterRestore }, null, 2));
  await ctx.close();
}
await browser.close();
