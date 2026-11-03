/**
 * Track B 官网独立无障碍/交互探针（只读：不改源码，只写 audit/a11y/）。
 *
 * 用法（cwd = 工作树根）：
 *   node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-a11y.mjs \
 *     --base=http://127.0.0.1:34111 --label=baseline --sha=<git sha>
 *
 * 产出：
 *   audit/a11y/json/probe-<label>.json
 *   audit/a11y/shots/<label>-*.png
 *
 * 说明：这是自动化 DOM/计算样式取证，不是真实用户测试，也不是无障碍认证。
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
const LABEL = arg("label", "baseline");
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
    note: "自动化 DOM/计算样式取证；非真实用户测试，非无障碍认证。",
  },
  sections: {},
  errors: [],
};

const shot = async (page, name, fullPage = false) => {
  const file = path.join(SHOTS, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return path.relative(OUT, file).replaceAll("\\", "/");
};

const run = async (name, fn) => {
  try {
    results.sections[name] = await fn();
  } catch (error) {
    results.errors.push({ section: name, message: String(error && error.stack ? error.stack : error).slice(0, 2000) });
    results.sections[name] = { error: String(error && error.message ? error.message : error) };
  }
};

/* ------------------------------------------------------------------ */
/* 页面内工具函数（注入到浏览器上下文）                                  */
/* ------------------------------------------------------------------ */
const IN_PAGE = `
  window.__a11y = (() => {
    const parseColor = (value) => {
      const str = String(value);
      const m = str.match(/rgba?\\(([^)]+)\\)/);
      if (m) {
        const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      const srgb = str.match(/color\\(srgb\\s+([^)]+)\\)/);
      if (srgb) {
        const p = srgb[1].split(/[\\s\\/]+/).filter(Boolean).map(Number);
        return { r: Math.round(p[0] * 255), g: Math.round(p[1] * 255), b: Math.round(p[2] * 255), a: p.length > 3 ? p[3] : 1 };
      }
      return null;
    };
    const lum = (c) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const blend = (fg, bg) => ({
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
      a: 1,
    });
    const effectiveBg = (el) => {
      let node = el;
      const layers = [];
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        const c = parseColor(cs.backgroundColor);
        if (c && c.a > 0.001) layers.push(c);
        if (cs.backgroundImage && cs.backgroundImage !== "none") layers.push({ image: cs.backgroundImage });
        node = node.parentElement;
      }
      const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      let bg = body;
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        if (!layer.image) bg = blend(layer, bg);
      }
      return { bg, hasImage: layers.some((l) => l.image) };
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      if (parseFloat(cs.opacity) === 0) return false;
      let node = el;
      while (node) {
        if (node.hidden) return false;
        node = node.parentElement;
      }
      return true;
    };
    const describe = (el) => {
      if (!el) return null;
      const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") || "");
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : String(el),
        id: el.id || "",
        cls: cls.slice(0, 160),
        role: el.getAttribute ? el.getAttribute("role") : null,
        ariaLabel: el.getAttribute ? el.getAttribute("aria-label") : null,
        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80),
      };
    };
    const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const inAriaHidden = (el) => {
      let node = el;
      while (node) {
        if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
        node = node.parentElement;
      }
      return false;
    };
    const styleOf = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const eff = effectiveBg(el);
      const fg = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      const solid = fg.a < 1 ? blend(fg, eff.bg) : fg;
      return {
        ...describe(el),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight) || 400,
        lineHeight: cs.lineHeight,
        color: cs.color,
        bg: \`rgb(\${eff.bg.r}, \${eff.bg.g}, \${eff.bg.b})\`,
        bgHasImage: eff.hasImage,
        contrast: Number(ratio(solid, eff.bg).toFixed(2)),
        outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
        transition: { property: cs.transitionProperty, duration: cs.transitionDuration },
        animation: { name: cs.animationName, duration: cs.animationDuration },
        opacity: cs.opacity,
        visibility: cs.visibility,
        visible: visible(el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inAriaHidden: inAriaHidden(el),
      };
    };
    const byText = (text, exact) => {
      const wanted = text.replace(/\\s+/g, " ").trim();
      let best = null;
      for (const el of document.querySelectorAll("body *")) {
        const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
        const hit = exact ? t === wanted : t.includes(wanted);
        if (!hit) continue;
        if (!directText(el)) continue; // 最内层承载文本的元素
        if (!best || el.textContent.length < best.textContent.length) best = el;
      }
      return best;
    };
    const byToken = (token) => {
      const suffix = "__" + token;
      return [...document.querySelectorAll("[class]")].find((el) => [...el.classList].some((c) => c === suffix || c.endsWith(suffix))) || null;
    };
    const allByToken = (token) => {
      const suffix = "__" + token;
      return [...document.querySelectorAll("[class]")].filter((el) => [...el.classList].some((c) => c === suffix || c.endsWith(suffix)));
    };
    const textOf = (el) => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : null);
    const pathOf = (el) => {
      const parts = [];
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 5) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += "#" + node.id;
        const cls = typeof node.className === "string" ? node.className.split(/\\s+/).filter(Boolean) : [];
        if (cls.length) part += "." + cls.slice(0, 2).join(".");
        parts.unshift(part);
        node = node.parentElement;
        depth += 1;
      }
      return parts.join(" > ");
    };
    return { parseColor, effectiveBg, ratio, visible, describe, styleOf, byText, byToken, allByToken, textOf, pathOf, directText, inAriaHidden };
  })();
`;

/* ------------------------------------------------------------------ */
/* 通用上下文                                                          */
/* ------------------------------------------------------------------ */
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
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 300) });
  });
  page.on("pageerror", (err) => consoleErrors.push({ url: page.url(), text: "pageerror: " + String(err).slice(0, 300) }));
  await page.addInitScript(IN_PAGE);
  return { context, page };
};

const goto = async (page, url, wait = "networkidle") => {
  await page.goto(url, { waitUntil: wait, timeout: 60000 });
  await page.waitForTimeout(300);
};

/* ------------------------------------------------------------------ */
/* 1. 关键说明文字的计算字号（含桌面 / 移动 / 交互后状态）                */
/* ------------------------------------------------------------------ */
const KEY_TEXT = [
  ["heroNote", "公开示例 · 不调用模型 · 不写入你的项目。", true],
  ["heroSub", "关掉页面，目标、材料和判断依据都留在原处。回来时先看原委托做到哪、依据是什么，再决定下一步。", true],
  ["storyKicker", "内置公开示例", true],
  ["projectMission", "当前委托 · 整理阶段汇报", true],
  ["lensKicker", "公开示例", false],
  ["lensStatus", "等你确认", true],
  ["lensRowMetaBack", "3 条来源可回看原文", true],
  ["lensRowValueBack", "演示流程缺少完成回执", true],
  ["evidenceIntro", "原文来自内置公开素材，不读取你的项目。", true],
  ["lensFoot", "与下方五步示例使用同一份素材", false],
  ["storyFooterBoundary", "已有记录取自内置素材；建议与回执为本页演示。不会调用模型或修改个人项目。", true],
  ["contextLabelStep1", "已有示例素材", true],
  ["paneHeadingMeta", "3 条内置素材", true],
  ["factMark", "记录中提到", true],
  ["waitingBadgeUnknown", "当前状态待确认", true],
  ["conditionsSummary", "什么情况下才会自动接续？", true],
  ["conditionsBody", "实际执行需要启用委托功能、配置模型并授权使用相关资料。", false],
  ["demoNote", "这一段是冻结的示例状态：不连接服务器，也不代表任务此刻正在执行。", true],
  ["caption", "界面示意 · 实际可用范围取决于部署与授权", true],
  ["videoTitle", "2026 C4-AI 决赛演示视频", true],
  ["videoMeta", "忆程 ProjectMemo · Bilibili · 新窗口打开", true],
  ["boundaryNote", "来源可以回看；没有依据的内容会标明缺口。", false],
  ["footerMeta", "竞赛 · 科研 · 课程项目", true],
  ["scenarioItem", "竞赛备赛", true],
  ["railText", "比赛材料、任务安排、老师建议，随时可以回到原文核对。", true],
  ["kicker", "离开以后", false],
  ["sectionIntro", "同一个示例委托：来源、判断和等你决定的那一步，都留在原处。", true],
];

/** 用 CSS module 局部类名后缀定位元素，避免依赖哈希前缀与具体文案。 */
const KEY_TOKENS = [
  ["heroNote", "heroNote"],
  ["heroSub", "heroSub"],
  ["lensKicker", "lensKicker"],
  ["lensStatus", "lensStatus"],
  ["lensMission", "lensMission"],
  ["lensFoot", "lensFoot"],
  ["lensButton", "lensButton"],
  ["rowLabel", "lensRow"],
  ["rowMeta", "rowMeta"],
  ["rowValue", "rowValue"],
  ["evidenceIntro", "evidenceIntro"],
  ["evidenceName", "evidenceName"],
  ["demoNote", "demoNote"],
  ["caption", "caption"],
  ["videoTitle", "videoTitle"],
  ["videoMeta", "videoMeta"],
  ["kicker", "kicker"],
  ["sectionIntro", "sectionIntro"],
  ["railLabel", "railLabel"],
  ["railText", "railText"],
  ["footerMeta", "footerMeta"],
  ["footerNavLink", "footerNav"],
  ["projectKicker", "projectKicker"],
  ["projectMission", "projectMission"],
  ["contextLabel", "contextLabel"],
  ["contextPositionSuffix", "contextPosition"],
  ["paneHeadingMeta", "paneHeading"],
  ["factMark", "factMark"],
  ["badgeWaiting", "waitingBadge"],
  ["badgeExample", "exampleBadge"],
  ["sourceButton", "sourceButton"],
  ["storyFooterNote", "storyFooter"],
  ["storyNotice", "storyNotice"],
  ["resetButton", "resetButton"],
  ["stageTab", "stageTab"],
  ["storyTab", "storyTabs"],
  ["storyBody", "storyBody"],
  ["dialogProvenance", "dialogProvenance"],
  ["boundary", "boundary"],
  ["footer", "footer"],
  ["headerCta", "headerCta"],
  ["scrollProgress", "scrollProgress"],
  ["railProgress", "railProgress"],
  ["railFrame", "railFrame"],
  ["railLabel", "railLabel"],
  ["railText", "railText"],
  ["taskIdentity", "taskIdentity"],
  ["lensStatus", "lensStatus"],
];

async function measureTokens(page, tokens = KEY_TOKENS) {
  return await page.evaluate((list) => {
    return list.map(([key, token]) => {
      const els = window.__a11y.allByToken(token);
      if (!els.length) return { key, token, found: false, count: 0 };
      const el = els[0];
      return { key, token, found: true, count: els.length, path: window.__a11y.pathOf(el), ...window.__a11y.styleOf(el) };
    });
  }, tokens);
}

async function measureKeyText(page, extra = []) {
  return await page.evaluate(
    ({ keys, extraKeys }) => {
      const out = [];
      const all = [...keys, ...extraKeys];
      for (const [key, text, exact] of all) {
        const el = window.__a11y.byText(text, exact);
        if (!el) {
          out.push({ key, text, found: false });
          continue;
        }
        const style = window.__a11y.styleOf(el);
        out.push({ key, text, found: true, path: window.__a11y.pathOf(el), ...style });
      }
      return out;
    },
    { keys: KEY_TEXT, extraKeys: extra || [] }
  );
}

/* ------------------------------------------------------------------ */
/* 2. 全部小字扫描（<12.8px）与全部文本对比度扫描                        */
/* ------------------------------------------------------------------ */
async function scanText(page) {
  return await page.evaluate(() => {
    const small = [];
    const lowContrast = [];
    const scopes = document.querySelectorAll("main#main-content *, header *");
    for (const el of scopes) {
      if (!window.__a11y.directText(el)) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const style = window.__a11y.styleOf(el);
      if (!style.visible) continue;
      const large = style.fontSize >= 24 || (style.fontSize >= 18.66 && style.fontWeight >= 700);
      const min = large ? 3 : 4.5;
      if (style.contrast < min) {
        lowContrast.push({
          text: text.slice(0, 60),
          path: window.__a11y.pathOf(el),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
          bg: style.bg,
          bgHasImage: style.bgHasImage,
          contrast: style.contrast,
          required: min,
        });
      }
      if (style.fontSize < 12.8 && !style.inAriaHidden) {
        small.push({
          text: text.slice(0, 70),
          path: window.__a11y.pathOf(el),
          fontSize: style.fontSize,
          color: style.color,
          bg: style.bg,
          contrast: style.contrast,
          rect: style.rect,
        });
      }
    }
    const count = (arr) => arr.length;
    const uniq = (arr) => {
      const seen = new Set();
      return arr.filter((item) => {
        const key = item.path + "|" + item.text + "|" + item.fontSize;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    return { smallCount: count(small), small: uniq(small), lowContrastCount: count(lowContrast), lowContrast: uniq(lowContrast) };
  });
}

/* ------------------------------------------------------------------ */
/* 3. 交互目标尺寸扫描                                                  */
/* ------------------------------------------------------------------ */
async function scanTargets(page) {
  return await page.evaluate(() => {
    const rows = [];
    const els = document.querySelectorAll("main#main-content a, main#main-content button, main#main-content summary, main#main-content [role=tab], header a, header button, header summary");
    for (const el of els) {
      if (!window.__a11y.visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      rows.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        name,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        fontSize: parseFloat(cs.fontSize),
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        under44: r.width < 44 || r.height < 44,
        path: window.__a11y.pathOf(el),
      });
    }
    return { count: rows.length, under44: rows.filter((r) => r.under44), all: rows };
  });
}

/* ------------------------------------------------------------------ */
/* 4. 五步 Tab 键盘与 ARIA                                             */
/* ------------------------------------------------------------------ */
async function testTabs(page) {
  const tabs = page.locator('[role="tab"][id^="story-tab"]');
  const initial = await tabs.evaluateAll((els) =>
    els.map((el) => ({
      id: el.id,
      name: (el.textContent || "").trim(),
      selected: el.getAttribute("aria-selected"),
      tabIndex: el.getAttribute("tabindex"),
      controls: el.getAttribute("aria-controls"),
      controlsExists: !!document.getElementById(el.getAttribute("aria-controls") || ""),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
      fontSize: getComputedStyle(el).fontSize,
      flexDirection: getComputedStyle(el.parentElement).flexDirection,
    }))
  );
  const tablist = await page.locator('[role="tablist"][aria-label="项目故事步骤"]').evaluate((el) => ({
    label: el.getAttribute("aria-label"),
    orientation: el.getAttribute("aria-orientation"),
    display: getComputedStyle(el).display,
    flexDirection: getComputedStyle(el).flexDirection,
    gap: getComputedStyle(el).gap,
  }));

  const press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    return await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.getElementById("story-panel");
      return {
        activeId: active ? active.id : null,
        activeRole: active ? active.getAttribute("role") : null,
        activeSelected: active ? active.getAttribute("aria-selected") : null,
        panelLabelledBy: panel ? panel.getAttribute("aria-labelledby") : null,
        panelTitle: panel ? (panel.querySelector("h4") || {}).textContent : null,
        selectedTabs: [...document.querySelectorAll('[role="tab"][id^="story-tab"][aria-selected="true"]')].map((t) => t.id),
        tabIndexes: [...document.querySelectorAll('[role="tab"][id^="story-tab"]')].map((t) => t.id + ":" + t.getAttribute("tabindex")),
      };
    });
  };

  await page.locator("#story-tab-0").focus();
  const afterArrowRight = await press("ArrowRight");
  const afterArrowRight2 = await press("ArrowRight");
  const afterEnd = await press("End");
  const afterHome = await press("Home");
  const afterArrowLeftWrap = await press("ArrowLeft");
  const afterArrowDown = await press("ArrowDown");
  const afterArrowUp = await press("ArrowUp");

  const selectedVisual = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[role="tab"][id^="story-tab"]')];
    const sel = all.find((t) => t.getAttribute("aria-selected") === "true");
    const other = all.find((t) => t.getAttribute("aria-selected") !== "true");
    const read = (el) => {
      const cs = getComputedStyle(el);
      return {
        id: el.id,
        color: cs.color,
        background: cs.backgroundColor,
        borderBottom: cs.borderBottomColor,
        fontWeight: cs.fontWeight,
      };
    };
    return { selected: read(sel), other: read(other) };
  });

  return { count: initial.length, initial, tablist, keyboard: { afterArrowRight, afterArrowRight2, afterEnd, afterHome, afterArrowLeftWrap, afterArrowDown, afterArrowUp }, selectedVisual };
}

/* ------------------------------------------------------------------ */
/* 5. dialog：名称 / Esc / 遮罩 / 焦点返回 / 内部滚动                     */
/* ------------------------------------------------------------------ */
async function testDialog(page) {
  const trigger = page.getByRole("button", { name: "查看原文：任务安排" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  const beforeFocus = await page.evaluate(() => ({
    id: document.activeElement.id,
    label: document.activeElement.getAttribute("aria-label"),
  }));
  await trigger.click();
  await page.waitForTimeout(350);

  const opened = await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    if (!dialog) return { found: false };
    const cs = getComputedStyle(dialog);
    const r = dialog.getBoundingClientRect();
    const labelledby = dialog.getAttribute("aria-labelledby");
    const labelEl = labelledby ? document.getElementById(labelledby) : null;
    return {
      found: true,
      open: dialog.open,
      modal: typeof dialog.showModal === "function" && dialog.matches(":modal"),
      ariaLabelledby: labelledby,
      labelText: labelEl ? (labelEl.textContent || "").trim() : null,
      ariaDescribedby: dialog.getAttribute("aria-describedby"),
      activeElement: {
        tag: document.activeElement.tagName.toLowerCase(),
        id: document.activeElement.id,
        label: document.activeElement.getAttribute("aria-label"),
        text: (document.activeElement.textContent || "").trim().slice(0, 40),
      },
      overflowY: cs.overflowY,
      clientHeight: dialog.clientHeight,
      scrollHeight: dialog.scrollHeight,
      rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) },
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
  const aria = await page.locator("dialog").ariaSnapshot();
  const shotOpen = await shot(page, "dialog-open");

  // 焦点是否被约束在 dialog 内
  const trap = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    trap.push(
      await page.evaluate(() => {
        const d = document.querySelector("dialog");
        return {
          inDialog: d ? d.contains(document.activeElement) : false,
          tag: document.activeElement.tagName.toLowerCase(),
          label: document.activeElement.getAttribute("aria-label"),
        };
      })
    );
  }

  // Esc 关闭 + 焦点返回
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const afterEsc = await page.evaluate(() => ({
    dialogOpen: !!document.querySelector("dialog[open]"),
    active: {
      tag: document.activeElement.tagName.toLowerCase(),
      label: document.activeElement.getAttribute("aria-label"),
      text: (document.activeElement.textContent || "").trim().slice(0, 40),
    },
  }));

  // 遮罩点击关闭 + 焦点返回
  await trigger.click();
  await page.waitForTimeout(300);
  const reopened = await page.evaluate(() => !!document.querySelector("dialog[open]"));
  await page.mouse.click(6, 6);
  await page.waitForTimeout(350);
  const afterBackdrop = await page.evaluate(() => ({
    dialogOpen: !!document.querySelector("dialog[open]"),
    active: {
      tag: document.activeElement.tagName.toLowerCase(),
      label: document.activeElement.getAttribute("aria-label"),
      text: (document.activeElement.textContent || "").trim().slice(0, 40),
    },
  }));

  // 关闭按钮
  await trigger.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "关闭原始记录" }).click();
  await page.waitForTimeout(300);
  const afterCloseButton = await page.evaluate(() => ({
    dialogOpen: !!document.querySelector("dialog[open]"),
    active: {
      tag: document.activeElement.tagName.toLowerCase(),
      label: document.activeElement.getAttribute("aria-label"),
      text: (document.activeElement.textContent || "").trim().slice(0, 40),
    },
  }));

  return { beforeFocus, opened, ariaSnapshot: aria, focusTrap: trap, afterEsc, reopened, afterBackdrop, afterCloseButton, shotOpen };
}

/* ------------------------------------------------------------------ */
/* 6. 长文回执 dialog 的内部滚动（500 字上限 + 200% 缩放视口）            */
/* ------------------------------------------------------------------ */
async function testLongDialog(page, viewportLabel) {
  await page.locator("#story-tab-3").click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "在示例中确认行动" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "去填写模拟回执" }).click();
  await page.waitForTimeout(200);
  const long = "模拟回执长文测试。".repeat(40).slice(0, 500);
  await page.locator("#demo-receipt").fill(long);
  await page.getByRole("button", { name: "保存模拟回执" }).click();
  await page.waitForTimeout(300);
  await page.locator("#story-tab-1").click(); // 回依据页，模拟回执条目在那里
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "查看原文：模拟回执" }).click();
  await page.waitForTimeout(400);
  const measured = await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    const quote = dialog ? dialog.querySelector("blockquote") : null;
    const cs = dialog ? getComputedStyle(dialog) : null;
    const r = dialog ? dialog.getBoundingClientRect() : null;
    return {
      open: dialog ? dialog.open : false,
      overflowY: cs ? cs.overflowY : null,
      clientHeight: dialog ? dialog.clientHeight : null,
      scrollHeight: dialog ? dialog.scrollHeight : null,
      scrollable: dialog ? dialog.scrollHeight > dialog.clientHeight + 1 : null,
      quoteHeight: quote ? Math.round(quote.getBoundingClientRect().height) : null,
      rect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
      viewport: { w: innerWidth, h: innerHeight },
      bodyScrollY: window.scrollY,
    };
  });
  // 尝试在 dialog 内滚动
  await page.evaluate(() => {
    const d = document.querySelector("dialog");
    if (d) d.scrollTop = 200;
  });
  const afterScroll = await page.evaluate(() => {
    const d = document.querySelector("dialog");
    return { scrollTop: d ? d.scrollTop : null, canScroll: d ? d.scrollHeight > d.clientHeight + 1 : null };
  });
  const shotFile = await shot(page, `dialog-long-${viewportLabel}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return { viewportLabel, measured, afterScroll, shotFile };
}

/* ------------------------------------------------------------------ */
/* 7. 锚点与 sticky header 遮挡                                        */
/* ------------------------------------------------------------------ */
async function testAnchors(page) {
  const headerBottom = async () =>
    await page.evaluate(() => {
      const header = document.querySelector("header");
      return header ? Math.round(header.getBoundingClientRect().bottom) : null;
    });
  const targetTop = async (id) =>
    await page.evaluate((targetId) => {
      const el = document.getElementById(targetId);
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    }, id);

  const waitScrollSettled = async () => {
    let last = -1;
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(100);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      if (y === last) break;
      last = y;
    }
  };

  await goto(page, BASE + "/");
  const direct = await goto(page, BASE + "/#experience").then(async () => {
    await waitScrollSettled();
    return { headerBottom: await headerBottom(), experienceTop: await targetTop("experience") };
  });

  await goto(page, BASE + "/");
  await page.getByRole("link", { name: "体验一段项目接续" }).click();
  await waitScrollSettled();
  const viaCta = { headerBottom: await headerBottom(), experienceTop: await targetTop("experience") };

  const navResults = {};
  for (const [name, id] of [
    ["长期委托", "missions"],
    ["使用场景", "moments"],
    ["决赛演示", "demo"],
  ]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const link = page.locator("header nav").getByRole("link", { name, exact: true });
    if (!(await link.isVisible().catch(() => false))) {
      navResults[name] = { skipped: "header nav link not visible at this viewport (mobile hides it)" };
      continue;
    }
    await link.click();
    await waitScrollSettled();
    navResults[name] = { headerBottom: await headerBottom(), targetTop: await targetTop(id) };
  }

  const shotAnchor = await shot(page, "anchor-experience");
  const scrollMargins = await page.evaluate(() => {
    const ids = ["experience", "missions", "moments", "demo", "home-heading"];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id, exists: !!el, scrollMarginTop: el ? getComputedStyle(el).scrollMarginTop : null };
    });
  });
  return { direct, viaCta, navResults, scrollMargins, shotAnchor };
}

/* ------------------------------------------------------------------ */
/* 8. 溢出（多断点 + 200% 缩放）                                       */
/* ------------------------------------------------------------------ */
async function testOverflow(page) {
  const viewports = [
    { name: "320x640", width: 320, height: 640 },
    { name: "360x740", width: 360, height: 740 },
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1024x768", width: 1024, height: 768 },
    { name: "1280x800", width: 1280, height: 800 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "720x450(200% zoom)", width: 720, height: 450 },
  ];
  const rows = [];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page, BASE + "/");
    const data = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = window.innerWidth;
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.right > vw + 1 || r.left < -1) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          offenders.push({
            tag: el.tagName.toLowerCase(),
            path: window.__a11y.pathOf(el),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
          });
        }
      }
      return {
        innerWidth: vw,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
        bodyScrollWidth: document.body.scrollWidth,
        offenders: offenders.slice(0, 12),
      };
    });
    rows.push({ ...vp, ...data });
    if (vp.name === "320x640" || vp.name === "720x450(200% zoom)") {
      await shot(page, `viewport-${vp.name}`);
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 9. 减少动画：computed transition/animation + 内容等价                  */
/* ------------------------------------------------------------------ */
async function testReducedMotion() {
  const { context, page } = await newPage({ reducedMotion: "reduce" });
  await goto(page, BASE + "/");
  const measured = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        sel,
        transitionProperty: cs.transitionProperty,
        transitionDuration: cs.transitionDuration,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
      };
    };
    const selectors = [
      "main#main-content [class*=ctaPrimary]",
      "main#main-content [class*=ctaSecondary]",
      "[role=tab]",
      "[class*=storyFrame]",
      "[class*=storyBody]",
      "[class*=sourceDialog]",
      "main#main-content [class*=heroCopy]",
      "main#main-content [class*=lensRows]",
      "main#main-content [class*=videoLink]",
      "main#main-content [class*=evidenceInner]",
      "header",
    ];
    const animations = document.getAnimations().map((a) => ({ name: a.animationName || a.constructor.name, playState: a.playState }));
    const hiddenByOpacity = [];
    for (const el of document.querySelectorAll("main#main-content *")) {
      const cs = getComputedStyle(el);
      if ((parseFloat(cs.opacity) === 0 || cs.visibility === "hidden") && (el.textContent || "").trim()) {
        hiddenByOpacity.push({ path: window.__a11y.pathOf(el), opacity: cs.opacity, visibility: cs.visibility });
      }
    }
    return { styles: selectors.map(pick), runningAnimations: animations.slice(0, 10), hiddenByOpacity: hiddenByOpacity.slice(0, 10) };
  });

  // 内容等价：五个步骤在 reduce 下仍能切换且文字与正常模式一致
  const steps = [];
  for (let i = 0; i < 5; i += 1) {
    await page.locator(`#story-tab-${i}`).click();
    await page.waitForTimeout(160);
    steps.push(
      await page.evaluate(() => {
        const panel = document.getElementById("story-panel");
        return {
          title: panel ? (panel.querySelector("h4") || {}).textContent : null,
          text: panel ? (panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300) : null,
          opacity: panel ? getComputedStyle(panel).opacity : null,
          visible: panel ? panel.getBoundingClientRect().height > 0 : null,
        };
      })
    );
  }
  const scrollBehavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  const shotFile = await shot(page, "reduced-motion");
  await context.close();
  return { measured, steps, scrollBehavior, shotFile };
}

/* ------------------------------------------------------------------ */
/* 10. prefers-contrast: more                                          */
/* ------------------------------------------------------------------ */
async function testContrastMedia() {
  const { context, page } = await newPage();
  await goto(page, BASE + "/");
  const before = await page.evaluate(() => {
    const sels = ["[class*=storyFrame]", "[class*=storyContent]", "[class*=lens]", "[class*=videoLink]", "[class*=railStep]", "[class*=sourceDialog]"];
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, found: false };
      const cs = getComputedStyle(el);
      return { sel, found: true, borderColor: cs.borderTopColor, boxShadow: cs.boxShadow };
    });
  });
  await page.emulateMedia({ contrast: "more" });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const sels = ["[class*=storyFrame]", "[class*=storyContent]", "[class*=lens]", "[class*=videoLink]", "[class*=railStep]", "[class*=sourceDialog]"];
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, found: false };
      const cs = getComputedStyle(el);
      return { sel, found: true, borderColor: cs.borderTopColor, boxShadow: cs.boxShadow };
    });
  });
  const shotFile = await shot(page, "prefers-contrast-more");
  await context.close();
  return { before, after, shotFile };
}

/* ------------------------------------------------------------------ */
/* 11. 深色主题（localStorage theme=dark，等价用户已保存偏好）             */
/* ------------------------------------------------------------------ */
async function testDarkTheme() {
  const { context, page } = await newPage({
    colorScheme: "dark",
    initScript: () => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {}
    },
  });
  await goto(page, BASE + "/");
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    toggleCount: document.querySelectorAll('[aria-label="切换深浅色主题"]').length,
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  }));
  const scan = await scanText(page);
  const shotFile = await shot(page, "dark-1440", true);
  // 移动深色
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileScan = await scanText(page);
  const shotMobile = await shot(page, "dark-390");
  await context.close();
  return { state, desktop: scan, mobile: mobileScan, shotFile, shotMobile };
}

/* ------------------------------------------------------------------ */
/* 12. 键盘序列与 focus-visible                                        */
/* ------------------------------------------------------------------ */
async function testKeyboard(page) {
  await goto(page, BASE + "/");
  await page.evaluate(() => window.scrollTo(0, 0));
  const sequence = [];
  for (let i = 0; i < 32; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: "body" };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
        href: el.getAttribute("href"),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
        focusVisible: el.matches(":focus-visible"),
        inViewport: r.top >= 0 && r.bottom <= innerHeight + 1,
      };
    });
    sequence.push(info);
    if (i === 0) await shot(page, "focus-skip-link");
    if (info.name === "体验一段项目接续") await shot(page, "focus-hero-cta");
    if (info.id && info.id.startsWith("stage-tab")) await shot(page, "focus-stage-tab");
  }
  return { sequence };
}

/* ------------------------------------------------------------------ */
/* 13. 结构 / ARIA 静态检查                                            */
/* ------------------------------------------------------------------ */
async function testStructure(page) {
  return await page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
      level: Number(h.tagName[1]),
      text: (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
      id: h.id || "",
    }));
    const levelSkips = [];
    for (let i = 1; i < headings.length; i += 1) {
      if (headings[i].level - headings[i - 1].level > 1) {
        levelSkips.push({ from: headings[i - 1], to: headings[i] });
      }
    }
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    const ariaControlsMissing = [...document.querySelectorAll("[aria-controls]")]
      .map((el) => ({ from: window.__a11y.pathOf(el), target: el.getAttribute("aria-controls"), exists: !!document.getElementById(el.getAttribute("aria-controls")) }))
      .filter((row) => !row.exists);
    const ariaLabelledbyMissing = [...document.querySelectorAll("[aria-labelledby]")]
      .map((el) => ({ from: window.__a11y.pathOf(el), target: el.getAttribute("aria-labelledby"), exists: !!document.getElementById(el.getAttribute("aria-labelledby")), text: (document.getElementById(el.getAttribute("aria-labelledby")) || {}).textContent || "" }))
      .filter((row) => !row.exists);
    const ariaLabelOnGeneric = [...document.querySelectorAll("[aria-label]")]
      .filter((el) => {
        const role = el.getAttribute("role");
        const interactive = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(el.tagName);
        const landmark = ["main", "nav", "aside", "header", "footer", "section", "form", "dialog"].includes(el.tagName.toLowerCase());
        return !interactive && !landmark && !role;
      })
      .map((el) => ({ path: window.__a11y.pathOf(el), label: el.getAttribute("aria-label") }));
    const imgsNoAlt = [...document.querySelectorAll("img")].filter((img) => !img.hasAttribute("alt")).map((img) => img.getAttribute("src"));
    const statusNodes = [...document.querySelectorAll('[role="status"],[role="alert"]')].map((el) => ({
      role: el.getAttribute("role"),
      text: (el.textContent || "").trim().slice(0, 60),
      path: window.__a11y.pathOf(el),
    }));
    const landmarks = {
      header: document.querySelectorAll("header").length,
      nav: document.querySelectorAll("nav").length,
      navLabels: [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")),
      main: document.querySelectorAll("main").length,
      mainId: document.querySelector("main") ? document.querySelector("main").id : null,
      footer: document.querySelectorAll("footer").length,
      aside: document.querySelectorAll("aside").length,
    };
    const lang = document.documentElement.lang;
    const viewport = document.querySelector('meta[name="viewport"]');
    const skipLink = document.querySelector(".skip-link");
    const skipTarget = skipLink ? document.querySelector(skipLink.getAttribute("href")) : null;
    const focusableTabindexPositive = [...document.querySelectorAll("[tabindex]")]
      .filter((el) => Number(el.getAttribute("tabindex")) > 0)
      .map((el) => ({ path: window.__a11y.pathOf(el), tabindex: el.getAttribute("tabindex") }));
    const decorative = {
      scrollProgress: (() => {
        const el = document.querySelector("[data-scroll-progress]");
        if (!el) return null;
        return {
          ariaHidden: el.getAttribute("aria-hidden"),
          tabIndex: el.tabIndex,
          pointerEvents: getComputedStyle(el).pointerEvents,
          position: getComputedStyle(el).position,
          text: (el.textContent || "").trim(),
          focusable: el.tabIndex >= 0,
        };
      })(),
      railProgress: (() => {
        const el = window.__a11y.byToken("railProgress");
        if (!el) return null;
        return { ariaHidden: el.getAttribute("aria-hidden"), pointerEvents: getComputedStyle(el).pointerEvents, text: (el.textContent || "").trim() };
      })(),
      dataDrawCount: document.querySelectorAll("[data-draw]").length,
      dataDrawFocusable: [...document.querySelectorAll("[data-draw]")].filter((el) => el.tabIndex >= 0).length,
      dataHeroCount: document.querySelectorAll("[data-hero]").length,
      mainTabIndex: document.querySelector("main") ? document.querySelector("main").getAttribute("tabindex") : null,
    };
    return {
      headings,
      levelSkips,
      duplicateIds: [...new Set(duplicateIds)],
      ariaControlsMissing,
      ariaLabelledbyMissing,
      ariaLabelOnGeneric,
      imgsNoAlt,
      statusNodes,
      landmarks,
      lang,
      viewportMeta: viewport ? viewport.getAttribute("content") : null,
      skipLink: skipLink ? { text: skipLink.textContent.trim(), href: skipLink.getAttribute("href"), targetExists: !!skipTarget } : null,
      focusableTabindexPositive,
      decorative,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 14. 账号页 /login /register /forgot-password                        */
/* ------------------------------------------------------------------ */
async function testAccountPages(page) {
  const out = {};
  for (const route of ["/login", "/register", "/forgot-password"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, BASE + route);
    const desktop = await page.evaluate(() => {
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      const cs = header ? getComputedStyle(header) : null;
      const hr = header ? header.getBoundingClientRect() : null;
      const mr = main ? main.getBoundingClientRect() : null;
      const nav = header ? header.querySelector("nav") : null;
      const cta = nav ? nav.querySelector("a") : null;
      const ctaStyle = cta ? getComputedStyle(cta) : null;
      const ctaRect = cta ? cta.getBoundingClientRect() : null;
      return {
        title: document.title,
        header: header
          ? {
              cls: header.className,
              height: Math.round(hr.height),
              position: cs.position,
              top: cs.top,
              background: cs.backgroundColor,
            }
          : null,
        nav: nav ? { label: nav.getAttribute("aria-label"), links: [...nav.querySelectorAll("a")].map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href"), fontSize: getComputedStyle(a).fontSize, w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) })) } : null,
        cta: cta ? { text: (cta.textContent || "").trim(), fontSize: ctaStyle.fontSize, h: Math.round(ctaRect.height), w: Math.round(ctaRect.width) } : null,
        main: main ? { id: main.id, cls: main.className, top: Math.round(mr.top), width: Math.round(mr.width) } : null,
        leak: {
          homeMain: !!document.querySelector("main[class*=home-module]"),
          heroSection: !!document.querySelector("[class*=heroInner]"),
          lens: !!document.querySelector("[class*=stageTab]"),
          storyFrame: !!document.querySelector("[class*=storyFrame]"),
          bodyFontSize: getComputedStyle(document.body).fontSize,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          homeScopeRuleApplied: (() => {
            // 首页 .home a:focus-visible 等作用域规则不应命中账号页：抽查正文链接 computed outline 默认值
            const a = document.querySelector("main a");
            return a ? getComputedStyle(a).outlineStyle : null;
          })(),
        },
        headerInnerWidth: header && header.firstElementChild ? Math.round(header.firstElementChild.getBoundingClientRect().width) : null,
        mainWidth: mr ? Math.round(mr.width) : null,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        themeToggle: document.querySelectorAll('[aria-label="切换深浅色主题"]').length,
        skipLinkTarget: (() => {
          const skip = document.querySelector(".skip-link");
          return skip ? !!document.querySelector(skip.getAttribute("href")) : null;
        })(),
      };
    });
    const shotDesktop = await shot(page, `account${route.replaceAll("/", "-")}-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => {
      const header = document.querySelector("header");
      const nav = header ? header.querySelector("nav") : null;
      const cta = nav ? nav.querySelector("a") : null;
      const cs = cta ? getComputedStyle(cta) : null;
      const r = cta ? cta.getBoundingClientRect() : null;
      return {
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
        cta: cta ? { text: (cta.textContent || "").trim(), fontSize: cs.fontSize, h: Math.round(r.height), w: Math.round(r.width) } : null,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        visibleNavLinks: nav ? [...nav.querySelectorAll("a")].filter((a) => getComputedStyle(a).display !== "none").length : null,
        formFields: document.querySelectorAll("input").length,
        labels: [...document.querySelectorAll("label")].map((l) => ({ for: l.getAttribute("for"), text: (l.textContent || "").trim() })),
      };
    });
    const shotMobile = await shot(page, `account${route.replaceAll("/", "-")}-390`);
    out[route] = { desktop, mobile, shotDesktop, shotMobile };
  }
  return out;
}

/** 账号页深色回归：/login /register /forgot-password × 1440/390。 */
async function testAccountPagesDark() {
  const { context, page } = await newPage({
    colorScheme: "dark",
    initScript: () => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {}
    },
  });
  const out = await testAccountPages(page);
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  await context.close();
  return { htmlClass, pages: out };
}

/* ------------------------------------------------------------------ */
/* 15. 无 JS 可读性                                                    */
/* ------------------------------------------------------------------ */
async function testNoJs() {
  const { context, page } = await newPage({ javaScriptEnabled: false });
  await goto(page, BASE + "/", "load");
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const heroText = window.__a11y ? window.__a11y.byText("项目别掉线", false) : null;
    const main = document.querySelector("main");
    const loadingMain = document.querySelector('main[aria-busy="true"]');
    const hiddenHost = [...document.querySelectorAll("div[hidden]")].map((d) => (d.textContent || "").trim().length);
    const rail = document.querySelector("[data-rail]");
    const railSteps = [...document.querySelectorAll("[data-rail-step]")];
    const progress = document.querySelector("[data-scroll-progress]");
    const railProgress = window.__a11y.byToken("railProgress");
    return {
      title: document.title,
      mainCount: document.querySelectorAll("main").length,
      mainLabel: main ? main.getAttribute("aria-label") : null,
      mainTabIndex: main ? main.getAttribute("tabindex") : null,
      dataMotion: main ? main.getAttribute("data-motion") : null,
      loadingSkeletonVisible: loadingMain ? window.__a11y.visible(loadingMain) : false,
      h1Visible: h1 ? window.__a11y.visible(h1) : false,
      h1Text: h1 ? h1.textContent.trim() : null,
      heroTextFound: !!heroText,
      heroTextVisible: heroText ? window.__a11y.visible(heroText) : false,
      bodyTextLength: (document.body.innerText || "").length,
      hiddenBlocks: hiddenHost,
      railTextsComplete:
        railSteps.length === 4 &&
        railSteps.every((s) => {
          const label = (s.querySelector("[class*=railLabel]") || {}).textContent || "";
          const title = (s.querySelector("h3") || {}).textContent || "";
          const text = (s.querySelector("[class*=railText]") || {}).textContent || "";
          return label.trim() && title.trim() && text.trim();
        }),
      railProgressTransform: railProgress ? getComputedStyle(railProgress).transform : null,
      railProgressValue: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() : null,
      scrollProgressTransform: progress ? getComputedStyle(progress).transform : null,
      kickerAfter: [...document.querySelectorAll("[data-draw]")].map((k) => getComputedStyle(k, "::after").transform),
    };
  });
  const shotFile = await shot(page, "no-js");
  // 账号页无 JS
  await goto(page, BASE + "/login", "load");
  await page.waitForTimeout(800);
  const login = await page.evaluate(() => ({
    bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
    formFields: document.querySelectorAll("input").length,
    loadingVisible: (() => {
      const el = document.querySelector('[role="status"]');
      return el ? window.__a11y.visible(el) : false;
    })(),
  }));
  await context.close();
  return { home: data, login, shotFile };
}

/* ------------------------------------------------------------------ */
/* 16. 图片/字体资源失败降级（B2 生产首页已无 Hero 内容大图）             */
/* ------------------------------------------------------------------ */
async function testImageFailure() {
  const { context, page } = await newPage();
  await page.route("**/logo.png", (route) => route.abort());
  await page.route("**/icon.svg*", (route) => route.abort());
  await page.route("**/fonts/*.ttf", (route) => route.abort());
  await goto(page, BASE + "/");
  await page.waitForTimeout(900);
  const data = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    const brand = document.querySelector(".app-brand");
    const h1 = document.querySelector("h1");
    const cta = document.querySelector("main a[href='#experience']");
    return {
      imageCount: imgs.length,
      images: imgs.map((img) => ({
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt"),
        naturalWidth: img.naturalWidth,
        visible: window.__a11y.visible(img),
        rect: { w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) },
      })),
      brandVisible: brand ? window.__a11y.visible(brand) : false,
      brandText: brand ? (brand.textContent || "").replace(/\s+/g, " ").trim() : null,
      h1Visible: h1 ? window.__a11y.visible(h1) : false,
      h1Text: h1 ? h1.textContent.trim().slice(0, 40) : null,
      heroCtaVisible: cta ? window.__a11y.visible(cta) : false,
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      h1FontFamily: h1 ? getComputedStyle(h1).fontFamily : null,
      loadingOverlay: !!document.querySelector('main[aria-busy="true"]'),
    };
  });
  const shotFile = await shot(page, "assets-failed");
  await context.close();
  return { data, shotFile };
}

/* ------------------------------------------------------------------ */
/* 17. 状态消息 role=status                                            */
/* ------------------------------------------------------------------ */
async function testStatusMessages(page) {
  await goto(page, BASE + "/");
  const before = await page.evaluate(() => document.querySelectorAll('[role="status"]').length);
  await page.getByRole("button", { name: "重置示例" }).click();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="status"]')];
    return nodes.map((el) => ({ text: (el.textContent || "").trim(), visible: window.__a11y.visible(el) }));
  });
  // 切换 Tab 是否清除 notice（避免过期状态消息）
  await page.locator("#story-tab-2").click();
  await page.waitForTimeout(200);
  const afterTab = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((el) => (el.textContent || "").trim()));
  return { before, after, afterTab };
}

/* ------------------------------------------------------------------ */
/* 18. 外部链接审计（决赛演示视频外链 / 外部站）                          */
/* ------------------------------------------------------------------ */
async function testExternalLinks(page) {
  await goto(page, BASE + "/");
  // 键盘顺序：从文档起点 Tab 45 次，记录外链是否可达与焦点环
  await page.keyboard.press("Tab");
  const tabOrder = [];
  for (let i = 0; i < 45; i += 1) {
    if (i > 0) await page.keyboard.press("Tab");
    await page.waitForTimeout(45);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: "body" };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
        href: el.getAttribute("href"),
        target: el.getAttribute("target"),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset:${cs.outlineOffset}`,
        focusVisible: el.matches(":focus-visible"),
      };
    });
    tabOrder.push(info);
  }
  const biliTabStops = tabOrder.filter((x) => /bilibili/i.test(x.href || ""));
  const links = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("a[href]")];
    const external = anchors
      .filter((a) => /^https?:\/\//i.test(a.getAttribute("href") || "") || a.target === "_blank")
      .map((a) => {
        const cs = getComputedStyle(a);
        const r = a.getBoundingClientRect();
        const label = a.getAttribute("aria-label") || (a.textContent || "").replace(/\s+/g, " ").trim();
        const rel = (a.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
        return {
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          rel: a.getAttribute("rel"),
          name: label,
          title: a.getAttribute("title"),
          nameMentionsExternal: /(bilibili|外部|外站|external)/i.test(label + " " + (a.getAttribute("title") || "")),
          nameMentionsNewWindow: /(在新窗口|新窗口打开|新窗口|新标签|new window|new tab)/i.test(label + " " + (a.getAttribute("title") || "")),
          hasTargetBlank: a.getAttribute("target") === "_blank",
          relHasNoopener: rel.includes("noopener"),
          relHasNoreferrer: rel.includes("noreferrer"),
          fontSize: parseFloat(cs.fontSize),
          w: Math.round(r.width),
          h: Math.round(r.height),
          under44: r.width < 44 || r.height < 44,
          visible: window.__a11y.visible(a),
          path: window.__a11y.pathOf(a),
        };
      });
    const media = [...document.querySelectorAll("video,audio")].map((v) => ({
      tag: v.tagName.toLowerCase(),
      autoplay: v.autoplay,
      muted: v.muted,
      controls: v.controls,
      preload: v.getAttribute("preload"),
      src: v.currentSrc || v.getAttribute("src"),
      poster: v.getAttribute("poster"),
    }));
    const iframes = [...document.querySelectorAll("iframe")].map((i) => ({ src: i.getAttribute("src"), title: i.getAttribute("title") }));
    return {
      totalAnchors: anchors.length,
      external,
      media,
      iframes,
    };
  });
  // 主视频块与页脚外链的 ARIA 快照（可访问名以快照为准）
  const videoAria = await page.locator("a[href*='bilibili']").first().ariaSnapshot().catch(() => null);
  const footerAria = await page.locator("nav[aria-label='页脚'] a[href*='bilibili']").ariaSnapshot().catch(() => null);
  return { ...links, biliTabStops, videoAria, footerAria, tabOrderSample: tabOrder.slice(0, 20) };
}

/* ------------------------------------------------------------------ */
/* 19. 首屏加载网络：是否自动请求外部媒体                                */
/* ------------------------------------------------------------------ */
async function testNetworkOnLoad() {
  const { context, page } = await newPage();
  const requests = [];
  page.on("request", (req) => requests.push({ url: req.url(), type: req.resourceType() }));
  await goto(page, BASE + "/");
  await page.waitForTimeout(1800);
  const isLocal = (url) => url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:");
  const external = requests.filter((r) => !isLocal(r.url));
  const byOrigin = {};
  for (const r of external) {
    try {
      const origin = new URL(r.url).origin;
      byOrigin[origin] = (byOrigin[origin] || 0) + 1;
    } catch {
      byOrigin.unknown = (byOrigin.unknown || 0) + 1;
    }
  }
  const media = requests.filter((r) => ["media", "iframe", "font"].includes(r.type) || /bilibili|bilivideo|youtube|vimeo|\.m3u8|\.mp4/i.test(r.url));
  await context.close();
  return {
    total: requests.length,
    externalCount: external.length,
    byOrigin,
    media: media.slice(0, 20),
    types: requests.reduce((acc, r) => ((acc[r.type] = (acc[r.type] || 0) + 1), acc), {}),
  };
}

/* ------------------------------------------------------------------ */
/* 20. Hero 首次入场动效（正常 / reduce）                               */
/* ------------------------------------------------------------------ */
async function testHeroEntrance(reduced) {
  const animInit = () => {
    window.__animLog = [];
    const tick = () => {
      try {
        for (const a of document.getAnimations()) {
          const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
          const target = a.effect && a.effect.target;
          const entry = {
            name: a.animationName || (a.constructor && a.constructor.name),
            duration: timing && timing.duration,
            playState: a.playState,
            tag: target && target.tagName ? target.tagName.toLowerCase() : null,
            cls: target && typeof target.className === "string" ? target.className.slice(0, 80) : "",
          };
          const key = JSON.stringify(entry);
          if (!window.__animLog.some((x) => x.key === key)) window.__animLog.push({ key, ...entry });
        }
      } catch {}
      if (window.__animLog.length < 500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const { context, page } = await newPage({ reducedMotion: reduced ? "reduce" : "no-preference", initScript: animInit });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("main#main-content h1", { timeout: 60000 });
  await page.waitForTimeout(80);
  const early = await page.evaluate(() => {
    const byToken = (t) => window.__a11y.byToken(t);
    const collect = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, transform: cs.transform, animationName: cs.animationName, animationDuration: cs.animationDuration, animationDelay: cs.animationDelay, transitionDuration: cs.transitionDuration };
    };
    return {
      hero: collect(document.querySelector("main#main-content > section")),
      h1: collect(document.querySelector("main#main-content h1")),
      heroCopy: collect(byToken("heroCopy")),
      lens: collect(byToken("lens")),
      runningAnimations: document.getAnimations().map((a) => ({ name: a.animationName || a.constructor.name, playState: a.playState, duration: a.effect ? a.effect.getTiming().duration : null })),
    };
  });
  await page.waitForTimeout(1400);
  const settled = await page.evaluate(() => {
    const byToken = (t) => window.__a11y.byToken(t);
    const hidden = [];
    for (const el of document.querySelectorAll("main#main-content *")) {
      const cs = getComputedStyle(el);
      if ((parseFloat(cs.opacity) === 0 || cs.visibility === "hidden") && (el.textContent || "").trim()) hidden.push(window.__a11y.pathOf(el));
    }
    const collect = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, transform: cs.transform, animationName: cs.animationName };
    };
    return {
      hero: collect(document.querySelector("main#main-content > section")),
      h1: collect(document.querySelector("main#main-content h1")),
      heroCopy: collect(byToken("heroCopy")),
      lens: collect(byToken("lens")),
      heroTextVisible: (() => {
        const h = document.querySelector("main#main-content h1");
        return h ? window.__a11y.visible(h) : false;
      })(),
      lensTextVisible: (() => {
        const l = byToken("lens");
        return l ? window.__a11y.visible(l) : false;
      })(),
      hidden: hidden.slice(0, 10),
      runningAnimations: document.getAnimations().length,
      animLog: (window.__animLog || []).map((x) => ({ name: x.name, duration: x.duration, tag: x.tag, cls: x.cls })),
    };
  });
  const shotFile = await shot(page, reduced ? "hero-entrance-reduced" : "hero-entrance-normal");
  await context.close();
  return { reduced, early, settled, shotFile };
}

/* ------------------------------------------------------------------ */
/* 21. Hero 三阶段切换（B2 新增；基线不存在时记录 absent）               */
/* ------------------------------------------------------------------ */
const STAGE_WORDS = /(离开|期间|回来)/;

async function detectHeroStage(page) {
  return await page.evaluate((stageWords) => {
    const re = new RegExp(stageWords);
    const hero = document.querySelector("main#main-content > section");
    if (!hero) return null;
    const candidates = [...hero.querySelectorAll("button, [role=tab], [aria-selected], [aria-current], [aria-pressed], a")].filter((el) => re.test((el.textContent || "").trim()));
    if (candidates.length === 0) return { present: false };
    const tablist = hero.querySelector("[role=tablist]");
    const panel = hero.querySelector("[role=tabpanel]");
    return {
      present: true,
      count: candidates.length,
      candidates: candidates.map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          text: (el.textContent || "").replace(/\s+/g, " ").trim(),
          ariaSelected: el.getAttribute("aria-selected"),
          ariaCurrent: el.getAttribute("aria-current"),
          ariaPressed: el.getAttribute("aria-pressed"),
          ariaControls: el.getAttribute("aria-controls"),
          tabIndex: el.getAttribute("tabindex"),
          w: Math.round(r.width),
          h: Math.round(r.height),
          fontSize: parseFloat(cs.fontSize),
          selectedVisual: { color: cs.color, background: cs.backgroundColor, borderColor: cs.borderBottomColor, fontWeight: cs.fontWeight },
          path: window.__a11y.pathOf(el),
        };
      }),
      tablist: tablist ? { label: tablist.getAttribute("aria-label"), orientation: tablist.getAttribute("aria-orientation"), flexDirection: getComputedStyle(tablist).flexDirection } : null,
      panel: panel ? { id: panel.id, labelledby: panel.getAttribute("aria-labelledby"), tabIndex: panel.getAttribute("tabindex") } : null,
    };
  }, STAGE_WORDS.source);
}

async function testHeroStage(page, reduced) {
  const { context, page: stagePage } = reduced ? await newPage({ reducedMotion: "reduce" }) : { context: null, page };
  await goto(stagePage, BASE + "/");
  const detection = await detectHeroStage(stagePage);
  if (!detection || detection.present === false) {
    if (context) await context.close();
    return { present: false, reduced, note: "Hero 未检测到离开/期间/回来三阶段控件" };
  }
  const stageButtons = detection.candidates.map((c) => c.text);
  const read = async () =>
    await stagePage.evaluate(() => {
      const hero = document.querySelector("main#main-content > section");
      const panel = document.getElementById("stage-panel");
      return {
        heroText: hero ? (hero.textContent || "").replace(/\s+/g, " ").trim().slice(0, 900) : null,
        panelText: panel ? (panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600) : null,
        selected: [...document.querySelectorAll('[role=tab][id^=stage-tab][aria-selected=true], main#main-content > section:first-of-type [aria-current], main#main-content > section:first-of-type [aria-pressed=true]')].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()),
        tabIndexes: [...document.querySelectorAll('[role=tab][id^=stage-tab]')].map((t) => t.id + ":" + t.getAttribute("tabindex")),
        panelLabelledBy: panel ? panel.getAttribute("aria-labelledby") : null,
        panelTabIndex: panel ? panel.getAttribute("tabindex") : null,
        active: { tag: document.activeElement.tagName.toLowerCase(), text: (document.activeElement.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30), id: document.activeElement.id },
        scrollY: window.scrollY,
        statusNodes: [...document.querySelectorAll('[role="status"],[aria-live]')].map((el) => ({ role: el.getAttribute("role"), live: el.getAttribute("aria-live"), text: (el.textContent || "").trim().slice(0, 60) })),
        lensRowsAnimation: (() => {
          const rows = window.__a11y.byToken("lensRows");
          if (!rows) return null;
          const cs = getComputedStyle(rows);
          return { name: cs.animationName, duration: cs.animationDuration, direction: rows.getAttribute("data-direction") };
        })(),
        lensRowsAnimations: document.getAnimations().map((a) => ({ name: a.animationName || a.constructor.name, duration: a.effect ? a.effect.getTiming().duration : null, playState: a.playState })),
      };
    });

  const before = await read();
  const stageTexts = {};
  const panelButtons = stagePage.locator('[id^="stage-tab"]');
  const tabCount = await panelButtons.count();
  for (let i = 0; i < tabCount; i += 1) {
    await panelButtons.nth(i).click();
    await stagePage.waitForTimeout(320);
    const state = await read();
    stageTexts[stageButtons[i] || `tab${i}`] = { panelText: state.panelText, selected: state.selected, panelLabelledBy: state.panelLabelledBy, animation: state.lensRowsAnimation };
  }

  // 回到默认（回来后）后再做单次切换观察
  const defaultTab = panelButtons.nth(tabCount - 1);
  await defaultTab.click();
  await stagePage.waitForTimeout(400);
  const defaultState = await read();

  // 切换：焦点不抢、滚动不跳、无新增播报
  const statusBefore = (await read()).statusNodes.length;
  const targetTab = panelButtons.nth(0);
  await targetTab.click();
  await stagePage.waitForTimeout(400);
  const afterClick = await read();
  const statusAfter = afterClick.statusNodes.length;

  // 键盘：方向键 / Home / End
  const keyboard = [];
  if (detection.candidates[0].role === "tab") {
    await panelButtons.nth(tabCount - 1).focus();
    for (const key of ["ArrowLeft", "ArrowRight", "End", "Home"]) {
      await stagePage.keyboard.press(key);
      await stagePage.waitForTimeout(200);
      keyboard.push({ key, ...(await read()) });
    }
  }

  // Tab 进入顺序：从 Hero 主 CTA 之后进入 tablist，只有选中 tab 可停
  const tabEntry = [];
  const heroCta = stagePage.getByRole("link", { name: "体验一段项目接续" });
  await heroCta.focus();
  for (let i = 0; i < 6; i += 1) {
    await stagePage.keyboard.press("Tab");
    await stagePage.waitForTimeout(70);
    tabEntry.push(await read());
  }

  // 快速切换 20 次
  const errorsBefore = consoleErrors.length;
  const rapid = [];
  for (let i = 0; i < 20; i += 1) {
    const idx = i % tabCount;
    await panelButtons.nth(idx).click();
    await stagePage.waitForTimeout(40);
    rapid.push(await stagePage.evaluate(() => ({
      selected: [...document.querySelectorAll('[role=tab][id^=stage-tab][aria-selected=true]')].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()),
      activeId: document.activeElement.id || null,
      panelText: (document.getElementById("stage-panel") || {}).textContent ? (document.getElementById("stage-panel").textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : null,
    })));
  }
  const afterRapid = await read();
  const errorsAfter = consoleErrors.length;

  const shotFile = await shot(stagePage, reduced ? "hero-stage-reduced" : "hero-stage-normal");
  if (context) await context.close();
  return {
    present: true,
    reduced,
    detection,
    stageButtons,
    tabCount,
    before,
    defaultState,
    stageTexts,
    afterClick,
    statusBefore,
    statusAfter,
    keyboard,
    tabEntry,
    rapid: {
      finalSelected: afterRapid.selected,
      finalActive: afterRapid.active,
      finalPanelText: afterRapid.panelText,
      uniqueSelectedCounts: [...new Set(rapid.map((r) => r.selected.length))],
      activeIdStable: [...new Set(rapid.map((r) => r.activeId))],
      samples: rapid.slice(0, 6),
    },
    newConsoleErrors: consoleErrors.slice(errorsBefore, errorsAfter),
    shotFile,
  };
}

/* ------------------------------------------------------------------ */
/* 21b. Hero「查看依据」展开（aria-expanded / 焦点 / 左栏位移 / AT 隐藏）   */
/* ------------------------------------------------------------------ */
async function testEvidenceToggle(page) {
  await goto(page, BASE + "/");
  const measure = async () =>
    await page.evaluate(() => {
      const btn = document.querySelector("button[aria-controls='hero-evidence']");
      const heroCopy = window.__a11y.byToken("heroCopy");
      const lens = window.__a11y.byToken("lens");
      const wrap = document.getElementById("hero-evidence");
      const panel = window.__a11y.byToken("evidencePanel");
      const list = wrap ? [...wrap.querySelectorAll("li")] : [];
      return {
        btnFound: !!btn,
        ariaExpanded: btn ? btn.getAttribute("aria-expanded") : null,
        btnText: btn ? (btn.textContent || "").replace(/\s+/g, " ").trim() : null,
        btnRect: btn
          ? (() => {
              const r = btn.getBoundingClientRect();
              return { w: Math.round(r.width), h: Math.round(r.height) };
            })()
          : null,
        controlsExists: !!wrap,
        wrapTextLength: wrap ? (wrap.innerText || "").length : null,
        wrapInnerText: wrap ? (wrap.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240) : null,
        panelPresent: !!panel,
        sourceItems: list.length,
        sourceTitles: list.map((li) => {
          const p = li.querySelector("p");
          return p ? (p.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) : null;
        }),
        heroCopyTop: heroCopy ? Math.round(heroCopy.getBoundingClientRect().top) : null,
        lensTop: lens ? Math.round(lens.getBoundingClientRect().top) : null,
        lensHeight: lens ? Math.round(lens.getBoundingClientRect().height) : null,
        active: {
          tag: document.activeElement.tagName.toLowerCase(),
          text: (document.activeElement.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
          ariaExpanded: document.activeElement.getAttribute ? document.activeElement.getAttribute("aria-expanded") : null,
        },
        scrollY: window.scrollY,
      };
    });

  const collapsed = await measure();
  const collapsedAria = await page.locator("#hero-evidence").ariaSnapshot().catch(() => null);
  const shotCollapsed = await shot(page, "evidence-collapsed");
  const btn = page.locator("button[aria-controls='hero-evidence']");
  await btn.click();
  await page.waitForTimeout(400);
  const expanded = await measure();
  const expandedAria = await page.locator("#hero-evidence").ariaSnapshot().catch(() => null);
  const shotExpanded = await shot(page, "evidence-expanded");
  // 键盘：Space 关闭、Enter 重新展开
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const afterSpace = await measure();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const afterEnter = await measure();
  return {
    collapsed,
    expanded,
    collapsedAria,
    expandedAria,
    afterSpace,
    afterEnter,
    heroCopyTopDelta: expanded.heroCopyTop !== null && collapsed.heroCopyTop !== null ? expanded.heroCopyTop - collapsed.heroCopyTop : null,
    lensTopDelta: expanded.lensTop !== null && collapsed.lensTop !== null ? expanded.lensTop - collapsed.lensTop : null,
    shotCollapsed,
    shotExpanded,
  };
}

/* ------------------------------------------------------------------ */
/* 21c. 移动端五步 Tab 触控目标与可读性（360/320）                       */
/* ------------------------------------------------------------------ */
async function testMobileTabs(page) {
  const out = {};
  for (const vp of [
    { name: "360x740", width: 360, height: 740 },
    { name: "320x640", width: 320, height: 640 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page, BASE + "/");
    const data = await page.evaluate(() => {
      const read = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          id: el.id || "",
          text: (el.textContent || "").replace(/\s+/g, " ").trim(),
          fontSize: parseFloat(cs.fontSize),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          under44: r.width < 44 || r.height < 44,
        };
      };
      const storyTabs = [...document.querySelectorAll("[role=tab]")].filter((t) => t.id.startsWith("story-tab")).map(read);
      const stageTabs = [...document.querySelectorAll("[role=tab]")].filter((t) => t.id.startsWith("stage-tab")).map(read);
      const footerBtns = [...document.querySelectorAll("button[aria-label='上一步'], button[aria-label='下一步']")].map(read);
      const tablist = document.querySelector("[role=tablist][aria-label='项目故事步骤']");
      return {
        storyTabs,
        stageTabs,
        footerBtns,
        storyTablistWidth: tablist ? Math.round(tablist.getBoundingClientRect().width) : null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    out[vp.name] = data;
    await shot(page, `mobile-tabs-${vp.name}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 21d. B3 滚动动效：阅读进度线 / rail 进度 / kicker 细线 / hero translate */
/* ------------------------------------------------------------------ */
async function testScrollMotion(page, reduced) {
  const { context, page: targetPage } = reduced ? await newPage({ reducedMotion: "reduce" }) : { context: null, page };
  await goto(targetPage, BASE + "/");
  const read = async () =>
    await targetPage.evaluate(() => {
      const root = document.querySelector("main");
      const heroCopy = window.__a11y.byToken("heroCopy");
      const heroLens = window.__a11y.byToken("lens");
      const rail = document.querySelector("[data-rail]");
      const steps = [...document.querySelectorAll("[data-rail-step]")];
      const kickers = [...document.querySelectorAll("[data-draw]")];
      const progress = document.querySelector("[data-scroll-progress]");
      const railProgress = window.__a11y.byToken("railProgress");
      const cs = (el) =>
        el
          ? {
              opacity: getComputedStyle(el).opacity,
              display: getComputedStyle(el).display,
              translate: getComputedStyle(el).translate,
              transform: getComputedStyle(el).transform,
            }
          : null;
      return {
        dataMotion: root ? root.getAttribute("data-motion") : null,
        mainTabIndex: root ? root.getAttribute("tabindex") : null,
        heroCopy: cs(heroCopy),
        heroLens: cs(heroLens),
        heroShift: root ? getComputedStyle(root).getPropertyValue("--hero-shift").trim() : null,
        railProgressValue: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() : null,
        railProgressEl: railProgress
          ? {
              ...cs(railProgress),
              ariaHidden: railProgress.getAttribute("aria-hidden"),
              pointerEvents: getComputedStyle(railProgress).pointerEvents,
            }
          : null,
        activeSteps: steps.map((s) => s.hasAttribute("data-active")),
        railTexts: steps.map((s) => (s.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)),
        railTextVisibility: steps.map((s) => ({
          opacity: getComputedStyle(s).opacity,
          display: getComputedStyle(s).display,
          h: Math.round(s.getBoundingClientRect().height),
        })),
        kickerAfterTransforms: kickers.map((k) => getComputedStyle(k, "::after").transform),
        kickerDrawn: kickers.map((k) => k.getAttribute("data-drawn")),
        scrollProgress: progress
          ? {
              ariaHidden: progress.getAttribute("aria-hidden"),
              tabIndex: progress.tabIndex,
              pointerEvents: getComputedStyle(progress).pointerEvents,
              position: getComputedStyle(progress).position,
              top: getComputedStyle(progress).top,
              height: getComputedStyle(progress).height,
              transform: getComputedStyle(progress).transform,
              text: (progress.textContent || "").trim(),
            }
          : null,
        scrollY: Math.round(window.scrollY),
      };
    });

  const top = await read();
  await targetPage.evaluate(() => {
    const el = document.querySelector("[data-rail]");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await targetPage.waitForTimeout(700);
  const atRail = await read();
  await targetPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await targetPage.waitForTimeout(500);
  const bottom = await read();
  // 滚动到 hero 中段后检查焦点环/CTA 不被裁切、tab 顺序不变
  await targetPage.evaluate(() => window.scrollTo(0, 240));
  await targetPage.waitForTimeout(400);
  const focusCheck = await targetPage.evaluate(() => {
    const results = [];
    for (const sel of ["a[href='#experience']", "#stage-tab-back"]) {
      const el = document.querySelector(sel);
      if (!el) {
        results.push({ sel, found: false });
        continue;
      }
      el.focus();
      const r = el.getBoundingClientRect();
      let clipped = false;
      let node = el.parentElement;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.overflow !== "visible") {
          const nr = node.getBoundingClientRect();
          if (r.top < nr.top || r.bottom > nr.bottom || r.left < nr.left || r.right > nr.right) {
            clipped = true;
            break;
          }
        }
        node = node.parentElement;
      }
      results.push({
        sel,
        found: true,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
        inViewport: r.top >= 0 && r.bottom <= innerHeight + 1,
        clippedByOverflow: clipped,
        focusVisible: el.matches(":focus-visible"),
        outline: getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth,
      });
    }
    return results;
  });
  const shotFile = await shot(targetPage, reduced ? "scroll-motion-reduced" : "scroll-motion-normal");
  if (context) await context.close();
  return { reduced, top, atRail, bottom, focusCheck, shotFile };
}

/* ------------------------------------------------------------------ */
/* 21e. rail 在 320 与 200% 缩放下：文字完整、无重叠、进度线方向正确      */
/* ------------------------------------------------------------------ */
async function testRailNarrow(page) {
  const out = {};
  for (const vp of [
    { name: "320x640", width: 320, height: 640 },
    { name: "720x450(200% zoom)", width: 720, height: 450 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page, BASE + "/");
    await page.evaluate(() => {
      const el = document.querySelector("[data-rail]");
      if (el) el.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(700);
    const data = await page.evaluate(() => {
      const rail = document.querySelector("[data-rail]");
      const steps = [...document.querySelectorAll("[data-rail-step]")];
      const progress = window.__a11y.byToken("railProgress");
      const rects = steps.map((s) => {
        const r = s.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
      });
      let overlap = false;
      for (let i = 1; i < rects.length; i += 1) {
        if (rects[i].top < rects[i - 1].bottom - 1) overlap = true;
      }
      const texts = steps.map((s) => ({
        label: (s.querySelector("[class*=railLabel]") || {}).textContent || "",
        title: (s.querySelector("h3") || {}).textContent || "",
        text: (s.querySelector("[class*=railText]") || {}).textContent || "",
        visible: window.__a11y.visible(s),
      }));
      return {
        railProgressValue: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() : null,
        progressTransform: progress ? getComputedStyle(progress).transform : null,
        progressSize: progress
          ? { w: Math.round(progress.getBoundingClientRect().width), h: Math.round(progress.getBoundingClientRect().height) }
          : null,
        activeSteps: steps.map((s) => s.hasAttribute("data-active")),
        texts,
        textsComplete: texts.every((t) => t.label.trim() && t.title.trim() && t.text.trim()),
        overlap,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    out[vp.name] = data;
    await shot(page, `rail-${vp.name}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 21f. 页头 CTA / 账号页 CTA / 徽标 字号与触控（B3 修复复验）            */
/* ------------------------------------------------------------------ */
async function testHeaderAndBadge(page) {
  const rows = [];
  for (const vp of [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "1024x768", width: 1024, height: 768 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "390x844", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page, BASE + "/");
    const data = await page.evaluate(() => {
      const headerCta = document.querySelector("header nav a[href='/focus']");
      const badge = window.__a11y.byToken("lensStatus");
      const read = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || "").replace(/\s+/g, " ").trim(), fontSize: parseFloat(cs.fontSize), w: Math.round(r.width), h: Math.round(r.height), under44: r.width < 44 || r.height < 44 };
      };
      return { headerCta: read(headerCta), badge: read(badge) };
    });
    rows.push({ viewport: vp.name, ...data });
  }
  // 账号页移动端「返回官网」
  const account = {};
  for (const route of ["/login", "/register", "/forgot-password"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, BASE + route);
    account[route] = await page.evaluate(() => {
      const cta = document.querySelector("header nav a");
      if (!cta) return null;
      const cs = getComputedStyle(cta);
      const r = cta.getBoundingClientRect();
      return { text: (cta.textContent || "").trim(), fontSize: parseFloat(cs.fontSize), w: Math.round(r.width), h: Math.round(r.height) };
    });
  }
  return { home: rows, account };
}

/* ------------------------------------------------------------------ */
/* 22. 分步关键说明字号（五步内 + dialog 内）                            */
/* ------------------------------------------------------------------ */
const STEP_TEXT = {
  1: [
    ["factMark", "记录中提到", true],
    ["factRowText", "初赛需要作品说明文档和演示材料。", true],
    ["waitingBadgeUnknown", "当前状态待确认", true],
    ["unknownRowText", "上述任务现在是否已经完成？现有素材没有提供新的完成回执。", true],
  ],
  2: [
    ["stateDiffBaseline", "比较基线：已有记录 → 本页核对", false],
    ["stateDiffSummary", "当前完成情况待确认", true],
    ["stateDiffAfter", "已有任务记录，但没有新的完成回执；当前状态待确认", true],
    ["evidenceDetailsSummary", "展开这条建议的依据", true],
    ["detailNote", "这里没有断言当前功能未完成；判断仍需要新的结果记录。", true],
    ["paneHeadingPreset", "预设示例", true],
  ],
  3: [
    ["proposalBadgeWaiting", "待用户确认", true],
    ["proposalFieldLabel", "要做什么", true],
    ["proposalFieldValue", "录入一条项目记录，查看生成的记忆，再整理一份成果草稿。", true],
    ["confirmButton", "在示例中确认行动", true],
  ],
  4: [
    ["receiptGate", "先确认行动，再填写模拟回执。单纯切换到这一步，不会把行动标为完成。", true],
    ["receiptHelp", "请写下一个假设的操作结果。不要填写私人资料；这不会成为真实项目的完成证明。", true],
    ["receiptLabel", "填写一段模拟完成结果", true],
  ],
};

async function testKeyTextSteps(page) {
  const out = {};
  await goto(page, BASE + "/");
  for (const step of [1, 2, 3, 4]) {
    await page.locator(`#story-tab-${step}`).click();
    await page.waitForTimeout(260);
    out[`step${step}`] = await measureKeyText(page, STEP_TEXT[step]);
  }
  // 第 3 步展开依据
  await page.locator("#story-tab-2").click();
  await page.waitForTimeout(200);
  await page.getByText("展开这条建议的依据", { exact: true }).click();
  await page.waitForTimeout(200);
  out.step2Open = await measureKeyText(page, [
    ["detailNote", "这里没有断言当前功能未完成；判断仍需要新的结果记录。", true],
    ["evidenceBody", "初赛需要准备创意描述、设计稿、作品介绍文档和演示材料。", true],
  ]);
  // 第 5 步：确认 -> 表单 -> 保存 -> 回依据页
  await page.locator("#story-tab-3").click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "在示例中确认行动" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "去填写模拟回执" }).click();
  await page.waitForTimeout(250);
  out.step5Form = await measureKeyText(page, [
    ["receiptHelp", "请写下一个假设的操作结果。不要填写私人资料；这不会成为真实项目的完成证明。", true],
    ["receiptLabel", "填写一段模拟完成结果", true],
  ]);
  await page.locator("#demo-receipt").fill("已录入一条示例记录并生成草稿，来源仍待逐项核对。");
  await page.getByRole("button", { name: "保存模拟回执" }).click();
  await page.waitForTimeout(300);
  out.step5Saved = await measureKeyText(page, [
    ["savedReceiptTitle", "模拟回执已加入本页示例", true],
    ["savedReceiptNote", "结果由你在本页填写，未经过实际操作核验。", true],
  ]);
  // dialog 内 provenance
  await page.locator("#story-tab-1").click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "查看原文：任务安排" }).click();
  await page.waitForTimeout(300);
  out.dialog = await measureKeyText(page, [
    ["dialogProvenance", "原文取自项目自带的演示素材，不是在线用户的个人记录。", true],
    ["dialogHeaderLabel", "示例原始记录", true],
  ]);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return out;
}

/* ------------------------------------------------------------------ */
/* 23. 跳过链接与 sticky header 遮挡                                   */
/* ------------------------------------------------------------------ */
async function testSkipLink(page) {
  const rows = [];
  for (const vp of [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "390x844", width: 390, height: 844 },
    { name: "720x450(200% zoom)", width: 720, height: 450 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await goto(page, BASE + "/");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim(),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor },
      };
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => {
      const header = document.querySelector("header");
      const pos = document.querySelector('[class*=positioning]');
      const h1 = document.querySelector("h1");
      const main = document.querySelector("main");
      return {
        hash: location.hash,
        activeTag: document.activeElement.tagName.toLowerCase(),
        mainHasFocus: document.activeElement === main,
        mainTabIndex: main.getAttribute("tabindex"),
        mainOutline: getComputedStyle(main).outlineStyle,
        scrollY: Math.round(window.scrollY),
        headerBottom: Math.round(header.getBoundingClientRect().bottom),
        mainTop: Math.round(main.getBoundingClientRect().top),
        mainScrollMarginTop: getComputedStyle(main).scrollMarginTop,
        firstHeroTextTop: pos ? Math.round(pos.getBoundingClientRect().top) : null,
        h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        firstHeroTextCovered: pos ? Math.round(pos.getBoundingClientRect().top) < Math.round(header.getBoundingClientRect().bottom) : null,
      };
    });
    rows.push({ viewport: vp.name, focused, after });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 24. 系统深色 + 无已保存主题的首访主题                                */
/* ------------------------------------------------------------------ */
async function testSystemDarkFirstVisit() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-CN" });
  const page = await context.newPage();
  await page.addInitScript(IN_PAGE);
  await goto(page, BASE + "/");
  await page.waitForTimeout(600);
  const data = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    storedTheme: localStorage.getItem("theme"),
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    themeToggleCount: document.querySelectorAll('[aria-label="切换深浅色主题"]').length,
  }));
  await context.close();
  return data;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
const { context: mainContext, page: mainPage } = await newPage();

await run("keyTextDesktop", async () => {
  await goto(mainPage, BASE + "/");
  const data = await measureKeyText(mainPage);
  const tokens = await measureTokens(mainPage);
  const scan = await scanText(mainPage);
  return { measurements: data, tokenMeasurements: tokens, smallText: scan.small, smallCount: scan.smallCount, lowContrastCount: scan.lowContrastCount };
});

await run("keyTextMobile320", async () => {
  await mainPage.setViewportSize({ width: 320, height: 640 });
  await goto(mainPage, BASE + "/");
  const data = await measureKeyText(mainPage);
  const tokens = await measureTokens(mainPage);
  const scan = await scanText(mainPage);
  const shotFile = await shot(mainPage, "text-320");
  return { measurements: data, tokenMeasurements: tokens, smallText: scan.small, smallCount: scan.smallCount, lowContrastCount: scan.lowContrastCount, shotFile };
});

await run("smallTextAndContrastDesktop", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await scanText(mainPage);
});

await run("targetsDesktop", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await scanTargets(mainPage);
});

await run("targetsMobile390", async () => {
  await mainPage.setViewportSize({ width: 390, height: 844 });
  await goto(mainPage, BASE + "/");
  const data = await scanTargets(mainPage);
  const shotFile = await shot(mainPage, "targets-390");
  return { ...data, shotFile };
});

await run("tabsDesktop", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await testTabs(mainPage);
});

await run("tabsMobile320", async () => {
  await mainPage.setViewportSize({ width: 320, height: 640 });
  await goto(mainPage, BASE + "/");
  const data = await testTabs(mainPage);
  const shotFile = await shot(mainPage, "tabs-320");
  return { ...data, shotFile };
});

await run("dialogDesktop", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await testDialog(mainPage);
});

await run("dialogLong900", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await testLongDialog(mainPage, "1440x900");
});

await run("dialogLong200Zoom", async () => {
  await mainPage.setViewportSize({ width: 720, height: 450 });
  await goto(mainPage, BASE + "/");
  return await testLongDialog(mainPage, "720x450");
});

await run("anchors", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testAnchors(mainPage);
});

await run("anchors320", async () => {
  await mainPage.setViewportSize({ width: 320, height: 640 });
  const data = await testAnchors(mainPage);
  const shotFile = await shot(mainPage, "anchor-experience-320");
  return { ...data, shotFile };
});

await run("overflow", async () => {
  return await testOverflow(mainPage);
});

await run("reducedMotion", async () => {
  return await testReducedMotion();
});

await run("contrastMedia", async () => {
  return await testContrastMedia();
});

await run("darkTheme", async () => {
  return await testDarkTheme();
});

await run("keyboard", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testKeyboard(mainPage);
});

await run("externalLinks", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testExternalLinks(mainPage);
});

await run("networkOnLoad", async () => {
  return await testNetworkOnLoad();
});

await run("heroEntranceNormal", async () => {
  return await testHeroEntrance(false);
});

await run("heroEntranceReduced", async () => {
  return await testHeroEntrance(true);
});

await run("heroStageDesktop", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await testHeroStage(mainPage, false);
});

await run("heroStageMobile390", async () => {
  await mainPage.setViewportSize({ width: 390, height: 844 });
  await goto(mainPage, BASE + "/");
  return await testHeroStage(mainPage, false);
});

await run("heroStageReduced", async () => {
  return await testHeroStage(null, true);
});

await run("evidenceToggle", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testEvidenceToggle(mainPage);
});

await run("mobileTabs", async () => {
  return await testMobileTabs(mainPage);
});

await run("scrollMotionNormal", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testScrollMotion(mainPage, false);
});

await run("scrollMotionReduced", async () => {
  return await testScrollMotion(null, true);
});

await run("railNarrow", async () => {
  return await testRailNarrow(mainPage);
});

await run("headerAndBadge", async () => {
  return await testHeaderAndBadge(mainPage);
});

await run("keyTextSteps", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testKeyTextSteps(mainPage);
});

await run("skipLink", async () => {
  return await testSkipLink(mainPage);
});

await run("systemDarkFirstVisit", async () => {
  return await testSystemDarkFirstVisit();
});

await run("structure", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  await goto(mainPage, BASE + "/");
  return await testStructure(mainPage);
});

await run("accountPages", async () => {
  return await testAccountPages(mainPage);
});

await run("accountPagesDark", async () => {
  return await testAccountPagesDark();
});

await run("noJs", async () => {
  return await testNoJs();
});

await run("imageFailure", async () => {
  return await testImageFailure();
});

await run("statusMessages", async () => {
  await mainPage.setViewportSize({ width: 1440, height: 900 });
  return await testStatusMessages(mainPage);
});

results.consoleErrors = consoleErrors;
results.meta.finishedAt = new Date().toISOString();

const outFile = path.join(JSONDIR, `probe-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await mainContext.close();
await browser.close();

console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
for (const e of results.errors) console.log(" - " + e.section + ": " + e.message.split("\n")[0]);
const small = results.sections.smallTextAndContrastDesktop || {};
console.log("SMALL_TEXT " + (small.smallCount ?? "?"));
console.log("LOW_CONTRAST " + (small.lowContrastCount ?? "?"));
const targets = results.sections.targetsDesktop || {};
console.log("TARGETS_UNDER44 " + (targets.under44 ? targets.under44.length : "?"));
