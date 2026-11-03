/**
 * Track B Round 2 独立复验探针（候选源码 SHA 4b69614）。
 *
 * 覆盖 Lead 指定的第二批重点：
 *  1) prefers-reduced-motion 运行时热切换（3 个来回 + 初始 reduce）
 *  2) Hero 三阶段状态文案（无需操作/核对示例/等你确认）与 tab 语义
 *  3) 回归：键盘全路径、dialog、skip link、锚点、断点/200%、浅/深对比度、账号页浅/深、外链
 *  4) 合并 A 代码后官网/账号页未受影响
 *
 * 只读页面；只写 round2/a11y/。非真实用户测试、非无障碍认证。
 *
 * 用法（cwd = 工作树根）：
 *   node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/probe-round2.mjs \
 *     --base http://127.0.0.1:34111 --label round2 --sha 4b69614
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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
fs.mkdirSync(JSONDIR, { recursive: true });

const results = {
  meta: {
    label: LABEL,
    sha: SHA,
    base: BASE,
    startedAt: new Date().toISOString(),
    node: process.version,
    playwright: JSON.parse(fs.readFileSync("node_modules/playwright/package.json", "utf8")).version,
    note: "Round 2 自动化 DOM/计算样式取证；非真实用户测试、非无障碍认证。",
  },
  sections: {},
  errors: [],
};

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

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
    const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false; let node = el; while (node) { if (node.hidden) return false; node = node.parentElement; } return true; };
    const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const inAriaHidden = (el) => { let node = el; while (node) { if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true; node = node.parentElement; } return false; };
    const byToken = (token) => { const suffix = "__" + token; return [...document.querySelectorAll("[class]")].find((el) => [...el.classList].some((c) => c === suffix || c.endsWith(suffix))) || null; };
    const styleOf = (el) => { const cs = getComputedStyle(el); const fg = parseColor(cs.color) || { r:0,g:0,b:0,a:1 }; const bg = effectiveBg(el); const solid = fg.a < 1 ? blend(fg, bg) : fg; const r = el.getBoundingClientRect(); return { text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70), fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight) || 400, color: cs.color, bg: \`rgb(\${bg.r}, \${bg.g}, \${bg.b})\`, contrast: Number(ratio(solid, bg).toFixed(2)), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; };
    const pathOf = (el) => { const parts = []; let node = el; let depth = 0; while (node && node.nodeType === 1 && depth < 4) { let part = node.tagName.toLowerCase(); if (node.id) part += "#" + node.id; const cls = typeof node.className === "string" ? node.className.split(/\\s+/).filter(Boolean) : []; if (cls.length) part += "." + cls.slice(0, 2).join("."); parts.unshift(part); node = node.parentElement; depth += 1; } return parts.join(" > "); };
    const mainTextLength = () => (document.querySelector("main")?.innerText || "").replace(/\\s+/g, " ").trim().length;
    const motionState = () => {
      const root = document.querySelector("main");
      const hero = document.querySelector("[data-hero]");
      const heroCopy = document.querySelector("[data-hero-copy]");
      const heroLens = document.querySelector("[data-hero-lens]");
      const progress = document.querySelector("[data-scroll-progress]");
      const rail = document.querySelector("[data-rail]");
      const railProgress = byToken("railProgress");
      const steps = [...document.querySelectorAll("[data-rail-step]")];
      const cs = (el) => (el ? { translate: getComputedStyle(el).translate, transform: getComputedStyle(el).transform } : null);
      return {
        dataMotion: root ? root.getAttribute("data-motion") : null,
        heroShift: hero ? getComputedStyle(hero).getPropertyValue("--hero-shift").trim() : null,
        heroShiftInline: hero ? hero.style.getPropertyValue("--hero-shift") : null,
        heroCopy: cs(heroCopy),
        heroLens: cs(heroLens),
        progressTransform: progress ? getComputedStyle(progress).transform : null,
        progressInline: progress ? progress.style.transform : null,
        progressDataVisible: progress ? progress.hasAttribute("data-visible") : null,
        railProgressValue: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() : null,
        railProgressInline: rail ? rail.style.getPropertyValue("--rail-progress") : null,
        railProgressTransform: railProgress ? getComputedStyle(railProgress).transform : null,
        activeSteps: steps.map((s) => s.hasAttribute("data-active")),
        activeCount: steps.filter((s) => s.hasAttribute("data-active")).length,
        scrollY: Math.round(window.scrollY),
        mainTextLength: mainTextLength(),
        h1Visible: visible(document.querySelector("h1")),
        heroCtaVisible: visible(document.querySelector("main a[href='#experience']")),
        storyTabVisible: visible(document.querySelector("#story-tab-0")),
        stepPanelVisible: visible(document.getElementById("story-panel")),
        runningAnimations: document.getAnimations().length,
      };
    };
    return { parseColor, effectiveBg, ratio, visible, directText, inAriaHidden, byToken, styleOf, pathOf, mainTextLength, motionState };
  })();
`;

const browser = await chromium.launch({ headless: true });
const consoleErrors = [];

const newPage = async (options = {}) => {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
    reducedMotion: options.reducedMotion || "no-preference",
    colorScheme: options.colorScheme || "light",
    javaScriptEnabled: options.javaScriptEnabled !== false,
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  if (options.initScript) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 240) });
  });
  page.on("pageerror", (err) => consoleErrors.push({ url: page.url(), text: "pageerror: " + String(err).slice(0, 240) }));
  await page.addInitScript(IN_PAGE);
  return { context, page };
};

const goto = async (page, url = BASE + "/", wait = "networkidle") => {
  await page.goto(url, { waitUntil: wait, timeout: 60000 });
  await page.waitForTimeout(350);
};
const shot = async (page, name) => {
  const file = path.join(SHOTS, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(OUT, file).replaceAll("\\", "/");
};
const run = async (name, fn) => {
  try {
    results.sections[name] = await fn();
  } catch (error) {
    results.errors.push({ section: name, message: String(error && error.stack ? error.stack : error).slice(0, 1600) });
    results.sections[name] = { error: String(error && error.message ? error.message : error) };
  }
};
const scrollTo = async (page, y) => {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  await page.waitForTimeout(350);
};
const state = async (page) => await page.evaluate(() => window.__a11y.motionState());

/* ------------------------------------------------------------------ */
/* 1. Hero 三阶段状态文案 + tab 语义 + 键盘                              */
/* ------------------------------------------------------------------ */
const STAGE_EXPECT = [
  { id: "away", label: "离开时", status: "无需操作" },
  { id: "during", label: "期间", status: "核对示例" },
  { id: "back", label: "回来后", status: "等你确认" },
];

async function testStageStatus(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const read = async () =>
    await page.evaluate(() => {
      const chip = window.__a11y.byToken("lensStatus");
      const tabs = [...document.querySelectorAll('[role="tab"][id^="stage-tab"]')];
      const panel = document.getElementById("stage-panel");
      return {
        chipText: chip ? (chip.textContent || "").replace(/\s+/g, " ").trim() : null,
        chipTag: chip ? chip.tagName.toLowerCase() : null,
        chipRole: chip ? chip.getAttribute("role") : null,
        chipTabIndex: chip ? chip.tabIndex : null,
        selected: tabs.filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.id),
        tabIndexes: tabs.map((t) => t.id + ":" + t.getAttribute("tabindex")),
        panelLabelledBy: panel ? panel.getAttribute("aria-labelledby") : null,
        panelTabIndex: panel ? panel.getAttribute("tabindex") : null,
        tablistLabel: document.querySelector('[role="tablist"][aria-label*="委托阶段"]')?.getAttribute("aria-label"),
        tablistOrientation: document.querySelector('[role="tablist"][aria-label*="委托阶段"]')?.getAttribute("aria-orientation"),
        statusNodes: [...document.querySelectorAll('[role="status"],[aria-live]')].map((el) => ({ role: el.getAttribute("role"), live: el.getAttribute("aria-live"), text: (el.textContent || "").trim().slice(0, 60) })),
        panelKeyText: panel ? (panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : null,
        active: { tag: document.activeElement.tagName.toLowerCase(), id: document.activeElement.id },
        scrollY: Math.round(window.scrollY),
      };
    });

  const initial = await read();
  const perStage = {};
  for (const stage of STAGE_EXPECT) {
    await page.locator(`#stage-tab-${stage.id}`).click();
    await page.waitForTimeout(350);
    perStage[stage.id] = await read();
    await shot(page, `stage-${stage.id}`);
  }
  // 键盘：方向键 / Home / End
  const keyboard = [];
  await page.locator("#stage-tab-back").focus();
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "End", "Home"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(220);
    const s = await read();
    keyboard.push({ key, selected: s.selected, chipText: s.chipText, activeId: s.active.id, panelLabelledBy: s.panelLabelledBy });
  }
  const chipAria = await page.evaluate(() => {
    const chip = window.__a11y.byToken("lensStatus");
    return chip ? chip.outerHTML.slice(0, 220) : null;
  });
  return {
    initial,
    perStage,
    expected: Object.fromEntries(STAGE_EXPECT.map((s) => [s.id, s.status])),
    statusMatch: Object.fromEntries(STAGE_EXPECT.map((s) => [s.id, perStage[s.id]?.chipText === s.status])),
    keyboard,
    chipAria,
  };
}

/* ------------------------------------------------------------------ */
/* 2. reduced-motion 运行时热切换（3 个来回）+ 初始 reduce               */
/* ------------------------------------------------------------------ */
async function testReducedHotSwitch(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const steps = [];
  const record = async (label) => {
    const s = await state(page);
    steps.push({ label, ...s });
    return s;
  };

  await scrollTo(page, 800);
  const normalAtScroll = await record("normal@scroll800");
  await shot(page, "hot-normal-scroll800");

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(450);
    const reduced = await record(`cycle${cycle}:reduce`);
    await shot(page, `hot-reduce-cycle${cycle}`);
    // reduced 下继续滚动，数值应保持 0 / none
    await scrollTo(page, 1400);
    const reducedAfterScroll = await record(`cycle${cycle}:reduce-after-scroll`);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(450);
    await scrollTo(page, 900 + cycle * 120);
    const restored = await record(`cycle${cycle}:normal-restored`);
    await shot(page, `hot-normal-restored-cycle${cycle}`);
  }

  // 恢复后滚动可重新更新（两个不同滚动位置 --hero-shift 不同）
  await scrollTo(page, 400);
  const shiftA = await record("normal:scroll400");
  await scrollTo(page, 1200);
  const shiftB = await record("normal:scroll1200");

  // 内容完整性与交互可用性（热切换后）
  const content = await page.evaluate(() => {
    const main = document.querySelector("main");
    const required = ["人可以下线", "项目别掉线", "体验一段项目接续", "公开示例", "查看依据", "查看记录", "填写回执", "看一遍决赛演示"];
    const text = (main?.innerText || "").replace(/\s+/g, " ");
    return {
      mainTextLength: text.length,
      missing: required.filter((s) => !text.includes(s)),
      storyTabs: document.querySelectorAll('[role="tab"][id^="story-tab"]').length,
      stageTabs: document.querySelectorAll('[role="tab"][id^="stage-tab"]').length,
    };
  });
  await page.locator("#story-tab-2").click();
  await page.waitForTimeout(300);
  const demoAfterSwitch = await page.evaluate(() => ({
    panelTitle: (document.getElementById("story-panel")?.querySelector("h4") || {}).textContent || null,
    selected: [...document.querySelectorAll('[role="tab"][id^="story-tab"][aria-selected="true"]')].map((t) => t.id),
  }));
  await page.locator("#stage-tab-away").click();
  await page.waitForTimeout(250);
  const stageAfterSwitch = await page.evaluate(() => {
    const chip = window.__a11y.byToken("lensStatus");
    return { chipText: (chip?.textContent || "").trim(), selected: [...document.querySelectorAll('[role="tab"][id^="stage-tab"][aria-selected="true"]')].map((t) => t.id) };
  });
  const evidence = await (async () => {
    const btn = page.locator("button[aria-controls='hero-evidence']");
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => ({
      expanded: document.querySelector("button[aria-controls='hero-evidence']")?.getAttribute("aria-expanded"),
      items: document.getElementById("hero-evidence")?.querySelectorAll("li").length,
      activeTag: document.activeElement.tagName.toLowerCase(),
    }));
    await btn.click();
    await page.waitForTimeout(200);
    return d;
  })();
  const shotFile = await shot(page, "hot-final-normal");
  return { steps, shiftA: shiftA.heroShift, shiftB: shiftB.heroShift, content, demoAfterSwitch, stageAfterSwitch, evidence, shotFile };
}

async function testInitialReduced() {
  const { context, page } = await newPage({ reducedMotion: "reduce" });
  await goto(page);
  const initial = await state(page);
  const content = await page.evaluate(() => {
    const main = document.querySelector("main");
    const text = (main?.innerText || "").replace(/\s+/g, " ");
    return {
      mainTextLength: text.length,
      missing: ["人可以下线", "项目别掉线", "体验一段项目接续", "公开示例", "查看依据", "查看记录", "填写回执"].filter((s) => !text.includes(s)),
    };
  });
  await scrollTo(page, 1200);
  const afterScroll = await state(page);
  await page.locator("#stage-tab-during").click();
  await page.waitForTimeout(250);
  const stage = await page.evaluate(() => ({
    chipText: (window.__a11y.byToken("lensStatus")?.textContent || "").trim(),
    selected: [...document.querySelectorAll('[role="tab"][id^="stage-tab"][aria-selected="true"]')].map((t) => t.id),
  }));
  const shotFile = await shot(page, "initial-reduced");
  await context.close();
  return { initial, afterScroll, content, stage, shotFile };
}

/* ------------------------------------------------------------------ */
/* 3. 回归：键盘 / skip link / tabs / dialog / anchors / overflow       */
/* ------------------------------------------------------------------ */
async function testKeyboardPath(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const sequence = [];
  for (let i = 0; i < 22; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(70);
    sequence.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: "body" };
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
          href: el.getAttribute("href"),
          outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
          focusVisible: el.matches(":focus-visible"),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      })
    );
    if (i === 0) await shot(page, "keyboard-skip-link");
  }
  return { sequence };
}

async function testSkipLink(page) {
  const rows = [];
  for (const vp of [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "390x844", width: 390, height: 844 },
    { name: "720x450(200%)", width: 720, height: 450 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim(), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => {
      const main = document.querySelector("main");
      const header = document.querySelector("header");
      const pos = document.querySelector("[class*=positioning]");
      const h1 = document.querySelector("h1");
      return {
        hash: location.hash,
        activeTag: document.activeElement.tagName.toLowerCase(),
        mainHasFocus: document.activeElement === main,
        mainTabIndex: main.getAttribute("tabindex"),
        headerBottom: Math.round(header.getBoundingClientRect().bottom),
        firstTextTop: pos ? Math.round(pos.getBoundingClientRect().top) : null,
        h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        covered: pos ? Math.round(pos.getBoundingClientRect().top) < Math.round(header.getBoundingClientRect().bottom) : null,
        scrollY: Math.round(window.scrollY),
      };
    });
    rows.push({ viewport: vp.name, focused, after });
  }
  return rows;
}

async function testStoryTabs(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const read = async () =>
    await page.evaluate(() => {
      const panel = document.getElementById("story-panel");
      return {
        selected: [...document.querySelectorAll('[role="tab"][id^="story-tab"][aria-selected="true"]')].map((t) => t.id),
        tabIndexes: [...document.querySelectorAll('[role="tab"][id^="story-tab"]')].map((t) => t.id + ":" + t.getAttribute("tabindex")),
        panelLabelledBy: panel?.getAttribute("aria-labelledby"),
        panelTitle: panel?.querySelector("h4")?.textContent || null,
        activeId: document.activeElement.id || null,
      };
    });
  const initial = await read();
  await page.locator("#story-tab-0").focus();
  const keys = [];
  for (const key of ["ArrowRight", "ArrowRight", "End", "Home", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(160);
    keys.push({ key, ...(await read()) });
  }
  return { initial, keys };
}

async function testDialog(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const trigger = page.getByRole("button", { name: "查看原文：任务安排" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.click();
  await page.waitForTimeout(350);
  const opened = await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    return {
      open: dialog?.open,
      modal: dialog ? dialog.matches(":modal") : null,
      labelledby: dialog?.getAttribute("aria-labelledby"),
      labelText: (document.getElementById("source-title")?.textContent || "").trim(),
      overflowY: dialog ? getComputedStyle(dialog).overflowY : null,
      active: { tag: document.activeElement.tagName.toLowerCase(), label: document.activeElement.getAttribute("aria-label") },
    };
  });
  const aria = await page.locator("dialog").ariaSnapshot();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), label: document.activeElement.getAttribute("aria-label") }));
  await trigger.click();
  await page.waitForTimeout(250);
  await page.mouse.click(6, 6);
  await page.waitForTimeout(300);
  const afterBackdrop = await page.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), label: document.activeElement.getAttribute("aria-label") }));
  await trigger.click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "关闭原始记录" }).click();
  await page.waitForTimeout(300);
  const afterClose = await page.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), label: document.activeElement.getAttribute("aria-label") }));
  // 长回执 + 200% 缩放
  await page.setViewportSize({ width: 720, height: 450 });
  await goto(page);
  await page.locator("#story-tab-3").click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "在示例中确认行动" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "去填写模拟回执" }).click();
  await page.waitForTimeout(200);
  await page.locator("#demo-receipt").fill("模拟回执长文测试。".repeat(40).slice(0, 500));
  await page.getByRole("button", { name: "保存模拟回执" }).click();
  await page.waitForTimeout(300);
  await page.locator("#story-tab-1").click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "查看原文：模拟回执" }).click();
  await page.waitForTimeout(350);
  const long = await page.evaluate(() => {
    const d = document.querySelector("dialog");
    return {
      clientHeight: d?.clientHeight,
      scrollHeight: d?.scrollHeight,
      scrollable: d ? d.scrollHeight > d.clientHeight + 1 : null,
      rect: d ? (() => { const r = d.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })() : null,
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
  await page.evaluate(() => { const d = document.querySelector("dialog"); if (d) d.scrollTop = 200; });
  const longScroll = await page.evaluate(() => ({ scrollTop: document.querySelector("dialog")?.scrollTop, canScroll: document.querySelector("dialog") ? document.querySelector("dialog").scrollHeight > document.querySelector("dialog").clientHeight + 1 : null }));
  await page.keyboard.press("Escape");
  return { opened, aria, afterEsc, afterBackdrop, afterClose, long, longScroll };
}

async function testAnchors(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const headerBottom = async () => await page.evaluate(() => Math.round(document.querySelector("header").getBoundingClientRect().bottom));
  const targetTop = async (id) => await page.evaluate((i) => Math.round(document.getElementById(i)?.getBoundingClientRect().top ?? -9999), id);
  const waitSettled = async () => {
    let last = -1;
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(100);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      if (y === last) break;
      last = y;
    }
  };
  await goto(page, BASE + "/#experience");
  await waitSettled();
  const direct = { headerBottom: await headerBottom(), experienceTop: await targetTop("experience") };
  await goto(page);
  await page.getByRole("link", { name: "体验一段项目接续" }).click();
  await waitSettled();
  const viaCta = { headerBottom: await headerBottom(), experienceTop: await targetTop("experience") };
  const nav = {};
  for (const [name, id] of [["长期委托", "missions"], ["使用场景", "moments"], ["决赛演示", "demo"]]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const link = page.locator("header nav").getByRole("link", { name, exact: true });
    if (!(await link.isVisible().catch(() => false))) { nav[name] = { skipped: true }; continue; }
    await link.click();
    await waitSettled();
    nav[name] = { headerBottom: await headerBottom(), targetTop: await targetTop(id) };
  }
  const margins = await page.evaluate(() => ["experience", "missions", "moments", "demo"].map((id) => ({ id, scrollMarginTop: getComputedStyle(document.getElementById(id)).scrollMarginTop })));
  const shotFile = await shot(page, "anchor-experience");
  return { direct, viaCta, nav, margins, shotFile };
}

async function testOverflow(page) {
  const viewports = [
    { name: "320x640", width: 320, height: 640 },
    { name: "360x740", width: 360, height: 740 },
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1024x768", width: 1024, height: 768 },
    { name: "1280x800", width: 1280, height: 800 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "720x450(200%)", width: 720, height: 450 },
  ];
  const rows = [];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page);
    const data = await page.evaluate(() => {
      const doc = document.documentElement;
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.right > innerWidth + 1 || r.left < -1) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          offenders.push({ path: window.__a11y.pathOf(el), right: Math.round(r.right), left: Math.round(r.left) });
        }
      }
      return { innerWidth: innerWidth, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth > doc.clientWidth + 1, offenders: offenders.slice(0, 8) };
    });
    rows.push({ ...vp, ...data });
    if (vp.name === "320x640" || vp.name === "720x450(200%)") await shot(page, `viewport-${vp.name}`);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 4. 字号 / 对比度 / 账号页 / 外链 / 动效                              */
/* ------------------------------------------------------------------ */
async function scanText(page) {
  return await page.evaluate(() => {
    const small = [];
    const low = [];
    for (const el of document.querySelectorAll("main#main-content *, header *")) {
      if (!window.__a11y.directText(el)) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const style = window.__a11y.styleOf(el);
      if (!window.__a11y.visible(el)) continue;
      const large = style.fontSize >= 24 || (style.fontSize >= 18.66 && style.fontWeight >= 700);
      const min = large ? 3 : 4.5;
      if (style.contrast < min) low.push({ text: text.slice(0, 50), fontSize: style.fontSize, contrast: style.contrast, path: window.__a11y.pathOf(el) });
      if (style.fontSize < 12.8 && !window.__a11y.inAriaHidden(el)) small.push({ text: text.slice(0, 60), fontSize: style.fontSize, contrast: style.contrast, path: window.__a11y.pathOf(el) });
    }
    const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.path + "|" + x.text + "|" + x.fontSize; if (seen.has(k)) return false; seen.add(k); return true; }); };
    return { smallCount: small.length, small: uniq(small), lowCount: low.length, low: uniq(low) };
  });
}

async function testFontsContrast(page) {
  const out = {};
  for (const vp of [{ name: "1440x900", width: 1440, height: 900 }, { name: "390x844", width: 390, height: 844 }, { name: "320x640", width: 320, height: 640 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page);
    out[`light_${vp.name}`] = await scanText(page);
    // 第 3 步 judgment 区
    await page.locator("#story-tab-2").click();
    await page.waitForTimeout(300);
    out[`light_judgment_${vp.name}`] = await page.evaluate(() => {
      const panel = document.getElementById("story-panel");
      const small = [];
      for (const el of panel.querySelectorAll("*")) {
        if (!window.__a11y.directText(el)) continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        const style = window.__a11y.styleOf(el);
        if (window.__a11y.visible(el) && style.fontSize < 12.8) small.push({ text: t.slice(0, 60), fontSize: style.fontSize, path: window.__a11y.pathOf(el) });
      }
      return { smallCount: small.length, small };
    });
    await shot(page, `fonts-${vp.name}`);
  }
  return out;
}

async function testDarkTheme() {
  const { context, page } = await newPage({
    colorScheme: "dark",
    initScript: () => { try { localStorage.setItem("theme", "dark"); } catch {} },
  });
  await goto(page);
  const state = await page.evaluate(() => ({ htmlClass: document.documentElement.className, bodyBg: getComputedStyle(document.body).backgroundColor, toggleCount: document.querySelectorAll('[aria-label="切换深浅色主题"]').length }));
  const desktop = await scanText(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobile = await scanText(page);
  const shotFile = await shot(page, "dark-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  const shotMobile = await shot(page, "dark-390");
  await context.close();
  return { state, desktop, mobile, shotFile, shotMobile };
}

async function testAccountPages(page) {
  const out = {};
  for (const theme of ["light", "dark"]) {
    for (const route of ["/login", "/register", "/forgot-password"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      if (theme === "dark") await page.emulateMedia({ colorScheme: "dark" });
      else await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => { try { localStorage.setItem("theme", theme); } catch {} }).catch(() => {});
      await goto(page, BASE + route);
      const desktop = await page.evaluate(() => {
        const header = document.querySelector("header");
        const main = document.querySelector("main");
        const nav = header?.querySelector("nav");
        const cta = nav?.querySelector("a");
        const cs = cta ? getComputedStyle(cta) : null;
        const r = cta ? cta.getBoundingClientRect() : null;
        const mr = main ? main.getBoundingClientRect() : null;
        const hr = header ? header.getBoundingClientRect() : null;
        return {
          title: document.title,
          htmlClass: document.documentElement.className,
          header: header ? { height: Math.round(hr.height), position: getComputedStyle(header).position } : null,
          main: main ? { top: Math.round(mr.top), width: Math.round(mr.width) } : null,
          navLabel: nav?.getAttribute("aria-label"),
          cta: cta ? { text: (cta.textContent || "").trim(), fontSize: parseFloat(cs.fontSize), h: Math.round(r.height), w: Math.round(r.width) } : null,
          leak: { homeMain: !!document.querySelector("main[class*=home-module]"), hero: !!document.querySelector("[class*=heroInner]"), storyFrame: !!document.querySelector("[class*=storyFrame]") },
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          formFields: document.querySelectorAll("input").length,
          skipTarget: (() => { const s = document.querySelector(".skip-link"); return s ? !!document.querySelector(s.getAttribute("href")) : null; })(),
        };
      });
      const shotDesktop = await shot(page, `account-${theme}${route.replaceAll("/", "-")}-1440`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
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
        };
      });
      const shotMobile = await shot(page, `account-${theme}${route.replaceAll("/", "-")}-390`);
      out[`${theme}:${route}`] = { desktop, mobile, shotDesktop, shotMobile };
    }
  }
  return out;
}

async function testExternalLinks(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .filter((a) => /^https?:\/\//i.test(a.getAttribute("href") || "") || a.target === "_blank")
      .map((a) => {
        const label = a.getAttribute("aria-label") || (a.textContent || "").replace(/\s+/g, " ").trim();
        const rel = (a.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
        const r = a.getBoundingClientRect();
        return {
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          rel: a.getAttribute("rel"),
          name: label,
          mentionsExternal: /(bilibili|外部|external)/i.test(label),
          mentionsNewWindow: /(在新窗口|新窗口|new window)/i.test(label),
          hasNoopener: rel.includes("noopener"),
          hasNoreferrer: rel.includes("noreferrer"),
          w: Math.round(r.width),
          h: Math.round(r.height),
          path: window.__a11y.pathOf(a),
        };
      })
  );
  const tabStops = [];
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Tab");
  for (let i = 0; i < 45; i += 1) {
    if (i > 0) await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60), href: el.getAttribute("href"), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, focusVisible: el.matches(":focus-visible") };
    });
    if (info?.href && /bilibili/i.test(info.href)) tabStops.push(info);
  }
  const media = await page.evaluate(() => ({
    video: document.querySelectorAll("video,audio").length,
    iframe: document.querySelectorAll("iframe").length,
    autoplay: [...document.querySelectorAll("video,audio")].some((v) => v.autoplay),
  }));
  return { links, tabStops, media };
}

async function testNetworkOnLoad() {
  const { context, page } = await newPage();
  const requests = [];
  page.on("request", (req) => requests.push({ url: req.url(), type: req.resourceType() }));
  await goto(page);
  await page.waitForTimeout(1500);
  const external = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.startsWith("about:"));
  const bili = requests.filter((r) => /bilibili|bilivideo|b23\.tv/i.test(r.url));
  await context.close();
  return { total: requests.length, externalCount: external.length, external: external.slice(0, 10).map((r) => r.url.slice(0, 120)), bilibiliRequests: bili.length };
}

async function testHeroEntrance(reduced) {
  const { context, page } = await newPage({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("main#main-content h1", { timeout: 60000 });
  await page.waitForTimeout(120);
  const early = await page.evaluate(() => {
    const copy = document.querySelector("[data-hero-copy]");
    const lens = document.querySelector("[data-hero-lens]");
    const read = (el) => (el ? { opacity: getComputedStyle(el).opacity, translate: getComputedStyle(el).translate, animationName: getComputedStyle(el).animationName, animationDuration: getComputedStyle(el).animationDuration, animationDelay: getComputedStyle(el).animationDelay } : null);
    return { copy: read(copy), lens: read(lens), running: document.getAnimations().map((a) => ({ name: a.animationName || a.constructor.name, duration: a.effect ? a.effect.getTiming().duration : null })).slice(0, 8) };
  });
  await page.waitForTimeout(1400);
  const settled = await page.evaluate(() => {
    const copy = document.querySelector("[data-hero-copy]");
    const lens = document.querySelector("[data-hero-lens]");
    const read = (el) => (el ? { opacity: getComputedStyle(el).opacity, translate: getComputedStyle(el).translate } : null);
    const hidden = [...document.querySelectorAll("main#main-content *")].filter((el) => (parseFloat(getComputedStyle(el).opacity) === 0 || getComputedStyle(el).visibility === "hidden") && (el.textContent || "").trim()).map((el) => window.__a11y.pathOf(el));
    return { copy: read(copy), lens: read(lens), hidden: hidden.slice(0, 8), running: document.getAnimations().length };
  });
  const shotFile = await shot(page, reduced ? "hero-entrance-reduced" : "hero-entrance-normal");
  await context.close();
  return { reduced, early, settled, shotFile };
}

async function testEvidenceToggle(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  const measure = async () =>
    await page.evaluate(() => {
      const btn = document.querySelector("button[aria-controls='hero-evidence']");
      const wrap = document.getElementById("hero-evidence");
      const copy = document.querySelector("[data-hero-copy]");
      return {
        expanded: btn?.getAttribute("aria-expanded"),
        btnText: (btn?.textContent || "").replace(/\s+/g, " ").trim(),
        wrapTextLength: wrap ? (wrap.innerText || "").length : null,
        panelPresent: !!window.__a11y.byToken("evidencePanel"),
        items: wrap ? wrap.querySelectorAll("li").length : 0,
        heroCopyTop: copy ? Math.round(copy.getBoundingClientRect().top) : null,
        active: { tag: document.activeElement.tagName.toLowerCase(), ariaExpanded: document.activeElement.getAttribute?.("aria-expanded") },
      };
    });
  const collapsed = await measure();
  const collapsedAria = await page.locator("#hero-evidence").ariaSnapshot().catch(() => null);
  const btn = page.locator("button[aria-controls='hero-evidence']");
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(350);
  const expanded = await measure();
  const expandedAria = await page.locator("#hero-evidence").ariaSnapshot().catch(() => null);
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  const afterSpace = await measure();
  const shotFile = await shot(page, "evidence-toggle");
  return { collapsed, collapsedAria, expanded, expandedAria: (expandedAria || "").slice(0, 400), afterSpace, heroCopyTopDelta: expanded.heroCopyTop !== null && collapsed.heroCopyTop !== null ? expanded.heroCopyTop - collapsed.heroCopyTop : null, shotFile };
}

async function testFontZoom(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await page.waitForTimeout(400);
  const data = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll("main#main-content h1, main#main-content h2, main#main-content p, main#main-content button, main#main-content a")) {
      if (!window.__a11y.visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) clipped.push({ text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), path: window.__a11y.pathOf(el) });
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth > doc.clientWidth + 1, clipped: clipped.slice(0, 8) };
  });
  const shotFile = await shot(page, "font-zoom-200");
  return { data, shotFile };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
results.meta.gitHead = git("rev-parse HEAD");
results.meta.gitStatusAppComponents = git("status --porcelain -- app components");
results.meta.diffSince9bae926 = git("diff --name-only 9bae926e9475cedef118deedf5e002ec8365a23b..HEAD -- app components").split("\n").filter(Boolean);
results.meta.localToolingChanges = git("status --porcelain -- next-env.d.ts tsconfig.json").split("\n").filter(Boolean);

const { context: mainContext, page: mainPage } = await newPage();

await run("stageStatus", async () => await testStageStatus(mainPage));
await run("reducedHotSwitch", async () => await testReducedHotSwitch(mainPage));
await run("initialReduced", async () => await testInitialReduced());
await run("keyboardPath", async () => await testKeyboardPath(mainPage));
await run("skipLink", async () => await testSkipLink(mainPage));
await run("storyTabs", async () => await testStoryTabs(mainPage));
await run("dialog", async () => await testDialog(mainPage));
await run("anchors", async () => await testAnchors(mainPage));
await run("overflow", async () => await testOverflow(mainPage));
await run("fontsContrast", async () => await testFontsContrast(mainPage));
await run("darkTheme", async () => await testDarkTheme());
await run("accountPages", async () => await testAccountPages(mainPage));
await run("externalLinks", async () => await testExternalLinks(mainPage));
await run("networkOnLoad", async () => await testNetworkOnLoad());
await run("heroEntranceNormal", async () => await testHeroEntrance(false));
await run("heroEntranceReduced", async () => await testHeroEntrance(true));
await run("evidenceToggle", async () => await testEvidenceToggle(mainPage));
await run("fontZoom", async () => await testFontZoom(mainPage));

results.consoleErrors = consoleErrors;
results.meta.finishedAt = new Date().toISOString();

const outFile = path.join(JSONDIR, `probe-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await mainContext.close();
await browser.close();

console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
for (const e of results.errors) console.log(" - " + e.section + ": " + e.message.split("\n")[0]);
