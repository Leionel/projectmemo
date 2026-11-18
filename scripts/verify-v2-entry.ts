/** Browser acceptance for the normal product entry. Start scripts/v2-entry-demo.ts first. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, request as apiRequest } from "playwright";
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
async function addMaterial(missionId: string, name: string, material: string, revision: number) {
  const added = await context.request.post(app + "/api/missions/" + missionId + "/materials",
    { data: { requestId: crypto.randomUUID(), kind: "MATERIAL", name, text: material } });
  assert.equal(added.ok(), true, await added.text());
  const materialAt = new Date().toISOString();
  const { sourceId } = await added.json();
  const saved = await savedRevision(missionId, revision);
  assert.ok(saved.outputs[0].blocks.some(block => block.text.includes(material) && block.sourceIds.includes(sourceId)));
  assert.ok(saved.events.some(event => event.kind === "INVESTIGATION_INPUT_CHANGED"));
  return { saved, materialAt };
}
async function leaveAndReturn(missionId: string, name: string, material: string, scenario: string, next?: { name: string; text: string }) {
  await page.close();
  const closedAt = new Date().toISOString();
  assert.equal(context.pages().length, 0);
  const { saved, materialAt } = await addMaterial(missionId, name, material, 2);
  const current = next ? (await addMaterial(missionId, next.name, next.text, 3)).saved : saved;
  const revision = current.outputs[0].revision;
  assert.equal(context.pages().length, 0);
  page = await openPage();
  await page.goto(app + "/projects/" + current.projectId);
  journey[scenario] = { missionId, closedAt, materialAt, savedAt: current.outputs[0].createdAt, reopenedAt: new Date().toISOString() };
  const review = page.getByRole("region", { name: "项目回访" }).getByRole("link", { name: "查看第 " + revision + " 版" });
  await review.waitFor({ timeout: 30000 });
  if (next) await shot("developer-project-return.png");
  await review.click();
  const comparison = page.getByRole("region", { name: "版本修改对照" });
  await comparison.getByRole("heading", { name: "第 1 版 → 第 " + revision + " 版" }).waitFor();
  await comparison.getByRole("button", { name }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), new RegExp(material.slice(0, 12)));
  assert.ok(await page.getByTestId("source-excerpt").locator("mark").count(), "稿件引用应定位到原文");
  return current;
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
  const returned = await leaveAndReturn(missionId, "补测记录.txt", "移动端输入回归已补测；分享入口仍未验证。", "developer",
    { name: "发布范围.txt", text: "本次发布限于文字导入和回访对照，外发功能留待确认。" });
  assert.equal(returned.outputs.length, 3);
  assert.equal(returned.outputs[2].id, first.outputs[0].id);
  assert.equal(returned.id, first.id);
  await shot("developer-return-compare.png");
  checks.push("开发场景：关闭全部页面 → 两次补资料唤醒同一委托 → 项目首页直达第 1 版到第 3 版对照 → 定位原文");

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
  assert.equal((await snapshot(missionId)).version, returned.version);
  checks.push("已读回执响应丢包后重试原编号，Mission 版本保持不变");

  await page.getByRole("button", { name: "请忆程核对这条" }).click();
  await page.waitForFunction(() => document.activeElement?.id === "workbench-message");
  const requestedFocus = await page.getByLabel("接下来怎么做，直接告诉忆程").inputValue();
  assert.match(requestedFocus, /补测记录.txt/);
  checks.push("从原文面板起草核对指令并聚焦输入框");

  await page.getByRole("button", { name: "预览交付稿" }).click();
  const downloadButton = page.getByRole("button", { name: "下载 Markdown" });
  await downloadButton.waitFor();
  await shot("developer-delivery.png");
  const downloaded = page.waitForEvent("download");
  await downloadButton.click();
  const file = await downloaded;
  assert.match(file.suggestedFilename(), /第3版\.md$/);
  const markdown = fs.readFileSync((await file.path())!, "utf8");
  for (const fragment of ["第 1 版 → 第 3 版", "待确认项", "补测记录.txt", "发布范围.txt"]) assert.ok(markdown.includes(fragment), fragment);
  await page.getByRole("button", { name: "预览归入项目周报" }).click();
  await page.getByRole("button", { name: "确认保存并向项目成员共享" }).waitFor();
  await page.getByRole("button", { name: "取消归入" }).click();
  await page.getByRole("button", { name: "收起预览" }).click();
  checks.push("所选版本可预览并下载 Markdown，周报归入仍需单独确认");

  const submit = page.waitForResponse(response => response.url().endsWith("/turns") && response.request().method() === "POST");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const turn = await submit;
  assert.equal(turn.status(), 200, await turn.text());
  assert.equal((await turn.json()).status, "ANSWERED");
  await page.getByRole("button", { name: "第 4 版", exact: true }).waitFor({ timeout: 90000 });
  let settled = await snapshot(missionId);
  for (let index = 0; index < 60 && settled.phase !== "WAITING_OBSERVATION"; index++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    settled = await snapshot(missionId);
  }
  assert.equal(settled.phase, "WAITING_OBSERVATION");
  assert.equal(settled.outputs.length, 4);
  assert.equal(settled.workingObjective, requestedFocus);
  assert.match(JSON.stringify(settled.outputs[0].blocks), /工作重点/);
  await page.getByRole("button", { name: "第 4 版", exact: true }).click();
  await page.getByLabel("对照起点").selectOption("1");
  await page.getByRole("heading", { name: "第 1 版 → 第 4 版" }).waitFor();
  checks.push("自然语言改道生成第 4 版，原委托回到继续观察");

  await page.getByRole("button", { name: /交付彩排/ }).click();
  await page.getByRole("button", { name: "开始三轮彩排" }).click();
  const answers = ["补测记录只验证了移动端输入回归。", "系统分享还没有通过真机验证。", "发布说明应明确系统分享为待确认。"];
  for (const [index, answer] of answers.entries()) {
    await page.getByText("第 " + (index + 1) + " / 3 轮", { exact: false }).first().waitFor();
    await page.locator('textarea[id^="rehearsal-"]').fill(answer);
    await page.getByRole("button", { name: "回答并继续" }).click();
  }
  await page.getByRole("button", { name: "交回原委托" }).click();
  const fifth = await savedRevision(missionId, 5);
  const feedback = fifth.sources.find(source => source.text.includes(answers[2]));
  assert.ok(feedback && fifth.outputs[0].blocks.some(block => block.sourceIds.includes(feedback.id)));
  await page.getByRole("button", { name: "查看反馈关联改动" }).click({ timeout: 30000 });
  const feedbackCompare = page.getByRole("region", { name: "版本修改对照" });
  await feedbackCompare.getByRole("heading", { name: "第 4 版 → 第 5 版" }).waitFor();
  assert.match(await feedbackCompare.innerText(), /发布说明应明确系统分享为待确认/);
  await shot("developer-feedback-compare.png");
  checks.push("交付彩排反馈重新唤醒原委托，第 5 版逐条定位引用反馈的变化");

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

  const authCookie = (await context.cookies(app)).find(cookie => cookie.name === "pm_session");
  assert.ok(authCookie);
  const mobile = await apiRequest.newContext({ baseURL: app, extraHTTPHeaders: { Authorization: "Bearer " + decodeURIComponent(authCookie.value) } });
  try {
    const missionPath = "/api/missions/" + researchId, projectPath = "/api/projects/" + researchFirst.projectId;
    const filename = "手机补记.txt", sharedText = "手机补记：仅对同一拆分和评估脚本版本的两组记录作比较。";
    const extracted = await mobile.post(projectPath + "/material-extract", { multipart: {
      file: { name: filename, mimeType: "text/plain", buffer: Buffer.from(sharedText, "utf8") },
    } });
    assert.equal(extracted.status(), 200, await extracted.text());
    const { text } = await extracted.json();
    const preview = await mobile.post(missionPath + "/materials/preview", { data: { name: filename, text } });
    assert.equal(preview.status(), 200, await preview.text());
    assert.deepEqual((await preview.json()).target, {
      missionId: researchId, projectId: researchFirst.projectId, goal: researchSecond.goal, status: researchSecond.status,
    });
    assert.equal((await snapshot(researchId)).version, researchSecond.version);
    const addition = { requestId: crypto.randomUUID(), kind: "MATERIAL", name: filename, text };
    const initialAdd = await mobile.post(missionPath + "/materials", { data: addition });
    assert.ok(initialAdd.ok(), await initialAdd.text()); // Deliberately ignore its receipt, as on a lost response.
    const repeatedAdd = await mobile.post(missionPath + "/materials", { data: addition });
    assert.equal(repeatedAdd.status(), 200, await repeatedAdd.text());
    const { sourceId, replayed } = await repeatedAdd.json();
    assert.equal(replayed, true);
    const shared = await savedRevision(researchId, 3);
    assert.equal(shared.outputs[0].blocks.flatMap(block => block.sourceIds).filter(id => id === sourceId).length, 1);
    await page.goto(app + "/projects/" + shared.projectId);
    await page.getByRole("region", { name: "项目回访" }).getByRole("link", { name: "查看第 3 版" }).click();
    await page.getByRole("heading", { name: "第 1 版 → 第 3 版" }).waitFor();
    const mobileView = await mobile.get(missionPath + "/workbench");
    assert.equal(mobileView.status(), 200, await mobileView.text());
    const mobileSnapshot: WorkbenchSnapshot = await mobileView.json();
    assert.equal(mobileSnapshot.id, researchId);
    assert.equal(mobileSnapshot.outputs[0].id, shared.outputs[0].id);
    const read = { requestId: crypto.randomUUID(), seenSeq: 0, seenOutputRevision: 3 };
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await mobile.post(missionPath + "/reentry-brief", { data: read });
      assert.equal(reply.status(), 200, await reply.text());
      assert.equal((await reply.json()).lastSeenOutputRevision, 3);
    }
    assert.equal((await snapshot(researchId)).version, shared.version);
    await page.goto(app + "/projects/" + shared.projectId);
    assert.equal(await page.getByRole("region", { name: "项目回访" }).getByRole("link", { name: "查看第 3 版" }).count(), 0);
    const pause = { requestId: crypto.randomUUID(), expectedVersion: shared.version };
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await mobile.post(missionPath + "/pause", { data: pause });
      assert.ok(reply.ok(), await reply.text());
    }
    const pausedShared = await snapshot(researchId);
    assert.equal(pausedShared.status, "PAUSED");
    assert.equal(pausedShared.version, shared.version + 1);
    assert.equal(pausedShared.outputs[0].id, shared.outputs[0].id);
    checks.push("跨端 API 演练：原生 Bearer 材料确认与重试 → Web 回访同稿 → 手机已读、暂停各重试一次，幂等且两端状态一致");
  } finally { await mobile.dispose(); }

  await page.goto(control + "/open?scenario=research");
  await page.getByLabel("这次要完成什么").fill("整理本轮验收报告");
  await page.getByLabel("导入文本材料").fill("第一批验收仅检查已记录的拆分与评估条件。");
  await page.getByRole("button", { name: "预览持续范围" }).click();
  await page.getByRole("button", { name: "确认并开始" }).click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  const questionMissionId = new URL(page.url()).searchParams.get("missionId")!;
  const prompt = "这轮验收采用哪个口径？";
  await page.getByText(prompt, { exact: true }).waitFor({ timeout: 60000 });
  await page.goto(app + "/projects/" + researchFirst.projectId);
  await page.getByRole("region", { name: "项目回访" }).getByRole("link", { name: "回答原问题" }).click();
  const question = page.getByRole("region", { name: "原问题答复" });
  await question.getByText(prompt, { exact: true }).waitFor();
  await shot("research-original-question.png");
  await question.getByLabel("补充信息").fill("仅使用第一批验收记录，缺少拆分条件的条目不直接比较。");
  const answering = page.waitForResponse(response => response.url().endsWith("/" + questionMissionId + "/input"));
  await question.getByRole("button", { name: "补充并继续" }).click();
  const input = await answering;
  assert.equal(input.ok(), true, await input.text());
  assert.ok(input.request().postDataJSON().questionId, "必须绑定原问题");
  await page.getByText("原问题答复已提交", { exact: false }).waitFor();
  const answered = await savedRevision(questionMissionId, 1);
  assert.ok(answered.events.some(event => event.kind === "INPUT"), "原问题答复必须出现在过程回执");
  checks.push("从项目首页回答委托的原问题，原 API 收到 questionId，答复回执与后续成果均可核对");
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
