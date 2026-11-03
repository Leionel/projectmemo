/**
 * Phase 2 定向补拍（最终候选 9bae926）：五步 Demo 第 3 步「查看判断」字号取证。
 * 该提交仅新增 .judgmentPane 作用域字号覆盖（共享 StateDiffView 的 text-xs/text-[11px] → 12.8px）
 * 与 role="group" 属性，不改变其余已采状态。
 *
 * 输出：b3/states/judgment-step-1440-light.png
 *       b3/metrics/judgment-step-1440-light.json
 *       b3/network-judgment.json
 */
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BASE,
  EV,
  SOURCE_SHA,
  captureState,
  createNet,
  launchBrowser,
  loadHome,
  newContext,
  nowIso,
  rel,
  settlePage,
  summarizeNet,
  writeJson,
} from "./phase2-lib.mjs";

const B3 = path.join(EV, "b3");
const STATES = path.join(B3, "states");
const METRICS = path.join(B3, "metrics");

const browser = await launchBrowser();
const context = await newContext(browser);
const page = await context.newPage();
page.setDefaultTimeout(90_000);
page.setDefaultNavigationTimeout(120_000);
const net = createNet();
net.attach(page);

await loadHome(page, { theme: "light", width: 1440, height: 900, net, label: "judgment" });
await page.locator("#experience").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.getByRole("tab", { name: "查看判断" }).click();
await page.waitForFunction(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.id === "story-tab-2");
  return tab?.getAttribute("aria-selected") === "true";
});
await settlePage(page, { minWaitMs: 500 });
await page.waitForTimeout(200);

const judgmentFonts = await page.evaluate(() => {
  const pane = document.querySelector('[class*="judgmentPane"]');
  if (!pane) return null;
  const cs = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
      fontSize: s.fontSize,
      fontSizePx: +parseFloat(s.fontSize).toFixed(2),
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      color: s.color,
      width: +r.width.toFixed(1),
      height: +r.height.toFixed(1),
      className: typeof el.className === "string" ? el.className.slice(0, 160) : "",
    };
  };
  const findText = (selector, pattern) => [...pane.querySelectorAll(selector)].find((el) => pattern.test(el.innerText || ""));
  const baseline = findText("p", /比较基线/);
  const pending = [...pane.querySelectorAll("span")].find((el) => (el.innerText || "").trim() === "待确认");
  const evidenceCount = [...pane.querySelectorAll("span")].find((el) => /^依据\s*\d+\s*项$/.test((el.innerText || "").trim()));
  const summary = pane.querySelector("li p.font-semibold, li p[class*='font-semibold']");
  const evidenceChips = [...pane.querySelectorAll("span")].filter((el) => /(记忆|行动|交付物|附件)\s*·/.test(el.innerText || ""));
  // 可见文字最小字号
  const small = [];
  for (const el of pane.querySelectorAll("*")) {
    if (el.closest("svg")) continue;
    const hasDirect = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasDirect) continue;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    small.push({ fontSizePx: +parseFloat(s.fontSize).toFixed(2), text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) });
  }
  small.sort((a, b) => a.fontSizePx - b.fontSizePx);
  return {
    paneBBox: (() => {
      const r = pane.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
    })(),
    baseline: baseline ? cs(baseline) : null,
    pending: pending ? cs(pending) : null,
    evidenceCount: evidenceCount ? cs(evidenceCount) : null,
    summary: summary ? cs(summary) : null,
    evidenceChips: evidenceChips.map(cs),
    minVisibleFontSizePx: small.length ? small[0].fontSizePx : null,
    smallestTexts: small.slice(0, 8),
  };
});

const lensRole = await page.evaluate(() => {
  const lens = document.querySelector("[data-hero-lens]");
  const hero = document.querySelector("[data-hero]");
  return {
    heroLensRole: lens?.getAttribute("role") ?? null,
    heroLensAriaLabel: lens?.getAttribute("aria-label") ?? null,
    heroSectionRole: hero?.getAttribute("role") ?? null,
    lensGroupCount: document.querySelectorAll('[data-hero-lens][role="group"]').length,
  };
});

const shot = await captureState(page, {
  dir: STATES,
  metricsDir: METRICS,
  name: "judgment-step-1440-light.png",
  metricsName: "judgment-step-1440-light.json",
  label: "judgment-step-1440-light",
  net,
  extra: {
    state: "judgment-step-1440-light",
    candidateSha: SOURCE_SHA,
    note: "点击五步第 3 步「查看判断」；该状态用于验证 9bae926 的 .judgmentPane 作用域字号覆盖（共享 StateDiffView 的 11–12px 元数据 → 12.8px）。",
    selectedStoryTab: await page.evaluate(
      () =>
        [...document.querySelectorAll('[role="tab"][id^="story-tab-"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ??
        null,
    ),
    judgmentFonts,
    lensRole,
    assertions: {
      baselineFontSize: judgmentFonts?.baseline?.fontSizePx ?? null,
      pendingFontSize: judgmentFonts?.pending?.fontSizePx ?? null,
      evidenceCountFontSize: judgmentFonts?.evidenceCount?.fontSizePx ?? null,
      summaryFontSize: judgmentFonts?.summary?.fontSizePx ?? null,
      allKeyTextsAtLeast12_8: [judgmentFonts?.baseline, judgmentFonts?.pending, judgmentFonts?.evidenceCount, judgmentFonts?.summary]
        .filter(Boolean)
        .every((x) => x.fontSizePx >= 12.8),
      paneMinVisibleFontSizePx: judgmentFonts?.minVisibleFontSizePx ?? null,
      heroLensRoleGroup: lensRole.heroLensRole === "group",
    },
  },
});
await settlePage(page, { minWaitMs: 100 });
const netSummary = summarizeNet(net);
await writeJson(path.join(B3, "network-judgment.json"), {
  phase: 2,
  kind: "network-audit-judgment",
  capturedAt: nowIso(),
  sourceSha: SOURCE_SHA,
  baseURL: BASE,
  ...netSummary,
});

await context.close();
await browser.close();

const buf = await stat(path.join(STATES, "judgment-step-1440-light.png"));
console.log(
  JSON.stringify(
    {
      file: shot.file,
      fileBytes: buf.size,
      candidateSha: SOURCE_SHA,
      selectedStoryTab: shot.metrics ? undefined : undefined,
      judgmentAssertions: {
        baseline: judgmentFonts?.baseline,
        pending: judgmentFonts?.pending,
        evidenceCount: judgmentFonts?.evidenceCount,
        summary: judgmentFonts?.summary,
        minVisibleFontSizePx: judgmentFonts?.minVisibleFontSizePx,
        smallestTexts: judgmentFonts?.smallestTexts,
      },
      lensRole,
      network: netSummary.totals,
      netAssertions: netSummary.assertions,
    },
    null,
    2,
  ),
);
