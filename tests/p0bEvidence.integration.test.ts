import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-p0b-"));
  const file = path.join(directory, "isolated.db"); process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", PROJECT_STATE_ENABLED: "true", TEMPORAL_MEMORY_ENABLED: "true", LLM_MODE: "mock" });
  const sql = new Database(file);
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const migration = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8")); }
  sql.close(); return { directory };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { createMission } from "@/lib/mission/missionService";
import { buildContext } from "@/lib/mission/contextBuilder";
import { projectTools } from "@/lib/mission/tools";
import { refreshProjectState, getProjectStateFreshness } from "@/lib/services/projectStateService";
import { evaluateTrustReceipt } from "@/lib/evidence/trustReceipt";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import { getProjectReentry } from "@/lib/services/projectReentryService";

let userId: string;
beforeAll(async () => { userId = (await db.user.create({ data: { username: "p0b-owner", displayName: "测试", passwordHash: "unused" } })).id; });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); for (const name of fs.readdirSync(isolated.directory)) fs.unlinkSync(`${isolated.directory}/${name}`); fs.rmdirSync(isolated.directory); });
async function fixture() {
  const p = await db.project.create({ data: { title: "隔离项目", description: "测试数据", goal: "核对材料", scenario: "RESEARCH", memberships: { create: { userId, role: "OWNER" } } } });
  const m = await createMission(userId, { projectId: p.id, requestId: p.id, goal: "按原始记录核对阶段汇报" });
  return { p, m, actor: { userId, projectId: p.id, missionId: m.id } };
}
async function card(projectId: string, id: string, title: string, summary = "实验记录准确率91%。", archivedAt: Date | null = null) {
  const capture = await db.capture.create({ data: { projectId, rawText: summary, sourceType: "TEST_SYNTHETIC" } });
  return db.knowledgeCard.create({ data: { id, projectId, captureId: capture.id, title, summary, archivedAt, type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
}
describe("P0-B source coverage and time boundaries", () => {
  it("301+ cards retain an old targeted record; pagination and archived lookup stay project scoped", async () => {
    const { p, actor } = await fixture();
    await db.capture.createMany({ data: Array.from({ length: 305 }, (_, i) => ({ id: `${p.id}-capture-${i}`, projectId: p.id, rawText: "普通记录", sourceType: "TEST_SYNTHETIC" })) });
    await db.knowledgeCard.createMany({ data: Array.from({ length: 305 }, (_, i) => ({ id: `${p.id}-${String(i).padStart(3, "0")}`, projectId: p.id, captureId: `${p.id}-capture-${i}`, title: "普通资料" + i, summary: "已有普通记录", type: "idea" as const, keywords: [], relatedTasks: [], nextActions: [], importance: 3 })) });
    const old = await card(p.id, p.id + "-old", "早期校准依赖", "校准参数保存在旧实验记录。", new Date());
    const one = await projectTools.search_memory.run(actor, { query: "普通资料", limit: 8 });
    expect(one.coverage).toMatchObject({ totalCards: 306, returnedCards: 8, complete: false });
    const two = await projectTools.search_memory.run(actor, { query: "普通资料", limit: 8, afterId: one.coverage!.nextCursor });
    expect(two.sources.some(s => one.sources.some(first => first.id === s.id))).toBe(false);
    expect((await projectTools.search_memory.run(actor, { query: "校准", limit: 8 })).sources).toHaveLength(0);
    const targeted = await projectTools.search_memory.run(actor, { query: "校准", sourceIds: [`card:${old.id}`], limit: 8 });
    expect(targeted.sources[0]).toMatchObject({ id: `card:${old.id}`, temporalState: "UNKNOWN", assessment: { citationAdmissibility: "ADMITTED", semanticVerdict: "NOT_CHECKED" } });
    const foreign = await fixture();
    expect((await projectTools.search_memory.run(foreign.actor, { query: "校准", sourceIds: [old.id] })).sources).toHaveLength(0);
  });
  it("project inspection exposes a second action page without pretending the first is complete", async () => {
    const { p, actor } = await fixture();
    await db.actionItem.createMany({ data: Array.from({ length: 23 }, (_, i) => ({ projectId: p.id, title: "待办" + i, description: "", priority: 3 })) });
    const first = await projectTools.inspect_project.run(actor, {});
    expect(first.coverage).toMatchObject({ totalActions: 23, returnedActions: 20, complete: false });
    const next = await projectTools.inspect_project.run(actor, { afterId: first.coverage!.nextCursor });
    expect(next.coverage).toMatchObject({ returnedActions: 3, complete: false, nextCursor: null });
  });
  it("pure time expiry marks cached snapshot stale and produces a new payload; isolated records remain UNKNOWN", async () => {
    const { p } = await fixture();
    const old = await card(p.id, p.id + "old", "旧方案"), fresh = await card(p.id, p.id + "new", "新方案"), alone = await card(p.id, p.id + "alone", "孤立记录");
    await db.cardRelation.create({ data: { currentCardId: fresh.id, relatedCardId: old.id, relationType: "SUPERSEDES", score: 1, reason: "暂用方案", confirmed: true,
      confirmedAt: new Date("2030-01-01Z"), validTo: new Date("2030-01-03Z") } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-01-02T00:00:00Z"));
    const first = await refreshProjectState(p.id);
    expect(first.snapshot.payload.nextInvalidationAt).toBe("2030-01-03T00:00:00.000Z");
    expect(first.snapshot.payload.facts.find(f => f.key === `decision:${alone.id}`)).toMatchObject({ truth: "UNKNOWN", assessment: { temporalState: "UNKNOWN", semanticVerdict: "NOT_CHECKED" } });
    vi.setSystemTime(new Date("2030-01-03T00:00:00Z"));
    expect((await getProjectStateFreshness(p.id)).status).toBe("STALE");
    vi.stubEnv("PROJECT_REENTRY_ENABLED", "true"); vi.stubEnv("PROJECT_EPISODES_ENABLED", "true"); vi.stubEnv("PROJECT_SCHEDULING_ENABLED", "true");
    const reentry = await getProjectReentry(p.id, userId);
    expect(reentry.risk.meta.status).toBe("STALE");
    expect(reentry.freshness).toBe("STALE");
    const next = await refreshProjectState(p.id);
    expect(next.reused).toBe(false); expect(next.snapshot.id).not.toBe(first.snapshot.id); expect(next.snapshot.contentHash).not.toBe(first.snapshot.contentHash);
    const state = (await getTemporalSearchStates(p.id, [old.id])).get(old.id)!;
    expect(next.snapshot.payload.facts.find(f => f.key === `decision:${old.id}`)?.temporalState).toBe(state.topLevelState);
    const receipt = evaluateTrustReceipt({ claims: [{ text: old.summary, cardIds: [old.id] }], fallbackClaimText: "", fallbackCardIds: [], retrievalMode: "keyword_fallback",
      evidence: [{ cardId: old.id, text: old.summary, current: state.current, topLevelState: state.topLevelState, supportState: state.supportState, belongsToProject: true, supersededBy: state.supersededBy }] });
    expect(receipt.receipt.claims[0].assessments?.[0].temporalState).toBe(state.topLevelState);
  });
  it("eighth historical source and old material/question/rejection survive observation compaction", async () => {
    const { m } = await fixture();
    const source = (index: number): Source => ({ id: `card:source${index}`, kind: "PROJECT", entityType: "CARD", revision: jsonHash(index), hash: jsonHash(index),
      text: "长记录".repeat(220), observedAt: "2026-10-01Z", temporalState: index === 7 ? "SUPERSEDED" : "UNKNOWN" });
    await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: 1, planRevision: 1, toolName: "bind_project_sources", status: "SUCCEEDED", canonicalInputJson: {}, readSetJson: [], inputHash: jsonHash("input"),
      resultJson: json({ data: Array.from({ length: 8 }, (_, i) => ({ text: "长".repeat(900), temporal: i === 7 ? "SUPERSEDED" : "UNKNOWN" })), sources: Array.from({ length: 8 }, (_, i) => source(i)) }) } });
    await db.agentMissionEvent.create({ data: { missionId: m.id, seq: 100, type: "QUESTION", payloadJson: { question: "补充验证准确率" } } });
    for (let i = 2; i <= 22; i++) {
      await db.agentMissionEvent.create({ data: { missionId: m.id, seq: 100 + i, type: "CONSTRAINTS_CHANGED", payloadJson: { note: "后续约束" } } });
      await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: i, planRevision: 1, toolName: "search_memory", status: "SUCCEEDED", canonicalInputJson: {}, readSetJson: [], inputHash: jsonHash(i), resultJson: json({ data: "填充".repeat(1500), sources: [] }) } });
    }
    const current = await db.agentMission.update({ where: { id: m.id }, data: { constraintsJson: { rejectedActions: ["禁止上传私有数据"] } } });
    const context = JSON.parse(await buildContext(current));
    expect(context.constraints.rejectedActions).toContain("禁止上传私有数据");
    expect(context.recentInputs.some((event: { seq: number }) => event.seq === 100)).toBe(true);
    expect(context.observations.find((observation: { tool: string }) => observation.tool === "bind_project_sources").observation.sources[7].temporalState).toBe("SUPERSEDED");
    expect(context.manifest.notLoadedStepCount).toBeGreaterThan(0);
    expect(context.sourceIndex.find((item: { id: string }) => item.id === "card:source7").temporalState).toBe("SUPERSEDED");
  });
});
