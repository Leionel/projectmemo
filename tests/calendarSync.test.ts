process.env.PROJECT_SCHEDULING_ENABLED = "1";
process.env.PROJECT_CALENDAR_SYNC_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  confirmSchedulePlan,
  markCalendarRevoked,
  previewSchedule,
  recordCalendarSync,
} from "@/lib/services/scheduleService";

const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) await db.project.delete({ where: { id } }).catch(() => {});
  for (const id of createdUserIds) await db.user.delete({ where: { id } }).catch(() => {});
});

const HOUR = 3_600_000;

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "日历同步测试", goal: "R2 日历验收", scenario: "COMPETITION" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function newOwner(projectId: string) {
  const user = await db.user.create({
    data: { username: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, displayName: "日历测试用户", passwordHash: "x" },
  });
  createdUserIds.push(user.id);
  await db.projectMembership.create({ data: { userId: user.id, projectId, role: "OWNER" } });
  return user;
}

async function confirmedPlanWithOneBlock(projectId: string, userId: string, baseOffsetHours: number) {
  const action = await db.actionItem.create({
    data: { projectId, title: "写实验报告", priority: 2, status: "TODO", estimatedMinutes: 60 },
  });
  const base = Date.now() + baseOffsetHours * HOUR;
  const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 4 * HOUR).toISOString() }];
  const plan = await previewSchedule(projectId, {
    requestId: `cal-${projectId}-${baseOffsetHours}`,
    rangeStart: slots[0].start,
    rangeEnd: slots[0].end,
    slots,
    actionIds: [action.id],
  }, { userId });
  await confirmSchedulePlan(projectId, plan.id, { requestId: `cal-${projectId}-${baseOffsetHours}` }, { userId });
  return plan;
}

describe("calendar sync receipts (R2 日历同步)", () => {
  it("records external eventId and sync status without touching the in-app schedule", async () => {
    const project = await newProject("日历回执项目");
    const user = await newOwner(project.id);
    const plan = await confirmedPlanWithOneBlock(project.id, user.id, 24);
    const blockId = plan.blocks[0].id!;

    const updated = await recordCalendarSync(project.id, plan.id, [{
      blockId,
      calendarId: "local-calendar-1",
      eventId: "evt-1001",
      status: "SYNCED",
    }], user.id);

    const block = updated.blocks.find((item) => item.id === blockId)!;
    expect(block.calendar.status).toBe("SYNCED");
    expect(block.calendar.eventId).toBe("evt-1001");
    expect(block.calendar.syncedAt).not.toBeNull();
    // 写入系统日历不改变应用内安排，也不改变行动状态
    expect(updated.status).toBe("CONFIRMED");
    const action = await db.actionItem.findFirstOrThrow({ where: { projectId: project.id } });
    expect(action.status).toBe("TODO");
  });

  it("keeps the in-app schedule usable when the device denies calendar permission", async () => {
    const project = await newProject("权限拒绝回退项目");
    const user = await newOwner(project.id);
    const plan = await confirmedPlanWithOneBlock(project.id, user.id, 48);
    const blockId = plan.blocks[0].id!;

    const updated = await recordCalendarSync(project.id, plan.id, [{
      blockId,
      calendarId: null,
      eventId: null,
      status: "FAILED",
      error: "用户拒绝日历权限",
    }], user.id);

    const block = updated.blocks.find((item) => item.id === blockId)!;
    expect(block.calendar.status).toBe("FAILED");
    expect(block.calendar.error).toBe("用户拒绝日历权限");
    expect(block.calendar.eventId).toBeNull();
    // 回退为应用内排程：时段仍然有效
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.blocks).toHaveLength(1);
  });

  it("revokes only blocks that ProjectMemo itself created", async () => {
    const project = await newProject("撤销自有事件项目");
    const user = await newOwner(project.id);
    const plan = await confirmedPlanWithOneBlock(project.id, user.id, 72);
    const blockId = plan.blocks[0].id!;

    // 未同步过的块即使被要求撤销也不产生回执变化
    const beforeRevoke = await markCalendarRevoked(project.id, plan.id, [blockId], user.id);
    expect(beforeRevoke.blocks[0].calendar.status).toBe("NONE");

    await recordCalendarSync(project.id, plan.id, [{ blockId, calendarId: "c1", eventId: "evt-2002", status: "SYNCED" }], user.id);
    const revoked = await markCalendarRevoked(project.id, plan.id, [blockId], user.id);
    expect(revoked.blocks[0].calendar.status).toBe("REVOKED");
    // 撤销保留 eventId 以便审计，不假装从未写入
    expect(revoked.blocks[0].calendar.eventId).toBe("evt-2002");
  });

  it("rejects cross-user and cross-project sync writes", async () => {
    const project = await newProject("日历隔离项目");
    const user = await newOwner(project.id);
    const other = await db.user.create({
      data: { username: `cal-other-${Date.now()}`, displayName: "其他用户", passwordHash: "x" },
    });
    createdUserIds.push(other.id);
    const plan = await confirmedPlanWithOneBlock(project.id, user.id, 96);
    const blockId = plan.blocks[0].id!;

    await expect(recordCalendarSync(project.id, plan.id, [{ blockId, calendarId: "c1", eventId: "evt-3", status: "SYNCED" }], other.id))
      .rejects.toMatchObject({ code: "SCHEDULE_PLAN_NOT_FOUND", status: 404 });

    const otherProject = await newProject("另一个项目");
    await expect(recordCalendarSync(otherProject.id, plan.id, [{ blockId, calendarId: "c1", eventId: "evt-3", status: "SYNCED" }], user.id))
      .rejects.toMatchObject({ code: "SCHEDULE_PLAN_NOT_FOUND", status: 404 });
  });

  it("is disabled by default behind its feature flag", async () => {
    const project = await newProject("开关关闭项目");
    const user = await newOwner(project.id);
    const plan = await confirmedPlanWithOneBlock(project.id, user.id, 120);
    const blockId = plan.blocks[0].id!;

    const previous = process.env.PROJECT_CALENDAR_SYNC_ENABLED;
    process.env.PROJECT_CALENDAR_SYNC_ENABLED = "0";
    try {
      await expect(recordCalendarSync(project.id, plan.id, [{ blockId, calendarId: "c1", eventId: "evt-4", status: "SYNCED" }], user.id))
        .rejects.toMatchObject({ code: "PROJECT_CALENDAR_SYNC_DISABLED", status: 503 });
    } finally {
      process.env.PROJECT_CALENDAR_SYNC_ENABLED = previous;
    }
  });
});
