import { describe, it, expect } from "vitest";
import { buildProjectState, sha256Hex, stableStringify } from "@/lib/projectState/buildSnapshot";
import { computeProjectStateDiff, isRebuildRequiredError } from "@/lib/projectState/computeDiff";
import type { ProjectStatePayload, SnapshotSourceInput } from "@/lib/types/projectState";

function sourceInput(overrides: Partial<SnapshotSourceInput> = {}): SnapshotSourceInput {
  return {
    projectId: "proj-1",
    goal: "完成复赛方案",
    deadline: null,
    cards: [],
    relations: [],
    actions: [],
    deliverables: [],
    now: "2026-09-12T08:00:00.000Z",
    ...overrides,
  };
}

function supersessionRelation(cardAId: string, cardBId: string, confirmed = true) {
  return {
    id: `rel-${cardAId}-${cardBId}`,
    relationType: "SUPERSEDES",
    reason: "方案调整",
    confirmed,
    confirmedAt: confirmed ? "2026-09-11T10:00:00.000Z" : null,
    revokedAt: null,
    currentCardId: cardBId,
    relatedCardId: cardAId,
    counterpartTitle: cardBId === cardAId ? "" : "方案B：量化管线",
  };
}

describe("buildProjectState (pure)", () => {
  it("is deterministic: identical source produces identical hashes", () => {
    const a = buildProjectState(sourceInput({
      cards: [{ id: "c1", title: "方案A", summary: "s", createdAt: "2026-09-01T00:00:00.000Z" }],
    }));
    const b = buildProjectState(sourceInput({
      cards: [{ id: "c1", title: "方案A", summary: "s", createdAt: "2026-09-01T00:00:00.000Z" }],
    }));
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.evaluationKey).toBe("phase:steady");
  });

  it("ignores array reordering: sorted keys yield the same content hash", () => {
    const cardA = { id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" };
    const cardB = { id: "cB", title: "方案B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" };
    const relAB = supersessionRelation("cA", "cB");
    const ordered = buildProjectState(sourceInput({ cards: [cardA, cardB], relations: [relAB] }));
    const shuffled = buildProjectState(sourceInput({ cards: [cardB, cardA], relations: [relAB] }));
    expect(ordered.contentHash).toBe(shuffled.contentHash);
  });

  it("marks a confirmed superseded decision FALSE and its successor TRUE", () => {
    const built = buildProjectState(sourceInput({
      cards: [
        { id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "cB", title: "方案B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" },
      ],
      relations: [supersessionRelation("cA", "cB")],
    }));
    const a = built.facts.find((fact) => fact.key === "decision:cA");
    const b = built.facts.find((fact) => fact.key === "decision:cB");
    expect(a?.truth).toBe("FALSE");
    expect(a?.text).toContain("已被");
    expect(b?.truth).toBe("TRUE");
  });

  it("keeps unconfirmed relations UNKNOWN instead of guessing", () => {
    const built = buildProjectState(sourceInput({
      cards: [{ id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" }],
      relations: [supersessionRelation("cX", "cA", false)],
    }));
    const a = built.facts.find((fact) => fact.key === "decision:cA");
    expect(a?.truth).toBe("UNKNOWN");
    expect(a?.temporalStatus).toBe("PENDING");
  });

  it("crossing a deadline boundary changes evaluationKey and produces a risk", () => {
    const deadline = "2026-09-10T00:00:00.000Z";
    const before = buildProjectState(sourceInput({ deadline, now: "2026-09-05T00:00:00.000Z" }));
    const after = buildProjectState(sourceInput({ deadline, now: "2026-09-12T00:00:00.000Z" }));
    expect(before.evaluationKey).toBe("deadline:2026-09-10T00:00:00.000Z:approaching");
    expect(after.evaluationKey).toBe("deadline:2026-09-10T00:00:00.000Z:passed");
    expect(before.health).toBe("AT_RISK");
    expect(after.risks.some((risk) => risk.stableKey === "risk:deadline:passed" && risk.truth === "TRUE")).toBe(true);
  });

  it("confirmed CONTRADICTS surfaces as conflict instead of support", () => {
    const built = buildProjectState(sourceInput({
      cards: [
        { id: "cA", title: "实测吞吐A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "cB", title: "实测吞吐B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" },
      ],
      relations: [{
        id: "r-con",
        relationType: "CONTRADICTS",
        reason: "两次测试结果矛盾",
        confirmed: true,
        confirmedAt: "2026-09-03T00:00:00.000Z",
        revokedAt: null,
        validFrom: null,
        validTo: null,
        createdAt: "2026-09-02T00:00:00.000Z",
        currentCardId: "cB",
        relatedCardId: "cA",
        counterpartTitle: "实测吞吐B",
      }],
    }));
    for (const key of ["decision:cA", "decision:cB"]) {
      const fact = built.facts.find((item) => item.key === key);
      expect(fact?.truth).toBe("UNKNOWN");
      expect(fact?.temporalStatus).toBe("CONFLICT");
      expect(fact?.text).toContain("冲突");
    }
  });

  it("a supersession with future validFrom does not take effect early", () => {
    const built = buildProjectState(sourceInput({
      cards: [
        { id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "cB", title: "方案B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" },
      ],
      relations: [{
        id: "r-future",
        relationType: "SUPERSEDES",
        reason: "计划切换",
        confirmed: true,
        confirmedAt: "2026-09-03T00:00:00.000Z",
        revokedAt: null,
        validFrom: "2026-10-01T00:00:00.000Z",
        validTo: null,
        createdAt: "2026-09-02T00:00:00.000Z",
        currentCardId: "cB",
        relatedCardId: "cA",
        counterpartTitle: "方案B",
      }],
      now: "2026-09-12T00:00:00.000Z",
    }));
    const a = built.facts.find((fact) => fact.key === "decision:cA");
    const b = built.facts.find((fact) => fact.key === "decision:cB");
    expect(a?.truth).not.toBe("FALSE");
    expect(a?.temporalStatus).not.toBe("SUPERSEDED");
    expect(b?.truth).not.toBe("TRUE");
  });

  it("contentHash ignores observation time on identical business content", () => {
    const cards = [{ id: "c1", title: "方案A", summary: "s", createdAt: "2026-09-01T00:00:00.000Z" }];
    const a = buildProjectState(sourceInput({ cards, now: "2026-09-12T00:00:00.000Z" }));
    const b = buildProjectState(sourceInput({ cards, now: "2026-09-12T00:00:01.000Z" }));
    expect(a.contentHash).toBe(b.contentHash);
    // 源数组顺序不参与哈希
    const shuffled = buildProjectState(sourceInput({
      cards: [{ id: "c2", title: "方案B", summary: "s2", createdAt: "2026-09-02T00:00:00.000Z" }, cards[0]],
      relations: [supersessionRelation("c1", "c2")],
      now: "2026-09-12T00:00:00.000Z",
    }));
    const ordered = buildProjectState(sourceInput({
      cards: [cards[0], { id: "c2", title: "方案B", summary: "s2", createdAt: "2026-09-02T00:00:00.000Z" }],
      relations: [supersessionRelation("c1", "c2")],
      now: "2026-09-12T00:00:00.000Z",
    }));
    expect(shuffled.sourceHash).toBe(ordered.sourceHash);
  });

  it("reports missing deadline as an explicit unknown rather than assuming safety", () => {
    const built = buildProjectState(sourceInput());
    expect(built.unknowns.some((item) => item.predicate === "deadline.risk")).toBe(true);
    expect(built.health).toBe("UNKNOWN");
  });
});

function payloadFrom(built: ReturnType<typeof buildProjectState>, snapshotId: string): ProjectStatePayload {
  return {
    snapshotId,
    projectId: built.projectId,
    schemaVersion: built.schemaVersion,
    policyVersion: built.policyVersion,
    evaluatedAt: built.evaluatedAt,
    goal: built.goal,
    deadline: built.deadline,
    stage: built.stage,
    health: built.health,
    facts: built.facts,
    actions: built.actions,
    gaps: built.gaps,
    risks: built.risks,
    unknowns: built.unknowns,
  };
}

describe("computeProjectStateDiff (pure)", () => {
  it("A→B supersession yields one CHANGED item for A and one ADDED item for B", () => {
    const cards = [
      { id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "cB", title: "方案B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" },
    ];
    const before = payloadFrom(buildProjectState(sourceInput({ cards: [cards[0]] })), "snap-1");
    const after = payloadFrom(buildProjectState(sourceInput({ cards, relations: [supersessionRelation("cA", "cB")] })), "snap-2");

    const diff = computeProjectStateDiff(before, after);
    expect(diff.materialChange).toBe(true);
    const aItem = diff.items.find((item) => item.changeKey === "decision:cA:validity");
    const bItem = diff.items.find((item) => item.changeKey === "decision:cB:validity");
    expect(aItem?.kind).toBe("CHANGED");
    expect(bItem?.kind).toBe("ADDED");
  });

  it("action completion shows as RESOLVED; reopen shows as REGRESSED", () => {
    const base = sourceInput({
      actions: [{ id: "act-1", title: "跑基线实验", status: "TODO", resultCardId: null, completedAt: null, dueAt: null }],
    });
    const before = payloadFrom(buildProjectState(base), "snap-1");
    const done = payloadFrom(buildProjectState(sourceInput({
      ...base,
      actions: [{ id: "act-1", title: "跑基线实验", status: "DONE", resultCardId: "rc-1", completedAt: "2026-09-12T09:00:00.000Z", dueAt: null }],
    })), "snap-2");
    const reopened = payloadFrom(buildProjectState(base), "snap-3");

    const diff = computeProjectStateDiff(before, done);
    expect(diff.items.find((item) => item.changeKey === "action:act-1:status")?.kind).toBe("RESOLVED");

    const regressDiff = computeProjectStateDiff(done, reopened);
    expect(regressDiff.items.find((item) => item.changeKey === "action:act-1:status")?.kind).toBe("REGRESSED");
  });

  it("A→B→A recurrence is not swallowed: reverting to an earlier decision is a real change", () => {
    // 现实模型：回到旧方案 = 新卡片 C 取代 B。B 从 TRUE 变 FALSE，C 新增且 TRUE。
    const cards = [
      { id: "cA", title: "方案A", summary: "sa", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "cB", title: "方案B", summary: "sb", createdAt: "2026-09-02T00:00:00.000Z" },
      { id: "cC", title: "恢复方案A的新卡片", summary: "sc", createdAt: "2026-09-03T00:00:00.000Z" },
    ];
    const stateB = payloadFrom(buildProjectState(sourceInput({
      cards: [cards[0], cards[1]],
      relations: [supersessionRelation("cA", "cB")],
    })), "snap-2");
    const stateC = payloadFrom(buildProjectState(sourceInput({
      cards,
      relations: [
        supersessionRelation("cA", "cB"),
        supersessionRelation("cB", "cC"),
      ],
    })), "snap-3");

    const diffBack = computeProjectStateDiff(stateB, stateC);
    expect(diffBack.materialChange).toBe(true);
    expect(diffBack.items.some((item) => item.changeKey === "decision:cB:validity" && item.kind === "CHANGED")).toBe(true);
    expect(diffBack.items.some((item) => item.changeKey === "decision:cC:validity" && item.kind === "ADDED")).toBe(true);
  });

  it("does not count pure timestamp differences as material change", () => {
    const base = sourceInput();
    const p1 = payloadFrom(buildProjectState(base), "snap-1");
    const p2 = payloadFrom({ ...buildProjectState(base), evaluatedAt: "2026-09-13T00:00:00.000Z" }, "snap-2");
    const diff = computeProjectStateDiff(p1, p2);
    expect(diff.materialChange).toBe(false);
    expect(diff.summary).toContain("没有可确认的重要变化");
  });

  it("throws rebuild-required on schema version mismatch", () => {
    const base = payloadFrom(buildProjectState(sourceInput()), "snap-1");
    const newer = { ...base, schemaVersion: base.schemaVersion + 1 };
    try {
      computeProjectStateDiff(base, newer);
      expect.unreachable("should throw");
    } catch (error) {
      expect(isRebuildRequiredError(error)).toBe(true);
    }
  });
});

describe("hashing helpers", () => {
  it("stableStringify sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(sha256Hex("x")).toHaveLength(64);
  });
});
