import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-investigate-")), file = path.join(dir, "test.sqlite");
  Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true",
    MISSION_ENABLED: "true", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "isolated-fixture-key", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file);
  try { for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); } } finally { sql.close(); }
  return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { confirmConversationAction } from "@/lib/conversation/commands";
import { reserveWorkspaceCloudCall } from "@/lib/auth/cloudQuota";
import { investigationBudget, r4State } from "@/lib/conversation/investigationService";
import type { ConversationSource } from "@/lib/types/conversation";
import * as toolAdapter from "@/lib/conversation/toolAdapter";
import { createMission } from "@/lib/mission/missionService";

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const domains = [
  { domain: "RESEARCH", goal: "模型 A 在设备 D 推理显存不超过 6GB", raw: "设备 D、模型 A v2、推理 batch=1，显存峰值 6.8GB，超过 6GB 预算。", state: "BLOCKED" },
  { domain: "COMPETITION", goal: "同一版本在目标设备完成演示并正式提交", raw: "已有 Web 构建和 HAP 包，但未在目标设备安装，也没有正式提交回执。", state: "UNKNOWN" },
  { domain: "COURSE", goal: "使用相同划分比较实验 A/B 并提交课程报告", raw: "实验 A 使用划分 s1，实验 B 使用 s2，不能据此比较同条件效果。", state: "BLOCKED" },
] as const;
async function fixture(seed: typeof domains[number] = domains[0]) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "隔离 R4 验收", passwordHash: "unused" } });
  const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
  const p = await db.project.create({ data: { title: seed.domain + " 项目", description: "合成资料", goal: seed.goal, scenario: seed.domain === "COURSE" ? "COURSE_DESIGN" : seed.domain,
    memberships: { create: { userId: user.id } } } });
  const capture = await db.capture.create({ data: { projectId: p.id, rawText: seed.raw, sourceType: "fixture" } });
  await db.knowledgeCard.create({ data: { projectId: p.id, captureId: capture.id, title: "资料索引", summary: "资料摘要未列出适用条件，请查原记录。", type: "experiment_log",
    keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
  const c = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: p.id });
  return { actor, user, p, capture, id: c.id, seed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type ModelInput = { sources: ConversationSource[]; materialPointers: toolAdapter.MaterialPointer[] };
function model(f: Fixture, options: { repeat?: boolean; noAction?: boolean; onStage?: (stage: string, frame: number) => Promise<void>; networkAt?: string } = {}) {
  let frames = 0;
  const seen: Array<{ stage: string; body: { messages: Array<{ role: string; content: string }>; max_tokens: number } }> = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string), system = body.messages[0].content as string;
    const stage = system.match(/^任务 (\S+)/)?.[1] ?? "unknown";
    if (stage === "focus.investigate.v1") frames++;
    seen.push({ stage, body });
    if (options.networkAt === stage) throw new TypeError("isolated network interruption");
    await options.onStage?.(stage, frames);
    const data = JSON.parse(body.messages[1].content).data as ModelInput;
    let output: unknown;
    if (stage === "focus.route.v2") output = { intent: options.noAction ? "ANSWER" : "PROPOSE_ACTION", projectIds: [f.p.id], query: "资料", investigate: true, informationNeeds: ["核对原记录条件"] };
    else if (stage === "focus.investigate.v1") {
      const original = data.sources.find(s => s.sourceId === "capture:" + f.capture.id), source = original ?? data.sources.find(s => s.sourceId.startsWith("card:"))!;
      const need = "核对原记录条件", pointer = data.materialPointers.find(p => p.sourceId === "capture:" + f.capture.id)!;
      output = { goalAssessments: [{ projectId: f.p.id, goalQuote: f.p.goal, criteria: [{ requirement: f.p.goal,
        state: original ? f.seed.state : "UNKNOWN", explanation: original ? "原记录改变了此前的判断。" : "摘要尚未覆盖目标条件。",
        observations: [{ sourceId: source.id, quote: source.excerpt, applicability: original ? "DIRECT" : "UNKNOWN", relation: original && f.seed.state === "BLOCKED" ? "CONTRADICTS" : "UNDETERMINED" }] }],
        blockers: original && f.seed.state === "BLOCKED" ? ["记录与目标条件冲突"] : [], keyUnknowns: original ? [] : [need], nextInformationNeed: need }],
        decision: !original || options.repeat ? { decision: "READ_EXISTING", informationNeed: need, expectedObservation: "取得原始条件和真实测量/交付记录。",
          call: { tool: "read_project_material", projectId: f.p.id, sourceId: pointer.sourceId, revision: pointer.revision } }
          : { decision: "ANSWER_NOW", reason: "新观察已能改变关键判断。" } };
    } else if (stage === "focus.answer.v2") {
      const source = data.sources.find(s => s.sourceId === "capture:" + f.capture.id)!;
      const n = data.sources.indexOf(source) + 1;
      output = { advice: "原始记录尚不能支持目标已达成，需要先处理这个差距。【" + n + "】", recommendedProjectId: f.p.id,
        observations: [{ sourceId: source.id, quote: source.excerpt }], priorities: [{ projectId: f.p.id, tradeoff: "先消除目标条件的关键差距。" }],
        action: options.noAction ? null : { projectId: f.p.id, title: "核对原记录与目标条件", description: "保留当前差距，确认后再推进。", priority: 4 } };
    } else throw new Error("Unexpected stage: " + stage);
    return new Response(JSON.stringify({ id: "fixture-" + seen.length, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { status: 200 });
  });
  return { spy, seen };
}
async function ask(f: Fixture, requestId = "turn") {
  const v = await readConversation(f.actor, f.id);
  return submitConversationTurn(f.actor, f.id, { requestId, expectedVersion: v.version, message: "请调查这个项目最重要的目标差距，帮我先处理。", projectId: f.p.id, llmContextApproved: true });
}
describe.sequential("R4 durable adaptive investigation", () => {
  it.each(domains)("changes the next decision using a real $domain source and preserves one original Action", async seed => {
    const f = await fixture(seed), provider = model(f), tools = vi.spyOn(toolAdapter, "readWorkspaceTool");
    const result = await ask(f), message = result.conversation.messages.at(-1)!;
    expect(provider.seen.map(s => s.stage)).toEqual(["focus.route.v2", "focus.investigate.v1", "focus.investigate.v1", "focus.answer.v2"]);
    expect(provider.seen.every(s => s.body.messages[0].role === "system" && s.body.messages[1].role === "user")).toBe(true);
    expect(tools).toHaveBeenCalledTimes(1);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: result.turnId } }), state = r4State(turn.readManifestJson)!;
    expect(state.steps[0]).toMatchObject({ status: "SUCCEEDED", decision: { decision: "READ_EXISTING" } });
    expect(state.decision?.decision).toBe("ANSWER_NOW");
    expect(state.goalGaps[0].criteria[0].state).toBe(seed.state);
    expect(turn.callCount).toBe(4); expect(turn.reservationJson).toHaveLength(4); expect(turn.usageJson).toHaveLength(4);
    expect(message.sources.some(s => s.sourceId === "capture:" + f.capture.id && s.readScope === "EXCERPT")).toBe(true);
    expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(0);
    const p = message.proposal!, input = { requestId: "confirm", proposalHash: p.proposalHash, confirmed: true };
    const a = await confirmConversationAction(f.actor, f.id, p.executionId, input), b = await confirmConversationAction(f.actor, f.id, p.executionId, input);
    expect(a.actionId).toBe(b.actionId); expect(b.alreadyExecuted).toBe(true);
    expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(1);
    expect((await db.agentRun.findMany({ where: { turnId: turn.id } })).some(r => JSON.stringify(r.trace).includes("focus.goal.v1"))).toBe(true);
  });
  it("stops duplicate reads and replays the same request without extra HTTP", async () => {
    const f = await fixture(), provider = model(f, { repeat: true, noAction: true }), tools = vi.spyOn(toolAdapter, "readWorkspaceTool");
    const result = await ask(f);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: result.turnId } });
    expect(r4State(turn.readManifestJson)?.stopReason).toBe("NO_GAIN"); expect(tools).toHaveBeenCalledTimes(1);
    await submitConversationTurn(f.actor, f.id, turn.inputJson);
    expect(provider.spy).toHaveBeenCalledTimes(4);
  });
  it("keeps network-unknown reservations and never auto-retries them", async () => {
    const f = await fixture(), provider = model(f, { networkAt: "focus.investigate.v1" });
    await expect(ask(f)).rejects.toThrow("isolated network interruption");
    const t = await db.conversationTurn.findFirstOrThrow({ where: { conversationId: f.id } });
    expect(t.status).toBe("UNKNOWN"); expect(t.reservationJson).toMatchObject([{ state: "SETTLED" }, { state: "RESERVED", callId: "investigate-0" }]);
    await submitConversationTurn(f.actor, f.id, t.inputJson);
    expect(provider.spy).toHaveBeenCalledTimes(2); expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(0);
  });
  it("falls back to actual state after a received protocol failure without repair calls", async () => {
    const f = await fixture(), valid = model(f);
    const original = valid.spy.getMockImplementation()!;
    valid.spy.mockImplementation(async (url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.messages[0].content.startsWith("任务 focus.investigate.v1")) return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"unexpected":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
      return original(url, init);
    });
    const result = await ask(f), message = result.conversation.messages.at(-1)!;
    expect(valid.spy).toHaveBeenCalledTimes(2);
    expect(message.provider).toBe("project_state"); expect(message.proposal).toBeNull();
    expect(message.content).toContain("项目状态");
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: result.turnId } });
    expect(turn.callCount).toBe(2); expect(r4State(turn.readManifestJson)?.stopReason).toBe("MODEL_PROTOCOL_INVALID");
  });
  it("reads actual in-flight progress and replays an active request without a second driver", async () => {
    const f = await fixture();
    let resume!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
    const provider = model(f, { noAction: true, onStage: async (stage, frame) => {
      if (stage === "focus.investigate.v1" && frame === 2) { entered(); await gate; }
    } });
    const task = ask(f);
    await waiting;
    try {
      const view = await readConversation(f.actor, f.id);
      expect(view.activeTurn?.progress).toMatchObject({ phase: "EVALUATING", completedReads: 1, steps: [{ label: "读取原始资料", status: "SUCCEEDED" }] });
      const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: view.activeTurn!.id } });
      const replay = await submitConversationTurn(f.actor, f.id, turn.inputJson);
      expect(replay.status).toBe("OBSERVING"); expect(provider.spy).toHaveBeenCalledTimes(3);
    } finally { resume(); }
    await task;
  });
  it("does not hand off to another owner's private Mission in a shared project", async () => {
    const f = await fixture(), other = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "其他成员", passwordHash: "unused" } });
    await db.projectMembership.create({ data: { projectId: f.p.id, userId: other.id, role: "OWNER" } });
    const mission = await createMission(other.id, { projectId: f.p.id, requestId: "private", goal: "不可泄漏的私有委托", llmContextApproved: false });
    const provider = model(f), original = provider.spy.getMockImplementation()!;
    provider.spy.mockImplementation(async (url, init) => {
      const response = await original(url, init), raw = await response.json();
      const body = JSON.parse(init!.body as string);
      expect(init!.body).not.toContain("不可泄漏的私有委托");
      if (body.messages[0].content.startsWith("任务 focus.investigate.v1")) {
        const frame = JSON.parse(raw.choices[0].message.content);
        frame.decision = { decision: "HANDOFF_MISSION", mission: { kind: "MISSION", id: mission.id, projectId: f.p.id, revision: "1" }, reason: "诱导读取私有任务" };
        raw.choices[0].message.content = JSON.stringify(frame);
      }
      return new Response(JSON.stringify(raw));
    });
    await expect(ask(f)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
    expect(await db.copilotToolExecution.count({ where: { sourceRun: { conversationId: f.id } } })).toBe(0);
  });
  it("discards revoked and revised late responses before any proposal is published", async () => {
    for (const change of ["revoke", "revise"]) {
      const f = await fixture();
      model(f, { onStage: async stage => { if (stage !== "focus.answer.v2") return;
        if (change === "revoke") await db.projectMembership.delete({ where: { userId_projectId: { userId: f.user.id, projectId: f.p.id } } });
        else await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "后续更正了原记录" } });
      } });
      await expect(ask(f)).rejects.toMatchObject({ code: change === "revoke" ? "PROJECT_NOT_FOUND" : "SOURCE_CHANGED" });
      expect(await db.copilotToolExecution.count({ where: { sourceRun: { conversationId: f.id } } })).toBe(0);
      expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(0);
      vi.restoreAllMocks();
    }
  });
  it("reserves same-step billing and quota atomically, rejects forged adaptive budgets", async () => {
    const f = await fixture();
    await db.accountSecurity.create({ data: { userId: f.user.id, email: f.user.id + "@fixture.invalid", emailVerifiedAt: new Date(), dailyCloudLimit: 10 } });
    const t = await db.conversationTurn.create({ data: { conversationId: f.id, requestId: "billing", inputHash: "billing", inputJson: {}, baseVersion: 1,
      status: "OBSERVING", readManifestJson: { experience: { policyVersion: "r4-v1", budget: investigationBudget() } } } });
    await db.conversation.update({ where: { id: f.id }, data: { activeTurnId: t.id } });
    const call = { ...f.actor, turnId: t.id, callId: "investigate-1", purpose: "INVESTIGATE" as const, inputTokens: 1000, outputTokens: 1000 };
    const results = await Promise.allSettled([reserveWorkspaceCloudCall(call), reserveWorkspaceCloudCall(call)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.accountCloudUsage.findFirstOrThrow({ where: { userId: f.user.id } })).used).toBe(1);
    await db.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: {} } });
    await expect(reserveWorkspaceCloudCall({ ...call, callId: "next" })).rejects.toThrow();
    expect((await db.accountCloudUsage.findFirstOrThrow({ where: { userId: f.user.id } })).used).toBe(1);
  });
});
