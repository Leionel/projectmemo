/** Browser acceptance for the normal product entry. Start scripts/v2-entry-demo.ts first. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { WorkbenchSnapshot } from "../lib/types/workbench";

const entryPort = Number(process.env.V2_ENTRY_PORT ?? 4420);
const control = "http://127.0.0.1:" + (entryPort + 1);
const app = "http://127.0.0.1:" + entryPort;
const out = path.resolve(process.env.V2_ENTRY_EVIDENCE_DIR ?? path.join("output", "playwright", "v2-reentry", new Date().toISOString().replace(/[:.]/g, "-")));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
const errors: string[] = [], checks: string[] = [];
async function openPage() {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + response.url()); });
  return page;
}
let page = await openPage();
const material = "登录流程已完成；移动端输入回归尚未记录；分享入口未验证。";
async function shot(name: string) {
  // Capture sticky navigation in its resting position in the full-page receipt.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => window.scrollY === 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await page.screenshot({ path: path.join(out, name), fullPage: true, timeout: 60000 }); return; }
    catch { await page.waitForTimeout(1500); }
  }
  await page.screenshot({ path: path.join(out, name), fullPage: false, timeout: 60000 });
}
async function snapshot(missionId: string): Promise<WorkbenchSnapshot> {
  const response = await context.request.get(app + "/api/missions/" + missionId + "/workbench");
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function savedRevision(missionId: string, revision: number) {
  const deadline = Date.now() + 60_000;
  do {
    const value = await snapshot(missionId);
    if (value.outputs[0]?.revision === revision && value.phase === "WAITING_OBSERVATION") return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error("第 " + revision + " 版尚未到达继续观察状态");
}
const journey: Record<string, { missionId: string; closedAt: string; materialAt: string; savedAt: string; reopenedAt: string }> = {};
async function leaveAndReturn(missionId: string, name: string, material: string, scenario: string) {
  await page.close();
  const closedAt = new Date().toISOString();
  assert.equal(context.pages().length, 0);
  const added = await context.request.post(app + "/api/missions/" + missionId + "/materials",
    { data: { requestId: crypto.randomUUID(), kind: "MATERIAL", name, text: material } });
  assert.equal(added.ok(), true, await added.text());
  const materialAt = new Date().toISOString();
  const { sourceId } = await added.json();
  const second = await savedRevision(missionId, 2);
  assert.ok(second.outputs[0].blocks.some(block => block.text.includes(material) && block.sourceIds.includes(sourceId)));
  assert.ok(second.events.some(event => event.kind === "INVESTIGATION_INPUT_CHANGED"));
  assert.equal(context.pages().length, 0);
  page = await openPage();
  await page.goto(app + "/v2/workbench?missionId=" + missionId);
  journey[scenario] = { missionId, closedAt, materialAt, savedAt: second.outputs[0].createdAt, reopenedAt: new Date().toISOString() };
  const brief = page.getByRole("region", { name: "回访变化" });
  await brief.getByRole("button", { name: "查看第 2 版修改" }).click({ timeout: 30000 });
  const comparison = page.getByRole("region", { name: "版本修改对照" });
  await comparison.getByRole("heading", { name: "第 1 版 → 第 2 版" }).waitFor();
  await comparison.getByRole("button", { name }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), new RegExp(material.slice(0, 12)));
  assert.ok(await page.getByTestId("source-excerpt").locator("mark").count(), "稿件引用应定位到原文");
  return second;
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
  const first = await savedRevision(missionId, 1);
  assert.equal(first.outputs.length, 1);
  assert.match(first.provider, /openai-compatible/);
  assert.ok(first.sources.some((source: { text: string }) => source.text.includes("登录流程")));
  await page.getByRole("button", { name: "定位原记录" }).first().click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /登录流程/);
  await page.getByText("步骤回执已保存").first().waitFor();
  assert.match(await page.locator("aside").first().innerText(), /模型调用/);
  checks.push("one confirmation created the real v2 Mission and first private version; evidence, process and provider are readable");

  const firstBrief = page.getByRole("region", { name: "回访变化" });
  await firstBrief.getByRole("button", { name: "我已看过" }).click();
  await firstBrief.getByRole("status").waitFor();
  assert.equal((await snapshot(missionId)).version, first.version);
  const second = await leaveAndReturn(missionId, "补测记录.txt", "移动端输入回归已补测；分享入口仍未验证。", "developer");
  assert.equal(second.outputs.length, 2);
  assert.equal(second.outputs[1].id, first.outputs[0].id);
  assert.equal(second.id, first.id);
  await shot("developer-return-compare.png");
  checks.push("开发场景：关闭全部页面 → 通过原材料 API 补资料 → 扫描唤醒同一 Mission → 回访直接比较 → 定位新版原文");

  const receiptIds: string[] = [];
  await page.route("**/reentry-brief", async route => {
    if (route.request().method() !== "POST") return route.continue();
    receiptIds.push(route.request().postDataJSON().requestId);
    if (receiptIds.length !== 1) return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "我已看过" }).click();
  await page.getByRole("button", { name: "重试原回执" }).click();
  await page.getByRole("region", { name: "回访变化" }).getByRole("status").waitFor();
  await page.unroute("**/reentry-brief");
  assert.equal(receiptIds.length, 2);
  assert.equal(new Set(receiptIds).size, 1);
  assert.equal((await snapshot(missionId)).version, second.version);
  checks.push("已读回执响应丢包后重试原编号，Mission 版本保持不变");

  await page.getByRole("button", { name: "请忆程核对这条" }).click();
  await page.waitForFunction(() => document.activeElement?.id === "workbench-message");
  const requestedFocus = await page.getByLabel("接下来怎么做，直接告诉忆程").inputValue();
  assert.match(requestedFocus, /补测记录.txt/);
  checks.push("从原文面板起草核对指令并聚焦输入框");

  const submit = page.waitForResponse(response => response.url().endsWith("/turns") && response.request().method() === "POST");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const turn = await submit;
  assert.equal(turn.status(), 200, await turn.text());
  assert.equal((await turn.json()).status, "ANSWERED");
  await page.getByRole("button", { name: "第 3 版", exact: true }).waitFor({ timeout: 90000 });
  let settled = await snapshot(missionId);
  for (let index = 0; index < 60 && settled.phase !== "WAITING_OBSERVATION"; index++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    settled = await snapshot(missionId);
  }
  assert.equal(settled.phase, "WAITING_OBSERVATION");
  assert.equal(settled.outputs.length, 3);
  assert.equal(settled.workingObjective, requestedFocus);
  assert.match(JSON.stringify(settled.outputs[0].blocks), /工作重点/);
  await page.getByRole("button", { name: "第 3 版", exact: true }).click();
  await page.getByLabel("对照起点").selectOption("1");
  await page.getByRole("heading", { name: "第 1 版 → 第 3 版" }).waitFor();
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

  await shot("developer-desktop.png");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole("button", { name: "补资料", exact: true }).click();
  await page.getByLabel("补充内容").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await shot("developer-mobile.png");
  checks.push("360 像素：快速打开补资料表单，无横向溢出");

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(control + "/open?scenario=research");
  await page.getByLabel("起步场景").selectOption("research");
  await page.getByLabel("这次要完成什么").fill("整理实验阶段汇报和待核对条件");
  await page.getByLabel("导入文本材料").fill("实验记录：两组使用不同数据拆分；准确率不能直接比较。");
  await page.getByRole("button", { name: "预览持续范围" }).click();
  await page.getByRole("button", { name: "确认并开始" }).click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  const researchId = new URL(page.url()).searchParams.get("missionId")!;
  assert.notEqual(researchId, missionId);
  const researchFirst = await savedRevision(researchId, 1);
  assert.notEqual(researchFirst.projectId, first.projectId);
  await page.getByRole("region", { name: "回访变化" }).getByRole("button", { name: "我已看过" }).click();
  await page.getByRole("region", { name: "回访变化" }).getByRole("status").waitFor();
  const researchSecond = await leaveAndReturn(researchId, "实验补记.txt", "实验补记：补齐拆分描述；评估脚本版本仍未知，暂不直接比较。", "research");
  assert.equal(researchSecond.outputs[1].id, researchFirst.outputs[0].id);
  await shot("research-return-compare.png");
  checks.push("科研对照：关页后补实验记录，同一委托保留旧稿，回访对照并打开新版实验依据");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(),
    entry: "normal project page -> v2 bounded delegation preview -> confirm -> workbench", missionId,
    provider: "local openai-compatible loopback mock selected by environment", data: "temporary synthetic project",
    checks, errors, journey, acceleratedReturn: true, realOvernightElapsed: false,
    realModelValidated: false, realDeviceValidated: false }, null, 2));
  console.log("V2_ENTRY_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) {
  if (!page.isClosed()) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error("Browser stopped at", page.url(), "completed:", checks);
  throw error;
} finally { await browser.close(); }
