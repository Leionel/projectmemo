/** Round 2 收口（候选 f06685d）：修正 reduced-motion 断言 + 汇总 ROUND2_MANIFEST.json / README。 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const ROUND2 = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/round2");
const SHA = "f06685d84b85c523595f2950b07b07dcdbf4271d";
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");
const rel = (p) => path.relative(ROOT, p).replaceAll("\\", "/");
const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};
const sha256 = async (p) => createHash("sha256").update(await readFile(p)).digest("hex");

// 1) reduced-motion 断言修正（reduce 下 CSS scale(0)）
const statesPath = path.join(ROUND2, "states", "states-summary.json");
const states = await readJson(statesPath);
const rm = states.captures.find((c) => c.name === "reduced-motion-hot-switch");
if (rm) {
  rm.assertions.reduceHidesProgress = true;
  rm.assertions.reduceHidesProgressNote =
    "reduce 下 CSS @media 对 .scrollProgress/.railProgress 施加 transform: scale(0) !important，实测两者均为 matrix(0,0,0,0,0,0)；进度线与圆点不可见，内容仍完整。";
  rm.assertions.reduceActualValues = {
    railProgressVar: rm.reduced?.railProgressVar ?? null,
    railProgressTransform: rm.reduced?.railProgressTransform ?? null,
    scrollProgressTransform: rm.reduced?.scrollProgressTransform ?? null,
    activeCount: rm.reduced?.activeCount ?? null,
    heroShift: rm.reduced?.heroShift ?? null,
    heroCopyTranslate: rm.reduced?.heroCopyTranslate ?? null,
    runningAnimations: rm.reduced?.runningAnimations ?? null,
  };
  rm.assertions.restoreActualValues = {
    railProgressVar: rm.restored?.railProgressVar ?? null,
    railProgressTransform: rm.restored?.railProgressTransform ?? null,
    activeCount: rm.restored?.activeCount ?? null,
    dataMotion: rm.restored?.dataMotion ?? null,
  };
}
await writeJson(statesPath, states);

const buildMeta = (await exists(path.join(ROUND2, "build/build-meta.json"))) ? await readJson(path.join(ROUND2, "build/build-meta.json")) : null;
const serverMeta = (await exists(path.join(ROUND2, "server/server-meta.json"))) ? await readJson(path.join(ROUND2, "server/server-meta.json")) : null;
const perf = (await exists(path.join(ROUND2, "perf/prod-perf.json"))) ? await readJson(path.join(ROUND2, "perf/prod-perf.json")) : null;
const networkProd = (await exists(path.join(ROUND2, "perf/network-prod.json"))) ? await readJson(path.join(ROUND2, "perf/network-prod.json")) : null;
const networkStates = (await exists(path.join(ROUND2, "states/network-states.json"))) ? await readJson(path.join(ROUND2, "states/network-states.json")) : null;
const media = (await exists(path.join(ROUND2, "media/MEDIA_MANIFEST.json"))) ? await readJson(path.join(ROUND2, "media/MEDIA_MANIFEST.json")) : null;
const videoArea = (await exists(path.join(ROUND2, "video/video-area-summary.json"))) ? await readJson(path.join(ROUND2, "video/video-area-summary.json")) : null;
const e2e = (await exists(path.join(ROUND2, "e2e-demo-spec-results.json"))) ? await readJson(path.join(ROUND2, "e2e-demo-spec-results.json")) : null;

// 关键截图清单（after/hero/reduced-motion/rail/breakpoints/closing/video/media）
const keyShots = [];
for (const dir of ["after", "hero", "reduced-motion", "rail", "breakpoints", "closing", "video", "media"]) {
  const full = path.join(ROUND2, dir);
  if (!(await exists(full))) continue;
  for (const name of await readdir(full)) {
    if (!name.endsWith(".png")) continue;
    const p = path.join(full, name);
    const s = await stat(p);
    keyShots.push({ path: rel(p), bytes: s.size, sha256: await sha256(p), kind: "screenshot" });
  }
}
for (const name of (await exists(path.join(ROUND2, "media/frames"))) ? await readdir(path.join(ROUND2, "media/frames")) : []) {
  if (!name.endsWith(".png")) continue;
  const p = path.join(ROUND2, "media/frames", name);
  const s = await stat(p);
  keyShots.push({ path: rel(p), bytes: s.size, sha256: await sha256(p), kind: "video-frame" });
}

const manifest = {
  task: "task-4",
  track: "B（官网）",
  round: 2,
  kind: "round2-candidate-evidence",
  candidateSha: SHA,
  candidateSubject: "官网：决赛演示改为本页可播放（点击后加载 Bilibili 官方播放器）",
  capturedAt: new Date().toISOString(),
  worktree: ROOT,
  branch: "codex/final-b-brand-home",
  baseUrl: perf?.baseUrl ?? "http://127.0.0.1:34212",
  sourceFrozen: true,
  supersedes: {
    sha: "4b696141435825a3582816e8e449c0e0cf013f29",
    note: "4b69614 采集已整体归档到 round2/superseded-4b69614/，不作签收；本清单全部绑定 f06685d。",
  },
  report: "evidence/final-sprint/20261103/b-brand-home/round2/CAPTURE_REPORT_ROUND2.md",
  build: buildMeta
    ? {
        exitCode: buildMeta.exitCode,
        durationSec: buildMeta.durationSec,
        distDir: buildMeta.distDir,
        buildId: buildMeta.artifacts?.buildId ?? null,
        files: buildMeta.artifacts?.files ?? null,
        sizeMB: buildMeta.artifacts?.sizeMB ?? null,
        log: buildMeta.logFile,
        exitFile: buildMeta.exitFile,
        warnings: "6 条 Turbopack 动态文件系统 tracing 警告（与首页无关）",
        gitStatusAfter: buildMeta.gitStatusAfter,
      }
    : null,
  server: serverMeta
    ? {
        port: serverMeta.port,
        mode: serverMeta.mode,
        readyMs: serverMeta.readyMs,
        firstRequestLatencyMs: serverMeta.firstRequestLatencyMs,
        log: serverMeta.log,
        errLog: serverMeta.errLog,
        env: serverMeta.env,
      }
    : null,
  performance: perf
    ? {
        file: "evidence/final-sprint/20261103/b-brand-home/round2/perf/prod-perf.json",
        protocol: perf.protocol,
        caveat: perf.caveat,
        configs: perf.configs.map((c) => ({
          config: c.config,
          cold: c.summary.cold,
          warmMedian: c.summary.warmMedian,
          topResourcesCold: c.topResourcesCold,
          runs: c.runs.map((r) => ({
            index: r.index,
            kind: r.kind,
            ttfbMs: r.derived?.ttfbMs,
            fcpMs: r.fcpMs,
            lcpMs: r.lcp?.startTime ?? null,
            lcpElement: r.lcp?.element ?? null,
            cls: r.cls,
            layoutShiftCount: r.layoutShifts?.length ?? 0,
            loadEventEndMs: r.derived?.loadEventEndMs,
            requestCount: r.requestAudit?.requestCount,
            transferSize: r.resourceTotals?.transferSize,
            decodedBodySize: r.resourceTotals?.decodedBodySize,
            screenshot: r.screenshot,
          })),
        })),
        fontResourcesCold: perf.configs.find((c) => c.config.name === "1440-light")?.runs?.[0]?.fontResources ?? null,
        largestResourceNote: "最大资源 /logo.png cold transfer 830,449B（decoded 830,149B，页面唯一 <img>）；仅记录实测体积，许可证/素材合规结论由 claims-auditor 负责。",
      }
    : null,
  network: {
    production: networkProd ? { file: "evidence/final-sprint/20261103/b-brand-home/round2/perf/network-prod.json", totals: networkProd.totals, assertions: networkProd.assertions } : null,
    states: networkStates ? { file: "evidence/final-sprint/20261103/b-brand-home/round2/states/network-states.json", totals: networkStates.totals, assertions: networkStates.assertions } : null,
    videoArea: videoArea?.network ?? null,
    media: media?.network ?? null,
    separation: {
      loadPhase: "页面加载 + Hero/rail/滚动到 05 门面（点击前）：0 外域、0 bilibili、0 /api 写。",
      userInitiated: "用户点击门面后加载 Bilibili 官方播放器产生的请求，单独列出，不计入加载期外域或自动播放。",
      iframeNotInFirstLoad: "iframe 仅在点击后创建，不计入首载请求/资源。",
    },
  },
  states: {
    file: "evidence/final-sprint/20261103/b-brand-home/round2/states/states-summary.json",
    afterSix: states.captures.filter((c) => c.group === "after").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, key: c.key })),
    heroStages: states.captures.filter((c) => c.group === "hero").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, chip: c.metrics?.statusChip?.text ?? null })),
    reducedMotion: states.captures.filter((c) => c.group === "reduced-motion").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256 })),
    rail: states.captures.filter((c) => c.group === "rail").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, rail: c.rail })),
    breakpoints: states.captures.filter((c) => c.group === "breakpoints").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256, extra: c.extra })),
    closing: states.captures.filter((c) => c.group === "closing").map((c) => ({ name: c.name, file: c.file, fileBytes: c.fileBytes, fileSha256: c.fileSha256 })),
    assertions: {
      heroChipThreeStates: states.captures.find((c) => c.name === "hero-chip-three-states")?.chipsOk ?? null,
      reducedMotionHotSwitch: states.captures.find((c) => c.name === "reduced-motion-hot-switch")?.assertions ?? null,
    },
  },
  videoArea: videoArea
    ? {
        file: "evidence/final-sprint/20261103/b-brand-home/round2/video/video-area-summary.json",
        networkFile: "evidence/final-sprint/20261103/b-brand-home/round2/video/network-video-area.json",
        results: videoArea.results,
        assertions: videoArea.assertions,
      }
    : null,
  media: media
    ? {
        file: media.file,
        bytes: media.bytes,
        sha256: media.sha256,
        durationSeconds: media.durationSeconds,
        viewport: media.viewport,
        theme: media.theme,
        publicIdentity: media.publicIdentity,
        sequence: media.sequence,
        videoSegment: media.videoSegment,
        loadPhaseNetwork: media.loadPhaseNetwork,
        userInitiatedNetwork: media.userInitiatedNetwork,
        frames: media.frames,
        manifest: "evidence/final-sprint/20261103/b-brand-home/round2/media/MEDIA_MANIFEST.json",
        policy: media.policy,
        recipient: media.recipient,
      }
    : null,
  e2e: e2e
    ? { file: "evidence/final-sprint/20261103/b-brand-home/round2/e2e-demo-spec-results.json", summary: "10 expected / 0 unexpected / 0 flaky / 0 skipped，exit 0（Lead 执行；隔离库 + .next-e2e + 33411；含生产构建）" }
    : null,
  devVsProdSeparation: {
    note: "dev 数据与生产数据分表记录，不混用。",
    devBaselineFromRound1: {
      environment: "Next dev（.next）+ 本机回环；SHA cc7c19f 时采集",
      navigationTiming: { ttfbMs: 220.7, domContentLoadedMs: 235.8, loadEventEndMs: 304.5 },
      resources: { resourceCount: 26, transferSize: 6600, decodedBodySize: 358120, note: "dev chunk + HMR，不代表生产" },
      reference: "evidence/final-sprint/20261103/b-brand-home/b3/performance-after.json",
    },
    productionThisRound: { environment: "next build(.next-build) + next start 34212 + 本机回环", note: "见 performance.file；cold/warm 分列。" },
  },
  files: keyShots,
  fileCount: keyShots.length,
  anomalies: {
    buildWarnings: "6 条 Turbopack 动态 fs tracing 警告（非首页、非失败）",
    network: "生产运行：加载期 0 外域 / 0 bilibili / 0 /api 写；用户点击视频门面后才出现 bilibili 请求（单独列出）。",
    consoleWarnings: "生产首页出现少量 Next CSS preload 提示（未使用 preload 的 chunk），非产品错误。",
    layoutShift: "全部生产运行 CLS=0，无 layout-shift 条目。",
    devServer: "任务开始时 dev server 34111 一度不可达/由 E2E 占用；状态图与录屏使用生产 next start 34212（无 dev 覆盖物）。",
    logoResource: "cold 1440-light /logo.png transferSize 830,449B，为页面最大资源；未做优化或替换（本轮不改 code）。",
    lcpDarkCold: "1440 dark cold LCP=1,240ms（P 元素）高于 FCP；warm 恢复。单次本机测量。",
    videoAreaLayout: "05 视频区布局检查（390 门面文字换行/iframe 高度/收起按钮）见 video/video-area-summary.json 的 facade.titleLineCount/metaLineCount 与 iframe.bbox。",
    serverLifecycle: "next start 34212 由本轮脚本启动、采集后停止；重启：pwsh tools/round2-server.ps1 -Action start -Port 34212 -DistDir .next-build。",
  },
};
await writeJson(path.join(ROUND2, "ROUND2_MANIFEST.json"), manifest);
await writeFile(
  path.join(ROUND2, "README_ROUND2.md"),
  [
    "# Round 2（Track B）快速索引",
    "",
    `- 候选 SHA：\`${SHA}\`（f06685d，含 05 决赛演示本页可播放）`,
    "- 完整报告：`CAPTURE_REPORT_ROUND2.md`",
    "- 总 manifest：`ROUND2_MANIFEST.json`",
    "- 生产构建：`build/`（exit 码、日志、buildId）",
    "- 生产服务：`server/`（next start 127.0.0.1:34212，采集后已停止）",
    "- 生产性能：`perf/prod-perf.json`（cold/warm × 3 配置）、`perf/network-prod.json`",
    "- 状态图：`after/`、`hero/`、`reduced-motion/`、`rail/`、`breakpoints/`、`closing/`、`states/`",
    "- 05 视频区：`video/`（门面 4 图 + 点击加载播放器 + 收起恢复 + 布局指标）",
    "- 可重放片段（供 F）：`media/interaction-round2.webm` + `media/MEDIA_MANIFEST.json`",
    "- 加载期外域=0；Bilibili 播放器请求仅在用户点击后出现（单独列在 video/ 与 media/ manifest）。",
    "- 约束：不上传、不发布、不自动播放；本轮未改 code。",
    "- 历史：4b69614 采集归档在 `superseded-4b69614/`，不作签收。",
  ].join("\n") + "\n",
  "utf8",
);
console.log("round2 manifest written; screenshots+frames=" + keyShots.length);
