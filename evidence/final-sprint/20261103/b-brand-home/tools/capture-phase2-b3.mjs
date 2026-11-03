/**
 * Track B / task-4 Phase 2-B：断点/200% 缩放巡检、异常与交互状态、15 秒 Hero 交互录屏。
 *
 * 输出（evidence/final-sprint/20261103/b-brand-home/b3/）：
 *   breakpoints/{1024x768,768x1024,360x780,320x720,zoom200-720x450,zoom200-640x360}.png
 *   states/{reduced-motion-during,reduced-motion-evidence,font-failure,dialog-open,receipt-gate,receipt-saved,anchor-experience}.png
 *   metrics/*.json
 *   interaction-15s.webm
 *   MANIFEST.json, network-b3.json
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-phase2-b3.mjs
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  BASE,
  EV,
  SOURCE_SHA,
  captureState,
  createNet,
  environment,
  keyMetrics,
  launchBrowser,
  loadHome,
  newContext,
  nowIso,
  rel,
  settlePage,
  summarizeNet,
  writeJson,
} from "./phase2-lib.mjs";

const B3 = path.join(EV, "b3");
const BREAKPOINTS = path.join(B3, "breakpoints");
const STATES = path.join(B3, "states");
const METRICS = path.join(B3, "metrics");
const VIDEO_TMP = path.join(B3, ".video-tmp");

const BREAKPOINT_MATRIX = [
  { width: 1024, height: 768, label: "1024x768", note: "平板横屏断点" },
  { width: 768, height: 1024, label: "768x1024", note: "平板竖屏断点" },
  { width: 360, height: 780, label: "360x780", note: "小屏手机断点" },
  { width: 320, height: 720, label: "320x720", note: "最窄支持断点" },
  { width: 720, height: 450, label: "zoom200-720x450", note: "200% 缩放等效（1440/2 × 900/2 CSS viewport）", zoomSimulation: true },
  { width: 640, height: 360, label: "zoom200-640x360", note: "200% 缩放等效（1280/2 × 720/2 CSS viewport）", zoomSimulation: true },
];

/** 追加派生字段到已写出的 metrics JSON。 */
async function rewriteMetricsExtra(metricsPath, extra) {
  const raw = JSON.parse(await readFile(metricsPath, "utf8"));
  raw.extra = { ...(raw.extra ?? {}), ...extra };
  await writeJson(metricsPath, raw);
}

async function measureStageSwitch(page, tabName, waitForTextSelector = "#stage-panel") {
  const before = await page.evaluate(() => ({
    panelText: document.querySelector("#stage-panel")?.innerText.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
    panelLength: document.querySelector("#stage-panel")?.innerText.length ?? null,
    selectedId: [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ?? null,
  }));
  const t0 = Date.now();
  await page.getByRole("tab", { name: tabName }).click();
  await page.waitForFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true");
    return Boolean(tab);
  });
  await page.waitForFunction(
    (prev) => {
      const text = document.querySelector("#stage-panel")?.innerText.replace(/\s+/g, " ").trim() ?? "";
      return text.length > 0 && text !== prev;
    },
    before.panelText,
    { timeout: 5000 },
  );
  const latencyMs = Date.now() - t0;
  const after = await page.evaluate(() => ({
    panelText: document.querySelector("#stage-panel")?.innerText.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
    panelLength: document.querySelector("#stage-panel")?.innerText.length ?? null,
    selectedId: [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ?? null,
    selectedAria: [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.getAttribute("aria-selected") ?? null,
    animationStyles: (() => {
      const rows = document.querySelector("#stage-panel dl");
      const inner = document.querySelector("#home-heading > div");
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const r = cs(rows);
      const i = cs(inner);
      return {
        rowsAnimationName: r?.animationName ?? null,
        rowsAnimationDuration: r?.animationDuration ?? null,
        rowsTransitionDuration: r?.transitionDuration ?? null,
        heroInnerAnimationName: i?.animationName ?? null,
        heroInnerAnimationDuration: i?.animationDuration ?? null,
        activeAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
      };
    })(),
  }));
  return { latencyMs, before, after, contentChanged: before.panelText !== after.panelText, tabSwitched: before.selectedId !== after.selectedId };
}

async function main() {
  await mkdir(BREAKPOINTS, { recursive: true });
  await mkdir(STATES, { recursive: true });
  await mkdir(METRICS, { recursive: true });
  await mkdir(VIDEO_TMP, { recursive: true });

  const browser = await launchBrowser();
  const net = createNet();
  const results = { breakpoints: [], states: [], assertions: {}, video: null };
  const errors = [];

  // ---------- 断点 / 200% 缩放巡检 ----------
  {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    for (const bp of BREAKPOINT_MATRIX) {
      const label = `bp-${bp.label}`;
      try {
        await loadHome(page, { theme: "light", width: bp.width, height: bp.height, net, label });
        const shot = await captureState(page, {
          dir: BREAKPOINTS,
          metricsDir: METRICS,
          name: `${bp.label}.png`,
          metricsName: `${bp.label}.json`,
          label,
          net,
          extra: { breakpoint: { width: bp.width, height: bp.height, note: bp.note, zoomSimulation: Boolean(bp.zoomSimulation) } },
        });
        const m = shot.metrics;
        const cta = m.elements.ctaPrimary;
        const h1 = m.elements.h1;
        const heroCopy = m.elements.heroCopy;
        const lens = m.elements.lens;
        const extra = {
          horizontalOverflow: m.horizontalOverflow,
          scrollWidth: m.scrollWidth,
          innerWidth: m.innerWidth,
          overflowers: m.overflowers,
          cta: cta ? { bbox: cta, clippedRight: cta.clippedRight, clippedLeft: cta.clippedLeft, inFirstScreen: cta.inFirstScreen } : null,
          h1: h1 ? { bbox: h1, clippedRight: h1.clippedRight, clippedLeft: h1.clippedLeft, inFirstScreen: h1.inFirstScreen } : null,
          heroCopyTop: heroCopy?.y ?? null,
          lensBBox: lens,
          headingClipped: Boolean(h1?.clippedRight || h1?.clippedLeft),
          ctaClipped: Boolean(cta?.clippedRight || cta?.clippedLeft),
          ctaVisibleInFirstScreen: cta?.inFirstScreen ?? null,
          bodyFontSize: m.fontSizes?.h1?.fontSizePx ?? null,
        };
        await rewriteMetricsExtra(path.join(METRICS, `${bp.label}.json`), {
          ...extra,
          breakpoint: { width: bp.width, height: bp.height, note: bp.note, zoomSimulation: Boolean(bp.zoomSimulation) },
        });
        results.breakpoints.push({ label: bp.label, width: bp.width, height: bp.height, zoomSimulation: Boolean(bp.zoomSimulation), file: shot.file, fileBytes: shot.fileBytes, fileSha256: shot.fileSha256, key: keyMetrics(m), extra });
      } catch (error) {
        errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
      }
    }
    await context.close();
  }

  // ---------- 01 节 rail 中段（390 竖排，左侧纵向进度线）----------
  try {
    const context = await newContext(browser, { viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    await loadHome(page, { theme: "light", width: 390, height: 844, net, label: "rail-390" });
    const readRail390 = () =>
      page.evaluate(() => {
        const rail = document.querySelector("[data-rail]");
        const progressEl = document.querySelector('[class*="railProgress"]');
        const rect = rail?.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          progress: rail ? parseFloat(getComputedStyle(rail).getPropertyValue("--rail-progress") || "NaN") : null,
          activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
          activeLabels: [...document.querySelectorAll("[data-rail-step][data-active]")].map((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20)),
          railBBox: rect ? { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) } : null,
          railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
          railProgressBBox: progressEl
            ? (() => {
                const r = progressEl.getBoundingClientRect();
                return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
              })()
            : null,
          scrollProgressTransform: (() => {
            const el = document.querySelector("[data-scroll-progress]");
            return el ? getComputedStyle(el).transform : null;
          })(),
        };
      });
    const geometry = await page.evaluate(() => {
      const rail = document.querySelector("[data-rail]");
      if (!rail) return null;
      const r = rail.getBoundingClientRect();
      return { railDocTop: r.top + window.scrollY, railHeight: r.height, viewportH: window.innerHeight };
    });
    const span = Math.max(geometry.railHeight * 0.92, 1);
    const targetTop = geometry.viewportH * 0.72 - span * 0.5;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, Math.round(geometry.railDocTop - targetTop)));
    await page.waitForTimeout(500);
    let rail390 = await readRail390();
    if (Number.isFinite(rail390.progress) && Math.abs(rail390.progress - 0.5) > 0.05) {
      const adjust = Math.round((rail390.progress - 0.5) * span);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, rail390.scrollY - adjust));
      await page.waitForTimeout(400);
      rail390 = await readRail390();
    }
    const shot = await captureState(page, {
      dir: B3,
      metricsDir: METRICS,
      name: "rail-390-mid.png",
      metricsName: "rail-390-mid.json",
      label: "rail-390-mid",
      net,
      extra: { state: "rail-390-mid", targetProgress: 0.5, rail: rail390, geometry: { railHeight: geometry.railHeight, span } },
    });
    shot.extra = { ...shot.extra, railAfterCapture: await readRail390() };
    await rewriteMetricsExtra(path.join(METRICS, "rail-390-mid.json"), shot.extra);
    results.rail390 = { file: shot.file, fileBytes: shot.fileBytes, fileSha256: shot.fileSha256, extra: shot.extra, key: keyMetrics(shot.metrics) };
    await context.close();
  } catch (error) {
    errors.push({ label: "rail-390-mid", error: String(error?.stack ?? error).slice(0, 3000) });
  }
  // ---------- reduced-motion ----------
  try {
    const context = await newContext(browser, { reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "reduced-motion" });
    const reduceMatches = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    const defaultMetrics = await page.evaluate(() => ({
      animationStyles: (() => {
        const rows = document.querySelector("#stage-panel dl");
        const inner = document.querySelector("#home-heading > div");
        const cs = (el) => (el ? getComputedStyle(el) : null);
        return {
          rowsAnimationName: cs(rows)?.animationName ?? null,
          heroInnerAnimationName: cs(inner)?.animationName ?? null,
          activeAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
        };
      })(),
      selectedId: [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ?? null,
      panelText: document.querySelector("#stage-panel")?.innerText.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
    }));
    const reducedMotionMotion = await page.evaluate(() => {
      const root = document.querySelector("#main-content");
      const rail = document.querySelector("[data-rail]");
      const progressEl = document.querySelector('[class*="railProgress"]');
      const progressBar = document.querySelector("[data-scroll-progress]");
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
      };
      return {
        dataMotion: root?.getAttribute("data-motion") ?? null,
        railBBox: box(rail),
        railProgressBBox: box(progressEl),
        railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
        railProgressVar: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() || null : null,
        scrollProgressTransform: progressBar ? getComputedStyle(progressBar).transform : null,
        heroShift: root ? getComputedStyle(root).getPropertyValue("--hero-shift").trim() || null : null,
        heroCopyTranslate: document.querySelector("[data-hero-copy]") ? getComputedStyle(document.querySelector("[data-hero-copy]")).translate : null,
        kickerAfterTransforms: [...document.querySelectorAll("[data-draw]")].map((el) => getComputedStyle(el, "::after").transform),
        runningAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
        mainTextLength: document.querySelector("#main-content")?.innerText.length ?? null,
      };
    });
    const duringSwitch = await measureStageSwitch(page, /期间/);
    const duringShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "reduced-motion-during.png",
      metricsName: "reduced-motion-during.json",
      label: "reduced-motion-during",
      net,
      extra: {
        state: "reduced-motion-during",
        reducedMotionMatches: reduceMatches,
        defaultAnimationStyles: defaultMetrics.animationStyles,
        stageSwitch: duringSwitch,
      },
    });
    const evidenceLatencyStart = Date.now();
    await page.getByRole("button", { name: /查看依据/ }).click();
    await page.waitForFunction(() => document.querySelector("#hero-evidence")?.getAttribute("data-open") === "true");
    const evidenceLatencyMs = Date.now() - evidenceLatencyStart;
    const evidenceShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "reduced-motion-evidence.png",
      metricsName: "reduced-motion-evidence.json",
      label: "reduced-motion-evidence",
      net,
      extra: {
        state: "reduced-motion-evidence",
        reducedMotionMatches: reduceMatches,
        evidenceOpenLatencyMs: evidenceLatencyMs,
        animationStyles: await page.evaluate(() => {
          const rows = document.querySelector("#stage-panel dl");
          return { rowsAnimationName: rows ? getComputedStyle(rows).animationName : null, activeAnimations: document.getAnimations().filter((a) => a.playState === "running").length };
        }),
      },
    });
    results.states.push({ name: "reduced-motion-during", file: duringShot.file, fileBytes: duringShot.fileBytes, fileSha256: duringShot.fileSha256, key: keyMetrics(duringShot.metrics), extra: { reducedMotionMatches: reduceMatches, stageSwitch: duringSwitch } });
    results.states.push({ name: "reduced-motion-evidence", file: evidenceShot.file, fileBytes: evidenceShot.fileBytes, fileSha256: evidenceShot.fileSha256, key: keyMetrics(evidenceShot.metrics), extra: { evidenceOpenLatencyMs: evidenceLatencyMs } });

    // reduced-motion 下滚动到 01 节：rail 进度线应为满、无动画等待、内容完整
    const railScrollTarget = await page.evaluate(() => {
      const rail = document.querySelector("[data-rail]");
      if (!rail) return null;
      const rect = rail.getBoundingClientRect();
      return Math.max(0, Math.round(window.scrollY + rect.top - window.innerHeight * 0.18));
    });
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), railScrollTarget);
    await page.waitForTimeout(500);
    const reducedRail = await page.evaluate(() => {
      const root = document.querySelector("#main-content");
      const rail = document.querySelector("[data-rail]");
      const progressEl = document.querySelector('[class*="railProgress"]');
      const progressBar = document.querySelector("[data-scroll-progress]");
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
      };
      return {
        scrollY: window.scrollY,
        dataMotion: root?.getAttribute("data-motion") ?? null,
        railBBox: box(rail),
        railProgressBBox: box(progressEl),
        railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
        railProgressVar: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() || null : null,
        activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
        scrollProgressTransform: progressBar ? getComputedStyle(progressBar).transform : null,
        runningAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
        mainTextLength: document.querySelector("#main-content")?.innerText.length ?? null,
      };
    });
    const reducedRailShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "reduced-motion-rail.png",
      metricsName: "reduced-motion-rail.json",
      label: "reduced-motion-rail",
      net,
      extra: { state: "reduced-motion-rail", reducedMotionMatches: reduceMatches, rail: reducedRail },
    });
    results.states.push({ name: "reduced-motion-rail", file: reducedRailShot.file, fileBytes: reducedRailShot.fileBytes, fileSha256: reducedRailShot.fileSha256, key: keyMetrics(reducedRailShot.metrics), extra: { rail: reducedRail } });
    results.assertions.reducedMotion = {
      mediaMatches: reduceMatches,
      dataMotionAttribute: reducedMotionMotion.dataMotion,
      contentChangedAfterSwitch: duringSwitch.contentChanged,
      tabSwitched: duringSwitch.tabSwitched,
      stageSwitchLatencyMs: duringSwitch.latencyMs,
      noEntranceAnimation: defaultMetrics.animationStyles.heroInnerAnimationName === "none",
      rowsAnimationNone: duringSwitch.after.animationStyles.rowsAnimationName === "none",
      evidenceOpenLatencyMs: evidenceLatencyMs,
      runningAnimationsAtRest: reducedMotionMotion.runningAnimations,
      heroParallaxDisabled: reducedMotionMotion.heroShift === null && (reducedMotionMotion.heroCopyTranslate === "none" || reducedMotionMotion.heroCopyTranslate === "0px"),
      kickerLineFull: reducedMotionMotion.kickerAfterTransforms.every((t) => t === "none" || /matrix\(1,\s*0,\s*0,\s*1/.test(t)),
      railLineFullAtRest: reducedMotionMotion.railProgressVar === null || reducedMotionMotion.railProgressVar === "1",
      railLineFullAfterScroll: reducedRail.railProgressVar === null || reducedRail.railProgressVar === "1",
      railProgressFillsRail: Boolean(reducedRail.railProgressBBox && reducedRail.railBBox && reducedRail.railProgressBBox.width >= reducedRail.railBBox.width - 1),
      railActiveDots: reducedRail.activeCount,
      scrollProgressLineHidden: reducedRail.scrollProgressTransform === "matrix(0, 0, 0, 1, 0, 0)",
      contentComplete: (reducedRail.mainTextLength ?? 0) > 1000,
      noAnimationWait: duringSwitch.latencyMs < 400 && evidenceLatencyMs < 400,
    };
    await context.close();
  } catch (error) {
    errors.push({ label: "reduced-motion", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---------- 字体失败（替代图片失败：本页无内容图片，仅 logo） ----------
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    const abortedFontUrls = [];
    await page.route("**/fonts/*", async (route) => {
      abortedFontUrls.push(route.request().url());
      await route.abort("failed");
    });
    await page.route("**/*.ttf", async (route) => {
      abortedFontUrls.push(route.request().url());
      await route.abort("failed");
    });
    net.setLabel("font-failure");
    const fontFailureStart = Date.now();
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "font-failure", settleMs: 1200 });
    const fontFailureLoadMs = Date.now() - fontFailureStart;
    const shot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "font-failure.png",
      metricsName: "font-failure.json",
      label: "font-failure",
      net,
      extra: {
        state: "font-failure",
        abortedFontUrls: [...new Set(abortedFontUrls)],
        fontFailureLoadMs,
        note: "本页无内容图片（唯一 <img> 为 header 品牌 logo /logo.png），按 Lead 要求把“图片失败”降级测试替换为字体失败：abort /fonts/* 与 *.ttf。",
      },
    });
    const m = shot.metrics;
    const mainText = m.textMetrics.mainTextLength;
    results.assertions.fontFailure = {
      abortedFontUrls: [...new Set(abortedFontUrls)],
      h1Visible: Boolean(m.elements.h1?.inFirstScreen),
      h1Text: m.h1Text,
      ctaVisible: Boolean(m.elements.ctaPrimary?.inFirstScreen),
      heroNoteVisible: Boolean(m.elements.heroNote?.inFirstScreen),
      mockNoteText: m.fontSizes?.heroNote?.text ?? null,
      mainTextLength: mainText,
      noAriaBusy: m.ariaBusyElements.length === 0,
      fontStatus: m.fontStatus,
      pmBrandAvailable: m.pmBrandFontAvailable,
      h1FontFamily: m.h1FontFamily,
      loadMs: fontFailureLoadMs,
    };
    results.states.push({ name: "font-failure", file: shot.file, fileBytes: shot.fileBytes, fileSha256: shot.fileSha256, key: keyMetrics(m), extra: results.assertions.fontFailure });
    await context.close();
  } catch (error) {
    errors.push({ label: "font-failure", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---------- 五步 Demo：dialog 打开态 / 回执门槛 / 已保存回执 ----------
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "journey" });

    // dialog 打开态
    await page.locator("#experience").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const dialogTrigger = page.getByRole("button", { name: "查看原文：任务安排" });
    await dialogTrigger.click();
    await page.locator("dialog[open]").waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    const dialogShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "dialog-open.png",
      metricsName: "dialog-open.json",
      label: "dialog-open",
      net,
      extra: { state: "dialog-open", trigger: "查看原文：任务安排" },
    });
    const dialogMetrics = dialogShot.metrics;
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    await page.waitForTimeout(200);
    const focusAfterClose = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase() ?? null,
      ariaLabel: document.activeElement?.getAttribute?.("aria-label") ?? null,
      text: (document.activeElement?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    }));
    results.assertions.dialog = {
      open: dialogMetrics.dialog?.open ?? false,
      ariaLabelledby: dialogMetrics.dialog?.ariaLabelledby ?? null,
      title: dialogMetrics.dialog?.title ?? null,
      bbox: dialogMetrics.dialog?.bbox ?? null,
      focusReturnAfterEsc: focusAfterClose,
      focusReturnedToTrigger: focusAfterClose.ariaLabel === "查看原文：任务安排",
    };
    results.states.push({ name: "dialog-open", file: dialogShot.file, fileBytes: dialogShot.fileBytes, fileSha256: dialogShot.fileSha256, key: keyMetrics(dialogMetrics), extra: { dialog: dialogMetrics.dialog, focusAfterClose } });

    // 回执门槛（未确认直接切到第 5 步）
    await page.getByRole("tab", { name: "填写回执" }).click();
    await page.waitForTimeout(250);
    const gateShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "receipt-gate.png",
      metricsName: "receipt-gate.json",
      label: "receipt-gate",
      net,
      extra: {
        state: "receipt-gate",
        gateText: await page.evaluate(() => (document.querySelector("#story-panel")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160)),
        selectedTab: await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ?? null),
        hasTextarea: await page.evaluate(() => Boolean(document.querySelector("#demo-receipt"))),
      },
    });
    results.states.push({ name: "receipt-gate", file: gateShot.file, fileBytes: gateShot.fileBytes, fileSha256: gateShot.fileSha256, key: keyMetrics(gateShot.metrics), extra: gateShot.metrics ? { selectedTab: gateShot.metrics.selectedTab } : {} });

    // 已保存模拟回执
    await page.getByRole("tab", { name: "确认行动" }).click();
    await page.getByRole("button", { name: "在示例中确认行动" }).click();
    await page.waitForSelector("[class*=confirmationResult]", { state: "visible" });
    await page.getByRole("tab", { name: "填写回执" }).click();
    await page.locator("#demo-receipt").waitFor({ state: "visible" });
    await page.locator("#demo-receipt").fill("假设已录入一条记录并生成草稿；草稿中的来源还需要逐项核对。");
    await page.getByRole("button", { name: /保存模拟回执/ }).click();
    await page.waitForSelector("[class*=savedReceipt]", { state: "visible" });
    await page.waitForTimeout(250);
    const receiptShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "receipt-saved.png",
      metricsName: "receipt-saved.json",
      label: "receipt-saved",
      net,
      extra: {
        state: "receipt-saved",
        notice: await page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? null),
        savedReceiptText: await page.evaluate(() => (document.querySelector("[class*=savedReceipt] blockquote")?.innerText || "").trim()),
        confirmedBadge: await page.evaluate(() => [...document.querySelectorAll("[class*=confirmedBadge]")].map((e) => e.innerText.trim())),
      },
    });
    results.states.push({ name: "receipt-saved", file: receiptShot.file, fileBytes: receiptShot.fileBytes, fileSha256: receiptShot.fileSha256, key: keyMetrics(receiptShot.metrics), extra: { notice: await page.evaluate(() => document.querySelector('[role="status"]')?.innerText ?? null) } });

    // 锚点 #experience：主 CTA 跳转后标题不被 sticky header 遮挡
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#hero-title").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await settlePage(page, { minWaitMs: 900 });
    await page.getByRole("link", { name: /体验一段项目接续/ }).click();
    await page.waitForFunction(() => window.scrollY > 200, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1400);
    const anchorMetrics = await page.evaluate(() => {
      const header = document.querySelector("header");
      const title = document.querySelector("#experience-title");
      const hr = header?.getBoundingClientRect();
      const tr = title?.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        headerHeight: hr?.height ?? null,
        headerBottom: hr?.bottom ?? null,
        experienceTitleTop: tr?.top ?? null,
        experienceTitleBottom: tr?.bottom ?? null,
        titleHiddenBehindHeader: Boolean(tr && hr && tr.top < hr.bottom),
        experienceSectionTop: document.querySelector("#experience")?.getBoundingClientRect().top ?? null,
      };
    });
    const anchorShot = await captureState(page, {
      dir: STATES,
      metricsDir: METRICS,
      name: "anchor-experience.png",
      metricsName: "anchor-experience.json",
      label: "anchor-experience",
      net,
      extra: { state: "anchor-experience", anchor: anchorMetrics },
    });
    results.states.push({ name: "anchor-experience", file: anchorShot.file, fileBytes: anchorShot.fileBytes, fileSha256: anchorShot.fileSha256, key: keyMetrics(anchorShot.metrics), extra: { anchor: anchorMetrics } });
    results.assertions.anchor = anchorMetrics;
    await context.close();
  } catch (error) {
    errors.push({ label: "journey-states", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---------- 15–20 秒动效录屏（加载→Hero 三阶段→依据→rail 进度→五步 Demo→dialog）----------
  try {
    const context = await newContext(browser, { recordVideo: { dir: VIDEO_TMP, size: { width: 1440, height: 900 } } });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    const videoWallStart = Date.now();
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "video", settleMs: 700 });
    const videoHandle = page.video();
    const loadMs = Date.now() - videoWallStart;

    // 动态分配等待：目标 20s 总时长，扣掉加载耗时后按权重缩放各步骤停留。
    const baseWeights = [400, 1300, 1300, 1300, 1800, 900, 1800, 900, 2000, 1600, 900, 600];
    const elapsedAfterLoad = Date.now() - videoWallStart;
    const budget = Math.max(9000, 20_000 - elapsedAfterLoad - 150);
    const weightSum = baseWeights.reduce((a, b) => a + b, 0);
    const scale = budget / weightSum;
    const waits = baseWeights.map((w) => Math.max(250, Math.round(w * scale)));

    const steps = [];
    const step = async (label, fn, waitMs) => {
      const t = Date.now();
      if (fn) await fn();
      await page.waitForTimeout(waitMs);
      steps.push({ label, atMs: Date.now() - videoWallStart, waitMs });
    };
    const railTarget = await page.evaluate(() => {
      const rail = document.querySelector("[data-rail]");
      if (!rail) return null;
      const r = rail.getBoundingClientRect();
      const railDocTop = r.top + window.scrollY;
      const span = Math.max(window.innerHeight * 0.5, 240);
      return Math.max(0, Math.round(railDocTop - (window.innerHeight * 0.86 - span * 0.5)));
    });
    await step("load-settled", null, waits[0]);
    await step("stage-during", () => page.getByRole("tab", { name: /期间/ }).click(), waits[1]);
    await step("stage-away", () => page.getByRole("tab", { name: /离开时/ }).click(), waits[2]);
    await step("stage-back", () => page.getByRole("tab", { name: /回来后/ }).click(), waits[3]);
    await step("evidence-open", () => page.getByRole("button", { name: /查看依据/ }).click(), waits[4]);
    await step("evidence-close", () => page.getByRole("button", { name: /收起依据/ }).click(), waits[5]);
    await step("scroll-to-rail", () => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), railTarget), waits[6]);
    const railAtVideo = await page.evaluate(() => {
      const rail = document.querySelector("[data-rail]");
      const progressEl = document.querySelector('[class*="railProgress"]');
      return {
        scrollY: window.scrollY,
        progress: rail ? parseFloat(getComputedStyle(rail).getPropertyValue("--rail-progress") || "NaN") : null,
        activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
        railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
        scrollProgressTransform: (() => {
          const el = document.querySelector("[data-scroll-progress]");
          return el ? getComputedStyle(el).transform : null;
        })(),
      };
    });
    await step("rail-hold", null, waits[7]);
    await step("scroll-to-experience", () => page.evaluate(() => document.querySelector("#experience")?.scrollIntoView({ behavior: "smooth", block: "start" })), waits[8]);
    await step("open-source-dialog", () => page.getByRole("button", { name: "查看原文：任务安排" }).click(), waits[9]);
    const dialogOpenInVideo = await page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
    await step("close-dialog", () => page.keyboard.press("Escape"), waits[10]);
    await step("final-hold", null, waits[11]);
    const videoWallMs = Date.now() - videoWallStart;
    const videoDest = path.join(B3, "interaction-20s.webm");
    // 视频在页面/context 关闭后才可写盘；先保存句柄，关闭 context 后再 saveAs。
    await context.close();
    if (videoHandle) await videoHandle.saveAs(videoDest);
    const buf = await stat(videoDest);

    // 用 Chromium 读取视频时长（Playwright ffmpeg 无 vp8 解码器）
    const probeContext = await newContext(browser, { viewport: { width: 1440, height: 900 } });
    const probePage = await probeContext.newPage();
    await probePage.goto("file:///" + videoDest.replaceAll("\\", "/").replace(/^\//, ""), { waitUntil: "load" });
    const duration = await probePage.evaluate(async () => {
      const v = document.querySelector("video");
      if (!v) return null;
      if (v.readyState < 1) await new Promise((resolve) => v.addEventListener("loadedmetadata", resolve, { once: true }));
      return { duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
    });
    await probeContext.close();

    results.video = {
      file: rel(videoDest),
      fileBytes: buf.size,
      durationSeconds: duration?.duration ?? null,
      videoWidth: duration?.videoWidth ?? null,
      videoHeight: duration?.videoHeight ?? null,
      wallClockMs: videoWallMs,
      loadMs,
      targetSeconds: 20,
      steps,
      railAtVideo,
      dialogOpenInVideo,
      note: "context recordVideo 1440×900；路径：加载→Hero 三阶段→展开/收起依据→平滑滚动到 01 节看 rail 进度与圆点点亮→继续滚动到五步 Demo→打开原文 dialog→Esc 关闭。目标 20s（Lead 允许 15–20s），实际时长见 durationSeconds。",
    };
    results.assertions.video = {
      fileExists: true,
      fileBytes: buf.size,
      durationSeconds: duration?.duration ?? null,
      videoWidth: duration?.videoWidth ?? null,
      videoHeight: duration?.videoHeight ?? null,
      railProgressShown: Boolean(railAtVideo.progress && railAtVideo.progress > 0.2),
      railActiveDotsShown: railAtVideo.activeCount,
      dialogOpened: dialogOpenInVideo,
    };
  } catch (error) {
    errors.push({ label: "video", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  await browser.close();

  const netSummary = summarizeNet(net);
  await writeJson(path.join(B3, "network-b3.json"), {
    phase: 2,
    kind: "network-audit-b3",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    baseURL: BASE,
    ...netSummary,
  });

  const manifest = {
    task: "task-4",
    track: "B",
    phase: 2,
    part: "2-B 断点/缩放、异常与交互状态、rail 中段（桌面/390）、15–20 秒动效录屏",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    worktree: "D:\\Projects\\hongmen-final-b-brand-home",
    branch: "codex/final-b-brand-home",
    baseURL: BASE,
    environment: environment(),
    sourceIntegrity: {
      headAtCapture: SOURCE_SHA,
      headVerified: true,
      treeCleanExceptEvidence: true,
      note: "最终候选 cc7c19f（216cf05 + 字号/触控收口，仅改两个 CSS 模块）；216cf05 及更早采集一律作废，本目录全部以 cc7c19f 重跑。",
    },
    protocol:
      "断点：1024×768、768×1024、360×780、320×720 浅色；200% 缩放用 720×450 与 640×360 CSS viewport 模拟（1440/2×900/2、1280/2×720/2）。状态：reduced-motion（context reducedMotion:'reduce'；含 rail 满线/无动画断言）、字体失败（abort /fonts/* 与 *.ttf）、五步 Demo dialog 打开态、回执门槛、已保存模拟回执、#experience 锚点。滚动动效：rail-1440-mid（after 目录）与 rail-390-mid（本目录）。录屏：1440×900 context recordVideo，加载→Hero 三阶段→依据展开/关闭→滚动到 01 节 rail→滚动到五步 Demo→打开/关闭 dialog。",
    breakpoints: results.breakpoints,
    rail390: results.rail390,
    states: results.states,
    assertions: results.assertions,
    video: results.video,
    network: {
      file: "evidence/final-sprint/20261103/b-brand-home/b3/network-b3.json",
      totals: netSummary.totals,
      assertions: netSummary.assertions,
    },
    files: [
      ...results.breakpoints.map((b) => ({ path: b.file, bytes: b.fileBytes, sha256: b.fileSha256, kind: "screenshot" })),
      ...(results.rail390 ? [{ path: results.rail390.file, bytes: results.rail390.fileBytes, sha256: results.rail390.fileSha256, kind: "screenshot" }] : []),
      ...results.states.map((s) => ({ path: s.file, bytes: s.fileBytes, sha256: s.fileSha256, kind: "screenshot" })),
      ...(results.video ? [{ path: results.video.file, bytes: results.video.fileBytes, kind: "video" }] : []),
      ...BREAKPOINT_MATRIX.map((bp) => ({ path: rel(path.join(METRICS, `${bp.label}.json`)), kind: "metrics" })),
      ...(results.rail390 ? [{ path: rel(path.join(METRICS, "rail-390-mid.json")), kind: "metrics" }] : []),
      ...results.states.map((s) => ({ path: rel(path.join(METRICS, `${s.name}.json`)), kind: "metrics" })),
      { path: "evidence/final-sprint/20261103/b-brand-home/b3/network-b3.json", kind: "network-audit" },
    ],
    anomalies: {
      captureErrors: errors,
      horizontalOverflowBreakpoints: results.breakpoints.filter((b) => b.extra.horizontalOverflow).map((b) => b.label),
      clipped: results.breakpoints.filter((b) => b.extra.headingClipped || b.extra.ctaClipped).map((b) => ({ label: b.label, headingClipped: b.extra.headingClipped, ctaClipped: b.extra.ctaClipped })),
      externalOrigins: netSummary.externalOrigins,
      bilibiliRequests: netSummary.totals.bilibiliRequests,
      apiWrites: netSummary.totals.apiWriteRequests,
      consoleErrors: netSummary.consoleErrors,
      pageErrors: netSummary.pageErrors,
    },
    caveats: [
      "200% 缩放以 CSS viewport 720×450 / 640×360 模拟，非浏览器 zoom 设置；用于检查布局在等效视口下的溢出与裁切。",
      "本机 dev 环境、本地回环网络；性能与体积数字不代表线上或所有用户体验。",
      "深色主题状态由 after/ 的 1440/1280/390 dark 六图覆盖（本目录不重复）。",
      "Bilibili 仅为外链（href/target=_blank/rel=noopener noreferrer），本轮未点击，未产生 bilibili 网络请求（见 network-b3.json assertions）。",
    ],
  };
  await writeJson(path.join(B3, "MANIFEST.json"), manifest);

  console.log("=== PHASE 2-B SUMMARY ===");
  for (const b of results.breakpoints) {
    console.log(
      `BP  ${b.label.padEnd(18)} ${String(b.fileBytes).padStart(7)}B overflow=${b.extra.horizontalOverflow} h1clip=${b.extra.headingClipped} ctaClip=${b.extra.ctaClipped} ctaFirst=${b.extra.ctaVisibleInFirstScreen} scrollW=${b.extra.scrollWidth}/${b.extra.innerWidth}`,
    );
  }
  for (const s of results.states) {
    console.log(`ST  ${s.name.padEnd(24)} ${String(s.fileBytes).padStart(7)}B`);
  }
  if (results.video) console.log(`VIDEO ${results.video.file} bytes=${results.video.fileBytes} wall=${results.video.wallClockMs}ms`);
  console.log(`assertions: ${JSON.stringify({ reducedMotion: results.assertions.reducedMotion, fontFailure: results.assertions.fontFailure, dialog: results.assertions.dialog, anchor: results.assertions.anchor })}`);
  console.log(`network: ${JSON.stringify(netSummary.totals)}`);
  console.log(`assertions-net: ${JSON.stringify(netSummary.assertions)}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
