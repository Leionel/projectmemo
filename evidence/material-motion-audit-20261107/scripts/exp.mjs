import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("D:/Projects/hongmen/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:33399", OUT = "D:/Projects/hongmen/evidence/material-motion-audit-20261107", SHOTS = OUT + "/before-after";
fs.mkdirSync(SHOTS, { recursive: true });
const MAIN = "cmw4ohyjz0000b88osiggwy11", CONV = "cmw4olbc6008mxo8otdmkp635";
const browser = await chromium.launch();
const auth = await browser.newContext();
await auth.request.post(BASE + "/api/auth/login", { data: { username: "e2e-reviewer", password: "e2e-reviewer-password", client: "web" } });
const state = await auth.storageState(); await auth.close();
const out = {};
const shot = (p, n, o = {}) => p.screenshot({ path: SHOTS + "/" + n + ".jpg", type: "jpeg", quality: 82, ...o });
const go = async (p, u) => { await p.goto(BASE + u, { waitUntil: "load" }); await p.waitForTimeout(1500); };

// 版心与首屏高度
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
const d = await desk.newPage();
out.leftEdges = {};
for (const [k, u, sel] of [["home", "/", "h1"], ["focus", "/focus", "h1"], ["projects", "/projects", "h1"], ["project", "/projects/" + MAIN, "h1"], ["actions", "/projects/" + MAIN + "/actions", "h1"]]) {
  await go(d, u);
  out.leftEdges[k] = await d.evaluate(s => ({ brand: Math.round(document.querySelector(".app-brand")?.getBoundingClientRect().left ?? -1), content: Math.round(document.querySelector(s)?.getBoundingClientRect().left ?? -1), brandFont: getComputedStyle(document.querySelector(".app-brand-name")).fontSize }), sel);
}
await go(d, "/projects/" + MAIN + "/actions");
out.firstActionY = await d.evaluate(() => { const e = [...document.querySelectorAll("h3,strong,a,p")].find(x => x.textContent.includes("提炼本条记录")); return Math.round(e?.getBoundingClientRect().top ?? -1); });
// 官网产品图：懒加载是否真实显示
await go(d, "/");
await d.evaluate(() => document.querySelector("figure[class*=platformShot]")?.scrollIntoView({ block: "center", behavior: "instant" })); await d.waitForTimeout(900);
await shot(d, "home-platform-shot-actual");
// 字重匹配：同文字在不同 font-weight 下的实际墨量
out.yaheiInk = await d.evaluate(() => { const r = {}; const c = document.createElement("canvas"); c.width = 400; c.height = 60; const g = c.getContext("2d", { willReadFrequently: true }); for (const w of [300, 400, 500, 550, 600, 650, 700, 800]) { g.clearRect(0, 0, 400, 60); g.font = w + " 24px 'Microsoft YaHei'"; g.fillStyle = "#000"; g.fillText("查看提醒依据项目记忆", 4, 40); const a = g.getImageData(0, 0, 400, 60).data; let s = 0; for (let i = 3; i < a.length; i += 4) s += a[i]; r[w] = Math.round(s / 255); } return r; });
await desk.close();

// 实验 1：顶栏滚动边缘材质
for (const [mode, vp, extra] of [["desktop", { width: 1440, height: 900 }, {}], ["mobile", { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.newContext({ viewport: vp, storageState: state, ...extra }); const p = await ctx.newPage();
  await go(p, "/projects"); await p.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" })); await p.waitForTimeout(200);
  await shot(p, `E1-header-${mode}-before`, { clip: { x: 0, y: 0, width: vp.width, height: 260 } });
  await p.addStyleTag({ content: ".app-header{background:color-mix(in srgb,var(--paper) 92%,transparent)!important;backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)!important}" });
  await p.waitForTimeout(200);
  await shot(p, `E1-header-${mode}-after`, { clip: { x: 0, y: 0, width: vp.width, height: 260 } });
  await ctx.close();
}

// 实验 2：项目卡主次与进度轨道
{ const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state }); const p = await ctx.newPage();
  await go(p, "/projects"); await p.evaluate(() => window.scrollTo({ top: 330, behavior: "instant" })); await p.waitForTimeout(150);
  await shot(p, "E2-card-before", { clip: { x: 80, y: 0, width: 1280, height: 480 } });
  await p.addStyleTag({ content: ".project-card-bar{background:var(--rule)!important}.project-card-open{background:transparent!important;color:var(--ink)!important;border:1px solid var(--rule-strong)}.project-card-record{border-color:transparent!important;color:var(--ink-soft)!important}.project-card{transition:none}.project-card-actions{border-top:0!important;padding-top:.25rem!important}.project-card-actions>a:first-child{}" });
  await p.evaluate(() => { document.querySelectorAll(".project-card-stats span,.project-card-stats div").forEach(e => { if (/^\s*0\s/.test(e.textContent)) e.style.display = "none"; }); });
  await p.waitForTimeout(150);
  await shot(p, "E2-card-after", { clip: { x: 80, y: 0, width: 1280, height: 480 } });
  await ctx.close(); }

// 实验 3：对话垂直空间 + 等待确认语义色
const ref = (kind, id) => ({ kind, id, projectId: MAIN, revision: "r1" });
const blocks = [
  { blockKey: "p", semanticType: "prose", emphasis: "primary", fallbackText: "", actionBindingIds: [], content: [{ type: "paragraph", spans: [{ kind: "text", text: "比赛材料要求演示可复现，但任务记录里没有回执。先补演示结果，再写汇报。" }] }] },
  { blockKey: "e", semanticType: "evidence", emphasis: "primary", fallbackText: "这个判断的 1 条依据", actionBindingIds: [], evidence: [{ source: ref("SOURCE", "src1"), quote: "目前还没有完整 Demo，需要先完成项目创建、碎片捕获和成果生成闭环。", claim: "演示流程未核验", relation: "SUPPORTS" }] },
  { blockKey: "ap", semanticType: "approval", emphasis: "primary", state: "PENDING", fallbackText: "创建行动：补充演示运行结果\n完成后回到原委托继续整理汇报。", actionBindingIds: ["b3", "b4"] },
];
const allowedActions = [{ bindingId: "b3", actionKind: "CONFIRM", label: "确认创建", enabled: true }, { bindingId: "b4", actionKind: "OPEN", label: "查看提案", enabled: true }];
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  await p.route(/\/api\/conversations\/[^/?]+(\?.*)?$/, async route => { if (route.request().method() !== "GET") return route.continue(); const res = await route.fetch(); let j; try { j = await res.json(); } catch { return route.fulfill({ response: res }); } const a = [...(j.messages ?? [])].reverse().find(m => String(m.role).toUpperCase() === "ASSISTANT"); if (a) { a.presentation = { schemaVersion: 1, blocks, allowedActions }; a.fileGuides = []; } await route.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), "content-type": "application/json" } }); });
  await go(p, "/projects/" + MAIN + "?conversation=" + CONV);
  const measure = () => p.evaluate(() => { const m = document.querySelector("[data-project-drawer] [aria-live=polite]"); const f = document.querySelector("[data-project-drawer] form"); const r = m.getBoundingClientRect(), c = f?.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), viewportPct: Math.round(100 * r.height / innerHeight), composer: c && Math.round(c.height) }; });
  out.composer = { before: await measure() };
  await shot(p, "E3-conversation-mobile-before");
  await p.evaluate(() => { const d = document.querySelector("[data-project-drawer]"); const f = d.querySelector("form"); const hit = [...d.querySelectorAll("*")].find(e => e.children.length && /^调整当前方向/.test(e.textContent.trim()) && !e.contains(f) && e !== d && f.parentElement.contains(e)); if (hit) { hit.dataset.exp = "ctx"; hit.style.display = "none"; } const ret = [...d.children].find(e => /返回原焦点讨论/.test(e.textContent) && e.children.length <= 2); if (ret) ret.style.display = "none"; });
  await p.addStyleTag({ content: "[data-block=approval]{border-color:var(--amber)!important;background:color-mix(in srgb,var(--amber) 8%,var(--card-bg))!important}[data-block=approval] > span:first-child{color:var(--amber)!important}[data-project-drawer] form{padding:.5rem .75rem!important}" });
  await p.waitForTimeout(250);
  out.composer.after = await measure();
  await shot(p, "E3-conversation-mobile-after");
  await ctx.close(); }

// 原型截图
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } }); const p = await ctx.newPage();
  await p.goto("file:///D:/Projects/hongmen/docs/design/prototypes/material-motion/index.html"); await p.waitForTimeout(500);
  if (scheme === "dark") await p.click("#theme");
  await p.evaluate(() => document.querySelectorAll("[data-watch]").forEach(e => { e.scrollTop = 150; e.dispatchEvent(new Event("scroll")); }));
  await p.evaluate(() => document.querySelectorAll(".t-solid .scroller,.t-liquid .scroller").forEach(e => { e.scrollTop = 150; }));
  await p.click("#steps button:nth-child(5)"); await p.hover(".claim mark"); await p.waitForTimeout(800);
  await p.screenshot({ path: SHOTS + "/prototype-" + scheme + ".jpg", type: "jpeg", quality: 82, fullPage: true });
  await ctx.close();
}
fs.writeFileSync(OUT + "/layout-metrics.json", JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
await browser.close();
