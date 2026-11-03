/**
 * Track B / task-4 Phase 1 — /prototype/hero-a 与 /prototype/hero-b 同条件对照采集。
 *
 * 只读本地 Next dev（http://127.0.0.1:34111），不启动/重启服务、不修改业务代码。
 * 输出（evidence/final-sprint/20261103/b-brand-home/b1/）：
 *   screens/proto-{a|b}-{1440|390}-{light|dark}.png          8 张主图（页顶、整视口）
 *   screens/proto-a-1440-light-during.png / -evidence.png     A 交互图
 *   screens/proto-b-1440-light-evidence-materials.png / -task.png  B 交互图
 *   metrics/*.json                                            每个状态指标
 *   phase1-metrics.json                                       汇总 + 公平性文字量
 *   network-proto.json                                        网络审计（外域/写请求/失败）
 *   MANIFEST.json                                             文件清单与 sha256
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-phase1.mjs
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const OUT = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/b1");
const SCREENS = path.join(OUT, "screens");
const METRICS_DIR = path.join(OUT, "metrics");

const BASE = "http://127.0.0.1:34111";
const SOURCE_SHA = "485d485378637e1da3280ed092739d441c8cf749";
const ROUTES = [
  { key: "a", path: "/prototype/hero-a", headingId: "proto-a-heading", title: "B1 原型 A｜原委托四问工作包" },
  { key: "b", path: "/prototype/hero-b", headingId: "proto-b-heading", title: "B1 原型 B｜来源变化因果镜头" },
];
const MATRIX = [
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const nowIso = () => new Date().toISOString();
const rel = (p) => path.relative(ROOT, p).replaceAll("\\", "/");

const net = { current: "warmup", records: [], consoleErrors: [], pageErrors: [] };
const requestRecords = new WeakMap();

function isLocalHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}
function classify(record) {
  try {
    const url = new URL(record.url);
    record.origin = url.origin;
    record.pathname = url.pathname;
    record.local = isLocalHost(url.hostname);
    record.isApiWrite = url.pathname.startsWith("/api/") && record.method !== "GET";
  } catch {
    record.origin = null;
    record.pathname = null;
    record.local = true;
    record.isApiWrite = false;
  }
  return record;
}

/** 原型页状态指标（A/B 通用结构 + 各自特有节点）。 */
const collectProtoMetrics = (routeKey) => {
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
  const h1 = document.querySelector("h1");
  const hero = h1 ? h1.closest("section") : null;
  const copy = hero?.querySelector("div");
  const lens = hero?.querySelectorAll(":scope > div")?.[1] ?? null;
  const text = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const panel = routeKey === "a" ? document.querySelector("#proto-a-panel") : document.querySelector("section ol");
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
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => ({
    id: t.id,
    label: t.innerText.replace(/\s+/g, " ").trim(),
    ariaSelected: t.getAttribute("aria-selected"),
    tabIndex: t.tabIndex,
    bbox: rect(t),
  }));
  const chips = [...document.querySelectorAll('button[aria-controls^="proto-b-source-"]')].map((c) => ({
    text: c.innerText.trim(),
    ariaExpanded: c.getAttribute("aria-expanded"),
    controls: c.getAttribute("aria-controls"),
    bbox: rect(c),
  }));
  const evidenceButton =
    routeKey === "a"
      ? (() => {
          const b = [...document.querySelectorAll("button")].find((el) =>
            (el.innerText || "").includes("查看依据") || (el.innerText || "").includes("收起依据"),
          );
          return b ? { text: b.innerText.trim(), ariaExpanded: b.getAttribute("aria-expanded"), ariaControls: b.getAttribute("aria-controls"), bbox: rect(b) } : null;
        })()
      : null;
  const evidencePanelA = document.querySelector("#proto-a-evidence");
  const sourcePanelB = document.querySelector('[id^="proto-b-source-"]');
  const sourcePanels = [...document.querySelectorAll('[id^="proto-b-source-"]')].map((p) => ({
    id: p.id,
    textLength: p.innerText.length,
    bbox: rect(p),
    textFirst80: (p.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
  }));
  const fontFaces = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
  const images = [...document.images].map((img) => ({
    src: img.currentSrc || img.src,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
  }));
  const active = document.activeElement;
  const mainEl = document.querySelector("#main-content") ?? document.querySelector("main");
  const headerText = document.querySelector("header")?.innerText ?? "";

  return {
    url: location.href,
    title: document.title,
    htmlClass: html.className,
    bodyBackgroundColor: cs(body, "background-color"),
    h1Text: text(h1),
    h1Color: cs(h1, "color"),
    localStorageTheme: (() => {
      try {
        return localStorage.getItem("theme");
      } catch {
        return null;
      }
    })(),
    prefersColorSchemeDark: matchMedia("(prefers-color-scheme: dark)").matches,
    scrollWidth: html.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    horizontalOverflow: html.scrollWidth > window.innerWidth + 1,
    scrollHeight: html.scrollHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    fontStatus: document.fonts.status,
    fontFaces,
    pmBrandFontAvailable: document.fonts.check('12px "PM Brand"'),
    headerText: headerText.replace(/\s+/g, " ").trim(),
    headerProviderBadge: headerText.includes("云模型已配置") ? "云模型已配置" : headerText.includes("演示模式") ? "演示模式" : null,
    brokenImages: images.filter((i) => i.complete && i.naturalWidth === 0),
    images,
    overflowers,
    activeElement: active
      ? { tag: active.tagName.toLowerCase(), text: (active.innerText || active.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60) }
      : null,
    textMetrics: {
      heroSectionTextLength: hero ? hero.innerText.length : null,
      heroSectionTextFirst120: text(hero)?.slice(0, 120) ?? null,
      copyTextLength: copy ? copy.innerText.length : null,
      lensTextLength: lens ? lens.innerText.length : null,
      lensTextFirst120: text(lens)?.slice(0, 120) ?? null,
      panelTextLength: panel ? panel.innerText.length : null,
      panelTextFirst80: text(panel)?.slice(0, 80) ?? null,
      mainTextLength: mainEl ? mainEl.innerText.length : null,
    },
    tabs,
    selectedTab: tabs.find((t) => t.ariaSelected === "true") ?? null,
    panelAriaLabelledby: document.querySelector("#proto-a-panel")?.getAttribute("aria-labelledby") ?? null,
    evidenceButton,
    evidencePanelA: evidencePanelA
      ? {
          visible: true,
          textLength: evidencePanelA.innerText.length,
          textFirst80: text(evidencePanelA)?.slice(0, 80) ?? null,
          bbox: rect(evidencePanelA),
        }
      : { visible: false },
    chips,
    sourcePanelVisible: Boolean(sourcePanelB),
    sourcePanels,
    targets: [...document.querySelectorAll("section button, section a")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        minDimension: +Math.min(r.width, r.height).toFixed(1),
      };
    }),
    elements: {
      header: rect(document.querySelector("header")),
      protoBadge: rect(document.querySelector("main > p")),
      heroSection: rect(hero),
      copy: rect(copy),
      h1: rect(h1),
      sub: rect(hero?.querySelector("h1 + p")),
      actions: rect(hero?.querySelector("div a")?.parentElement),
      primaryCta: rect(hero?.querySelector('a[href="#experience"]')),
      primaryCtaText: hero?.querySelector('a[href="#experience"]')?.innerText.trim() ?? null,
      secondaryCta: rect(hero?.querySelector('a[href^="/login"]')),
      secondaryCtaText: hero?.querySelector('a[href^="/login"]')?.innerText.trim() ?? null,
      mockNote: rect(hero?.querySelector("p:last-of-type")),
      lens: rect(lens),
      lensTop: rect(lens?.querySelector("header")),
      lensTitle: rect(lens?.querySelector("h2")),
      stageTabs: rect(document.querySelector('[role="tablist"]')),
      chipRow: rect(document.querySelector('button[aria-controls^="proto-b-source-"]')?.parentElement),
      lensBody: rect(routeKey === "a" ? panel : panel?.parentElement),
      panel: rect(panel),
      evidencePanel: rect(evidencePanelA),
      sourcePanel: rect(sourcePanelB),
      lensActions: rect(panel?.parentElement?.querySelector("div:last-of-type")),
      lensFoot: rect(lens?.querySelector("footer")),
      anchorPlaceholder: rect(document.querySelector("#experience")),
    },
  };
};

async function settleAnimations(page) {
  await page.evaluate(async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const running = document.getAnimations().filter((a) => a.playState === "running");
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
}

async function capture(page, route, label, stateLabel, screenshotName, extra = {}) {
  const file = path.join(SCREENS, screenshotName);
  await page.screenshot({ path: file, fullPage: false });
  const buf = await stat(file);
  const sha = sha256(await readFile(file));
  const metrics = await page.evaluate(collectProtoMetrics, route.key);
  const captureRequests = net.records.filter((r) => r.capture === label);
  const captureJson = {
    phase: 1,
    kind: "prototype",
    route: route.path,
    routeKey: route.key,
    state: stateLabel,
    label,
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    viewport: { width: page.viewportSize()?.width ?? null, height: page.viewportSize()?.height ?? null },
    themeRequested: page.__theme ?? null,
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
  await writeFile(path.join(METRICS_DIR, `${label}.json`), JSON.stringify(captureJson, null, 2) + "\n", "utf8");
  return { label, state: stateLabel, file: rel(file), fileBytes: buf.size, fileSha256: sha, viewport: captureJson.viewport, theme: captureJson.themeRequested, key: {
    title: metrics.title,
    h1Text: metrics.h1Text,
    htmlClass: metrics.htmlClass,
    horizontalOverflow: metrics.horizontalOverflow,
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
    fontStatus: metrics.fontStatus,
    selectedTab: metrics.selectedTab,
    evidenceVisible: metrics.evidencePanelA.visible || metrics.sourcePanelVisible,
    lensTextLength: metrics.textMetrics.lensTextLength,
    panelTextLength: metrics.textMetrics.panelTextLength,
    heroSectionTextLength: metrics.textMetrics.heroSectionTextLength,
    headerProviderBadge: metrics.headerProviderBadge,
    evidencePanelBbox: metrics.elements.evidencePanel,
    sourcePanelBbox: metrics.elements.sourcePanel,
  } };
}

async function main() {
  await mkdir(SCREENS, { recursive: true });
  await mkdir(METRICS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "no-preference",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(120_000);

  page.on("request", (request) => {
    const record = classify({
      capture: net.current,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      ok: null,
      failure: null,
      contentType: null,
      at: nowIso(),
    });
    requestRecords.set(request, record);
    net.records.push(record);
  });
  page.on("response", (response) => {
    const record = requestRecords.get(response.request());
    if (!record) return;
    record.status = response.status();
    record.ok = response.ok();
    record.contentType = response.headers()["content-type"] ?? null;
  });
  page.on("requestfailed", (request) => {
    const record = requestRecords.get(request);
    if (!record) return;
    record.failure = request.failure()?.errorText ?? "unknown";
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      net.consoleErrors.push({ capture: net.current, type: msg.type(), text: msg.text().slice(0, 400) });
    }
  });
  page.on("pageerror", (err) => net.pageErrors.push({ capture: net.current, text: String(err).slice(0, 400) }));

  const mainCaptures = [];
  const interactionCaptures = [];
  const errors = [];

  async function load(route, theme, width, height) {
    net.current = `load-${route.key}-${width}-${theme}`;
    await page.setViewportSize({ width, height });
    page.__theme = theme;
    await page.goto(BASE + route.path, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    net.current = `capture-${route.key}-${width}-${theme}`;
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`#${route.headingId}`).waitFor({ state: "visible" });
    await page.waitForFunction((expected) => document.documentElement.classList.contains(expected), theme, { timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await settleAnimations(page);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }

  for (const route of ROUTES) {
    for (const { width, height, theme } of MATRIX) {
      const label = `proto-${route.key}-${width}-${theme}`;
      try {
        await load(route, theme, width, height);
        const shot = `${label}.png`;
        const result = await capture(page, route, label, "default", shot);
        mainCaptures.push({ route: route.key, routePath: route.path, width, height, theme, ...result });
      } catch (error) {
        errors.push({ label, error: String(error?.stack ?? error).slice(0, 2000) });
        try {
          await page.goto(BASE + route.path, { waitUntil: "domcontentloaded" });
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ---- 交互图：1440 light ----
  // A：默认（回来后）→ 点击“02 期间” → 截图；再回“回来后”展开“查看依据” → 截图
  try {
    const route = ROUTES[0];
    await load(route, "light", 1440, 900);
    const defaultMetrics = await page.evaluate(collectProtoMetrics, "a");
    const defaultPanelText = defaultMetrics.textMetrics.panelTextFirst80;

    net.current = "interaction-a-during";
    const duringTab = page.getByRole("tab", { name: /期间/ });
    await duringTab.click();
    await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => /期间/.test(t.innerText));
      return tab?.getAttribute("aria-selected") === "true";
    });
    await settleAnimations(page);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const duringMetrics = await page.evaluate(collectProtoMetrics, "a");
    const duringResult = await capture(page, route, "proto-a-1440-light-during", "during", "proto-a-1440-light-during.png", {
      transition: {
        from: { state: "default(回来后)", selectedTab: defaultMetrics.selectedTab, panelTextFirst80: defaultPanelText },
        to: { state: "during", selectedTab: duringMetrics.selectedTab, panelTextFirst80: duringMetrics.textMetrics.panelTextFirst80 },
        ariaSelectedChanged: defaultMetrics.selectedTab?.ariaSelected !== duringMetrics.selectedTab?.ariaSelected || defaultMetrics.selectedTab?.label !== duringMetrics.selectedTab?.label,
        panelTextChanged: defaultPanelText !== duringMetrics.textMetrics.panelTextFirst80,
      },
    });
    interactionCaptures.push({ route: "a", state: "during", ...duringResult });

    net.current = "interaction-a-evidence";
    await page.getByRole("tab", { name: /回来后/ }).click();
    await page.waitForFunction(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => /回来后/.test(t.innerText));
      return tab?.getAttribute("aria-selected") === "true";
    });
    const backMetrics = await page.evaluate(collectProtoMetrics, "a");
    const evidenceButton = page.getByRole("button", { name: /查看依据/ });
    await evidenceButton.click();
    await page.locator("#proto-a-evidence").waitFor({ state: "visible" });
    await settleAnimations(page);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const evidenceMetrics = await page.evaluate(collectProtoMetrics, "a");
    const evidenceResult = await capture(page, route, "proto-a-1440-light-evidence", "evidence-open", "proto-a-1440-light-evidence.png", {
      transition: {
        backStage: { selectedTab: backMetrics.selectedTab, panelTextFirst80: backMetrics.textMetrics.panelTextFirst80 },
        evidenceOpen: {
          evidenceButton: evidenceMetrics.evidenceButton,
          evidencePanelA: evidenceMetrics.evidencePanelA,
          panelTextChanged: backMetrics.textMetrics.panelTextFirst80 !== evidenceMetrics.textMetrics.panelTextFirst80,
        },
      },
    });
    interactionCaptures.push({ route: "a", state: "evidence-open", ...evidenceResult });
  } catch (error) {
    errors.push({ label: "interaction-a", error: String(error?.stack ?? error).slice(0, 2000) });
  }

  // B：默认完整链 → 点开“比赛材料”原文 → 截图；切到“任务安排”原文 → 截图
  try {
    const route = ROUTES[1];
    await load(route, "light", 1440, 900);
    const defaultMetrics = await page.evaluate(collectProtoMetrics, "b");
    const defaultPanelText = defaultMetrics.textMetrics.panelTextFirst80;

    net.current = "interaction-b-materials";
    await page.getByRole("button", { name: /比赛材料/ }).click();
    await page.locator("#proto-b-source-requirements").waitFor({ state: "visible" });
    await settleAnimations(page);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const materialsMetrics = await page.evaluate(collectProtoMetrics, "b");
    const materialsResult = await capture(page, route, "proto-b-1440-light-evidence-materials", "source-competition-materials", "proto-b-1440-light-evidence-materials.png", {
      transition: {
        from: { state: "default", panelTextFirst80: defaultPanelText, chips: defaultMetrics.chips },
        to: { state: "比赛材料展开", sourcePanels: materialsMetrics.sourcePanels, chips: materialsMetrics.chips },
        panelTextChanged: defaultPanelText !== materialsMetrics.textMetrics.panelTextFirst80,
      },
    });
    interactionCaptures.push({ route: "b", state: "source-competition-materials", ...materialsResult });

    net.current = "interaction-b-task";
    await page.getByRole("button", { name: /任务安排/ }).click();
    await page.locator("#proto-b-source-task").waitFor({ state: "visible" });
    await settleAnimations(page);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const taskMetrics = await page.evaluate(collectProtoMetrics, "b");
    const taskResult = await capture(page, route, "proto-b-1440-light-evidence-task", "source-task-arrangement", "proto-b-1440-light-evidence-task.png", {
      transition: {
        from: { state: "比赛材料展开", sourcePanels: materialsMetrics.sourcePanels },
        to: { state: "任务安排展开", sourcePanels: taskMetrics.sourcePanels, chips: taskMetrics.chips },
        panelTextChanged: materialsMetrics.textMetrics.panelTextFirst80 !== taskMetrics.textMetrics.panelTextFirst80,
      },
    });
    interactionCaptures.push({ route: "b", state: "source-task-arrangement", ...taskResult });
  } catch (error) {
    errors.push({ label: "interaction-b", error: String(error?.stack ?? error).slice(0, 2000) });
  }

  await context.close();
  await browser.close();

  // ---- 网络审计 ----
  const all = net.records;
  const unique = new Map();
  for (const r of all) {
    const k = `${r.method} ${r.url}`;
    const cur = unique.get(k) ?? { method: r.method, url: r.url, origin: r.origin, pathname: r.pathname, resourceType: r.resourceType, local: r.local, isApiWrite: r.isApiWrite, statuses: [], failures: [], count: 0 };
    cur.count += 1;
    if (r.status !== null && !cur.statuses.includes(r.status)) cur.statuses.push(r.status);
    if (r.failure && !cur.failures.includes(r.failure)) cur.failures.push(r.failure);
    unique.set(k, cur);
  }
  const failures = all.filter((r) => r.failure || (r.status !== null && r.status >= 400));
  const external = [...unique.values()].filter((r) => !r.local);
  const apiWrites = [...unique.values()].filter((r) => r.isApiWrite);
  const network = {
    phase: 1,
    kind: "prototype-network-audit",
    capturedAt: nowIso(),
    baseURL: BASE,
    sourceSha: SOURCE_SHA,
    note: "原型页与首页同一 dev server；原型页为隔离对照，不进入生产导航。",
    totals: {
      requestRecords: all.length,
      uniqueRequestUrls: unique.size,
      externalOriginRequests: external.length,
      apiWriteRequests: apiWrites.length,
      failures: failures.length,
      imageFontFailures: failures.filter((r) => r.resourceType === "image" || r.resourceType === "font").length,
      consoleErrors: net.consoleErrors.length,
      pageErrors: net.pageErrors.length,
    },
    externalOrigins: external.map((r) => ({ origin: r.origin, url: r.url, method: r.method, statuses: r.statuses, count: r.count })),
    apiWrites,
    failures: failures.map((r) => ({ capture: r.capture, url: r.url, method: r.method, status: r.status, failure: r.failure, resourceType: r.resourceType })),
    consoleErrors: net.consoleErrors,
    pageErrors: net.pageErrors,
    uniqueUrls: [...unique.values()],
    requests: all.map((r) => ({
      capture: r.capture,
      method: r.method,
      url: r.url,
      origin: r.origin,
      resourceType: r.resourceType,
      status: r.status,
      failure: r.failure,
      local: r.local,
      isApiWrite: r.isApiWrite,
    })),
  };
  await writeFile(path.join(OUT, "network-proto.json"), JSON.stringify(network, null, 2) + "\n", "utf8");

  // ---- 公平性文字量汇总 ----
  const byKey = (route, theme, width) => mainCaptures.find((c) => c.route === route && c.theme === theme && c.width === width);
  const fairness = ["1440-light", "390-light"].map((combo) => {
    const [w, theme] = combo.split("-");
    const a = byKey("a", theme, Number(w));
    const b = byKey("b", theme, Number(w));
    return {
      combo,
      a: a?.key ? { lensTextLength: a.key.lensTextLength, panelTextLength: a.key.panelTextLength, heroSectionTextLength: a.key.heroSectionTextLength, h1Text: a.key.h1Text } : null,
      b: b?.key ? { lensTextLength: b.key.lensTextLength, panelTextLength: b.key.panelTextLength, heroSectionTextLength: b.key.heroSectionTextLength, h1Text: b.key.h1Text } : null,
      delta: {
        lensTextLength: a && b ? (b.key.lensTextLength ?? 0) - (a.key.lensTextLength ?? 0) : null,
        panelTextLength: a && b ? (b.key.panelTextLength ?? 0) - (a.key.panelTextLength ?? 0) : null,
        heroSectionTextLength: a && b ? (b.key.heroSectionTextLength ?? 0) - (a.key.heroSectionTextLength ?? 0) : null,
      },
    };
  });

  const phase1 = {
    phase: 1,
    kind: "prototype-comparison",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    routes: ROUTES,
    protocol:
      "同条件：同一 dev server、同一全局 header（非首页 SiteHeader）、同一示例素材与 CTA 文案；viewport 1440×900 / 390×844 × light/dark；localStorage theme 后 reload；等待 h1 可见、主题类生效、fonts.ready、动画 settle；scrollY=0；截整视口非全页。交互图仅桌面 1440 light。",
    mainCaptures,
    interactionCaptures,
    fairness,
    fairnessNote:
      "panelTextLength：A 取 #proto-a-panel（四问+操作+依据）；B 取主链 ol（四步因果链）。两者语义不同，不直接等同；更可比的指标是 heroSectionTextLength（整个 hero 区可见文字总量）与 lensTextLength（右侧工作包卡片文字总量）。",
    errors,
  };
  await writeFile(path.join(OUT, "phase1-metrics.json"), JSON.stringify(phase1, null, 2) + "\n", "utf8");

  // ---- MANIFEST ----
  const files = [];
  for (const c of [...mainCaptures, ...interactionCaptures]) {
    files.push({ path: c.file, bytes: c.fileBytes, sha256: c.fileSha256, kind: "screenshot" });
  }
  const screenshotFiles = files.length;
  const manifest = {
    task: "task-4",
    track: "B",
    phase: 1,
    kind: "prototype-comparison",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    worktree: ROOT,
    branch: "codex/final-b-brand-home",
    baseURL: BASE,
    routes: ROUTES.map((r) => ({ key: r.key, path: r.path })),
    environment: {
      os: `${os.platform()} ${os.release()} (${os.version()})`,
      cpu: os.cpus().length ? `${os.cpus()[0].model} ×${os.cpus().length}` : "unknown",
      totalMemoryGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
      node: process.version,
      browser: "chromium via @playwright/test 1.61.1 (headless)",
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "no-preference",
      network: "localhost loopback（Next dev，同一台机器）",
    },
    sameConditions: [
      "两路由使用同一 app 全局导航/header（pathname 非 /，SiteHeader 透传 layout header），两页完全相同",
      "两页同一套示例素材（components/home/homeExample.ts）、同一 h1/副标题/CTA 文案、同一 mock 说明",
      "同一浏览器/视口/主题/等待条件；默认状态：A=“回来后”阶段，B=完整因果链",
    ],
    captureMatrix: {
      main: mainCaptures.map((c) => ({ label: c.label, route: c.route, width: c.width, height: c.height, theme: c.theme, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, ok: true, key: c.key })),
      interactions: interactionCaptures.map((c) => ({ label: c.label, route: c.route, state: c.state, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, ok: true })),
    },
    fairness,
    files,
    fileCount: { screenshots: screenshotFiles, metrics: [...mainCaptures, ...interactionCaptures].length },
    network: { file: "evidence/final-sprint/20261103/b-brand-home/b1/network-proto.json", totals: network.totals },
    errors,
    anomalies: {
      horizontalOverflowCaptures: [...mainCaptures, ...interactionCaptures].filter((c) => c.key?.horizontalOverflow).map((c) => c.label),
      externalOrigins: network.externalOrigins,
      apiWrites: network.apiWrites.length,
      imageFontFailures: network.totals.imageFontFailures,
      consoleErrors: network.consoleErrors,
      pageErrors: network.pageErrors,
    },
  };
  await writeFile(path.join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("=== PHASE1 CAPTURE SUMMARY ===");
  for (const c of mainCaptures) {
    console.log(`OK  ${c.label.padEnd(22)} ${String(c.fileBytes).padStart(7)}B class=${c.key.htmlClass} overflow=${c.key.horizontalOverflow} h1=${c.key.h1Text?.slice(0, 18)} lensText=${c.key.lensTextLength} panelText=${c.key.panelTextLength} heroText=${c.key.heroSectionTextLength} selTab=${c.key.selectedTab?.label ?? "-"} badge=${c.key.headerProviderBadge}`);
  }
  for (const c of interactionCaptures) {
    console.log(`OK  ${c.label.padEnd(40)} ${String(c.fileBytes).padStart(7)}B state=${c.state} evidenceVisible=${c.key.evidenceVisible} panelText=${c.key.panelTextLength}`);
  }
  console.log(`network: records=${network.totals.requestRecords} unique=${network.totals.uniqueRequestUrls} external=${network.totals.externalOriginRequests} apiWrites=${network.totals.apiWriteRequests} failures=${network.totals.failures} consoleErrors=${network.totals.consoleErrors} pageErrors=${network.totals.pageErrors}`);
  console.log(`output: ${rel(OUT)}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
