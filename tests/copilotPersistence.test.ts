import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-copilot-"));
  const file = path.join(dir, "confirmations.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  process.env.LLM_MODE = "mock";
  process.env.SEMANTIC_MEMORY_ENABLED = "false";
  process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = "true";
  process.env.TEMPORAL_MEMORY_ENABLED = "true";
  const sql = new Database(file);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const migrationFile = path.join("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(migrationFile)) sql.exec(fs.readFileSync(migrationFile, "utf8"));
  }
  sql.close();
  return { dir, file };
});
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { answerProjectQuestion, executeCopilotTool } from "@/lib/services/copilotService";
import * as artifactService from "@/lib/services/artifactService";
import { createSession } from "@/lib/auth/session";
import { json } from "@/lib/mission/contracts";
import Database from "better-sqlite3";

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
  for (const name of fs.readdirSync(isolated.dir)) fs.unlinkSync(path.join(isolated.dir, name));
  fs.rmdirSync(isolated.dir);
});

async function fixture(authenticated = false) {
  const project = await db.project.create({ data: {
    title: "阶段汇报验证", description: "隔离测试资料", goal: "准备有来源的阶段汇报", scenario: "RESEARCH",
  } });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "阶段汇报实验记录已整理，保留数据和配置。", sourceType: "测试" } });
  const card = await db.knowledgeCard.create({ data: {
    projectId: project.id, captureId: capture.id, type: "experiment_log", title: "阶段汇报实验记录",
    summary: "阶段汇报实验记录已整理，保留数据和配置。", keywords: ["阶段汇报", "实验"],
    relatedTasks: [], nextActions: ["核对汇报依据"], importance: 3,
  } });
  let actor: { userId: string; sessionId: string } | undefined;
  if (authenticated) {
    const user = await db.user.create({ data: { username: `copilot-${project.id}`, displayName: "测试用户", passwordHash: "unused" } });
    await db.projectMembership.create({ data: { projectId: project.id, userId: user.id } });
    actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  }
  const answer = await answerProjectQuestion(project.id, "阶段汇报 下一步 做什么，生成周报", actor);
  expect(answer.proposedActions).toHaveLength(2);
  const action = answer.proposedActions.find(p => p.kind === "create_action")!;
  const actionInput = { tool: "create_action" as const, confirmed: true, sourceRunId: answer.runId,
    payload: { title: action.title, description: action.description, priority: action.priority } };
  const artifactInput = { tool: "generate_artifact" as const, confirmed: true, sourceRunId: answer.runId,
    payload: { artifactType: "weekly_report" } };
  return { project, card, answer, actionInput, artifactInput, actor };
}

function child(projectId: string, runId: string, input: unknown, fault = "none") {
  const proc = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"),
    path.resolve("tests/helpers/copilot-confirm-worker.ts"), projectId, runId, JSON.stringify(input), fault], {
    env: { ...process.env, DATABASE_URL: `file:${isolated.file.replaceAll("\\", "/")}`, LLM_MODE: "mock" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let stdout = "", stderr = "";
  const ready = new Promise<void>((resolve, reject) => {
    proc.stdout.on("data", data => { stdout += String(data); if (stdout.includes("READY\n")) resolve(); });
    proc.on("error", reject);
    proc.on("exit", code => { if (!stdout.includes("READY\n")) reject(new Error(`worker exited ${code}: ${stderr}`)); });
  });
  proc.stderr.on("data", data => { stderr += String(data); });
  const done = new Promise<{ code: number | null; result: { resultId?: string; alreadyExecuted?: boolean; error?: string }; stderr: string }>((resolve, reject) => {
    const timeout = setTimeout(() => { proc.kill(); reject(new Error(`Copilot worker timeout: ${stderr}`)); }, 25000);
    proc.on("error", error => { clearTimeout(timeout); reject(error); });
    proc.on("exit", code => {
      clearTimeout(timeout);
      const line = stdout.split("\n").find(value => value.startsWith("RESULT "));
      resolve({ code, result: line ? JSON.parse(line.slice(7)) : {}, stderr });
    });
  });
  return { ready, done, start: () => proc.stdin.end("start\n") };
}

describe.sequential("Copilot durable confirmation", () => {
  it("freezes generation-time sources and atomically replays one action for identical confirmations", async () => {
    const f = await fixture();
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: f.answer.runId } });
    expect((run.trace as { copilotSources?: unknown }).copilotSources).toBeTruthy();
    const [a, b] = await Promise.all([executeCopilotTool(f.project.id, f.actionInput), executeCopilotTool(f.project.id, f.actionInput)]);
    expect(a.result.id).toBe(b.result.id);
    expect([a, b].some(value => value.alreadyExecuted)).toBe(true);
    expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(1);
    expect(await db.copilotToolExecution.count({ where: { sourceRunId: f.answer.runId, status: "COMMITTED" } })).toBe(1);
  });

  it("returns the same object for the same payload and rejects a different confirmation payload", async () => {
    const f = await fixture();
    const first = await executeCopilotTool(f.project.id, f.actionInput);
    await expect(executeCopilotTool(f.project.id, { ...f.actionInput, payload: { ...f.actionInput.payload, priority: 5 } }))
      .rejects.toMatchObject({ code: "CONFIRMATION_PAYLOAD_CHANGED", status: 409 });
    expect((await executeCopilotTool(f.project.id, f.actionInput)).result.id).toBe(first.result.id);
  });

  it("rejects changed cards, project goals and new artifact context before business writes", async () => {
    const a = await fixture();
    await db.knowledgeCard.update({ where: { id: a.card.id }, data: { summary: "新的实验结论，需要重新核对。" } });
    await expect(executeCopilotTool(a.project.id, a.actionInput)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(await db.actionItem.count({ where: { projectId: a.project.id } })).toBe(0);
    const b = await fixture();
    await db.project.update({ where: { id: b.project.id }, data: { goal: "改为准备答辩" } });
    await expect(executeCopilotTool(b.project.id, b.artifactInput)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(await db.generatedArtifact.count({ where: { projectId: b.project.id } })).toBe(0);
  });

  it("allows two frozen proposals from one run without invalidating the second with its own first action", async () => {
    const f = await fixture();
    await executeCopilotTool(f.project.id, f.actionInput);
    const generated = await executeCopilotTool(f.project.id, f.artifactInput);
    expect(generated.tool).toBe("generate_artifact");
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(1);
    expect((await executeCopilotTool(f.project.id, f.artifactInput)).result.id).toBe(generated.result.id);
  });

  it("requires regeneration for legacy unconsumed proposals but replays an existing legacy receipt", async () => {
    const f = await fixture();
    const proposal = f.answer.proposedActions.find(p => p.kind === "create_action")!;
    const run = await db.agentRun.create({ data: { projectId: f.project.id, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      trace: { supportState: "SUPPORTED" }, resultJson: json({ proposedActions: [proposal] }) } });
    const input = { ...f.actionInput, sourceRunId: run.id };
    await expect(executeCopilotTool(f.project.id, input)).rejects.toMatchObject({ code: "COPILOT_PROPOSAL_REGENERATE_REQUIRED" });
    const old = await db.actionItem.create({ data: { projectId: f.project.id, title: proposal.title } });
    await db.agentRun.update({ where: { id: run.id }, data: { resultJson: json({
      proposedActions: [proposal], executedProposals: { [`action:${proposal.title}`]: { tool: "create_action", resultId: old.id } },
    }) } });
    expect(await executeCopilotTool(f.project.id, input)).toMatchObject({ result: { id: old.id }, alreadyExecuted: true });
  });

  it("rolls back business writes and consumption when a transaction fails after inserting an action", async () => {
    const f = await fixture();
    await db.$executeRawUnsafe(`CREATE TRIGGER copilot_abort_action AFTER INSERT ON ActionItem WHEN NEW.projectId='${f.project.id}' BEGIN SELECT RAISE(ABORT,'injected'); END`);
    try {
      await expect(executeCopilotTool(f.project.id, f.actionInput)).rejects.toBeTruthy();
      expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(0);
      expect(await db.copilotToolExecution.count({ where: { sourceRunId: f.answer.runId, status: "COMMITTED" } })).toBe(0);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER copilot_abort_action"); }
    await executeCopilotTool(f.project.id, f.actionInput);
    expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(1);
  });

  it("generates outside the write transaction and rejects sources changed while generation is in flight", async () => {
    const f = await fixture();
    const original = artifactService.prepareArtifactGeneration;
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(artifactService, "prepareArtifactGeneration").mockImplementation(async (...args) => {
      const prepared = await original(...args); entered(); await wait; return prepared;
    });
    const pending = executeCopilotTool(f.project.id, f.artifactInput);
    await reached;
    await db.knowledgeCard.update({ where: { id: f.card.id }, data: { summary: "资料在生成期间修改，需要重新生成。" } });
    release();
    await expect(pending).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    spy.mockRestore();
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(0);
  });

  it("rechecks membership/session inside the final commit after generation", async () => {
    const f = await fixture(true);
    const original = artifactService.prepareArtifactGeneration;
    const spy = vi.spyOn(artifactService, "prepareArtifactGeneration").mockImplementation(async (...args) => {
      const prepared = await original(...args);
      await db.projectMembership.delete({ where: { userId_projectId: { userId: f.actor!.userId, projectId: f.project.id } } });
      return prepared;
    });
    await expect(executeCopilotTool(f.project.id, f.artifactInput, f.actor)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    spy.mockRestore();
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(0);
  });

  it.each(["create_action", "generate_artifact"] as const)("uses two OS processes without duplicate %s effects", async tool => {
    const f = await fixture(), input = tool === "create_action" ? f.actionInput : f.artifactInput;
    const a = child(f.project.id, f.answer.runId, input), b = child(f.project.id, f.answer.runId, input);
    await Promise.all([a.ready, b.ready]); a.start(); b.start();
    const outcomes = await Promise.all([a.done, b.done]);
    expect(outcomes.some(value => value.code === 0), JSON.stringify(outcomes)).toBe(true);
    for (const outcome of outcomes) expect([undefined, "COPILOT_CONFIRMATION_IN_PROGRESS"]).toContain(outcome.result.error);
    const replay = await executeCopilotTool(f.project.id, input);
    const ids = outcomes.flatMap(value => value.result.resultId ? [value.result.resultId] : []);
    expect(new Set([...ids, replay.result.id]).size).toBe(1);
    expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(tool === "create_action" ? 1 : 0);
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(tool === "generate_artifact" ? 1 : 0);
  }, 35000);

  it.each(["create_action", "generate_artifact"] as const)("recovers an OS exit before receipt commit for %s atomically", async tool => {
    const f = await fixture(), input = tool === "create_action" ? f.actionInput : f.artifactInput;
    const proc = child(f.project.id, f.answer.runId, input, "before-receipt");
    await proc.ready; proc.start(); const outcome = await proc.done;
    expect(outcome.code, outcome.stderr).toBe(19);
    expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(0);
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(0);
    expect(await db.copilotToolExecution.count({ where: { sourceRunId: f.answer.runId, status: "COMMITTED" } })).toBe(0);
    await db.copilotToolExecution.updateMany({ where: { sourceRunId: f.answer.runId }, data: { leaseUntil: new Date(0) } });
    await executeCopilotTool(f.project.id, input);
    expect(await db.copilotToolExecution.count({ where: { sourceRunId: f.answer.runId, status: "COMMITTED" } })).toBe(1);
  }, 35000);

  it("replays an artifact committed by a child that exits before returning a response", async () => {
    const f = await fixture(); const proc = child(f.project.id, f.answer.runId, f.artifactInput, "after-commit");
    await proc.ready; proc.start(); expect((await proc.done).code).toBe(17);
    const replay = await executeCopilotTool(f.project.id, f.artifactInput);
    expect(replay.alreadyExecuted).toBe(true);
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(1);
  }, 35000);

  it("replays the additive migration on an old-schema copy without changing legacy data", () => {
    const file = path.join(isolated.dir, "old-schema-copy.db");
    const sql = new Database(file);
    try {
      for (const migration of fs.readdirSync("prisma/migrations").sort()) {
        if (migration === "20261023140000_copilot_confirmation_receipts") continue;
        const migrationFile = path.join("prisma/migrations", migration, "migration.sql");
        if (fs.existsSync(migrationFile)) sql.exec(fs.readFileSync(migrationFile, "utf8"));
      }
      sql.prepare('INSERT INTO "Project" ("id","title","description","goal","scenario","updatedAt") VALUES (?,?,?,?,?,?)')
        .run("old-copilot", "旧项目", "保留资料", "旧目标", "RESEARCH", new Date().toISOString());
      sql.prepare('INSERT INTO "AgentRun" ("id","projectId","runType","status","provider","trace","resultJson") VALUES (?,?,?,?,?,?,?)')
        .run("old-run", "old-copilot", "CHAT", "SUCCESS", "TEST_FIXTURE", JSON.stringify({ supportState: "SUPPORTED" }), JSON.stringify({ proposedActions: [] }));
      sql.exec(fs.readFileSync("prisma/migrations/20261023140000_copilot_confirmation_receipts/migration.sql", "utf8"));
      expect(sql.prepare('SELECT title FROM "Project" WHERE id=?').get("old-copilot")).toEqual({ title: "旧项目" });
      expect(sql.prepare('SELECT COUNT(*) AS count FROM "AgentRun"').get()).toEqual({ count: 1 });
      expect(sql.prepare('SELECT COUNT(*) AS count FROM "CopilotToolExecution"').get()).toEqual({ count: 0 });
      expect(sql.pragma("foreign_key_check")).toEqual([]);
    } finally { sql.close(); }
  });
});
