// Focused reduced-motion hot-switch probe across fresh pages/sequences.
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:34111";
const browser = await chromium.launch();
const out = [];
async function scenario(name, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(opts.settle ?? 2500);
  const snap = () => page.evaluate(() => ({
    dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null,
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    active: document.querySelectorAll("[data-rail-step][data-active]").length,
    translate: getComputedStyle(document.querySelector("[data-hero-copy]")).translate,
  }));
  const states = [];
  if (opts.scrollBefore) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
    await page.waitForTimeout(700);
  }
  states.push({ step: "start", ...(await snap()) });
  for (const action of opts.actions) {
    if (action === "reduce") await page.emulateMedia({ reducedMotion: "reduce" });
    if (action === "no-pref") await page.emulateMedia({ reducedMotion: "no-preference" });
    if (action === "scroll") { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.55)); }
    await page.waitForTimeout(opts.wait ?? 1500);
    states.push({ step: action, ...(await snap()) });
  }
  out.push({ name, states });
  await ctx.close();
}
for (let i = 0; i < 2; i++) {
  await scenario(`A-no-scroll-direct-reduce#${i}`, { actions: ["reduce"] });
  await scenario(`B-scroll-then-reduce#${i}`, { scrollBefore: true, actions: ["reduce"] });
  await scenario(`C-reduce-nopref-scroll-reduce#${i}`, { actions: ["reduce", "no-pref", "scroll", "reduce"] });
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
