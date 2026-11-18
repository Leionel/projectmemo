/**
 * Local product-entry demo for the V2 bounded delegation.
 *
 * Starts an isolated SQLite database, a local OpenAI-compatible mock model (selected through the
 * normal LLM_* environment, never through a product API switch), the existing Worker loop, and the
 * real Next.js product app. The control page only owns this freshly created synthetic database.
 *
 *   npm.cmd exec tsx -- scripts/v2-entry-demo.ts
 *   npm.cmd exec tsx -- scripts/verify-v2-entry.ts   (in another shell)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const port = Number(process.env.V2_ENTRY_PORT ?? 4420), controlPort = port + 1;
if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error("Invalid demo port");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-v2-entry-")), file = path.join(dir, "entry.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + file.replaceAll("\\", "/"), LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false",
  FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "false", FOCUS_ASYNC_ENABLED: "false",
  FOCUS_WEB_ENABLED: "true", MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_WEB_ENABLED: "true",
  MISSION_V2_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_CHALLENGES_ENABLED: process.env.MISSION_CHALLENGES_ENABLED ?? "true",
  MISSION_ARTIFACT_ADOPTION_ENABLED: process.env.MISSION_ARTIFACT_ADOPTION_ENABLED ?? "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "false", MISSION_WAIT_EMAIL_ENABLED: "false",
});
const sql = new Database(file); sql.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();

// Imports must follow allocation of the temporary database.
const { db } = await import("../lib/db");
const { createSession } = await import("../lib/auth/session");
const { sessionCookieHeader } = await import("../lib/auth/sessionCookie");
const { processInvestigationDelegations } = await import("../lib/mission/investigationDelegation");
const { runMissionSlice } = await import("../lib/mission/runner");
const { startMockModelServer } = await import("../lib/evaluation/mockModelServer");

const mock = await startMockModelServer({
  delayMs: Number(process.env.V2_ENTRY_MODEL_DELAY_MS ?? 0),
  questionGoal: "整理本轮验收报告",
});
Object.assign(process.env, { LLM_MODE: "openai-compatible", LLM_PROVIDER: "openai-compatible",
  LLM_BASE_URL: mock.baseUrl, LLM_API_KEY: "mock-local-only", LLM_MODEL_NAME: "mock-local-model", LLM_TIMEOUT_MS: "20000" });

const user = await db.user.create({ data: { username: "v2-entry-" + crypto.randomUUID(), displayName: "V2 产品入口演示", passwordHash: "no-login-credential" } });
const session = await createSession(user.id);
const project = await db.project.create({ data: { title: "独立开发版本 · 发布准备", description: "本地合成资料，不含个人项目", goal: "整理下一版本发布说明",
  scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
const researchProject = await db.project.create({ data: { title: "实验阶段汇报 · 科研对照", description: "隔离科研合成资料", goal: "整理实验阶段汇报",
  scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
const projects = new Map([["developer", project], ["research", researchProject]]);
for (const [scenario, title] of [["client-a", "客户甲交付"], ["client-b", "客户乙交付"]]) {
  projects.set(scenario, await db.project.create({ data: { title, description: "隔离客户合成样例", goal: "整理客户交付说明",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } }));
}

const productionPreview = process.env.V2_ENTRY_PRODUCTION === "true";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...(productionPreview ? ["start"] : ["dev", "--webpack"]), "-H", "127.0.0.1", "-p", String(port)],
  { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "inherit" });
let stopping = false, working = false;
const tick = setInterval(async () => {
  if (working || stopping) return;
  working = true;
  try {
    await processInvestigationDelegations(8);
    const mission = await db.agentMission.findFirst({ where: { ownerUserId: user.id, runtimeProtocolVersion: 2, status: "READY" }, orderBy: { updatedAt: "asc" } });
    if (mission) await runMissionSlice({ id: mission.id });
  } catch (error) { console.error("Entry worker:", error instanceof Error ? error.message : "failed"); }
  finally { working = false; }
}, 700);

const controlOrigin = "http://127.0.0.1:" + controlPort;
const server = http.createServer(async (request, response) => {
  try {
    if (request.headers.host !== "127.0.0.1:" + controlPort) { response.writeHead(403).end(); return; }
    const url = new URL(request.url ?? "/", controlOrigin);
    if (request.method === "GET" && url.pathname === "/open") {
      // Demo-only authenticated deep link. The optional target must belong to this temporary owner.
      const selectedProject = projects.get(url.searchParams.get("scenario") ?? "") ?? project;
      const selectedId = url.searchParams.get("mission");
      const selected = selectedId && selectedId.length <= 160 ? await db.agentMission.findFirst({
        where: { id: selectedId, ownerUserId: user.id, projectId: selectedProject.id, runtimeProtocolVersion: 2 }, select: { id: true },
      }) : null;
      const target = selected ? "/v2/workbench?missionId=" + encodeURIComponent(selected.id) : "/projects/" + selectedProject.id;
      response.writeHead(303, { "Set-Cookie": sessionCookieHeader(session.token), Location: "http://127.0.0.1:" + port + target, "Cache-Control": "no-store" }).end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/material") {
      const missionId = url.searchParams.get("mission") ?? "";
      const mission = await db.agentMission.findFirst({ where: { id: missionId, ownerUserId: user.id } });
      if (!mission) { response.writeHead(404).end("mission not found"); return; }
      await db.capture.create({ data: { projectId: mission.projectId, sourceType: "TEXT",
        rawText: "新增发布记录：移动端输入回归已补测，分享入口仍未验证；结果尚未独立复现。" } });
      // Use the existing scanner: it detects the new material fingerprint and wakes the same Mission
      // with a new context version. The demo does not bypass that path with a direct READY write.
      await db.agentMission.update({ where: { id: mission.id }, data: { nextAttemptAt: new Date(0) } });
      response.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, missionId: mission.id }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>忆程 V2 产品入口演示</title>' +
        '<style>body{font:18px/1.7 system-ui;max-width:720px;margin:70px auto;padding:24px;background:#f6f5f1;color:#202725}a{color:#145c4e}</style>' +
        '<h1>忆程 V2 产品入口演示</h1><p>临时数据库 + 合成项目 + 本机回环模型。走正常项目页创建委托，不用隔离演示 CLI。</p>' +
        '<a href="/open">打开项目并完成一次托付</a></html>');
      return;
    }
    response.writeHead(404).end();
  } catch (error) { console.error(error instanceof Error ? error.message : "control failed"); response.writeHead(500).end("演示请求失败"); }
});
server.listen(controlPort, "127.0.0.1", () => console.log("V2 entry demo control: " + controlOrigin + " (synthetic DB: " + file + ")"));
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(tick); server.close(); mock.close(); child.kill();
  await db.$disconnect();
}
process.on("SIGINT", () => void stop()); process.on("SIGTERM", () => void stop());
child.on("exit", () => void stop());
