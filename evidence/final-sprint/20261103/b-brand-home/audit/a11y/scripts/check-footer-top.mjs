import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://127.0.0.1:34111/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
const link = p.locator("nav[aria-label='页脚'] a[href='#home-heading']");
const before = await p.evaluate(() => Math.round(window.scrollY));
await link.scrollIntoViewIfNeeded();
await link.click();
await p.waitForTimeout(1200);
const after = await p.evaluate(() => {
  const h1 = document.querySelector("h1");
  const r = h1 ? h1.getBoundingClientRect() : null;
  return { hash: location.hash, scrollY: Math.round(window.scrollY), h1Top: r ? Math.round(r.top) : null, h1Visible: r ? r.top >= 0 && r.bottom <= innerHeight : null, headerBottom: Math.round(document.querySelector("header").getBoundingClientRect().bottom) };
});
console.log(JSON.stringify({ before, after }, null, 1));
await p.screenshot({ path: "evidence/final-sprint/20261103/b-brand-home/audit/a11y/shots/after-footer-top.png" });
await b.close();
