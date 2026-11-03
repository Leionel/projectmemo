/** 一次性诊断：确认顶部 provider 徽标（演示模式/云模型已配置）在 1440 是否可见，及 header.innerText 形态。 */
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:34111";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
  colorScheme: "light",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("#home-heading").waitFor();
await page.evaluate(() => document.fonts.ready);
const info = await page.evaluate(() => {
  const header = document.querySelector("header");
  const badge = [...document.querySelectorAll("header span")].find((el) => el.textContent?.trim() === "演示模式");
  const r = badge?.getBoundingClientRect();
  return {
    headerInnerText: header?.innerText ?? null,
    headerTextContent: header?.textContent ?? null,
    badgeFound: Boolean(badge),
    badgeText: badge?.textContent ?? null,
    badgeRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
    badgeDisplay: badge ? getComputedStyle(badge).display : null,
    badgeVisibility: badge ? getComputedStyle(badge).visibility : null,
    headerRect: header ? { w: header.getBoundingClientRect().width, h: header.getBoundingClientRect().height } : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await context.close();
await browser.close();
