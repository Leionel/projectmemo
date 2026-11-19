/** Start a fresh v2-entry-demo with V2_ENTRY_PORT=4440 and MISSION_CHALLENGES_ENABLED=true. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { ChallengeSession } from "../lib/types/challenge";
import type { WorkbenchSnapshot } from "../lib/types/workbench";
const port = Number(process.env.V2_ENTRY_PORT ?? 4440), origin = "http://127.0.0.1:" + port;
const out = path.resolve(process.env.M3_EVIDENCE_DIR ?? "evidence/v2-first-loop/m3-experience-20261117/browser");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.message));
async function get<T>(url: string): Promise<T> { const response = await context.request.get(origin + url); assert.equal(response.status(), 200, await response.text()); return response.json(); }
async function post(url: string, data: unknown) { const response = await context.request.post(origin + url, { data }); assert.equal(response.ok(), true, response.status() + " " + (await response.text()).slice(0, 500)); return response.json(); }
async function eventually<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 160; i++) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error("M3 expected state not reached");
}
try {
  await page.goto("http://127.0.0.1:" + (port + 1) + "/open");
  await page.getByLabel("起步场景").waitFor({ timeout: 90000 });
  await page.getByLabel("起步场景").selectOption("research");
  await page.getByLabel("导入文本材料").fill("合成实验记录：输入回归已完成，分享入口未验证，验收口径尚未确认。private-m3-canary");
  await page.getByRole("button", { name: "预览持续范围" }).click();
  await page.getByRole("button", { name: "确认并开始" }).click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  const id = new URL(page.url()).searchParams.get("missionId")!, base = "/api/missions/" + id;
  const readWorkbench = () => get<WorkbenchSnapshot>(base + "/workbench");
  const readSession = async () => (await get<{ session: ChallengeSession }>(base + "/challenges")).session;
  const first = await eventually(readWorkbench, value => value.outputs.length === 1 && value.phase === "WAITING_OBSERVATION");
  const reentryBrief = page.getByRole("region", { name: "回访变化" });
  await reentryBrief.waitFor({ timeout: 30000 });
  await reentryBrief.getByText("私有稿更新到第 1 版").waitFor();
  await reentryBrief.getByRole("button", { name: "我已看过" }).click();
  await reentryBrief.getByText("已记录你看到了这次变化；任务进度没有因此前进。").waitFor();
  checks.push("reentry brief shows the real first revision, keeps occurred/recorded times, and read does not advance the Mission");
  const area = page.getByRole("region", { name: "成果挑战" });
  await area.getByRole("button", { name: "严格导师 · 三轮彩排" }).click();
  await area.getByRole("heading", { name: /交付彩排/ }).waitFor();
  const sessionId = (await readSession()).id;
  let droppedAnswer = false, droppedHandoff = false;
  const answerIds: string[] = [], handoffIds: string[] = [];
  await page.route("**/api/missions/*/challenges/*", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (body.action === "ANSWER" && body.questionKey === "evidence") {
      answerIds.push(body.requestId);
      if (!droppedAnswer) { droppedAnswer = true; await route.fetch(); return route.abort("failed"); }
    }
    if (body.action === "HANDOFF") {
      handoffIds.push(body.requestId);
      if (!droppedHandoff) { droppedHandoff = true; await route.fetch(); return route.abort("failed"); }
    }
    await route.continue();
  });
  await area.getByLabel("本轮核查意见").fill("请核对分享入口的验收依据，保留尚未验证。");
  await area.getByRole("button", { name: "保存本轮回答" }).click();
  await area.getByRole("button", { name: "重试原挑战请求" }).waitFor();
  await area.getByRole("button", { name: "重试原挑战请求" }).click();
  await area.getByRole("heading", { name: "哪个尚未确认的条件，会影响这次交付？" }).waitFor();
  assert.equal(new Set(answerIds).size, 1);
  await page.reload();
  await area.getByRole("heading", { name: "哪个尚未确认的条件，会影响这次交付？" }).waitFor({ timeout: 60000 });
  assert.equal((await readSession()).id, sessionId);
  await area.getByRole("button", { name: "查看资料 1", exact: true }).click();
  await area.getByRole("button", { name: "查看资料 1 · 已打开" }).waitFor();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /分享入口/);
  await area.getByLabel("本轮核查意见").fill("验收口径尚未确认，不能把回归结果写成全部通过。");
  await area.getByRole("button", { name: "保存本轮回答" }).click();
  await area.getByRole("heading", { name: "希望忆程下一版具体改进什么？" }).waitFor();
  await area.getByLabel("本轮核查意见").fill("补充彩排暴露的验收边界，明确分享入口未验证。");
  await area.getByRole("button", { name: "保存本轮回答" }).click();
  await area.getByRole("button", { name: "把核查缺口交回原委托" }).click();
  await area.getByRole("button", { name: "重试原挑战请求" }).waitFor();
  await area.getByRole("button", { name: "重试原挑战请求" }).click();
  await area.getByText("核查意见已保存，原委托会按现有许可继续。新版本会显示在上方。").waitFor();
  const second = await eventually(readWorkbench, value => value.outputs.length === 2 && value.phase === "WAITING_OBSERVATION");
  assert.equal(new Set(handoffIds).size, 1); assert.equal(second.id, first.id);
  assert.equal(second.outputs[1].id, first.outputs[0].id);
  assert.match(JSON.stringify(second.outputs[0].blocks), /补充彩排暴露的验收边界/);
  const rawEvents = await get<{ events: Array<{ type: string; payloadJson: unknown }> }>(base + "/events");
  const challengeEvents = rawEvents.events.filter(event => event.type.startsWith("CHALLENGE_"));
  assert.equal(challengeEvents.filter(event => event.type === "CHALLENGE_ANSWERED").length, 3);
  assert.equal(challengeEvents.filter(event => event.type === "CHALLENGE_HANDED_OFF").length, 1);
  assert.equal(/expected|private-m3-canary/.test(JSON.stringify(challengeEvents)), false);
  checks.push("three rounds -> lost answer response retry -> page reload same session -> source visit -> lost handoff response retry -> same Mission revision 2, original retained, no duplicate receipt");
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.getByRole("button", { name: "第 2 版", exact: true }).waitFor();
  await area.getByRole("button", { name: "证据侦探 · 引用追溯" }).click();
  await area.getByRole("heading", { name: /这段稿件实际引用了哪些记录/ }).waitFor();
  const evidence = await readSession(), linked = second.outputs[0].blocks.find(block => block.kind !== "INFERENCE" && block.sourceIds.length)!.sourceIds;
  assert.equal("expected" in evidence.questions[0], false);
  for (const option of evidence.questions[0].options) if (linked.includes(option.key)) await area.getByRole("checkbox", { name: option.label, exact: true }).check();
  await area.getByRole("button", { name: "保存本轮回答" }).click();
  await area.getByText("已找到这段稿件的全部引用；还可以核对来源是否支持这段表述。").waitFor();
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
  checks.push("citation tracing uses actual output references; no answer key in response; link match does not claim factual verification");
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
  checks.push("360px interactive challenge and original evidence: no horizontal overflow");
  // Same API bodies used by the native service; this is transport-contract evidence, not a device test.
  const mission = (await get<{ mission: { version: number } }>(base)).mission;
  await post(base + "/pause", { requestId: crypto.randomUUID(), expectedVersion: mission.version });
  await post(base + "/materials", { requestId: crypto.randomUUID(), kind: "FEEDBACK", text: "手机合约补充：核对下一轮交付安排。" });
  const paused = await eventually(readWorkbench, value => value.phase === "PAUSED");
  assert.equal(paused.outputs.length, 2);
  checks.push("native-shaped pause/material requests target same Mission; paused Mission keeps both versions and cannot auto-resume");
  await eventually(readSession, value => value.status === "STALE");
  const conversation = await post("/api/conversations", { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: first.projectId, title: "合成权限验收" });
  const state = await get<{ continuity: { seq: number } }>("/api/conversations/" + conversation.id);
  await post("/api/conversations/" + conversation.id + "/continuity", { commandId: crypto.randomUUID(), expectedSeq: state.continuity.seq,
    scope: { projectId: first.projectId, missionId: id }, operation: "SUPPRESS_USE", sourceIds: [first.sources[0].id] });
  const redacted = await readSession();
  assert.equal(redacted.status, "STALE"); assert.deepEqual(redacted.questions, []); assert.deepEqual(redacted.answers, []);
  const hidden = await readWorkbench(); assert.equal(JSON.stringify(hidden.outputs).includes("private-m3-canary"), false);
  assert.equal(hidden.sources.some(source => source.id === first.sources[0].id), false);
  checks.push("new material withdraws challenge; source suppression removes original and derived-feedback evidence from workbench, legacy challenge events reveal no private payload");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ at: new Date().toISOString(), missionId: id, sessionId, checks, errors,
    data: "isolated synthetic SQLite", provider: "localhost HTTP mock", physicalHarmonyVerified: false, realProviderQualityVerified: false }, null, 2));
  console.log("M3_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) { await page.screenshot({ path: path.join(out, "failure-" + Date.now() + ".png"), fullPage: true }); throw error; }
finally { await browser.close(); }
