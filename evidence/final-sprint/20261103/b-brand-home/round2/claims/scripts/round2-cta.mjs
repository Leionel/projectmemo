// Phase 1 CTA / anchor audit — B2 candidate, anonymous.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const jsonDir = path.join(path.resolve(here, ".."), "json");
fs.mkdirSync(jsonDir, { recursive: true });

const browser = await chromium.launch();
const results = [];

async function waitForScrollSettled(page, maxMs = 4000) {
  const start = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - start < maxMs) {
    const y = await page.evaluate(() => window.scrollY);
    if (Math.abs(y - last) < 0.5) stable += 1;
    else stable = 0;
    last = y;
    if (stable >= 5) return y;
    await page.waitForTimeout(120);
  }
  return last;
}

async function measureAnchor(page) {
  await page.getByRole("link", { name: /体验一段项目接续/ }).first().click();
  await page.waitForTimeout(300);
  await waitForScrollSettled(page);
  return await page.evaluate(() => {
    const section = document.getElementById("experience");
    const header = document.querySelector("header");
    const heading = document.getElementById("experience-title");
    const sr = section?.getBoundingClientRect();
    const hr = header?.getBoundingClientRect();
    const tr = heading?.getBoundingClientRect();
    return {
      target: "experience",
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      sectionTop: sr ? Math.round(sr.top * 10) / 10 : null,
      headerBottom: hr ? Math.round(hr.bottom * 10) / 10 : null,
      headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
      headingOccluded: tr && hr ? tr.top < hr.bottom : null,
      sectionClearance: sr && hr ? Math.round((sr.top - hr.bottom) * 10) / 10 : null,
      headerPosition: header ? getComputedStyle(header).position : null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const viewports = [
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1280, height: 720, label: "1280x720" },
  { width: 1024, height: 768, label: "1024x768" },
  { width: 390, height: 844, label: "390x844" },
  { width: 360, height: 780, label: "360x780" },
  { width: 320, height: 780, label: "320x780" },
  { width: 720, height: 450, label: "1440@200%等效720x450" },
  { width: 640, height: 360, label: "1280@200%等效640x360" },
];

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const entry = { ...vp };
  try {
    const res = await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(900);
    entry.homeStatus = res?.status() ?? null;
    entry.clickFromTop = await measureAnchor(page);
    // direct hash load
    const res2 = await page.goto(BASE + "/#experience", { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(900);
    entry.directHash = await page.evaluate(() => {
      const section = document.getElementById("experience");
      const header = document.querySelector("header");
      const heading = document.getElementById("experience-title");
      const sr = section?.getBoundingClientRect();
      const hr = header?.getBoundingClientRect();
      const tr = heading?.getBoundingClientRect();
      return {
        hash: location.hash,
        sectionTop: sr ? Math.round(sr.top * 10) / 10 : null,
        headerBottom: hr ? Math.round(hr.bottom * 10) / 10 : null,
        headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
        headingOccluded: tr && hr ? tr.top < hr.bottom : null,
      };
    });
    entry.directHashStatus = res2?.status() ?? null;
    entry.ok = entry.clickFromTop.headingOccluded === false && entry.directHash.headingOccluded === false;
  } catch (err) {
    entry.error = String(err && err.message ? err.message : err);
    entry.ok = false;
  }
  results.push(entry);
  await ctx.close();
  console.log(`[${entry.ok ? "PASS" : "FAIL"}] anchor ${vp.label} => ${JSON.stringify(entry.clickFromTop || entry.error)}`);
}

// CTA click consistency (anonymous), separate context per click to avoid state
const ctaTargets = [
  { name: "header-cta", selector: "header a[href='/focus']" },
  { name: "hero-secondary-cta", selector: "main a[href='/login?from=%2Ffocus']" },
];
const ctaResults = [];
// dev/Turbopack can delay client redirects; wait for the real URL instead of a fixed sleep.
async function clickAndWaitLogin(page, locator, entry) {
  const isLogin = (u) => u.pathname === "/login" && u.searchParams.get("from") === "/focus";
  entry.attempts = 1;
  await locator.click();
  let ok = await page.waitForURL(isLogin, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!ok) {
    entry.attempts = 2;
    await locator.click();
    ok = await page.waitForURL(isLogin, { timeout: 20000 }).then(() => true).catch(() => false);
  }
  await page.waitForTimeout(600);
  return ok;
}

for (const target of ctaTargets) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const docs = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "document") docs.push({ url: res.url(), status: res.status() });
  });
  const entry = { name: target.name };
  try {
    await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
    // dev/Turbopack Fast Refresh can swallow an early client navigation; wait for hydration settle first
    await page.waitForTimeout(3500);
    const count = await page.locator(target.selector).count();
    entry.matched = count;
    docs.length = 0;
    const reachedLogin = await clickAndWaitLogin(page, page.locator(target.selector).first(), entry);
    entry.finalUrl = page.url();
    entry.title = await page.title();
    entry.loginFormVisible = await page.getByRole("textbox").first().isVisible().catch(() => false);
    entry.docs = [...docs];
    entry.ok = reachedLogin && entry.finalUrl.endsWith("/login?from=%2Ffocus") && entry.loginFormVisible;
  } catch (err) {
    entry.error = String(err && err.message ? err.message : err);
    entry.ok = false;
  }
  ctaResults.push(entry);
  await ctx.close();
  console.log(`[${entry.ok ? "PASS" : "FAIL"}] ${target.name} => ${JSON.stringify(entry)}`);
}

// closing section CTA (the final call-to-action)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const entry = { name: "closing-cta" };
  try {
    await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(3500);
    const link = page.locator("section").filter({ has: page.locator("#closing-title") }).getByRole("link", { name: /进入工作台/ }).first();
    entry.matched = await link.count();
    const reachedLogin = await clickAndWaitLogin(page, link, entry);
    entry.finalUrl = page.url();
    entry.title = await page.title();
    entry.loginFormVisible = await page.getByRole("textbox").first().isVisible().catch(() => false);
    entry.ok = reachedLogin && entry.finalUrl.endsWith("/login?from=%2Ffocus") && entry.loginFormVisible;
  } catch (err) {
    entry.error = String(err && err.message ? err.message : err);
    entry.ok = false;
  }
  ctaResults.push(entry);
  await ctx.close();
  console.log(`[${entry.ok ? "PASS" : "FAIL"}] closing CTA => ${JSON.stringify(entry)}`);
}

// nav anchor inventory + header sticky
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(1000);
  const inventory = await page.evaluate(() => {
    const header = document.querySelector("header");
    return {
      headerRect: header ? { height: header.getBoundingClientRect().height, position: getComputedStyle(header).position, top: getComputedStyle(header).top } : null,
      navAnchors: Array.from(document.querySelectorAll("header nav a")).map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href"), target: a.getAttribute("target") })),
      mainCtas: Array.from(document.querySelectorAll("main a")).map((a) => ({ text: (a.textContent || "").trim().replace(/\s+/g, " "), href: a.getAttribute("href") })).filter((a) => a.href && !a.href.startsWith("#")),
      boundaries: Array.from(document.querySelectorAll("main p")).filter((p) => /公开示例|不调用模型|冻结示例|不写入你的项目/.test(p.textContent || "")).map((p) => (p.textContent || "").trim()),
    };
  });
  fs.writeFileSync(path.join(jsonDir, "cta-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, anchors: results, ctaResults, inventory }, null, 2));
  console.log("INVENTORY " + JSON.stringify(inventory, null, 2));
  await ctx.close();
}

await browser.close();
