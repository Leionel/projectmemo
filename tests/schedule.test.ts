process.env.PROJECT_SCHEDULING_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { confirmSchedulePlan, getCurrentSchedulePlan, previewSchedule } from "@/lib/services/scheduleService";

const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdUserIds) {
    await db.user.delete({ where: { id } }).catch(() => {});
  }
});

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "排程测试", goal: "R2-3 验收", scenario: "COMPETITION" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function newMembershipOwner(projectId: string) {
  const user = await db.user.create({
    data: { username: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, displayName: "排程测试用户", passwordHash: "x" },
  });
  createdUserIds.push(user.id);
  await db.projectMembership.create({ data: { userId: user.id, projectId, role: "OWNER" } });
  return user;
}

async function seedAction(projectId: string, overrides: {
  title?: string;
  priority?: number;
  estimatedMinutes?: number | null;
  dueAt?: Date | null;
  status?: "TODO" | "DONE" | "CANCELLED";
}) {
  return db.actionItem.create({
    data: {
      projectId,
      title: overrides.title ?? "测试行动",
      priority: overrides.priority ?? 3,
      status: overrides.status ?? "TODO",
      estimatedMinutes: overrides.estimatedMinutes === undefined ? 60 : overrides.estimatedMinutes,
      dueAt: overrides.dueAt === undefined ? null : overrides.dueAt,
    },
  });
}

const HOUR = 3_600_000;

describe("Schedule preview / confirm (R2-3)", () => {
  it("places READY actions in stable order with no overlap; blocked and estimateless actions are reported", async () => {
    const project = await newProject("稳定排序项目");
    const user = await newMembershipOwner(project.id);
    const base = Date.now() + 24 * HOUR;
    const blocked = await seedAction(project.id, { title: "受阻行动", estimatedMinutes: 30 });
    await db.actionRequirement.create({ data: { actionId: blocked.id, projectId: project.id, targetKind: "card", targetId: "missing-card", hard: true } });
    const noEstimate = await seedAction(project.id, { title: "缺估时行动", estimatedMinutes: null });
    const dueFirst = await seedAction(project.id, { title: "有截止行动", dueAt: new Date(base + 48 * HOUR), priority: 3, estimatedMinutes: 60 });
    const highPriority = await seedAction(project.id, { title: "高优先行动", priority: 1, estimatedMinutes: 60 });

    const plan = await previewSchedule(project.id, {
      requestId: `stable-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 24 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 24 * HOUR).toISOString() }],
    }, { userId: user.id });

    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0].actionId).toBe(dueFirst.id);
    expect(plan.blocks[1].actionId).toBe(highPriority.id);
    expect(new Date(plan.blocks[1].end).getTime()).toBeLessThanOrEqual(new Date(plan.blocks[0].start).getTime() + 24 * HOUR);
    // 无重叠
    for (let i = 1; i < plan.blocks.length; i++) {
      expect(new Date(plan.blocks[i].start).getTime()).toBeGreaterThanOrEqual(new Date(plan.blocks[i - 1].end).getTime());
    }
    const codes = Object.fromEntries(plan.unscheduled.map((item) => [item.actionId, item.reasonCode]));
    expect(codes[blocked.id]).toBe("BLOCKED");
    expect(codes[noEstimate.id]).toBe("MISSING_ESTIMATE");
    expect(plan.unscheduled.every((item) => item.message.length > 0)).toBe(true);
    void noEstimate;
  });

  it("zero capacity yields NO_CAPACITY reasons instead of errors", async () => {
    const project = await newProject("零容量项目");
    const user = await newMembershipOwner(project.id);
    const action = await seedAction(project.id, { title: "放不下的行动", estimatedMinutes: 120 });
    const base = Date.now() + 24 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `zero-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 24 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + HOUR).toISOString() }],
    }, { userId: user.id });
    expect(plan.blocks).toHaveLength(0);
    expect(plan.unscheduled[0].reasonCode).toBe("NO_CAPACITY");
    void action;
  });

  it("locked blocks are preserved and consume capacity", async () => {
    const project = await newProject("锁定区间项目");
    const user = await newMembershipOwner(project.id);
    const base = Date.now() + 24 * HOUR;
    const lockedAction = await seedAction(project.id, { title: "已锁定行动", estimatedMinutes: 60 });
    const other = await seedAction(project.id, { title: "排队行动", estimatedMinutes: 60 });

    const plan = await previewSchedule(project.id, {
      requestId: `locked-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [lockedAction.id, other.id],
      lockedBlocks: [{ actionId: lockedAction.id, start: new Date(base + 2 * HOUR).toISOString(), end: new Date(base + 3 * HOUR).toISOString() }],
    }, { userId: user.id });

    const lockedBlock = plan.blocks.find((block) => block.actionId === lockedAction.id);
    expect(lockedBlock?.locked).toBe(true);
    expect(lockedBlock?.start).toBe(new Date(base + 2 * HOUR).toISOString());
    // 排队行动不会占用锁定区间
    const otherBlock = plan.blocks.find((block) => block.actionId === other.id);
    expect(otherBlock).toBeTruthy();
    const overlaps = plan.blocks.filter((block) => !block.locked && new Date(block.start).getTime() < new Date(base + 3 * HOUR).getTime() && new Date(block.end).getTime() > new Date(base + 2 * HOUR).getTime());
    expect(overlaps).toHaveLength(0);
  });

  it("confirm revalidates action version and returns 409 without leaving partial blocks", async () => {
    const project = await newProject("版本冲突项目");
    const user = await newMembershipOwner(project.id);
    const action = await seedAction(project.id, { estimatedMinutes: 60 });
    const base = Date.now() + 24 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `conflict-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
    }, { userId: user.id });

    // 确认前行动依赖版本变化
    await db.actionItem.update({ where: { id: action.id }, data: { dependencyVersion: { increment: 1 } } });
    await expect(confirmSchedulePlan(project.id, plan.id, { requestId: `conflict-${project.id}` }, { userId: user.id }))
      .rejects.toMatchObject({ code: "SCHEDULE_ACTION_CHANGED", status: 409 });
    const after = await db.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after.status).toBe("DRAFT");
  });

  it("confirmed plan occupies capacity across projects of the same user", async () => {
    const projectA = await newProject("跨项目占用A");
    const projectB = await newProject("跨项目占用B");
    const user = await newMembershipOwner(projectA.id);
    await db.projectMembership.create({ data: { userId: user.id, projectId: projectB.id, role: "OWNER" } });
    const actionA = await seedAction(projectA.id, { estimatedMinutes: 120 });
    const actionB = await seedAction(projectB.id, { estimatedMinutes: 120 });
    const base = Date.now() + 48 * HOUR;

    const planA = await previewSchedule(projectA.id, {
      requestId: `cross-a-${projectA.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [actionA.id],
    }, { userId: user.id });

    // 在确认 A 之前先预览 B：B 看不到占用，被放到与 A 相同的时段
    const planB2 = await previewSchedule(projectB.id, {
      requestId: `cross-b2-${projectB.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [actionB.id],
    }, { userId: user.id });
    expect(planB2.blocks).toHaveLength(1);

    await confirmSchedulePlan(projectA.id, planA.id, { requestId: `cross-a-${projectA.id}` }, { userId: user.id });
    await expect(confirmSchedulePlan(projectB.id, planB2.id, { requestId: `cross-b2-${projectB.id}` }, { userId: user.id }))
      .rejects.toMatchObject({ code: "SCHEDULE_CAPACITY_CONFLICT" });

    // A 确认后再预览：B 能放进剩余 6 小时，但放不进需要 7 小时的完整时段
    const fitAction = await seedAction(projectB.id, { title: "剩余容量刚好够", estimatedMinutes: 6 * 60 });
    const planBFit = await previewSchedule(projectB.id, {
      requestId: `cross-fit-${projectB.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [fitAction.id],
    }, { userId: user.id });
    expect(planBFit.blocks).toHaveLength(1);
    expect(new Date(planBFit.blocks[0].start).getTime()).toBeGreaterThanOrEqual(new Date(planA.blocks[0].end).getTime());

    const longAction = await seedAction(projectB.id, { title: "剩余容量放不下", estimatedMinutes: 7 * 60 });
    const planBLong = await previewSchedule(projectB.id, {
      requestId: `cross-long-${projectB.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [longAction.id],
    }, { userId: user.id });
    expect(planBLong.blocks).toHaveLength(0);
    expect(planBLong.unscheduled[0].reasonCode).toBe("NO_CAPACITY");
  });

  it("confirm keeps actions TODO, generates no result card, and replays idempotently", async () => {
    const project = await newProject("确认语义项目");
    const user = await newMembershipOwner(project.id);
    const action = await seedAction(project.id, { estimatedMinutes: 60 });
    const base = Date.now() + 48 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `confirm-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
    }, { userId: user.id });

    const confirmed = await confirmSchedulePlan(project.id, plan.id, { requestId: `confirm-${project.id}` }, { userId: user.id });
    expect(confirmed.status).toBe("CONFIRMED");

    const actionAfter = await db.actionItem.findUniqueOrThrow({ where: { id: action.id } });
    expect(actionAfter.status).toBe("TODO");
    expect(actionAfter.resultCardId).toBeNull();

    const replay = await confirmSchedulePlan(project.id, plan.id, { requestId: `confirm-${project.id}` }, { userId: user.id });
    expect(replay.id).toBe(confirmed.id);
    expect((await db.schedulePlan.count({ where: { projectId: project.id, status: "CONFIRMED" } }))).toBe(1);

    const current = await getCurrentSchedulePlan(project.id);
    expect(current?.id).toBe(confirmed.id);
    expect(current?.blocks[0].actionId).toBe(action.id);
  });
});
