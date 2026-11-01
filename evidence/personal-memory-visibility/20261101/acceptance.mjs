/**
 * 记忆可见性与控制 · 真实服务读回验收（独立库、独立端口）
 *
 * 覆盖：正常页面入口互通 → 空状态 → 添加 → 读回 → 详情/来源/使用 → 修改 → 409 冲突
 *       → 暂停 → 导出 → 候选默认空 → 删除清除状态 → 换账号不串号 → 未登录 401。
 * 数据：合成账号与合成偏好文本；不连接开发库/生产库。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const NEWLINE = String.fromCharCode(10);
let PORT = 0;
const BASE = () => "http://127.0.0.1:" + PORT;

async function pickPort() {
  for (let candidate = 5310; candidate < 5390; candidate++) {
    const free = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port in 5310-5390");
}
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : ""));
}

// 数据库由调用方准备（独立临时库 + migrate deploy + 合成账号），脚本只负责服务器与验收。
const DATABASE_URL = process.env.VISIBILITY_DATABASE_URL;
if (!DATABASE_URL) { console.error("missing VISIBILITY_DATABASE_URL"); process.exit(1); }
const env = { ...process.env, DATABASE_URL, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" };

PORT = await pickPort();
const server = spawn("npx.cmd", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...env, NODE_ENV: "production" }, shell: true, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch(BASE() + "/api/auth/capabilities", { signal: AbortSignal.timeout(8000) }); if (response.ok) return true; } catch { /* not up */ }
    if (i % 5 === 0) console.log("WAIT " + i + " log=" + serverLog.replace(/\s+/g, " ").slice(-300));
    await sleep(2000);
  }
  return false;
}
async function api(pathname, init = {}, cookie = "") {
  const response = await fetch(BASE() + pathname, { ...init, signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, cookie: response.headers.get("set-cookie") ?? "" };
}

try {
  if (!await waitReady()) throw new Error("server did not start: " + serverLog.slice(-1500));

  const loginA = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "vis-a", password: "fixture-password-123" }) });
  record("A 账号登录成功", loginA.status === 200, "status=" + loginA.status);
  const cookieA = loginA.cookie.split(";")[0];

  const projectPage = await api("/memory", {}, cookieA);
  const projectHtml = String(projectPage.body);
  record("/memory 可访问且含个人记忆/项目记忆两个范围", projectPage.status === 200
    && projectHtml.includes("个人记忆") && projectHtml.includes("项目记忆"));

  const personalPage = await api("/settings/memory", {}, cookieA);
  const personalHtml = String(personalPage.body);
  record("/settings/memory 可访问且可返回项目记忆", personalPage.status === 200
    && personalHtml.includes("我的记忆") && personalHtml.includes("项目记忆"));

  // 用户菜单是客户端展开的：用真实浏览器点击后检查，而不是检查 SSR 字符串。
  {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addCookies([{ name: cookieA.split("=")[0], value: cookieA.split("=").slice(1).join("="), url: BASE() }]);
      const page = await context.newPage();
      await page.goto(BASE() + "/focus", { waitUntil: "domcontentloaded" });
      await page.locator('button:has-text("可见性甲"), button:has-text("vis-a")').first().click();
      await page.getByRole("link", { name: "我的记忆" }).waitFor({ state: "visible", timeout: 10000 });
      record("浏览器点击用户菜单后可见“我的记忆”入口", true);
      console.log("HIST after /focus:", await page.evaluate(() => history.length + " " + location.pathname));
      await page.getByRole("link", { name: "我的记忆" }).click();
      await page.waitForURL(url => new URL(url).pathname === "/settings/memory", { timeout: 15000 });
      console.log("HIST after menu:", await page.evaluate(() => history.length + " " + location.pathname));
      await page.getByRole("heading", { name: "我的记忆" }).waitFor({ state: "visible" });
      // 等客户端水合完成，避免首次点击退化成整页跳转（那会改变 history 形状）
      await page.waitForLoadState("networkidle");
      record("从用户菜单直达个人记忆页（无隐藏 URL）", true);
      // 窄屏 390px：范围导航与添加表单可用
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("navigation", { name: "记忆范围" }).waitFor({ state: "visible" });
      const scopeLinks = await page.getByRole("navigation", { name: "记忆范围" }).getByRole("link").count();
      record("390px 窄屏下范围导航仍可见且有 2 个入口", scopeLinks === 2, "links=" + scopeLinks);
      console.log("HIST before scope click:", await page.evaluate(() => history.length + " " + location.pathname));
      await page.getByRole("link", { name: /项目记忆/ }).click();
      await page.waitForURL(url => new URL(url).pathname === "/memory", { timeout: 15000 });
      console.log("HIST after scope click:", await page.evaluate(() => history.length + " " + location.pathname));
      await page.waitForLoadState("networkidle");
      record("从个人页可返回项目记忆页", new URL(page.url()).pathname === "/memory", page.url());
      const historyBefore = await page.evaluate(() => history.length);
      await page.goBack();
      await page.waitForTimeout(1200);
      record("浏览器返回回到个人记忆页", new URL(page.url()).pathname === "/settings/memory",
        "url=" + page.url() + " history=" + historyBefore + "->" + await page.evaluate(() => history.length));
      // 键盘可操作：范围链接可获得焦点
      const navLink = page.getByRole("navigation", { name: "记忆范围" }).getByRole("link").first();
      await navLink.waitFor({ state: "visible", timeout: 10000 });
      const focused = await navLink.evaluate(node => { node.focus(); return document.activeElement === node; });
      record("范围导航可用键盘聚焦", focused);
    } finally {
      await browser.close();
    }
  }

  const empty = await api("/api/me/memory", {}, cookieA);
  record("空状态返回空数组而非错误", empty.status === 200 && Array.isArray(empty.body.items) && empty.body.items.length === 0);

  const added = await api("/api/me/memory", { method: "POST", body: JSON.stringify({
    requestId: "accept-add-" + Date.now(), operation: "ADD_EXPLICIT",
    quote: "以后技术讨论先给结论，再按需要展开", kind: "PREFERENCE" }) }, cookieA);
  record("添加明确偏好返回 ACTIVE", added.status === 200 && added.body.status === "ACTIVE", "status=" + added.body?.status);

  const list1 = await api("/api/me/memory", {}, cookieA);
  const entry = list1.body.items[0] ?? {};
  record("列表读回同一条持久条目", list1.body.items.length === 1 && String(entry.statement).includes("先给结论"), "revision=" + entry.revision);
  record("返回冻结操作用内容 hash", typeof entry.contentHash === "string" && entry.contentHash.length === 64);

  const detail1 = await api("/api/me/memory?claimId=" + entry.claimId, {}, cookieA);
  record("详情返回来源说明与版本历史", detail1.status === 200
    && String(detail1.body?.source?.description ?? "").length > 0 && (detail1.body?.history?.length ?? 0) >= 1);
  record("使用记录字段真实（未使用为空数组）", Array.isArray(detail1.body?.uses) && detail1.body.uses.length === 0);

  const updated = await api("/api/me/memory", { method: "POST", body: JSON.stringify({
    requestId: "accept-edit-" + Date.now(), operation: "UPDATE", claimId: entry.claimId,
    expectedRevision: entry.revision, quote: "以后技术讨论先核对依据，再给结论" }) }, cookieA);
  record("修改已生效条目成功并推进 revision", updated.status === 200 && updated.body.revision === entry.revision + 1);

  const detail2 = await api("/api/me/memory?claimId=" + entry.claimId, {}, cookieA);
  record("读回修改后表述且历史保留旧版本", detail2.body?.entry?.statement === "以后技术讨论先核对依据，再给结论"
    && (detail2.body?.history?.length ?? 0) >= 2);

  const conflict = await api("/api/me/memory", { method: "POST", body: JSON.stringify({
    requestId: "accept-conflict-" + Date.now(), operation: "UPDATE", claimId: entry.claimId,
    expectedRevision: entry.revision, quote: "旧草稿内容" }) }, cookieA);
  record("旧 revision 修改返回 409 且不覆盖新版本", conflict.status === 409, "status=" + conflict.status);

  const paused = await api("/api/me/memory", { method: "POST", body: JSON.stringify({
    requestId: "accept-pause-" + Date.now(), operation: "PAUSE", claimId: entry.claimId, expectedRevision: updated.body.revision }) }, cookieA);
  record("暂停后状态为 PAUSED", paused.status === 200 && paused.body.status === "PAUSED");

  const exported = await api("/api/me/memory/export", {}, cookieA);
  record("导出标注为用户自述且含当前表述", exported.status === 200
    && exported.body.items.some(item => String(item.statement).includes("先核对依据") && item.classification === "USER_STATED"));

  const candidates = await api("/api/me/memory?candidates=1", {}, cookieA);
  record("未开启推断时候选为空", candidates.status === 200 && candidates.body.items.length === 0);

  const deleted = await api("/api/me/memory", { method: "POST", body: JSON.stringify({
    requestId: "accept-del-" + Date.now(), operation: "DELETE", claimId: entry.claimId, expectedRevision: paused.body.revision }) }, cookieA);
  record("删除返回停止使用与正文清除状态", deleted.status === 200 && deleted.body.status === "DELETED"
    && deleted.body.purge?.canonicalStatementPurged === true);

  const afterDelete = await api("/api/me/memory?includeStopped=1", {}, cookieA);
  record("删除后列表不再返回正文", afterDelete.body.items.every(item => item.statement === ""));

  const loginB = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "vis-b", password: "fixture-password-123" }) });
  const cookieB = loginB.cookie.split(";")[0];
  const listB = await api("/api/me/memory?includeStopped=1", {}, cookieB);
  record("另一账号读不到前一个账号的条目", listB.status === 200 && listB.body.items.length === 0);
  const bDetail = await api("/api/me/memory?claimId=" + entry.claimId, {}, cookieB);
  record("另一账号按 id 读取返回 404", bDetail.status === 404, "status=" + bDetail.status);

  const anon = await api("/api/me/memory", {});
  record("未登录访问返回 401", anon.status === 401, "status=" + anon.status);

  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok).length;
  console.log(NEWLINE + "SUMMARY " + JSON.stringify({ passed, failed }));
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.log("SERVER_LOG_TAIL " + serverLog.slice(-1200));
  record("验收脚本执行", false, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try { server.kill(); } catch { /* already gone */ }
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { shell: true, encoding: "utf8" });
  }
  await sleep(2000);
  process.exit(process.exitCode ?? 1);
}
