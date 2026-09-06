import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTemporalTimeline, evaluateTemporalCard, wouldCreateSupersessionCycle } from "@/lib/memory/temporalLedger";
import type { TemporalCardSummary, TemporalRelationData } from "@/lib/types";

const databasePath = path.resolve("prisma/projectmemo-temporal-test.db");

function card(id: string, createdAt = "2026-08-20T00:00:00.000Z"): TemporalCardSummary {
  return { id, title: `决定 ${id}`, summary: `决定 ${id} 的内容`, createdAt };
}

function relation(overrides: Partial<TemporalRelationData> = {}): TemporalRelationData {
  return {
    id: "relation-1",
    relationType: "SUPERSEDES",
    reason: "新方案已通过验证并取代旧方案",
    confidence: 0.95,
    confirmed: true,
    confirmedAt: "2026-08-23T00:00:00.000Z",
    revokedAt: null,
    validFrom: "2026-08-23T00:00:00.000Z",
    validTo: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    currentCard: card("new", "2026-08-23T00:00:00.000Z"),
    relatedCard: card("old"),
    ...overrides,
  };
}

describe("temporal ledger rules", () => {
  it("does not auto-activate an unconfirmed relation", () => {
    const state = evaluateTemporalCard(card("old"), [relation({ confirmed: false, confirmedAt: null })], new Date("2026-08-24T00:00:00.000Z"));
    expect(state).toMatchObject({ current: true, status: "PENDING", supportState: "PENDING", supersededBy: null });
  });

  it("activates confirmed supersession only inside the validity window", () => {
    const item = relation();
    expect(evaluateTemporalCard(card("old"), [item], new Date("2026-08-22T00:00:00.000Z")).current).toBe(true);
    expect(evaluateTemporalCard(card("old"), [item], new Date("2026-08-24T00:00:00.000Z"))).toMatchObject({ current: false, status: "SUPERSEDED", supersededBy: { id: "new" } });
  });

  it("reconstructs the relation as pending when querying a time before confirmation", () => {
    const laterConfirmed = relation({
      createdAt: "2026-08-21T00:00:00.000Z",
      confirmedAt: "2026-08-23T00:00:00.000Z",
    });
    expect(evaluateTemporalCard(card("old"), [laterConfirmed], new Date("2026-08-22T00:00:00.000Z"))).toMatchObject({
      current: true,
      status: "PENDING",
    });
  });

  it("preserves revoked history without treating it as current truth", () => {
    const revoked = relation({ revokedAt: "2026-08-25T00:00:00.000Z", validTo: "2026-08-25T00:00:00.000Z" });
    expect(evaluateTemporalCard(card("old"), [revoked], new Date("2026-08-24T00:00:00.000Z")).status).toBe("SUPERSEDED");
    expect(evaluateTemporalCard(card("old"), [revoked], new Date("2026-08-26T00:00:00.000Z"))).toMatchObject({ current: true, status: "REVOKED" });
  });

  it("reports contradictions and competing superseders as conflicts", () => {
    expect(evaluateTemporalCard(card("old"), [relation({ relationType: "CONTRADICTS" })], new Date("2026-08-24T00:00:00.000Z")).status).toBe("CONFLICT");
    const another = relation({ id: "relation-2", currentCard: card("newer", "2026-08-24T00:00:00.000Z") });
    expect(evaluateTemporalCard(card("old"), [relation(), another], new Date("2026-08-25T00:00:00.000Z")).status).toBe("CONFLICT");
  });

  it("orders current decisions before superseded history", () => {
    const timeline = buildTemporalTimeline([card("old"), card("new")], [relation()], new Date("2026-08-24T00:00:00.000Z"));
    expect(timeline.map((item) => item.card.id)).toEqual(["new", "old"]);
  });

  it.each([
    { edges: [], current: "b", related: "a", cycle: false },
    { edges: [{ currentCardId: "b", relatedCardId: "a" }], current: "a", related: "b", cycle: true },
    { edges: [{ currentCardId: "c", relatedCardId: "b" }, { currentCardId: "b", relatedCardId: "a" }], current: "a", related: "c", cycle: true },
    { edges: [{ currentCardId: "c", relatedCardId: "b" }], current: "d", related: "a", cycle: false },
  ])("detects supersession cycles %#", ({ edges, current, related, cycle }) => {
    expect(wouldCreateSupersessionCycle(edges, current, related)).toBe(cycle);
  });
});

describe.sequential("temporal ledger API integration", () => {
  beforeAll(() => {
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
    const sqlite = new Database(databasePath);
    for (const migration of fs.readdirSync(path.resolve("prisma/migrations")).sort()) {
      const migrationPath = path.join("prisma/migrations", migration, "migration.sql");
      if (fs.existsSync(migrationPath)) sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
    }
    sqlite.close();
    process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
    process.env.LLM_MODE = "mock";
    process.env.TEMPORAL_MEMORY_ENABLED = "true";
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
  });

  it("runs propose, confirm, search, timeline and revoke without silent activation", async () => {
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { searchProjectCards } = await import("@/lib/memory/hybridSearch");
    const { POST: propose } = await import("@/app/api/projects/[id]/cards/[cardId]/relations/propose/route");
    const { POST: confirm } = await import("@/app/api/projects/[id]/relations/[relationId]/confirm/route");
    const { POST: revoke } = await import("@/app/api/projects/[id]/relations/[relationId]/revoke/route");
    const { GET: timeline } = await import("@/app/api/projects/[id]/decisions/timeline/route");

    const project = await createProject({ title: "时态账本项目", description: "验证新决定取代旧决定的完整纵向闭环。", goal: "保留可撤销历史", scenario: "COMPETITION", deadline: null });
    await processCapture(project.id, "旧决定：答辩演示使用离线关键词检索方案。", "项目决定");
    await processCapture(project.id, "新决定：答辩演示改用混合检索，并保留离线降级。", "项目决定");
    const detail = await getProjectDetail(project.id);
    const newer = detail.cards[0];
    const older = detail.cards[1];

    const proposalResponse = await propose(new Request("http://localhost/propose", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ relatedCardId: older.id, relationType: "SUPERSEDES", reason: "混合检索方案已经通过本地回归", confidence: 0.96 }),
    }), { params: Promise.resolve({ id: project.id, cardId: newer.id }) });
    expect(proposalResponse.status).toBe(201);
    const proposal = await proposalResponse.json() as { relation: { id: string; confirmed: boolean } };
    expect(proposal.relation.confirmed).toBe(false);

    const before = await searchProjectCards({ projectId: project.id, query: "检索方案", limit: 8 });
    expect(before.find((item) => item.cardId === older.id)).toMatchObject({ current: true, supportState: "PENDING" });

    expect((await confirm(new Request("http://localhost/confirm", { method: "POST" }), { params: Promise.resolve({ id: project.id, relationId: proposal.relation.id }) })).status).toBe(200);
    const after = await searchProjectCards({ projectId: project.id, query: "检索方案", limit: 8 });
    expect(after.find((item) => item.cardId === older.id)).toMatchObject({ current: false, supportState: "SUPERSEDED", supersededBy: { id: newer.id } });
    expect(after.find((item) => item.cardId === newer.id)).toMatchObject({ current: true, supportState: "SUPPORTED" });

    const timelineResponse = await timeline(new Request(`http://localhost/api/projects/${project.id}/decisions/timeline`), { params: Promise.resolve({ id: project.id }) });
    const timelineBody = await timelineResponse.json() as { items: Array<{ card: { id: string }; status: string }> };
    expect(timelineBody.items.find((item) => item.card.id === older.id)?.status).toBe("SUPERSEDED");

    expect((await revoke(new Request("http://localhost/revoke", { method: "POST" }), { params: Promise.resolve({ id: project.id, relationId: proposal.relation.id }) })).status).toBe(200);
    const restored = await searchProjectCards({ projectId: project.id, query: "检索方案", limit: 8 });
    expect(restored.find((item) => item.cardId === older.id)).toMatchObject({ current: true, supportState: "REVOKED" });
  });

  it("rejects self, cross-project and cyclic supersession writes", async () => {
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { proposeTemporalRelation, confirmRelation } = await import("@/lib/services/temporalLedgerService");
    const project = await createProject({ title: "关系安全项目", description: "验证自环、跨项目和取代关系成环都会被拒绝。", goal: "关系写入为零越权", scenario: "RESEARCH", deadline: null });
    const other = await createProject({ title: "隔离关系项目", description: "作为跨项目关系写入的隔离对照项目。", goal: "验证隔离", scenario: "LAB_TASK", deadline: null });
    await processCapture(project.id, "决定 A：保留当前可复现实验基线。", "项目决定");
    await processCapture(project.id, "决定 B：用新实验基线取代旧基线。", "项目决定");
    await processCapture(other.id, "另一个项目的独立决定，不能关联。", "项目决定");
    const cards = (await getProjectDetail(project.id)).cards;
    const foreignCard = (await getProjectDetail(other.id)).cards[0];
    const base = { relationType: "SUPERSEDES" as const, confidence: 1, validFrom: null, validTo: null };

    await expect(proposeTemporalRelation(project.id, cards[0].id, { ...base, relatedCardId: cards[0].id, reason: "非法自环" })).rejects.toMatchObject({ code: "RELATION_SELF_LOOP" });
    await expect(proposeTemporalRelation(project.id, cards[0].id, { ...base, relationType: "SUPPORTS", relatedCardId: foreignCard.id, reason: "非法跨项目" })).rejects.toMatchObject({ code: "RELATION_CARD_NOT_FOUND" });
    const first = await proposeTemporalRelation(project.id, cards[0].id, { ...base, relatedCardId: cards[1].id, reason: "B 取代 A" });
    await confirmRelation(project.id, first.id);
    await expect(proposeTemporalRelation(project.id, cards[1].id, { ...base, relatedCardId: cards[0].id, reason: "A 又取代 B" })).rejects.toMatchObject({ code: "SUPERSESSION_CYCLE" });
  });
});
