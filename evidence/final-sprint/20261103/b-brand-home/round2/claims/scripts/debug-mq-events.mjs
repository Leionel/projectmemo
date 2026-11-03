// Debug: raw matchMedia change events across toggles + facade click reliability.
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:34111";
const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__mqEvents = [];
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", (e) => window.__mqEvents.push({ matches: e.matches, at: Date.now() }));
  });
  const states = [];
  const snap = async (label) => states.push({ label, ...(await page.evaluate(() => ({ dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null, matches: matchMedia("(prefers-reduced-motion: reduce)").matches, events: window.__mqEvents.slice() }))) });
  await snap("start");
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(1200); await snap("after-reduce-1");
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForTimeout(1200); await snap("after-nopref");
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(1200); await snap("after-reduce-2");
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForTimeout(1200); await snap("after-nopref-2");
  console.log(JSON.stringify(states, null, 2));

  // facade click reliability on same page
  const facade = page.locator("#demo button[aria-label*='播放']").first();
  console.log("facade count", await facade.count());
  await facade.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await facade.click();
  await page.waitForTimeout(1000);
  console.log("iframe1", await page.locator("#demo iframe").count());
  await page.waitForTimeout(3000);
  console.log("iframe2", await page.locator("#demo iframe").count(), "src", await page.locator("#demo iframe").first().getAttribute("src").catch(() => null));
  await ctx.close();
}
await browser.close();
