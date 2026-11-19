/** Browser acceptance for non-creation Skill delivery. Start scripts/v2-entry-demo.ts first. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const entryPort = Number(process.env.V2_ENTRY_PORT ?? 4420);
const control = "http://127.0.0.1:" + (entryPort + 1);
const app = "http://127.0.0.1:" + entryPort;
const out = path.resolve(process.env.V2_STAGE_EVIDENCE_DIR ?? "evidence/v2-first-loop/stage-artifacts/browser");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + response.url()); });
try {
  await page.goto(control);
  await page.getByRole("link", { name: "打开项目并完成一次托付" }).click();
  await page.getByRole("heading", { name: "交给忆程持续跟进" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByLabel("这次要完成什么").fill("这次只做计划，报告不要动");
  await page.getByText("补资料或选场景", { exact: true }).click();
  await page.getByLabel("导入文本材料").fill("课程要求：提交设计说明与 SQL 脚本；截止日期未写明；评分口径未给出。");
  const prepare = page.getByRole("button", { name: "交给忆程跟进", exact: true });
  for (let index = 0; index < 40 && !(await prepare.isEnabled()); index++) await page.waitForTimeout(250);
  await prepare.click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  const missionId = new URL(page.url()).searchParams.get("missionId")!;
  await page.getByRole("heading", { name: "阶段成果" }).waitFor({ timeout: 90000 });
  const view = await (await context.request.get(app + "/api/missions/" + missionId + "/workbench")).json();
  assert.equal(view.outputs.length, 0, "只做计划不应生成报告稿");
  assert.equal(view.stageArtifacts.length, 1);
  assert.equal(view.stageArtifacts[0].skillId, "project-planning");
  assert.equal(view.phase, "PAUSED");
  assert.equal(view.reasonCode, "SKILL_DELIVERABLE_READY");
  assert.ok(view.stageArtifacts[0].blocks.some((block: { sourceIds: string[] }) => block.sourceIds.length > 0));
  assert.match(JSON.stringify(view.stageArtifacts[0].unknowns), /未知|未写明/);
  assert.ok(view.sources.length >= 1);
  checks.push("normal entry: plan-only delegation delivered a viewable, source-backed stage artifact and no report revision");
  await page.getByRole("button", { name: "定位原记录" }).first().click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /课程要求/);
  checks.push("stage artifact sources resolve to the original imported material");
  await page.getByRole("button", { name: "继续跟进" }).click();
  await page.getByText("已恢复跟进；阶段成果与原报告都保留。").waitFor({ timeout: 30000 });
  let mission = await (await context.request.get(app + "/api/missions/" + missionId)).json();
  for (let index = 0; index < 40 && mission.mission.status !== "READY" && mission.mission.status !== "WAITING_INPUT"; index++) {
    await page.waitForTimeout(250);
    mission = await (await context.request.get(app + "/api/missions/" + missionId)).json();
  }
  assert.ok(["READY", "WAITING_INPUT"].includes(mission.mission.status));
  checks.push("resume is explicit and recoverable; delivered artifact and report stay untouched");
  await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
  checks.push("360px: no horizontal overflow");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(), missionId,
    entry: "project page -> delegation preview/confirm -> workbench stage artifact", provider: "loopback mock selected by env",
    data: "temporary synthetic project", checks, errors, realModelValidated: false, realDeviceValidated: false }, null, 2));
  console.log("STAGE_ARTIFACT_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  console.error("Browser stopped at", page.url(), "completed:", checks);
  throw error;
} finally { await browser.close(); }
