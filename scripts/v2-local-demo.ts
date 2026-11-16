/** Local-only synthetic data + injected provider. No production API selects this provider. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const port = Number(process.env.V2_DEMO_PORT ?? 4415), controlPort = port + 1;
if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error("Invalid demo port");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-v2-local-")), file = path.join(dir, "demo.db");
Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false",
  FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "false", FOCUS_ASYNC_ENABLED: "false",
  FOCUS_WEB_ENABLED: "true", MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_WEB_ENABLED: "true",
  MISSION_V2_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_WAIT_EMAIL_ENABLED: "false" });
const sql = new Database(file); sql.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();
// Imports must follow allocation of the temporary database.
const { db } = await import("../lib/db");
const { createMission, editContinuationPolicy } = await import("../lib/mission/missionService");
const { runMissionSlice } = await import("../lib/mission/runner");
const { processInvestigationDelegations } = await import("../lib/mission/investigationDelegation");
const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
const { fixtureSkillProvider } = await import("./fixtures/v2-provider");
const { createSession } = await import("../lib/auth/session");
const { sessionCookieHeader } = await import("../lib/auth/sessionCookie");
const user = await db.user.create({ data: { username: "v2-demo-" + crypto.randomUUID(), displayName: "V2 隔离演示", passwordHash: "no-login-credential" } });
const session = await createSession(user.id);
const demos: Array<{ id: string; projectId: string; title: string; material: number; provider: ReturnType<typeof fixtureSkillProvider> }> = [];
for (const [title, goal, original, updated] of [
  ["独立开发版本 · 首发假设", "整理下一版本交付说明", "登录流程已完成；移动端输入回归尚未记录。", "补充了移动端输入回归记录；分享入口仍需核对。"],
  ["科研阶段汇报 · 重要对照", "整理可核查的实验阶段汇报", "当前指标来自不同拆分条件，暂不能比较。", "新记录补充了同一拆分与脚本版本；结果尚未独立复现。"],
]) {
  const project = await db.project.create({ data: { title, description: "本地合成资料，不含个人项目", goal, scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  let source = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: original } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: project.id, goal, llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "bounded", expectedVersion: created.version, policy: {
    schemaVersion: 1, mode: "BOUNDED_INVESTIGATION", expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 1, maxModels: 100, maxTools: 100, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], timezone: "Asia/Singapore" } });
  const provider = fixtureSkillProvider(async () => { const s = await readProjectMaterial(project.id, "capture:" + source.id); return { sourceId: s!.id, sourceHash: s!.hash }; });
  for (let i = 0; i < 3; i++) await runMissionSlice({ id: mission.id, provider });
  source = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: updated } });
  await db.agentMission.update({ where: { id: mission.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32);
  for (let i = 0; i < 3; i++) await runMissionSlice({ id: mission.id, provider });
  // Resolve the newest actual Capture each cycle, including materials added from the controller.
  const currentProvider = fixtureSkillProvider(async () => {
    const latest = await db.capture.findFirstOrThrow({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
    const s = await readProjectMaterial(project.id, "capture:" + latest.id); return { sourceId: s!.id, sourceHash: s!.hash };
  });
  demos.push({ id: mission.id, projectId: project.id, title, material: 2, provider: currentProvider });
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "inherit" });
let stopping = false, working = false;
const tick = setInterval(async () => {
  if (working || stopping) return;
  working = true;
  try { await processInvestigationDelegations(32); for (const demo of demos) await runMissionSlice({ id: demo.id, provider: demo.provider }); }
  catch (e) { console.error("Local fixture worker:", e instanceof Error ? e.message : "failed"); }
  finally { working = false; }
}, 1000);
const controlOrigin = "http://127.0.0.1:" + controlPort;
const server = http.createServer(async (req, res) => {
  try {
    // This controller only owns the newly created synthetic temp DB. Never bind it publicly.
    if (req.headers.host !== "127.0.0.1:" + controlPort) { res.writeHead(403).end(); return; }
    const url = new URL(req.url ?? "/", controlOrigin), demo = demos.find(d => d.id === url.searchParams.get("mission")) ?? demos[0];
    if (req.method === "GET" && url.pathname === "/open") {
      res.writeHead(303, { "Set-Cookie": sessionCookieHeader(session.token), Location: "http://127.0.0.1:" + port + "/v2/workbench?missionId=" + demo.id, "Cache-Control": "no-store" }).end(); return;
    }
    if (req.method === "POST" && url.pathname === "/material") {
      if (req.headers.origin !== controlOrigin) { res.writeHead(403).end(); return; }
      await db.capture.create({ data: { projectId: demo.projectId, sourceType: "TEXT", rawText: "第 " + (++demo.material) + " 次合成资料更新：请保留未核对条件，补充本轮交付差异。" } });
      await db.agentMission.updateMany({ where: { id: demo.id, status: "WAITING_INPUT" }, data: { nextAttemptAt: new Date(0) } });
      res.writeHead(303, { Location: "/open?mission=" + demo.id }).end(); return;
    }
    if (req.method !== "GET" || url.pathname !== "/") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:" + port + "; frame-ancestors 'none'" });
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>忆程 V2 本地流程演示</title><style>body{font:18px/1.7 system-ui;max-width:760px;margin:60px auto;padding:24px;background:#f6f5f1;color:#202725}article{padding:24px 0;border-top:1px solid #ccc}a{color:#145c4e}button{font:inherit;padding:9px 16px;cursor:pointer}</style><h1>忆程 V2 本地流程演示</h1><p>临时数据库、合成项目、注入模型。研究→创作、版本与改道使用真实后端服务。</p>' + demos.map(d => '<article><h2>' + d.title + '</h2><a href="/open?mission=' + d.id + '">打开原委托成果</a><form method="post" action="/material?mission=' + d.id + '"><button>加入新资料，观察后台接续</button></form></article>').join("") + '<a href="http://127.0.0.1:' + port + '/v2/workbench">打开纯交互样例</a></html>');
  } catch (e) { console.error(e instanceof Error ? e.message : "controller failed"); res.writeHead(500).end("本地演示请求失败"); }
});
server.listen(controlPort, "127.0.0.1", () => console.log("V2 local demo: " + controlOrigin + " (synthetic DB: " + file + ")"));
async function stop() { if (stopping) return; stopping = true; clearInterval(tick); server.close(); child.kill(); await db.$disconnect(); }
process.on("SIGINT", () => { void stop(); }); process.on("SIGTERM", () => { void stop(); });
child.on("exit", () => { void stop(); });
