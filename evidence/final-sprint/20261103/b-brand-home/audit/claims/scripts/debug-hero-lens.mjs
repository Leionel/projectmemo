// Debug: hero lens state after rapid stage switching.
import { chromium } from "playwright";
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(1200);
const tabs = page.locator("#home-heading [role=tab]");
console.log("tabs", await tabs.count());
for (let i = 0; i < 20; i++) await tabs.nth(i % 3).click();
await tabs.nth(2).click();
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("#home-heading button")).map((b) => ({ text: (b.textContent || "").trim().replace(/\s+/g, " "), ariaExpanded: b.getAttribute("aria-expanded"), visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length) }));
  const lens = document.querySelector("#home-heading [class*=lens]");
  return {
    buttons,
    lensClass: lens ? lens.className : null,
    lensHTML: lens ? lens.outerHTML.slice(0, 1500) : null,
    selected: document.querySelector('#home-heading [role=tab][aria-selected="true"]')?.textContent,
  };
});
console.log(JSON.stringify(info, null, 2));
const count = await page.getByRole("button", { name: /查看依据/ }).count();
console.log("getByRole count", count);
const textCount = await page.locator("#home-heading button").filter({ hasText: "查看依据" }).count();
console.log("hasText count", textCount);
await page.screenshot({ path: "evidence/final-sprint/20261103/b-brand-home/audit/claims/shots/debug-hero-after-rapid.png" });
await browser.close();
