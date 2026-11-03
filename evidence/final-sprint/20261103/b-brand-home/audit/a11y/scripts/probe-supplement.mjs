/**
 * Phase 1 补充探针（候选 SHA cc7c19f）：覆盖主探针在默认状态扫描不到的项。
 *  1) 五步第 3 步（判断页）内的小字号文本（共享 StateDiffView，Tailwind 11/12px）
 *  2) 展开「查看依据」后的原文区字号
 *  3) 浏览器字体放大 200%（root font-size 32px）下的溢出/裁切
 *  4) 320 宽滚动后 Hero 焦点环/CTA 是否被裁切、translate 是否造成横向溢出
 *  5) closingLink / 徽标 / 页头 CTA 的最终尺寸
 *
 * 用法（cwd = 工作树根）：
 *   node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-supplement.mjs \
 *     --base http://127.0.0.1:34111 --label after --sha cc7c19f
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

const results = {
  meta: { label: LABEL, sha: SHA, base: BASE, startedAt: new Date().toISOString(), note: "补充探针；非真实用户测试/认证。" },
  sections: {},
  errors: [],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
await page.addInitScript(() => {
  window.__a11y = {
    visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      if (parseFloat(cs.opacity) === 0) return false;
      return true;
    },
    pathOf(el) {
      const parts = [];
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 4) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += "#" + node.id;
        const cls = typeof node.className === "string" ? node.className.split(/\s+/).filter(Boolean) : [];
        if (cls.length) part += "." + cls.slice(0, 2).join(".");
        parts.unshift(part);
        node = node.parentElement;
        depth += 1;
      }
      return parts.join(" > ");
    },
    directText(el) {
      return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    },
    inAriaHidden(el) {
      let node = el;
      while (node) {
        if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
        node = node.parentElement;
      }
      return false;
    },
    byToken(token) {
      const suffix = "__" + token;
      return [...document.querySelectorAll("[class]")].find((el) => [...el.classList].some((c) => c === suffix || c.endsWith(suffix))) || null;
    },
  };
});
const goto = async (url) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(300);
};
const shot = async (name) => {
  const file = path.join(SHOTS, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(OUT, file).replaceAll("\\", "/");
};
const run = async (name, fn) => {
  try {
    results.sections[name] = await fn();
  } catch (error) {
    results.errors.push({ section: name, message: String(error && error.message ? error.message : error) });
  }
};

const scanSmall = async (scopeSelector) =>
  await page.evaluate((sel) => {
    const scope = document.querySelector(sel) || document.body;
    const rows = [];
    for (const el of scope.querySelectorAll("*")) {
      if (!window.__a11y.directText(el)) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (!window.__a11y.visible(el)) continue;
      if (window.__a11y.inAriaHidden(el)) continue;
      const cs = getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize);
      if (fontSize < 12.8) {
        const r = el.getBoundingClientRect();
        rows.push({ text: text.slice(0, 60), fontSize, path: window.__a11y.pathOf(el), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
      }
    }
    return rows;
  }, scopeSelector);

await run("judgmentStep", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(BASE + "/");
  await page.locator("#story-tab-2").click();
  await page.waitForTimeout(350);
  const small = await scanSmall("#story-panel");
  const measured = await page.evaluate(() => {
    const panel = document.getElementById("story-panel");
    const pick = (text) => {
      const el = [...panel.querySelectorAll("*")].find((node) => window.__a11y.directText(node) && (node.textContent || "").trim().includes(text));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60), fontSize: parseFloat(cs.fontSize), color: cs.color, bg: getComputedStyle(el.parentElement).backgroundColor, path: window.__a11y.pathOf(el) };
    };
    return {
      stateDiffSummary: pick("演示流程的当前完成情况还需要核对"),
      stateDiffAfter: pick("已有任务记录，但没有新的完成回执"),
      stateDiffBaseline: pick("比较基线"),
      evidenceChip: pick("记忆 · 原文"),
      suggestionText: pick("参赛材料需要演示"),
    };
  });
  const shotFile = await shot("judgment-step");
  return { small, measured, shotFile };
});

await run("evidenceExpanded", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(BASE + "/");
  const btn = page.locator("button[aria-controls='hero-evidence']");
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(400);
  const measured = await page.evaluate(() => {
    const wrap = document.getElementById("hero-evidence");
    const rows = [];
    for (const el of wrap.querySelectorAll("*")) {
      if (!window.__a11y.directText(el)) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      rows.push({ text: text.slice(0, 50), fontSize: parseFloat(cs.fontSize), path: window.__a11y.pathOf(el) });
    }
    return rows;
  });
  const small = await scanSmall("#hero-evidence");
  const shotFile = await shot("evidence-expanded-fonts");
  return { rows: measured, small, shotFile };
});

await run("fontZoom200", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(BASE + "/");
  const before = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll("main#main-content h1, main#main-content h2, main#main-content p, main#main-content button, main#main-content a")) {
      if (!window.__a11y.visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) clipped.push({ text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), right: Math.round(r.right), left: Math.round(r.left), path: window.__a11y.pathOf(el) });
    }
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      clipped: clipped.slice(0, 10),
      heroNoteFont: (() => {
        const el = window.__a11y.byToken("heroNote");
        return el ? parseFloat(getComputedStyle(el).fontSize) : null;
      })(),
      storyTabFont: (() => {
        const el = document.querySelector("#story-tab-0");
        return el ? parseFloat(getComputedStyle(el).fontSize) : null;
      })(),
    };
  });
  const shotFile = await shot("font-zoom-200");
  return { before, after, shotFile };
});

await run("heroScroll320", async () => {
  await page.setViewportSize({ width: 320, height: 640 });
  await goto(BASE + "/");
  await page.evaluate(() => window.scrollTo(0, 180));
  await page.waitForTimeout(400);
  const data = await page.evaluate(() => {
    const root = document.querySelector("main");
    const copy = window.__a11y.byToken("heroCopy");
    const lens = window.__a11y.byToken("lens");
    const cta = document.querySelector("a[href='#experience']");
    const stageTab = document.querySelector("#stage-tab-back");
    const out = { translate: { copy: copy ? getComputedStyle(copy).translate : null, lens: lens ? getComputedStyle(lens).translate : null }, heroShift: root ? getComputedStyle(root).getPropertyValue("--hero-shift").trim() : null, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, cta: null, stageTab: null };
    for (const [key, el] of [["cta", cta], ["stageTab", stageTab]]) {
      if (!el) continue;
      el.focus();
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      let clipped = false;
      let node = el.parentElement;
      while (node) {
        const ncs = getComputedStyle(node);
        if (ncs.overflow !== "visible") {
          const nr = node.getBoundingClientRect();
          if (r.top < nr.top || r.bottom > nr.bottom || r.left < nr.left || r.right > nr.right) {
            clipped = true;
            break;
          }
        }
        node = node.parentElement;
      }
      out[key] = { rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }, inViewport: r.top >= 0 && r.bottom <= innerHeight + 1, clipped, outline: cs.outlineStyle + " " + cs.outlineWidth, focusVisible: el.matches(":focus-visible") };
    }
    return out;
  });
  const shotFile = await shot("hero-scroll-320");
  return { data, shotFile };
});

await run("finalTargets", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(BASE + "/");
  const desktop = await page.evaluate(() => {
    const closingLink = document.querySelector("[class*=closingLink]");
    const badge = window.__a11y.byToken("lensStatus");
    const read = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || "").replace(/\s+/g, " ").trim(), fontSize: parseFloat(cs.fontSize), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    return { closingLink: read(closingLink), badge: read(badge) };
  });
  return desktop;
});

results.consoleErrors = consoleErrors;
results.meta.finishedAt = new Date().toISOString();
const outFile = path.join(JSONDIR, `supplement-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await context.close();
await browser.close();
console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
for (const e of results.errors) console.log(" - " + e.section + ": " + e.message);
