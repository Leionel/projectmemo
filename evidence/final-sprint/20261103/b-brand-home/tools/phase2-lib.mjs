/**
 * Track B / task-4 Phase 2 共用工具：浏览器启动、网络审计、首页指标采集、截图落盘。
 * 只读本地 Next dev（http://127.0.0.1:34111），不修改业务代码。
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const BASE = "http://127.0.0.1:34111";
export const SOURCE_SHA = "9bae926e9475cedef118deedf5e002ec8365a23b";
export const EV = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home");

export const nowIso = () => new Date().toISOString();
export const rel = (p) => path.relative(ROOT, p).replaceAll("\\", "/");
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
export const writeJson = async (p, v) => {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");
};

export function environment() {
  const cpus = os.cpus();
  return {
    os: `${os.platform()} ${os.release()} (${os.version()})`,
    arch: os.arch(),
    cpu: cpus.length ? `${cpus[0].model} ×${cpus.length}` : "unknown",
    totalMemoryGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    node: process.version,
    browser: "chromium via @playwright/test 1.61.1 (headless)",
    deviceScaleFactor: 1,
    network: "localhost loopback（Next dev，同一台机器）",
    timezoneId: "Asia/Shanghai",
    locale: "zh-CN",
    mode: "Next dev（非生产构建）；LLM_MODE=mock、空 SQLite、无 Worker（由 Lead 提供）",
    caveat: "性能/体积数字仅代表本机本地 dev 环境，不宣称代表所有用户体验或生产构建。",
  };
}

export const launchBrowser = () => chromium.launch({ headless: true });

export const newContext = (browser, overrides = {}) =>
  browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "no-preference",
    acceptDownloads: false,
    ...overrides,
  });

/* ------------------------------------------------------------------ */
/* 网络审计                                                             */
/* ------------------------------------------------------------------ */
const isLocalHost = (hostname) =>
  hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";

export function createNet() {
  const net = {
    label: "warmup",
    records: [],
    consoleErrors: [],
    pageErrors: [],
    abortedByUs: [],
    setLabel(label) {
      net.label = label;
    },
    attach(page) {
      const map = new WeakMap();
      page.on("request", (request) => {
        const record = {
          capture: net.label,
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          status: null,
          ok: null,
          failure: null,
          contentType: null,
          contentLength: null,
          at: nowIso(),
        };
        try {
          const url = new URL(record.url);
          record.origin = url.origin;
          record.pathname = url.pathname;
          record.local = isLocalHost(url.hostname);
          record.isApiWrite = url.pathname.startsWith("/api/") && record.method !== "GET";
          record.isBilibili = /(^|\.)bilibili\.com$/i.test(url.hostname) || /bilibili/i.test(url.hostname);
        } catch {
          record.origin = null;
          record.pathname = null;
          record.local = true;
          record.isApiWrite = false;
          record.isBilibili = false;
        }
        map.set(request, record);
        net.records.push(record);
      });
      page.on("response", (response) => {
        const record = map.get(response.request());
        if (!record) return;
        record.status = response.status();
        record.ok = response.ok();
        const headers = response.headers();
        record.contentType = headers["content-type"] ?? null;
        record.contentLength = headers["content-length"] ? Number(headers["content-length"]) : null;
      });
      page.on("requestfailed", (request) => {
        const record = map.get(request);
        if (!record) return;
        record.failure = request.failure()?.errorText ?? "unknown";
      });
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          net.consoleErrors.push({ capture: net.label, type: msg.type(), text: msg.text().slice(0, 500) });
        }
      });
      page.on("pageerror", (err) => {
        net.pageErrors.push({ capture: net.label, text: String(err).slice(0, 500) });
      });
    },
  };
  return net;
}

export function summarizeNet(net) {
  const all = net.records;
  const unique = new Map();
  for (const r of all) {
    const k = `${r.method} ${r.url}`;
    const cur = unique.get(k) ?? {
      method: r.method,
      url: r.url,
      origin: r.origin,
      pathname: r.pathname,
      resourceType: r.resourceType,
      local: r.local,
      isApiWrite: r.isApiWrite,
      isBilibili: r.isBilibili,
      statuses: [],
      failures: [],
      count: 0,
    };
    cur.count += 1;
    if (r.status !== null && !cur.statuses.includes(r.status)) cur.statuses.push(r.status);
    if (r.failure && !cur.failures.includes(r.failure)) cur.failures.push(r.failure);
    unique.set(k, cur);
  }
  const failures = all.filter((r) => r.failure || (r.status !== null && r.status >= 400));
  const external = [...unique.values()].filter((r) => !r.local);
  const apiWrites = [...unique.values()].filter((r) => r.isApiWrite);
  const bilibili = all.filter((r) => r.isBilibili);
  return {
    totals: {
      requestRecords: all.length,
      uniqueRequestUrls: unique.size,
      externalOriginRequests: external.length,
      apiWriteRequests: apiWrites.length,
      bilibiliRequests: bilibili.length,
      failures: failures.length,
      imageFontFailures: failures.filter((r) => r.resourceType === "image" || r.resourceType === "font").length,
      consoleErrors: net.consoleErrors.length,
      pageErrors: net.pageErrors.length,
      userAbortedRequests: net.abortedByUs.length,
    },
    assertions: {
      noBilibiliRequestDuringLoad: bilibili.length === 0,
      noApiWrites: apiWrites.length === 0,
      noExternalOrigins: external.length === 0,
      noPageErrors: net.pageErrors.length === 0,
    },
    externalOrigins: external.map((r) => ({ origin: r.origin, url: r.url, method: r.method, resourceType: r.resourceType, statuses: r.statuses, count: r.count })),
    apiWrites,
    bilibiliRequests: bilibili.map((r) => ({ capture: r.capture, url: r.url, method: r.method, resourceType: r.resourceType, status: r.status })),
    userAborted: net.abortedByUs,
    failures: failures.map((r) => ({ capture: r.capture, url: r.url, method: r.method, status: r.status, failure: r.failure, resourceType: r.resourceType })),
    consoleErrors: net.consoleErrors,
    pageErrors: net.pageErrors,
    uniqueUrls: [...unique.values()],
    requests: all.map((r) => ({
      capture: r.capture,
      method: r.method,
      url: r.url,
      origin: r.origin,
      pathname: r.pathname,
      resourceType: r.resourceType,
      status: r.status,
      failure: r.failure,
      local: r.local,
      isApiWrite: r.isApiWrite,
      isBilibili: r.isBilibili,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 首页指标（自包含，供 page.evaluate 使用）                              */
/* ------------------------------------------------------------------ */
export const HOME_METRICS_FN = () => {
  const html = document.documentElement;
  const body = document.body;
  const cs = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      right: +r.right.toFixed(2),
      inFirstScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
      clippedRight: r.right > window.innerWidth + 1,
      clippedLeft: r.left < -1,
      clippedBottom: r.bottom > window.innerHeight + 1,
      display: s.display,
      visibility: s.visibility,
    };
  };
  const txt = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const q = (sel) => document.querySelector(sel);

  const hero = q("#home-heading");
  const h1 = q("#hero-title");
  const heroInner = hero?.querySelector(":scope > div") ?? null;
  const heroCopy = heroInner?.querySelector(":scope > div") ?? null;
  const lens = heroInner?.querySelectorAll(":scope > div")?.[1] ?? null;
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => ({
    id: t.id,
    label: t.innerText.replace(/\s+/g, " ").trim(),
    ariaSelected: t.getAttribute("aria-selected"),
    tabIndex: t.tabIndex,
    bbox: rect(t),
  }));
  const selectedTab = tabs.find((t) => t.ariaSelected === "true") ?? null;
  const evidenceButton =
    [...document.querySelectorAll("button")].find((b) => /查看依据|收起依据/.test(b.innerText || "")) ?? null;
  const evidencePanel = q("#hero-evidence");
  const dialogEl = q("dialog[open]");
  const videoLink = q('a[href*="bilibili"]');

  const probe = (sel) => {
    const el = q(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      selector: sel,
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70),
      fontSize: s.fontSize,
      fontSizePx: +parseFloat(s.fontSize).toFixed(2),
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      color: s.color,
      width: +r.width.toFixed(1),
      height: +r.height.toFixed(1),
    };
  };
  const fontSizeSelectors = {
    h1: "#hero-title",
    heroSub: "#hero-title + p",
    heroNote: '[class*="heroNote"]',
    lensKicker: '[class*="lensKicker"]',
    lensMission: '[class*="lensMission"]',
    stageTab: '[class*="stageTab"]',
    rowLabel: '[class*="lensRow"] dt',
    rowValue: '[class*="rowValue"]',
    rowMeta: '[class*="rowMeta"]',
    lensFoot: '[class*="lensFoot"]',
    sectionKicker: '#missions [class*="kicker"]',
    sectionIntro: '#missions [class*="sectionIntro"]',
    railLabel: '[class*="railLabel"]',
    railText: '[class*="railText"]',
    demoNote: '[class*="demoNote"]',
    storyFooter: '[class*="storyFooter"] > p',
    paneHeading: '[class*="paneHeading"] h4',
    projectKicker: '[class*="projectKicker"]',
    sourceButton: '[class*="sourceButton"]',
    videoMeta: '[class*="videoMeta"]',
    footerMeta: '[class*="footerMeta"]',
    boundary: '[class*="boundary"] p',
    caption: '[class*="caption"]',
  };
  const fontSizes = Object.fromEntries(Object.entries(fontSizeSelectors).map(([k, sel]) => [k, probe(sel)]));

  // 可见文字元素中的最小字号（B3 字号要求取证；仅主内容区、排除 svg 与隐藏元素）
  const smallText = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("#main-content *")) {
    if (el.closest("svg")) continue;
    const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasDirectText) continue;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fs = +parseFloat(s.fontSize).toFixed(2);
    const sample = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const key = `${fs}|${sample}`;
    if (seen.has(key)) continue;
    seen.add(key);
    smallText.push({ fontSizePx: fs, text: sample, tag: el.tagName.toLowerCase() });
  }
  smallText.sort((a, b) => a.fontSizePx - b.fontSizePx);

  const overflowers = [];
  if (html.scrollWidth > window.innerWidth + 1) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          class: typeof el.className === "string" ? el.className.slice(0, 120) : "",
          left: +r.left.toFixed(1),
          right: +r.right.toFixed(1),
        });
        if (overflowers.length >= 15) break;
      }
    }
  }

  const headings = [...document.querySelectorAll("#main-content h1, #main-content h2, #main-content h3")].map((h) => ({
    tag: h.tagName.toLowerCase(),
    id: h.id || null,
    text: (h.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
    bbox: rect(h),
  }));

  const ariaBusy = [...document.querySelectorAll('[aria-busy="true"]')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
  }));

  const fontFaces = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
  const images = [...document.images].map((img) => ({ src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth }));
  const active = document.activeElement;

  // ---- 216cf05 新增滚动动效的运行时状态 ----
  const root = q("#main-content");
  const dataMotion = root?.getAttribute("data-motion") ?? null;
  const scrollProgressEl = q("[data-scroll-progress]");
  const heroCopyEl = q("[data-hero-copy]");
  const heroLensEl = q("[data-hero-lens]");
  const railEl = q("[data-rail]");
  const heroEl = q("[data-hero]");
  const railProgressEl = q('[class*="railProgress"]');
  const railSteps = [...document.querySelectorAll("[data-rail-step]")].map((el) => ({
    label: (el.querySelector('[class*="railLabel"]')?.innerText ?? el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 24),
    dataActive: el.hasAttribute("data-active"),
  }));
  const kickers = [...document.querySelectorAll("[data-draw]")].map((el) => ({
    text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30),
    dataDrawn: el.getAttribute("data-drawn"),
    afterTransform: getComputedStyle(el, "::after").transform,
  }));
  const motion = {
    dataMotion,
    scrollProgress: scrollProgressEl
      ? {
          exists: true,
          bbox: rect(scrollProgressEl),
          transform: getComputedStyle(scrollProgressEl).transform,
          dataVisible: scrollProgressEl.hasAttribute("data-visible"),
        }
      : { exists: false },
    heroShift: heroEl ? getComputedStyle(heroEl).getPropertyValue("--hero-shift").trim() || null : null,
    heroCopyTranslate: heroCopyEl ? getComputedStyle(heroCopyEl).translate : null,
    heroLensTranslate: heroLensEl ? getComputedStyle(heroLensEl).translate : null,
    heroCopyLayoutTop: heroCopyEl ? heroCopyEl.offsetTop : null,
    heroLensLayoutTop: heroLensEl ? heroLensEl.offsetTop : null,
    rail: railEl
      ? {
          bbox: rect(railEl),
          progressVar: getComputedStyle(railEl).getPropertyValue("--rail-progress").trim() || null,
          progressElBBox: rect(railProgressEl),
          progressElTransform: railProgressEl ? getComputedStyle(railProgressEl).transform : null,
          activeCount: railSteps.filter((s) => s.dataActive).length,
          steps: railSteps,
        }
      : null,
    kickers,
  };

  return {
    url: location.href,
    title: document.title,
    htmlClass: html.className,
    bodyBackgroundColor: cs(body, "background-color"),
    bodyColor: cs(body, "color"),
    bodyFontFamily: cs(body, "font-family"),
    h1Text: txt(h1),
    h1Color: cs(h1, "color"),
    h1FontFamily: cs(h1, "font-family"),
    localStorageTheme: (() => {
      try {
        return localStorage.getItem("theme");
      } catch {
        return null;
      }
    })(),
    prefersColorSchemeDark: matchMedia("(prefers-color-scheme: dark)").matches,
    prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    scrollWidth: html.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollHeight: html.scrollHeight,
    horizontalOverflow: html.scrollWidth > window.innerWidth + 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio,
    fontStatus: document.fonts.status,
    fontFaces,
    pmBrandFontAvailable: document.fonts.check('12px "PM Brand"'),
    imageCount: images.length,
    images,
    brokenImages: images.filter((i) => i.complete && i.naturalWidth === 0),
    ariaBusyElements: ariaBusy,
    overflowers,
    activeElement: active
      ? {
          tag: active.tagName.toLowerCase(),
          text: (active.innerText || active.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60),
          ariaLabel: active.getAttribute?.("aria-label") ?? null,
        }
      : null,
    tabs,
    selectedTab,
    evidenceButton: evidenceButton
      ? {
          text: evidenceButton.innerText.trim(),
          ariaExpanded: evidenceButton.getAttribute("aria-expanded"),
          ariaControls: evidenceButton.getAttribute("aria-controls"),
          bbox: rect(evidenceButton),
        }
      : null,
    evidencePanel: evidencePanel
      ? {
          dataOpen: evidencePanel.getAttribute("data-open"),
          textLength: evidencePanel.innerText.length,
          textFirst80: (evidencePanel.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
          bbox: rect(evidencePanel),
          evidenceListVisible: Boolean(evidencePanel.querySelector('[class*="evidenceList"]')),
        }
      : null,
    panelAriaLabelledby: q("#stage-panel")?.getAttribute("aria-labelledby") ?? null,
    dialog: dialogEl
      ? {
          open: true,
          ariaLabelledby: dialogEl.getAttribute("aria-labelledby"),
          title: q("#source-title")?.innerText ?? null,
          textFirst120: (dialogEl.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120),
          bbox: rect(dialogEl),
        }
      : { open: false },
    videoLink: videoLink
      ? {
          href: videoLink.getAttribute("href"),
          target: videoLink.getAttribute("target"),
          rel: videoLink.getAttribute("rel"),
          text: (videoLink.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
          bbox: rect(videoLink),
        }
      : null,
    textMetrics: {
      mainTextLength: q("#main-content")?.innerText.length ?? null,
      heroTextLength: hero?.innerText.length ?? null,
      heroCopyTextLength: heroCopy?.innerText.length ?? null,
      lensTextLength: lens?.innerText.length ?? null,
      panelTextLength: q("#stage-panel")?.innerText.length ?? null,
      storyTextLength: q("#experience")?.innerText.length ?? null,
    },
    fontSizes,
    smallTextBottom: smallText.slice(0, 15),
    minVisibleFontSizePx: smallText.length ? smallText[0].fontSizePx : null,
    headings,
    motion,
    elements: {
      header: rect(document.querySelector("header")),
      heroSection: rect(hero),
      heroInner: rect(heroInner),
      heroCopy: rect(heroCopy),
      positioning: rect(heroCopy?.querySelector("p")),
      h1: rect(h1),
      heroSub: rect(heroCopy?.querySelector("h1 + p")),
      heroActions: rect(heroCopy?.querySelector('[class*="heroActions"]')),
      ctaPrimary: rect(heroCopy?.querySelector('a[href="#experience"]')),
      ctaSecondary: rect(heroCopy?.querySelector('a[href^="/login"], a[href="/focus"]')),
      heroNote: rect(heroCopy?.querySelector('[class*="heroNote"]')),
      lens: rect(lens),
      lensHead: rect(lens?.querySelector("header")),
      lensKicker: rect(lens?.querySelector('[class*="lensKicker"]')),
      lensMission: rect(lens?.querySelector('[class*="lensMission"]')),
      stageTabs: rect(document.querySelector('[role="tablist"][aria-label^="委托阶段"]')),
      stagePanel: rect(q("#stage-panel")),
      lensRows: rect(q("#stage-panel")?.querySelector("dl")),
      lensActions: rect(q("#stage-panel")?.querySelector('[class*="lensActions"]')),
      evidenceWrap: rect(evidencePanel),
      lensFoot: rect(lens?.querySelector('[class*="lensFoot"]')),
      storyFrame: rect(q('[class*="storyFrame"]')),
      storyTabs: rect(document.querySelector('[role="tablist"][aria-label="项目故事步骤"]')),
      storyPanel: rect(q("#story-panel")),
      missionsSection: rect(q("#missions")),
      experienceSection: rect(q("#experience")),
      momentsSection: rect(q("#moments")),
      demoSection: rect(q("#demo")),
      closingSection: rect(q('[class*="closing"]')),
      boundary: rect(q('[class*="boundary"]')),
      footer: rect(q("footer")),
      continuityTitle: rect(q("#continuity-title")),
      experienceTitle: rect(q("#experience-title")),
      demoTitle: rect(q("#demo-title")),
      videoLink: rect(videoLink),
      closingCta: rect(q('[class*="closingCta"]')),
      skipLink: rect(q("a.skip-link")),
    },
  };
};

/* ------------------------------------------------------------------ */
/* 等待与截图                                                            */
/* ------------------------------------------------------------------ */
export async function waitForDevOverlayClear(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await page.evaluate(() => {
      const text = [...document.querySelectorAll("nextjs-portal")].map((p) => p.shadowRoot?.textContent ?? "").join(" ");
      return /Compiling|Building|Rendering|hmr/i.test(text);
    });
    if (!busy) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

export async function settlePage(page, { minWaitMs = 900 } = {}) {
  await page.waitForTimeout(minWaitMs);
  await page.evaluate(async () => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const running = document.getAnimations().filter((a) => a.playState === "running");
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
}

export async function loadHome(page, { theme = "light", width = 1440, height = 900, net, label = "load", settleMs = 900 } = {}) {
  net?.setLabel(`${label}-goto`);
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  net?.setLabel(label);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#hero-title").waitFor({ state: "visible" });
  await page.waitForFunction((expected) => document.documentElement.classList.contains(expected), theme, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await settlePage(page, { minWaitMs: settleMs });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(120);
}

export async function captureState(page, { dir, metricsDir, name, metricsName, label, net, extra = {} }) {
  await waitForDevOverlayClear(page);
  const file = path.join(dir, name);
  await page.screenshot({ path: file, fullPage: false });
  const buf = await stat(file);
  const sha = sha256(await readFile(file));
  const metrics = await page.evaluate(HOME_METRICS_FN);
  const captureRequests = net ? net.records.filter((r) => r.capture === label) : [];
  const json = {
    phase: 2,
    kind: "after-state",
    label,
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    viewport: page.viewportSize(),
    file: rel(file),
    fileBytes: buf.size,
    fileSha256: sha,
    metrics,
    ...extra,
    network: {
      requestCount: captureRequests.length,
      failures: captureRequests
        .filter((r) => r.failure || (r.status !== null && r.status >= 400))
        .map((r) => ({ url: r.url, status: r.status, failure: r.failure, resourceType: r.resourceType })),
    },
  };
  const metricsFileName = (metricsName ?? name).replace(/\.png$/i, ".json");
  await writeJson(path.join(metricsDir, metricsFileName), json);
  return { label, name, metricsFileName, file: rel(file), fileBytes: buf.size, fileSha256: sha, viewport: json.viewport, metrics };
}

export function keyMetrics(metrics) {
  return {
    title: metrics.title,
    h1Text: metrics.h1Text,
    htmlClass: metrics.htmlClass,
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
    horizontalOverflow: metrics.horizontalOverflow,
    fontStatus: metrics.fontStatus,
    minVisibleFontSizePx: metrics.minVisibleFontSizePx,
    selectedTab: metrics.selectedTab,
    evidenceOpen: metrics.evidenceButton?.ariaExpanded === "true",
    imageCount: metrics.imageCount,
    heroCopyTop: metrics.elements.heroCopy?.y ?? null,
    ctaVisibleInFirstScreen: metrics.elements.ctaPrimary?.inFirstScreen ?? null,
  };
}
