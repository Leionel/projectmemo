import { describe, it, expect } from "vitest";
import { buildChangeBrief, buildFirstTimeBrief } from "@/lib/services/projectChangeBriefService";
import { computeProjectStateDiff } from "@/lib/projectState/computeDiff";
import type { ProjectStatePayload, StateDiffItem } from "@/lib/types/projectState";

function minimalPayload(snapshotId: string, overrides: Partial<ProjectStatePayload> = {}): ProjectStatePayload {
  return {
    snapshotId,
    projectId: "proj-1",
    schemaVersion: 1,
    policyVersion: "2",
    evaluatedAt: "2026-09-12T08:00:00.000Z",
    goal: null,
    deadline: null,
    stage: null,
    health: "UNKNOWN",
    facts: [],
    actions: [],
    gaps: [],
    risks: [],
    unknowns: [],
    ...overrides,
  };
}

describe("Project change brief (C1)", () => {
  it("first-time view explains that there is no baseline yet", () => {
    const brief = buildFirstTimeBrief("snap-1");
    expect(brief.materialChange).toBe(false);
    expect(brief.headline).toContain("第一份状态记录");
    expect(brief.sentences).toHaveLength(0);
  });

  it("no material change produces an honest short brief without filler", () => {
    const before = minimalPayload("snap-1");
    const diff = computeProjectStateDiff(before, minimalPayload("snap-2"));
    const brief = buildChangeBrief(diff);
    expect(brief.materialChange).toBe(false);
    expect(brief.sentences).toHaveLength(0);
    expect(brief.headline).toContain("没有可确认的重要变化");
  });

  it("superseded decision sentences carry changeKey, impact, suggestion and evidence count", () => {
    const before = minimalPayload("snap-1", {
      facts: [{
        key: "decision:cA",
        text: "决策「方案A」为当前有效结论",
        truth: "TRUE",
        temporalStatus: "CURRENT",
        evidenceRefs: [{ entityKind: "card", entityId: "cA", field: "title+summary", observedAt: "2026-09-01T00:00:00.000Z", contentHash: "h1" }],
        ruleId: "decision.supersession",
      }],
    });
    const after = minimalPayload("snap-2", {
      facts: [{
        key: "decision:cA",
        text: "决策「方案A」已被「方案B」取代",
        truth: "FALSE",
        temporalStatus: "SUPERSEDED",
        evidenceRefs: [{ entityKind: "card", entityId: "cA", field: "title+summary", observedAt: "2026-09-12T08:00:00.000Z", contentHash: "h2" }],
        ruleId: "decision.supersession",
      }],
    });
    const diff = computeProjectStateDiff(before, after);
    const brief = buildChangeBrief(diff);
    expect(brief.materialChange).toBe(true);
    expect(brief.sentences).toHaveLength(1);
    const sentence = brief.sentences[0];
    expect(sentence.changeKey).toBe("decision:cA:validity");
    expect(sentence.text).toContain("取代");
    expect(sentence.impact).toContain("以新决策为准");
    expect(sentence.suggestion).toContain("检查基于原决策");
    expect(sentence.evidenceCount).toBe(1);
  });

  it("action completion maps to no-repeat guidance", () => {
    const item: StateDiffItem = {
      changeKey: "action:act-1:status",
      kind: "RESOLVED",
      summary: "行动「跑基线实验」已记录为完成",
      before: "TODO",
      after: "DONE",
      evidenceRefs: [{ entityKind: "action", entityId: "act-1", field: "status", observedAt: "2026-09-12T08:00:00.000Z", contentHash: "h3" }],
    };
    const diff = {
      fromSnapshotId: "snap-1",
      toSnapshotId: "snap-2",
      algorithmVersion: "1",
      materialChange: true,
      summary: "共 1 项变化。",
      items: [item],
    };
    const brief = buildChangeBrief(diff);
    expect(brief.sentences[0].impact).toContain("完成回执");
    expect(brief.sentences[0].suggestion).toContain("无需重复执行");
  });

  it("stale cursor spanning multiple changes still yields accurate sentences", () => {
    const before = minimalPayload("snap-old", {
      facts: [{
        key: "decision:cA",
        text: "决策「方案A」为当前有效结论",
        truth: "TRUE",
        temporalStatus: "CURRENT",
        evidenceRefs: [],
        ruleId: "decision.supersession",
      }],
      actions: [{ actionId: "act-1", title: "旧行动", recordedStatus: "TODO", resultCardId: null, evidenceRefs: [] }],
    });
    const after = minimalPayload("snap-new", {
      facts: [{
        key: "decision:cA",
        text: "决策「方案A」已被「方案B」取代",
        truth: "FALSE",
        temporalStatus: "SUPERSEDED",
        evidenceRefs: [],
        ruleId: "decision.supersession",
      }],
      actions: [{ actionId: "act-1", title: "旧行动", recordedStatus: "DONE", resultCardId: "rc-1", evidenceRefs: [] }],
    });
    const diff = computeProjectStateDiff(before, after);
    const brief = buildChangeBrief(diff);
    expect(brief.sentences.some((s) => s.changeKey === "decision:cA:validity")).toBe(true);
    expect(brief.sentences.some((s) => s.changeKey === "action:act-1:status" && s.kind === "RESOLVED")).toBe(true);
    expect(brief.headline).toContain("2 项变化");
  });
});
