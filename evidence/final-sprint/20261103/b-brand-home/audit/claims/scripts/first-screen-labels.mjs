// Phase 0: are simulation-boundary labels visible in the first viewport?
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const jsonDir = path.join(path.resolve(here, ".."), "json");
fs.mkdirSync(jsonDir, { recursive: true });

const browser = await chromium.launch();
const out = {};
for (const vp of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200);
  out[`${vp.width}x${vp.height}`] = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim().slice(0, 120),
        top: Math.round(r.top * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        visibleInFirstView: r.top < window.innerHeight && r.bottom > 0,
      };
    };
    return {
      viewportHeight: window.innerHeight,
      heroNote: pick("main section:first-of-type p[class*=heroNote]"),
      heroCaption: pick("figure figcaption"),
      imageToolbar: pick("figure [class*=imageToolbar]"),
      demoFooterNote: pick("[class*=storyFooter] p"),
      simulationBoundaryLeaves: (() => {
        const all = Array.from(document.querySelectorAll("main p, main span, main figcaption, main label, main summary, main h4"));
        return all
          .filter((el) => el.children.length === 0 && /不调用模型|公开示例|模拟|示例|内置素材|本页/.test(el.textContent || ""))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: (el.textContent || "").trim().slice(0, 160),
              top: Math.round(r.top * 10) / 10,
              visibleInFirstView: r.top < window.innerHeight && r.bottom > 0,
            };
          })
          .slice(0, 20);
      })(),
      externalAnchors: Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") }))
        .filter((a) => /^https?:/i.test(a.href || "")),
    };
  });
  await ctx.close();
}
fs.writeFileSync(path.join(jsonDir, "first-screen-labels.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
