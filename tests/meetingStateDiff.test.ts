process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  confirmMeetingChanges,
  createMeetingImpactPreview,
  extractMeetingChanges,
  resolveDeadlinePhrase,
} from "@/lib/services/meetingStateDiffService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";

process.env.PROJECT_STATE_ENABLED = "1";

describe("Meeting state diff (T1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "会议状态变化测试项目",
        description: "验证文本预览、逐项确认、版本绑定与原子提交",
        goal: "T1 验收",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  async function seedCard(title: string) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: `${title} 摘要`,
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
  }

  it("resolves relative dates only with an explicit meeting date", () => {
    const ambiguous = resolveDeadlinePhrase("周五", null);
    expect(ambiguous.ambiguous).toBe(true);

    const resolved = resolveDeadlinePhrase("下周五", "2026-09-14");
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.iso).toBe("2026-09-25");

    const explicit = resolveDeadlinePhrase("2026-10-01", null);
    expect(explicit.ambiguous).toBe(false);
    expect(explicit.iso).toBe("2026-10-01");
  });

  it("extracts supersede, action and deadline candidates with evidence spans", () => {
    const changes = extractMeetingChanges(
      "会上决定将选型方案A改为轻量方案B。小张需要完成端侧测试报告。截止时间提前到2026-10-01。",
      "2026-09-14",
      [{ id: "cA", title: "选型方案A" }],
    );
    const supersede = changes.find((c) => c.kind === "DECISION_SUPERSEDE");
    const action = changes.find((c) => c.kind === "ACTION_CREATE");
    const deadline = changes.find((c) => c.kind === "DEADLINE_CHANGE");
    expect(supersede?.supersededCardId).toBe("cA");
    expect(supersede?.evidenceSpan).toContain("选型方案A");
    expect(action?.status).toBe("PROPOSED");
    expect(deadline?.deadlineISO).toBe("2026-10-01");
  });

  it("previews against a base snapshot and marks unresolvable items for clarification", async () => {
    await seedCard("方案A：旧基线");
    const preview = await createMeetingImpactPreview(projectId, {
      text: "方案A：旧基线改为方案C。截止改为下周五。",
    });
    expect(preview.baseSnapshotId).not.toBe("");
    const supersede = preview.typedChanges.find((c) => c.kind === "DECISION_SUPERSEDE");
    expect(supersede?.status).toBe("PROPOSED");
    // 无会议日期 → 相对日期待澄清
    const deadline = preview.typedChanges.find((c) => c.kind === "DEADLINE_CHANGE");
    expect(deadline?.status).toBe("NEEDS_CLARIFICATION");
  });

  it("rejects confirming clarification items, unknown old decisions and duplicate-name ambiguity", async () => {
    // 同名卡 → 歧义
    await seedCard("同名方案D");
    await seedCard("同名方案D");
    const preview = await createMeetingImpactPreview(projectId, {
      text: "同名方案D同名方案D改为最终方案E",
    });
    const supersede = preview.typedChanges.find((c) => c.kind === "DECISION_SUPERSEDE");
    expect(supersede?.status).toBe("NEEDS_CLARIFICATION");
    await expect(
      confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: preview.sourceTextHash,
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [supersede!.changeId],
      }),
    ).rejects.toThrow();

    // 不存在旧决策
    const preview2 = await createMeetingImpactPreview(projectId, {
      text: "从未记录过的旧方案X改为新方案Y",
    });
    const supersede2 = preview2.typedChanges.find((c) => c.kind === "DECISION_SUPERSEDE");
    expect(supersede2?.supersededCardId).toBeNull();
    await expect(
      confirmMeetingChanges(projectId, {
        proposalId: preview2.proposalId,
        sourceTextHash: preview2.sourceTextHash,
        proposalVersion: preview2.proposalVersion,
        selectedChangeIds: [supersede2!.changeId],
      }),
    ).rejects.toThrow();
  });

  it("applies only selected changes atomically; preparing is never recorded as DONE", async () => {
    const cardA = await seedCard("原子测试方案A");
    void cardA;
    const preview = await createMeetingImpactPreview(projectId, {
      text: "原子测试方案A改为原子测试方案B。团队准备做性能回归测试。结论：本轮以端侧指标为准",
      meetingDate: "2026-09-14",
    });
    const beforeCards = await db.knowledgeCard.count({ where: { projectId } });
    const beforeActions = await db.actionItem.count({ where: { projectId } });

    const supersede = preview.typedChanges.find((c) => c.kind === "DECISION_SUPERSEDE")!;
    const action = preview.typedChanges.find((c) => c.kind === "ACTION_CREATE")!;
    const fact = preview.typedChanges.find((c) => c.kind === "FACT_RECORD")!;

    // 部分勾选：只确认取代与行动，不确认结论
    const result = await confirmMeetingChanges(projectId, {
      proposalId: preview.proposalId,
      sourceTextHash: preview.sourceTextHash,
      proposalVersion: preview.proposalVersion,
      selectedChangeIds: [supersede.changeId, action.changeId],
    });
    expect(result.applied).toHaveLength(2);
    expect(result.afterSnapshotId).not.toBeNull();

    const afterCards = await db.knowledgeCard.count({ where: { projectId } });
    const afterActions = await db.actionItem.count({ where: { projectId } });
    expect(afterCards).toBe(beforeCards + 1);
    expect(afterActions).toBe(beforeActions + 1);

    // “准备做”只能是 TODO
    const createdAction = await db.actionItem.findUnique({ where: { id: result.applied[1].newActionId! } });
    expect(createdAction?.status).toBe("TODO");

    // 未勾选的结论未写入
    const factCards = await db.knowledgeCard.count({
      where: { projectId, summary: { contains: "端侧指标" } },
    });
    expect(factCards).toBe(0);

    // 重复确认返回相同业务 ID
    const repeat = await confirmMeetingChanges(projectId, {
      proposalId: preview.proposalId,
      sourceTextHash: preview.sourceTextHash,
      proposalVersion: preview.proposalVersion,
      selectedChangeIds: [supersede.changeId, action.changeId],
    });
    expect(repeat.alreadyConfirmed).toBe(true);
    expect(repeat.applied[0].newCardId).toBe(result.applied[0].newCardId);
    expect(fact!.status).toBe("PROPOSED");

    void fact;
  });

  it("rejects tampered text/version and detects source changes between preview and confirm", async () => {
    const cardA = await seedCard("版本绑定方案A");
    void cardA;
    const preview = await createMeetingImpactPreview(projectId, {
      text: "版本绑定方案A改为版本绑定方案B",
    });
    const supersede = preview.typedChanges.find((c) => c.kind === "DECISION_SUPERSEDE")!;

    // 文本被改 → 版本不匹配
    await expect(
      confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: "tampered",
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [supersede.changeId],
      }),
    ).rejects.toThrow();

    // 预览后源状态已变化（旧卡被其他变更取代）→ 冲突并要求重预览
    const rival = await analyzeChangeImpact(projectId, "版本绑定方案A改为抢先方案Z");
    await confirmChangeImpact(projectId, {
      proposalId: rival.proposalId,
      newFactText: "版本绑定方案A改为抢先方案Z",
      supersededCardId: rival.supersededCardId,
    });
    await expect(
      confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: preview.sourceTextHash,
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [supersede.changeId],
      }),
    ).rejects.toThrow("重新预览");
  });

  it("cancel preview leaves project facts untouched", async () => {
    const before = await db.knowledgeCard.count({ where: { projectId } });
    await createMeetingImpactPreview(projectId, { text: "取消测试：方案Q改为方案R" });
    const after = await db.knowledgeCard.count({ where: { projectId } });
    expect(after).toBe(before);
  });

  it("confirms one meeting proposal once under concurrent retries", async () => {
    const oldCard = await seedCard("并发确认旧方案A");
    const preview = await createMeetingImpactPreview(projectId, {
      text: "并发确认旧方案A改为并发确认新方案B。",
      meetingDate: "2026-09-14",
    });
    const change = preview.typedChanges.find((item) => item.kind === "DECISION_SUPERSEDE");
    expect(change?.supersededCardId).toBe(oldCard.id);

    const results = await Promise.all(
      [0, 1].map(() => confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: preview.sourceTextHash,
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [change!.changeId],
      })),
    );
    expect(results.filter((result) => !result.alreadyConfirmed)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyConfirmed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.applied[0]?.newCardId)).size).toBe(1);
    expect(await db.cardRelation.count({
      where: { relatedCardId: oldCard.id, relationType: "SUPERSEDES", confirmed: true },
    })).toBe(1);
  });

  it("rejects an old deadline proposal after the project deadline changes", async () => {
    const preview = await createMeetingImpactPreview(projectId, {
      text: "截止时间改为2026-10-01",
      meetingDate: "2026-09-14",
    });
    const deadline = preview.typedChanges.find((item) => item.kind === "DEADLINE_CHANGE");
    expect(deadline?.deadlineISO).toBe("2026-10-01");

    await db.project.update({ where: { id: projectId }, data: { deadline: new Date("2026-11-01T00:00:00.000Z") } });
    await expect(confirmMeetingChanges(projectId, {
      proposalId: preview.proposalId,
      sourceTextHash: preview.sourceTextHash,
      proposalVersion: preview.proposalVersion,
      selectedChangeIds: [deadline!.changeId],
    })).rejects.toThrow("重新预览");
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).deadline?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("allows only one selection set to win when confirmations race", async () => {
    const preview = await createMeetingImpactPreview(projectId, {
      text: "并发选择需要完成端侧回归。结论：本轮以端侧指标为准",
      meetingDate: "2026-09-14",
    });
    const action = preview.typedChanges.find((item) => item.kind === "ACTION_CREATE")!;
    const fact = preview.typedChanges.find((item) => item.kind === "FACT_RECORD")!;
    const beforeActions = await db.actionItem.count({ where: { projectId } });
    const beforeFactCards = await db.knowledgeCard.count({ where: { projectId, summary: "本轮以端侧指标为准" } });

    const results = await Promise.all([
      confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: preview.sourceTextHash,
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [action.changeId],
      }),
      confirmMeetingChanges(projectId, {
        proposalId: preview.proposalId,
        sourceTextHash: preview.sourceTextHash,
        proposalVersion: preview.proposalVersion,
        selectedChangeIds: [fact.changeId],
      }),
    ]);
    expect(results.filter((result) => !result.alreadyConfirmed)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyConfirmed)).toHaveLength(1);
    expect(await db.actionItem.count({ where: { projectId } })).toBeGreaterThanOrEqual(beforeActions);
    expect(await db.knowledgeCard.count({ where: { projectId, summary: "本轮以端侧指标为准" } })).toBeGreaterThanOrEqual(beforeFactCards);
  });

  it("does not partially apply a multi-change confirmation when one source conflicts", async () => {
    const oldCard = await seedCard("组确认旧方案A");
    const preview = await createMeetingImpactPreview(projectId, {
      text: "组确认旧方案A改为组确认新方案B。截止时间改为2026-12-01",
      meetingDate: "2026-09-14",
    });
    const supersede = preview.typedChanges.find((item) => item.kind === "DECISION_SUPERSEDE")!;
    const deadline = preview.typedChanges.find((item) => item.kind === "DEADLINE_CHANGE")!;
    const rivalCapture = await db.capture.create({ data: { projectId, rawText: "抢先决策", sourceType: "会议" } });
    const rival = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: rivalCapture.id,
        type: "meeting_note",
        title: "抢先决策",
        summary: "抢先决策",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 4,
      },
    });
    await db.cardRelation.create({
      data: {
        currentCardId: rival.id,
        relatedCardId: oldCard.id,
        relationType: "SUPERSEDES",
        reason: "并发抢先确认",
        score: 100,
        confirmed: true,
        confirmedAt: new Date(),
      },
    });
    const beforeDeadline = (await db.project.findUniqueOrThrow({ where: { id: projectId } })).deadline;
    const beforeActionCount = await db.actionItem.count({ where: { projectId } });

    await expect(confirmMeetingChanges(projectId, {
      proposalId: preview.proposalId,
      sourceTextHash: preview.sourceTextHash,
      proposalVersion: preview.proposalVersion,
      selectedChangeIds: [supersede.changeId, deadline.changeId],
    })).rejects.toThrow("重新预览");

    expect(await db.actionItem.count({ where: { projectId } })).toBe(beforeActionCount);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).deadline?.toISOString() ?? null).toBe(beforeDeadline?.toISOString() ?? null);
    expect(await db.knowledgeCard.count({ where: { projectId, title: { contains: "组确认新方案B" } } })).toBe(0);
  });
});
