/**
 * Track B / Round 2 — 候选状态重拍（绑定 SHA 4b69614，生产 next start 34212）。
 *
 * 输出（round2/）：
 *   after/homepage-<w>-<theme>-after.png            6 张 after
 *   hero/hero-stage-{away,during,back}.png          Hero 三阶段（状态 chip 三态）
 *   reduced-motion/{normal-before,hot-reduce,hot-restore}.png  热切换 reduced-motion
 *   rail/rail-1440-mid.png、rail/rail-390-mid.png
 *   breakpoints/*.png                               1024/768/360/320 + 200% 等效
 *   closing/closing-footer-{1440-light,390-light,1440-dark}.png
 *   metrics/*.json 与 states-summary.json
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-round2-states.mjs
 */
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  ROUND2,
  SHA,
  STATE_BASE,
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
} from "./round2-lib.mjs";

const AFTER = path.join(ROUND2, "after");
const HERO = path.join(ROUND2, "hero");
const RM = path.join(ROUND2, "reduced-motion");
const RAIL = path.join(ROUND2, "rail");
const BP = path.join(ROUND2, "breakpoints");
const CLOSING = path.join(ROUND2, "closing");
const METRICS = path.join(ROUND2, "metrics");

const AFTER_MATRIX = [
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1280, height: 720, theme: "light" },
  { width: 1280, height: 720, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
];
const BREAKPOINTS = [
  { width: 1024, height: 768, label: "1024x768" },
  { width: 768, height: 1024, label: "768x1024" },
  { width: 360, height: 780, label: "360x780" },
  { width: 320, height: 720, label: "320x720" },
  { width: 720, height: 450, label: "zoom200-720x450", zoomSimulation: true },
  { width: 640, height: 360, label: "zoom200-640x360", zoomSimulation: true },
];

const out = [];
const errors = [];

async function main() {
  for (const d of [AFTER, HERO, RM, RAIL, BP, CLOSING, METRICS, path.join(ROUND2, "states")]) await mkdir(d, { recursive: true });
  const browser = await launchBrowser();
  const net = createNet();

  async function withPage(fn) {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    try {
      await fn(page, context);
    } finally {
      await context.close();
    }
  }

  // ---------- after 六图 ----------
  for (const { width, height, theme } of AFTER_MATRIX) {
    const label = `after-${width}-${theme}`;
    try {
      await withPage(async (page) => {
        await loadHome(page, { baseUrl: STATE_BASE, theme, width, height, net, label });
        const shot = await captureState(page, {
          dir: AFTER,
          metricsDir: METRICS,
          name: `homepage-${width}-${theme}-after.png`,
          metricsName: `after-homepage-${width}-${theme}.json`,
          label,
          net,
          extra: { state: "after-homepage", themeRequested: theme, settle: "fonts.ready + 入场动画结束（≥900ms）" },
        });
        out.push({ group: "after", name: `homepage-${width}-${theme}-after`, ...shot, key: keyMetrics(shot.metrics) });
      });
    } catch (error) {
      errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  // ---------- Hero 三阶段 + 状态 chip 三态 ----------
  try {
    await withPage(async (page) => {
      await loadHome(page, { baseUrl: STATE_BASE, theme: "light", width: 1440, height: 900, net, label: "hero-stages" });
      const sequence = [
        { id: "away", tabName: /离开时/, name: "hero-stage-away", expectedChip: "无需操作" },
        { id: "during", tabName: /期间/, name: "hero-stage-during", expectedChip: "核对示例" },
        { id: "back", tabName: /回来后/, name: "hero-stage-back", expectedChip: "等你确认" },
      ];
      const chips = [];
      for (const item of sequence) {
        net.setLabel(`hero-${item.id}`);
        await page.getByRole("tab", { name: item.tabName }).click();
        await page.waitForFunction(
          (id) => document.querySelector(`#stage-tab-${id}`)?.getAttribute("aria-selected") === "true",
          item.id,
        );
        await settlePage(page, { minWaitMs: 400 });
        const shot = await captureState(page, {
          dir: HERO,
          metricsDir: METRICS,
          name: `${item.name}.png`,
          metricsName: `${item.name}.json`,
          label: `hero-${item.id}`,
          net,
          extra: { state: `hero-${item.id}`, expectedChip: item.expectedChip },
        });
        chips.push({
          stage: item.id,
          expectedChip: item.expectedChip,
          actualChip: shot.metrics.statusChip?.text ?? null,
          chipColor: shot.metrics.statusChip?.color ?? null,
          chipFontSize: shot.metrics.statusChip?.fontSize ?? null,
          selectedTab: shot.metrics.selectedTab?.id ?? null,
          panelTextLength: shot.metrics.textMetrics.panelTextLength,
          file: shot.file,
          fileBytes: shot.fileBytes,
          fileSha256: shot.fileSha256,
        });
        out.push({ group: "hero", name: item.name, ...shot, key: keyMetrics(shot.metrics) });
      }
      const chipsOk =
        chips.find((c) => c.stage === "away")?.actualChip === "无需操作" &&
        chips.find((c) => c.stage === "during")?.actualChip === "核对示例" &&
        chips.find((c) => c.stage === "back")?.actualChip === "等你确认";
      out.push({ group: "assertions", name: "hero-chip-three-states", chips, chipsOk });
    });
  } catch (error) {
    errors.push({ label: "hero-stages", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---------- 热 reduced-motion：normal → reduce → normal ----------
  try {
    await withPage(async (page) => {
      await loadHome(page, { baseUrl: STATE_BASE, theme: "light", width: 1440, height: 900, net, label: "rm-hot" });
      const readMotion = () =>
        page.evaluate(() => {
          const root = document.querySelector("#main-content");
          const rail = document.querySelector("[data-rail]");
          const progressEl = document.querySelector('[class*="railProgress"]');
          const progressBar = document.querySelector("[data-scroll-progress]");
          const hero = document.querySelector("[data-hero]");
          return {
            dataMotion: root?.getAttribute("data-motion") ?? null,
            prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
            railProgressVar: rail ? getComputedStyle(rail).getPropertyValue("--rail-progress").trim() || null : null,
            railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
            activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
            heroShift: hero ? getComputedStyle(hero).getPropertyValue("--hero-shift").trim() || null : null,
            heroCopyTranslate: document.querySelector("[data-hero-copy]") ? getComputedStyle(document.querySelector("[data-hero-copy]")).translate : null,
            scrollProgressTransform: progressBar ? getComputedStyle(progressBar).transform : null,
            runningAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
            mainTextLength: document.querySelector("#main-content")?.innerText.length ?? null,
            scrollY: window.scrollY,
          };
        });
      const geometry = await page.evaluate(() => {
        const rail = document.querySelector("[data-rail]");
        if (!rail) return null;
        const r = rail.getBoundingClientRect();
        const railDocTop = r.top + window.scrollY;
        const span = Math.max(window.innerHeight * 0.5, 240);
        return { target: Math.max(0, Math.round(railDocTop - (window.innerHeight * 0.86 - span * 0.5))) };
      });
      net.setLabel("rm-normal-before");
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), geometry.target);
      await page.waitForTimeout(500);
      const normalState = await readMotion();
      const beforeShot = await captureState(page, {
        dir: RM,
        metricsDir: METRICS,
        name: "normal-before.png",
        metricsName: "reduced-motion-normal-before.json",
        label: "rm-normal-before",
        net,
        extra: { state: "reduced-motion-normal-before", motion: normalState },
      });
      out.push({ group: "reduced-motion", name: "normal-before", ...beforeShot, key: keyMetrics(beforeShot.metrics) });

      net.setLabel("rm-hot-reduce");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(600);
      const reducedState = await readMotion();
      const reduceShot = await captureState(page, {
        dir: RM,
        metricsDir: METRICS,
        name: "hot-reduce.png",
        metricsName: "reduced-motion-hot-reduce.json",
        label: "rm-hot-reduce",
        net,
        extra: { state: "reduced-motion-hot-reduce", motion: reducedState },
      });
      out.push({ group: "reduced-motion", name: "hot-reduce", ...reduceShot, key: keyMetrics(reduceShot.metrics) });

      net.setLabel("rm-hot-restore");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollBy({ top: 40, behavior: "instant" }));
      await page.waitForTimeout(500);
      const restoredState = await readMotion();
      const restoreShot = await captureState(page, {
        dir: RM,
        metricsDir: METRICS,
        name: "hot-restore.png",
        metricsName: "reduced-motion-hot-restore.json",
        label: "rm-hot-restore",
        net,
        extra: { state: "reduced-motion-hot-restore", motion: restoredState },
      });
      out.push({ group: "reduced-motion", name: "hot-restore", ...restoreShot, key: keyMetrics(restoreShot.metrics) });

      out.push({
        group: "assertions",
        name: "reduced-motion-hot-switch",
        normal: normalState,
        reduced: reducedState,
        restored: restoredState,
        assertions: {
          normalOn: normalState.dataMotion === "on",
          normalProgressVisible: normalState.railProgressTransform !== null && !/matrix\(0,/.test(normalState.railProgressTransform ?? ""),
          reduceApplied: reducedState.dataMotion === "reduced",
          reduceStopsParallax: reducedState.heroShift === "0" && (reducedState.heroCopyTranslate === "none" || reducedState.heroCopyTranslate === "0px"),
          reduceHidesProgress: reducedState.railProgressTransform === "matrix(0, 0, 0, 1, 0, 0)" && reducedState.scrollProgressTransform === "matrix(0, 0, 0, 1, 0, 0)",
          reduceClearsActiveDots: reducedState.activeCount === 0,
          reduceNoRunningAnimations: reducedState.runningAnimations === 0,
          contentCompleteInReduce: (reducedState.mainTextLength ?? 0) > 1000,
          restoreReenables: restoredState.dataMotion === "on",
          restoreShowsProgress: restoredState.railProgressTransform !== null && !/matrix\(0,/.test(restoredState.railProgressTransform ?? ""),
          noReloadNeeded: true,
        },
      });
    });
  } catch (error) {
    errors.push({ label: "reduced-motion-hot", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---------- rail mid：1440 横向 / 390 纵向 ----------
  for (const cfg of [
    { width: 1440, height: 900, name: "rail-1440-mid", label: "rail-1440-mid" },
    { width: 390, height: 844, name: "rail-390-mid", label: "rail-390-mid" },
  ]) {
    try {
      await withPage(async (page) => {
        await loadHome(page, { baseUrl: STATE_BASE, theme: "light", width: cfg.width, height: cfg.height, net, label: cfg.label });
        const readRail = () =>
          page.evaluate(() => {
            const rail = document.querySelector("[data-rail]");
            const progressEl = document.querySelector('[class*="railProgress"]');
            const r = rail?.getBoundingClientRect();
            return {
              scrollY: window.scrollY,
              progress: rail ? parseFloat(getComputedStyle(rail).getPropertyValue("--rail-progress") || "NaN") : null,
              activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
              activeLabels: [...document.querySelectorAll("[data-rail-step][data-active]")].map((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20)),
              railBBox: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) } : null,
              railProgressTransform: progressEl ? getComputedStyle(progressEl).transform : null,
              railProgressBBox: progressEl
                ? (() => {
                    const b = progressEl.getBoundingClientRect();
                    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) };
                  })()
                : null,
            };
          });
        const geo = await page.evaluate(() => {
          const rail = document.querySelector("[data-rail]");
          if (!rail) return null;
          const r = rail.getBoundingClientRect();
          const stacked = window.matchMedia("(max-width: 720px)").matches;
          const railDocTop = r.top + window.scrollY;
          const viewport = window.innerHeight;
          const target = stacked
            ? railDocTop - (viewport * 0.72 - Math.max(r.height * 0.92, 1) * 0.5)
            : railDocTop - (viewport * 0.86 - Math.max(viewport * 0.5, 240) * 0.5);
          return { target: Math.max(0, Math.round(target)), stacked };
        });
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), geo.target);
        await page.waitForTimeout(500);
        let rail = await readRail();
        if (Number.isFinite(rail.progress) && Math.abs(rail.progress - 0.5) > 0.06) {
          const adjust = Math.round((rail.progress - 0.5) * (geo.stacked ? (rail.railBBox?.height ?? 0) * 0.92 : Math.max(cfg.height * 0.5, 240)));
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, rail.scrollY - adjust));
          await page.waitForTimeout(400);
          rail = await readRail();
        }
        const shot = await captureState(page, {
          dir: RAIL,
          metricsDir: METRICS,
          name: `${cfg.name}.png`,
          metricsName: `${cfg.name}.json`,
          label: cfg.label,
          net,
          extra: { state: cfg.name, targetProgress: 0.5, rail, geometry: geo },
        });
        out.push({ group: "rail", name: cfg.name, ...shot, key: keyMetrics(shot.metrics), rail });
      });
    } catch (error) {
      errors.push({ label: cfg.label, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  // ---------- 断点 / 200% 等效 ----------
  for (const bp of BREAKPOINTS) {
    const label = `bp-${bp.label}`;
    try {
      await withPage(async (page) => {
        await loadHome(page, { baseUrl: STATE_BASE, theme: "light", width: bp.width, height: bp.height, net, label });
        const shot = await captureState(page, {
          dir: BP,
          metricsDir: METRICS,
          name: `${bp.label}.png`,
          metricsName: `${label}.json`,
          label,
          net,
          extra: { state: "breakpoint", breakpoint: { width: bp.width, height: bp.height, zoomSimulation: Boolean(bp.zoomSimulation) } },
        });
        const m = shot.metrics;
        out.push({
          group: "breakpoints",
          name: bp.label,
          ...shot,
          key: keyMetrics(m),
          extra: {
            horizontalOverflow: m.horizontalOverflow,
            scrollWidth: m.scrollWidth,
            innerWidth: m.innerWidth,
            overflowers: m.overflowers,
            ctaClipped: Boolean(m.elements.ctaPrimary?.clippedRight || m.elements.ctaPrimary?.clippedLeft),
            h1Clipped: Boolean(m.elements.h1?.clippedRight || m.elements.h1?.clippedLeft),
            ctaVisibleInFirstScreen: m.elements.ctaPrimary?.inFirstScreen ?? null,
            zoomSimulation: Boolean(bp.zoomSimulation),
          },
        });
      });
    } catch (error) {
      errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  // ---------- closing / footer / 深色 ----------
  for (const cfg of [
    { name: "closing-footer-1440-light", width: 1440, height: 900, theme: "light" },
    { name: "closing-footer-390-light", width: 390, height: 844, theme: "light" },
    { name: "closing-footer-1440-dark", width: 1440, height: 900, theme: "dark" },
  ]) {
    try {
      await withPage(async (page) => {
        await loadHome(page, { baseUrl: STATE_BASE, theme: cfg.theme, width: cfg.width, height: cfg.height, net, label: cfg.name });
        const target = await page.evaluate(() => {
          const closing = document.querySelector('[class*="closing"]');
          if (!closing) return null;
          const r = closing.getBoundingClientRect();
          return Math.max(0, Math.round(r.top + window.scrollY - 40));
        });
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), target);
        await page.waitForTimeout(500);
        const shot = await captureState(page, {
          dir: CLOSING,
          metricsDir: METRICS,
          name: `${cfg.name}.png`,
          metricsName: `${cfg.name}.json`,
          label: cfg.name,
          net,
          extra: { state: "closing-footer", themeRequested: cfg.theme, scrollY: target },
        });
        out.push({ group: "closing", name: cfg.name, ...shot, key: keyMetrics(shot.metrics) });
      });
    } catch (error) {
      errors.push({ label: cfg.name, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  await browser.close();
  const netSummary = summarizeNet(net);
  await writeJson(path.join(ROUND2, "states", "network-states.json"), {
    phase: "round2",
    kind: "network-audit-states",
    capturedAt: nowIso(),
    candidateSha: SHA,
    baseUrl: STATE_BASE,
    ...netSummary,
  });
  const summary = {
    phase: "round2",
    kind: "candidate-states",
    capturedAt: nowIso(),
    candidateSha: SHA,
    baseUrl: STATE_BASE,
    environment: environment(),
    protocol:
      "生产 next start（.next-build）+ 本地回环；after 六图 1440/1280/390 × light/dark，等 fonts.ready + 入场动画结束（≥900ms），scrollY=0；Hero 三阶段在 1440 light 依次点击并记录状态 chip；reduced-motion 用 page.emulateMedia 热切换（normal→reduce→normal，不 reload）；rail mid 目标 --rail-progress≈0.5；断点 1024/768/360/320 + 200% 等效 720×450/640×360；closing/footer 三种配置。",
    captures: out,
    network: { file: "evidence/final-sprint/20261103/b-brand-home/round2/states/network-states.json", totals: netSummary.totals, assertions: netSummary.assertions },
    errors,
  };
  await writeJson(path.join(ROUND2, "states", "states-summary.json"), summary);

  console.log("=== ROUND2 STATES ===");
  for (const c of out.filter((x) => x.group !== "assertions")) {
    console.log(`OK ${c.group.padEnd(13)} ${String(c.name).padEnd(28)} ${String(c.fileBytes).padStart(7)}B overflow=${c.key?.horizontalOverflow ?? "-"} chip=${c.metrics?.statusChip?.text ?? "-"} minFont=${c.key?.minVisibleFontSizePx ?? "-"}`);
  }
  const assertions = out.filter((x) => x.group === "assertions");
  for (const a of assertions) console.log(`ASSERT ${a.name}: ${JSON.stringify(a.chipsOk ?? a.assertions)}`);
  console.log(`network: ${JSON.stringify(netSummary.totals)}`);
  console.log(`assertions-net: ${JSON.stringify(netSummary.assertions)}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
