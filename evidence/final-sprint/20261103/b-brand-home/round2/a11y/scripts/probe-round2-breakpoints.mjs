/**
 * Round 2 补充：360/320/720×450(200% 等效) 断点巡检（字号/触控/溢出/内容可见）。
 * 用法：node .../probe-round2-breakpoints.mjs --base http://127.0.0.1:34111 --label round2 --sha 4b69614
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

const results = { meta: { label: LABEL, sha: SHA, base: BASE, startedAt: new Date().toISOString() }, viewports: {}, errors: [] };
const browser = await chromium.launch({ headless: true });

const IN_PAGE = `
  window.__a11y = {
    visible(el) { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false; let n = el; while (n) { if (n.hidden) return false; n = n.parentElement; } return true; },
    directText(el) { return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); },
    inAriaHidden(el) { let n = el; while (n) { if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return true; n = n.parentElement; } return false; },
  };
`;

for (const vp of [
  { name: "360x740", width: 360, height: 740 },
  { name: "320x640", width: 320, height: 640 },
  { name: "720x450(200%)", width: 720, height: 450 },
]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  await page.addInitScript(IN_PAGE);
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(450);
    const data = await page.evaluate(() => {
      const read = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { id: el.id || "", text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30), fontSize: parseFloat(cs.fontSize), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, under44: r.width < 44 || r.height < 44 };
      };
      const small = [];
      for (const el of document.querySelectorAll("main#main-content *")) {
        if (!window.__a11y.directText(el)) continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || !window.__a11y.visible(el) || window.__a11y.inAriaHidden(el)) continue;
        const fs2 = parseFloat(getComputedStyle(el).fontSize);
        if (fs2 < 12.8) small.push({ text: t.slice(0, 50), fontSize: fs2 });
      }
      const heroCta = document.querySelector("main a[href='#experience']");
      const stageTab = document.querySelector("#stage-tab-back");
      const headerCta = document.querySelector("header nav a[href='/focus']");
      const targets = {
        storyTabs: [...document.querySelectorAll('[role="tab"][id^="story-tab"]')].map(read),
        stageTabs: [...document.querySelectorAll('[role="tab"][id^="stage-tab"]')].map(read),
        prevNext: [...document.querySelectorAll("button[aria-label='上一步'], button[aria-label='下一步']")].map(read),
        headerCta: read(headerCta),
        heroCta: read(heroCta),
        sourceButton: read(document.querySelector("button[aria-label^='查看原文']")),
        videoLink: read(document.querySelector("a[href*='bilibili']")),
        footerExternal: read(document.querySelector("nav[aria-label='页脚'] a[href*='bilibili']")),
      };
      return {
        innerWidth: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        smallCount: small.length,
        small: small.slice(0, 8),
        targets,
        heroCtaVisible: window.__a11y.visible(heroCta),
        stageTabVisible: window.__a11y.visible(stageTab),
        storyPanelVisible: window.__a11y.visible(document.getElementById("story-panel")),
        h1Visible: window.__a11y.visible(document.querySelector("h1")),
        headerHeight: Math.round(document.querySelector("header").getBoundingClientRect().height),
      };
    });
    const shotFile = path.join(SHOTS, `${LABEL}-breakpoint-${vp.name.replaceAll(/[()%]/g, "_")}.png`);
    await page.screenshot({ path: shotFile });
    results.viewports[vp.name] = { ...data, shotFile: path.relative(OUT, shotFile).replaceAll("\\", "/") };
  } catch (error) {
    results.errors.push({ viewport: vp.name, message: String(error && error.message ? error.message : error) });
  }
  await context.close();
}

results.meta.finishedAt = new Date().toISOString();
const outFile = path.join(JSONDIR, `breakpoints-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await browser.close();
console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
