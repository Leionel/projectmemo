/**
 * Track B / Round 2 — 15–20 秒可重放片段 + 关键帧 + 资产 manifest（供 F 接收）。
 * 绑定 SHA 4b69614；生产 next start；1440×900 light；公开合成身份。
 * 不上传、不发布、不嵌入式自动播放。
 *
 * 输出（round2/media/）：
 *   interaction-round2.webm
 *   frames/frame-<t>s.png
 *   network-media.json
 *   MEDIA_MANIFEST.json
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  PROD_BASE,
  ROUND2,
  SHA,
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

const MEDIA = path.join(ROUND2, "media");
const FRAMES = path.join(MEDIA, "frames");
const METRICS = path.join(ROUND2, "metrics");

const browser = await launchBrowser();
const net = createNet();
const context = await newContext(browser, { recordVideo: { dir: MEDIA, size: { width: 1440, height: 900 } } });
const page = await context.newPage();
page.setDefaultTimeout(90_000);
page.setDefaultNavigationTimeout(120_000);
net.attach(page);

await mkdir(MEDIA, { recursive: true });
await mkdir(FRAMES, { recursive: true });
await mkdir(METRICS, { recursive: true });

const wallStart = Date.now();
await loadHome(page, { baseUrl: PROD_BASE, theme: "light", width: 1440, height: 900, net, label: "media-load", settleMs: 700 });
const loadMs = Date.now() - wallStart;
const videoHandle = page.video();

// 动态预算：目标 19.5s（15–20s 允许区间内），扣掉加载后按权重分配。
// 路径：加载 → Hero 三阶段（chip 三态）→ 依据展开/收起 → rail 进度 → 05 门面 → 点击加载官方播放器 → 收起。
const baseWeights = [400, 1200, 1200, 1200, 1400, 700, 1400, 800, 1300, 2200, 900, 600];
const elapsedAfterLoad = Date.now() - wallStart;
const budget = Math.max(10000, 14_800 - elapsedAfterLoad - 200);
const weightSum = baseWeights.reduce((a, b) => a + b, 0);
const scale = budget / weightSum;
const waits = baseWeights.map((w) => Math.max(250, Math.round(w * scale)));
const steps = [];
const step = async (label, fn, waitMs) => {
  const t = Date.now();
  if (fn) await fn();
  await page.waitForTimeout(waitMs);
  steps.push({ label, atMs: Date.now() - wallStart, waitMs });
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
await step("stage-away", () => page.getByRole("tab", { name: /离开时/ }).click(), waits[1]);
await step("stage-during", () => page.getByRole("tab", { name: /期间/ }).click(), waits[2]);
await step("stage-back", () => page.getByRole("tab", { name: /回来后/ }).click(), waits[3]);
await step("evidence-open", () => page.getByRole("button", { name: /查看依据/ }).click(), waits[4]);
await step("evidence-close", () => page.getByRole("button", { name: /收起依据/ }).click(), waits[5]);
await step("scroll-to-rail", () => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), railTarget), waits[6]);
const railAtMedia = await page.evaluate(() => {
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
await step("scroll-to-demo", () => page.evaluate(() => {
  const demo = document.querySelector("#demo");
  if (demo) window.scrollTo({ top: Math.max(0, Math.round(demo.getBoundingClientRect().top + window.scrollY - 70)), behavior: "smooth" });
}), waits[8]);

const loadPhaseRequests = net.records.filter((r) => r.capture === "media-load");
net.setLabel("media-user");
const facadeBefore = await page.evaluate(() => ({
  facadePresent: Boolean(document.querySelector('button[class*="videoFacade"]')),
  iframePresent: Boolean(document.querySelector('iframe[class*="videoIframe"]')),
  facadeAriaLabel: document.querySelector('button[class*="videoFacade"]')?.getAttribute("aria-label") ?? null,
}));
await step("click-video-facade", () => page.locator('button[class*="videoFacade"]').click(), 400);
await step("player-loading-hold", async () => {
  await page.waitForSelector('iframe[class*="videoIframe"]', { state: "visible", timeout: 15_000 });
}, waits[9]);
const userPhaseRequests = net.records.filter((r) => r.capture === "media-user");
const userBilibiliRequests = userPhaseRequests.filter((r) => r.isBilibili);
const playerMetrics = await captureState(page, {
  dir: MEDIA,
  metricsDir: METRICS,
  name: "media-video-player-state.png",
  metricsName: "media-video-player-state.json",
  label: "media-user",
  net,
  extra: { state: "media-video-player", userInitiated: true, railAtMedia, facadeBefore },
});
await step("collapse-player", () => page.getByRole("button", { name: /收起播放器/ }).click(), waits[10]);
await step("final-hold", null, waits[11]);
const finalMetrics = await captureState(page, {
  dir: MEDIA,
  metricsDir: METRICS,
  name: "media-final-state.png",
  metricsName: "media-final-state.json",
  label: "media-final",
  net,
  extra: { state: "media-final", railAtMedia, facadeBefore },
});
const wallMs = Date.now() - wallStart;
const videoDest = path.join(MEDIA, "interaction-round2.webm");
await context.close();
if (videoHandle) await videoHandle.saveAs(videoDest);
const videoStat = await stat(videoDest);

// 读取时长（Chromium 解码；Playwright ffmpeg 无 vp8 解码器）
const probeContext = await newContext(browser, { viewport: { width: 1440, height: 900 } });
const probePage = await probeContext.newPage();
await probePage.goto("file:///" + videoDest.replaceAll("\\", "/").replace(/^\//, ""), { waitUntil: "load" });
const duration = await probePage.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v) return null;
  if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  return { duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
});

// 关键帧
const frameTimes = [1.5, 4.5, 7.5, 10.5, 13.5, 16.0];
const frames = [];
for (const t of frameTimes) {
  const actual = Math.min(t, Math.max(0, (duration?.duration ?? t) - 0.15));
  await probePage.evaluate(async (time) => {
    const v = document.querySelector("video");
    v.pause();
    v.currentTime = time;
    await new Promise((resolve) => {
      if (Math.abs(v.currentTime - time) < 0.05 && v.readyState >= 2) return resolve();
      v.addEventListener("seeked", resolve, { once: true });
    });
  }, actual);
  await probePage.waitForTimeout(150);
  const name = `frame-${String(t).replace(".", "_")}s.png`;
  const file = path.join(FRAMES, name);
  await probePage.screenshot({ path: file });
  const buf = await stat(file);
  frames.push({ atSecond: actual, file: rel(file), bytes: buf.size, sha256: sha256(await readFile(file)) });
}
await probeContext.close();
await browser.close();

const netSummary = summarizeNet(net);
await writeJson(path.join(MEDIA, "network-media.json"), {
  phase: "round2",
  kind: "network-audit-media",
  capturedAt: nowIso(),
  candidateSha: SHA,
  baseUrl: PROD_BASE,
  ...netSummary,
});

const manifest = {
  task: "task-4",
  round: 2,
  kind: "replayable-clip-asset-manifest",
  candidateSha: SHA,
  capturedAt: nowIso(),
  recipient: "F（视频/素材接收角色）",
  baseUrl: PROD_BASE,
  mode: "production next start（.next-build）",
  viewport: { width: 1440, height: 900 },
  theme: "light",
  publicIdentity: {
    label: "内置公开示例",
    project: "忆程参赛作品开发",
    mission: "整理阶段汇报",
    boundary: "公开示例 · 不调用模型 · 不写入你的项目",
    source: "components/home/homeExample.ts",
  },
  file: rel(videoDest),
  bytes: videoStat.size,
  sha256: sha256(await readFile(videoDest)),
  durationSeconds: duration?.duration ?? null,
  videoWidth: duration?.videoWidth ?? null,
  videoHeight: duration?.videoHeight ?? null,
  wallClockMs: wallMs,
  loadMs,
  targetSeconds: "15–20",
  sequence: steps.map((s) => `${s.label} @${(s.atMs / 1000).toFixed(1)}s`),
  railAtMedia,
  videoSegment: {
    facadeBefore,
    playerState: { file: playerMetrics.file, bytes: playerMetrics.fileBytes, sha256: playerMetrics.fileSha256, metricsFile: rel(path.join(METRICS, "media-video-player-state.json")), userInitiated: true },
    collapsedFacadeRestored: finalMetrics.metrics?.videoArea?.facade ? true : false,
    note: "门面 → 用户点击 → Bilibili 官方播放器 iframe 出现 → 收起恢复门面；外部请求仅在点击后发生。",
  },
  loadPhaseNetwork: {
    requestCount: loadPhaseRequests.length,
    externalCount: loadPhaseRequests.filter((r) => !r.local).length,
    bilibiliCount: loadPhaseRequests.filter((r) => r.isBilibili).length,
    apiWriteCount: loadPhaseRequests.filter((r) => r.isApiWrite).length,
    note: "加载 + Hero 阶段 + rail + 滚动到 05 门面（点击前）的请求：0 外域、0 bilibili。",
  },
  userInitiatedNetwork: {
    requestCount: userPhaseRequests.length,
    externalCount: userPhaseRequests.filter((r) => !r.local).length,
    bilibiliCount: userBilibiliRequests.length,
    bilibiliUrls: userBilibiliRequests.map((r) => ({ url: r.url, status: r.status, resourceType: r.resourceType })),
    note: "用户点击门面后才出现的 Bilibili 播放器请求；单独列出，不计入加载期外域/自动播放。",
  },
  frames,
  finalState: { file: finalMetrics.file, bytes: finalMetrics.fileBytes, sha256: finalMetrics.fileSha256, metricsFile: rel(path.join(METRICS, "media-final-state.json")) },
  network: { file: "evidence/final-sprint/20261103/b-brand-home/round2/media/network-media.json", totals: netSummary.totals, assertions: netSummary.assertions },
  policy: {
    uploaded: false,
    published: false,
    embeddedAutoplay: false,
    externalNetworkWrite: false,
    userInitiatedExternalPlayer: true,
    note: "本地生成、本地保存；未上传、未发布、未嵌入自动播放；Bilibili 官方播放器仅在用户主动点击后加载（该段外部请求单独列出），未点击外链打开新窗口。",
  },
  caveat: "本机生产构建预览录屏，公开合成示例；不代表线上 CDN/网络或所有用户体验。",
};
await writeJson(path.join(MEDIA, "MEDIA_MANIFEST.json"), manifest);
console.log(JSON.stringify({ file: manifest.file, bytes: manifest.bytes, durationSeconds: manifest.durationSeconds, frames: frames.length, railAtMedia, network: netSummary.totals, assertions: netSummary.assertions }, null, 2));



