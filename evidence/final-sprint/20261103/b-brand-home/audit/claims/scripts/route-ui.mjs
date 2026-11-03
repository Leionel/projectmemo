// Phase 0 baseline CTA/route UI probe (anonymous, no credentials).
// Verifies where all "进入工作台" CTAs land and that /focus is not anonymously rendered.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");
const jsonDir = path.join(auditDir, "json");
fs.mkdirSync(jsonDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await context.newPage();
const docs = [];
page.on("response", async (res) => {
  const req = res.request();
  if (req.resourceType() === "document") {
    docs.push({ url: res.url(), status: res.status(), location: res.headers()["location"] || null, at: new Date().toISOString() });
  }
});
const steps = [];
async function step(name, fn) {
  try {
    const value = await fn();
    steps.push({ name, ok: true, value: value ?? null });
    console.log(`[OK] ${name} => ${JSON.stringify(value)}`);
  } catch (err) {
    steps.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
    console.log(`[FAIL] ${name}: ${err && err.message ? err.message : err}`);
  }
}

async function clickAndSettle(label, locator) {
  docs.length = 0;
  await locator.click();
  await page.waitForTimeout(2500);
  return {
    label,
    finalUrl: page.url(),
    title: await page.title(),
    bodySnippet: (await page.locator("body").innerText()).slice(0, 400),
    docs: [...docs],
  };
}

await step("open-home", async () => {
  docs.length = 0;
  const res = await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  return { status: res?.status(), url: page.url(), docs: [...docs] };
});

await step("header-cta-anonymous", async () => {
  return await clickAndSettle("页头 进入工作台", page.locator("header").getByRole("link", { name: /进入工作台/ }));
});

await step("hero-secondary-cta-anonymous", async () => {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(800);
  return await clickAndSettle("Hero 次要 CTA 进入工作台", page.getByRole("main").getByRole("link", { name: /进入工作台/ }).first());
});

await step("footer-cta-anonymous", async () => {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(800);
  return await clickAndSettle("页尾 CTA 进入工作台", page.getByRole("main").getByRole("link", { name: /进入工作台/ }).last());
});

await step("direct-focus-anonymous", async () => {
  docs.length = 0;
  const res = await page.goto(BASE + "/focus", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(4000);
  return {
    initialStatus: res?.status() ?? null,
    finalUrl: page.url(),
    title: await page.title(),
    h1: await page.locator("h1").first().innerText().catch(() => null),
    bodySnippet: (await page.locator("body").innerText()).slice(0, 300),
    loginFormVisible: await page.getByRole("textbox").first().isVisible().catch(() => false),
    docs: [...docs],
    hash: "",
  };
});

await step("direct-login-from-focus", async () => {
  docs.length = 0;
  const res = await page.goto(BASE + "/login?from=%2Ffocus", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  return {
    status: res?.status() ?? null,
    finalUrl: page.url(),
    title: await page.title(),
    h1: await page.locator("h1").first().innerText().catch(() => null),
    bodySnippet: (await page.locator("body").innerText()).slice(0, 400),
    fromInUrl: new URL(page.url()).searchParams.get("from"),
    docs: [...docs],
  };
});

await step("direct-projects-anonymous", async () => {
  docs.length = 0;
  const res = await page.goto(BASE + "/projects", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3500);
  return {
    initialStatus: res?.status() ?? null,
    finalUrl: page.url(),
    title: await page.title(),
    docs: [...docs],
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  mode: "anonymous-playwright-no-credentials",
  steps,
};
fs.writeFileSync(path.join(jsonDir, "routes-ui-baseline.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("wrote routes-ui-baseline.json");
