import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-change-review-"));
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.db").replaceAll("\\", "/"),
    FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", MISSION_ENABLED: "true", GOAL_CHANGE_REVIEW_ENABLED: "true",
    DECISION_SCENARIOS_ENABLED: "true", LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(path.join(dir, "test.db"));
  for (const n of fs.readdirSync("prisma/migrations").sort()) {
    const p = path.join("prisma/migrations", n, "migration.sql"); if (!fs.existsSync(p)) continue;
    if (n === "20261026120000_goal_change_reviews") sql.exec(`
      INSERT INTO User(id,username,passwordHash,displayName,updatedAt) VALUES('legacy-user','legacy-user','unused','旧用户',0);
      INSERT INTO Project(id,title,description,goal,scenario,updatedAt) VALUES('legacy-project','旧项目','旧描述','旧目标','RESEARCH',0);
      INSERT INTO AgentMission(id,ownerUserId,projectId,createRequestId,createPayloadHash,goal,successCriteriaJson,constraintsJson,budgetJson,status,updatedAt)
        VALUES('legacy-mission','legacy-user','legacy-project','legacy-create','old-hash','保留原委托','[]','{}','{}','CANCELLED',0);
      INSERT INTO DecisionScenarioProposal(id,projectId,missionId,ownerUserId,createRequestId,inputHash,inputJson,baseManifest,scenariosJson,proposalHash,expiresAt,status,receiptJson)
        VALUES('legacy-proposal','legacy-project','legacy-mission','legacy-user','legacy-scenario','old-input','{}','{}','[]','old-proposal',9999999999999,'CONFIRMED','{"missionId":"legacy-mission"}');`);
    sql.exec(fs.readFileSync(p, "utf8"));
  }
  const migrated = sql.prepare("SELECT id,purpose,proposalHash,status,receiptJson FROM DecisionScenarioProposal WHERE id='legacy-proposal'").get();
  const foreignErrors = sql.prepare("PRAGMA foreign_key_check").all();
  sql.close(); return { dir, migrated, foreignErrors };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { reserveReviewCloudCall } from "@/lib/auth/cloudQuota";
import { createMission, commandMission } from "@/lib/mission/missionService";
import { createChangeReview, listChangeMaterials } from "@/lib/decision/changeUnderstanding";
import { createDynamicReview } from "@/lib/decision/dynamicCandidates";
import { adoptDynamicPlan } from "@/lib/decision/boundedReview";
import { readReview, type ReviewProvider } from "@/lib/decision/reviewPersistence";
import { createScenarios, readScenario } from "@/lib/decision/scenarios";
import { sourceHash } from "@/lib/mission/repository";
import { runMissionSlice } from "@/lib/mission/runner";
import { projectTools } from "@/lib/mission/tools";
import { createConversation, bindRefs, readConversation } from "@/lib/conversation/service";
import { readConversationReviews, submitConversationReview } from "@/lib/conversation/reviewService";
import { readConversationWork, previewConversationWork } from "@/lib/conversation/workService";
import { confirmConversationProposal } from "@/lib/conversation/missionCommands";
import { listConversationAnchors, commandConversationAnchor, syncConversationAnchors } from "@/lib/conversation/anchorService";
import type { ReviewView, DynamicReviewResult } from "@/lib/types/changeReview";
import type { AgentExecutionResult } from "@/lib/types";
afterAll(async () => { vi.restoreAllMocks(); await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "隔离复核", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "模型A部署", description: "隔离原文", goal: "在设备D的6GB预算内部署", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const mission = await createMission(user.id, { requestId: "mission", projectId: project.id, goal: "核对模型A在设备D的6GB预算内部署", llmContextApproved: true });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "fixture", rawText: "模型A在设备D推理batch=1，GPU内存峰值6.8GB，测量日期2026-10-26。" } });
  const pointer = { id: "capture:" + capture.id, hash: (await sourceHash(project.id, "capture:" + capture.id))! };
  return { user, actor, project, mission, capture, pointer };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function response(data: unknown): AgentExecutionResult<string> { return { data: JSON.stringify(data), provider: "TEST_FIXTURE", status: "SUCCESS", durationMs: 1, usage: { inputTokens: 30, outputTokens: 20 }, usageUnknown: false }; }
function context(prompt: string) { return JSON.parse(prompt.split("context=")[1]) as { evidence: Array<{ ref: string; text: string }>; goal: string; currentSourceIds?: string[] }; }
const changeProvider: ReviewProvider = async prompt => {
  const c = context(prompt), evidence = c.evidence[0];
  return response({ decision: "ATTEND", summary: "现有测量超过6GB，需要核对统计条件。", candidates: [{ premise: "部署的内存预算可能不满足", goalQuote: "6GB预算", question: "6.8GB是否为同一统计条件的峰值？", changeKind: "PREMISE_CHANGED", relevance: "DIRECT", reason: "原目标明确6GB，资料给出6.8GB。", evidence: [{ ref: evidence.ref, quote: evidence.text.slice(0, 20) }], unknown: ["测量误差未知"] }] });
};
function dynamicProvider(kind = "READ_EXISTING", rename = false): ReviewProvider {
  return async prompt => { const c = context(prompt); return response({ summary: "先核对已存测量，再决定是否改变部署方案。", candidates: [{ kind,
    title: rename ? "重新查看原测量" : kind === "ASK_USER" ? "核对峰值统计口径" : "读取设备D测量日志", reason: "这份资料包含设备D的原始观测。", question: kind === "ASK_USER" ? "6.8GB是否包含运行时缓存？" : null,
    sourceIds: kind === "READ_EXISTING" ? [c.currentSourceIds![0]] : [], expectedObservation: "原测量条件", stopCondition: "读到原条件后停止，仍缺失就追问", branches: [], evidence: [{ ref: c.evidence[0].ref, quote: c.evidence[0].text.slice(0, 12) }] }] }); };
}
const d1 = (f: Fixture, provider = changeProvider, requestId = crypto.randomUUID()) => createChangeReview(f.actor, f.mission.id, { requestId, expectedVersion: f.mission.version, sources: [f.pointer], llmContextApproved: true }, { provider });
const d2 = (f: Fixture, root: ReviewView, provider = dynamicProvider(), extra = {}) => createDynamicReview(f.actor, f.mission.id, { requestId: crypto.randomUUID(), reviewId: root.id, llmContextApproved: true, ...extra }, { provider });
const candidate = (review: ReviewView, kind: string) => (review.result as DynamicReviewResult).candidates.find(c => c.kind === kind)!;
const adopt = (f: Fixture, review: ReviewView, kind: string, extra = {}) => adoptDynamicPlan(f.actor, review.id, { requestId: crypto.randomUUID(), proposalHash: review.proposalHash, candidateId: candidate(review, kind).candidateId, expectedVersion: review.base.expectedVersion, confirmed: true, ...extra });
const mission = (f: Fixture) => db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
describe.sequential("bounded D1/D2 through original persistence and Runner", () => {
  it("upgrades a populated old proposal without changing its identity, status or receipt", () => {
    expect(isolated.migrated).toMatchObject({ id: "legacy-proposal", purpose: "FIXED_SCENARIOS", status: "CONFIRMED", proposalHash: "old-proposal", receiptJson: '{"missionId":"legacy-mission"}' });
    expect(isolated.foreignErrors).toEqual([]);
  });
  it("deduplicates a stable source batch across request IDs and keeps V1 separate", async () => {
    const f = await fixture(), provider = vi.fn(changeProvider), review = await d1(f, provider, "first");
    expect(review.status).toBe("READY"); expect(review.result?.provider).toBe("TEST_FIXTURE");
    expect((await d1(f, provider, "second")).id).toBe(review.id); expect(provider).toHaveBeenCalledTimes(1);
    await expect(createChangeReview(f.actor, f.mission.id, { requestId: "first", expectedVersion: f.mission.version, sources: [], llmContextApproved: true }, { provider })).rejects.toThrow();
    const fixed = await createScenarios(f.actor, f.mission.id, { requestId: "fixed", availableMinutes: 60, deliveryMinutes: 10, requestModelAdvice: false });
    expect(fixed.scenarios.length).toBeGreaterThan(0);
    await expect(readScenario(f.actor, review.id)).rejects.toThrow();
    expect((await readReview(f.actor, review.id)).status).toBe("READY");
    expect((await mission(f)).planRevision).toBe(f.mission.planRevision);
    expect(await db.projectImpactEffect.count({ where: { missionId: f.mission.id } })).toBe(0);
  });
  it("rejects fabricated quotes, foreign sources and unsupported goal premises", async () => {
    const f = await fixture();
    const bad: ReviewProvider = async prompt => { const r = await changeProvider(prompt, "CHANGE_REVIEW"), value = JSON.parse(r.data); value.candidates[0].evidence[0].quote = "原文没有的事实"; return response(value); };
    const review = await d1(f, bad); expect(review.status).toBe("FAILED"); expect(review.result).toBeNull();
    expect((await mission(f)).planRevision).toBe(f.mission.planRevision);
    const foreign = await fixture();
    await expect(createChangeReview(f.actor, f.mission.id, { requestId: "foreign", expectedVersion: f.mission.version, sources: [foreign.pointer], llmContextApproved: true }, { provider: changeProvider })).rejects.toThrow();
    expect((await listChangeMaterials(f.actor, f.mission.id)).materials.every(m => !m.sourcePointer.id.includes(foreign.capture.id))).toBe(true);
  });
  it("retains interrupted call reservations and never resends on GET or new aliases", async () => {
    const f = await fixture(), provider = vi.fn<ReviewProvider>(async () => { throw new Error("HTTP connection ended without usage"); });
    const r = await d1(f, provider); expect(r.status).toBe("UNKNOWN");
    await readReview(f.actor, r.id); await d1(f, provider); expect(provider).toHaveBeenCalledTimes(1);
    expect((await mission(f)).budgetUsedJson).toMatchObject({ models: 1, unknownCalls: 1, reservedOutputTokens: 2048 });
    expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id } })).toBe(0);
  });
  it("reserves only the acting account once and refuses repeated provider reservations", async () => {
    const f = await fixture();
    await db.accountSecurity.create({ data: { userId: f.user.id, email: f.user.id + "@example.test", emailVerifiedAt: new Date(), dailyCloudLimit: 2 } });
    const other = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "另一所有者", passwordHash: "unused" } });
    await db.projectMembership.create({ data: { userId: other.id, projectId: f.project.id, role: "OWNER" } });
    await db.accountSecurity.create({ data: { userId: other.id, email: other.id + "@example.test", dailyCloudLimit: 0 } });
    const r = await d1(f, async prompt => {
      const p = await db.decisionScenarioProposal.findFirstOrThrow({ where: { missionId: f.mission.id, purpose: "CHANGE_REVIEW" } });
      const billing = { ...f.actor, reviewProposalId: p.id };
      await reserveReviewCloudCall(billing);
      await expect(reserveReviewCloudCall(billing)).rejects.toMatchObject({ code: "CALL_ALREADY_RESERVED" });
      return changeProvider(prompt, "CHANGE_REVIEW");
    });
    expect(r.status).toBe("READY"); expect((await db.accountCloudUsage.findFirstOrThrow({ where: { userId: f.user.id } })).used).toBe(1);
    expect(await db.accountCloudUsage.count({ where: { userId: other.id } })).toBe(0);
  });
  it("keeps unrelated uploads outside the local guard and executes a directed read without extra models", async () => {
    const f = await fixture(), root = await d1(f), review = await d2(f, root), selected = candidate(review, "READ_EXISTING");
    expect(selected.estimatedMinutes).toBeNull(); expect(selected.cost).toBeNull(); expect(selected.sourceIds).toEqual([f.pointer.id]);
    await adopt(f, review, "READ_EXISTING");
    await db.capture.create({ data: { projectId: f.project.id, rawText: "无关的社团聚会记录", sourceType: "fixture" } });
    const provider = vi.fn(async () => { throw new Error("directed review must not plan again"); });
    await runMissionSlice({ id: f.mission.id, provider }); await runMissionSlice({ id: f.mission.id, provider });
    expect(provider).not.toHaveBeenCalled(); expect((await mission(f)).status).toBe("PAUSED");
    expect((await readReview(f.actor, root.id)).toolAttempts).toBe(1);
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: f.mission.id, toolName: "read_project_material" } });
    expect(step.status).toBe("SUCCEEDED"); expect(JSON.stringify(step.resultJson)).toContain("6.8GB");
    expect((await mission(f)).budgetUsedJson).toMatchObject({ models: 2, tools: 1 });
    expect((await readReview(f.actor, root.id)).stale).toBe(false);
    const again = await d2(f, root, dynamicProvider("ASK_USER"), { retry: true, feedback: "读取后仍缺缓存口径" });
    expect(again.status).toBe("READY"); await adopt(f, again, "ASK_USER"); await runMissionSlice({ id: f.mission.id, provider });
    const m = await mission(f); expect(m.status).toBe("WAITING_INPUT"); expect(JSON.stringify(m.waitStateJson)).toContain("运行时缓存");
    expect(provider).not.toHaveBeenCalled();
    const q = await db.agentMissionEvent.findFirstOrThrow({ where: { missionId: m.id, type: "QUESTION" } });
    await commandMission(f.user.id, m.id, "input", { requestId: "answer", expectedVersion: m.version, questionId: q.id, answer: "包含缓存，当前记录无法拆分。" });
    expect((await mission(f)).planJson).toHaveProperty("dynamicReview", null);
    await expect(d2(f, root, dynamicProvider(), { retry: true, feedback: "第三次" })).rejects.toThrow();
  });
  it("KEEP_PLAN has no plan, pause, approval or Mission version effects", async () => {
    const f = await fixture(), root = await d1(f), review = await d2(f, root);
    const before = await mission(f), receipt = await adopt(f, review, "KEEP_PLAN");
    const after = await mission(f);
    for (const field of ["version", "contextVersion", "planRevision", "planJson", "status", "pauseReason", "pauseRequestedAt", "budgetUsedJson"] as const) expect(after[field]).toEqual(before[field]);
    expect(receipt).toMatchObject({ executed: false, kind: "KEEP_PLAN" });
    expect(await adopt(f, review, "KEEP_PLAN")).toEqual(receipt);
    await expect(adopt(f, review, "READ_EXISTING")).rejects.toThrow();
  });
  it("blocks related source changes before adoption and during an actual tool call", async () => {
    const f = await fixture(), root = await d1(f), review = await d2(f, root);
    await adopt(f, review, "READ_EXISTING");
    const tool = projectTools.read_project_material;
    await runMissionSlice({ id: f.mission.id, tools: { ...projectTools, read_project_material: { ...tool, run: async (actor, input) => {
      const result = await tool.run(actor, input);
      await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "相关测量已纠正" } }); return result;
    } } } });
    expect((await mission(f)).status).toBe("PAUSED");
    expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id, status: "SUCCEEDED" } })).toBe(0);
    expect((await readReview(f.actor, root.id)).stale).toBe(true);
    await expect(adopt(f, review, "READ_EXISTING", { expectedVersion: (await mission(f)).version, candidateId: candidate(review, "KEEP_PLAN").candidateId })).rejects.toThrow();
  });
  it("allows no-new-information retries, renamed rejected choices or a third decision round to bypass limits", async () => {
    const f = await fixture(), root = await d1(f), first = await d2(f, root);
    await expect(d2(f, root, dynamicProvider(), { retry: true })).rejects.toMatchObject({ code: "NO_NEW_REVIEW_INFORMATION" });
    const rejected = candidate(first, "READ_EXISTING").candidateId;
    const second = await d2(f, root, dynamicProvider("READ_EXISTING", true), { retry: true, feedback: "这份日志无法回答，请不要再选", rejectedCandidateIds: [rejected] });
    expect(candidate(second, "READ_EXISTING")).toMatchObject({ candidateId: rejected, feasibility: "UNMET" });
    await expect(adopt(f, second, "READ_EXISTING")).rejects.toThrow();
    await expect(d2(f, root, dynamicProvider(), { retry: true, feedback: "新的第三次内容" })).rejects.toMatchObject({ code: "REVIEW_ROUND_LIMIT" });
    expect(await db.decisionScenarioProposal.count({ where: { parentId: root.id, purpose: "DYNAMIC_PLAN" } })).toBe(2);
  });
  it("settles stale/STOP/revoked in-flight responses without changing business state", async () => {
    for (const mode of ["SOURCE", "STOP", "REVOKE"] as const) {
      const f = await fixture();
      const promise = d1(f, async prompt => {
        if (mode === "SOURCE") await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "原文已变化" } });
        if (mode === "STOP") await db.goalQuestionPreference.create({ data: { userId: f.user.id, missionId: f.mission.id, questionId: "*", mode: "STOP", contextHash: "test" } });
        if (mode === "REVOKE") await db.projectMembership.delete({ where: { userId_projectId: { userId: f.user.id, projectId: f.project.id } } });
        return changeProvider(prompt, "CHANGE_REVIEW");
      });
      if (mode === "REVOKE") await expect(promise).rejects.toThrow(); else expect((await promise).status).toBe("STALE");
      expect((await mission(f)).budgetUsedJson).toMatchObject({ models: 1, unknownCalls: 0 });
      expect((await mission(f)).planRevision).toBe(f.mission.planRevision);
    }
  });
  it("reads an existing review back into the same discussion and confirms the exact candidate once", async () => {
    const f = await fixture(), root = await d1(f), review = await d2(f, root);
    const c = await createConversation(f.actor, { requestId: "conversation", scope: "WORKSPACE" });
    const ref = { kind: "MISSION" as const, id: f.mission.id, projectId: f.project.id };
    await db.$transaction(async tx => { await bindRefs(tx, c.id, [{ ...ref, title: f.mission.goal, href: "/" }]); });
    // Recovered turn reserved before a lost client response; replay must use the actual stored proposal.
    const input = { requestId: "readback", expectedConversationVersion: 1, ref, purpose: "DYNAMIC_PLAN", expectedVersion: f.mission.version, llmContextApproved: true, sources: [], reviewId: root.id };
    const { conversationReviewSchema } = await import("@/lib/conversation/reviewService");
    const { jsonHash } = await import("@/lib/mission/contracts");
    const turn = await db.conversationTurn.create({ data: { conversationId: c.id, requestId: input.requestId, inputHash: jsonHash(conversationReviewSchema.parse(input)), inputJson: input, baseVersion: 1, status: "OBSERVING" } });
    await db.conversation.update({ where: { id: c.id }, data: { activeTurnId: turn.id } });
    await db.decisionReviewRequest.create({ data: { ownerUserId: f.user.id, requestId: "review:" + turn.id, inputHash: "lost-reply", proposalId: review.id } });
    const first = await submitConversationReview(f.actor, c.id, input), second = await submitConversationReview(f.actor, c.id, input);
    expect(second.conversation.messages.length).toBe(first.conversation.messages.length);
    expect(second.conversation.messages.at(-1)?.reviewRef?.id).toBe(review.id);
    expect(second.conversation.messages.at(-1)?.fileGuides?.[0].kind).toBe("RECORD");
    const data = await readConversationReviews(f.actor, c.id, ref); expect(data.dynamic?.id).toBe(review.id);
    const work = await readConversationWork(f.actor, c.id, ref);
    const pre = await previewConversationWork(f.actor, c.id, { requestId: "preview", expectedConversationVersion: second.conversation.version,
      ref, versionToken: work.versionToken, operation: "adopt_dynamic", dynamicProposalId: review.id, candidateId: candidate(review, "READ_EXISTING").candidateId });
    const proposal = pre.conversation.messages.at(-1)!.proposal!;
    const confirmed = await confirmConversationProposal(f.actor, c.id, proposal.executionId, { requestId: "confirm", proposalHash: proposal.proposalHash, confirmed: true });
    expect(confirmed.alreadyExecuted).toBe(false);
    expect((await confirmConversationProposal(f.actor, c.id, proposal.executionId, { requestId: "confirm-again", proposalHash: proposal.proposalHash, confirmed: true })).alreadyExecuted).toBe(true);
    const a = (await listConversationAnchors(f.actor, c.id)).anchors[0];
    await commandConversationAnchor(f.actor, c.id, a.id, { requestId: "follow", expectedVersion: a.version, action: "FOLLOW" });
    await runMissionSlice({ id: f.mission.id }); await runMissionSlice({ id: f.mission.id });
    const sync = await syncConversationAnchors(f.actor, c.id);
    expect(sync.conversation.messages.some(m => m.content.includes("原委托已读回所选资料"))).toBe(true);
    const count = sync.conversation.messages.length;
    expect((await syncConversationAnchors(f.actor, c.id)).conversation.messages.length).toBe(count);
    expect(await db.agentMission.count({ where: { projectId: f.project.id } })).toBe(1);
    expect((await readConversation(f.actor, c.id)).id).toBe(c.id);
  });
});
