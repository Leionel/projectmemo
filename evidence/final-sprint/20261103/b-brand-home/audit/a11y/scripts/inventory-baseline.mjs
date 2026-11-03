/**
 * Phase 0 静态清点：只读取 audit/a11y/baseline-src/ 下由 git show 485d485 提取的基线源码，
 * 不访问工作树当前实现（工作树已被 B2 修改）。
 *
 * 用法：node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/inventory-baseline.mjs
 * 产出：audit/a11y/json/baseline-static-inventory.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "evidence/final-sprint/20261103/b-brand-home/audit/a11y";
const SRC = path.join(ROOT, "baseline-src");
const OUT = path.join(ROOT, "json", "baseline-static-inventory.json");
const FILES = [
  "app/page.tsx",
  "app/home.module.css",
  "components/HomeJourney.tsx",
  "components/SiteHeader.tsx",
  "app/layout.tsx",
  "app/globals.css",
  "components/StateDiffView.tsx",
  "app/auth.module.css",
];

const read = (file) => {
  // 证据副本一律 .txt 后缀，避免被 tsconfig 的 **/*.tsx 收进 tsc 类型检查。
  let target = path.join(SRC, file);
  if (!fs.existsSync(target) && fs.existsSync(target + ".txt")) target += ".txt";
  const lines = fs.readFileSync(target, "utf8").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop(); // git show 末尾换行不产生内容行
  return lines;
};

const REM = 16; // html 默认 16px；body 的 14px 不改变 rem
const toPx = (value) => {
  const m = String(value).trim().match(/^([\d.]+)(rem|px)$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "rem" ? REM : 1) * 100) / 100;
};

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

const cssDeclarations = [];
const mediaQueries = [];
const focusRules = [];
const motionRules = [];
const contrastRules = [];
const scrollMargins = [];

for (const file of FILES) {
  if (!file.endsWith(".css")) continue;
  const lines = read(file);
  let selector = "(root)";
  let selectorLine = 0;
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
      if (mediaStack.length && !selector.includes(",")) {
        // 关闭最内层 @media（近似：按缩进 0 的 } 处理）
        if (!line.startsWith(" ") && !line.startsWith("\t")) mediaStack.pop();
      }
      return;
    }
    if (trimmed.endsWith("{") && !trimmed.startsWith("@")) {
      selector = trimmed.slice(0, -1).trim();
      selectorLine = lineNo;
      return;
    }
    const fontSize = trimmed.match(/font-size:\s*([^;]+);/);
    if (fontSize) {
      const px = toPx(fontSize[1]);
      cssDeclarations.push({
        file,
        line: lineNo,
        selector,
        selectorLine,
        value: fontSize[1].trim(),
        px,
        media: mediaStack.length ? mediaStack[mediaStack.length - 1].query : null,
      });
    }
    const scrollMargin = trimmed.match(/scroll-margin-top:\s*([^;]+);/);
    if (scrollMargin) scrollMargins.push({ file, line: lineNo, selector, value: scrollMargin[1].trim(), px: toPx(scrollMargin[1].trim()) });
    if (/focus-visible|:focus\b/.test(selector) && trimmed.includes("outline")) {
      focusRules.push({ file, line: lineNo, selector, declaration: trimmed });
    }
    if (/prefers-reduced-motion/.test(mediaStack.map((m) => m.query).join(" "))) {
      motionRules.push({ file, line: lineNo, media: mediaStack[mediaStack.length - 1].query, selector, declaration: trimmed });
    }
    if (/prefers-contrast/.test(mediaStack.map((m) => m.query).join(" "))) {
      contrastRules.push({ file, line: lineNo, media: mediaStack[mediaStack.length - 1].query, selector, declaration: trimmed });
    }
  });
}

// 断点重复：同名 max-width 出现多次
const breakpointCounts = {};
for (const mq of mediaQueries) {
  const key = mq.query.replace(/\s+/g, " ");
  breakpointCounts[key] = breakpointCounts[key] || [];
  breakpointCounts[key].push({ file: mq.file, line: mq.line });
}
const duplicateBreakpoints = Object.entries(breakpointCounts)
  .filter(([, list]) => list.length > 1)
  .map(([query, list]) => ({ query, occurrences: list, count: list.length }));

// 基线 token 对比度（静态）
const tokensLight = {
  paper: "#F7F6F2",
  paperStrong: "#FFFFFF",
  ink: "#1C2E2C",
  inkSoft: "#53645E",
  teal: "#27685D",
  tealPale: "#E7F0EB",
  muted: "#617268",
  amber: "#8A5700",
  rule: "#D9E1DB",
  ruleStrong: "#718278",
  brick: "#A9343C",
};
const tokensDark = {
  paper: "#151E1C",
  paperStrong: "#1D2926",
  ink: "#E8EEE9",
  inkSoft: "#B3C4BB",
  teal: "#91C6B5",
  tealPale: "#263F35",
  muted: "#A0B3A8",
  amber: "#F2C77D",
  rule: "#3B4D44",
  ruleStrong: "#859B8D",
  brick: "#FFB4B8",
};
const contrastPairs = [
  ["ink", "paper"],
  ["ink", "paperStrong"],
  ["inkSoft", "paper"],
  ["inkSoft", "paperStrong"],
  ["muted", "paper"],
  ["muted", "paperStrong"],
  ["teal", "paper"],
  ["teal", "tealPale"],
  ["amber", "paperStrong"],
  ["inkSoft", "tealPale"],
  ["ruleStrong", "paper"],
];
const tokenContrast = {
  light: Object.fromEntries(contrastPairs.map(([fg, bg]) => [`${fg}/${bg}`, contrast(tokensLight[fg], tokensLight[bg])])),
  dark: Object.fromEntries(contrastPairs.map(([fg, bg]) => [`${fg}/${bg}`, contrast(tokensDark[fg], tokensDark[bg])])),
};

// 关键说明元素 → 基线声明（selector 精确匹配，人工核对后的清单）
const KEY_TEXT_DECLARATIONS = [
  ["heroNote", "app/home.module.css", ".heroNote"],
  ["heroFigcaption", "app/home.module.css", ".heroProduct figcaption"],
  ["imageToolbar", "app/home.module.css", ".imageToolbar"],
  ["sectionHeadingIntro", "app/home.module.css", ".sectionHeading > p"],
  ["projectIdentityDemo", "app/home.module.css", ".projectIdentity > div > span"],
  ["resetButton", "app/home.module.css", ".resetButton"],
  ["tabLabel", "app/home.module.css", ".storyTabs > button"],
  ["contextLabel", "app/home.module.css", ".contextLabel"],
  ["contextPositionSuffix", "app/home.module.css", ".contextPosition > span"],
  ["paneHeadingMeta", "app/home.module.css", ".paneHeading > span"],
  ["sourceButton", "app/home.module.css", ".sourceButton"],
  ["sourceButtonHint", "app/home.module.css", ".sourceButton > span"],
  ["factMark", "app/home.module.css", ".factMark"],
  ["badges", "app/home.module.css", ".waitingBadge, .exampleBadge, .confirmedBadge"],
  ["suggestionBody", "app/home.module.css", ".suggestion > p"],
  ["evidenceSummary", "app/home.module.css", ".evidenceDetails summary"],
  ["evidenceBody", "app/home.module.css", ".evidenceDetails > div > p"],
  ["detailNote", "app/home.module.css", ".detailNote"],
  ["proposalFields", "app/home.module.css", ".proposalFields > div"],
  ["receiptHelp", "app/home.module.css", ".receiptPane form > p"],
  ["savedReceiptNote", "app/home.module.css", ".savedReceipt > p:not(.receiptSavedTitle)"],
  ["storyNotice", "app/home.module.css", ".storyNotice"],
  ["storyFooterBoundary", "app/home.module.css", ".storyFooter > p"],
  ["dialogHeaderMeta", "app/home.module.css", ".dialogHeader > p"],
  ["dialogProvenance", "app/home.module.css", ".dialogProvenance"],
  ["conditionsSummary", "app/home.module.css", ".conditions summary"],
  ["conditionsBody", "app/home.module.css", ".conditions > p"],
  ["previewLabel", "app/home.module.css", ".previewLabel"],
  ["previewDescription", "app/home.module.css", ".previewDescription"],
  ["executionListDetail", "app/home.module.css", ".executionList > li > div > span"],
  ["previewFootnote", "app/home.module.css", ".previewFootnote"],
  ["boundaryNote", "app/home.module.css", ".boundaryNote p"],
  ["footer", "app/home.module.css", ".footer"],
  ["sectionLabel", "app/home.module.css", ".sectionLabel"],
  ["homeNav", "app/home.module.css", ".homeNav"],
  ["homeHeaderCta", "app/home.module.css", ".homeHeader .headerCta"],
  ["mobileHeroNote", "app/home.module.css", ".heroNote"],
  ["mobileTabLabel", "app/home.module.css", ".storyTabs > button"],
  ["mobileStoryFooter", "app/home.module.css", ".storyFooter > p"],
  ["mobileFooter", "app/home.module.css", ".footer"],
  ["mobileProjectIdentity", "app/home.module.css", ".projectIdentity > div > span"],
  ["mobileResetButton", "app/home.module.css", ".resetButton"],
  ["accountCtaMobile", "app/home.module.css", ".homeNav .headerCta"],
  ["bodyBase", "app/globals.css", "body"],
];
const keyTextDeclarations = KEY_TEXT_DECLARATIONS.map(([key, file, selector]) => {
  const matches = cssDeclarations.filter((d) => d.file === file && d.selector === selector);
  return { key, file, selector, declarations: matches.map((m) => ({ line: m.line, value: m.value, px: m.px, media: m.media })) };
});

// 触控目标相关声明（min-height / height / width）
const targetDeclarations = [];
for (const file of FILES) {
  if (!file.endsWith(".css")) continue;
  const lines = read(file);
  let selector = "(root)";
  let media = null;
  const mediaStack = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const mediaMatch = trimmed.match(/^@media\s*(.*?)\s*\{$/);
    if (mediaMatch) {
      mediaStack.push(mediaMatch[1]);
      media = mediaMatch[1];
      return;
    }
    if (/^\}\s*$/.test(trimmed) && !line.startsWith(" ") && !line.startsWith("\t") && mediaStack.length) {
      mediaStack.pop();
      media = mediaStack.length ? mediaStack[mediaStack.length - 1] : null;
      return;
    }
    if (trimmed.endsWith("{") && !trimmed.startsWith("@")) {
      selector = trimmed.slice(0, -1).trim();
      return;
    }
    const m = trimmed.match(/^(min-height|height|width|min-width):\s*([^;]+);/);
    if (m && /button|summary|\.primary|\.secondary|\.homeNav|\.headerCta|\.storyTabs|\.sourceButton|\.resetButton|\.storyFooter|\.dialogHeader/.test(selector)) {
      targetDeclarations.push({ file, line: index + 1, selector, property: m[1], value: m[2].trim(), px: toPx(m[2].trim()), media });
    }
  });
}

// JSX/TSX 交互资产行号（关键字搜索）
const tsxFindings = [];
const patterns = [
  ["homeJourney.tablist", "components/HomeJourney.tsx", /role="tablist"/],
  ["homeJourney.tab", "components/HomeJourney.tsx", /role="tab"/],
  ["homeJourney.ariaSelected", "components/HomeJourney.tsx", /aria-selected=/],
  ["homeJourney.tabIndex", "components/HomeJourney.tsx", /tabIndex=/],
  ["homeJourney.tabKeydown", "components/HomeJourney.tsx", /onKeyDown=/],
  ["homeJourney.tabpanel", "components/HomeJourney.tsx", /role="tabpanel"/],
  ["homeJourney.dialog", "components/HomeJourney.tsx", /<dialog/],
  ["homeJourney.dialogLabelledby", "components/HomeJourney.tsx", /aria-labelledby="source-title"/],
  ["homeJourney.dialogCancel", "components/HomeJourney.tsx", /onCancel=/],
  ["homeJourney.dialogBackdrop", "components/HomeJourney.tsx", /event\.target === event\.currentTarget/],
  ["homeJourney.showModal", "components/HomeJourney.tsx", /showModal\(\)/],
  ["homeJourney.dialogClose", "components/HomeJourney.tsx", /element\.close\(\)/],
  ["homeJourney.status", "components/HomeJourney.tsx", /role="status"/],
  ["homeJourney.sourceButtonLabel", "components/HomeJourney.tsx", /aria-label=\{"查看原文："/],
  ["homeJourney.storyFrameAriaLabel", "components/HomeJourney.tsx", /styles\.storyFrame\} aria-label/],
  ["homeJourney.prevNext", "components/HomeJourney.tsx", /aria-label="上一步"|aria-label="下一步"/],
  ["homeJourney.textareaHelp", "components/HomeJourney.tsx", /aria-describedby="receipt-help"/],
  ["page.mainHome", "app/page.tsx", /<main id="main-content" className=\{styles\.home\}>/],
  ["page.heroCta", "app/page.tsx", /href="#experience"/],
  ["page.heroFigure", "app/page.tsx", /styles\.heroProduct/],
  ["page.heroImgAlt", "app/page.tsx", /alt="忆程实际工作区/],
  ["page.heroMobileSource", "app/page.tsx", /workspace-mobile\.jpg/],
  ["page.figcaption", "app/page.tsx", /<figcaption>/],
  ["page.experienceSection", "app/page.tsx", /id="experience"/],
  ["page.conditions", "app/page.tsx", /<details className=\{styles\.conditions\}>/],
  ["page.missionPreviewLabel", "app/page.tsx", /aria-label="长期委托等待补充材料的界面示例"/],
  ["page.executionGlyphs", "app/page.tsx", /completedNode|currentNode|pendingNode/],
  ["page.footerTopLink", "app/page.tsx", /回到顶部/],
  ["siteHeader.accountPages", "components/SiteHeader.tsx", /"\/login",/],
  ["siteHeader.returnChildren", "components/SiteHeader.tsx", /return children;/],
  ["siteHeader.homeHeaderClass", "components/SiteHeader.tsx", /styles\.homeHeader/],
  ["siteHeader.navLabel", "components/SiteHeader.tsx", /aria-label="首页导航"/],
  ["siteHeader.accountCta", "components/SiteHeader.tsx", /返回官网/],
  ["siteHeader.registrationFlag", "components/SiteHeader.tsx", /registrationEnabled/],
  ["layout.skipLink", "app/layout.tsx", /skip-link/],
  ["layout.themeProvider", "app/layout.tsx", /defaultTheme="light"/],
  ["layout.htmlLang", "app/layout.tsx", /lang="zh-CN"/],
  ["globals.skipLinkCss", "app/globals.css", /\.skip-link/],
  ["globals.focusRing", "app/globals.css", /\.focus-ring:focus-visible/],
  ["globals.reducedMotion", "app/globals.css", /prefers-reduced-motion/],
  ["stateDiffView.smallText", "components/StateDiffView.tsx", /text-xs|text-\[11px\]/],
];
for (const [key, file, re] of patterns) {
  const lines = read(file);
  const hits = [];
  lines.forEach((line, index) => {
    if (re.test(line)) hits.push({ line: index + 1, code: line.trim().slice(0, 160) });
  });
  tsxFindings.push({ key, file, hits });
}

const inventory = {
  meta: {
    source: "git show 485d485378637e1da3280ed092739d441c8cf749:<file>",
    baselineSha: "485d485378637e1da3280ed092739d441c8cf749",
    extractedTo: "audit/a11y/baseline-src/",
    note: "工作树在 2026-11-03 11:51 后已被 B2 修改；本清点只读 git 固定 SHA 提取副本，不读当前工作树实现。",
    remBasePx: REM,
    generatedAt: new Date().toISOString(),
  },
  files: FILES.map((file) => ({ file, lines: read(file).length, gitBlob: "见 MANIFEST" })),
  smallFontDeclarations: cssDeclarations.filter((d) => d.px !== null && d.px < 12.8),
  allFontDeclarations: cssDeclarations,
  duplicateBreakpoints,
  mediaQueries,
  focusRules,
  motionRules,
  contrastRules,
  scrollMargins,
  targetDeclarations,
  tokenContrast,
  keyTextDeclarations,
  tsxFindings,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(inventory, null, 2), "utf8");

console.log("WROTE", OUT);
console.log("smallFontDeclarations:", inventory.smallFontDeclarations.length);
console.log("duplicateBreakpoints:", duplicateBreakpoints.map((d) => d.query + "x" + d.count).join(", "));
console.log("mediaQueries:", mediaQueries.length);
console.log("focusRules:", focusRules.length, "motionRules:", motionRules.length, "contrastRules:", contrastRules.length);
console.log("scrollMargins:", scrollMargins.map((s) => s.selector + "=" + s.value).join(", "));
console.log("targetDeclarations:", targetDeclarations.length);
console.log("tokenContrast light muted/paper:", tokenContrast.light["muted/paper"], "dark muted/paper:", tokenContrast.dark["muted/paper"]);
