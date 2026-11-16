/** Standalone browser acceptance. Start scripts/v2-local-demo.ts first; uses synthetic temp data only. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = "http://127.0.0.1:" + (process.env.V2_DEMO_PORT ?? 4415);
const control = "http://127.0.0.1:" + (Number(process.env.V2_DEMO_PORT ?? 4415) + 1);
const out = path.resolve("evidence/v2-first-loop/browser"); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + response.url()); });
async function textVisible(text: string) { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" }); }
try {
  await page.goto(origin + "/v2/workbench");
  await page.getByRole("button", { name: "载入新资料样例" }).click();
  await page.getByRole("button", { name: "修改对照", exact: true }).click();
  await textVisible("第 1 版 → 第 2 版"); assert.ok(await page.locator("del").count()); assert.ok(await page.locator("ins").count());
  await page.getByRole("button", { name: "第 1 版", exact: true }).click();
  await page.getByRole("button", { name: "定位原记录" }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /登录流程/);
  await page.getByRole("button", { name: "第 2 版", exact: true }).click();
  await page.getByRole("button", { name: "成果", exact: true }).click();
  await page.getByRole("button", { name: "严格导师", exact: true }).click();
  await page.getByLabel("记下这份成果的缺口").fill("移动端输入回归的条件");
  await page.getByRole("button", { name: "交给原委托核查" }).click();
  assert.equal(await page.getByLabel("接下来怎么做，直接告诉忆程").inputValue(), "今天先核对移动端输入回归的条件");
  await page.getByRole("button", { name: "证据侦探", exact: true }).click();
  await page.getByRole("button", { name: "新反馈：移动端输入回归已补记录，分享入口仍待核对。", exact: true }).click();
  await textVisible("这份记录出现在本稿引用中");
  await page.getByRole("button", { name: "双人冲刺", exact: true }).click();
  await page.getByRole("button", { name: "开始这次分工" }).click();
  await page.getByRole("checkbox", { name: "我已核对原记录" }).check();
  await textVisible("已记下你的自述");
  await page.getByRole("button", { name: "科研对照", exact: true }).click();
  await textVisible("不同拆分条件的数据尚不能直接比较");
  checks.push("sample: version diff, original evidence, three artifact-linked games, research control");
  await page.goto(control);
  await page.getByRole("link", { name: "打开原委托成果" }).first().click();
  await page.getByRole("button", { name: "第 2 版", exact: true }).waitFor();
  const missionId = new URL(page.url()).searchParams.get("missionId")!;
  const before = await (await context.request.get(origin + "/api/missions/" + missionId + "/workbench")).json();
  assert.equal(before.phase, "WAITING_OBSERVATION"); assert.equal(before.outputs.length, 2); assert.match(before.provider, /^INJECTED/);
  await page.getByRole("button", { name: "修改对照", exact: true }).click();
  await textVisible("第 1 版 → 第 2 版");
  await page.getByRole("button", { name: "第 1 版", exact: true }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /尚未记录/);
  await page.getByRole("button", { name: "第 2 版", exact: true }).click();
  await page.getByRole("button", { name: "定位原记录" }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /分享入口/);
  const submitted = page.waitForResponse(r => r.url().endsWith("/turns") && r.request().method() === "POST");
  await page.getByLabel("接下来怎么做，直接告诉忆程").fill("继续整理，但不要联网");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await submitted; assert.equal(response.status(), 200, await response.text());
  await textVisible("输入已送达原委托的对话控制链");
  const conversation = await (await context.request.get(response.url().replace(/\/turns$/, ""))).json();
  assert.match(JSON.stringify(conversation.continuity), /不要联网/);
  checks.push("live: real persisted outputs, original AgentPresentation, exact version sources, natural veto through Conversation");
  await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
  await page.goto(control);
  await page.getByRole("button", { name: "加入新资料，观察后台接续" }).first().click();
  await page.getByRole("button", { name: "第 3 版", exact: true }).waitFor({ timeout: 30000 });
  assert.equal(new URL(page.url()).searchParams.get("missionId"), missionId);
  const after = await (await context.request.get(origin + "/api/missions/" + missionId + "/workbench")).json();
  assert.ok(after.models > before.models); assert.ok(after.tools > before.tools); assert.equal(after.outputs.length, 3);
  checks.push("closed page + new synthetic material -> existing scanner/runner -> same Mission output v3; budgets cumulative");
  // Lose the HTTP response after committing the actual directive, then retry the frozen request.
  let dropped = false;
  await page.route("**/api/conversations/*/turns", async route => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  const objective = "今天先核对分享入口的交付依据";
  await page.getByLabel("接下来怎么做，直接告诉忆程").fill(objective);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "重试原请求", exact: true }).waitFor();
  await page.getByRole("button", { name: "重试原请求", exact: true }).click();
  await textVisible("输入已送达原委托的对话控制链");
  await page.unroute("**/api/conversations/*/turns");
  await page.getByRole("button", { name: "第 4 版", exact: true }).waitFor({ timeout: 30000 });
  let settled;
  for (let i = 0; i < 40; i++) {
    settled = await (await context.request.get(origin + "/api/missions/" + missionId + "/workbench")).json();
    if (settled.phase === "WAITING_OBSERVATION") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(settled.phase, "WAITING_OBSERVATION"); assert.equal(settled.outputs.length, 4);
  assert.equal(settled.workingObjective, objective); assert.match(JSON.stringify(settled.outputs[0].blocks), /今天先核对分享入口/);
  await page.getByRole("button", { name: "重新读取" }).click();
  await textVisible("稿件已备好，继续留意变化");
  checks.push("natural objective -> same Mission output v4 -> await_event; lost response retries same request without duplicate draft");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole("button", { name: "成果", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
  checks.push("360px: no horizontal overflow");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(), provider: "INJECTED_V2_FIXTURE",
    data: "temporary synthetic projects", checks, errors, modelQualityValidated: false, realDeviceValidated: false }, null, 2));
  console.log("WORKBENCH_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  console.error("Browser stopped at", page.url(), "completed:", checks);
  throw error;
} finally { await browser.close(); }
