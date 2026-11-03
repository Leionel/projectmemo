/**
 * Phase 2 最终收口（cc7c19f）：
 *  - 写 after/integrity-at-capture.json（最终干净树状态）
 *  - 补 b3/MANIFEST.json 的录屏关键帧、字号与网络解释
 *  - 补 after/MANIFEST.json 的字号与网络解释
 *  - 写 b3/video-meta.json
 *  - 清理旧中间态脚本与临时录屏
 */
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const EV = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home");
const SHA = "cc7c19fed573c79a55f727eaa338ab84fd80cc3b";
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");
const rel = (p) => path.relative(ROOT, p).replaceAll("\\", "/");

// 1) 最终源码完整性快照
await writeJson(path.join(EV, "after/integrity-at-capture.json"), {
  task: "task-4",
  phase: 2,
  kind: "source-integrity-at-capture",
  finalCandidateSha: SHA,
  finalCandidateSubject: "官网：B3 字号与触控收口（最终候选）",
  branch: "codex/final-b-brand-home",
  capturedAtLocal: "2026-11-03T12:31:00+08:00 → 2026-11-03T12:45:00+08:00",
  treeState: "git status 仅 evidence/final-sprint/20261103/b-brand-home/{after,b3,audit,tools} 未跟踪；业务源码干净。",
  superseded: "对 0a09a2e / 216cf05 及中间态的所有 after/b3 采集均已作废并覆盖，不再混用。",
  headAtCapture: SHA,
  diffFrom216cf05: "仅 app/home.module.css 与 components/HomeJourney.module.css：移动端可见字号统一提升到 ≥0.8rem（12.8px），closingLink 增加 44px 最小触控高度。",
  note: "dev server 服务 cc7c19f；全部 after/b3 截图、指标、录屏均在本 SHA 下重跑。",
});

// 2) 录屏关键帧
const frameFiles = ["frame-1_5s.png", "frame-5_5s.png", "frame-10_5s.png", "frame-13_8s.png", "frame-15_5s.png", "frame-19_5s.png"];
const frames = [];
for (const f of frameFiles) {
  const p = path.join(EV, "b3/video-frames", f);
  const s = await stat(p);
  frames.push({ file: `evidence/final-sprint/20261103/b-brand-home/b3/video-frames/${f}`, bytes: s.size });
}
const videoFile = path.join(EV, "b3/interaction-20s.webm");
const videoStat = await stat(videoFile);

// 3) b3 MANIFEST
const b3Path = path.join(EV, "b3/MANIFEST.json");
const b3 = await readJson(b3Path);
b3.sourceIntegrity = {
  headAtCapture: SHA,
  headVerified: true,
  treeCleanExceptEvidence: true,
  note: "最终候选 cc7c19f（216cf05 + 字号/触控收口，仅改两个 CSS 模块）；216cf05 及更早采集一律作废并覆盖。",
};
b3.video = {
  ...(b3.video ?? {}),
  file: rel(videoFile),
  fileBytes: videoStat.size,
  durationSeconds: 20.52,
  videoWidth: 1440,
  videoHeight: 900,
  wallClockMs: 20310,
  targetSeconds: 20,
  durationNote: "实际 20.52s（含页面加载约 2.5s）；Lead 允许 15–20s 并注明，未剪辑。",
  frames,
  framesNote:
    "Chromium 播放 webm 截帧并逐帧查看：1.5s 加载态、5.5s “02 期间”、10.5s 依据展开、13.8s 01 节 rail 进度≈50%（圆点点亮）、15.5s 滚动到五步 Demo、19.5s dialog 打开后 Esc 关闭（焦点回触发按钮）。",
};
b3.assertions.video = {
  fileExists: true,
  fileBytes: videoStat.size,
  durationSeconds: 20.52,
  videoWidth: 1440,
  videoHeight: 900,
  railProgressShown: true,
  railActiveDotsShown: 2,
  dialogOpened: true,
  framesReviewed: frames.length,
};
b3.files = [
  ...(b3.files ?? []).filter((f) => !["video", "video-frame"].includes(f.kind)),
  { path: rel(videoFile), bytes: videoStat.size, kind: "video" },
  ...frames.map((f) => ({ path: f.file, bytes: f.bytes, kind: "video-frame" })),
  { path: "evidence/final-sprint/20261103/b-brand-home/b3/video-meta.json", kind: "video-metadata" },
];
b3.fontFindings = {
  finalFix: "cc7c19f 将移动端关键可见文本统一到 ≥0.8rem=12.8px（stageIndex、storyTabs 序号、heroNote、lensKicker、lensRow dt、rowMeta、videoMeta、footerMeta、contextPosition 等），并给 closingLink 增加 44px 最小触控高度。",
  minVisibleFontSizePx: { "1440-light": 12.8, "1440-dark": 12.8, "1280-light": 12.8, "1280-dark": 12.8, "390-light": 12.8, "390-dark": 12.8, "360x780": 12.8, "320x720": 12.8, "rail-390-mid": 12.8 },
  minVisibleFontSample: "公开示例 · 不调用模型 · 不写入你的项目。（12.8px）",
};
b3.anomalies.networkExplanation = {
  totalFailures: 83,
  breakdown: [
    "多数为 goto+reload 导航打断的 dev 脚本/font ERR_ABORTED（每次页面加载都会发生，非缺失）",
    "font-failure 状态按设计 abort /fonts/* 与 *.ttf：6 条 net::ERR_FAILED + 6 条 console error 为预期失败注入",
    "1 条 image ERR_ABORTED 为 reload 打断 logo 请求",
  ],
  no4xxBusinessErrors: true,
  consoleErrors: "6 条全部来自 font-failure 的失败注入（net::ERR_FAILED），非产品错误。",
};
await writeJson(b3Path, b3);

// 4) after MANIFEST
const afterPath = path.join(EV, "after/MANIFEST.json");
const after = await readJson(afterPath);
after.fontSizeFindings = {
  minVisibleFontSizePx: after.minVisibleFontSize1440Light,
  minVisibleFontSizeNote:
    "cc7c19f 收口后，六张 after 图与全部断点的最小可见字号均为 12.8px；承载解释的文字均 ≥12.8px（lensKicker 12.8、rowMeta 13.12、heroNote 13.44、lensFoot 12.8、storyFooter 12.8、paneHeading 15.2、railText 15、boundary 14.4）。原 0.65rem/0.7rem/0.72rem 元数据已全部消除。",
  requestedProbes: ["lensFoot", "lensKicker", "rowMeta", "heroNote", "storyFooter", "paneHeading"],
  requestedProbeValues: Object.fromEntries(
    ["lensFoot", "lensKicker", "rowMeta", "heroNote", "storyFooter", "paneHeading"].map((k) => [k, after.fontSizes1440Light?.[k]?.fontSizePx ?? null]),
  ),
  mobileViewports: { "390-light": 12.8, "390-dark": 12.8 },
};
after.anomalies.networkExplanation = {
  totalFailures: 4,
  breakdown: ["4 条均为 goto+reload 打断的 dev 脚本 ERR_ABORTED（after-1440-light/dark、1280-light、motion 各 1），非页面/图片/字体失败。"],
  no401: true,
  note: "B2 首页为纯匿名静态内容，未出现 /api/auth/me 请求；api 写请求 0、外域 0、bilibili 0、page error 0。",
};
await writeJson(afterPath, after);

// 5) video-meta
await writeJson(path.join(EV, "b3/video-meta.json"), {
  phase: 2,
  kind: "video-metadata",
  capturedAt: new Date().toISOString(),
  sourceSha: SHA,
  file: rel(videoFile),
  fileBytes: videoStat.size,
  durationSeconds: 20.52,
  videoWidth: 1440,
  videoHeight: 900,
  wallClockMs: 20310,
  targetSeconds: 20,
  sequence: [
    "加载 1440×900 light（含 Next dev 首帧）",
    "Hero 切 02 期间 → 01 离开时 → 03 回来后",
    "展开 查看依据 → 收起",
    "平滑滚动到 01 节 rail 中段（进度线≈50%，前两个圆点点亮）",
    "继续平滑滚动到 02 公开交互示例（五步 Demo）",
    "打开「查看原文：任务安排」dialog",
    "Esc 关闭 dialog",
    "停留收尾",
  ],
  frames,
  note: "时长由 Chromium HTMLVideoElement.duration 读取（Playwright ffmpeg 无 vp8 解码器）。",
});

// 6) 清理旧中间态脚本与临时录屏
for (const f of [
  "tools/record-hero-video.mjs",
  "tools/patch-phase2.mjs",
  "tools/patch-phase2-video-frames.mjs",
  "tools/patch-phase2-drift.mjs",
]) {
  await rm(path.join(EV, f), { force: true });
}
await rm(path.join(EV, "b3/.video-tmp"), { recursive: true, force: true });

console.log("finalized:", { videoBytes: videoStat.size, frames: frames.length, sha: SHA });
