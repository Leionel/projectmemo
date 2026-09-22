process.env.PROJECT_HEALTH_ENABLED = "1";
process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";
process.env.PROJECT_INBOX_ENABLED = "1";
process.env.PROJECT_MEMORY_CONSOLIDATION_ENABLED = "1";

import { describe, it, expect, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { buildProjectHealthReport, sortFindings } from "@/lib/services/projectHealthService";
import type { HealthFinding } from "@/lib/types/health";

const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) await db.project.delete({ where: { id } }).catch(() => {});
  for (const id of createdUserIds) await db.user.delete({ where: { id } }).catch(() => {});
});

const HOUR = 3_600_000;

/** 体检必须按当前登录用户过滤个人数据；测试里固定一个查看者身份。 */
const VIEWER_ID = "health-viewer";

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "项目体检测试", goal: "R2 体检", scenario: "RESEARCH" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function seedCard(projectId: string, title: string, summary: string) {
  const capture = await db.capture.create({ data: { projectId, rawText: `${title}\n${summary}`, sourceType: "测试" } });
  return db.knowledgeCard.create({
    data: {
      projectId,
      captureId: capture.id,
      type: "experiment_log",
      title,
      summary,
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance: 3,
    },
  });
}

async function newMember(projectId: string, label = "体检成员") {
  const user = await db.user.create({
    data: {
      username: `health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayName: label,
      passwordHash: "x",
    },
  });
  createdUserIds.push(user.id);
  await db.projectMembership.create({ data: { userId: user.id, projectId, role: "OWNER" } });
  return user;
}

/** 直接写入一份已确认检查点，用于构造确定性的体检输入 */
async function seedEpisode(
  projectId: string,
  claims: unknown[],
  openQuestionText = "检查点范围内没有待解决的争议或未知项。",
) {
  const now = new Date();
  const episode = await db.projectEpisode.create({
    data: {
      projectId,
      kind: "MANUAL",
      title: "阶段检查点",
      windowStart: new Date(now.getTime() - 7 * 24 * HOUR),
      windowEnd: now,
      status: "PUBLISHED",
    },
  });
  const revision = await db.episodeRevision.create({
    data: {
      episodeId: episode.id,
      revision: 1,
      sourceHash: "seed-hash",
      sourceRefs: [],
      claims: claims as never,
      summary: {
        schemaVersion: 1,
        goals: "",
        sections: [
          { section: "OPEN_QUESTIONS", text: openQuestionText },
          { section: "NEXT_STEPS", text: "当前没有评估为 READY 的行动。" },
        ],
      } as never,
      generationMode: "TEMPLATE",
      status: "PUBLISHED",
      confirmedAt: now,
    },
  });
  return { episode, revision };
}

async function seedFreshState(projectId: string, refreshedAt = new Date()) {
  await db.projectStateFreshness.create({
    data: {
      projectId,
      status: "FRESH",
      attemptedAt: refreshedAt,
      refreshedAt,
    },
  });
}

function codes(findings: HealthFinding[]): string[] {
  return findings.map((finding) => finding.findingCode);
}

describe("project health (只读确定性项目体检)", () => {
  it("handles an empty project without inventing progress", async () => {
    const project = await newProject("空项目体检");
    const now = new Date();
    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });

    expect(codes(report.findings)).toEqual(["EPISODE_MISSING", "STATE_NEVER_REFRESHED"]);
    expect(report.primaryAction?.findingCode).toBe("EPISODE_MISSING");
    expect(report.primaryAction?.explanation.length).toBeGreaterThan(0);
    expect(report.primaryMessage).toBe(report.primaryAction?.suggestedAction);
    // 不生成缺乏定义的综合评分
    expect(JSON.stringify(report)).not.toContain("健康度");
    expect(report.readOnly).toBe(true);
    expect(report.groups.map((group) => group.severity)).toEqual(["ATTENTION", "INFO"]);
  });

  it("reports no findings for a healthy project", async () => {
    const project = await newProject("健康项目体检");
    const now = new Date();
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "RULE", section: "GOALS", text: "阶段范围来自系统规则", sourceRefIds: [], ruleCode: "episode.window_scope_v1" },
    ]);
    await seedFreshState(project.id, now);

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    expect(report.findings).toEqual([]);
    expect(report.primaryAction).toBeNull();
    expect(report.primaryMessage).toBe("当前没有需要立即处理的问题");
    expect(report.severityCounts).toEqual({ ACTION_REQUIRED: 0, ATTENTION: 0, INFO: 0 });
    expect(report.unavailable).toEqual([]);
  });

  it("marks a checkpoint partially stale when only some of its sources changed", async () => {
    const project = await newProject("检查点局部过期");
    const now = new Date();
    const cards = [
      await seedCard(project.id, "结论一", "第一条结论的原始内容"),
      await seedCard(project.id, "结论二", "第二条结论的原始内容"),
      await seedCard(project.id, "结论三", "第三条结论的原始内容"),
    ];
    const { createHash } = await import("node:crypto");
    const refs = cards.map((card, index) => ({
      refId: `r${index + 1}`,
      kind: "CARD",
      entityId: card.id,
      revisionIndex: null,
      observedAt: now.toISOString(),
      contentHash: createHash("sha256").update(`${card.title}\n${card.summary}`).digest("hex"),
      title: card.title,
      summary: card.summary,
    }));
    await db.projectEpisode.create({ data: { projectId: project.id, kind: "MANUAL", title: "阶段检查点", windowStart: new Date(now.getTime() - HOUR), windowEnd: now, status: "PUBLISHED" } });
    const episode = await db.projectEpisode.findFirstOrThrow({ where: { projectId: project.id } });
    await db.episodeRevision.create({
      data: {
        episodeId: episode.id,
        revision: 1,
        sourceHash: "seed",
        sourceRefs: refs as never,
        claims: refs.map((ref, index) => ({
          claimId: `c${index + 1}`,
          kind: "FACT",
          section: "CONFIRMED_CHANGES",
          text: `结论 ${index + 1}`,
          sourceRefIds: [ref.refId],
        })) as never,
        summary: { schemaVersion: 1, goals: "", sections: [{ section: "OPEN_QUESTIONS", text: "检查点范围内没有待解决的争议或未知项。" }] } as never,
        generationMode: "TEMPLATE",
        status: "PUBLISHED",
        confirmedAt: now,
      },
    });
    await seedFreshState(project.id, now);

    // 只有第三条来源被改写 → 1/3 受影响，属于局部过期而不是整份过期
    await db.knowledgeCard.update({ where: { id: cards[2].id }, data: { summary: "第三条结论已经改写" } });

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    const partial = report.findings.find((finding) => finding.findingCode === "EPISODE_PARTIALLY_STALE");
    expect(partial).toBeTruthy();
    expect(partial!.title).toContain("1 条结论");
    expect(partial!.severity).toBe("ACTION_REQUIRED");
    expect(codes(report.findings)).not.toContain("EPISODE_STALE");
  });

  it("marks a checkpoint stale when most of its conclusions changed", async () => {
    const project = await newProject("检查点整份过期");
    const now = new Date();
    const card = await seedCard(project.id, "唯一结论", "原始内容");
    const { createHash } = await import("node:crypto");
    await seedEpisode(project.id, [
      {
        claimId: "c1",
        kind: "FACT",
        section: "CONFIRMED_CHANGES",
        text: "唯一结论",
        sourceRefIds: ["r1"],
      },
    ]);
    const episode = await db.projectEpisode.findFirstOrThrow({ where: { projectId: project.id } });
    await db.episodeRevision.updateMany({
      where: { episodeId: episode.id },
      data: {
        sourceRefs: [{
          refId: "r1",
          kind: "CARD",
          entityId: card.id,
          revisionIndex: null,
          observedAt: now.toISOString(),
          contentHash: createHash("sha256").update(`${card.title}\n${card.summary}`).digest("hex"),
          title: card.title,
          summary: card.summary,
        }] as never,
      },
    });
    await seedFreshState(project.id, now);
    await db.knowledgeCard.update({ where: { id: card.id }, data: { summary: "已被改写" } });

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    expect(codes(report.findings)).toContain("EPISODE_STALE");
    expect(report.findings.find((finding) => finding.findingCode === "EPISODE_STALE")!.severity).toBe("ACTION_REQUIRED");
  });

  it("reports unsourced conclusions and open questions inside a checkpoint", async () => {
    const project = await newProject("检查点缺来源与未解决项");
    const now = new Date();
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "FACT", section: "DECISION_TRAIL", text: "某条没有来源的结论", sourceRefIds: [] },
    ], "有 2 条记录处于争议状态，结论不能当作确定事实使用");
    await seedFreshState(project.id, now);

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    expect(codes(report.findings)).toEqual(expect.arrayContaining(["EPISODE_UNSOURCED_CLAIM", "EPISODE_OPEN_QUESTION"]));
    const unsourced = report.findings.find((finding) => finding.findingCode === "EPISODE_UNSOURCED_CLAIM")!;
    expect(unsourced.title).toContain("1 条结论缺少来源");
    expect(unsourced.suggestedTarget.kind).toBe("episode");
  });

  it("reports state refresh failure, blocked actions, missing estimates, overdue work and calendar failures", async () => {
    const project = await newProject("行动与状态问题");
    const now = new Date();
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "RULE", section: "GOALS", text: "范围规则", sourceRefIds: [], ruleCode: "episode.window_scope_v1" },
    ]);
    await db.projectStateFreshness.create({
      data: { projectId: project.id, status: "FAILED", errorMessage: "表结构校验失败", attemptedAt: now },
    });

    // 受阻待办：硬依赖指向一条不存在的交付物
    const blocked = await db.actionItem.create({
      data: { projectId: project.id, title: "受阻的待办", priority: 2, status: "TODO", estimatedMinutes: 60, dueAt: new Date(now.getTime() - 2 * HOUR) },
    });
    await db.actionRequirement.create({
      data: { actionId: blocked.id, projectId: project.id, targetKind: "deliverable", targetId: "missing-deliverable", hard: true },
    });
    // 无法确认：硬依赖一条证据不足的记录
    const card = await seedCard(project.id, "待确认的依据", "证据不足的记录");
    const unknown = await db.actionItem.create({
      data: { projectId: project.id, title: "无法确认的待办", priority: 3, status: "TODO", estimatedMinutes: 30 },
    });
    await db.actionRequirement.create({
      data: { actionId: unknown.id, projectId: project.id, targetKind: "card", targetId: card.id, hard: true },
    });
    // 缺估时
    await db.actionItem.create({ data: { projectId: project.id, title: "没有估时的待办", priority: 3, status: "TODO" } });
    // 日历写入失败
    const reminderAction = await db.actionItem.create({
      data: { projectId: project.id, title: "提醒写入失败的待办", priority: 3, status: "TODO", estimatedMinutes: 45 },
    });
    await db.actionReminder.create({
      data: {
        projectId: project.id,
        actionId: reminderAction.id,
        userId: VIEWER_ID,
        deviceKey: "device-x",
        requestId: "req-x",
        reminderAt: new Date(now.getTime() + 2 * HOUR),
        syncStatus: "FAILED",
        error: "写入设备日历时出错",
      },
    });

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    const seen = codes(report.findings);
    expect(seen).toContain("STATE_REFRESH_FAILED");
    expect(seen).toContain("ACTION_BLOCKED");
    expect(seen).toContain("ACTION_UNKNOWN");
    expect(seen).toContain("ACTION_MISSING_ESTIMATE");
    expect(seen).toContain("ACTION_OVERDUE");
    expect(seen).toContain("ACTION_CALENDAR_SYNC_FAILED");
    // 唯一主行动按固定优先级取「状态刷新失败」
    expect(report.primaryAction?.findingCode).toBe("STATE_REFRESH_FAILED");
    const blockedFinding = report.findings.find((finding) => finding.findingCode === "ACTION_BLOCKED")!;
    expect(blockedFinding.objectId).toBe(blocked.id);
    expect(blockedFinding.suggestedTarget).toEqual({ kind: "action", id: blocked.id, fallback: "action_board" });
  });

  it("reports failed attachments, unapproved meeting changes, duplicate memories and missing deliverable evidence", async () => {
    const project = await newProject("其他事实源问题");
    const now = new Date();
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "RULE", section: "GOALS", text: "范围规则", sourceRefIds: [], ruleCode: "episode.window_scope_v1" },
    ]);
    await seedFreshState(project.id, now);

    await db.attachment.create({
      data: {
        projectId: project.id,
        type: "PDF",
        storageKey: "k1",
        fileName: "实验结果.pdf",
        mimeType: "application/pdf",
        size: 100,
        sha256: "hash-1",
        extractionStatus: "FAILED",
        extractionError: "文件已加密，无法提取正文",
      },
    });
    await db.agentRun.create({
      data: {
        projectId: project.id,
        runType: "EVALUATE",
        status: "SUCCESS",
        provider: "meeting_state_diff",
        trace: {} as never,
        resultJson: { status: "PENDING" } as never,
        confirmedAt: null,
      },
    });
    const milestone = await db.milestone.create({ data: { projectId: project.id, title: "中期检查" } });
    await db.deliverable.create({
      data: {
        milestoneId: milestone.id,
        title: "实验报告",
        expectedEvidence: JSON.stringify(["experiment_log"]),
        status: "PENDING",
      },
    });
    await seedCard(project.id, "召回率实验结论", "切片粒度调优后召回率提升到 78%");
    await seedCard(project.id, "召回率实验结论", "切片粒度调优后召回率提升到78%");

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    const seen = codes(report.findings);
    expect(seen).toContain("ATTACHMENT_EXTRACTION_FAILED");
    expect(seen).toContain("MEETING_CHANGES_UNAPPROVED");
    expect(seen).toContain("DELIVERABLE_EVIDENCE_MISSING");
    expect(seen).toContain("MEMORY_DUPLICATE_GROUP");
    expect(report.findings.find((finding) => finding.findingCode === "ATTACHMENT_EXTRACTION_FAILED")!.explanation)
      .toContain("文件已加密");
    expect(report.findings.find((finding) => finding.findingCode === "DELIVERABLE_EVIDENCE_MISSING")!.explanation)
      .toContain("experiment_log");
  });

  it("keeps other results and names the section when one sub-check fails", async () => {
    const project = await newProject("子检查部分失败");
    const now = new Date();
    await db.actionItem.create({ data: { projectId: project.id, title: "没有估时的待办", priority: 3, status: "TODO" } });

    const previous = process.env.PROJECT_STATE_ENABLED;
    process.env.PROJECT_STATE_ENABLED = "0";
    try {
      const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
      // 状态部分不可用被如实标注，其余已知结果照常返回
      expect(report.unavailable.some((item) => item.section === "state")).toBe(true);
      expect(codes(report.findings)).toContain("ACTION_MISSING_ESTIMATE");
      expect(codes(report.findings)).toContain("EPISODE_MISSING");
      expect(codes(report.findings)).not.toContain("STATE_NEVER_REFRESHED");
    } finally {
      process.env.PROJECT_STATE_ENABLED = previous;
    }
  });

  it("keeps the recommended action stable and deterministic across repeated reads", async () => {
    const project = await newProject("体检排序稳定");
    const now = new Date();
    await db.actionItem.create({ data: { projectId: project.id, title: "没有估时的待办", priority: 3, status: "TODO" } });
    await db.actionItem.create({
      data: { projectId: project.id, title: "已逾期的待办", priority: 2, status: "TODO", estimatedMinutes: 60, dueAt: new Date(now.getTime() - HOUR) },
    });
    await db.agentRun.create({
      data: { projectId: project.id, runType: "EVALUATE", status: "SUCCESS", provider: "meeting_state_diff", trace: {} as never, resultJson: { status: "PENDING" } as never },
    });

    const first = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    const second = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    expect(codes(second.findings)).toEqual(codes(first.findings));
    // 严重度排序：需要马上处理的排在最前
    const severities = first.findings.map((finding) => finding.severity);
    const rank = { ACTION_REQUIRED: 0, ATTENTION: 1, INFO: 2 } as const;
    for (let index = 1; index < severities.length; index += 1) {
      expect(rank[severities[index]]).toBeGreaterThanOrEqual(rank[severities[index - 1]]);
    }
    expect(first.primaryAction?.findingCode).toBe("MEETING_CHANGES_UNAPPROVED");
    // 同一严重度内按固定优先级：空数组顺序不随输入顺序变化
    expect(sortFindings([...first.findings].reverse()).map((item) => item.findingCode)).toEqual(codes(first.findings));
  });

  it("reads the report without creating business writes", async () => {
    const project = await newProject("体检不写入");
    const now = new Date();
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "FACT", section: "DECISION_TRAIL", text: "无来源结论", sourceRefIds: [] },
    ]);
    await db.actionItem.create({ data: { projectId: project.id, title: "没有估时的待办", priority: 3, status: "TODO" } });

    const snapshot = async () => ({
      actions: await db.actionItem.count({ where: { projectId: project.id } }),
      cards: await db.knowledgeCard.count({ where: { projectId: project.id } }),
      episodes: await db.projectEpisode.count({ where: { projectId: project.id } }),
      revisions: await db.episodeRevision.count(),
      runs: await db.agentRun.count({ where: { projectId: project.id } }),
      snapshots: await db.projectStateSnapshot.count({ where: { projectId: project.id } }),
      receipts: await db.memoryMergeReceipt.count({ where: { projectId: project.id } }),
      reminders: await db.actionReminder.count({ where: { projectId: project.id } }),
    });
    const before = await snapshot();
    await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    expect(await snapshot()).toEqual(before);
  });
});
describe("project health isolation (体检的用户隔离与错误清洗)", () => {
  it("never leaks another member's reminders, device state or private schedule", async () => {
    const project = await newProject("体检跨成员隔离");
    const now = new Date();
    const viewer = await newMember(project.id, "查看者");
    const other = await newMember(project.id, "另一位成员");
    await seedEpisode(project.id, [
      { claimId: "c1", kind: "RULE", section: "GOALS", text: "范围规则", sourceRefIds: [], ruleCode: "episode.window_scope_v1" },
    ]);
    await seedFreshState(project.id, now);

    const viewerAction = await db.actionItem.create({
      data: { projectId: project.id, title: "查看者的待办", priority: 3, status: "TODO", estimatedMinutes: 60 },
    });
    const otherAction = await db.actionItem.create({
      data: { projectId: project.id, title: "别人的待办", priority: 3, status: "TODO", estimatedMinutes: 60 },
    });

    // 查看者自己的提醒：写入失败
    const viewerReminder = await db.actionReminder.create({
      data: {
        projectId: project.id,
        actionId: viewerAction.id,
        userId: viewer.id,
        deviceKey: "viewer-device",
        requestId: "req-viewer",
        reminderAt: new Date(now.getTime() + 3 * HOUR),
        syncStatus: "FAILED",
        error: "查看者设备的写入错误",
      },
    });
    // 另一位成员的提醒：权限被拒，并带一条不该外泄的原因
    const otherReminder = await db.actionReminder.create({
      data: {
        projectId: project.id,
        actionId: otherAction.id,
        userId: other.id,
        deviceKey: "other-device",
        requestId: "req-other",
        reminderAt: new Date(now.getTime() + 4 * HOUR),
        syncStatus: "PERMISSION_DENIED",
        error: "OTHER-MEMBER-SECRET-ERROR",
      },
    });
    // 另一位成员的私人排程（含私人时段与错误文本）
    const otherPlan = await db.schedulePlan.create({
      data: {
        projectId: project.id,
        userId: other.id,
        requestId: "plan-other",
        rangeStart: new Date(now.getTime() + 5 * HOUR),
        rangeEnd: new Date(now.getTime() + 9 * HOUR),
        inputHash: "hash-other",
        status: "CONFIRMED",
      },
    });
    const otherBlock = await db.scheduleBlock.create({
      data: {
        planId: otherPlan.id,
        actionId: otherAction.id,
        actionVersion: 1,
        startAt: new Date(now.getTime() + 5 * HOUR),
        endAt: new Date(now.getTime() + 6 * HOUR),
        calendarSyncStatus: "FAILED",
        calendarError: "OTHER-PRIVATE-PLAN-ERROR",
      },
    });
    const viewerPlan = await db.schedulePlan.create({
      data: {
        projectId: project.id,
        userId: viewer.id,
        requestId: "plan-viewer",
        rangeStart: new Date(now.getTime() + 2 * HOUR),
        rangeEnd: new Date(now.getTime() + 4 * HOUR),
        inputHash: "hash-viewer",
        status: "CONFIRMED",
      },
    });
    await db.scheduleBlock.create({
      data: {
        planId: viewerPlan.id,
        actionId: viewerAction.id,
        actionVersion: 1,
        startAt: new Date(now.getTime() + 2 * HOUR),
        endAt: new Date(now.getTime() + 3 * HOUR),
        calendarSyncStatus: "FAILED",
        calendarError: "VIEWER-SQLITE-SECRET",
      },
    });

    const report = await buildProjectHealthReport(project.id, { userId: viewer.id, now });
    const serialized = JSON.stringify(report);

    // 自己的问题能看到
    expect(codes(report.findings)).toContain("ACTION_CALENDAR_SYNC_FAILED");
    expect(serialized).toContain(viewerReminder.id);
    // 别人的提醒、权限状态、失败原因与私人时段一律不得出现
    expect(serialized).not.toContain(otherReminder.id);
    expect(serialized).not.toContain("OTHER-MEMBER-SECRET-ERROR");
    expect(serialized).not.toContain("OTHER-PRIVATE-PLAN-ERROR");
    expect(serialized).not.toContain("VIEWER-SQLITE-SECRET");
    expect(serialized).not.toContain(otherBlock.id);
    expect(serialized).not.toContain(otherPlan.id);
    expect(report.findings.some((finding) => finding.objectId === otherReminder.id)).toBe(false);
    expect(report.findings.some((finding) => finding.objectId === otherBlock.id)).toBe(false);
    // 项目共享的行动事实仍然所有人一致（不受个人过滤影响）
    const otherView = await buildProjectHealthReport(project.id, { userId: other.id, now });
    const sharedOfViewer = report.findings.filter((finding) => finding.findingCode === "ACTION_MISSING_ESTIMATE").length;
    expect(otherView.findings.filter((finding) => finding.findingCode === "ACTION_MISSING_ESTIMATE").length)
      .toBe(sharedOfViewer);
  });

  it("does not check personal reminders when there is no viewer identity", async () => {
    const project = await newProject("没有登录身份的体检");
    const now = new Date();
    const action = await db.actionItem.create({
      data: { projectId: project.id, title: "别人的待办", priority: 3, status: "TODO", estimatedMinutes: 30 },
    });
    await db.actionReminder.create({
      data: {
        projectId: project.id,
        actionId: action.id,
        userId: "someone-else",
        deviceKey: "device-z",
        requestId: "req-nobody",
        reminderAt: new Date(now.getTime() + 3 * HOUR),
        syncStatus: "PERMISSION_DENIED",
        error: "SECRET-WITHOUT-VIEWER",
      },
    });

    const report = await buildProjectHealthReport(project.id, { userId: null, now });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("SECRET-WITHOUT-VIEWER");
    expect(report.findings.some((finding) => finding.findingCode === "ACTION_CALENDAR_SYNC_FAILED")).toBe(false);
    expect(report.unavailable.some((item) => item.section === "personal_schedule")).toBe(true);
  });

  it("returns a stable Chinese classification instead of raw internal error text", async () => {
    const project = await newProject("体检错误清洗");
    const now = new Date();
    // 构造一条真实会抛非预期异常的输入：claims 被写成对象而不是数组，
    // 检查点新鲜度评估在迭代它时会抛 TypeError（不是我们定义的错误码）。
    await db.projectEpisode.create({
      data: {
        projectId: project.id,
        kind: "MANUAL",
        title: "损坏的检查点",
        windowStart: new Date(now.getTime() - HOUR),
        windowEnd: now,
        status: "PUBLISHED",
      },
    });
    const episode = await db.projectEpisode.findFirstOrThrow({ where: { projectId: project.id } });
    await db.episodeRevision.create({
      data: {
        episodeId: episode.id,
        revision: 1,
        sourceHash: "seed",
        sourceRefs: [] as never,
        claims: { broken: true } as never,
        summary: { schemaVersion: 1, goals: "", sections: [] } as never,
        generationMode: "TEMPLATE",
        status: "PUBLISHED",
        confirmedAt: now,
      },
    });

    const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
    const serialized = JSON.stringify(report);
    const entry = report.unavailable.find((item) => item.section === "episodes");
    expect(entry).toBeTruthy();
    // 未知异常一律折叠成稳定分类，不复述异常文本、栈或数据库关键字
    expect(entry!.errorCode).toBe("SECTION_UNAVAILABLE");
    expect(entry!.message).toContain("暂时无法读取");
    expect(serialized).not.toMatch(/TypeError|not iterable|Prisma|SQLITE|at |\/.*\.ts/i);
    // 其余子检查照常返回已知结果
    expect(codes(report.findings)).toContain("STATE_NEVER_REFRESHED");
  });

  it("only reports a known disabled section as disabled, not as an internal failure", async () => {
    const project = await newProject("体检开关关闭的分类");
    const now = new Date();
    const previous = process.env.PROJECT_STATE_ENABLED;
    process.env.PROJECT_STATE_ENABLED = "0";
    try {
      const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
      const entry = report.unavailable.find((item) => item.section === "state");
      expect(entry).toBeTruthy();
      expect(entry!.errorCode).toBe("PROJECT_STATE_DISABLED");
      expect(entry!.message).toContain("项目状态功能当前已关闭");
      expect(entry!.message).not.toContain("Prisma");
    } finally {
      process.env.PROJECT_STATE_ENABLED = previous;
    }
  });

  it("folds SQLITE-style error codes into the stable unavailable classification", async () => {
    const project = await newProject("体检内部错误码清洗");
    const now = new Date();
    const failure = Object.assign(new Error("SQLITE raw detail should stay server-side"), { code: "SQLITE_BUSY" });
    const spy = vi.spyOn(db.projectEpisode, "findFirst").mockRejectedValueOnce(failure);
    try {
      const report = await buildProjectHealthReport(project.id, { userId: VIEWER_ID, now });
      const entry = report.unavailable.find((item) => item.section === "episodes");
      expect(entry).toEqual({
        section: "episodes",
        errorCode: "SECTION_UNAVAILABLE",
        message: "阶段检查点暂时无法读取，本次体检不包含这一部分。",
      });
      expect(JSON.stringify(report)).not.toContain("SQLITE_BUSY");
      expect(JSON.stringify(report)).not.toContain("raw detail");
    } finally {
      spy.mockRestore();
    }
  });
});
