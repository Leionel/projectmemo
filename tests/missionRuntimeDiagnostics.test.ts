import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-runtime-diagnostics-"));
  const file = path.join(dir, "runtime.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  process.env.MISSION_ENABLED = "true";
  process.env.MISSION_WRITES_ENABLED = "true";
  process.env.MISSION_SEMANTIC_CHECK_ENABLED = "false";
  process.env.LLM_MODE = "mock";
  const sql = new Database(file);
  for (const entry of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", entry, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { dir };
});

import { createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { createMission, commandMission, missionDetail, missionEvents } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import * as contexts from "@/lib/mission/contextBuilder";
import { ModelProtocolError, protocolDiagnostic } from "@/lib/mission/modelProtocol";
import { json, usageOf, type Choice, type Decision, type Source } from "@/lib/mission/contracts";
import { projectTools, type ToolSet } from "@/lib/mission/tools";
import type { DecisionProvider } from "@/lib/mission/modelAdapter";

const secret = "PRIVATE_RAW_PARSER_MESSAGE_DO_NOT_PERSIST";
const model = { provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE" };
const provider = (choice: Choice): DecisionProvider => async () => ({ choice, ...model, usage: { inputTokens: 20, outputTokens: 7 } });
const chooseTool = (tool: string, args: unknown = {}): Choice => ({ kind: "tool", tool, args, summary: "隔离诊断测试" });
const validationError = () => new z.ZodError([{ code: "custom", path: [secret], message: secret }]);
const protocolError = (usage = { inputTokens: 40 as number | null, outputTokens: 1000 as number | null }) => new ModelProtocolError(protocolDiagnostic("TRUNCATED", "length", 10), { ...model, usage });
let userId: string;

beforeAll(async () => {
  userId = (await db.user.create({ data: { username: `diagnostics-${Date.now()}`, displayName: "隔离测试", passwordHash: "unused" } })).id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await db.$disconnect();
  for (const name of fs.readdirSync(isolated.dir)) fs.unlinkSync(`${isolated.dir}/${name}`);
  fs.rmdirSync(isolated.dir);
});

async function fixture() {
  const p = await db.project.create({ data: { title: "阶段诊断", description: secret, goal: secret, scenario: "RESEARCH" } });
  await db.projectMembership.create({ data: { userId, projectId: p.id } });
  const m = await createMission(userId, { projectId: p.id, requestId: p.id, goal: `${secret}：整理已有资料` });
  return { p, m };
}
async function failureArtifacts(missionId: string, projectId: string) {
  const detail = await missionDetail(userId, missionId);
  const events = (await missionEvents(userId, missionId)).events;
  const runs = await db.agentRun.findMany({ where: { projectId, status: "FAILED" } });
  return { detail, events, runs };
}
function faultyTools(error: () => Error): ToolSet {
  return { ...projectTools, local_failure: { ...projectTools.inspect_project, run: async () => { throw error(); } } };
}

describe("Mission 阶段诊断与恢复（独立 SQLite，无模型或网络请求）", () => {
  it.each([
    ["JSON", () => new SyntaxError(secret), "LOCAL_PARSE"],
    ["字段", validationError, "LOCAL_VALIDATION"],
  ] as const)("上下文%s错误不得归为模型格式错误，且不消耗模型预算", async (_label, makeError, category) => {
    const { p, m } = await fixture();
    vi.spyOn(contexts, "buildContext").mockRejectedValueOnce(makeError());
    const decide = vi.fn(provider(chooseTool("inspect_project")));
    await runMissionSlice({ id: m.id, provider: decide });
    const { detail, events, runs } = await failureArtifacts(m.id, p.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "EXECUTION_FAILED", phase: "CONTEXT", category, recovery: { kind: "REVIEW_REQUIRED", automatic: false } });
    expect(usageOf(detail.used)).toMatchObject({ models: 0, tools: 0, unknownCalls: 0 });
    expect(decide).not.toHaveBeenCalled();
    expect(events.some(event => event.type === "MODEL_PROTOCOL_ERROR")).toBe(false);
    expect(events.at(-1)?.payloadJson).toMatchObject({ phase: "CONTEXT", recovery: { automatic: false } });
    expect(JSON.stringify([detail.error, runs, events.filter(event => event.type === "EXECUTION_STOPPED")])).not.toContain(secret);
  });

  it.each([
    ["JSON", () => new SyntaxError(secret), "LOCAL_PARSE"],
    ["字段", validationError, "LOCAL_VALIDATION"],
    ["伪协议码", () => new AppError("MODEL_PROTOCOL_ERROR", secret, 409), "EXECUTION"],
  ] as const)("工具%s错误暂停而不触发格式纠错", async (_label, makeError, category) => {
    const { p, m } = await fixture();
    await runMissionSlice({ id: m.id, provider: provider(chooseTool("local_failure")), tools: faultyTools(makeError) });
    const { detail, events, runs } = await failureArtifacts(m.id, p.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "EXECUTION_FAILED", phase: "TOOL", category, recovery: { kind: "REVIEW_REQUIRED", automatic: false } });
    expect(usageOf(detail.used)).toMatchObject({ models: 1, tools: 1, inputTokens: 20, outputTokens: 7, unknownCalls: 0 });
    expect(detail.steps[0].status).toBe("FAILED");
    expect(events.some(event => event.type === "MODEL_PROTOCOL_ERROR")).toBe(false);
    expect(runs[0].trace).toMatchObject({ phase: "TOOL", stepId: detail.steps[0].id });
    expect(JSON.stringify([detail.error, runs, events.filter(event => event.type === "EXECUTION_STOPPED")])).not.toContain(secret);
  });

  it("决策请求超时保留未知usage和已消耗调用，不伪造协议失败或零成本", async () => {
    const { p, m } = await fixture();
    await runMissionSlice({ id: m.id, provider: async () => { throw new DOMException(secret, "TimeoutError"); } });
    const { detail, runs, events } = await failureArtifacts(m.id, p.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "EXECUTION_FAILED", phase: "DECISION", category: "TIMEOUT", recovery: { automatic: false } });
    expect(usageOf(detail.used)).toMatchObject({ models: 1, unknownCalls: 1, reservedOutputTokens: 1000, inputTokens: 0, outputTokens: 0 });
    expect(runs[0].trace).toMatchObject({ phase: "DECISION", contextManifest: { schemaVersion: 1, contextVersion: m.contextVersion } });
    expect(JSON.stringify([runs, detail.error, events.filter(event => event.type === "EXECUTION_STOPPED")])).not.toContain(secret);
  });

  it("决策Provider本地校验异常不冒充模型回复Schema错误", async () => {
    const { m } = await fixture();
    await runMissionSlice({ id: m.id, provider: async () => { throw validationError(); } });
    const detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ phase: "DECISION", code: "EXECUTION_FAILED", category: "LOCAL_VALIDATION", recovery: { automatic: false } });
    expect(usageOf(detail.used).unknownCalls).toBe(1);
  });

  it("明确模型协议错误仅纠错一次，部分usage保留未知，截断扩额不重置预算", async () => {
    const { p, m } = await fixture();
    const contextsSeen: string[] = [];
    const decide: DecisionProvider = async context => { contextsSeen.push(context); throw protocolError({ inputTokens: null, outputTokens: 1000 }); };
    await runMissionSlice({ id: m.id, provider: decide });
    let detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("READY");
    expect(detail.error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR", phase: "DECISION", recovery: { kind: "MODEL_FORMAT_RETRY", automatic: true, attempt: 1, maxAttempts: 2 } });
    await runMissionSlice({ id: m.id, provider: decide });
    detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ recovery: { kind: "REVIEW_REQUIRED", automatic: false, attempt: 2, maxAttempts: 2 } });
    expect(usageOf(detail.used)).toMatchObject({ models: 2, unknownCalls: 2, outputTokens: 2000, reservedOutputTokens: 3000 });
    expect(contextsSeen.map(context => JSON.parse(context).outputTokenLimit)).toEqual([1000, 2000]);
    expect(await runMissionSlice({ id: m.id, provider: decide })).toBe(false);
    const { runs, events } = await failureArtifacts(m.id, p.id);
    expect(runs).toHaveLength(2);
    expect(events.filter(event => event.type === "MODEL_PROTOCOL_ERROR")).toHaveLength(2);
    expect(runs.every(run => (run.trace as { phase: string }).phase === "DECISION")).toBe(true);
  });

  it.each([
    ["决策", { kind: "finish", outputId: "none", unexpected: secret }, "INVALID_CHOICE"],
    ["工具参数", chooseTool("search_memory", { query: 9 }), "INVALID_TOOL_ARGUMENTS"],
  ] as const)("模型返回%s不合法时明确归协议，已结算usage不重复累计", async (_label, choice, reason) => {
    const { p, m } = await fixture();
    const invalid = async () => ({ choice, ...model, usage: { inputTokens: 20, outputTokens: 7 } }) as Decision;
    await runMissionSlice({ id: m.id, provider: invalid });
    const detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("READY");
    expect(detail.error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR", phase: "DECISION", diagnostic: { reason }, recovery: { automatic: true } });
    expect(usageOf(detail.used)).toMatchObject({ models: 1, tools: 0, unknownCalls: 0, inputTokens: 20, outputTokens: 7 });
    expect(detail.steps).toHaveLength(0);
    expect(JSON.stringify(detail.error)).not.toContain(secret);
    expect(JSON.stringify(await db.agentRun.findMany({ where: { projectId: p.id } }))).not.toContain(secret);
  });

  it.each(["pause", "cancel"] as const)("首次协议失败同时收到%s也不得自动READY", async kind => {
    const { m } = await fixture();
    await runMissionSlice({ id: m.id, provider: async () => {
      await db.agentMission.update({ where: { id: m.id }, data: kind === "pause" ? { pauseRequestedAt: new Date() } : { cancelRequestedAt: new Date() } });
      throw protocolError();
    } });
    const detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe(kind === "pause" ? "PAUSED" : "CANCELLED");
    expect(detail.error).toMatchObject({ phase: "DECISION", recovery: { kind: "STOP_REQUESTED", automatic: false } });
    expect(await runMissionSlice({ id: m.id, provider: provider(chooseTool("inspect_project")) })).toBe(false);
  });

  it("预算耗尽保留DECISION阶段与原额度，继续不触发调用", async () => {
    const { m } = await fixture();
    await db.agentMission.update({ where: { id: m.id }, data: { budgetUsedJson: json({ ...usageOf({}), models: 12 }) } });
    const decide = vi.fn(provider(chooseTool("inspect_project")));
    await runMissionSlice({ id: m.id, provider: decide });
    let detail = await missionDetail(userId, m.id);
    expect(detail.error).toMatchObject({ code: "BUDGET_EXHAUSTED", phase: "DECISION", recovery: { kind: "BUDGET_REVIEW", automatic: false } });
    await commandMission(userId, m.id, "resume", { requestId: "resume-diagnostics", expectedVersion: detail.version });
    await runMissionSlice({ id: m.id, provider: decide });
    detail = await missionDetail(userId, m.id);
    expect(usageOf(detail.used).models).toBe(12);
    expect(decide).not.toHaveBeenCalled();
  });

  it("重复观察无进展归TOOL阶段，不被模型格式纠错重新排队", async () => {
    const { m } = await fixture();
    for (let index = 0; index < 4; index++) await runMissionSlice({ id: m.id, provider: provider(chooseTool("inspect_project")) });
    const detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "NO_PROGRESS", phase: "TOOL", recovery: { automatic: false } });
    expect((await missionEvents(userId, m.id)).events.some(event => event.type === "MODEL_PROTOCOL_ERROR")).toBe(false);
  });

  it("研究临时失败按原步骤退避至三次，恢复信息不重置预算或重做决策", async () => {
    const { m } = await fixture();
    const decide = vi.fn(provider(chooseTool("web_fetch")));
    const fail = vi.fn(async () => { throw new AppError("RESEARCH_RETRYABLE", "公开工具暂不可用", 503, { retryAfterMs: 1500 }); });
    const tools = { ...projectTools, web_fetch: { ...projectTools.inspect_project, run: fail } };
    await runMissionSlice({ id: m.id, provider: decide, tools });
    let detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("READY");
    expect(detail.error).toMatchObject({ code: "RESEARCH_RETRYABLE", phase: "TOOL", recovery: { kind: "RESEARCH_RETRY", automatic: true, attempt: 2, maxAttempts: 3, nextAttemptAt: expect.any(String) } });
    for (let index = 0; index < 2; index++) {
      await db.agentMission.update({ where: { id: m.id }, data: { nextAttemptAt: new Date(0) } });
      await runMissionSlice({ id: m.id, provider: decide, tools });
    }
    detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ recovery: { kind: "REVIEW_REQUIRED", automatic: false } });
    expect(decide).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledTimes(3);
    expect(usageOf(detail.used)).toMatchObject({ models: 1, tools: 3, fetches: 3, inputTokens: 20, outputTokens: 7 });
    expect(detail.steps).toHaveLength(1);
  });

  it("manifest兼容附件/成果的实体修订ID，且不包含对应正文", async () => {
    const { p, m } = await fixture();
    const hash = createHash("sha256").update(secret).digest("hex");
    vi.spyOn(contexts, "buildContext").mockResolvedValueOnce(JSON.stringify({
      schemaVersion: 1, goal: secret, recentInputs: [{ seq: 7, payload: secret }], manifest: { excludedStepIds: ["old-step"] },
      observations: [{ stepId: "existing-step", observation: { data: secret, sources: [{ id: "attachment:attachment-id", hash, revision: "revision-id", excerpts: [{ text: secret }] }, { id: "artifact:artifact-id", hash, revision: "artifact-id" }] } }],
    }));
    await runMissionSlice({ id: m.id, provider: provider({ kind: "ask", question: "请提供需要的实验单位", missing: "PRIVATE" }) });
    const run = await db.agentRun.findFirstOrThrow({ where: { projectId: p.id } });
    expect(run.trace).toMatchObject({ contextManifest: { includedStepIds: ["existing-step"], excludedStepIds: ["old-step"], inputEventSeqs: [7], sourcePointers: [
      { id: "attachment:attachment-id", hash, revision: "revision-id" }, { id: "artifact:artifact-id", hash, revision: "artifact-id" },
    ] } });
    expect(JSON.stringify(run.trace)).not.toContain(secret);
  });

  it("成功和失败trace保存实际上下文manifest/hash，不存目标或来源全文", async () => {
    const { p, m } = await fixture();
    const captured: string[] = [];
    const decide: DecisionProvider = async context => { captured.push(context); return provider(chooseTool("inspect_project"))(context, projectTools); };
    await runMissionSlice({ id: m.id, provider: decide });
    await runMissionSlice({ id: m.id, provider: decide });
    const runs = await db.agentRun.findMany({ where: { projectId: p.id, status: "SUCCESS" }, orderBy: { createdAt: "asc" } });
    const trace = runs.find(run => (run.trace as { contextManifest: { includedStepIds: string[] } }).contextManifest.includedStepIds.length === 1)!.trace as { phase: string; contextManifest: { hash: string; goalHash: string; includedStepIds: string[]; sourcePointers: Array<{ id: string; hash: string }> } };
    expect(trace.phase).toBe("DECISION");
    expect(trace.contextManifest.hash).toBe(createHash("sha256").update(captured[1]).digest("hex"));
    expect(trace.contextManifest.sourcePointers).toEqual([expect.objectContaining({ id: `project:${p.id}`, hash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(JSON.stringify(runs.map(run => run.trace))).not.toContain(secret);
    expect(trace.contextManifest.goalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("缺少本委托Output的完成请求归VERIFY阶段，保留有限成功条件", async () => {
    const { m } = await fixture();
    await runMissionSlice({ id: m.id, provider: provider({ kind: "finish", outputId: "missing-output" }) });
    const detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "OUTPUT_REQUIRED", phase: "VERIFY", recovery: { automatic: false } });
  });

  it("批准提交开关关闭归APPROVAL阶段，不创建行动或消费批准", async () => {
    const { p, m } = await fixture();
    await runMissionSlice({ id: m.id, provider: provider(chooseTool("propose_action", { title: "核对阶段结果" })) });
    let detail = await missionDetail(userId, m.id);
    const approval = detail.approvals[0];
    await commandMission(userId, m.id, "approval", { requestId: "approval-diagnostics", expectedVersion: detail.version, decision: "APPROVED", proposalHash: approval.proposalHash }, approval.id);
    vi.stubEnv("MISSION_WRITES_ENABLED", "false");
    await runMissionSlice({ id: m.id });
    detail = await missionDetail(userId, m.id);
    expect(detail.error).toMatchObject({ code: "WRITES_DISABLED", phase: "APPROVAL", recovery: { automatic: false } });
    expect(await db.actionItem.count({ where: { projectId: p.id } })).toBe(0);
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("APPROVED");
  });

  it("提交失败归COMMIT阶段且不记录数据库异常正文", async () => {
    const { p, m } = await fixture();
    await db.$executeRawUnsafe(`CREATE TRIGGER diag_abort BEFORE UPDATE ON AgentMissionStep WHEN NEW.missionId='${m.id}' AND NEW.status='SUCCEEDED' BEGIN SELECT RAISE(ABORT,'${secret}'); END`);
    try { await runMissionSlice({ id: m.id, provider: provider(chooseTool("inspect_project")) }); }
    finally { await db.$executeRawUnsafe("DROP TRIGGER diag_abort"); }
    const { detail, runs } = await failureArtifacts(m.id, p.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.error).toMatchObject({ code: "EXECUTION_FAILED", phase: "COMMIT", recovery: { automatic: false } });
    expect(detail.steps[0].status).toBe("FAILED");
    expect(JSON.stringify([detail.error, runs])).not.toContain(secret);
  });

  it("Judge超时仍保留待审草稿，VERIFY失败trace与未知usage各记一次", async () => {
    const { p, m } = await fixture();
    await runMissionSlice({ id: m.id, provider: provider(chooseTool("inspect_project")) });
    const first = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: m.id, status: "SUCCEEDED" } });
    const source = (first.resultJson as unknown as { sources: Source[] }).sources[0];
    const excerptHash = createHash("sha256").update(source.text).digest("hex");
    const before = usageOf((await missionDetail(userId, m.id)).used);
    vi.stubEnv("MISSION_SEMANTIC_CHECK_ENABLED", "true");
    await runMissionSlice({ id: m.id, provider: provider(chooseTool("save_mission_output", { blocks: [{ blockId: "b", kind: "PROJECT_OBSERVATION", text: source.text, sourceIds: [source.id], citations: [{ sourceId: source.id, start: 0, end: source.text.length, excerptHash }] }] })), judge: async () => { throw new DOMException(secret, "TimeoutError"); } });
    const detail = await missionDetail(userId, m.id);
    expect(detail.outputs).toHaveLength(1);
    expect(detail.outputs[0].verificationStatus).toBe("NEEDS_REVIEW");
    const used = usageOf(detail.used);
    expect(used.models - before.models).toBe(2);
    expect(used.unknownCalls - before.unknownCalls).toBe(1);
    expect(used.inputTokens - before.inputTokens).toBe(20);
    const failed = await db.agentRun.findFirstOrThrow({ where: { projectId: p.id, status: "FAILED" } });
    expect(failed.trace).toMatchObject({ phase: "VERIFY", purpose: "CLAIM_JUDGE", category: "TIMEOUT" });
    expect(JSON.stringify(failed)).not.toContain(secret);
  });
});
