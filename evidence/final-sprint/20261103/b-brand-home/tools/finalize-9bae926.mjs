/**
 * 最终绑定：候选 SHA 更新为 9bae926（采集于 cc7c19f；9bae926 仅 CSS 作用域字号 + role 属性）。
 * 更新 MANIFEST/integrity/CAPTURE_REPORT 中的 SHA 与说明，并把定向补拍的 judgment 状态并入 b3 汇总。
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const EV = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home");
const SHA = "9bae926e9475cedef118deedf5e002ec8365a23b";
const CAPTURE_SHA = "cc7c19fed573c79a55f727eaa338ab84fd80cc3b";
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");
const readText = async (p) => readFile(p, "utf8");

const binding = {
  finalCandidateSha: SHA,
  finalCandidateSubject: "官网：B3 终验修复（共享差异组件字号作用域 + 分组语义）",
  capturedOnSha: CAPTURE_SHA,
  delta:
    "9bae926 相对 cc7c19f 仅：① components/HomeJourney.module.css 新增 .judgmentPane 作用域字号覆盖（共享 StateDiffView 的 text-xs / text-[11px] → 0.8rem=12.8px，仅影响五步第 3 步“查看判断”）；② components/HomeJourney.tsx / components/home/HomeHeroLens.tsx 补 role=\"group\"（无视觉变化）。不影响已采的 after 六图、断点、Hero 状态、rail/进度线/kicker/深度离场、reduced-motion、字体失败、dialog、回执、锚点与录屏路径。",
  targetedRecapture:
    "b3/states/judgment-step-1440-light.png 于 9bae926 直接补拍：比较基线 / 待确认 / 依据 2 项 / 主判断摘要 计算字号均 = 12.8px，pane 最小可见字号 12.8px；Hero lens role=group 已生效。",
};

// 1) after/integrity
const integrityPath = path.join(EV, "after/integrity-at-capture.json");
const integrity = await readJson(integrityPath);
integrity.finalCandidateSha = SHA;
integrity.finalCandidateSubject = binding.finalCandidateSubject;
integrity.capturedOnSha = CAPTURE_SHA;
integrity.binding = binding;
if (integrity.postCaptureEdits) {
  integrity.postCaptureEdits.impact =
    "上述改动已由 Lead 提交为 9bae926（终验修复）；本目录证据采集于 cc7c19f，已按 Lead 确认绑定到 9bae926，并额外补拍第 3 步判断页（judgment-step-1440-light）直接验证 12.8px。";
}
await writeJson(integrityPath, integrity);

// 2) after/MANIFEST + b3/MANIFEST
for (const relPath of ["after/MANIFEST.json", "b3/MANIFEST.json"]) {
  const p = path.join(EV, relPath);
  const manifest = await readJson(p);
  manifest.finalCandidateSha = SHA;
  manifest.sourceSha = SHA;
  manifest.capturedOnSha = CAPTURE_SHA;
  manifest.shaBinding = binding;
  if (manifest.sourceIntegrity) {
    manifest.sourceIntegrity.finalCandidateSha = SHA;
    manifest.sourceIntegrity.headAtCapture = SHA;
    manifest.sourceIntegrity.note =
      "最终候选 9bae926（cc7c19f + 终验 a11y/字号作用域修复）；截图/录屏采集于 cc7c19f（12:31–12:40），9bae926 仅改 .judgmentPane 字号作用域与 role 属性，不改变已采状态。";
    if (manifest.sourceIntegrity.postCaptureEdits) {
      manifest.sourceIntegrity.postCaptureEdits.impact =
        "已提交为 9bae926；证据绑定 9bae926，第 3 步判断页另行定向补拍验证。";
    }
  }
  await writeJson(p, manifest);
}

// 3) b3：并入 judgment 定向补拍
const b3Path = path.join(EV, "b3/MANIFEST.json");
const b3 = await readJson(b3Path);
const judgmentMetricsPath = path.join(EV, "b3/metrics/judgment-step-1440-light.json");
const judgmentMetrics = await readJson(judgmentMetricsPath);
const judgmentNet = await readJson(path.join(EV, "b3/network-judgment.json"));
const judgmentPng = path.join(EV, "b3/states/judgment-step-1440-light.png");
const judgmentStat = await stat(judgmentPng);
const judgmentState = {
  name: "judgment-step-1440-light",
  file: "evidence/final-sprint/20261103/b-brand-home/b3/states/judgment-step-1440-light.png",
  fileBytes: judgmentStat.size,
  fileSha256: judgmentMetrics.fileSha256,
  metricsFile: "evidence/final-sprint/20261103/b-brand-home/b3/metrics/judgment-step-1440-light.json",
  key: null,
  extra: {
    state: judgmentMetrics.state ?? "judgment-step-1440-light",
    candidateSha: judgmentMetrics.candidateSha ?? SHA,
    selectedStoryTab: judgmentMetrics.selectedStoryTab ?? null,
    judgmentFonts: judgmentMetrics.judgmentFonts ?? null,
    lensRole: judgmentMetrics.lensRole ?? null,
    assertions: judgmentMetrics.assertions ?? null,
  },
};
b3.states = [...(b3.states ?? []).filter((s) => s.name !== "judgment-step-1440-light"), judgmentState];
b3.assertions.judgmentStep = {
  candidateSha: SHA,
  selectedStoryTab: judgmentMetrics.selectedStoryTab ?? null,
  baselineFontSizePx: judgmentMetrics.judgmentFonts?.baseline?.fontSizePx ?? null,
  pendingFontSizePx: judgmentMetrics.judgmentFonts?.pending?.fontSizePx ?? null,
  evidenceCountFontSizePx: judgmentMetrics.judgmentFonts?.evidenceCount?.fontSizePx ?? null,
  summaryFontSizePx: judgmentMetrics.judgmentFonts?.summary?.fontSizePx ?? null,
  paneMinVisibleFontSizePx: judgmentMetrics.judgmentFonts?.minVisibleFontSizePx ?? null,
  heroLensRole: judgmentMetrics.lensRole?.heroLensRole ?? null,
  network: { totals: judgmentNet.totals ?? null, assertions: judgmentNet.assertions ?? null },
};
b3.files = [
  ...(b3.files ?? []).filter((f) => !(f.path ?? "").includes("judgment-step-1440-light") && !(f.path ?? "").includes("network-judgment")),
  { path: judgmentState.file, bytes: judgmentStat.size, kind: "screenshot" },
  { path: judgmentState.metricsFile, kind: "metrics" },
  { path: "evidence/final-sprint/20261103/b-brand-home/b3/network-judgment.json", kind: "network-audit" },
];
await writeJson(b3Path, b3);

// 4) video-meta SHA
const videoMetaPath = path.join(EV, "b3/video-meta.json");
const videoMeta = await readJson(videoMetaPath);
videoMeta.sourceSha = SHA;
videoMeta.capturedOnSha = CAPTURE_SHA;
videoMeta.shaBindingNote = "录屏采集于 cc7c19f；绑定最终候选 9bae926（仅字号作用域/role 属性，不改变录屏路径视觉）。";
await writeJson(videoMetaPath, videoMeta);

// 5) CAPTURE_REPORT：更新 Phase 2 标题/说明 + 增加 judgment 行
const reportPath = path.join(EV, "CAPTURE_REPORT.md");
let report = await readText(reportPath);
report = report.replace(
  "## Phase 2 — after 六图、断点/缩放、滚动动效、状态图、录屏、性能取证（已完成，最终候选 cc7c19f）\n\n状态：**DONE**（最终候选 SHA `cc7c19fed573c79a55f727eaa338ab84fd80cc3b`，工作树除证据目录外干净；dev server 服务该状态）",
  "## Phase 2 — after 六图、断点/缩放、滚动动效、状态图、录屏、性能取证（已完成，最终候选 9bae926）\n\n状态：**DONE**（最终候选 SHA `9bae926e9475cedef118deedf5e002ec8365a23b`，`git status --porcelain -- app components` 为空；dev server 服务该状态）\n\n**SHA 绑定说明**：全部截图/录屏采集于 `cc7c19f`（12:31–12:40，当时树干净）；Lead 确认最终候选为 `9bae926`（= cc7c19f + 终验修复：`.judgmentPane` 作用域字号覆盖 + 两个 `role=\"group\"`，均不改变已采状态）。第 3 步判断页已按 `9bae926` 定向补拍验证。",
);
report = report.replace(
  "| `anchor-experience.png`（92,029B） | 点击主 CTA 后 scrollY=1274；header 高 57px；`#experience-title` top=202.6 > header bottom=57 → **标题未被 sticky header 遮挡** |",
  "| `anchor-experience.png`（92,029B） | 点击主 CTA 后 scrollY=1274；header 高 57px；`#experience-title` top=202.6 > header bottom=57 → **标题未被 sticky header 遮挡** |\n| 五步第 3 步「查看判断」字号（9bae926 定向补拍） | `judgment-step-1440-light.png`（102,073B） | 比较基线 12.8px / 待确认 12.8px / 依据 2 项 12.8px / 主判断摘要 12.8px；pane 最小可见字号 12.8px；Hero lens `role=\"group\"` 生效 |",
);
report = report.replace(
  "| `b3/states/*.png` | reduced-motion（3）、字体失败、dialog、回执门槛、已保存回执、锚点 |",
  "| `b3/states/*.png` | reduced-motion（3）、字体失败、dialog、回执门槛、已保存回执、锚点、第 3 步判断页（9bae926 定向补拍） |",
);
report = report.replace(
  "| `b3/performance-after.json`、`b3/resources-after.json`、`b3/network-after.json`、`b3/network-b3.json` | 性能、资源、网络审计 |",
  "| `b3/performance-after.json`、`b3/resources-after.json`、`b3/network-after.json`、`b3/network-b3.json`、`b3/network-judgment.json` | 性能、资源、网络审计 |",
);
report = report.replace(
  "| `tools/phase2-lib.mjs`、`tools/capture-phase2-after.mjs`、`tools/capture-phase2-b3.mjs`、`tools/extract-video-frames.mjs`、`tools/finalize-phase2.mjs` | 采集/截帧/收口脚本 |",
  "| `tools/phase2-lib.mjs`、`tools/capture-phase2-after.mjs`、`tools/capture-phase2-b3.mjs`、`tools/capture-judgment-step.mjs`、`tools/extract-video-frames.mjs`、`tools/finalize-phase2.mjs`、`tools/finalize-9bae926.mjs` | 采集/截帧/收口/最终绑定脚本 |",
);
await writeFile(reportPath, report, "utf8");

console.log("bound final SHA", SHA, "judgment bytes", judgmentStat.size);
