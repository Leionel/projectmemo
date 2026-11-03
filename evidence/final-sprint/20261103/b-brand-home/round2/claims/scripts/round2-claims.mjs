// Phase 1 claims / boundary / accessibility / motion audit — B2 candidate, anonymous.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");
const jsonDir = path.join(auditDir, "json");
const logDir = path.join(auditDir, "logs");
const shotDir = path.join(auditDir, "shots");
for (const d of [jsonDir, logDir, shotDir]) fs.mkdirSync(d, { recursive: true });

const DEMO_URL = "https://www.bilibili.com/video/BV1Qaxb6PE7G?vd_source=eaf1b5590706fdf5d967f5f1d697db8b";
const browser = await chromium.launch();
const checks = [];
function check(id, pass, detail) {
  checks.push({ id, pass: Boolean(pass), detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${id}: ${JSON.stringify(detail).slice(0, 320)}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
const consoleMsgs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleMsgs.push({ type: m.type(), text: m.text() }); });
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.fonts.ready);

const snapshot = await page.evaluate(() => {
  const main = document.querySelector("main");
  const imgs = Array.from(document.querySelectorAll("img")).map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight }));
  const anchors = Array.from(document.querySelectorAll("a")).map((a) => ({ text: (a.textContent || "").trim().replace(/\s+/g, " "), href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), ariaLabel: a.getAttribute("aria-label") }));
  const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((h) => ({ tag: h.tagName, id: h.id, text: (h.textContent || "").trim().replace(/\s+/g, " ") }));
  return {
    lang: document.documentElement.lang,
    title: document.title,
    mainText: main ? main.innerText : "",
    imgs,
    iframes: document.querySelectorAll("iframe").length,
    media: document.querySelectorAll("video, audio").length,
    autoplay: document.querySelectorAll("[autoplay]").length,
    anchors,
    headings,
    boundaryTexts: Array.from(document.querySelectorAll("main p, main span, main footer")).map((el) => (el.textContent || "").trim().replace(/\s+/g, " ")).filter((t) => /公开示例|不调用模型|冻结示例|不写入你的项目|模拟|示例素材/.test(t)).slice(0, 40),
  };
});
fs.writeFileSync(path.join(logDir, "claims-text-1440.txt"), snapshot.mainText, "utf8");
fs.writeFileSync(path.join(logDir, "claims-dom-1440.json"), JSON.stringify(snapshot, null, 2), "utf8");
const mainText = snapshot.mainText;

// C-01..C-09 boundary / identity / material consistency
check("C-01-hero-boundary-note", /公开示例/.test(mainText) && /不调用模型/.test(mainText) && /不写入你的项目/.test(mainText), {
  heroNote: snapshot.boundaryTexts.find((t) => /不写入你的项目/.test(t)) ?? null,
});
check("C-02-hero-lens-kicker", /公开示例/.test(mainText) && /忆程参赛作品开发/.test(mainText), {
  occurrences: mainText.split("忆程参赛作品开发").length - 1,
});
check("C-03-lens-foot-boundary", /冻结示例/.test(mainText) && /与下方五步示例使用同一份素材/.test(mainText), {
  foot: snapshot.boundaryTexts.find((t) => /与下方五步示例使用同一份素材/.test(t)) ?? null,
});
check("C-04-demo-boundary-deferred", true, { note: "authoritative check C-04b after demo step-5 interaction" });
check("C-05-identity-same-project", mainText.split("忆程参赛作品开发").length >= 3, {
  occurrences: mainText.split("忆程参赛作品开发").length - 1,
});
check("C-06-identity-same-mission", mainText.includes("整理阶段汇报"), {
  occurrences: mainText.split("整理阶段汇报").length - 1,
});
check("C-07-same-sources", ["比赛材料", "任务安排", "老师建议"].every((t) => mainText.includes(t)), {
  found: ["比赛材料", "任务安排", "老师建议"].filter((t) => mainText.includes(t)),
});
check("C-08-same-gap", /演示流程/.test(mainText), {
  occurrences: mainText.split("演示流程").length - 1,
});
check("C-09-old-hero-images-absent", !/workspace-desktop|workspace-mobile/.test(JSON.stringify(snapshot.imgs)), { imgs: snapshot.imgs });
check("C-10-no-iframe-media-autoplay", snapshot.iframes === 0 && snapshot.media === 0 && snapshot.autoplay === 0, {
  iframes: snapshot.iframes, media: snapshot.media, autoplay: snapshot.autoplay,
});

const videoLinks = snapshot.anchors.filter((a) => (a.href || "").includes("bilibili.com"));
check("C-11a-video-link-attributes", videoLinks.length === 2 && videoLinks.every((a) => a.href === DEMO_URL && a.target === "_blank" && /noopener/.test(a.rel || "") && /noreferrer/.test(a.rel || "")), { videoLinks });
check("C-11b-main-video-cue", videoLinks.some((a) => /Bilibili/.test(a.text)), {
  mainText: videoLinks.find((a) => /Bilibili/.test(a.text))?.text ?? null,
  note: "【f06685d】链接文案『在 Bilibili 打开（新窗口）』+ aria-label 含新窗口，可感知外部站与新窗口。",
});
const footerVideoLink = videoLinks.find((a) => !/Bilibili/.test(a.text));
check("C-11c-footer-video-cue", (!footerVideoLink) || /Bilibili|新窗口|外部/.test(footerVideoLink.text) || /Bilibili|新窗口|外部/.test(footerVideoLink.ariaLabel || ""), {
  footerText: footerVideoLink?.text ?? null, footerAria: footerVideoLink?.ariaLabel ?? null,
});
// C-43: external link should let users perceive "external site / new window" (WARN if only one of the two)
const mainVideoLink = videoLinks.find((a) => /Bilibili/.test(a.text));
const mainCueText = `${mainVideoLink?.text ?? ""} ${mainVideoLink?.ariaLabel ?? ""}`;
check("C-43-main-video-external-window-cue", /Bilibili/.test(mainCueText) && /新窗口/.test(mainCueText), {
  cue: mainCueText, externalSiteCue: /Bilibili/.test(mainCueText), newWindowCue: /新窗口/.test(mainCueText),
});

const videoSection = await page.locator("#demo").innerText().catch(() => "");
check("C-14-video-copy-no-metrics", !/(播放量|播放次数|点赞|收藏|弹幕|观看数|时长|万次)/.test(videoSection + mainText), { videoSection });
check("C-15-video-copy-scope", /2026 C4-AI 决赛演示视频/.test(videoSection) && /Bilibili/.test(videoSection), { videoSection });

const realtimeHits = [];
for (const pattern of [/正在执行/g, /正在检查/g, /实时/g, /刚刚/g, /Worker/g, /自动接续/g]) {
  let m;
  const re = new RegExp(pattern.source, "g");
  while ((m = re.exec(mainText)) !== null) {
    realtimeHits.push({ pattern: pattern.source, context: mainText.slice(Math.max(0, m.index - 45), m.index + 55).replace(/\s+/g, " ") });
  }
}
check("C-16-fake-realtime-only-negated", realtimeHits.every((h) => /不|冻结|示例|需要|默认|才|范围|条件|实际/.test(h.context)), realtimeHits.slice(0, 12));

const numericHits = [];
for (const pattern of [/成功率/g, /节省/g, /\d+(?:\.\d+)?%/g, /效率/g, /用户评价/g, /好评/g, /下载量/g, /用户数/g]) {
  const re = new RegExp(pattern.source, "g");
  let m;
  while ((m = re.exec(mainText)) !== null) numericHits.push({ pattern: pattern.source, context: mainText.slice(Math.max(0, m.index - 30), m.index + 45).replace(/\s+/g, " ") });
}
check("C-17-no-fake-numbers", numericHits.length === 0, numericHits);

const slop = ["重新定义", "赋能", "无限可能", "未来已来", "一站式", "One platform", "AI 加持", "颠覆", "重塑行业", "改变世界"];
const slopHits = slop.filter((w) => mainText.toLowerCase().includes(w.toLowerCase()));
check("C-18-anti-slop", slopHits.length === 0, { slopHits });

check("C-19-no-fake-timestamps", !/(更新于|观察于|采集于|今日已|刚刚检查|截至今日)/.test(mainText), {
  hits: ["更新于", "观察于", "采集于", "今日已", "刚刚检查", "截至今日"].filter((t) => mainText.includes(t)),
});

const aria = await page.evaluate(() => {
  const heroTabs = Array.from(document.querySelectorAll("#home-heading [role=tab]")).map((t) => ({ text: (t.textContent || "").trim(), selected: t.getAttribute("aria-selected") }));
  const demoTabs = Array.from(document.querySelectorAll("#experience [role=tab]")).map((t) => ({ text: (t.textContent || "").trim(), selected: t.getAttribute("aria-selected") }));
  return {
    heroTabs, demoTabs,
    heroPanels: document.querySelectorAll("#home-heading [role=tabpanel]").length,
    demoPanels: document.querySelectorAll("#experience [role=tabpanel]").length,
    heroTablist: document.querySelectorAll("#home-heading [role=tablist]").length,
    demoTablist: document.querySelectorAll("#experience [role=tablist]").length,
  };
});
check("C-20-aria-tabs", aria.heroTabs.length === 3 && aria.heroTabs.filter((t) => t.selected === "true").length === 1 && aria.heroPanels === 1 && aria.demoTabs.length === 5 && aria.demoTabs.filter((t) => t.selected === "true").length === 1 && aria.demoPanels === 1 && aria.heroTablist === 1 && aria.demoTablist === 1, aria);

const hrefs = snapshot.anchors.map((a) => a.href);
check("C-21-anchor-targets", ["#experience", "#missions", "#moments", "#demo"].every((h) => hrefs.includes(h)) && hrefs.includes("/login?from=%2Ffocus") && hrefs.includes("/focus"), {
  experience: hrefs.filter((h) => h === "#experience").length,
  hasMissions: hrefs.includes("#missions"), hasMoments: hrefs.includes("#moments"), hasDemo: hrefs.includes("#demo"),
  login: hrefs.filter((h) => h === "/login?from=%2Ffocus").length, focus: hrefs.filter((h) => h === "/focus").length,
});

async function keyboardCheck() {
  await page.locator("#home-heading [role=tab]").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const afterRight = (await page.locator('#home-heading [role=tab][aria-selected="true"]').innerText()).replace(/\s+/g, " ");
  await page.keyboard.press("End");
  await page.waitForTimeout(250);
  const afterEnd = (await page.locator('#home-heading [role=tab][aria-selected="true"]').innerText()).replace(/\s+/g, " ");
  await page.locator("#experience [role=tab]").first().focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(250);
  const demoAfterEnd = (await page.locator('#experience [role=tab][aria-selected="true"]').innerText()).replace(/\s+/g, " ");
  return { afterRight, afterEnd, demoAfterEnd };
}
const kb = await keyboardCheck().catch((e) => ({ error: String(e && e.message ? e.message : e) }));
check("C-22-keyboard-tabs", /期间/.test(kb.afterRight || "") && /回来后/.test(kb.afterEnd || "") && /填写回执/.test(kb.demoAfterEnd || ""), kb);

// C-20b: new per-stage status labels must describe the frozen example stage only (no live/execution claim)
const stageStatuses = [];
for (const index of [0, 1, 2]) {
  await page.locator("#home-heading [role=tab]").nth(index).click();
  await page.waitForTimeout(350);
  const status = (await page.locator("#home-heading [class*=lensStatus]").first().innerText()).replace(/\s+/g, " ");
  const panel = await page.locator('#home-heading [role="tabpanel"]').innerText();
  stageStatuses.push({ index, status, hasFrozenNote: /冻结示例|不调用模型/.test(panel) || /冻结示例/.test(await page.locator("#home-heading [class*=lensFoot]").first().innerText()), panelSnippet: panel.slice(0, 200) });
}
const expectedStatuses = ["无需操作", "核对示例", "等你确认"];
check("C-20b-hero-stage-status-labels", stageStatuses.length === 3 && stageStatuses.every((s, i) => s.status.includes(expectedStatuses[i])) && stageStatuses.every((s) => !/正在|实时|在线|执行中|后台/.test(s.status)), { stageStatuses, expectedStatuses });

await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(900);
await page.getByRole("button", { name: /查看依据/ }).first().click();
await page.waitForTimeout(400);
const heroEvidence = await page.locator("#hero-evidence").innerText();
check("C-23-hero-evidence-sources", ["初赛需要准备创意描述", "目前还没有完整 Demo", "老师建议作品不要叫普通学习助手"].every((t) => heroEvidence.includes(t)), { heroEvidence: heroEvidence.slice(0, 500) });
await page.getByRole("button", { name: /收起依据/ }).click();

await page.locator("#experience [role=tab]").nth(0).click();
await page.waitForTimeout(300);
const step1 = await page.locator("#experience [role=tabpanel]").innerText();
check("C-24-demo-step1-sources", ["初赛需要准备创意描述", "目前还没有完整 Demo", "老师建议作品不要叫普通学习助手"].every((t) => step1.includes(t)), { step1: step1.slice(0, 400) });
check("C-25-demo-step1-label-consistency", !/参赛要求/.test(step1), {
  note: "'参赛要求' 与来源标题 '比赛材料' 不一致（minor）",
  line: step1.split("\n").find((l) => l.includes("参赛要求")) ?? null,
});

// demo gate + boundary labels (real interaction; labels only render on step 4/5)
await page.locator("#experience [role=tab]").nth(4).click();
await page.waitForTimeout(300);
const gatePanel = await page.locator("#experience [role=tabpanel]").innerText();
check("C-30-demo-receipt-gate", /先确认行动，再填写模拟回执/.test(gatePanel) && /不会把行动标为完成/.test(gatePanel), { gatePanel: gatePanel.slice(0, 300) });

await page.locator("#experience [role=tab]").nth(3).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /在示例中确认行动/ }).click();
await page.waitForTimeout(300);
const confirmPanel = await page.locator("#experience [role=tabpanel]").innerText();
check("C-31-demo-confirm-boundary", /本页示例已确认/.test(confirmPanel) && /没有创建真实待办/.test(await page.getByRole("status").first().innerText().catch(() => "")) || /本页示例已确认/.test(confirmPanel), { confirmPanel: confirmPanel.slice(0, 300) });

await page.locator("#experience [role=tab]").nth(4).click();
await page.waitForTimeout(300);
await page.getByRole("textbox", { name: /填写一段模拟完成结果/ }).fill("审计示例：假设已录入一条记录并生成草稿，来源还需要逐项核对。");
await page.getByRole("button", { name: /保存模拟回执/ }).click();
await page.waitForTimeout(500);
const step5Saved = await page.locator("#experience [role=tabpanel]").innerText();
const demoFooterNote = await page.locator("#experience [class*=storyFooter]").innerText().catch(() => "");
const noticeText = await page.getByRole("status").first().innerText().catch(() => "");
const demoLabels = ["模拟数据", "本页模拟操作", "未经过实际操作核验", "不会调用模型或修改个人项目", "模拟回执", "刷新页面后不会保留"];
check("C-04b-demo-boundary-labels-visible", ["模拟数据", "模拟回执", "未经过实际操作核验"].every((t) => step5Saved.includes(t)) && /不会调用模型或修改个人项目/.test(demoFooterNote) && /刷新页面后不会保留/.test(noticeText), {
  step5Saved: step5Saved.slice(0, 400), demoFooterNote, noticeText, demoLabels,
});
await page.screenshot({ path: path.join(shotDir, "phase1-demo-receipt-1440x900.png") }).catch(() => {});
await page.locator("#experience").screenshot({ path: path.join(shotDir, "phase1-demo-receipt-panel-1440x900.png") }).catch(() => {});
await page.getByRole("button", { name: /回到依据页查看/ }).click();
await page.waitForTimeout(400);
const backEvidence = await page.locator("#experience [role=tabpanel]").innerText();
check("C-32-receipt-reflected-in-evidence", /新增模拟回执/.test(backEvidence) && /审计示例/.test(backEvidence) && /真实完成情况仍需实际回执/.test(backEvidence), { backEvidence: backEvidence.slice(0, 400) });
await page.locator("#experience").screenshot({ path: path.join(shotDir, "phase1-demo-evidence-with-receipt-1440x900.png") }).catch(() => {});
await page.getByRole("button", { name: /重置示例/ }).click();
await page.waitForTimeout(400);
const resetNotice = await page.getByRole("status").first().innerText().catch(() => "");
check("C-33-reset-boundary", /示例已重置，未修改任何个人项目/.test(resetNotice), { resetNotice });

// C-34 no legacy hero figure / image caption remains in DOM
const legacy = await page.evaluate(() => ({ figure: document.querySelectorAll("main figure").length, figcaption: document.querySelectorAll("main figcaption").length, workspaceImgs: Array.from(document.querySelectorAll("img")).filter((i) => /workspace-/.test(i.src)).length }));
check("C-34-no-legacy-hero-image", legacy.figure === 0 && legacy.figcaption === 0 && legacy.workspaceImgs === 0, legacy);

// C-35 video section copy scope
check("C-35-video-intro-copy", /默认只显示本地画面/.test(videoSection) && /点击后在本页加载/.test(videoSection) && /Bilibili 官方播放器/.test(videoSection) && /也可以在新窗口打开/.test(videoSection), { videoSection });
check("C-42-video-on-demand-embed-static", snapshot.iframes === 0 && snapshot.media === 0 && snapshot.autoplay === 0 && /点击加载播放器/.test(videoSection) && /加载前不请求外部站点/.test(videoSection) && /公开视频 · Bilibili/.test(videoSection), {
  iframes: snapshot.iframes, media: snapshot.media, autoplay: snapshot.autoplay, videoSection: videoSection.slice(0, 400),
});
check("C-36-video-heading-scope", /看一遍决赛演示/.test(videoSection) && !/完整讲一遍/.test(videoSection), { videoSection: videoSection.slice(0, 200) });

// C-37 scroll-motion controller: decorative, no content hidden, no fake telemetry
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(1200);
const motionBefore = await page.evaluate(() => {
  const main = document.querySelector("main");
  const progress = document.querySelector("[data-scroll-progress]");
  return {
    dataMotion: main?.getAttribute("data-motion") ?? null,
    progressExists: Boolean(progress),
    progressAriaHidden: progress?.getAttribute("aria-hidden") ?? null,
    railProgress: (document.querySelector("[data-rail]")?.style.getPropertyValue("--rail-progress") || "").trim(),
    sectionsVisible: Array.from(document.querySelectorAll("main > section")).map((s) => {
      const cs = getComputedStyle(s);
      return { id: s.id || null, opacity: cs.opacity, display: cs.display, visibility: cs.visibility, height: Math.round(s.getBoundingClientRect().height) };
    }),
  };
});
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(700);
const motionAfter = await page.evaluate(() => {
  const progress = document.querySelector("[data-scroll-progress]");
  return {
    railProgress: (document.querySelector("[data-rail]")?.style.getPropertyValue("--rail-progress") || "").trim(),
    progressTransform: progress ? getComputedStyle(progress).transform : null,
    activeRailSteps: document.querySelectorAll("[data-rail-step][data-active]").length,
    progressAriaHidden: progress?.getAttribute("aria-hidden") ?? null,
  };
});
check("C-37-scroll-motion-decorative", motionBefore.dataMotion === "on" && motionBefore.progressExists && motionBefore.progressAriaHidden === "true" && motionBefore.sectionsVisible.every((s) => s.display !== "none" && s.visibility !== "hidden" && s.height > 0) && motionAfter.activeRailSteps > 0, { motionBefore, motionAfter });
await page.evaluate(() => window.scrollTo(0, 0));

const reduceCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", reducedMotion: "reduce" });
const reducePage = await reduceCtx.newPage();
await reducePage.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await reducePage.waitForTimeout(900);
const reduced = await reducePage.evaluate(() => {
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { animationName: cs.animationName, animationDuration: cs.animationDuration, transitionDuration: cs.transitionDuration };
  };
  const main = document.querySelector("main");
  const railSteps = Array.from(document.querySelectorAll("[data-rail-step]"));
  return {
    dataMotion: main?.getAttribute("data-motion") ?? null,
    lensRows: probe("[class*=lensRows]"),
    heroCopy: probe("[class*=heroCopy]"),
    lens: probe("[class*=lensKicker]"),
    railStepCount: railSteps.length,
    railStepsVisible: railSteps.every((s) => getComputedStyle(s).display !== "none" && s.getBoundingClientRect().height > 0),
    heroNoteVisible: (() => { const el = Array.from(document.querySelectorAll("main p")).find((p) => /不写入你的项目/.test(p.textContent || "")); if (!el) return false; const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })(),
  };
});
await reducePage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await reducePage.waitForTimeout(400);
const reduceAfterScroll = await reducePage.evaluate(() => ({
  progressTransform: document.querySelector("[data-scroll-progress]") ? getComputedStyle(document.querySelector("[data-scroll-progress]")).transform : null,
  activeRailSteps: document.querySelectorAll("[data-rail-step][data-active]").length,
}));
await reducePage.evaluate(() => window.scrollTo(0, 0));
await reducePage.locator("#home-heading [role=tab]").nth(0).click();
await reducePage.waitForTimeout(300);
const reducePanel = await reducePage.locator('#home-heading [role="tabpanel"]').innerText();
const reduceSelected = await reducePage.locator('#home-heading [role=tab][aria-selected="true"]').innerText();
check("C-26-reduced-motion", reduced.dataMotion === "reduced" && reduced.lensRows !== null && reduced.lensRows.animationName === "none" && reduced.railStepsVisible && reduced.heroNoteVisible && /离开时/.test(reduceSelected) && reducePanel.length > 50 && reduceAfterScroll.activeRailSteps === 0, { reduced, reduceAfterScroll, selected: reduceSelected.replace(/\s+/g, " "), panelSnippet: reducePanel.slice(0, 160) });
await reducePage.screenshot({ path: path.join(shotDir, "phase1-reduced-motion-1440x900.png"), fullPage: false });

// C-41: reduced-motion hot switch (no reload) must enable/disable motion without losing content.
// Use a fresh context WITHOUT a preset preference, then toggle the OS preference like a real user;
// a context created with reducedMotion:"reduce" preset can keep a stale emulation on the reverse toggle.
const hotCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const hotPage = await hotCtx.newPage();
await hotPage.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await hotPage.waitForTimeout(1800);
const hotState = () => hotPage.evaluate(() => ({
  dataMotion: document.querySelector("main")?.getAttribute("data-motion") ?? null,
  matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
  activeRailSteps: document.querySelectorAll("[data-rail-step][data-active]").length,
  heroTranslate: getComputedStyle(document.querySelector("[data-hero-copy]")).translate,
  contentStillVisible: (() => { const el = Array.from(document.querySelectorAll("main p")).find((p) => /不写入你的项目/.test(p.textContent || "")); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0; })(),
}));
await hotPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
await hotPage.waitForTimeout(600);
const hotStart = await hotState();
await hotPage.emulateMedia({ reducedMotion: "reduce" });
await hotPage.waitForTimeout(1500);
const hotReduced = await hotState();
await hotPage.emulateMedia({ reducedMotion: "no-preference" });
await hotPage.waitForTimeout(1500);
await hotPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.55));
await hotPage.waitForTimeout(800);
const hotRestored = await hotState();
await hotCtx.close();
check("C-41-reduced-motion-hot-switch", hotStart.dataMotion === "on" && hotStart.activeRailSteps > 0 && hotReduced.dataMotion === "reduced" && hotReduced.activeRailSteps === 0 && hotReduced.heroTranslate === "none" && hotRestored.dataMotion === "on" && hotRestored.contentStillVisible, { hotStart, hotReduced, hotRestored });
await reduceCtx.close();

// C-38 no-JS fallback: server-rendered HTML keeps facts readable
const noJsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", javaScriptEnabled: false });
const noJsPage = await noJsCtx.newPage();
const noJsRes = await noJsPage.goto(BASE + "/", { waitUntil: "load", timeout: 90000 }).catch(() => null);
await noJsPage.waitForTimeout(500);
const noJsHtml = await noJsPage.content();
const noJs = {
  status: noJsRes?.status() ?? null,
  hasH1: noJsHtml.includes("人可以下线") && noJsHtml.includes("项目别掉线"),
  hasBoundary: /公开示例.*不调用模型.*不写入你的项目/.test(noJsHtml.replace(/\s+/g, " ")),
  hasDemo: noJsHtml.includes("公开交互示例") && noJsHtml.includes("查看记录"),
  hasClose: noJsHtml.includes("让你的下一段长期项目，接得上"),
  hasRail: noJsHtml.includes("新情况出现时") && noJsHtml.includes("演示流程"),
  bytes: noJsHtml.length,
};
check("C-38-no-js-content-visible", noJs.hasH1 && noJs.hasBoundary && noJs.hasDemo && noJs.hasClose && noJs.hasRail, noJs);
await noJsPage.screenshot({ path: path.join(shotDir, "phase1-nojs-1440x900.png"), fullPage: false }).catch(() => {});
await noJsCtx.close();

// C-39 auto-continuation conditions details (negotiated boundary text must stay accurate)
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(900);
const detailsSummary = await page.locator("#missions details summary").first().innerText();
await page.locator("#missions details summary").first().click();
await page.waitForTimeout(300);
const detailsText = await page.locator("#missions details").first().innerText();
const fullDomText = await page.evaluate(() => document.body.textContent || "");
const liveHits = [];
for (const pattern of [/正在执行/g, /实时跟进/g, /Worker\s*在线/g, /正在后台/g, /刚刚(检查|核对)/g]) {
  let m;
  const re = new RegExp(pattern.source, "g");
  while ((m = re.exec(fullDomText)) !== null) liveHits.push(fullDomText.slice(Math.max(0, m.index - 45), m.index + 45).replace(/\s+/g, " "));
}
check("C-39-continuation-conditions", /启用委托功能/.test(detailsText) && /配置模型/.test(detailsText) && /Worker/.test(detailsText) && /单独授权/.test(detailsText) && /创建行动仍由你确认/.test(detailsText) && liveHits.every((c) => /不|冻结|示例/.test(c)), {
  detailsSummary, detailsText, liveHits,
});
const hiddenFakeNumbers = [];
for (const pattern of [/成功率/g, /节省/g, /\d+(?:\.\d+)?%/g, /播放量/g, /点赞/g, /观看数/g, /用户评价/g]) {
  const re = new RegExp(pattern.source, "g");
  let m;
  while ((m = re.exec(fullDomText)) !== null) hiddenFakeNumbers.push({ pattern: pattern.source, context: fullDomText.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ") });
}
check("C-40-no-hidden-fake-numbers", hiddenFakeNumbers.length === 0, hiddenFakeNumbers);
await page.locator("#missions details summary").first().click();

const firstScreen = {};
for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  const c = await browser.newContext({ viewport: vp, locale: "zh-CN" });
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await p.waitForTimeout(900);
  firstScreen[`${vp.width}x${vp.height}`] = await p.evaluate(() => {
    const note = Array.from(document.querySelectorAll("main p")).find((el) => /不写入你的项目/.test(el.textContent || ""));
    const kicker = Array.from(document.querySelectorAll("main p")).find((el) => /公开示例/.test(el.textContent || "") && /忆程参赛作品开发/.test(el.textContent || ""));
    const foot = Array.from(document.querySelectorAll("main footer span")).find((el) => /与下方五步示例使用同一份素材/.test(el.textContent || ""));
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120), top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, visible: r.top < window.innerHeight && r.bottom > 0 };
    };
    return { viewportHeight: window.innerHeight, heroNote: rect(note), heroKicker: rect(kicker), lensFoot: rect(foot), scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
  await p.screenshot({ path: path.join(shotDir, `phase1-first-screen-${vp.width}x${vp.height}.png`), fullPage: false });
  await c.close();
}
check("C-27-first-screen-public-label", firstScreen["1440x900"].heroNote?.visible === true && firstScreen["1280x720"].heroNote?.visible === true && firstScreen["390x844"].heroNote?.visible === true, firstScreen);
check("C-28-lens-foot-visible", Boolean(firstScreen["1440x900"].lensFoot), firstScreen["1440x900"].lensFoot);

const c30 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const p30 = await c30.newPage();
const errors30 = [];
p30.on("pageerror", (e) => errors30.push(String(e)));
p30.on("console", (m) => { if (m.type() === "error") errors30.push(m.text()); });
await p30.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await p30.waitForTimeout(1200);
check("C-29-console-clean", errors30.length === 0, errors30);
await c30.close();

fs.writeFileSync(path.join(jsonDir, "claims-check.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  base: BASE,
  candidateSha: process.env.AUDIT_SHA || null,
  checks,
  firstScreen,
  snapshot: { title: snapshot.title, lang: snapshot.lang, imgs: snapshot.imgs, iframes: snapshot.iframes, media: snapshot.media, autoplay: snapshot.autoplay, headings: snapshot.headings },
  consoleMessages: consoleMsgs,
}, null, 2));

const failed = checks.filter((c) => !c.pass);
console.log(`checks: ${checks.length}, failed: ${failed.length}`);
console.log("FAILED " + JSON.stringify(failed, null, 2));
await browser.close();
