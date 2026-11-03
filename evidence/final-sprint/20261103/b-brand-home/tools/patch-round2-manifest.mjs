/** Round 2 manifest 补录：报告路径、媒体最终态、top 资源、字体、异常与停止服务说明。 */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const ROUND2 = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/round2");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");

const manifestPath = path.join(ROUND2, "ROUND2_MANIFEST.json");
const manifest = await readJson(manifestPath);
const perf = await readJson(path.join(ROUND2, "perf", "prod-perf.json"));
const mediaFinal = await readJson(path.join(ROUND2, "metrics", "media-final-state.json"));

manifest.report = "evidence/final-sprint/20261103/b-brand-home/round2/CAPTURE_REPORT_ROUND2.md";
manifest.media.finalState = {
  file: mediaFinal.file,
  bytes: mediaFinal.fileBytes,
  sha256: mediaFinal.fileSha256,
  metricsFile: "evidence/final-sprint/20261103/b-brand-home/round2/metrics/media-final-state.json",
  state: mediaFinal.state ?? "media-final",
  railAtMedia: mediaFinal.railAtMedia ?? null,
};
manifest.performance.fontResourcesCold = perf.configs.find((c) => c.config.name === "1440-light")?.runs?.[0]?.fontResources ?? null;
manifest.performance.topResourcesCold = perf.configs.find((c) => c.config.name === "1440-light")?.topResourcesCold ?? null;
manifest.performance.largestResourceNote =
  "最大资源 /logo.png cold transfer 830,449B（decoded 830,149B，页面唯一 <img>）；仅记录实测体积，许可证/素材合规结论由 claims-auditor 负责。";
manifest.anomalies.logoResource = "cold 1440-light /logo.png transferSize 830,449B / decodedBodySize 830,149B，为页面最大资源；未做优化或替换（本轮不改 code）。";
manifest.anomalies.lcpDarkCold = "1440 dark cold LCP=1,240ms（P 元素）高于 FCP=568ms；warm 恢复 110ms；单次本机测量。";
manifest.anomalies.preloadWarnings = "生产 console 出现 1–2 条 Next CSS preload 提示（未使用的 preload chunk），非产品错误。";
manifest.anomalies.devServer = "任务开始时 dev server 34111 无监听；状态图与录屏改用生产 next start 34212 采集（无 dev 覆盖物）。";
manifest.anomalies.serverLifecycle =
  "next start 34212 由本轮脚本启动、采集完成后停止（PID 见 server/server.pid 历史）；重启命令：pwsh tools/round2-server.ps1 -Action start -Port 34212 -DistDir .next-build。";
manifest.anomalies.e2eIsolation = "Lead 的 E2E 使用独立 33411 + .next-e2e；本轮生产构建使用 .next-build + 34212，未并发构建/E2E。";
manifest.files = [
  ...(manifest.files ?? []),
  { path: manifest.report, kind: "report" },
  { path: manifest.media.finalState.file, bytes: manifest.media.finalState.bytes, sha256: manifest.media.finalState.sha256, kind: "screenshot" },
];
manifest.fileCount = manifest.files.filter((f) => f.kind === "screenshot").length;
await writeJson(manifestPath, manifest);

// 补充 README 指引（供 F/主控快速找到）
await writeFile(
  path.join(ROUND2, "README_ROUND2.md"),
  [
    "# Round 2（Track B）快速索引",
    "",
    "- 候选 SHA：`4b696141435825a3582816e8e449c0e0cf013f29`（4b69614）",
    "- 完整报告：`CAPTURE_REPORT_ROUND2.md`",
    "- 总 manifest：`ROUND2_MANIFEST.json`",
    "- 生产构建：`build/`（exit 0，83.82s，buildId zPIJxtwMWF7tBtxin98L-）",
    "- 生产服务：`server/`（next start 127.0.0.1:34212，采集后已停止）",
    "- 生产性能：`perf/prod-perf.json`（cold/warm × 3 配置）、`perf/network-prod.json`",
    "- 状态图：`after/`、`hero/`、`reduced-motion/`、`rail/`、`breakpoints/`、`closing/`、`states/`",
    "- 可重放片段（供 F）：`media/interaction-round2.webm`（18.08s）+ `media/MEDIA_MANIFEST.json`",
    "- 约束：不上传、不发布、不嵌入式自动播放；未点击外链；本轮未改 code。",
  ].join("\n") + "\n",
  "utf8",
);
console.log("manifest patched; screenshots=" + manifest.fileCount);
