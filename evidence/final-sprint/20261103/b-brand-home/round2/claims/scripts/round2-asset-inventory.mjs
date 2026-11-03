// Round 2: accurate homepage asset inventory + actual transfer sizes (anonymous, read-only).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(here, "..");
const auditRoot = path.resolve(base, "..", ".."); // evidence/.../b-brand-home
const jsonDir = path.join(base, "json");
fs.mkdirSync(jsonDir, { recursive: true });

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const bytes = (p) => fs.statSync(p).size;

const files = [
  "public/fonts/pm-editorial-serif.ttf",
  "public/fonts/pm-serif-brand.ttf",
  "public/fonts/manrope-variable.ttf",
  "public/fonts/OFL.txt",
  "public/fonts/Manrope-OFL.txt",
  "public/fonts/PM-Editorial-NOTICE.txt",
  "public/logo.png",
  "public/logo-v2.png",
  "public/home/workspace-desktop.jpg",
  "public/home/workspace-mobile.jpg",
];
const fileInfo = {};
for (const f of files) {
  if (!fs.existsSync(f)) { fileInfo[f] = { exists: false }; continue; }
  fileInfo[f] = { exists: true, bytes: bytes(f), sha256: sha(f) };
  try {
    fileInfo[f].addedIn = execSync(`git log --diff-filter=A --format=%h -- ${JSON.stringify(f).replaceAll('"', "")}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean).slice(-1)[0] || null;
    fileInfo[f].addedDate = execSync(`git log --diff-filter=A --format=%ad --date=short -- ${JSON.stringify(f).replaceAll('"', "")}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean).slice(-1)[0] || null;
  } catch { /* ignore */ }
}

// Reference scan (source files only, excluding evidence/docs)
const scanRoots = ["app", "components", "lib"];
const refs = {};
function scanFor(pattern) {
  const out = [];
  for (const root of scanRoots) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!/\.(tsx?|css)$/.test(entry.name)) continue;
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        lines.forEach((line, idx) => { if (pattern.test(line)) out.push({ file: p.replaceAll("\\", "/"), line: idx + 1, text: line.trim().slice(0, 200) }); });
      }
    };
    if (fs.existsSync(root)) walk(root);
  }
  return out;
}
refs.pmEditorial = scanFor(/PM Editorial|pm-editorial-serif/);
refs.pmBrand = scanFor(/PM Brand|pm-serif-brand/);
refs.manrope = scanFor(/Manrope|manrope-variable/);
refs.logo = scanFor(/logo\.png|logo-v2/);
refs.oldHomeImages = scanFor(/workspace-(desktop|mobile)|public\/home/);

// Actual homepage transfer sizes via Resource Timing (fonts/logo/images), fresh context.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();
const responses = [];
page.on("response", async (res) => {
  const req = res.request();
  if (!["font", "image", "stylesheet"].includes(req.resourceType())) return;
  const h = res.headers();
  responses.push({
    url: res.url(),
    resourceType: req.resourceType(),
    status: res.status(),
    contentLength: h["content-length"] ?? null,
    contentEncoding: h["content-encoding"] ?? null,
    cacheControl: h["cache-control"] ?? null,
  });
});
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(2500);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const perf = await page.evaluate(() =>
  performance.getEntriesByType("resource").filter((e) => /\/fonts\/|\/logo|\.jpg|\.png/.test(e.name)).map((e) => ({
    name: e.name.replace(location.origin, ""),
    initiatorType: e.initiatorType,
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    decodedBodySize: e.decodedBodySize,
    duration: Math.round(e.duration * 10) / 10,
  }))
);
const docPerf = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return n ? { transferSize: n.transferSize, encodedBodySize: n.encodedBodySize, decodedBodySize: n.decodedBodySize } : null;
});
const preconnect = await page.evaluate(() =>
  Array.from(document.querySelectorAll("link[rel='preconnect'],link[rel='dns-prefetch'],link[rel='preload']")).map((l) => ({ rel: l.rel, href: l.getAttribute("href"), as: l.getAttribute("as") }))
);
const externalAnchors = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]")).map((a) => ({ text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120), href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), ariaLabel: a.getAttribute("aria-label") })).filter((a) => /^https?:/i.test(a.href || ""))
);
await browser.close();

// Cross-reference: evidence-runner dev resource record (9bae926) if present.
let evidenceRunnerResources = null;
const erPath = path.join(auditRoot, "after", "MANIFEST.json");
if (fs.existsSync(erPath)) {
  try {
    const m = JSON.parse(fs.readFileSync(erPath, "utf8"));
    evidenceRunnerResources = {
      sourceSha: m.sourceSha,
      capturedAt: m.capturedAt,
      environment: m.environment?.mode ?? null,
      resourcesFile: m.resources?.file ?? null,
      fontResources: m.resources?.fontResources ?? null,
      totals: m.resources?.totals ?? null,
      network: m.network?.totals ?? null,
      caveat: "evidence-runner 记录为 Next dev（非生产构建）、本机回环；传输量与生产构建不同，引用时须注明。",
    };
  } catch { /* ignore */ }
}

const fontLicense = {
  "OFL.txt": fs.existsSync("public/fonts/OFL.txt") ? fs.readFileSync("public/fonts/OFL.txt", "utf8").split(/\r?\n/).slice(0, 3) : null,
  "Manrope-OFL.txt": fs.existsSync("public/fonts/Manrope-OFL.txt") ? fs.readFileSync("public/fonts/Manrope-OFL.txt", "utf8").split(/\r?\n/).slice(0, 3) : null,
  "PM-Editorial-NOTICE.txt": fs.existsSync("public/fonts/PM-Editorial-NOTICE.txt") ? fs.readFileSync("public/fonts/PM-Editorial-NOTICE.txt", "utf8") : null,
  pmBrandDedicatedNotice: fs.existsSync("public/fonts/PM-Brand-NOTICE.txt"),
};

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  candidateSha: process.env.AUDIT_SHA || null,
  environment: "Next dev (Turbopack) on 127.0.0.1:34111, mock/isolated; transfer sizes are dev/local, not production",
  files: fileInfo,
  consumers: refs,
  homepageRuntime: { document: docPerf, resources: perf, preconnect, externalAnchors },
  evidenceRunnerDevRecord: evidenceRunnerResources,
  fontLicense,
  classifications: {
    homepageLocal: ["public/fonts/manrope-variable.ttf (only home.module.css @font-face/--landing-sans)"],
    sharedWithAccountPages: ["public/fonts/pm-editorial-serif.ttf (home.module.css + auth.module.css @font-face; homepage headings + auth screen)"],
    globalHeaderOrGlobalCss: ["public/fonts/pm-serif-brand.ttf (globals.css .app-brand-name via BrandLink, .majestic-heading)", "public/logo.png (BrandLink in every header)"],
    unused: ["public/logo-v2.png (identical sha256 to logo.png; no code reference)", "public/home/workspace-desktop.jpg", "public/home/workspace-mobile.jpg"],
  },
  notes: [
    "所有传输量数字均来自本机 Next dev（Resource Timing），不得当作生产 CDN/压缩后的数值。",
    "页面不新增任何字体/图片，资产清单只读。",
    "未发现对 public/home/*.jpg 的源码引用；旧首页大图不被当前首页加载。",
  ],
};
fs.writeFileSync(path.join(jsonDir, "asset-inventory.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ files: report.files, runtime: report.homepageRuntime, evidenceRunner: report.evidenceRunnerDevRecord?.fontResources }, null, 2));
