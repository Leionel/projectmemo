/**
 * F-01 复验探针（最终候选 SHA 9bae926）：
 *  1) 五步第 3 步 judgment 区域 11/12px 文本清零、关键文本计算字号 = 12.8px
 *  2) 1440 / 390 / 320 + 深色主题下同样复验
 *  3) role="group" + aria-label 的可访问名称（Hero 工作包 / 五步示例框）
 *  4) 放大后对比度、无水平溢出
 *
 * 用法：node .../probe-f01-reverify.mjs --base http://127.0.0.1:34111 --label after --sha 9bae926
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
const OUT = path.resolve(arg("out", "evidence/final-sprint/20261103/b-brand-home/audit/a11y"));
const LABEL = arg("label", "after");
const SHA = arg("sha", "");
const SHOTS = path.join(OUT, "shots");
const JSONDIR = path.join(OUT, "json");
fs.mkdirSync(SHOTS, { recursive: true });

const results = { meta: { label: LABEL, sha: SHA, base: BASE, startedAt: new Date().toISOString(), note: "F-01 复验；非真实用户测试/认证。" }, sections: {}, errors: [] };

const browser = await chromium.launch({ headless: true });
const IN_PAGE = `
  window.__a11y = (() => {
    const parseColor = (value) => {
      const str = String(value);
      const m = str.match(/rgba?\\(([^)]+)\\)/);
      if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
      const srgb = str.match(/color\\(srgb\\s+([^)]+)\\)/);
      if (srgb) { const p = srgb[1].split(/[\\s\\/]+/).filter(Boolean).map(Number); return { r: Math.round(p[0]*255), g: Math.round(p[1]*255), b: Math.round(p[2]*255), a: p.length > 3 ? p[3] : 1 }; }
      return null;
    };
    const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
    const blend = (fg, bg) => ({ r: Math.round(fg.r*fg.a + bg.r*(1-fg.a)), g: Math.round(fg.g*fg.a + bg.g*(1-fg.a)), b: Math.round(fg.b*fg.a + bg.b*(1-fg.a)), a: 1 });
    const effectiveBg = (el) => { let node = el; const layers = []; while (node && node !== document.documentElement) { const cs = getComputedStyle(node); const c = parseColor(cs.backgroundColor); if (c && c.a > 0.001) layers.push(c); node = node.parentElement; } const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r:255,g:255,b:255,a:1 }; let bg = body; for (let i = layers.length-1; i >= 0; i -= 1) bg = blend(layers[i], bg); return bg; };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2); return (hi+0.05)/(lo+0.05); };
    const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false; let node = el; while (node) { if (node.hidden) return false; node = node.parentElement; } return true; };
    const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const inAriaHidden = (el) => { let node = el; while (node) { if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true; node = node.parentElement; } return false; };
    const styleOf = (el) => { const cs = getComputedStyle(el); const fg = parseColor(cs.color) || { r:0,g:0,b:0,a:1 }; const bg = effectiveBg(el); const solid = fg.a < 1 ? blend(fg, bg) : fg; const r = el.getBoundingClientRect(); return { text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70), fontSize: parseFloat(cs.fontSize), color: cs.color, bg: \`rgb(\${bg.r}, \${bg.g}, \${bg.b})\`, contrast: Number(ratio(solid, bg).toFixed(2)), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; };
    const pathOf = (el) => { const parts = []; let node = el; let depth = 0; while (node && node.nodeType === 1 && depth < 4) { let part = node.tagName.toLowerCase(); if (node.id) part += "#" + node.id; const cls = typeof node.className === "string" ? node.className.split(/\\s+/).filter(Boolean) : []; if (cls.length) part += "." + cls.slice(0, 2).join("."); parts.unshift(part); node = node.parentElement; depth += 1; } return parts.join(" > "); };
    return { parseColor, effectiveBg, ratio, visible, directText, inAriaHidden, styleOf, pathOf };
  })();
`;

const run = async (name, fn) => {
  try {
    results.sections[name] = await fn();
  } catch (error) {
    results.errors.push({ section: name, message: String(error && error.message ? error.message : error) });
  }
};

const scanJudgment = async (page) =>
  await page.evaluate(() => {
    const panel = document.getElementById("story-panel");
    if (!panel) return { found: false };
    const small = [];
    const rows = [];
    for (const el of panel.querySelectorAll("*")) {
      if (!window.__a11y.directText(el)) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (!window.__a11y.visible(el)) continue;
      if (window.__a11y.inAriaHidden(el)) continue;
      const style = window.__a11y.styleOf(el);
      if (style.fontSize < 12.8) small.push({ ...style, path: window.__a11y.pathOf(el) });
      rows.push({ ...style, path: window.__a11y.pathOf(el) });
    }
    const pane = panel.querySelector("[class*=judgmentPane]");
    return {
      found: true,
      smallCount: small.length,
      small,
      keyTexts: rows.filter((r) => /比较基线|待确认|依据 \d+ 项|当前完成情况还需要核对|没有新的完成回执|记忆 · 原文/.test(r.text)),
      judgmentPane: pane
        ? { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, paneWidth: Math.round(pane.getBoundingClientRect().width) }
        : null,
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });

const goto = async (page, url) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);
};
const shot = async (page, name) => {
  const file = path.join(SHOTS, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(OUT, file).replaceAll("\\", "/");
};

// 1) 浅色：1440 / 390 / 320 第 3 步
for (const vp of [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x640", width: 320, height: 640 },
]) {
  await run(`judgment_${vp.name}`, async () => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const page = await context.newPage();
    await page.addInitScript(IN_PAGE);
    await goto(page, BASE + "/");
    await page.locator("#story-tab-2").click();
    await page.waitForTimeout(400);
    const data = await scanJudgment(page);
    const shotFile = await shot(page, `f01-judgment-${vp.name}`);
    await context.close();
    return { ...data, shotFile };
  });
}

// 2) 深色 1440 第 3 步
await run("judgment_dark_1440", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "dark");
    } catch {}
  });
  const page = await context.newPage();
  await page.addInitScript(IN_PAGE);
  await goto(page, BASE + "/");
  await page.locator("#story-tab-2").click();
  await page.waitForTimeout(400);
  const data = await scanJudgment(page);
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  const shotFile = await shot(page, "f01-judgment-dark-1440");
  await context.close();
  return { htmlClass, ...data, shotFile };
});

// 3) role=group 与可访问名称
await run("groupRoles", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  await page.addInitScript(IN_PAGE);
  await goto(page, BASE + "/");
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll("[role=group]")].map((el) => ({ tag: el.tagName.toLowerCase(), label: el.getAttribute("aria-label"), path: window.__a11y.pathOf(el) }))
  );
  const ariaLabelOnGeneric = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-label]")]
      .filter((el) => {
        const role = el.getAttribute("role");
        const interactive = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(el.tagName);
        const landmark = ["main", "nav", "aside", "header", "footer", "section", "form", "dialog"].includes(el.tagName.toLowerCase());
        return !interactive && !landmark && !role;
      })
      .map((el) => ({ path: window.__a11y.pathOf(el), label: el.getAttribute("aria-label") }))
  );
  const lensAria = await page.locator('[role=group][aria-label*="公开示例"]').ariaSnapshot().catch(() => null);
  const storyAria = await page.locator('[role=group][aria-label*="参赛项目交互示例"]').ariaSnapshot().catch(() => null);
  await context.close();
  return { groups, ariaLabelOnGeneric, lensAria: (lensAria || "").slice(0, 300), storyAria: (storyAria || "").slice(0, 300) };
});

results.meta.finishedAt = new Date().toISOString();
const outFile = path.join(JSONDIR, `f01-reverify-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await browser.close();
console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
for (const e of results.errors) console.log(" - " + e.section + ": " + e.message);
