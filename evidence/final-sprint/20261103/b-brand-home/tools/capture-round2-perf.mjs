/**
 * Track B / Round 2 — 生产构建（next start）性能与资源取证。
 * 1440 light / 390 light / 1440 dark 各 3 次；run1=冷（新 context 无 HTTP 缓存），run2/3=warm（同 context reload）。
 *
 * 输出（round2/perf/）：
 *   <config>-run<i>-<cold|warm>.png
 *   prod-perf.json（每次运行 Navigation Timing / FCP / LCP / CLS + layout-shift 来源 / 资源 / 字体 / 请求审计）
 *   network-prod.json（全部请求汇总，断言 0 外域 / 0 /api 写 / 0 bilibili）
 *
 * 运行：node evidence/final-sprint/20261103/b-brand-home/tools/capture-round2-perf.mjs
 */
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  PERF_INIT_SCRIPT,
  PROD_BASE,
  ROUND2,
  SHA,
  collectPerf,
  createNet,
  environment,
  launchBrowser,
  newContext,
  nowIso,
  readJson,
  rel,
  settlePage,
  sha256,
  summarizeNet,
  writeJson,
} from "./round2-lib.mjs";
import { readFile } from "node:fs/promises";

const OUT = path.join(ROUND2, "perf");
const CONFIGS = [
  { name: "1440-light", width: 1440, height: 900, theme: "light" },
  { name: "390-light", width: 390, height: 844, theme: "light" },
  { name: "1440-dark", width: 1440, height: 900, theme: "dark" },
];
const RUNS = 3;

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : +((v[v.length / 2 - 1] + v[v.length / 2]) / 2).toFixed(2);
};

async function main() {
  await mkdir(OUT, { recursive: true });
  // 服务可用性预检（不参与计时）
  const health = await fetch(PROD_BASE + "/", { redirect: "manual" }).then((r) => r.status).catch((e) => `ERR:${e.message}`);
  if (health !== 200) throw new Error(`next start 不可用: ${health}`);

  let serverMeta = null;
  try {
    serverMeta = await readJson(path.join(ROUND2, "server", "server-meta.json"));
  } catch {}

  const browser = await launchBrowser();
  const net = createNet();
  const configs = [];
  const errors = [];

  for (const config of CONFIGS) {
    const origin = new URL(PROD_BASE).origin;
    const context = await newContext(browser, {
      viewport: { width: config.width, height: config.height },
      storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "theme", value: config.theme }] }] },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    await page.addInitScript(PERF_INIT_SCRIPT);
    const runs = [];
    try {
      for (let i = 1; i <= RUNS; i++) {
        const kind = i === 1 ? "cold" : "warm";
        const label = `${config.name}-run${i}-${kind}`;
        net.setLabel(label);
        const startedAt = Date.now();
        if (i === 1) {
          await page.goto(PROD_BASE + "/", { waitUntil: "load" });
        } else {
          await page.reload({ waitUntil: "load" });
        }
        await page.locator("#hero-title").waitFor({ state: "visible" });
        await page.evaluate(() => document.fonts.ready);
        await settlePage(page, { minWaitMs: 900 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(120);
        const wallMs = Date.now() - startedAt;
        const perf = await collectPerf(page);
        const shotName = `${label}.png`;
        await page.screenshot({ path: path.join(OUT, shotName), fullPage: false });
        const buf = await stat(path.join(OUT, shotName));
        const requests = net.records.filter((r) => r.capture === label);
        const external = requests.filter((r) => !r.local);
        const apiWrites = requests.filter((r) => r.isApiWrite);
        const bilibili = requests.filter((r) => r.isBilibili);
        const failures = requests.filter((r) => r.failure || (r.status !== null && r.status >= 400));
        const nav = perf.navigation ?? {};
        runs.push({
          index: i,
          kind,
          label,
          wallMs,
          screenshot: rel(path.join(OUT, shotName)),
          screenshotBytes: buf.size,
          screenshotSha256: sha256(await readFile(path.join(OUT, shotName))),
          navigation: perf.navigation,
          derived: {
            ttfbMs: nav.responseStart != null && nav.requestStart != null ? +(nav.responseStart - nav.requestStart).toFixed(2) : null,
            domContentLoadedMs: nav.domContentLoadedEventEnd ?? null,
            loadEventEndMs: nav.loadEventEnd ?? null,
            domCompleteMs: nav.domComplete ?? null,
            documentTransferSize: nav.transferSize ?? null,
            documentDecodedBodySize: nav.decodedBodySize ?? null,
          },
          fcpMs: perf.fcpMs,
          lcp: perf.lcp,
          cls: perf.cls,
          layoutShifts: perf.layoutShifts,
          longTasks: perf.longTasks,
          paint: perf.paint,
          resourceTotals: perf.resourceTotals,
          resources: perf.resources,
          fontStatus: perf.fontStatus,
          fonts: perf.fonts,
          fontResources: perf.fontResources,
          externalResources: perf.externalResources,
          requestAudit: {
            requestCount: requests.length,
            externalCount: external.length,
            apiWriteCount: apiWrites.length,
            bilibiliCount: bilibili.length,
            failureCount: failures.length,
            failures: failures.map((r) => ({ url: r.url, status: r.status, failure: r.failure, resourceType: r.resourceType })),
            external: external.map((r) => ({ url: r.url, status: r.status })),
            apiWrites: apiWrites.map((r) => ({ url: r.url, method: r.method })),
            bilibili: bilibili.map((r) => ({ url: r.url, method: r.method })),
          },
          userAgent: perf.userAgent,
          devicePixelRatio: perf.devicePixelRatio,
        });
      }
    } catch (error) {
      errors.push({ config: config.name, error: String(error?.stack ?? error).slice(0, 3000) });
    }
    await context.close();
    const cold = runs.find((r) => r.kind === "cold") ?? null;
    const warmRuns = runs.filter((r) => r.kind === "warm");
    const summarize = (r) => ({
      ttfbMs: r?.derived?.ttfbMs ?? null,
      domContentLoadedMs: r?.derived?.domContentLoadedMs ?? null,
      loadEventEndMs: r?.derived?.loadEventEndMs ?? null,
      fcpMs: r?.fcpMs ?? null,
      lcpMs: r?.lcp?.startTime ?? null,
      lcpElement: r?.lcp?.element ?? null,
      cls: r?.cls ?? null,
      transferSize: r?.resourceTotals?.transferSize ?? null,
      decodedBodySize: r?.resourceTotals?.decodedBodySize ?? null,
      resourceCount: r?.resourceTotals?.resourceCount ?? null,
      requestCount: r?.requestAudit?.requestCount ?? null,
    });
    const warmSummary = {
      ttfbMs: median(warmRuns.map((r) => r.derived?.ttfbMs)),
      domContentLoadedMs: median(warmRuns.map((r) => r.derived?.domContentLoadedMs)),
      loadEventEndMs: median(warmRuns.map((r) => r.derived?.loadEventEndMs)),
      fcpMs: median(warmRuns.map((r) => r.fcpMs)),
      lcpMs: median(warmRuns.map((r) => r.lcp?.startTime)),
      cls: median(warmRuns.map((r) => r.cls)),
      transferSize: median(warmRuns.map((r) => r.resourceTotals?.transferSize)),
      decodedBodySize: median(warmRuns.map((r) => r.resourceTotals?.decodedBodySize)),
      resourceCount: median(warmRuns.map((r) => r.resourceTotals?.resourceCount)),
      requestCount: median(warmRuns.map((r) => r.requestAudit?.requestCount)),
    };
    const topResources = (runs[0]?.resources ?? [])
      .slice()
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 8)
      .map((r) => ({ name: r.name.replace(PROD_BASE, ""), initiatorType: r.initiatorType, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize, duration: r.duration }));
    configs.push({
      config,
      runs,
      summary: { cold: summarize(cold), warmMedian: warmSummary, warmRuns: warmRuns.map(summarize) },
      topResourcesCold: topResources,
    });
  }

  await browser.close();
  const netSummary = summarizeNet(net);
  await writeJson(path.join(OUT, "network-prod.json"), {
    phase: "round2",
    kind: "network-audit-production",
    capturedAt: nowIso(),
    candidateSha: SHA,
    baseUrl: PROD_BASE,
    ...netSummary,
  });

  // 最大资源（取 1440-light 冷启动资源清单前 8）
  const firstConfig = configs.find((c) => c.config.name === "1440-light");
  const coldRun = firstConfig?.runs?.[0];

  const out = {
    phase: "round2",
    kind: "production-performance",
    capturedAt: nowIso(),
    candidateSha: SHA,
    distDir: ".next-build",
    baseUrl: PROD_BASE,
    environment: environment(),
    serverMeta,
    protocol:
      "next build（NEXT_DIST_DIR=.next-build）后 next start -H 127.0.0.1 -p 34212；1440×900 light / 390×844 light / 1440×900 dark 各 3 次：run1=冷（新 browser context、无 HTTP 缓存），run2/3=warm（同 context reload）。等 #hero-title 可见、fonts.ready、入场动画结束（≥900ms）后采集。",
    caveat: "本机、本地回环、单次测量；CLS 为本次加载的 layout-shift 累计（无 hadRecentInput 的条目）；不宣称代表线上或所有用户体验。",
    configs,
    network: { file: "evidence/final-sprint/20261103/b-brand-home/round2/perf/network-prod.json", totals: netSummary.totals, assertions: netSummary.assertions },
    errors,
  };
  await writeJson(path.join(OUT, "prod-perf.json"), out);

  console.log("=== ROUND2 PRODUCTION PERF ===");
  for (const c of configs) {
    const s = c.summary;
    console.log(
      `OK ${c.config.name.padEnd(12)} cold: ttfb=${s.cold.ttfbMs}ms fcp=${s.cold.fcpMs}ms lcp=${s.cold.lcpMs}ms cls=${s.cold.cls} load=${s.cold.loadEventEndMs}ms req=${s.cold.requestCount} transfer=${s.cold.transferSize}B | warm(median): ttfb=${s.warmMedian.ttfbMs} fcp=${s.warmMedian.fcpMs} lcp=${s.warmMedian.lcpMs} cls=${s.warmMedian.cls} load=${s.warmMedian.loadEventEndMs}ms req=${s.warmMedian.requestCount} transfer=${s.warmMedian.transferSize}B`,
    );
  }
  console.log(`network: ${JSON.stringify(netSummary.totals)}`);
  console.log(`assertions: ${JSON.stringify(netSummary.assertions)}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
