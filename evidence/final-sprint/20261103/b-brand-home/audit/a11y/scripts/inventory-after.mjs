/**
 * Phase 1 静态清点（候选 SHA）：扫描当前工作树的官网相关 CSS，产出断点重复、
 * 小字号声明、焦点/偏好媒体规则、触控尺寸声明清单。
 *
 * 用法（cwd = 工作树根）：
 *   node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/inventory-after.mjs --sha=<候选SHA>
 * 产出：audit/a11y/json/after-static-inventory.json
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = "evidence/final-sprint/20261103/b-brand-home/audit/a11y";
const OUT = path.join(ROOT, "json", "after-static-inventory.json");
const SHA = arg("sha", "");
const FILES = [
  "app/home.module.css",
  "components/HomeJourney.module.css",
  "components/SiteHeader.module.css",
  "app/globals.css",
  "app/auth.module.css",
];
const REM = 16;
const toPx = (value) => {
  const m = String(value).trim().match(/^([\d.]+)(rem|px)$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "rem" ? REM : 1) * 100) / 100;
};
const read = (file) => {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const mediaQueries = [];
const fontDeclarations = [];
const targetDeclarations = [];
const focusRules = [];
const preferenceRules = [];

for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const lines = read(file);
  let selector = "(root)";
  const mediaStack = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    const media = trimmed.match(/^@media\s*(.*?)\s*\{$/);
    if (media) {
      mediaStack.push({ query: media[1], line: lineNo });
      mediaQueries.push({ file, line: lineNo, query: media[1] });
      return;
    }
    if (/^\}\s*$/.test(trimmed)) {
      if (!line.startsWith(" ") && !line.startsWith("\t") && mediaStack.length) mediaStack.pop();
      return;
    }
    if (trimmed.endsWith("{") && !trimmed.startsWith("@")) {
      selector = trimmed.slice(0, -1).trim();
      return;
    }
    const fontSize = trimmed.match(/font-size:\s*([^;]+);/);
    if (fontSize) {
      const px = toPx(fontSize[1]);
      fontDeclarations.push({ file, line: lineNo, selector, value: fontSize[1].trim(), px, media: mediaStack.length ? mediaStack[mediaStack.length - 1].query : null });
    }
    const m = trimmed.match(/^(min-height|height|width|min-width):\s*([^;]+);/);
    if (m && /button|summary|primary|secondary|headerCta|homeNav|storyTabs|stageTab|sourceButton|resetButton|storyFooter|dialogHeader|videoLink|footerNav|evidence/i.test(selector)) {
      targetDeclarations.push({ file, line: lineNo, selector, property: m[1], value: m[2].trim(), px: toPx(m[2].trim()), media: mediaStack.length ? mediaStack[mediaStack.length - 1].query : null });
    }
    if (/focus-visible/.test(selector) && trimmed.includes("outline")) {
      focusRules.push({ file, line: lineNo, selector, declaration: trimmed });
    }
    const mediaText = mediaStack.map((m2) => m2.query).join(" ");
    if (/prefers-(reduced-motion|contrast|reduced-transparency)/.test(mediaText)) {
      preferenceRules.push({ file, line: lineNo, media: mediaStack[mediaStack.length - 1].query, selector, declaration: trimmed });
    }
  });
}

const byQuery = {};
for (const mq of mediaQueries) {
  const key = mq.query.replace(/\s+/g, " ");
  byQuery[key] = byQuery[key] || [];
  byQuery[key].push({ file: mq.file, line: mq.line });
}
const duplicateBreakpoints = Object.entries(byQuery)
  .filter(([, list]) => list.length > 1)
  .map(([query, occurrences]) => ({ query, occurrences, count: occurrences.length }));
const perFileDuplicates = {};
for (const file of FILES) {
  const seen = {};
  for (const mq of mediaQueries.filter((m) => m.file === file)) {
    const key = mq.query.replace(/\s+/g, " ");
    seen[key] = seen[key] || [];
    seen[key].push(mq.line);
  }
  perFileDuplicates[file] = Object.entries(seen)
    .filter(([, lines]) => lines.length > 1)
    .map(([query, lines]) => ({ query, lines, count: lines.length }));
}

const inventory = {
  meta: {
    sha: SHA,
    gitHead: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    branch: execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim(),
    generatedAt: new Date().toISOString(),
    files: FILES.filter((f) => fs.existsSync(f)),
    note: "候选工作树 CSS 静态清点；动态实测见 probe-after.json。",
  },
  mediaQueries,
  duplicateBreakpoints,
  perFileDuplicates,
  smallFontDeclarations: fontDeclarations.filter((d) => d.px !== null && d.px < 12.8),
  fontDeclarations,
  targetDeclarations,
  focusRules,
  preferenceRules,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(inventory, null, 2), "utf8");
console.log("WROTE", OUT);
console.log("mediaQueries:", mediaQueries.length, "duplicate:", duplicateBreakpoints.map((d) => d.query + "x" + d.count).join(", ") || "none");
console.log("perFileDuplicates:", JSON.stringify(perFileDuplicates));
console.log("smallFontDeclarations(<12.8px):", inventory.smallFontDeclarations.length);
for (const d of inventory.smallFontDeclarations) console.log(`  ${d.file}:${d.line} ${d.selector} = ${d.value} (${d.px}px)${d.media ? " [" + d.media + "]" : ""}`);
