// Diagnose scroll-then-reduce: does media change fire, and does HomeMotion react?
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:34111";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}:${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => logs.push(`pageerror:${String(e).slice(0, 300)}`));
await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
const snap = () => page.evaluate(() => ({ dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null, matches: matchMedia("(prefers-reduced-motion: reduce)").matches, active: document.querySelectorAll("[data-rail-step][data-active]").length, translate: getComputedStyle(document.querySelector("[data-hero-copy]")).translate, events: window.__ev ?? [] }));
const out = [];
out.push({ step: "start", ...(await snap()) });
await page.evaluate(() => {
  window.__ev = [];
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", (e) => window.__ev.push({ matches: e.matches, at: Date.now() }));
  window.scrollTo(0, document.documentElement.scrollHeight * 0.6);
});
await page.waitForTimeout(1000);
out.push({ step: "after-scroll", ...(await snap()) });
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(2000);
out.push({ step: "after-reduce", ...(await snap()) });
// Force a second change: back and reduce again
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.waitForTimeout(1200);
out.push({ step: "after-nopref", ...(await snap()) });
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(1500);
out.push({ step: "after-reduce-2", ...(await snap()) });
console.log(JSON.stringify({ out, logs }, null, 2));
await browser.close();
