/**
 * 用 Chromium 播放 b3/interaction-15s.webm 并截取关键帧，验证录屏内容与时长。
 * Playwright 自带 ffmpeg 缺少 vp8 解码器，改用浏览器解码。
 */
import { chromium } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const B3 = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/b3");
const VIDEO = path.join(B3, "interaction-20s.webm");
const FRAMES = path.join(B3, "video-frames");

const toFileUrl = (p) => "file:///" + p.replaceAll("\\", "/").replace(/^\//, "");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await mkdir(FRAMES, { recursive: true });
await page.goto(toFileUrl(VIDEO), { waitUntil: "load" });
const meta = await page.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v) return { found: false };
  if (v.readyState < 1) {
    await new Promise((resolve) => v.addEventListener("loadedmetadata", resolve, { once: true }));
  }
  return { found: true, duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
});
const frames = [];
for (const t of [1.5, 5.5, 10.5, 15.5, 19.5]) {
  const actual = Math.min(t, Math.max(0, meta.duration - 0.15));
  await page.evaluate(async (time) => {
    const v = document.querySelector("video");
    v.pause();
    v.currentTime = time;
    await new Promise((resolve) => {
      if (Math.abs(v.currentTime - time) < 0.05 && v.readyState >= 2) return resolve();
      v.addEventListener("seeked", resolve, { once: true });
    });
  }, actual);
  await page.waitForTimeout(200);
  const file = path.join(FRAMES, `frame-${String(t).replace(".", "_")}s.png`);
  await page.screenshot({ path: file });
  const s = await stat(file);
  frames.push({ atSecond: actual, file: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: s.size });
}
console.log(JSON.stringify({ meta, frames }, null, 2));
await context.close();
await browser.close();
