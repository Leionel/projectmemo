/**
 * Track B / Round 2 — 05 决赛演示区新增状态（绑定 SHA f06685d）。
 *
 * 覆盖：门面（1440/390 × light/dark）→ 点击加载 Bilibili 官方播放器（截图标注“用户主动加载外部播放器”）
 *       → 收起播放器恢复门面；记录 390 门面文字换行、iframe 高度、收起按钮与焦点回归。
 * 加载期网络与“用户主动点击后”的网络分开统计：加载期 0 外域/0 bilibili；点击后才出现 bilibili 请求。
 *
 * 输出（round2/video/ 与 round2/metrics/）：
 *   facade-<w>-<theme>.png、player-loaded-<w>-light.png、collapsed-<w>-light.png
 *   video-area-summary.json、network-video-area.json
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ROUND2,
  SHA,
  STATE_BASE,
  captureState,
  createNet,
  environment,
  launchBrowser,
  loadHome,
  newContext,
  nowIso,
  rel,
  sha256,
  summarizeNet,
  writeJson,
} from "./round2-lib.mjs";

const VIDEO = path.join(ROUND2, "video");
const METRICS = path.join(ROUND2, "metrics");

const ANNOTATION_JS = (text) => {
  const el = document.createElement("div");
  el.id = "pm-evidence-annotation";
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed",
    left: "16px",
    bottom: "16px",
    zIndex: "999999",
    padding: "8px 12px",
    borderRadius: "8px",
    background: "rgba(138, 87, 0, 0.94)",
    color: "#fff",
    font: "600 13px/1.5 system-ui, sans-serif",
    boxShadow: "0 6px 20px rgba(0,0,0,.28)",
    pointerEvents: "none",
  });
  document.body.appendChild(el);
};
const REMOVE_ANNOTATION_JS = () => document.getElementById("pm-evidence-annotation")?.remove();

const results = [];
const errors = [];

async function scrollToDemo(page) {
  await page.evaluate(() => {
    const demo = document.querySelector("#demo");
    if (!demo) return;
    const r = demo.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, Math.round(r.top + window.scrollY - 70)), behavior: "instant" });
  });
  await page.waitForTimeout(500);
}

async function main() {
  await mkdir(VIDEO, { recursive: true });
  await mkdir(METRICS, { recursive: true });
  const browser = await launchBrowser();
  const net = createNet();

  async function withPage(fn) {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(120_000);
    net.attach(page);
    try {
      await fn(page);
    } finally {
      await context.close();
    }
  }

  // ---------- 门面：1440/390 × light/dark ----------
  for (const cfg of [
    { width: 1440, height: 900, theme: "light" },
    { width: 1440, height: 900, theme: "dark" },
    { width: 390, height: 844, theme: "light" },
    { width: 390, height: 844, theme: "dark" },
  ]) {
    const label = `video-facade-${cfg.width}-${cfg.theme}`;
    try {
      await withPage(async (page) => {
        net.setLabel(label);
        await loadHome(page, { baseUrl: STATE_BASE, theme: cfg.theme, width: cfg.width, height: cfg.height, net, label });
        await scrollToDemo(page);
        const shot = await captureState(page, {
          dir: VIDEO,
          metricsDir: METRICS,
          name: `facade-${cfg.width}-${cfg.theme}.png`,
          metricsName: `video-facade-${cfg.width}-${cfg.theme}.json`,
          label,
          net,
          extra: { state: "video-facade", themeRequested: cfg.theme, viewport: { width: cfg.width, height: cfg.height } },
        });
        const requests = net.records.filter((r) => r.capture === label);
        results.push({
          name: `facade-${cfg.width}-${cfg.theme}`,
          file: shot.file,
          fileBytes: shot.fileBytes,
          fileSha256: shot.fileSha256,
          videoArea: shot.metrics.videoArea,
          requestAudit: {
            requestCount: requests.length,
            externalCount: requests.filter((r) => !r.local).length,
            bilibiliCount: requests.filter((r) => r.isBilibili).length,
            apiWriteCount: requests.filter((r) => r.isApiWrite).length,
          },
        });
      });
    } catch (error) {
      errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  // ---------- 点击加载官方播放器 → 收起恢复门面（1440/390 light）----------
  for (const cfg of [
    { width: 1440, height: 900, name: "1440" },
    { width: 390, height: 844, name: "390" },
  ]) {
    const label = `video-player-${cfg.name}`;
    try {
      await withPage(async (page) => {
        net.setLabel(`${label}-load`);
        await loadHome(page, { baseUrl: STATE_BASE, theme: "light", width: cfg.width, height: cfg.height, net, label: `${label}-load` });
        await scrollToDemo(page);
        const loadPhaseRequests = net.records.filter((r) => r.capture === `${label}-load`);
        const facadeBefore = await page.evaluate(() => ({
          facadePresent: Boolean(document.querySelector('button[class*="videoFacade"]')),
          iframePresent: Boolean(document.querySelector('[class*="videoIframe"]')),
          facadeAriaLabel: document.querySelector('button[class*="videoFacade"]')?.getAttribute("aria-label") ?? null,
        }));

        net.setLabel(`${label}-user`);
        const t0 = Date.now();
        await page.locator('button[class*="videoFacade"]').click();
        await page.waitForSelector('[class*="videoIframe"]', { state: "visible", timeout: 15_000 });
        const iframeWaitMs = Date.now() - t0;
        // 等待外部播放器 iframe 完成加载事件（跨域不可读内容，仅等 load）
        await page.waitForFunction(
          () => {
            const iframe = document.querySelector('[class*="videoIframe"]');
            return Boolean(iframe);
          },
          { timeout: 15_000 },
        );
        await page.waitForTimeout(2500);
        await page.evaluate(ANNOTATION_JS, "用户主动加载外部播放器（Bilibili 官方 iframe）");
        const loadedShot = await captureState(page, {
          dir: VIDEO,
          metricsDir: METRICS,
          name: `player-loaded-${cfg.name}-light.png`,
          metricsName: `video-player-loaded-${cfg.name}-light.json`,
          label: `${label}-user`,
          net,
          extra: {
            state: "video-player-loaded",
            annotation: "截图左下角棕底白字为证据标注“用户主动加载外部播放器（Bilibili 官方 iframe）”，非页面 UI。",
            userInitiated: true,
            iframeWaitMs,
          },
        });
        const userPhaseRequests = net.records.filter((r) => r.capture === `${label}-user`);
        const bilibiliRequests = userPhaseRequests.filter((r) => r.isBilibili);
        const externalRequests = userPhaseRequests.filter((r) => !r.local);
        await page.evaluate(REMOVE_ANNOTATION_JS);

        // 收起播放器 → 恢复门面 + 焦点回归
        await page.getByRole("button", { name: /收起播放器/ }).click();
        await page.waitForSelector('[class*="videoIframe"]', { state: "detached", timeout: 10_000 });
        await page.waitForTimeout(400);
        const collapsedState = await page.evaluate(() => ({
          facadePresent: Boolean(document.querySelector('button[class*="videoFacade"]')),
          iframePresent: Boolean(document.querySelector('[class*="videoIframe"]')),
          activeElementAriaLabel: document.activeElement?.getAttribute?.("aria-label") ?? null,
          activeElementText: (document.activeElement?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
        }));
        const collapsedShot = await captureState(page, {
          dir: VIDEO,
          metricsDir: METRICS,
          name: `collapsed-${cfg.name}-light.png`,
          metricsName: `video-collapsed-${cfg.name}-light.json`,
          label: `${label}-collapsed`,
          net,
          extra: { state: "video-collapsed", collapsedState },
        });

        results.push({
          name: `player-${cfg.name}`,
          viewport: { width: cfg.width, height: cfg.height },
          facadeBefore,
          loaded: { file: loadedShot.file, fileBytes: loadedShot.fileBytes, fileSha256: loadedShot.fileSha256, iframeWaitMs, videoArea: loadedShot.metrics.videoArea },
          userInitiatedNetwork: {
            requestCount: userPhaseRequests.length,
            externalCount: externalRequests.length,
            bilibiliCount: bilibiliRequests.length,
            bilibiliUrls: bilibiliRequests.map((r) => ({ url: r.url, status: r.status, resourceType: r.resourceType })),
            note: "仅用户点击后出现；不计入加载期外域/自动播放。",
          },
          loadPhaseNetwork: {
            requestCount: loadPhaseRequests.length,
            externalCount: loadPhaseRequests.filter((r) => !r.local).length,
            bilibiliCount: loadPhaseRequests.filter((r) => r.isBilibili).length,
          },
          collapsed: { file: collapsedShot.file, fileBytes: collapsedShot.fileBytes, fileSha256: collapsedShot.fileSha256, state: collapsedState, videoArea: collapsedShot.metrics.videoArea },
        });
      });
    } catch (error) {
      errors.push({ label, error: String(error?.stack ?? error).slice(0, 3000) });
    }
  }

  await browser.close();
  const netSummary = summarizeNet(net);
  await writeJson(path.join(VIDEO, "network-video-area.json"), {
    phase: "round2",
    kind: "network-audit-video-area",
    capturedAt: nowIso(),
    candidateSha: SHA,
    baseUrl: STATE_BASE,
    note: "网络分为“加载期”和“用户主动点击后”两段：加载期 0 外域/0 bilibili；bilibili 请求仅在用户点击门面后出现。",
    ...netSummary,
  });
  const summary = {
    phase: "round2",
    kind: "video-area-states",
    capturedAt: nowIso(),
    candidateSha: SHA,
    baseUrl: STATE_BASE,
    environment: environment(),
    protocol:
      "生产 next start + 本地回环；05 决赛演示区滚动到视口后截图；门面 1440/390 × light/dark；点击门面加载 Bilibili 官方 iframe（用户主动）后截图并加证据标注；点击“收起播放器”后恢复门面并检查焦点回归。",
    results,
    assertions: {
      loadPhaseNoExternal: results.every((r) => (r.requestAudit?.externalCount ?? r.loadPhaseNetwork?.externalCount ?? 0) === 0),
      loadPhaseNoBilibili: results.every((r) => (r.requestAudit?.bilibiliCount ?? r.loadPhaseNetwork?.bilibiliCount ?? 0) === 0),
      userInitiatedBilibiliRequests: results.filter((r) => r.userInitiatedNetwork).map((r) => ({ viewport: r.viewport, count: r.userInitiatedNetwork.bilibiliCount })),
      iframeRemovedAfterCollapse: results.filter((r) => r.collapsed).every((r) => r.collapsed.state.iframePresent === false && r.collapsed.state.facadePresent === true),
      focusReturnedToFacade: results.filter((r) => r.collapsed).every((r) => (r.collapsed.state.activeElementAriaLabel ?? "").includes("在本页加载")),
    },
    network: { file: "evidence/final-sprint/20261103/b-brand-home/round2/video/network-video-area.json", totals: netSummary.totals, assertions: netSummary.assertions },
    errors,
  };
  await writeJson(path.join(VIDEO, "video-area-summary.json"), summary);

  console.log("=== ROUND2 VIDEO AREA ===");
  for (const r of results) {
    if (r.requestAudit) console.log(`FACADE ${r.name} ${r.fileBytes}B facadeLines(title/meta)=${r.videoArea?.facade?.titleLineCount}/${r.videoArea?.facade?.metaLineCount} external=${r.requestAudit.externalCount} bilibili=${r.requestAudit.bilibiliCount}`);
    else console.log(`PLAYER ${r.name} loaded=${r.loaded.fileBytes}B iframe=${r.loaded.videoArea?.iframe?.bbox?.width}x${r.loaded.videoArea?.iframe?.bbox?.height} wait=${r.loaded.iframeWaitMs}ms bilibili(user)=${r.userInitiatedNetwork.bilibiliCount} loadExt=${r.loadPhaseNetwork.externalCount} collapsedIframe=${r.collapsed.state.iframePresent} focusBack=${r.collapsed.state.activeElementAriaLabel}`);
  }
  console.log("assertions:", JSON.stringify(summary.assertions));
  console.log("network:", JSON.stringify(netSummary.totals));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});

