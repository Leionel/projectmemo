import { beforeAll, afterAll, it, expect, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-p3-review-")), file = path.join(dir, "test.db");
  Object.assign(process.env, { DATABASE_URL: `file:${file.replaceAll("\\", "/")}`, LLM_MODE: "mock", MISSION_ENABLED: "true", REPO_SENSING_ENABLED: "true", PROJECT_EXPERIENCE_ENABLED: "true", GOAL_QUESTION_ENABLED: "true", PROJECT_STATE_ENABLED: "false" });
  const sql = new Database(file);
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { dir };
});
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import Database from "better-sqlite3";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { db } from "@/lib/db";
import { actOnSignal, actOnConnection, refreshConnection, type FetchLike } from "@/lib/sensing/repoSource";
import { createMission } from "@/lib/mission/missionService";
import { createSession } from "@/lib/auth/session";
import { event } from "@/lib/mission/repository";
import { listExperiences, actOnExperience } from "@/lib/experience/service";
import { suggestionsForMission } from "@/lib/experience/injection";
import { buildContext } from "@/lib/mission/contextBuilder";
import { currentGoalQuestion, interactGoalQuestion } from "@/lib/decision/questions";
import { updateKnowledgeCard } from "@/lib/repositories/cards";
import { GET as experienceGet } from "@/app/api/projects/[id]/experiences/route";
import { json } from "@/lib/mission/contracts";

let owner: string, other: string;
beforeAll(async () => {
  owner = (await db.user.create({ data: { username: `p3-a-${crypto.randomUUID()}`, displayName: "甲", passwordHash: "fixture" } })).id;
  other = (await db.user.create({ data: { username: `p3-b-${crypto.randomUUID()}`, displayName: "乙", passwordHash: "fixture" } })).id;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const sha = (n: number) => n.toString(16).padStart(40, "0");
const commit = (n: number) => ({ sha: sha(n), commit: { message: `提交 ${n}`, author: { name: "fixture", date: "2026-10-24T00:00:00Z" } } });
async function project() {
  return db.project.create({ data: { title: "隔离边界项目", description: "fixture", goal: "整理资料", scenario: "RESEARCH", memberships: { create: { userId: owner, role: "OWNER" } } } });
}
async function signalFixture() {
  const p = await project();
  const c = await db.sourceConnection.create({ data: { projectId: p.id, ownerUserId: owner, repo: "fixture/repo", ref: "main" } });
  const s = await db.externalSignal.create({ data: { connectionId: c.id, projectId: p.id, ownerUserId: owner, sha: sha(1), title: "真实候选", authorName: "fixture", url: `https://github.com/fixture/repo/commit/${sha(1)}` } });
  return { p, c, s };
}

it("同信号并发采纳只生成一条资料，回执重放且拒绝同 requestId 异载荷", async () => {
  const { p, s } = await signalFixture(), requestId = crypto.randomUUID();
  const results = await Promise.all([actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId }), actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId })]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.capture.count({ where: { projectId: p.id } })).toBe(1);
  await expect(actOnSignal(owner, p.id, s.id, { action: "DISMISS", requestId })).rejects.toMatchObject({ status: 409 });
  const retry = await actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId: crypto.randomUUID() });
  expect(retry.captureId).toBe(results[0].captureId);
  expect(await db.capture.count({ where: { projectId: p.id } })).toBe(1);
});

it("第二次持久化失败时资料与回执一起回滚，重试可以恢复", async () => {
  const { p, s } = await signalFixture(), requestId = crypto.randomUUID();
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_adopt BEFORE UPDATE ON ExternalSignal WHEN NEW.id='${s.id}' AND NEW.status='ADOPTED' BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END`);
  try {
    await expect(actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId })).rejects.toThrow();
    expect(await db.capture.count({ where: { projectId: p.id } })).toBe(0);
    expect(await db.repoSignalCommand.count({ where: { signalId: s.id } })).toBe(0);
    expect((await db.externalSignal.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANDIDATE");
  } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_adopt"); }
  await actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId });
  expect(await db.capture.count({ where: { projectId: p.id } })).toBe(1);
});

it("两个独立 OS 进程同时采纳，持久回执仍只生成一条资料", async () => {
  const { p, s } = await signalFixture(), requestId = crypto.randomUUID();
  const code = `const {actOnSignal}=await import('./lib/sensing/repoSource.ts'); const {db}=await import('./lib/db.ts'); console.log('READY'); await new Promise(r=>process.stdin.once('data',r)); try{const result=await actOnSignal(${JSON.stringify(owner)},${JSON.stringify(p.id)},${JSON.stringify(s.id)},${JSON.stringify({ action: "ADOPT", requestId })});console.log(JSON.stringify({captureId:result.captureId}));}finally{await db.$disconnect();}`;
  const children = Array.from({ length: 2 }, () => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
    let output = "", diagnostic = "";
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", chunk => { output += String(chunk); if (output.includes("READY")) resolve(); });
      child.stderr.on("data", chunk => { diagnostic += String(chunk); });
      child.on("error", reject); child.on("exit", status => { if (status !== 0) reject(new Error(`child ${status}: ${diagnostic}`)); });
    });
    const done = new Promise<{captureId:string}>((resolve, reject) => {
      child.on("error", reject); child.on("exit", status => status === 0 ? resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1)!)) : reject(new Error(`child ${status}: ${diagnostic}`)));
    });
    return { child, ready, done };
  });
  try {
    await Promise.all(children.map(c => c.ready)); children.forEach(c => c.child.stdin.end("go"));
    const results = await Promise.all(children.map(c => c.done));
    expect(results[0].captureId).toBe(results[1].captureId);
    expect(await db.capture.count({ where: { projectId: p.id } })).toBe(1);
  } finally { children.forEach(c => { if (c.child.exitCode === null) c.child.kill(); }); }
}, 30_000);

it.each(["revoke", "membership"])("请求中途 %s 后丢弃迟到响应，不改变历史和游标", async mode => {
  const { p, c } = await signalFixture();
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  const refresh = refreshConnection(owner, p.id, c.id, async () => { started(); await pending; return { status: 200, etag: "late", body: [commit(2)] }; });
  await began;
  if (mode === "revoke") await actOnConnection(owner, p.id, c.id, { action: "REVOKE", requestId: crypto.randomUUID() });
  else await db.projectMembership.delete({ where: { userId_projectId: { userId: owner, projectId: p.id } } });
  release();
  await expect(refresh).rejects.toMatchObject({ status: mode === "revoke" ? 409 : 404 });
  expect(await db.externalSignal.count({ where: { connectionId: c.id } })).toBe(1);
  const after = await db.sourceConnection.findUniqueOrThrow({ where: { id: c.id } });
  expect(after.cursorSha).toBeNull();
  expect(after.lastStatus).toBeNull();
});

it("40 条新增提交跨页读到旧游标，超过单次上限时保留稳定 head 和续取位置", async () => {
  const { p, c } = await signalFixture();
  await db.sourceConnection.update({ where: { id: c.id }, data: { cursorSha: sha(1), etag: "old" } });
  const readPages: number[] = [];
  let total = 41;
  const fetcher: FetchLike = async (url, init) => {
    const u = new URL(url), page = Number(u.searchParams.get("page")); readPages.push(page);
    if (page > 1) expect(init.headers["If-None-Match"]).toBeUndefined();
    return { status: 200, etag: "new", body: Array.from({ length: total }, (_, i) => commit(total - i)).slice((page - 1) * 30, page * 30) };
  };
  const first = await refreshConnection(owner, p.id, c.id, fetcher);
  expect(first.status).toBe("OK"); expect(first.created).toBe(40); expect(readPages).toEqual([1, 2]);
  total = 201; readPages.length = 0;
  const partial = await refreshConnection(owner, p.id, c.id, fetcher);
  expect(partial.status).toBe("PARTIAL"); expect(partial.connection.cursorSha).toBe(sha(41));
  expect(partial.connection.scanHeadSha).toBe(sha(201)); expect(partial.connection.scanNextPage).toBe(5);
  const done = await refreshConnection(owner, p.id, c.id, async (url, init) => {
    expect(new URL(url).searchParams.get("sha")).toBe(sha(201));
    return fetcher(url, init);
  });
  expect(done.status).toBe("OK"); expect(done.connection.cursorSha).toBe(sha(201)); expect(done.connection.scanNextPage).toBeNull();
  expect(await db.externalSignal.count({ where: { connectionId: c.id } })).toBe(201);
});

it("信号插入失败不能吞为去重，整批回滚且保留旧 ETag/游标", async () => {
  const { p, c } = await signalFixture();
  await db.sourceConnection.update({ where: { id: c.id }, data: { cursorSha: sha(1), etag: "old" } });
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_signal BEFORE INSERT ON ExternalSignal WHEN NEW.sha='${sha(3)}' BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END`);
  try {
    const result = await refreshConnection(owner, p.id, c.id, async () => ({ status: 200, etag: "new", body: [commit(3), commit(2), commit(1)] }));
    expect(result.status).toBe("ERROR"); expect(result.created).toBe(0);
    expect(result.connection.cursorSha).toBe(sha(1)); expect(result.connection.etag).toBe("old");
    expect(await db.externalSignal.count({ where: { connectionId: c.id } })).toBe(1);
  } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_signal"); }
});

async function activeExperience(userId: string, projectId: string, marker: string) {
  for (let i = 0; i < 2; i++) {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: `${marker}-${i}` });
    await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: 1, planRevision: 1, toolName: "inspect_project", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, inputHash: "fixture", readSetJson: [], protocolJson: { schemaVersion: 1 } } });
    const o = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "NOTE", contentJson: {}, sourceRefsJson: [], claimChecksJson: [] } });
    const a = await db.generatedArtifact.create({ data: { projectId, artifactType: "weekly_report", content: "fixture" } });
    await db.missionArtifactReceipt.create({ data: { missionId: m.id, outputId: o.id, projectId, outputRevision: 1, outputHash: "fixture", artifactId: a.id, artifactType: "weekly_report", sourceManifestJson: {}, blockMapJson: {}, verificationSnapshotJson: {}, createdByUserId: userId, requestId: crypto.randomUUID(), payloadHash: "fixture" } });
    await db.agentMission.update({ where: { id: m.id }, data: { status: "SUCCEEDED" } });
  }
  const list = await listExperiences(userId, projectId), experience = list.experiences[0];
  await actOnExperience(userId, projectId, experience.id, { action: "ACTIVATE", requestId: crypto.randomUUID() });
  return experience;
}

it("同项目两位用户的同模式提炼、真实接口、详情和模型上下文都隔离", async () => {
  const p = await project(); await db.projectMembership.create({ data: { projectId: p.id, userId: other, role: "OWNER" } });
  const a = await activeExperience(owner, p.id, "PRIVATE_A");
  const m = await createMission(other, { projectId: p.id, requestId: crypto.randomUUID(), goal: "乙的新任务" });
  const auth = await createSession(other);
  const reply = await experienceGet(new Request(`http://localhost/api/projects/${p.id}/experiences`, { headers: { authorization: `Bearer ${auth.token}` } }), { params: Promise.resolve({ id: p.id }) });
  expect(reply.status).toBe(200); expect(JSON.stringify(await reply.json())).not.toContain("PRIVATE_A");
  expect(await suggestionsForMission(m)).toEqual([]);
  expect(JSON.parse(await buildContext(m)).experienceAdvisories).toEqual([]);
  const b = await activeExperience(other, p.id, "PRIVATE_B"); expect(a.id).not.toBe(b.id);
  const listA = await listExperiences(owner, p.id); expect(JSON.stringify(listA)).not.toContain("PRIVATE_B");
  expect(JSON.stringify(JSON.parse(await buildContext(m)).experienceAdvisories)).toContain("PRIVATE_B");
  await db.projectMembership.update({ where: { userId_projectId: { userId: other, projectId: p.id } }, data: { role: "VIEWER" } });
  await expect(listExperiences(other, p.id)).rejects.toMatchObject({ status: 404 });
});

it("零步骤新 Mission 在注入前检查当前协议和工具版本", async () => {
  const p = await project(), e = await activeExperience(owner, p.id, "版本样本");
  const m = await createMission(owner, { projectId: p.id, requestId: crypto.randomUUID(), goal: "全新任务" });
  await db.agentExperience.update({ where: { id: e.id }, data: { protocolVersionsJson: [99] } });
  expect(JSON.parse(await buildContext(m)).experienceAdvisories).toEqual([]);
  await db.agentExperience.update({ where: { id: e.id }, data: { protocolVersionsJson: [1], toolVersionsJson: { inspect_project: "99" } } });
  expect(JSON.parse(await buildContext(m)).experienceAdvisories).toEqual([]);
  expect(await db.agentExperienceUse.count({ where: { missionId: m.id } })).toBe(0);
});

it("无关资料编辑不重开 UNKNOWN；相关新资料仍能重评同问题", async () => {
  const p = await project(), m = await createMission(owner, { projectId: p.id, requestId: crypto.randomUUID(), goal: "核对 Dice" });
  const q = await db.$transaction(tx => event(tx, m.id, "QUESTION", { question: "请补充 Dice 指标", requirements: { terms: ["Dice"] } }));
  await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_INPUT" } });
  const c = await db.capture.create({ data: { projectId: p.id, rawText: "周末课程安排", sourceType: "fixture" } });
  const card = await db.knowledgeCard.create({ data: { projectId: p.id, captureId: c.id, type: "meeting_note", title: "课程", summary: "周末课程安排", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
  const auth = await createSession(owner), actor = { userId: owner, sessionId: auth.session.id };
  const before = (await currentGoalQuestion(actor, p.id)).question!;
  await interactGoalQuestion(actor, p.id, { action: "UNKNOWN", questionId: q.id, contextHash: before.contextHash, requestId: crypto.randomUUID() });
  await updateKnowledgeCard(p.id, card.id, { summary: "周末课程调整为周一晚课" });
  expect((await currentGoalQuestion(actor, p.id)).question).toBeNull();
  await db.capture.create({ data: { projectId: p.id, rawText: "Dice 结果为 0.91", sourceType: "fixture" } });
  expect((await currentGoalQuestion(actor, p.id)).question?.questionId).toBe(q.id);
});

it("验收 runner 即使在登录后强制终止，也不会把合成令牌写入 state", () => {
  const dir = fs.mkdtempSync(path.join(isolated.dir, "runner-"));
  const runner = path.join(dir, "runner.mjs"); fs.copyFileSync("evidence/p3b/prod-acceptance/runner.mjs", runner);
  const token = "FIXTURE_NOT_A_REAL_TOKEN";
  const bootstrap = `import {pathToFileURL} from 'node:url'; process.argv[2]='a'; let n=0; globalThis.fetch=async()=>{ if(++n===1)return new Response(JSON.stringify({accessToken:${JSON.stringify(token)},user:{id:'fixture'}}),{status:200}); process.exit(9); }; await import(pathToFileURL(${JSON.stringify(runner)}).href);`;
  expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", bootstrap], { stdio: "pipe" })).toThrow();
  const saved = fs.readFileSync(path.join(dir, "state.json"), "utf8");
  expect(saved).not.toContain(token); expect(saved).not.toContain("token");
});

it("旧库增量升级清除混入的异主样本，保留历史使用与旧仓库信号", async () => {
  const file = path.join(isolated.dir, "upgrade.db"), migrationName = "20261024120000_p3_review_boundaries";
  let sql = new Database(file);
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql");
    if (name !== migrationName && fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file.replaceAll("\\", "/")}` }) });
  try {
    const a = await client.user.create({ data: { username: "upgrade-a", displayName: "甲", passwordHash: "fixture" } });
    const b = await client.user.create({ data: { username: "upgrade-b", displayName: "乙", passwordHash: "fixture" } });
    const p = await client.project.create({ data: { title: "旧项目", description: "fixture", goal: "fixture", scenario: "RESEARCH" } });
    // 从已验证库复制真实 Mission 行形状，只替换身份，避免依赖新建任务的其他服务。
    const fields = await db.agentMission.findFirstOrThrow();
    const ma = await client.agentMission.create({ data: json({ ...fields, id: "upgrade-ma", projectId: p.id, ownerUserId: a.id, createRequestId: "a" }) });
    const mb = await client.agentMission.create({ data: json({ ...fields, id: "upgrade-mb", projectId: p.id, ownerUserId: b.id, createRequestId: "b" }) });
    const e = await client.agentExperience.create({ data: { projectId: p.id, ownerUserId: a.id, kind: "WORKFLOW", patternHash: "old", title: "旧方法", statement: "历史方法", applicabilityJson: {}, sampleMissionIdsJson: [ma.id, mb.id], supportCount: 2, status: "ACTIVE" } });
    await client.agentExperienceUse.create({ data: { experienceId: e.id, missionId: ma.id, stage: "SUGGESTION" } });
    sql = new Database(file);
    sql.prepare('INSERT INTO SourceConnection (id,projectId,ownerUserId,repo,ref,updatedAt) VALUES (?,?,?,?,?,?)').run("old-connection", p.id, a.id, "fixture/old", "main", new Date().toISOString());
    sql.prepare('INSERT INTO ExternalSignal (id,connectionId,projectId,ownerUserId,sha,title,authorName,url) VALUES (?,?,?,?,?,?,?,?)').run("old-signal", "old-connection", p.id, a.id, sha(1), "旧提交", "fixture", "https://github.com/fixture/old");
    sql.exec(fs.readFileSync(path.join("prisma/migrations", migrationName, "migration.sql"), "utf8")); sql.close();
    const after = await client.agentExperience.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.sampleMissionIdsJson).toEqual([ma.id]); expect(after.supportCount).toBe(1); expect(after.status).toBe("CANDIDATE");
    expect(await client.agentExperienceUse.count()).toBe(1); expect(await client.externalSignal.count()).toBe(1);
    expect((await client.sourceConnection.findUniqueOrThrow({ where: { id: "old-connection" } })).revision).toBe(0);
  } finally { await client.$disconnect(); }
});
