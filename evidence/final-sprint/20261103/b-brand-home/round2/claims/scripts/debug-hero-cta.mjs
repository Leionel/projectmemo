// Debug: hero secondary CTA click behavior (checkpoint 4b69614).
import { chromium } from "playwright";
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}:${m.text().slice(0, 160)}`));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) logs.push(`nav:${f.url()}`); });
await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3500);
const info = await page.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll("main a[href='/login?from=%2Ffocus']"));
  return anchors.map((a, i) => {
    const r = a.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { i, text: (a.textContent || "").trim().replace(/\s+/g, " "), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, point: { cx, cy }, topTag: top?.tagName ?? null, topText: (top?.textContent || "").trim().slice(0, 60), topClass: top?.className ?? null, anchorContainsTop: a.contains(top) };
  });
});
const first = page.locator("main a[href='/login?from=%2Ffocus']").first();
await first.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
logs.length = 0;
await first.click();
await page.waitForTimeout(4000);
const after = { url: page.url(), title: await page.title(), logs: logs.slice(-10) };
console.log(JSON.stringify({ info, after }, null, 2));
await browser.close();
