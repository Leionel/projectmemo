import { chromium } from "playwright";
const BASE = "http://127.0.0.1:34111";
const OUT = "evidence/final-sprint/20261103/b-brand-home/round2/a11y/shots";
const browser = await chromium.launch({ headless: true });
const results = {};
for (const theme of ["light", "dark"]) {
  for (const vp of [{ name: "1440x900", width: 1440, height: 900 }, { name: "390x844", width: 390, height: 844 }, { name: "320x640", width: 320, height: 640 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme === "dark" ? "dark" : "light", locale: "zh-CN" });
    await context.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const data = await page.evaluate(() => {
      const parseColor = (value) => {
        const str = String(value);
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
        const srgb = str.match(/color\(srgb\s+([^)]+)\)/);
        if (srgb) { const p = srgb[1].split(/[\s\/]+/).filter(Boolean).map(Number); return { r: Math.round(p[0]*255), g: Math.round(p[1]*255), b: Math.round(p[2]*255), a: p.length > 3 ? p[3] : 1 }; }
        return null;
      };
      const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
      const blend = (fg, bg) => ({ r: Math.round(fg.r*fg.a + bg.r*(1-fg.a)), g: Math.round(fg.g*fg.a + bg.g*(1-fg.a)), b: Math.round(fg.b*fg.a + bg.b*(1-fg.a)), a: 1 });
      const effectiveBg = (el) => { let node = el; const layers = []; while (node && node !== document.documentElement) { const cs = getComputedStyle(node); const c = parseColor(cs.backgroundColor); if (c && c.a > 0.001) layers.push(c); node = node.parentElement; } const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r:255,g:255,b:255,a:1 }; let bg = body; for (let i = layers.length-1; i >= 0; i -= 1) bg = blend(layers[i], bg); return bg; };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2); return Number(((hi+0.05)/(lo+0.05)).toFixed(2)); };
      const corner = document.querySelector("[class*='videoFacadeCorner']");
      const stage = document.querySelector("[class*='videoStage']");
      const facadeTitle = document.querySelector("[class*='videoFacadeTitle']");
      const facadeMeta = document.querySelector("[class*='videoFacadeMeta']");
      const read = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const fg = parseColor(cs.color) || { r:0,g:0,b:0,a:1 };
        const bg = effectiveBg(el);
        const solid = fg.a < 1 ? blend(fg, bg) : fg;
        return { text: (el.textContent || "").trim().slice(0, 40), fontSize: parseFloat(cs.fontSize), color: cs.color, effectiveBg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`, contrast: ratio(solid, bg) };
      };
      return { htmlClass: document.documentElement.className, stage: stage ? { bg: getComputedStyle(stage).backgroundColor, rect: (() => { const r = stage.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() } : null, corner: read(corner), title: read(facadeTitle), meta: read(facadeMeta) };
    });
    const shot = `${OUT}/round2-dark-video-${theme}-${vp.name}.png`;
    await page.screenshot({ path: shot });
    results[`${theme}:${vp.name}`] = { ...data, shot: shot.replace(/^.*?round2\/a11y\//, "") };
    await context.close();
  }
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
