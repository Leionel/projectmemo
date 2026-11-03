/** 记录 Phase 2 采集完成后的源码变动（采集时干净，采集后出现两处未提交改动）。 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const EV = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");

const note = {
  capturedAt: "2026-11-03T12:31–12:40+08:00（截图/录屏均在此窗口内）",
  treeAtCapture: "HEAD=cc7c19f；git status 仅证据目录未跟踪（干净）",
  editsAfterCapture: [
    { file: "components/home/HomeHeroLens.tsx", mtimeLocal: "2026-11-03T12:40:44+08:00", diff: "+ role=\"group\"（aria 语义，无视觉变化）" },
    { file: "components/HomeJourney.module.css", mtimeLocal: "2026-11-03T12:40:45+08:00", diff: "+ 五步示例 judgmentPane 内 text-xs/text-[11px] 元数据提升到 12.8px（仅影响第 3 步“查看判断”的 StateDiffView 文本）" },
    { file: "next-env.d.ts", mtimeLocal: "2026-11-03T12:38:00+08:00", diff: "Next 自动生成" },
  ],
  impact: "以上改动发生在全部 Phase 2 截图（最后一张 12:36:48 录屏）之后；因此本目录证据对应已提交的 cc7c19f，不包含这两处未提交改动。若 Lead 将其纳入最终候选，需提交新 SHA 并补拍受影响状态（第 3 步判断页字号 + lens role 无视觉影响）。",
};
const integrityPath = path.join(EV, "after/integrity-at-capture.json");
const integrity = await readJson(integrityPath);
integrity.postCaptureEdits = note;
await writeJson(integrityPath, integrity);

for (const relPath of ["after/MANIFEST.json", "b3/MANIFEST.json"]) {
  const p = path.join(EV, relPath);
  const manifest = await readJson(p);
  manifest.sourceIntegrity = { ...(manifest.sourceIntegrity ?? {}), postCaptureEdits: note };
  await writeJson(p, manifest);
}
console.log("post-capture edits recorded");
