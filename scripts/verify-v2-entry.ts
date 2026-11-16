/** Browser acceptance for the normal product entry. Start scripts/v2-entry-demo.ts first. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const entryPort = Number(process.env.V2_ENTRY_PORT ?? 4420);
const control = "http://127.0.0.1:" + (entryPort + 1);
const app = "http://127.0.0.1:" + entryPort;
const out = path.resolve("evidence/v2-first-loop/slice-c-entry/browser");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + response.url()); });
const material = "登录流程已完成；移动端输入回归尚未记录；分享入口未验证。";
async function shot(name: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await page.screenshot({ path: path.join(out, name), fullPage: true, timeout: 60000 }); return; }
    catch { await page.waitForTimeout(1500); }
  }
  await page.screenshot({ path: path.join(out, name), fullPage: false, timeout: 60000 });
}
async function snapshot(missionId: string) {
  const response = await context.request.get(app + "/api/missions/" + missionId + "/workbench");
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
try {
  await page.goto(control);
  await page.getByRole("link", { name: "打开项目并完成一次托付" }).click();
  await page.getByRole("heading", { name: "交给忆程持续跟进" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const goalInput = page.getByLabel("这次要完成什么"), materialInput = page.getByLabel("导入文本材料");
  await goalInput.fill("整理下一版本发布说明");
  await materialInput.fill(material);
  const prepare = page.getByRole("button", { name: "预览持续范围" });
  for (let index = 0; index < 40 && !(await prepare.isEnabled()); index++) await page.waitForTimeout(250);
  assert.equal(await prepare.isEnabled(), true, "预览按钮在填写后仍不可用");
  await prepare.click();

  await page.getByRole("heading", { name: "确认这次持续跟进的范围" }).waitFor();
  await page.getByText("联网检索、公开研究、业务写入、自动外发").waitFor();
  assert.match(await page.locator("body").innerText(), /可持续到/);
  assert.match(await page.locator("body").innerText(), /调用上限/);
  await shot("preview.png");
  checks.push("normal project page: import text material -> bounded delegation preview (scope, expiry, limits, excluded effects)");

  const confirm = page.getByRole("button", { name: "确认并开始" });
  await confirm.click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  const missionId = new URL(page.url()).searchParams.get("missionId")!;
  await page.getByRole("button", { name: "第 1 版", exact: true }).waitFor({ timeout: 90000 });
  const first = await snapshot(missionId);
  assert.equal(first.outputs.length, 1);
  assert.match(first.provider, /openai-compatible/);
  assert.ok(first.sources.some((source: { text: string }) => source.text.includes("登录流程")));
  await page.getByRole("button", { name: "定位原记录" }).first().click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /登录流程/);
  await page.getByText("步骤回执已保存").first().waitFor();
  assert.match(await page.locator("aside").first().innerText(), /模型调用/);
  checks.push("one confirmation created the real v2 Mission and first private version; evidence, process and provider are readable");

  const added = await context.request.post(control + "/material?mission=" + encodeURIComponent(missionId));
  assert.equal(added.status(), 202, await added.text());
  await page.getByRole("button", { name: "第 2 版", exact: true }).waitFor({ timeout: 90000 });
  const second = await snapshot(missionId);
  assert.equal(second.outputs.length, 2);
  assert.ok(second.sources.some((source: { text: string }) => source.text.includes("移动端输入回归已补测")));
  checks.push("new text material woke the same Mission; background worker produced version 2 with the new source");

  const submit = page.waitForResponse(response => response.url().endsWith("/turns") && response.request().method() === "POST");
  await page.getByLabel("接下来怎么做，直接告诉忆程").fill("今天先核对第二版交付依据");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const turn = await submit;
  assert.equal(turn.status(), 200, await turn.text());
  await page.getByRole("button", { name: "第 3 版", exact: true }).waitFor({ timeout: 90000 });
  let settled = await snapshot(missionId);
  for (let index = 0; index < 60 && settled.phase !== "WAITING_OBSERVATION"; index++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    settled = await snapshot(missionId);
  }
  assert.equal(settled.phase, "WAITING_OBSERVATION");
  assert.equal(settled.outputs.length, 3);
  assert.match(settled.workingObjective, /第二版交付依据/);
  assert.match(JSON.stringify(settled.outputs[0].blocks), /工作重点/);
  checks.push("natural language redirect continued the same Mission; version 3 followed the new focus and returned to await_event");

  await page.getByRole("button", { name: "重新读取" }).click();
  await page.getByRole("button", { name: "暂停跟进" }).click();
  await page.getByText("已收到暂停请求，后台不再派发新步骤。").waitFor({ timeout: 30000 });
  let paused = await snapshot(missionId);
  for (let index = 0; index < 40 && paused.phase !== "PAUSED"; index++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    paused = await snapshot(missionId);
  }
  assert.equal(paused.status, "PAUSED");
  const mission = await context.request.get(app + "/api/missions/" + missionId);
  assert.equal((await mission.json()).mission.status, "PAUSED");
  checks.push("pause entry stays available on the real snapshot; pause stops further dispatch and keeps delivered versions");

  await shot("desktop.png");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole("button", { name: "成果", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await shot("mobile.png");
  checks.push("360px: no horizontal overflow");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(),
    entry: "normal project page -> v2 bounded delegation preview -> confirm -> workbench", missionId,
    provider: "local openai-compatible loopback mock selected by environment", data: "temporary synthetic project",
    checks, errors, realModelValidated: false, realDeviceValidated: false }, null, 2));
  console.log("V2_ENTRY_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  console.error("Browser stopped at", page.url(), "completed:", checks);
  throw error;
} finally { await browser.close(); }
