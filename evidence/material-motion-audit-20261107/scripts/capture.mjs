import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("D:/Projects/hongmen/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:33399";
const OUT = "D:/Projects/hongmen/evidence/material-motion-audit-20261107";
const SHOTS = OUT + "/screens";
fs.mkdirSync(SHOTS, { recursive: true });
const MAIN = "cmw4ohyjz0000b88osiggwy11", MISSIONP = "cmw4ojjqp0001xo8oasaqbwl6", CONV = "cmw4olbc6008mxo8otdmkp635";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const report = { pages: {}, resources: {}, a11yTargets: {}, misc: {} };
const auth = await browser.newContext();
const login = await auth.request.post(BASE + "/api/auth/login", { data: { username: "e2e-reviewer", password: "e2e-reviewer-password", client: "web" } });
console.log("login", login.status());
const state = await auth.storageState();
await auth.close();
const shot = async (page, name, opts = {}) => page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 78, ...opts });
const settle = async page => { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); };
const audit = page => page.evaluate(() => {
  const all = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const radii = {}, fonts = {}, shadow = {}, trans = { all: 0, longest: 0 }; let backdrop = 0, anims = 0, family = {};
  for (const e of all) {
    const s = getComputedStyle(e);
    if (s.backdropFilter && s.backdropFilter !== "none") backdrop++;
    if (s.borderTopLeftRadius !== "0px") radii[s.borderTopLeftRadius] = (radii[s.borderTopLeftRadius] || 0) + 1;
    if (s.boxShadow !== "none") shadow[s.boxShadow] = (shadow[s.boxShadow] || 0) + 1;
    if (s.animationName !== "none") anims++;
    if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) { fonts[s.fontSize] = (fonts[s.fontSize] || 0) + 1; const f = s.fontFamily.split(",")[0]; family[f] = (family[f] || 0) + 1; }
    if (s.transitionProperty.includes("all") && s.transitionDuration !== "0s") trans.all++;
  }
  return { elements: all.length, backdrop, anims, radii, fonts, family, shadows: Object.keys(shadow).length, shadowElems: Object.values(shadow).reduce((a, b) => a + b, 0), transAll: trans.all, docH: document.documentElement.scrollHeight, title: document.title, h1: document.querySelector("h1")?.textContent?.slice(0, 40) };
});
const targets = page => page.evaluate(() => {
  const items = [...document.querySelectorAll("a[href],button,summary,select,input:not([type=hidden]),textarea,[role=button]")].filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; });
  const small = items.map(e => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), t: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 24) }; }).filter(x => x.h < 44 || x.w < 24);
  return { total: items.length, under44: small.length, under24: small.filter(x => x.h < 24).length, sample: small.slice(0, 10) };
});
const routes = { focus: "/focus", projects: "/projects", project: `/projects/${MAIN}`, records: `/projects/${MAIN}/records`, projActions: `/projects/${MAIN}/actions`, missions: `/projects/${MISSIONP}/missions`, health: `/projects/${MAIN}/health`, memory: "/memory", actions: "/actions", settings: "/settings", login: "/login" };
for (const [mode, vp, extra] of [["desktop", { width: 1440, height: 900 }, {}], ["mobile", { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 }]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, storageState: state, ...extra });
    await ctx.addInitScript(s => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
    const page = await ctx.newPage();
    const reqs = [];
    if (mode === "desktop" && scheme === "light") page.on("response", async r => { try { const b = await r.body(); reqs.push({ u: r.url().replace(BASE, "").slice(0, 80), t: r.request().resourceType(), kb: Math.round(b.length / 102.4) / 10 }); } catch {} });
    await page.goto(BASE + "/", { waitUntil: "load" }); await settle(page);
    await shot(page, `home-${mode}-${scheme}-hero`);
    if (mode === "desktop" && scheme === "light") report.resources.home = reqs.slice().sort((a, b) => b.kb - a.kb).slice(0, 14);
    if (scheme === "light") { await shot(page, `home-${mode}-full`, { fullPage: true }); report.pages[`home-${mode}`] = await audit(page); if (mode === "mobile") report.a11yTargets.home = await targets(page); }
    for (const id of ["flow", "experience", "demo"]) { await page.evaluate(i => document.getElementById(i)?.scrollIntoView({ behavior: "instant", block: "start" }), id); await page.waitForTimeout(350); if (scheme === "light" || id === "flow") await shot(page, `home-${mode}-${scheme}-${id}`); }
    for (const [k, r] of Object.entries(routes)) {
      if (scheme === "dark" && !["focus", "project", "missions"].includes(k)) continue;
      const resp = await page.goto(BASE + r, { waitUntil: "load" }).catch(e => ({ status: () => e.message })); await settle(page);
      await shot(page, `${k}-${mode}-${scheme}`);
      if (scheme === "light") { report.pages[`${k}-${mode}`] = { status: resp.status(), url: page.url().replace(BASE, ""), ...(await audit(page)) }; if (mode === "mobile") report.a11yTargets[k] = await targets(page); }
      if (scheme === "light" && ["project", "projects", "focus"].includes(k)) { await page.evaluate(() => window.scrollTo({ top: 620, behavior: "instant" })); await page.waitForTimeout(200); await shot(page, `${k}-${mode}-scrolled`); }
    }
    await ctx.close();
  }
}
fs.writeFileSync(OUT + "/capture-metrics.json", JSON.stringify(report, null, 1));
await browser.close();
console.log("done");
