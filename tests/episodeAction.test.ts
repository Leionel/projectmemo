process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_CALENDAR_REMINDER_ENABLED = "1";
process.env.LLM_MODE = "mock";

import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createActionFromEpisodeSuggestion } from "@/lib/services/episodeActionService";
import {
  arrangeActionReminder,
  getActionReminderState,
  recordActionReminderSync,
  type ReminderActor,
} from "@/lib/services/actionReminderService";

const createdProjectIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) await db.project.delete({ where: { id } }).catch(() => {});
});

const HOUR = 3_600_000;

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "检查点到提醒测试", goal: "R2 闭环", scenario: "RESEARCH" },
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

interface SeedEpisodeOptions {
  claims: unknown[];
  sourceRefs?: unknown[];
}

async function seedPublishedEpisode(projectId: string, options: SeedEpisodeOptions) {
  const now = new Date();
  await db.projectEpisode.create({
    data: {
      projectId,
      kind: "MANUAL",
      title: "阶段检查点",
      windowStart: new Date(now.getTime() - 7 * 24 * HOUR),
      windowEnd: now,
      status: "PUBLISHED",
    },
  });
  const episode = await db.projectEpisode.findFirstOrThrow({ where: { projectId } });
  const revision = await db.episodeRevision.create({
    data: {
      episodeId: episode.id,
      revision: 1,
      sourceHash: "seed",
      sourceRefs: (options.sourceRefs ?? []) as never,
      claims: options.claims as never,
      summary: {
        schemaVersion: 1,
        goals: "",
        sections: [
          { section: "OPEN_QUESTIONS", text: "检查点范围内没有待解决的争议或未知项。" },
          { section: "NEXT_STEPS", text: "当前可开始的行动：「整理实验数据」。" },
        ],
      } as never,
      generationMode: "TEMPLATE",
      status: "PUBLISHED",
      confirmedAt: now,
    },
  });
  return { episode, revision };
}

function cardRef(refId: string, card: { id: string; title: string; summary: string }) {
  return {
    refId,
    kind: "CARD",
    entityId: card.id,
    revisionIndex: null,
    observedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(`${card.title}\n${card.summary}`).digest("hex"),
    title: card.title,
    summary: card.summary,
  };
}

const suggestionClaim = (claimId: string, text: string, suggestedActionId?: string) => ({
  claimId,
  kind: "SUGGESTION",
  section: "NEXT_STEPS",
  text,
  sourceRefIds: [] as string[],
  ...(suggestedActionId ? { suggestedActionId, suggestedReason: "当前可开始" } : {}),
});

interface CapturedError {
  code: string;
  status: number;
  message: string;
}

/** 断言调用失败并取回错误对象；调用意外成功时直接报错，避免假绿 */
async function captureError(operation: Promise<unknown>): Promise<CapturedError> {
  try {
    await operation;
  } catch (error) {
    return error as CapturedError;
  }
  throw new Error("预期的失败没有发生，调用意外成功了");
}

describe("checkpoint to action to reminder (检查点→待办→日历提醒)", () => {
  it("requires an explicit confirmation before creating anything", async () => {
    const project = await newProject("显式确认才创建");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });

    await expect(createActionFromEpisodeSuggestion(project.id, episode.id, {
      claimId: "c1",
      confirm: false,
    } as never)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", status: 422 });
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("creates one todo per suggestion and reuses it on repeated confirmation", async () => {
    const project = await newProject("重复确认只创建一条");
    const { episode, revision } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });

    const first = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true });
    expect(first.reused).toBe(false);
    expect(first.title).toBe("整理实验数据");
    expect(first.source.revisionId).toBe(revision.id);
    expect(first.availability.status).toBe("READY");
    expect(first.availability.canArrangeReminder).toBe(true);

    const second = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true });
    expect(second.reused).toBe(true);
    expect(second.actionId).toBe(first.actionId);
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(1);

    // 并发确认也只会留下一条
    const [concurrentA, concurrentB] = await Promise.all([
      createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true }),
      createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true }),
    ]);
    expect(concurrentA.actionId).toBe(first.actionId);
    expect(concurrentB.actionId).toBe(first.actionId);
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("reuses the existing todo when the suggestion already points at one", async () => {
    const project = await newProject("已有待办时复用");
    const existing = await db.actionItem.create({
      data: { projectId: project.id, title: "整理实验数据", priority: 2, status: "TODO", estimatedMinutes: 60 },
    });
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）", existing.id)],
    });

    const outcome = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true });
    expect(outcome.reused).toBe(true);
    expect(outcome.actionId).toBe(existing.id);
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("refuses to execute a suggestion whose sources changed after publishing", async () => {
    const project = await newProject("来源变化后旧建议");
    const changed = await seedCard(project.id, "结论一", "第一条结论的原始内容");
    const stable = await seedCard(project.id, "结论二", "第二条结论的原始内容");
    const { episode } = await seedPublishedEpisode(project.id, {
      sourceRefs: [cardRef("r1", changed), cardRef("r2", stable)],
      claims: [
        { claimId: "c1", kind: "FACT", section: "CONFIRMED_CHANGES", text: "结论一", sourceRefIds: ["r1"] },
        { claimId: "c2", kind: "FACT", section: "CONFIRMED_CHANGES", text: "结论二", sourceRefIds: ["r2"] },
        {
          claimId: "c3",
          kind: "SUGGESTION",
          section: "NEXT_STEPS",
          text: "建议继续推进：「基于结论一再做一次验证」（当前可开始）",
          sourceRefIds: ["r1"],
        },
      ],
    });

    await db.knowledgeCard.update({ where: { id: changed.id }, data: { summary: "结论一已改写" } });

    const error = await captureError(createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c3", confirm: true }));
    expect(error.code).toBe("EPISODE_CLAIM_STALE");
    expect(error.status).toBe(409);
    expect(error.message).toContain("来源已经变化");
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("explains blocked suggestions and offers unblocking entries instead of arranging time", async () => {
    const project = await newProject("受阻建议与解阻行动");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [
        suggestionClaim("c1", "建议继续推进：「补做对照实验」（依赖未完成）"),
        suggestionClaim("c2", "建议继续推进：「整理结论」（暂时无法确认）"),
      ],
    });

    const blocked = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true });
    // 先让它真的受阻：补一条指向不存在交付物的硬依赖
    await db.actionRequirement.create({
      data: { actionId: blocked.actionId, projectId: project.id, targetKind: "deliverable", targetId: "missing", hard: true },
    });

    const recheck = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true });
    expect(recheck.reused).toBe(true);
    expect(recheck.availability.status).toBe("BLOCKED");
    expect(recheck.availability.canArrangeReminder).toBe(false);
    expect(recheck.availability.blockedReason).toContain("先处理阻塞");
    expect(recheck.availability.entries.map((entry) => entry.kind)).toEqual([
      "ADD_REQUIREMENT",
      "ADD_INFORMATION",
      "CREATE_UNBLOCK_ACTION",
    ]);
    expect(recheck.availability.entries.every((entry) => entry.targetActionId === blocked.actionId)).toBe(true);

    // 受阻时不能直接安排提醒
    const arrangeActor = { userId: "user-blocked", deviceKey: "device-1" };
    await expect(arrangeActionReminder(project.id, blocked.actionId, {
      requestId: "arr-blocked",
      reminderAt: new Date(Date.now() + 3 * HOUR).toISOString(),
    }, arrangeActor)).rejects.toMatchObject({ code: "REMINDER_ACTION_BLOCKED", status: 409 });

    // 解阻行动：幂等、且与受阻待办区分开
    const unblock = await createActionFromEpisodeSuggestion(project.id, episode.id, {
      claimId: "c1",
      confirm: true,
      mode: "UNBLOCK",
      unblockTargetActionId: blocked.actionId,
    });
    expect(unblock.reused).toBe(false);
    expect(unblock.title).toContain("解阻：");
    expect(unblock.availability.status).toBe("READY");
    const unblockAgain = await createActionFromEpisodeSuggestion(project.id, episode.id, {
      claimId: "c1",
      confirm: true,
      mode: "UNBLOCK",
      unblockTargetActionId: blocked.actionId,
    });
    expect(unblockAgain.reused).toBe(true);
    expect(unblockAgain.actionId).toBe(unblock.actionId);
    // 只有受阻待办与解阻待办两条：解阻建议没有重复创建
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(2);
  });

  it("arranges a reminder right after creating the todo and never changes its status", async () => {
    const project = await newProject("创建后安排提醒");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });
    const outcome = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true, estimatedMinutes: 45 });
    const arrangeActor: ReminderActor = { userId: "user-follow", deviceKey: "device-1" };

    const arranged = await arrangeActionReminder(project.id, outcome.actionId, {
      requestId: `arr-${outcome.actionId}`,
      reminderAt: new Date(Date.now() + 5 * HOUR).toISOString(),
      durationMinutes: 30,
    }, arrangeActor);
    expect(arranged.reminder.syncStatus).toBe("PLANNED");
    expect(arranged.devicePlan.map((operation) => operation.kind)).toEqual(["CREATE"]);

    // 安排到日历不改变行动状态
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: outcome.actionId } })).status).toBe("TODO");

    await recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-1",
      eventId: "evt-follow",
    }, arrangeActor);
    const state = await getActionReminderState(project.id, outcome.actionId, arrangeActor);
    expect(state.status).toBe("SYNCED");
    // 依然不是 DONE，也没有结果卡：写入日历不等于完成行动
    const action = await db.actionItem.findUniqueOrThrow({ where: { id: outcome.actionId } });
    expect(action.status).toBe("TODO");
    expect(action.resultCardId).toBeNull();
    expect(action.completedAt).toBeNull();

    // 行动处于 DOING 时安排提醒也不改变状态
    await db.actionItem.update({ where: { id: outcome.actionId }, data: { status: "DOING" } });
    await expect(arrangeActionReminder(project.id, outcome.actionId, {
      requestId: "arr-again",
      reminderAt: new Date(Date.now() + 6 * HOUR).toISOString(),
    }, arrangeActor)).rejects.toMatchObject({ code: "REMINDER_DEVICE_EVENT_EXISTS", status: 409 });
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: outcome.actionId } })).status).toBe("DOING");
  });

  it("rejects unknown claims, unpublished checkpoints and cross-project access", async () => {
    const project = await newProject("建议契约边界");
    const otherProject = await newProject("另一个项目");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });

    await expect(createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "nope", confirm: true }))
      .rejects.toMatchObject({ code: "EPISODE_CLAIM_NOT_FOUND", status: 404 });
    await expect(createActionFromEpisodeSuggestion(otherProject.id, episode.id, { claimId: "c1", confirm: true }))
      .rejects.toMatchObject({ code: "EPISODE_NOT_FOUND", status: 404 });

    // 只有草稿版本时不能执行建议
    const draftEpisode = await db.projectEpisode.create({
      data: {
        projectId: project.id,
        kind: "MANUAL",
        title: "草稿检查点",
        windowStart: new Date(Date.now() - HOUR),
        windowEnd: new Date(),
        status: "DRAFT",
      },
    });
    await db.episodeRevision.create({
      data: {
        episodeId: draftEpisode.id,
        revision: 1,
        sourceHash: "draft",
        sourceRefs: [] as never,
        claims: [suggestionClaim("c1", "建议继续推进：「不该被执行」（当前可开始）")] as never,
        summary: { schemaVersion: 1, goals: "", sections: [] } as never,
        generationMode: "TEMPLATE",
        status: "DRAFT",
      },
    });
    await expect(createActionFromEpisodeSuggestion(project.id, draftEpisode.id, { claimId: "c1", confirm: true }))
      .rejects.toMatchObject({ code: "EPISODE_NOT_PUBLISHED", status: 409 });
  });

  it("stays unavailable while the checkpoint feature is off", async () => {
    const project = await newProject("检查点开关关闭");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });
    const previous = process.env.PROJECT_EPISODES_ENABLED;
    process.env.PROJECT_EPISODES_ENABLED = "0";
    try {
      await expect(createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true }))
        .rejects.toMatchObject({ code: "PROJECT_EPISODES_DISABLED", status: 503 });
    } finally {
      process.env.PROJECT_EPISODES_ENABLED = previous;
    }
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("keeps the completion receipt chain open next to the reminder", async () => {
    const project = await newProject("完成回执仍闭环");
    const { episode } = await seedPublishedEpisode(project.id, {
      claims: [suggestionClaim("c1", "建议继续推进：「整理实验数据」（当前可开始）")],
    });
    const outcome = await createActionFromEpisodeSuggestion(project.id, episode.id, { claimId: "c1", confirm: true, estimatedMinutes: 30 });
    const arrangeActor: ReminderActor = { userId: "user-close", deviceKey: "device-1" };
    const arranged = await arrangeActionReminder(project.id, outcome.actionId, {
      requestId: "arr-close",
      reminderAt: new Date(Date.now() + 4 * HOUR).toISOString(),
    }, arrangeActor);
    await recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-1",
      eventId: "evt-close",
    }, arrangeActor);

    const { completeProjectAction } = await import("@/lib/services/actionService");
    const completed = await completeProjectAction(project.id, outcome.actionId, "整理完了实验数据，结论已写入记录");
    expect(completed.status).toBe("DONE");
    expect(completed.resultCardId).toBeTruthy();
    // 完成同时保留了 resultCardId 闭环，提醒回执仍在，可单独撤销
    const receipt = await db.actionReminder.findUniqueOrThrow({ where: { id: arranged.reminder.id } });
    expect(receipt.syncStatus).toBe("SYNCED");
    const state = await getActionReminderState(project.id, outcome.actionId, arrangeActor);
    expect(state.canArrange).toBe(false);
    expect(state.blockedReason).toContain("已经完成");
  });
});
