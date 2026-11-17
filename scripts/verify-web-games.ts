/**
 * Web 玩法生产包验收：隔离库 → 迁移 → 合成数据 → next start → 真实浏览器流程 → 截图与回执。
 * 只操作 prisma/projectmemo-web-games.db；不读取、不写入真实项目。
 *
 * 前置：npm.cmd run build（NEXT_DIST_DIR=.next-webgames）
 * 运行：npm.cmd exec tsx -- scripts/verify-web-games.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import { xlsxMaterial } from "./fixtures/xlsx-material";

const ROOT = process.cwd();
const DB_PATH = path.resolve(ROOT, "prisma", "projectmemo-web-games.db");
const DB_URL = "file:" + DB_PATH.replaceAll("\\", "/");
const OUT = path.resolve(ROOT, "evidence/v2-first-loop/web-games-20261117");
const SCREENS = path.join(OUT, "screens");
const PORT = Number(process.env.WEB_GAMES_PORT ?? "4320");
const BASE = "http://127.0.0.1:" + PORT;
const DIST = process.env.NEXT_DIST_DIR || ".next-webgames";

if (!DB_PATH.startsWith(path.resolve(ROOT, "prisma")) || !DB_PATH.includes("web-games")) throw new Error("拒绝操作非演示数据库：" + DB_PATH);
if (!fs.existsSync(path.join(ROOT, DIST, "BUILD_ID"))) throw new Error("找不到生产构建：" + DIST + "，请先运行 npm.cmd run build");
fs.mkdirSync(SCREENS, { recursive: true });
for (const name of fs.readdirSync(SCREENS)) if (name.endsWith(".png")) fs.rmSync(path.join(SCREENS, name), { force: true });
let MISSION_ID = "";

const ENV = {
  ...process.env,
  DATABASE_URL: DB_URL,
  NEXT_DIST_DIR: DIST,
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_WEB_ENABLED: "true",
  MISSION_V2_ENABLED: "true", MISSION_CHALLENGES_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", LLM_MODE: "mock",
  FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true",
  FOCUS_WEB_ENABLED: "true", FOCUS_ASYNC_ENABLED: "false", MISSION_EVENT_CONTINUATION_ENABLED: "true",
};

const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log((pass ? "PASS " : "FAIL ") + name + (detail ? " · " + detail : ""));
  if (!pass) throw new Error("验收失败：" + name + (detail ? " · " + detail : ""));
}

function resetDatabase() {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) fs.rmSync(DB_PATH + suffix, { force: true });
  const prisma = path.resolve(ROOT, "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prisma, "migrate", "deploy"], { cwd: ROOT, env: ENV, encoding: "utf8" });
  if (result.status !== 0) throw new Error("迁移失败：\n" + result.stdout + "\n" + result.stderr);
}

async function startServer() {
  const child = spawn(process.execPath, [path.resolve(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(PORT)],
    { cwd: ROOT, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", chunk => { log += String(chunk); });
  child.stderr?.on("data", chunk => { log += String(chunk); });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(BASE + "/login");
      if (response.ok && (await response.text()).includes("<!DOCTYPE html>")) return { child, log: () => log };
    } catch { /* not ready */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  child.kill("SIGTERM");
  throw new Error("生产包未能启动：\n" + log);
}

async function login(page: Page) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', "web-games-reviewer");
  await page.fill('input[name="password"]', "web-games-reviewer-password");
  await Promise.all([page.waitForURL(/\/projects|\/focus|\/v2/).catch(() => {}), page.click('button[type="submit"]')]);
  await page.goto(BASE + "/v2/workbench?missionId=" + encodeURIComponent(MISSION_ID), { waitUntil: "networkidle" });
}

async function shot(page: Page, name: string) { await page.screenshot({ path: path.join(SCREENS, name + ".png"), fullPage: true }); }
async function openGame(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).first().click(); await page.waitForTimeout(900); }

async function main() {
  resetDatabase();
  Object.assign(process.env, ENV);
  const { seedWebGamesFixture } = await import("./web-games-fixture");
  const { db } = await import("../lib/db");
  const fixture = await seedWebGamesFixture();
  MISSION_ID = fixture.mission.id;
  // 合成租约持有者：真实 Worker 会续租；这里延长到 1 小时，只是让冲刺可启动，不推进任何业务状态。
  await db.agentMission.update({ where: { id: fixture.mission.id }, data: { leaseUntil: new Date(Date.now() + 3600_000) } });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await login(page);
    await shot(page, "01-workbench-1440");
    check("工作台显示玩法入口", await page.getByRole("button", { name: "证据侦探", exact: true }).count() === 1);
    const mascotResponse = await page.request.get(BASE + "/mascot/bookmark-spirit/v1/web/idle.png");
    check("生产包角色素材可访问", mascotResponse.status() === 200 && (mascotResponse.headers()["content-type"] ?? "").includes("image/png"));
    const xlsxResult = await page.evaluate(async ({ b64, projectId }) => {
      const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));
      const form = new FormData();
      form.append("file", new File([bytes], "发布记录.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const response = await fetch("/api/projects/" + projectId + "/material-extract", { method: "POST", body: form });
      return { status: response.status, body: await response.text() };
    }, { b64: Buffer.from(xlsxMaterial()).toString("base64"), projectId: fixture.project.id });
    const xlsxBody = JSON.parse(xlsxResult.body) as { format?: string; text?: string };
    check("生产包 XLSX 提取可用", xlsxResult.status === 200 && xlsxBody.format === "XLSX_TEXT" && String(xlsxBody.text).includes("工作表：发布记录"), "status=" + xlsxResult.status + " body=" + xlsxResult.body.slice(0, 300));

    // 证据侦探：启动、原文、选择、核对、刷新、交回
    await openGame(page, "证据侦探");
    const startEvidence = page.getByRole("button", { name: /开始引用追溯/ });
    if (await startEvidence.count()) await startEvidence.click();
    await page.getByRole("button", { name: "打开原文" }).first().click();
    await page.waitForTimeout(700);
    check("原文阅读定位到相关段落", (await page.locator('[aria-label="原文阅读"]').innerText()).includes("已定位到与稿件最接近的段落"));
    check("客户合成来源名称可读", (await page.locator("article").first().innerText()).includes("输入回归记录（节选）.txt"));
    await page.getByRole("button", { name: "选择这条" }).first().click();
    await page.getByRole("button", { name: "选择这条" }).first().click();
    check("多选进入引用槽", (await page.locator("main").innerText()).includes("已放入 2 条引用"));
    await shot(page, "02-evidence-selected-1440");
    await page.getByRole("button", { name: "核对引用" }).click();
    await page.getByRole("heading", { name: "引用关系已对上" }).waitFor({ timeout: 15_000 });
    check("服务端 verdict 显示关系已对上", (await page.locator("main").innerText()).includes("内容仍待核验"));
    await shot(page, "03-evidence-verified-1440");
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "证据侦探");
    check("刷新后恢复同一轮与已选引用", (await page.locator("main").innerText()).includes("已选 2 条"));
    check("刷新后原文仍可读", (await page.locator('[aria-label="原文阅读"]').count()) === 1);
    await page.getByRole("button", { name: /把缺口交回改稿/ }).click();
    await page.locator('[aria-label="交回回执"]').waitFor({ timeout: 15_000 });
    check("交回后显示接收回执", (await page.locator('[aria-label="交回回执"]').innerText()).includes("已接收"));
    await shot(page, "04-evidence-receipt-1440");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "证据侦探");
    await shot(page, "05-evidence-receipt-1280");
    check("1280 无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "证据侦探");
    await shot(page, "06-evidence-360");
    check("360 可读且无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    // 删除回答：撤下回执与反馈副本
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "证据侦探");
    const remove = page.getByRole("button", { name: "删除本轮回答" });
    if (await remove.count()) {
      await remove.click(); await page.waitForTimeout(200);
      await page.getByRole("button", { name: "确认删除回答" }).click();
      await page.waitForTimeout(1200);
      check("删除后不再展示交回回执", (await page.locator('[aria-label="交回回执"]').count()) === 0);
      const feedback = await db.capture.findFirstOrThrow({ where: { projectId: fixture.project.id, sourceType: "CHALLENGE_FEEDBACK" } });
      check("删除后反馈副本已逻辑清除", feedback.rawText === "本轮核查回答已删除。");
      await shot(page, "07-evidence-deleted-1440");
      const exit = page.getByRole("button", { name: "退出本轮" });
      if (await exit.count()) { await exit.click(); await page.waitForTimeout(700); }
    }

    // 严格导师：第一轮模拟丢包后重试原请求
    await openGame(page, "交付彩排");
    const startMentor = page.getByRole("button", { name: /开始三轮彩排/ });
    if (await startMentor.count()) await startMentor.click();
    await page.locator('textarea[id^="rehearsal-"]').waitFor({ timeout: 15_000 });
    let aborted = false;
    await page.route("**/challenges/*", async route => {
      if (!aborted && route.request().method() === "POST") { aborted = true; await route.abort("failed"); } else await route.continue();
    });
    await page.locator('textarea[id^="rehearsal-"]').fill("输入回归测试通过；系统分享尚未真机验证，这条边界要保留。");
    await page.getByRole("button", { name: "回答并继续" }).click();
    await page.getByRole("button", { name: /重试原请求/ }).waitFor({ timeout: 15_000 });
    check("丢包后保留回答并提示重试", await page.locator('textarea[id^="rehearsal-"]').inputValue() !== "");
    await page.unroute("**/challenges/*");
    await page.getByRole("button", { name: /重试原请求/ }).click();
    await page.waitForTimeout(1700);
    check("重试原请求后进入第二轮", (await page.locator("main").innerText()).includes("第 2 / 3 轮"));
    const answers = ["系统分享的真机验证和验收口径尚未确认；这处我还不知道，需要项目负责人确认。", "下一版保留未验证状态，补充真机验证计划，不写成已完成。"];
    for (const answer of answers) {
      await page.locator('textarea[id^="rehearsal-"]').fill(answer);
      await page.getByRole("button", { name: "回答并继续" }).click();
      await page.waitForTimeout(1500);
    }
    check("三轮意见整理为原文/建议", (await page.locator("main").innerText()).includes("3 条改稿意见已整理"));
    await shot(page, "08-mentor-preview-1440");
    await page.getByRole("button", { name: "交回原委托" }).click();
    await page.locator('[aria-label="交回回执"]').waitFor({ timeout: 15_000 });
    await shot(page, "09-mentor-receipt-1440");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "交付彩排");
    await shot(page, "10-mentor-receipt-1280");

    // 双人冲刺：真实 Step/Output 回执、自述、结束不暂停
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openGame(page, "双人冲刺");
    await page.locator("#sprint-objective").fill("核对报告中的两条引用");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent?.trim() === "一起推进" && !button.disabled));
    await page.getByRole("button", { name: "一起推进" }).click();
    await page.waitForTimeout(1200);
    const latest = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: fixture.mission.id }, orderBy: { revision: "desc" } });
    const previous = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: fixture.mission.id, revision: 1 } });
    await db.agentMissionStep.create({ data: { missionId: fixture.mission.id, ordinal: 1, planRevision: 1, toolName: "read_project_material", status: "SUCCEEDED",
      canonicalInputJson: {}, inputHash: "verify-sprint-step", readSetJson: [], finishedAt: new Date() } });
    await db.agentMissionOutput.create({ data: { missionId: fixture.mission.id, revision: latest.revision + 1, kind: "NOTE",
      contentJson: { blocks: [{ blockId: "sprint", kind: "PROJECT_OBSERVATION", text: "输入回归已通过；系统分享仍待真机验证。", sourceIds: [] }], missingInformation: ["真机分享仍待核对"] },
      sourceRefsJson: previous.sourceRefsJson as unknown as object[], claimChecksJson: [] } });
    await db.$transaction(async tx => {
      const updated = await tx.agentMission.update({ where: { id: fixture.mission.id }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
      await tx.agentMissionEvent.create({ data: { missionId: fixture.mission.id, seq: updated.nextEventSeq, type: "CHALLENGE_SOURCE_OPENED",
        payloadJson: { challengeId: "verify-sprint", sourceKey: "capture:record@hash" } } });
    });
    await page.waitForTimeout(5000);
    check("冲刺显示真实步骤回执", (await page.locator("main").innerText()).includes("读取资料"));
    check("冲刺只在保存后显示打开新稿", (await page.locator("main").innerText()).includes("打开新稿"));
    await shot(page, "11-sprint-active-1440");
    const selfReport = page.getByRole("checkbox", { name: /我核对完了/ });
    await selfReport.click();
    await page.waitForTimeout(1200);
    check("自述写入服务端", await selfReport.isChecked());
    const directive = page.getByPlaceholder("先核对引用，暂时不要扩写");
    await directive.fill("先核对引用，暂时不要扩写");
    await directive.press("Enter");
    await page.waitForTimeout(3500);
    const conversation = await db.conversation.findFirst({ where: { ownerUserId: fixture.user.id, scope: "PROJECT" }, orderBy: { createdAt: "desc" } });
    const turn = conversation ? await db.conversationTurn.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" } }) : null;
    const applied = await db.agentMissionEvent.findFirst({ where: { missionId: fixture.mission.id, type: "NATURAL_CONTROL_APPLIED" } });
    const note = await page.locator('[class*="directiveNote"]').last().innerText().catch(() => "");
    check("冲刺改道进入原对话链", !!turn, "turn=" + (turn ? "yes" : "no") + " note=" + note.slice(0, 120));
    check("冲刺改道以应用结果为准", !!applied || note.length > 0, "applied=" + !!applied + " note=" + note.slice(0, 120));
    await shot(page, "11b-sprint-directive-1440");
    const end = page.getByRole("button", { name: "结束本轮" });
    await end.click();
    await page.waitForTimeout(1500);
    check("结束后显示本轮留下了什么", (await page.locator("main").innerText()).includes("这一轮，留下了什么"));
    const missionAfterEnd = await db.agentMission.findUniqueOrThrow({ where: { id: fixture.mission.id } });
    check("结束冲刺不暂停原委托", missionAfterEnd.status === "RUNNING" && missionAfterEnd.pauseRequestedAt === null);
    check("结束后不吸收后来产物", (await page.locator("main").innerText()).includes("1 份新稿"));
    await shot(page, "12-sprint-wrap-1440");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "双人冲刺");
    await shot(page, "13-sprint-wrap-1280");

    // 暂停原委托是独立动作
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "双人冲刺");
    await page.getByRole("button", { name: "暂停原委托" }).click();
    await page.getByRole("button", { name: "确认暂停原委托" }).click();
    await page.waitForTimeout(1500);
    const paused = await db.agentMission.findUniqueOrThrow({ where: { id: fixture.mission.id } });
    check("暂停原委托独立生效", paused.pauseRequestedAt !== null || paused.status === "PAUSED", "status=" + paused.status + " requested=" + (paused.pauseRequestedAt !== null));
    await shot(page, "14-sprint-paused-1440");

    // 角色素材与 reduced-motion
    const reduced = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await login(reduced);
    await openGame(reduced, "双人冲刺");
    const motion = await reduced.evaluate(() => {
      const image = document.querySelector('[data-testid^="bookmark-spirit-"]') as HTMLImageElement | null;
      if (!image) return { found: false, animation: "", src: "", naturalWidth: 0 };
      return { found: true, animation: getComputedStyle(image).animationName, src: image.getAttribute("src") ?? "", naturalWidth: image.naturalWidth };
    });
    check("角色图片来自白名单且已加载", motion.found && motion.naturalWidth > 0 && motion.src.startsWith("/mascot/bookmark-spirit/v1/web/"));
    check("reduced-motion 关闭角色动画", motion.animation === "none");
    await shot(reduced, "15-reduced-motion-1440");
    await reduced.close();

    // 来源变化撤题
    await db.capture.updateMany({ where: { projectId: fixture.project.id, sourceType: "TEXT" }, data: { rawText: "来源已修订：分享仍未真机验证。" } });
    await page.reload({ waitUntil: "networkidle" });
    await openGame(page, "交付彩排");
    await page.waitForTimeout(900);
    check("来源变化后挑战撤题", (await page.locator("main").innerText()).includes("已撤下") || (await page.locator("main").innerText()).includes("从当前版本重新开始"), (await page.locator("main").innerText()).slice(-300));
    await shot(page, "16-source-stale-1440");

    const receipt = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), base: BASE, build: DIST, database: DB_PATH,
      data: "SYNTHETIC_ONLY（隔离 SQLite；无真实项目、真实模型或外部写入）",
      checks, screenshots: fs.readdirSync(SCREENS).filter(name => name.endsWith(".png")).sort(),
      notes: [
        "冲刺中的步骤与第 2 版由验收脚本直接写入持久表，模拟真实 Worker 回执；未调用模型。",
        "暂停原委托在收尾执行，演示库保留 PAUSED 状态供复查。",
        "未验证：真机、真实模型质量、72h、滚动升级、原生 XLSX 选择器。",
      ],
    };
    fs.writeFileSync(path.join(OUT, "browser-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    console.log("receipt", path.join(OUT, "browser-receipt.json"));
  } finally {
    await browser.close().catch(() => {});
    server.child.kill("SIGTERM");
    await db.$disconnect().catch(() => {});
  }
}

await main();
