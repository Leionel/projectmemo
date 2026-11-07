import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("D:/Projects/hongmen/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:33399", OUT = "D:/Projects/hongmen/evidence/material-motion-audit-20261107";
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-frame-rate-limit=false"] });
const auth = await browser.newContext();
await auth.request.post(BASE + "/api/auth/login", { data: { username: "e2e-reviewer", password: "e2e-reviewer-password", client: "web" } });
const state = await auth.storageState(); await auth.close();
const injections = {
  asIs: "",
  noHeaderBlur: ".homeHeader,[class*=homeHeader]{backdrop-filter:none!important;background:var(--paper)!important}",
  headerBlur14: ".app-header{background:color-mix(in srgb,var(--paper) 82%,transparent)!important;backdrop-filter:blur(14px) saturate(1.12)!important}",
  headerBlur8Scrim: ".app-header{background:color-mix(in srgb,var(--paper) 92%,transparent)!important;backdrop-filter:blur(8px)!important}",
  allCardsGlass: ".app-header{background:color-mix(in srgb,var(--paper) 82%,transparent)!important;backdrop-filter:blur(14px)!important}.project-card,.ws-card,.card-surface{background:color-mix(in srgb,var(--card-bg) 62%,transparent)!important;backdrop-filter:blur(14px) saturate(1.2)!important}body{background-image:radial-gradient(circle at 20% 10%,#27685d33,transparent 40%),radial-gradient(circle at 80% 60%,#8a570022,transparent 40%)!important;background-attachment:fixed}",
};
const scenarios = [
  ["home", "/", "asIs"], ["home", "/", "noHeaderBlur"], ["home", "/", "asIs", true],
  ["projects", "/projects", "asIs"], ["projects", "/projects", "headerBlur14"], ["projects", "/projects", "headerBlur8Scrim"], ["projects", "/projects", "allCardsGlass"],
];
const profiles = [
  { name: "desktop-1x", vp: { width: 1440, height: 900 }, cpu: 1, dsf: 1 },
  { name: "mobile-dpr3-cpu4x", vp: { width: 390, height: 844 }, cpu: 4, dsf: 3, extra: { hasTouch: true, isMobile: true } },
  { name: "mobile-dpr3-cpu6x", vp: { width: 390, height: 844 }, cpu: 6, dsf: 3, extra: { hasTouch: true, isMobile: true } },
];
const rows = []; let renderer = "";
for (const p of profiles) for (const [page_, url, inj, reduced] of scenarios) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: p.vp, deviceScaleFactor: p.dsf, storageState: state, reducedMotion: reduced ? "reduce" : "no-preference", ...(p.extra || {}) });
    const page = await ctx.newPage();
    await page.goto(BASE + url, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    if (injections[inj]) await page.addStyleTag({ content: injections[inj] });
    await page.waitForTimeout(400);
    if (!renderer) renderer = await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl"); const d = g?.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown"; });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (p.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
    const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name, x.value]));
    const res = await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = "auto";
      const dist = Math.max(0, document.documentElement.scrollHeight - innerHeight), dur = 5000, start = performance.now(); const deltas = []; let last = start;
      await new Promise(done => { const tick = t => { deltas.push(t - last); last = t; const k = Math.min(1, (t - start) / dur); window.scrollTo(0, dist * (k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)); k < 1 ? requestAnimationFrame(tick) : done(); }; requestAnimationFrame(tick); });
      return { deltas: deltas.slice(2), dist };
    });
    const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name, x.value]));
    const d = res.deltas.slice().sort((a, b) => a - b), q = f => d[Math.floor(d.length * f)];
    samples.push({ frames: d.length, p50: q(.5), p95: q(.95), p99: q(.99), jank: d.filter(x => x > 33.4).length, recalc: m1.RecalcStyleCount - m0.RecalcStyleCount, layout: m1.LayoutCount - m0.LayoutCount, recalcMs: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000, layoutMs: (m1.LayoutDuration - m0.LayoutDuration) * 1000, taskMs: (m1.TaskDuration - m0.TaskDuration) * 1000, dist: res.dist });
    await ctx.close();
  }
  samples.sort((a, b) => a.p95 - b.p95); const s = samples[1];
  const row = { profile: p.name, page: page_, scenario: inj + (reduced ? "+reducedMotion" : ""), fps: +(s.frames / 5).toFixed(1), p50: +s.p50.toFixed(1), p95: +s.p95.toFixed(1), p99: +s.p99.toFixed(1), jankPct: +(100 * s.jank / s.frames).toFixed(1), recalc: s.recalc, layout: s.layout, recalcMs: Math.round(s.recalcMs), layoutMs: Math.round(s.layoutMs), taskMs: Math.round(s.taskMs), scrollPx: s.dist, allP95: samples.map(x => +x.p95.toFixed(1)) };
  rows.push(row); console.log(JSON.stringify(row));
}
fs.writeFileSync(OUT + "/perf-scroll.json", JSON.stringify({ renderer, note: "Median-by-p95 of 3 runs. rAF-driven scroll in headless Chromium on the audit host; relative comparison only, not a device benchmark.", rows }, null, 1));
console.log("renderer", renderer);
await browser.close();
