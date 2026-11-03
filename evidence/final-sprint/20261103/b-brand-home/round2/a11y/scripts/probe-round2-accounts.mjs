/**
 * Round 2 补充：账号页浅/深 × 1440/390（用 initScript 固化主题，避免主探针里
 * “先设 localStorage 再 goto”被 next-themes 首帧覆盖的竞态）。
 * 另记录账号页表单/标题/页头与 A 合入后的运行时状态。
 *
 * 用法：node .../probe-round2-accounts.mjs --base http://127.0.0.1:34111 --label round2 --sha 4b69614
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const eq = argv.find((item) => item.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:34111").replace(/\/$/, "");
const OUT = path.resolve(arg("out", "evidence/final-sprint/20261103/b-brand-home/round2/a11y"));
const LABEL = arg("label", "round2");
const SHA = arg("sha", "");
const SHOTS = path.join(OUT, "shots");
const JSONDIR = path.join(OUT, "json");
fs.mkdirSync(SHOTS, { recursive: true });

const results = { meta: { label: LABEL, sha: SHA, base: BASE, startedAt: new Date().toISOString(), note: "Round 2 账号页补充取证（initScript 固化主题）。" }, pages: {}, errors: [] };
const browser = await chromium.launch({ headless: true });

for (const theme of ["light", "dark"]) {
  for (const route of ["/login", "/register", "/forgot-password"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme === "dark" ? "dark" : "light",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(500);
      const desktop = await page.evaluate(() => {
        const header = document.querySelector("header");
        const main = document.querySelector("main");
        const nav = header?.querySelector("nav");
        const cta = nav?.querySelector("a");
        const ctaCs = cta ? getComputedStyle(cta) : null;
        const ctaR = cta ? cta.getBoundingClientRect() : null;
        const hr = header ? header.getBoundingClientRect() : null;
        const mr = main ? main.getBoundingClientRect() : null;
        return {
          title: document.title,
          htmlClass: document.documentElement.className,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          header: header ? { height: Math.round(hr.height), position: getComputedStyle(header).position, bg: getComputedStyle(header).backgroundColor } : null,
          main: main ? { id: main.id, top: Math.round(mr.top), width: Math.round(mr.width) } : null,
          nav: nav ? { label: nav.getAttribute("aria-label"), links: [...nav.querySelectorAll("a")].map((a) => (a.textContent || "").trim()) } : null,
          cta: cta ? { text: (cta.textContent || "").trim(), fontSize: parseFloat(ctaCs.fontSize), h: Math.round(ctaR.height), w: Math.round(ctaR.width) } : null,
          leak: { homeMain: !!document.querySelector("main[class*=home-module]"), hero: !!document.querySelector("[class*=heroInner]"), storyFrame: !!document.querySelector("[class*=storyFrame]") },
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          formFields: [...document.querySelectorAll("input")].map((i) => ({ type: i.getAttribute("type"), id: i.id, label: i.labels?.[0]?.textContent?.trim() || null })),
          headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.tagName.toLowerCase() + ":" + (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)),
          skipTarget: (() => { const s = document.querySelector(".skip-link"); return s ? !!document.querySelector(s.getAttribute("href")) : null; })(),
          themeToggle: document.querySelectorAll('[aria-label="切换深浅色主题"]').length,
        };
      });
      const shotDesktop = path.join(SHOTS, `${LABEL}-account-${theme}${route.replaceAll("/", "-")}-1440.png`);
      await page.screenshot({ path: shotDesktop });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const mobile = await page.evaluate(() => {
        const header = document.querySelector("header");
        const cta = header?.querySelector("nav a");
        const cs = cta ? getComputedStyle(cta) : null;
        const r = cta ? cta.getBoundingClientRect() : null;
        return {
          headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
          cta: cta ? { text: (cta.textContent || "").trim(), fontSize: parseFloat(cs.fontSize), h: Math.round(r.height), w: Math.round(r.width) } : null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          formFields: document.querySelectorAll("input").length,
          mainTop: Math.round(document.querySelector("main").getBoundingClientRect().top),
        };
      });
      const shotMobile = path.join(SHOTS, `${LABEL}-account-${theme}${route.replaceAll("/", "-")}-390.png`);
      await page.screenshot({ path: shotMobile });
      results.pages[`${theme}:${route}`] = {
        desktop,
        mobile,
        consoleErrors,
        shotDesktop: path.relative(OUT, shotDesktop).replaceAll("\\", "/"),
        shotMobile: path.relative(OUT, shotMobile).replaceAll("\\", "/"),
      };
    } catch (error) {
      results.errors.push({ theme, route, message: String(error && error.message ? error.message : error) });
    }
    await context.close();
  }
}

results.meta.finishedAt = new Date().toISOString();
const outFile = path.join(JSONDIR, `accounts-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await browser.close();
console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
