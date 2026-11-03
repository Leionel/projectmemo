/**
 * Round 2 视频播放器专项（候选 f06685d：点击后内嵌 Bilibili 官方播放器）。
 *
 * 验证 Lead 指定项：
 *  - 点击前：0 外部请求、0 iframe、facade 按钮语义/尺寸/可访问名
 *  - 点击后：iframe title、外部请求属用户主动、焦点进入 iframe（180/900/1800ms 兜底）
 *  - 「收起播放器」：卸载 iframe、恢复 facade、焦点回到 facade 按钮、收起后不再新增外部请求
 *  - 外链：可见文案/aria-label 说明“新窗口”、target/rel
 *  - 键盘：facade 可达、Enter/Space 激活、收起按钮可键盘操作
 *  - 无 JS：facade 不加载 iframe、外链可用
 *  - autoplay 策略作为观察项（跨域无法内省，不据此判失败）
 *
 * 用法：node .../probe-round2-video.mjs --base http://127.0.0.1:34111 --label round2 --sha f06685d
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const eq = argv.find((item) => item.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:34111").replace(/\/$/, "");
const OUT = path.resolve(arg("out", "evidence/final-sprint/20261103/b-brand-home/round2/a11y"));
const LABEL = arg("label", "round2");
const SHA = arg("sha", "");
const SHOTS = path.join(OUT, "shots");
const JSONDIR = path.join(OUT, "json");
fs.mkdirSync(SHOTS, { recursive: true });

const results = {
  meta: {
    label: LABEL,
    sha: SHA,
    base: BASE,
    startedAt: new Date().toISOString(),
    note: "Round 2 视频播放器专项取证；非真实用户测试、非无障碍认证。autoplay 策略为观察项，不据此判失败。",
  },
  sections: {},
  errors: [],
};
const browser = await chromium.launch({ headless: true });
const shot = async (page, name) => {
  const file = path.join(SHOTS, `${LABEL}-video-${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(OUT, file).replaceAll("\\", "/");
};
const run = async (name, fn) => {
  try {
    results.sections[name] = await fn();
  } catch (error) {
    results.errors.push({ section: name, message: String(error && error.stack ? error.stack : error).slice(0, 1200) });
    results.sections[name] = { error: String(error && error.message ? error.message : error) };
  }
};
const newContext = async (options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", ...options });
  const page = await context.newPage();
  return { context, page };
};
const goto = async (page) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(900);
};

const readState = async (page) =>
  await page.evaluate(() => {
    const facade = document.querySelector("button[aria-label*='Bilibili 官方播放器']");
    const iframe = document.querySelector("iframe");
    const collapse = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("收起播放器"));
    const external = [...document.querySelectorAll("a[href*='bilibili']")].map((a) => ({
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
      visibleText: (a.textContent || "").replace(/\s+/g, " ").trim(),
      ariaLabel: a.getAttribute("aria-label"),
      rect: (() => { const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
    const active = document.activeElement;
    return {
      facade: facade
        ? {
            ariaLabel: facade.getAttribute("aria-label"),
            text: (facade.textContent || "").replace(/\s+/g, " ").trim(),
            rect: (() => { const r = facade.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
            tabIndex: facade.tabIndex,
            focusVisible: facade.matches(":focus-visible"),
          }
        : null,
      iframe: iframe
        ? {
            src: iframe.getAttribute("src"),
            title: iframe.getAttribute("title"),
            allow: iframe.getAttribute("allow"),
            loading: iframe.getAttribute("loading"),
            referrerPolicy: iframe.getAttribute("referrerPolicy"),
            tabIndex: iframe.tabIndex,
            focusVisible: iframe.matches(":focus-visible"),
          }
        : null,
      collapse: collapse ? { text: (collapse.textContent || "").trim(), tag: collapse.tagName.toLowerCase(), tabIndex: collapse.tabIndex } : null,
      external,
      active: {
        tag: active.tagName.toLowerCase(),
        title: active.getAttribute ? active.getAttribute("title") : null,
        ariaLabel: active.getAttribute ? active.getAttribute("aria-label") : null,
        text: (active.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      },
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600),
    };
  });

let clickHandles = null;

await run("beforeClick", async () => {
  const { context, page } = await newContext();
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType(), at: Date.now() }));
  await goto(page);
  const state = await readState(page);
  const external = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.startsWith("about:"));
  const bili = requests.filter((r) => /bilibili|bilivideo|b23\.tv/i.test(r.url));
  const shotFile = await shot(page, "before-click");
  await context.close();
  return {
    present: !!(state.facade || state.iframe),
    state,
    externalCount: external.length,
    external: external.slice(0, 8).map((r) => r.url.slice(0, 120)),
    bilibiliRequests: bili.length,
    shotFile,
  };
});

await run("afterClick", async () => {
  const { context, page } = await newContext();
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType(), at: Date.now() }));
  await goto(page);
  const facade = page.locator("button[aria-label*='Bilibili 官方播放器']").first();
  if ((await facade.count()) === 0) {
    await context.close();
    return { present: false, note: "候选不含视频门面按钮" };
  }
  await facade.scrollIntoViewIfNeeded();
  await facade.focus();
  const focusBefore = await page.evaluate(() => ({ tag: document.activeElement.tagName.toLowerCase(), ariaLabel: document.activeElement.getAttribute("aria-label") }));
  const clickedAt = Date.now();
  await facade.click();
  await page.waitForTimeout(2600); // 覆盖 180/900/1800ms 焦点兜底
  const state = await readState(page);
  const external = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.startsWith("about:"));
  const bili = requests.filter((r) => /bilibili|bilivideo|b23\.tv/i.test(r.url));
  const frames = page.frames().map((f) => f.url()).filter(Boolean);
  const shotFile = await shot(page, "after-click");
  clickHandles = { page, context, requests, clickedAt };
  return {
    present: true,
    focusBefore,
    clickedAt,
    state,
    externalCount: external.length,
    external: external.slice(0, 10).map((r) => ({ url: r.url.slice(0, 140), type: r.type })),
    bilibiliRequests: bili.length,
    bilibili: bili.slice(0, 8).map((r) => ({ url: r.url.slice(0, 140), type: r.type })),
    frames,
    iframeAutoplayParam: state.iframe?.src?.includes("autoplay=1") ?? null,
    focusInIframe: state.active.tag === "iframe",
    shotFile,
  };
});

await run("collapse", async () => {
  if (!clickHandles) return { present: false, note: "afterClick 未取得句柄" };
  const { page, context, requests } = clickHandles;
  const beforeCount = requests.filter((r) => /bilibili|bilivideo|b23\.tv/i.test(r.url)).length;
  const collapse = page.locator("button", { hasText: "收起播放器" }).first();
  const collapseVisible = (await collapse.count()) > 0 && (await collapse.isVisible());
  await collapse.click();
  await page.waitForTimeout(800);
  const state = await readState(page);
  const afterCount = requests.filter((r) => /bilibili|bilivideo|b23\.tv/i.test(r.url)).length;
  const shotFile = await shot(page, "after-collapse");
  await context.close();
  clickHandles = null;
  return {
    present: true,
    collapseVisible,
    state,
    iframeRemoved: !state.iframe,
    facadeRestored: !!state.facade,
    focusOnFacade: state.active.tag === "button" && /Bilibili 官方播放器/.test(state.active.ariaLabel || ""),
    bilibiliRequestsBeforeCollapse: beforeCount,
    bilibiliRequestsAfterCollapse: afterCount,
    newRequestsAfterCollapse: afterCount - beforeCount,
    shotFile,
  };
});

await run("keyboard", async () => {
  const { context, page } = await newContext();
  await goto(page);
  const facade = page.locator("button[aria-label*='Bilibili 官方播放器']").first();
  if ((await facade.count()) === 0) {
    await context.close();
    return { present: false };
  }
  await facade.scrollIntoViewIfNeeded();
  await facade.focus();
  const focusVisible = await facade.evaluate((el) => el.matches(":focus-visible"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2400);
  const afterEnter = await readState(page);
  const collapse = page.locator("button", { hasText: "收起播放器" }).first();
  const collapseReachable = (await collapse.count()) > 0;
  let collapseFocusVisible = null;
  let afterCollapse = null;
  if (collapseReachable) {
    await collapse.focus();
    collapseFocusVisible = await collapse.evaluate((el) => el.matches(":focus-visible"));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    afterCollapse = await readState(page);
  }
  const shotFile = await shot(page, "keyboard");
  await context.close();
  return {
    present: true,
    focusVisible,
    afterEnter,
    focusInIframeAfterEnter: afterEnter.active.tag === "iframe",
    collapseReachable,
    collapseFocusVisible,
    afterCollapse,
    focusBackOnFacade: afterCollapse ? afterCollapse.active.tag === "button" && /Bilibili 官方播放器/.test(afterCollapse.active.ariaLabel || "") : null,
    shotFile,
  };
});

await run("autoplayObservation", async () => {
  const { context, page } = await newContext();
  await goto(page);
  const facade = page.locator("button[aria-label*='Bilibili 官方播放器']").first();
  if ((await facade.count()) === 0) {
    await context.close();
    return { present: false };
  }
  await facade.scrollIntoViewIfNeeded();
  await facade.click();
  await page.waitForTimeout(2600);
  const data = await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    let crossOriginProbe = null;
    try {
      const doc = iframe.contentDocument;
      crossOriginProbe = doc ? "accessible" : "null-document";
    } catch (error) {
      crossOriginProbe = String(error && error.name ? error.name : error);
    }
    const bodyText = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      iframe: iframe ? { src: iframe.getAttribute("src"), allow: iframe.getAttribute("allow") } : null,
      crossOriginProbe,
      copyClaimsAutoplay: /自动播放|自动开始|自动播/.test(bodyText),
      copyMentionsInPlayer: /在播放器内播放/.test(bodyText),
      bodyTextAroundDemo: (bodyText.match(/.{0,60}决赛演示.{0,200}/) || [""])[0],
    };
  });
  const shotFile = await shot(page, "autoplay-observation");
  await context.close();
  return { present: true, data, shotFile };
});

await run("noJs", async () => {
  const { context, page } = await newContext({ javaScriptEnabled: false });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => ({
    facade: !!document.querySelector("button[aria-label*='Bilibili 官方播放器']"),
    iframe: !!document.querySelector("iframe"),
    externalLinks: [...document.querySelectorAll("a[href*='bilibili']")].map((a) => ({ text: (a.textContent || "").trim(), ariaLabel: a.getAttribute("aria-label"), target: a.getAttribute("target"), rel: a.getAttribute("rel") })),
    mainLoading: !!document.querySelector('main[aria-busy="true"]'),
  }));
  const shotFile = await shot(page, "no-js");
  await context.close();
  return { data, shotFile };
});

results.meta.finishedAt = new Date().toISOString();
const outFile = path.join(JSONDIR, `video-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
await browser.close();
console.log("WROTE " + outFile);
console.log("ERRORS " + results.errors.length);
for (const e of results.errors) console.log(" - " + e.section + ": " + e.message.split("\n")[0]);
