/**
 * Track B / task-4 Phase 2-A：after 六图 + Hero 状态（期间/依据）+ 资源与 Navigation Timing 取证。
 *
 * 输出：
 *   after/homepage-{1440,1280,390}-{light,dark}-after.png   6 张 after
 *   after/metrics/homepage-<w>-<theme>.json                每张指标
 *   after/MANIFEST.json
 *   b3/hero-states/hero-during.png, hero-evidence.png      Hero 状态（1440 light）
 *   b3/metrics/hero-during.json, hero-evidence.json
 *   b3/network-after.json, b3/performance-after.json, b3/resources-after.json
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-phase2-after.mjs
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  BASE,
  EV,
  HOME_METRICS_FN,
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
  sha256,
  summarizeNet,
  waitForDevOverlayClear,
  writeJson,
} from "./phase2-lib.mjs";

const AFTER = path.join(EV, "after");
const AFTER_METRICS = path.join(AFTER, "metrics");
const B3 = path.join(EV, "b3");
const B3_STATES = path.join(B3, "hero-states");
const B3_METRICS = path.join(B3, "metrics");

const MATRIX = [
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1280, height: 720, theme: "light" },
  { width: 1280, height: 720, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
];

/** 截图后才可计算的派生字段，回写进对应 metrics JSON 的 extra。 */
async function rewriteExtra(metricsDir, metricsFileName, extra) {
  const metricsPath = path.join(metricsDir, metricsFileName);
  const raw = JSON.parse(await readFile(metricsPath, "utf8"));
  raw.extra = { ...(raw.extra ?? {}), ...extra };
  await writeJson(metricsPath, raw);
}

async function main() {
  await mkdir(AFTER_METRICS, { recursive: true });
  await mkdir(B3_STATES, { recursive: true });
  await mkdir(B3_METRICS, { recursive: true });

  const browser = await launchBrowser();
  const context = await newContext(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(120_000);
  const net = createNet();
  net.attach(page);

  const matrixCaptures = [];
  const heroStates = [];
  const errors = [];

  for (const { width, height, theme } of MATRIX) {
    const label = `after-${width}-${theme}`;
    try {
      await loadHome(page, { theme, width, height, net, label });
      const shot = await captureState(page, {
        dir: AFTER,
        metricsDir: AFTER_METRICS,
        name: `homepage-${width}-${theme}-after.png`,
        metricsName: `homepage-${width}-${theme}.json`,
        label,
        net,
        extra: { viewport: { width, height }, themeRequested: theme, settle: "fonts.ready + 入场动画结束（≥900ms）" },
      });
      matrixCaptures.push({ width, height, theme, label, ...shot, key: keyMetrics(shot.metrics) });

      // Hero 状态只在 1440 light 默认态之后紧接着采集，保证同一页面状态链
      if (width === 1440 && theme === "light") {
        const defaultMetrics = shot.metrics;
        const defaultHeroCopyTop = defaultMetrics.elements.heroCopy?.y ?? null;
        const defaultH1Top = defaultMetrics.elements.h1?.y ?? null;
        const defaultPanelText = defaultMetrics.textMetrics.panelTextLength;

        // 1) 切到“02 期间”
        net.setLabel("hero-during");
        const duringTab = page.getByRole("tab", { name: /期间/ });
        await duringTab.click();
        await page.waitForFunction(() => {
          const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => /期间/.test(t.innerText));
          return tab?.getAttribute("aria-selected") === "true";
        });
        await settlePage(page, { minWaitMs: 400 });
        const duringShot = await captureState(page, {
          dir: B3_STATES,
          metricsDir: B3_METRICS,
          name: "hero-during.png",
          metricsName: "hero-during.json",
          label: "hero-during",
          net,
          extra: {
            state: "during",
            heroCopyTopFrom: defaultHeroCopyTop,
            h1TopFrom: defaultH1Top,
          },
        });
        const duringPanelText = await page.evaluate(() =>
          (document.querySelector("#stage-panel")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
        );
        duringShot.extra = {
          ...duringShot.extra,
          ariaSelected: duringShot.metrics.selectedTab,
          panelTextLengthFrom: defaultPanelText,
          panelTextLengthTo: duringShot.metrics.textMetrics.panelTextLength,
          panelTextChanged: defaultPanelText !== duringShot.metrics.textMetrics.panelTextLength,
          panelTextFirst80: duringPanelText,
          heroCopyTopTo: duringShot.metrics.elements.heroCopy?.y ?? null,
          h1TopTo: duringShot.metrics.elements.h1?.y ?? null,
        };
        await rewriteExtra(B3_METRICS, duringShot.metricsFileName, duringShot.extra);
        heroStates.push({ state: "during", extra: duringShot.extra, ...duringShot, key: keyMetrics(duringShot.metrics) });

        // 2) 回“03 回来后”，展开依据
        net.setLabel("hero-evidence");
        await page.getByRole("tab", { name: /回来后/ }).click();
        await page.waitForFunction(() => {
          const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => /回来后/.test(t.innerText));
          return tab?.getAttribute("aria-selected") === "true";
        });
        const backMetrics = await page.evaluate(() => ({
          selectedTab: (() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true");
            return tab ? { id: tab.id, label: tab.innerText.replace(/\s+/g, " ").trim(), ariaSelected: tab.getAttribute("aria-selected") } : null;
          })(),
          panelTextLength: document.querySelector("#stage-panel")?.innerText.length ?? null,
          heroCopyTop: document.querySelector("#home-heading > div > div")?.getBoundingClientRect().y ?? null,
        }));
        await page.getByRole("button", { name: /查看依据/ }).click();
        await page.waitForFunction(() => document.querySelector("#hero-evidence")?.getAttribute("data-open") === "true");
        await page.waitForSelector("#hero-evidence [class*=evidenceList]", { state: "visible" });
        await settlePage(page, { minWaitMs: 600 });
        const evidenceExtra = {
          state: "evidence-open",
          backStage: backMetrics,
          leftTopInvariance: {
            defaultHeroCopyTop,
            evidenceHeroCopyTop: null, // 填充于下方
            delta: null,
            expected: "≈112（展开依据时左栏 top 不应移动）",
          },
          h1TopFrom: defaultH1Top,
        };
        const evidenceShot = await captureState(page, {
          dir: B3_STATES,
          metricsDir: B3_METRICS,
          name: "hero-evidence.png",
          metricsName: "hero-evidence.json",
          label: "hero-evidence",
          net,
          extra: evidenceExtra,
        });
        const evidenceHeroCopyTop = evidenceShot.metrics.elements.heroCopy?.y ?? null;
        evidenceExtra.leftTopInvariance.evidenceHeroCopyTop = evidenceHeroCopyTop;
        evidenceExtra.leftTopInvariance.delta =
          defaultHeroCopyTop !== null && evidenceHeroCopyTop !== null ? +(evidenceHeroCopyTop - defaultHeroCopyTop).toFixed(2) : null;
        evidenceExtra.h1TopTo = evidenceShot.metrics.elements.h1?.y ?? null;
        evidenceExtra.evidenceButton = evidenceShot.metrics.evidenceButton;
        evidenceExtra.evidencePanel = evidenceShot.metrics.evidencePanel;
        evidenceExtra.panelTextLengthFrom = backMetrics.panelTextLength;
        evidenceExtra.panelTextLengthTo = evidenceShot.metrics.textMetrics.panelTextLength;
        await rewriteExtra(B3_METRICS, evidenceShot.metricsFileName, evidenceExtra);
        heroStates.push({ state: "evidence-open", extra: evidenceExtra, ...evidenceShot, key: keyMetrics(evidenceShot.metrics) });
      }
    } catch (error) {
      errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
      try {
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
      } catch {
        /* ignore */
      }
    }
  }

  // ---- 216cf05 新增滚动动效：阅读进度线 / rail 中段 / kicker 绘制 / Hero 深度离场 ----
  const motionStates = [];
  try {
    net.setLabel("motion");
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "motion" });
    const base = await page.evaluate(HOME_METRICS_FN);
    const baseHeroLayoutTop = base.motion?.heroCopyLayoutTop ?? null;
    const baseLensLayoutTop = base.motion?.heroLensLayoutTop ?? null;

    // 1) Hero 轻微深度离场（滚动 180px；只影响 translate，不改布局）
    net.setLabel("motion-hero-depth");
    await page.evaluate(() => window.scrollTo({ top: 180, behavior: "instant" }));
    await page.waitForTimeout(500);
    const depthShot = await captureState(page, {
      dir: B3_STATES,
      metricsDir: B3_METRICS,
      name: "hero-depth-exit.png",
      metricsName: "hero-depth-exit.json",
      label: "motion-hero-depth",
      net,
      extra: { state: "hero-depth-exit", note: "滚动 180px 观察 --hero-shift 与 copy/lens translate；文档坐标不变=布局不变" },
    });
    const depthHeroLayoutTop = depthShot.metrics.motion?.heroCopyLayoutTop ?? null;
    const depthLensLayoutTop = depthShot.metrics.motion?.heroLensLayoutTop ?? null;
    depthShot.extra = {
      ...depthShot.extra,
      heroShift: depthShot.metrics.motion?.heroShift ?? null,
      heroCopyTranslate: depthShot.metrics.motion?.heroCopyTranslate ?? null,
      heroLensTranslate: depthShot.metrics.motion?.heroLensTranslate ?? null,
      baseHeroLayoutTop,
      depthHeroLayoutTop,
      baseLensLayoutTop,
      depthLensLayoutTop,
      layoutUnchanged:
        baseHeroLayoutTop !== null &&
        depthHeroLayoutTop !== null &&
        Math.abs(depthHeroLayoutTop - baseHeroLayoutTop) <= 0.5 &&
        Math.abs((depthLensLayoutTop ?? 0) - (baseLensLayoutTop ?? 0)) <= 0.5,
      scrollY: depthShot.metrics.scrollY,
    };
    await rewriteExtra(B3_METRICS, depthShot.metricsFileName, depthShot.extra);
    motionStates.push({ name: "hero-depth-exit", file: depthShot.file, fileBytes: depthShot.fileBytes, fileSha256: depthShot.fileSha256, extra: depthShot.extra, key: keyMetrics(depthShot.metrics) });

    // 2) 章节 kicker 细线首次进入视口展开（静态图）
    net.setLabel("motion-kicker");
    const missionsTop = await page.evaluate(() => {
      const el = document.querySelector("#missions");
      return el ? el.getBoundingClientRect().top + window.scrollY : 0;
    });
    await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y - 120), behavior: "instant" }), missionsTop);
    await page.waitForTimeout(800);
    const kickerShot = await captureState(page, {
      dir: B3_STATES,
      metricsDir: B3_METRICS,
      name: "kicker-draw.png",
      metricsName: "kicker-draw.json",
      label: "motion-kicker",
      net,
      extra: { state: "kicker-draw", note: "01 节 kicker 进入视口后 data-drawn=true，::after 细线 scaleX 0→1（720ms）" },
    });
    kickerShot.extra = {
      ...kickerShot.extra,
      kickers: kickerShot.metrics.motion?.kickers ?? null,
      scrollY: kickerShot.metrics.scrollY,
    };
    await rewriteExtra(B3_METRICS, kickerShot.metricsFileName, kickerShot.extra);
    motionStates.push({ name: "kicker-draw", file: kickerShot.file, fileBytes: kickerShot.fileBytes, fileSha256: kickerShot.fileSha256, extra: kickerShot.extra, key: keyMetrics(kickerShot.metrics) });

    // 3) 01 节 rail 中段：--rail-progress ≈ 0.5、圆点按序点亮（桌面横向）
    net.setLabel("motion-rail-1440");
    const viewportH = await page.evaluate(() => window.innerHeight);
    const span = Math.max(viewportH * 0.5, 240);
    const railDocTop = await page.evaluate(() => {
      const el = document.querySelector("[data-rail]");
      return el ? el.getBoundingClientRect().top + window.scrollY : 0;
    });
    const targetRectTop = viewportH * 0.86 - span * 0.5;
    const readRail = () =>
      page.evaluate(() => {
        const rail = document.querySelector("[data-rail]");
        const progressEl = document.querySelector('[class*="railProgress"]');
        return {
          scrollY: window.scrollY,
          progress: rail ? parseFloat(getComputedStyle(rail).getPropertyValue("--rail-progress") || "NaN") : null,
          activeCount: document.querySelectorAll("[data-rail-step][data-active]").length,
          activeLabels: [...document.querySelectorAll("[data-rail-step][data-active]")].map((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20)),
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
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, Math.round(railDocTop - targetRectTop)));
    await page.waitForTimeout(500);
    let railState = await readRail();
    if (Number.isFinite(railState.progress) && Math.abs(railState.progress - 0.5) > 0.04) {
      const adjust = Math.round((railState.progress - 0.5) * span);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, railState.scrollY - adjust));
      await page.waitForTimeout(400);
      railState = await readRail();
    }
    const railShot = await captureState(page, {
      dir: B3,
      metricsDir: B3_METRICS,
      name: "rail-1440-mid.png",
      metricsName: "rail-1440-mid.json",
      label: "motion-rail-1440",
      net,
      extra: { state: "rail-1440-mid", targetProgress: 0.5, rail: railState },
    });
    railShot.extra = { ...railShot.extra, railAfterCapture: await readRail() };
    await rewriteExtra(B3_METRICS, railShot.metricsFileName, railShot.extra);
    motionStates.push({ name: "rail-1440-mid", file: railShot.file, fileBytes: railShot.fileBytes, fileSha256: railShot.fileSha256, extra: railShot.extra, key: keyMetrics(railShot.metrics) });

    // 4) 阅读进度线中段（固定页头下 56px，scaleX=页面滚动进度）
    net.setLabel("motion-progress");
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(scrollable * 0.45));
    await page.waitForTimeout(500);
    const progressShot = await captureState(page, {
      dir: B3_STATES,
      metricsDir: B3_METRICS,
      name: "scroll-progress-mid.png",
      metricsName: "scroll-progress-mid.json",
      label: "motion-progress",
      net,
      extra: { state: "scroll-progress-mid", note: "阅读进度线固定在页头下 56px，transform scaleX=页面滚动进度；滚动到约 45% 页高" },
    });
    progressShot.extra = {
      ...progressShot.extra,
      scrollProgress: progressShot.metrics.motion?.scrollProgress ?? null,
      scrollY: progressShot.metrics.scrollY,
      scrollable,
      expectedScaleX: +(progressShot.metrics.scrollY / Math.max(scrollable, 1)).toFixed(4),
    };
    await rewriteExtra(B3_METRICS, progressShot.metricsFileName, progressShot.extra);
    motionStates.push({ name: "scroll-progress-mid", file: progressShot.file, fileBytes: progressShot.fileBytes, fileSha256: progressShot.fileSha256, extra: progressShot.extra, key: keyMetrics(progressShot.metrics) });
  } catch (error) {
    errors.push({ label: "motion-states", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  // ---- 资源与 Navigation Timing（专门一次 1440 light 加载）----
  let performance = null;
  let resources = null;
  try {
    net.setLabel("perf-load");
    await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "perf-load" });
    const perfRaw = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const pick = (e, keys) => Object.fromEntries(keys.map((k) => [k, typeof e?.[k] === "number" ? +e[k].toFixed(2) : e?.[k] ?? null]));
      const navKeys = [
        "startTime",
        "redirectStart",
        "redirectEnd",
        "fetchStart",
        "domainLookupStart",
        "domainLookupEnd",
        "connectStart",
        "connectEnd",
        "secureConnectionStart",
        "requestStart",
        "responseStart",
        "responseEnd",
        "domInteractive",
        "domContentLoadedEventStart",
        "domContentLoadedEventEnd",
        "domComplete",
        "loadEventStart",
        "loadEventEnd",
        "transferSize",
        "encodedBodySize",
        "decodedBodySize",
        "nextHopProtocol",
        "type",
      ];
      const resources = performance.getEntriesByType("resource").map((r) => ({
        name: r.name,
        initiatorType: r.initiatorType,
        startTime: +r.startTime.toFixed(2),
        duration: +r.duration.toFixed(2),
        transferSize: r.transferSize,
        encodedBodySize: r.encodedBodySize,
        decodedBodySize: r.decodedBodySize,
        nextHopProtocol: r.nextHopProtocol,
      }));
      const paint = performance.getEntriesByType("paint").map((p) => ({ name: p.name, startTime: +p.startTime.toFixed(2) }));
      const memory = performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
          }
        : null;
      return {
        navigation: nav ? pick(nav, navKeys) : null,
        paint,
        memory,
        resources,
        fontStatus: document.fonts.status,
        fonts: [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status })),
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
      };
    });

    const byType = {};
    for (const r of perfRaw.resources) {
      const t = r.initiatorType || "other";
      byType[t] ??= { count: 0, transferSize: 0, decodedBodySize: 0 };
      byType[t].count += 1;
      byType[t].transferSize += r.transferSize || 0;
      byType[t].decodedBodySize += r.decodedBodySize || 0;
    }
    const totalTransfer = perfRaw.resources.reduce((s, r) => s + (r.transferSize || 0), 0);
    const totalDecoded = perfRaw.resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0);
    const fontResources = perfRaw.resources.filter((r) => /\.(ttf|woff2?|otf)(\?|$)/i.test(r.name));
    const externalResources = perfRaw.resources.filter((r) => {
      try {
        const u = new URL(r.name);
        return !(u.hostname === "127.0.0.1" || u.hostname === "localhost");
      } catch {
        return false;
      }
    });
    const bilibiliResources = perfRaw.resources.filter((r) => /bilibili/i.test(r.name));

    const nav = perfRaw.navigation ?? {};
    performance = {
      phase: 2,
      kind: "navigation-timing",
      capturedAt: nowIso(),
      sourceSha: SOURCE_SHA,
      url: BASE + "/",
      environment: environment(),
      note: "本机 Next dev（非生产构建）+ 本地回环网络；数字不代表线上或所有用户体验。",
      navigation: nav,
      derived: {
        ttfbMs: nav.responseStart != null && nav.requestStart != null ? +(nav.responseStart - nav.requestStart).toFixed(2) : null,
        domContentLoadedMs: nav.domContentLoadedEventEnd ?? null,
        loadEventEndMs: nav.loadEventEnd ?? null,
        domCompleteMs: nav.domComplete ?? null,
        documentTransferSize: nav.transferSize ?? null,
        documentDecodedBodySize: nav.decodedBodySize ?? null,
      },
      paint: perfRaw.paint,
      memory: perfRaw.memory,
      userAgent: perfRaw.userAgent,
      devicePixelRatio: perfRaw.devicePixelRatio,
    };
    resources = {
      phase: 2,
      kind: "resource-entries",
      capturedAt: nowIso(),
      sourceSha: SOURCE_SHA,
      environment: environment(),
      note: "来自 performance.getEntriesByType('resource')；dev 模式含 HMR/dev chunk，transferSize 受本地缓存与 dev 影响。",
      totals: {
        resourceCount: perfRaw.resources.length,
        transferSize: totalTransfer,
        decodedBodySize: totalDecoded,
        byInitiatorType: byType,
        fontResourceCount: fontResources.length,
        externalResourceCount: externalResources.length,
        bilibiliResourceCount: bilibiliResources.length,
      },
      fontStatus: perfRaw.fontStatus,
      fonts: perfRaw.fonts,
      fontResources,
      externalResources,
      bilibiliResources,
      resources: perfRaw.resources,
    };
    await writeJson(path.join(B3, "performance-after.json"), performance);
    await writeJson(path.join(B3, "resources-after.json"), resources);
  } catch (error) {
    errors.push({ label: "performance", error: String(error?.stack ?? error).slice(0, 3000) });
  }

  await context.close();
  await browser.close();

  const netSummary = summarizeNet(net);
  await writeJson(path.join(B3, "network-after.json"), {
    phase: 2,
    kind: "network-audit-after",
    capturedAt: nowIso(),
    sourceSha: SOURCE_SHA,
    baseURL: BASE,
    ...netSummary,
  });

  // ---- MANIFEST ----
  const fontKeyNames = [
    "h1",
    "heroSub",
    "heroNote",
    "lensKicker",
    "lensMission",
    "stageTab",
    "rowLabel",
    "rowValue",
    "rowMeta",
    "lensFoot",
    "sectionKicker",
    "sectionIntro",
    "railLabel",
    "railText",
    "demoNote",
    "storyFooter",
    "paneHeading",
    "projectKicker",
    "sourceButton",
    "videoMeta",
    "footerMeta",
    "boundary",
    "caption",
  ];
  const baseMetrics = matrixCaptures.find((c) => c.width === 1440 && c.theme === "light")?.metrics;
  const fontSizes1440 = baseMetrics
    ? Object.fromEntries(fontKeyNames.map((k) => [k, baseMetrics.fontSizes?.[k] ?? null]))
    : null;

  const manifest = {
    task: "task-4",
    track: "B",
    phase: 2,
    part: "2-A after 六图 + Hero 状态 + 216cf05/cc7c19f 滚动动效（进度线/rail/kicker/Hero 深度离场）+ 性能/资源取证",
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
      note: "采集时 git status 仅 evidence/final-sprint/20261103/b-brand-home/{after,b3,audit,tools} 未跟踪；源码已冻结在 cc7c19f（216cf05 + 字号/触控收口，仅改 app/home.module.css 与 components/HomeJourney.module.css）。对 216cf05 及更早的采集一律作废，本目录全部以 cc7c19f 重跑。",
    },
    protocol:
      "after 六图：1440×900 / 1280×720 / 390×844 × light/dark；localStorage theme 后 reload；等 #hero-title 可见、主题类生效、document.fonts.ready、入场动画结束（≥900ms）、scrollY=0；截整视口非全页。Hero 状态：1440 light 默认“回来后”之后紧接着切“02 期间”、回“回来后”展开“查看依据”。滚动动效：Hero 深度离场（scrollY=180）、01 节 kicker 绘制、rail 中段（--rail-progress≈0.5）、阅读进度线中段（45% 页高）。",
    matrix: matrixCaptures.map((c) => ({
      label: c.label,
      width: c.width,
      height: c.height,
      theme: c.theme,
      file: c.file,
      fileBytes: c.fileBytes,
      fileSha256: c.fileSha256,
      metricsFile: c.metricsFileName,
      key: c.key,
      fontSizes: c.metrics.fontSizes,
      smallTextBottom: c.metrics.smallTextBottom,
      headings: c.metrics.headings,
      videoLink: c.metrics.videoLink,
    })),
    heroStates: heroStates.map((h) => ({
      state: h.state,
      file: h.file,
      fileBytes: h.fileBytes,
      fileSha256: h.fileSha256,
      metricsFile: h.metricsFileName,
      extra: h.extra,
      key: h.key,
      fontSizes: h.metrics.fontSizes,
    })),
    motionStates: motionStates.map((m) => ({
      name: m.name,
      file: m.file,
      fileBytes: m.fileBytes,
      fileSha256: m.fileSha256,
      metricsFile: rel(path.join(B3_METRICS, `${m.name}.json`)),
      extra: m.extra,
      key: m.key,
    })),
    motionAssertions: (() => {
      const rail = motionStates.find((m) => m.name === "rail-1440-mid");
      const depth = motionStates.find((m) => m.name === "hero-depth-exit");
      const progress = motionStates.find((m) => m.name === "scroll-progress-mid");
      const kicker = motionStates.find((m) => m.name === "kicker-draw");
      return {
        readingProgressLine: progress
          ? {
              element: progress.extra.scrollProgress ?? null,
              expectedScaleX: progress.extra.expectedScaleX,
              scrollY: progress.extra.scrollY,
              fixedUnderHeader: true,
            }
          : null,
        railMidDesktop: rail
          ? {
              progressVar: rail.extra.railAfterCapture?.progress ?? rail.extra.rail?.progress ?? null,
              activeCount: rail.extra.railAfterCapture?.activeCount ?? null,
              activeLabels: rail.extra.railAfterCapture?.activeLabels ?? null,
              railProgressTransform: rail.extra.railAfterCapture?.railProgressTransform ?? null,
              targetProgress: 0.5,
            }
          : null,
        kickerDraw: kicker ? { kickers: kicker.extra.kickers ?? null, scrollY: kicker.extra.scrollY } : null,
        heroDepthExit: depth
          ? {
              heroShift: depth.extra.heroShift,
              heroCopyTranslate: depth.extra.heroCopyTranslate,
              heroLensTranslate: depth.extra.heroLensTranslate,
              layoutUnchanged: depth.extra.layoutUnchanged,
              scrollY: depth.extra.scrollY,
            }
          : null,
      };
    })(),
    fontSizes1440Light: fontSizes1440,
    minVisibleFontSize1440Light: baseMetrics?.minVisibleFontSizePx ?? null,
    performance: {
      file: "evidence/final-sprint/20261103/b-brand-home/b3/performance-after.json",
      navigation: performance?.navigation ?? null,
      derived: performance?.derived ?? null,
      paint: performance?.paint ?? null,
    },
    resources: {
      file: "evidence/final-sprint/20261103/b-brand-home/b3/resources-after.json",
      totals: resources?.totals ?? null,
      fontResources: resources?.fontResources ?? null,
      externalResources: resources?.externalResources ?? null,
      bilibiliResources: resources?.bilibiliResources ?? null,
    },
    network: {
      file: "evidence/final-sprint/20261103/b-brand-home/b3/network-after.json",
      totals: netSummary.totals,
      assertions: netSummary.assertions,
    },
    files: [
      ...matrixCaptures.map((c) => ({ path: c.file, bytes: c.fileBytes, sha256: c.fileSha256, kind: "screenshot" })),
      ...heroStates.map((h) => ({ path: h.file, bytes: h.fileBytes, sha256: h.fileSha256, kind: "screenshot" })),
      ...motionStates.map((m) => ({ path: m.file, bytes: m.fileBytes, sha256: m.fileSha256, kind: "screenshot" })),
      ...matrixCaptures.map((c) => ({ path: c.metricsFileName, kind: "metrics" })),
      ...heroStates.map((h) => ({ path: h.metricsFileName, kind: "metrics" })),
      ...motionStates.map((m) => ({ path: rel(path.join(B3_METRICS, `${m.name}.json`)), kind: "metrics" })),
      { path: "evidence/final-sprint/20261103/b-brand-home/b3/performance-after.json", kind: "performance" },
      { path: "evidence/final-sprint/20261103/b-brand-home/b3/resources-after.json", kind: "resources" },
      { path: "evidence/final-sprint/20261103/b-brand-home/b3/network-after.json", kind: "network-audit" },
    ],
    anomalies: {
      captureErrors: errors,
      horizontalOverflow: matrixCaptures.filter((c) => c.key.horizontalOverflow).map((c) => c.label),
      imageInventory: {
        note: "B2 首页已移除整幅工作区大图；唯一 <img> 是 SiteHeader 品牌 logo /logo.png（非产品截图），故无内容图片。Lead 的“本页已无 <img>”按内容图片理解成立，但 DOM 仍有 1 个 logo img。",
        perCapture: matrixCaptures.map((c) => ({
          label: c.label,
          imageCount: c.key.imageCount,
          srcs: c.metrics.images.map((i) => i.src),
        })),
        nonLogoImages: matrixCaptures.flatMap((c) =>
          c.metrics.images.filter((i) => !/\/logo\.png$/i.test(i.src)).map((i) => ({ label: c.label, src: i.src })),
        ),
      },
      externalOrigins: netSummary.externalOrigins,
      bilibiliRequests: netSummary.totals.bilibiliRequests,
      apiWrites: netSummary.totals.apiWriteRequests,
      consoleErrors: netSummary.consoleErrors,
      pageErrors: netSummary.pageErrors,
    },
    caveats: [
      "本机 dev 环境、本地回环网络；性能与体积数字不代表线上或所有用户体验。",
      "dev 模式资源含 HMR/dev chunk，体积不代表生产构建。",
      "Next dev 工具“N”为开发覆盖物（截图可见，dev-only）。",
      "Bilibili 仅为外链：本轮未点击外链，未产生任何 bilibili 网络请求（见 network-after.json assertions.noBilibiliRequestDuringLoad=true）。",
    ],
  };
  await writeJson(path.join(AFTER, "MANIFEST.json"), manifest);

  console.log("=== PHASE 2-A SUMMARY ===");
  for (const c of matrixCaptures) {
    console.log(
      `OK  ${c.label.padEnd(18)} ${String(c.fileBytes).padStart(7)}B class=${c.key.htmlClass} overflow=${c.key.horizontalOverflow} h1=${c.key.h1Text} heroCopyTop=${c.key.heroCopyTop} minFont=${c.key.minVisibleFontSizePx}px imgs=${c.key.imageCount}`,
    );
  }
  for (const h of heroStates) {
    console.log(
      `OK  hero-${h.state.padEnd(12)} ${String(h.fileBytes).padStart(7)}B selTab=${h.metrics.selectedTab?.label ?? "-"} evidence=${h.metrics.evidenceButton?.ariaExpanded ?? "-"} heroCopyTop=${h.metrics.elements.heroCopy?.y}`,
    );
  }
  console.log(`network: ${JSON.stringify(netSummary.totals)}`);
  console.log(`assertions: ${JSON.stringify(netSummary.assertions)}`);
  if (performance) console.log(`perf: nav=${JSON.stringify(performance.derived)}`);
  if (resources) console.log(`resources: ${JSON.stringify(resources.totals)}`);
  console.log(`output: ${rel(AFTER)} + ${rel(B3)}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
