/**
 * Track B / task-4 Phase 0 — before 基线截图 + 网络审计。
 *
 * 只读本地 Next dev（http://127.0.0.1:34111），不启动/重启服务、不修改业务代码。
 * 输出：
 *   evidence/final-sprint/20261103/b-brand-home/before/homepage-<w>-<theme>-before.png
 *   evidence/final-sprint/20261103/b-brand-home/before/metrics/homepage-<w>-<theme>.json
 *   evidence/final-sprint/20261103/b-brand-home/before/network-baseline.json
 *   evidence/final-sprint/20261103/b-brand-home/before/MANIFEST.json
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-phase0.mjs
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const OUT = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/before");
const METRICS_DIR = path.join(OUT, "metrics");

const BASE = "http://127.0.0.1:34111";
const SOURCE_SHA = "485d485378637e1da3280ed092739d441c8cf749";
const MATRIX = [
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1280, height: 720, theme: "light" },
  { width: 1280, height: 720, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const nowIso = () => new Date().toISOString();

/** 网络审计：所有请求/响应/失败按 capture 归属记录。 */
const net = {
  current: "warmup",
  records: [], // { capture, url, method, resourceType, status, ok, failure, fromServiceWorker, contentType, contentLength }
  consoleErrors: [],
  pageErrors: [],
};
const requestRecords = new WeakMap();

function isLocalHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function classifyRequest(record) {
  let url;
  try {
    url = new URL(record.url);
  } catch {
    return record;
  }
  record.origin = url.origin;
  record.pathname = url.pathname;
  record.local = isLocalHost(url.hostname);
  record.isApiWrite = url.pathname.startsWith("/api/") && record.method !== "GET";
  record.isDocument = record.resourceType === "document";
  record.devOnly =
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.includes("__nextjs") ||
    url.pathname.startsWith("/_next/static/chunks/") ||
    url.pathname.startsWith("/_next/static/css/");
  return record;
}

const collectMetrics = () => {
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
      display: s.display,
      visibility: s.visibility,
    };
  };
  const h1 = document.querySelector("#home-heading");
  const hero = h1 ? h1.closest("section") : null;
  const heroLinks = hero ? [...hero.querySelectorAll("a")] : [];
  const primaryCta = heroLinks.find((a) => a.getAttribute("href") === "#experience") ?? null;
  const secondaryCta =
    heroLinks.find((a) => {
      const href = a.getAttribute("href") ?? "";
      return href.startsWith("/login") || href === "/focus";
    }) ?? null;

  const overflowers = [];
  if (html.scrollWidth > window.innerWidth + 1) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          class: typeof el.className === "string" ? el.className.slice(0, 140) : "",
          left: +r.left.toFixed(1),
          right: +r.right.toFixed(1),
          width: +r.width.toFixed(1),
        });
        if (overflowers.length >= 15) break;
      }
    }
  }

  const fontFaces = [...document.fonts].map((f) => ({
    family: f.family,
    weight: f.weight,
    style: f.style,
    status: f.status,
  }));
  const images = [...document.images].map((img) => {
    const r = img.getBoundingClientRect();
    return {
      src: img.currentSrc || img.src,
      alt: img.alt,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayedWidth: +r.width.toFixed(1),
      displayedHeight: +r.height.toFixed(1),
    };
  });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selectedTab = tabs.find((t) => t.getAttribute("aria-selected") === "true");
  const headerText = document.querySelector("header")?.innerText ?? "";
  const headerBadge = headerText.includes("云模型已配置")
    ? "云模型已配置"
    : headerText.includes("演示模式")
      ? "演示模式"
      : null;

  return {
    url: location.href,
    title: document.title,
    htmlClass: html.className,
    htmlClassList: [...html.classList],
    bodyBackgroundColor: cs(body, "background-color"),
    bodyColor: cs(body, "color"),
    h1Text: h1 ? h1.innerText.replace(/\s+/g, " ").trim() : null,
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
    scrollHeight: html.scrollHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    horizontalOverflow: html.scrollWidth > window.innerWidth + 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    fontStatus: document.fonts.status,
    fontFaces,
    pmBrandFontAvailable: document.fonts.check('12px "PM Brand"'),
    headerBadge,
    tabCount: tabs.length,
    selectedTabText: selectedTab ? selectedTab.innerText.trim() : null,
    images,
    brokenImages: images.filter((i) => i.complete && i.naturalWidth === 0),
    overflowers,
    elements: {
      header: rect(document.querySelector("header")),
      skipLink: rect(document.querySelector("a.skip-link")),
      main: rect(document.querySelector("#main-content")),
      heroSection: rect(hero),
      positioning: rect(hero?.querySelector("p")),
      h1: rect(h1),
      heroDescription: rect(hero?.querySelector('[class*="heroDescription"]')),
      heroActions: rect(hero?.querySelector('[class*="heroActions"]')),
      primaryCta: rect(primaryCta),
      primaryCtaText: primaryCta ? primaryCta.innerText.trim() : null,
      secondaryCta: rect(secondaryCta),
      secondaryCtaText: secondaryCta ? secondaryCta.innerText.trim() : null,
      heroNote: rect(hero?.querySelector('[class*="heroNote"]')),
      heroFigure: rect(hero?.querySelector("figure")),
      heroImage: rect(hero?.querySelector("figure img")),
      figcaption: rect(hero?.querySelector("figure figcaption")),
      storySection: rect(document.querySelector("#experience")),
      storyHeading: rect(document.querySelector("#story-heading")),
      tablist: rect(document.querySelector('[role="tablist"]')),
      closingCta: rect(document.querySelector('[class*="closing"] a')),
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

async function main() {
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
    const record = classifyRequest({
      capture: net.current,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      ok: null,
      failure: null,
      fromServiceWorker: false,
      contentType: null,
      contentLength: null,
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
    record.fromServiceWorker = response.fromServiceWorker();
    const headers = response.headers();
    record.contentType = headers["content-type"] ?? null;
    record.contentLength = headers["content-length"] ? Number(headers["content-length"]) : null;
  });
  page.on("requestfailed", (request) => {
    const record = requestRecords.get(request);
    if (!record) return;
    record.failure = request.failure()?.errorText ?? "unknown";
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      net.consoleErrors.push({ capture: net.current, type: msg.type(), text: msg.text().slice(0, 500) });
    }
  });
  page.on("pageerror", (err) => {
    net.pageErrors.push({ capture: net.current, text: String(err).slice(0, 500) });
  });

  const captures = [];
  const errors = [];
  let first = true;

  for (const { width, height, theme } of MATRIX) {
    const label = `${width}-${theme}`;
    net.current = `warmup`;
    const record = { width, height, theme, label, ok: false, error: null };
    try {
      await page.setViewportSize({ width, height });
      if (first) {
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        first = false;
      }
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      net.current = `capture-${label}`;
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("#home-heading").waitFor({ state: "visible" });
      await page.waitForFunction(
        (expected) => document.documentElement.classList.contains(expected),
        theme,
        { timeout: 10_000 },
      );
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await settleAnimations(page);
      await page.waitForTimeout(150);

      const file = path.join(OUT, `homepage-${width}-${theme}-before.png`);
      await page.screenshot({ path: file, fullPage: false });
      const buf = await stat(file);
      const sha = sha256(await readFile(file));

      const metrics = await page.evaluate(collectMetrics);
      const captureRequests = net.records.filter((r) => r.capture === `capture-${label}`);
      const captureFailures = captureRequests.filter((r) => r.failure || (r.status !== null && r.status >= 400));
      const captureJson = {
        phase: 0,
        kind: "before",
        label,
        capturedAt: nowIso(),
        sourceSha: SOURCE_SHA,
        viewport: { width, height },
        themeRequested: theme,
        file: path.relative(ROOT, file).replaceAll("\\", "/"),
        fileBytes: buf.size,
        fileSha256: sha,
        metrics,
        network: {
          requestCount: captureRequests.length,
          failures: captureFailures.map((r) => ({ url: r.url, status: r.status, failure: r.failure, resourceType: r.resourceType })),
        },
      };
      const metricsFile = path.join(METRICS_DIR, `homepage-${width}-${theme}.json`);
      await writeFile(metricsFile, JSON.stringify(captureJson, null, 2) + "\n", "utf8");

      Object.assign(record, {
        ok: true,
        file: captureJson.file,
        fileBytes: buf.size,
        fileSha256: sha,
        metricsFile: path.relative(ROOT, metricsFile).replaceAll("\\", "/"),
        key: {
          title: metrics.title,
          h1: metrics.h1Text,
          htmlClass: metrics.htmlClass,
          bodyBackgroundColor: metrics.bodyBackgroundColor,
          scrollWidth: metrics.scrollWidth,
          innerWidth: metrics.innerWidth,
          horizontalOverflow: metrics.horizontalOverflow,
          fontStatus: metrics.fontStatus,
          headerBadge: metrics.headerBadge,
          selectedTabText: metrics.selectedTabText,
        },
      });
    } catch (error) {
      record.error = String(error?.stack ?? error).slice(0, 2000);
      errors.push({ label, error: record.error });
      // 页面可能仍可继续下一张；确保下次从首页开始
      try {
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        first = true;
      } catch {
        /* ignore */
      }
    }
    captures.push(record);
  }

  await context.close();
  await browser.close();

  // ---- 网络审计汇总 ----
  const all = net.records;
  const uniqueByUrl = new Map();
  for (const r of all) {
    const key = `${r.method} ${r.url}`;
    const cur = uniqueByUrl.get(key) ?? { method: r.method, url: r.url, origin: r.origin, pathname: r.pathname, resourceType: r.resourceType, local: r.local, isApiWrite: r.isApiWrite, devOnly: r.devOnly, statuses: [], failures: [], captureCount: 0 };
    cur.captureCount += 1;
    if (r.status !== null && !cur.statuses.includes(r.status)) cur.statuses.push(r.status);
    if (r.failure && !cur.failures.includes(r.failure)) cur.failures.push(r.failure);
    uniqueByUrl.set(key, cur);
  }
  const external = [...uniqueByUrl.values()].filter((r) => !r.local);
  const apiWrites = [...uniqueByUrl.values()].filter((r) => r.isApiWrite);
  const failures = all.filter((r) => r.failure || (r.status !== null && r.status >= 400));
  const imageFontFailures = failures.filter((r) => r.resourceType === "image" || r.resourceType === "font");
  const devOnly = [...uniqueByUrl.values()].filter((r) => r.devOnly);

  const networkBaseline = {
    phase: 0,
    kind: "before-network-baseline",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    baseURL: BASE,
    environmentNote:
      "本机 Next dev 本地回环（127.0.0.1），无外部网络写入；LLM_MODE=mock、空 SQLite（final-preparation.db）、无 Worker、无 seed —— 环境由 Lead 提供并在请求层复核。",
    captureWindows: captures.map((c) => ({ label: c.label, ok: c.ok, requestCount: all.filter((r) => r.capture === `capture-${c.label}`).length })),
    totals: {
      requestRecords: all.length,
      uniqueRequestUrls: uniqueByUrl.size,
      responsesWithErrorStatus: failures.length,
      requestFailures: all.filter((r) => r.failure).length,
      externalOriginRequests: external.length,
      apiWriteRequests: apiWrites.length,
      imageFontFailures: imageFontFailures.length,
      consoleErrors: net.consoleErrors.length,
      pageErrors: net.pageErrors.length,
      devOnlyAssets: devOnly.length,
    },
    allowedOrigins: [BASE, "http://127.0.0.1:34111", "http://localhost:34111"],
    externalOrigins: external.map((r) => ({ origin: r.origin, url: r.url, method: r.method, resourceType: r.resourceType, statuses: r.statuses, captureCount: r.captureCount })),
    apiWrites,
    imageFontFailures: imageFontFailures.map((r) => ({ capture: r.capture, url: r.url, status: r.status, failure: r.failure, resourceType: r.resourceType })),
    allFailures: failures.map((r) => ({ capture: r.capture, url: r.url, method: r.method, status: r.status, failure: r.failure, resourceType: r.resourceType })),
    consoleErrors: net.consoleErrors,
    pageErrors: net.pageErrors,
    devOnlyAssetsSample: devOnly.slice(0, 40),
    requests: all.map((r) => ({
      capture: r.capture,
      method: r.method,
      url: r.url,
      origin: r.origin,
      pathname: r.pathname,
      resourceType: r.resourceType,
      status: r.status,
      ok: r.ok,
      failure: r.failure,
      local: r.local,
      isApiWrite: r.isApiWrite,
      contentType: r.contentType,
      contentLength: r.contentLength,
    })),
    uniqueUrls: [...uniqueByUrl.values()].map((r) => ({
      method: r.method,
      url: r.url,
      origin: r.origin,
      pathname: r.pathname,
      resourceType: r.resourceType,
      local: r.local,
      isApiWrite: r.isApiWrite,
      statuses: r.statuses,
      failures: r.failures,
      captureCount: r.captureCount,
    })),
  };
  const networkFile = path.join(OUT, "network-baseline.json");
  await writeFile(networkFile, JSON.stringify(networkBaseline, null, 2) + "\n", "utf8");

  // ---- MANIFEST ----
  const browserVersion = "chromium via @playwright/test 1.61.1 (headless)";
  const cpus = os.cpus();
  const manifest = {
    task: "task-4",
    track: "B",
    phase: 0,
    kind: "before",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    worktree: ROOT,
    branch: "codex/final-b-brand-home",
    baseURL: BASE,
    mode: "本地匿名公开示例页（未登录）",
    environment: {
      os: `${os.platform()} ${os.release()} (${os.version()})`,
      arch: os.arch(),
      cpu: cpus.length ? `${cpus[0].model} ×${cpus.length}` : "unknown",
      totalMemoryGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
      node: process.version,
      browser: browserVersion,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "no-preference",
      network: "localhost loopback（Next dev，同一台机器）",
      timezoneId: "Asia/Shanghai",
      locale: "zh-CN",
    },
    providerMode: {
      LLM_MODE: "mock（由 Lead 提供，页面顶部徽标显示“演示模式”可佐证）",
      database: "prisma/final-preparation.db 空库（由 Lead 提供）",
      worker: "无 Worker",
      seed: "无 seed",
    },
    captureProtocol:
      "viewport 固定；localStorage.setItem('theme', theme) 后 reload；等待 h1 可见、documentElement 获得对应主题类、document.fonts.ready；scrollY=0；仅截页顶非全页。",
    captureMatrix: captures,
    files: [
      ...captures.filter((c) => c.ok).map((c) => ({ path: c.file, bytes: c.fileBytes, sha256: c.fileSha256, kind: "screenshot" })),
      ...captures.filter((c) => c.ok).map((c) => ({ path: c.metricsFile, kind: "metrics" })),
      { path: path.relative(ROOT, networkFile).replaceAll("\\", "/"), kind: "network-audit" },
      { path: "evidence/final-sprint/20261103/b-brand-home/before/MANIFEST.json", kind: "manifest" },
    ],
    anomalies: {
      captureErrors: errors,
      horizontalOverflowCaptures: captures.filter((c) => c.ok && c.key?.horizontalOverflow).map((c) => c.label),
      nonLocalRequests: networkBaseline.externalOrigins,
      apiWrites: networkBaseline.apiWrites.length,
      imageFontFailures: networkBaseline.imageFontFailures,
      consoleErrors: networkBaseline.consoleErrors,
      pageErrors: networkBaseline.pageErrors,
    },
    caveats: [
      "本机环境、本地回环网络，不宣称代表所有用户体验。",
      "开发模式（Next dev）资源包含 HMR/dev chunk，体积不代表生产构建；资源体积与 Navigation Timing 留给 Phase 2 的 after 取证并注明环境。",
      "截图与指标来自同一轮采集；页面处于匿名公开示例状态。",
    ],
  };
  const manifestFile = path.join(OUT, "MANIFEST.json");
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // 控制台摘要
  console.log("=== PHASE0 CAPTURE SUMMARY ===");
  for (const c of captures) {
    console.log(
      c.ok
        ? `OK  ${c.label.padEnd(12)} ${c.fileBytes} bytes  class=${c.key.htmlClass}  scrollW=${c.key.scrollWidth}/innerW=${c.key.innerWidth}  overflow=${c.key.horizontalOverflow}  fonts=${c.key.fontStatus}  badge=${c.key.headerBadge}`
        : `ERR ${c.label} :: ${c.error}`,
    );
  }
  console.log(
    `network: requests=${networkBaseline.totals.requestRecords} unique=${networkBaseline.totals.uniqueRequestUrls} external=${networkBaseline.totals.externalOriginRequests} apiWrites=${networkBaseline.totals.apiWriteRequests} failures=${networkBaseline.totals.responsesWithErrorStatus} consoleErrors=${networkBaseline.totals.consoleErrors} pageErrors=${networkBaseline.totals.pageErrors}`,
  );
  console.log(`output: ${path.relative(ROOT, OUT)}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
