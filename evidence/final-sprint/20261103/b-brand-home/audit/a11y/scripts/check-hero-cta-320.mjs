import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const c = await b.newContext({ viewport: { width: 320, height: 640 } });
const p = await c.newPage();
await p.goto("http://127.0.0.1:34111/", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
const before = await p.evaluate(() =>
  [...document.querySelectorAll('a[href="#experience"]')].map((el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { i, text: (el.textContent || "").trim().slice(0, 20), rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }, display: cs.display };
  })
);
const focused = await p.evaluate(() => {
  const el = document.querySelector('main a[href="#experience"]');
  el.scrollIntoView({ block: "center" });
  el.focus();
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    text: (el.textContent || "").trim().slice(0, 20),
    rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
    outline: cs.outlineStyle + " " + cs.outlineWidth,
    focusVisible: el.matches(":focus-visible"),
    inViewport: r.top >= 0 && r.bottom <= innerHeight,
    scrollY: Math.round(window.scrollY),
  };
});
console.log(JSON.stringify({ before, focused }, null, 1));
await p.screenshot({ path: "evidence/final-sprint/20261103/b-brand-home/audit/a11y/shots/after-hero-cta-320.png" });
await b.close();
