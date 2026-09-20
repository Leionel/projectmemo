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
    // 8 小时窗口本身够放 7 小时，是被 A 项目已确认的 2 小时挤掉的
    expect(planBLong.unscheduled[0].reasonCode).toBe("CROSS_PROJECT_CONFLICT");
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

    const current = await getCurrentSchedulePlan(project.id, user.id);
    expect(current?.id).toBe(confirmed.id);
    expect(current?.blocks[0].actionId).toBe(action.id);
  });

  it("refuses to confirm a plan whose action was cancelled after preview", async () => {
    const project = await newProject("取消行动拒绝确认");
    const user = await newMembershipOwner(project.id);
    const action = await seedAction(project.id, { title: "会被取消的行动", estimatedMinutes: 60 });
    const base = Date.now() + 72 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `cancel-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
    }, { userId: user.id });
    expect(plan.blocks).toHaveLength(1);

    await db.actionItem.update({ where: { id: action.id }, data: { status: "CANCELLED" } });
    await expect(confirmSchedulePlan(project.id, plan.id, { requestId: `cancel-${project.id}` }, { userId: user.id }))
      .rejects.toMatchObject({ code: "SCHEDULE_ACTION_CHANGED", status: 409 });

    const stored = await db.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(stored.status).toBe("DRAFT");
  });

  it("refuses to confirm a locked block whose action is done", async () => {
    const project = await newProject("锁定块也受状态约束");
    const user = await newMembershipOwner(project.id);
    const action = await seedAction(project.id, { title: "锁定后完成的行动", estimatedMinutes: 60 });
    const base = Date.now() + 96 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `locked-done-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
      lockedBlocks: [{ actionId: action.id, start: new Date(base + HOUR).toISOString(), end: new Date(base + 2 * HOUR).toISOString() }],
    }, { userId: user.id });
    expect(plan.blocks[0].locked).toBe(true);

    await db.actionItem.update({ where: { id: action.id }, data: { status: "DONE", completedAt: new Date() } });
    await expect(confirmSchedulePlan(project.id, plan.id, { requestId: `locked-done-${project.id}` }, { userId: user.id }))
      .rejects.toMatchObject({ code: "SCHEDULE_ACTION_CHANGED", status: 409 });
  });

  it("replays identical requestId payloads and rejects different ones without deleting history", async () => {
    const project = await newProject("requestId 幂等");
    const user = await newMembershipOwner(project.id);
    const missingEstimate = await seedAction(project.id, { title: "缺估时行动", estimatedMinutes: null });
    const base = Date.now() + 120 * HOUR;
    const payload = {
      requestId: `idem-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [missingEstimate.id],
    };

    const first = await previewSchedule(project.id, payload, { userId: user.id });
    expect(first.unscheduled.map((item) => item.reasonCode)).toContain("MISSING_ESTIMATE");

    // 相同载荷重放：同一计划、同一结果，未安排原因不能变成空数组
    const replay = await previewSchedule(project.id, payload, { userId: user.id });
    expect(replay.id).toBe(first.id);
    expect(replay.unscheduled).toEqual(first.unscheduled);

    // 同一 requestId 携带不同载荷：409，且不删除已有草稿
    await expect(previewSchedule(project.id, {
      ...payload,
      rangeEnd: new Date(base + 9 * HOUR).toISOString(),
    }, { userId: user.id })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    const stored = await db.schedulePlan.findUniqueOrThrow({ where: { id: first.id }, include: { blocks: true } });
    expect(stored.rangeEnd.toISOString()).toBe(payload.rangeEnd);
    expect(await db.schedulePlan.count({ where: { projectId: project.id, requestId: payload.requestId } })).toBe(1);
  });

  it("lets only one of two concurrent confirms win an overlapping slot", async () => {
    const projectA = await newProject("并发确认A");
    const projectB = await newProject("并发确认B");
    const user = await newMembershipOwner(projectA.id);
    await db.projectMembership.create({ data: { userId: user.id, projectId: projectB.id, role: "OWNER" } });
    const actionA = await seedAction(projectA.id, { title: "并发A行动", estimatedMinutes: 120 });
    const actionB = await seedAction(projectB.id, { title: "并发B行动", estimatedMinutes: 120 });
    const base = Date.now() + 144 * HOUR;
    const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 4 * HOUR).toISOString() }];

    // 两份预览都在对方确认前生成，因此都以为时段可用
    const planA = await previewSchedule(projectA.id, {
      requestId: `race-a-${projectA.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionA.id],
    }, { userId: user.id });
    const planB = await previewSchedule(projectB.id, {
      requestId: `race-b-${projectB.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionB.id],
    }, { userId: user.id });
    expect(planA.blocks).toHaveLength(1);
    expect(planB.blocks).toHaveLength(1);

    const results = await Promise.allSettled([
      confirmSchedulePlan(projectA.id, planA.id, { requestId: `race-a-${projectA.id}` }, { userId: user.id }),
      confirmSchedulePlan(projectB.id, planB.id, { requestId: `race-b-${projectB.id}` }, { userId: user.id }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const confirmedCount = await db.schedulePlan.count({ where: { userId: user.id, status: "CONFIRMED" } });
    expect(confirmedCount).toBe(1);
  });

  it("keeps schedules isolated between two members of the same project", async () => {
    const project = await newProject("成员隔离项目");
    const owner = await newMembershipOwner(project.id);
    const other = await db.user.create({
      data: { username: `member-${Date.now()}`, displayName: "第二位成员", passwordHash: "x" },
    });
    createdUserIds.push(other.id);
    await db.projectMembership.create({ data: { userId: other.id, projectId: project.id, role: "OWNER" } });

    const actionOwner = await seedAction(project.id, { title: "成员甲的行动", estimatedMinutes: 120 });
    const actionOther = await seedAction(project.id, { title: "成员乙的行动", estimatedMinutes: 120 });
    const base = Date.now() + 168 * HOUR;
    const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 4 * HOUR).toISOString() }];

    const planOwner = await previewSchedule(project.id, {
      requestId: `iso-owner-${project.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionOwner.id],
    }, { userId: owner.id });
    await confirmSchedulePlan(project.id, planOwner.id, { requestId: `iso-owner-${project.id}` }, { userId: owner.id });

    // 同一时段对另一位成员仍然可用：甲的个人时间不占用乙
    const planOther = await previewSchedule(project.id, {
      requestId: `iso-other-${project.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionOther.id],
    }, { userId: other.id });
    expect(planOther.blocks).toHaveLength(1);
    expect(planOther.blocks[0].start).toBe(planOwner.blocks[0].start);
    const confirmedOther = await confirmSchedulePlan(project.id, planOther.id, { requestId: `iso-other-${project.id}` }, { userId: other.id });
    expect(confirmedOther.status).toBe("CONFIRMED");

    // current 按用户隔离：各自只看到自己的计划
    expect((await getCurrentSchedulePlan(project.id, owner.id))?.id).toBe(planOwner.id);
    expect((await getCurrentSchedulePlan(project.id, other.id))?.id).toBe(planOther.id);

    // 越权访问他人计划：统一 404，不泄露存在性
    await expect(confirmSchedulePlan(project.id, planOther.id, { requestId: "steal" }, { userId: owner.id }))
      .rejects.toMatchObject({ code: "SCHEDULE_PLAN_NOT_FOUND", status: 404 });
  });

  it("reports CROSS_PROJECT_CONFLICT when only other projects' blocks block the slot", async () => {
    const projectA = await newProject("跨项目原因A");
    const projectB = await newProject("跨项目原因B");
    const user = await newMembershipOwner(projectA.id);
    await db.projectMembership.create({ data: { userId: user.id, projectId: projectB.id, role: "OWNER" } });
    const actionA = await seedAction(projectA.id, { title: "占用整段", estimatedMinutes: 180 });
    const actionB = await seedAction(projectB.id, { title: "被挤出的行动", estimatedMinutes: 180 });
    const base = Date.now() + 192 * HOUR;
    const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 3 * HOUR).toISOString() }];

    const planA = await previewSchedule(projectA.id, {
      requestId: `reason-a-${projectA.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionA.id],
    }, { userId: user.id });
    await confirmSchedulePlan(projectA.id, planA.id, { requestId: `reason-a-${projectA.id}` }, { userId: user.id });

    const planB = await previewSchedule(projectB.id, {
      requestId: `reason-b-${projectB.id}`, rangeStart: slots[0].start, rangeEnd: slots[0].end, slots, actionIds: [actionB.id],
    }, { userId: user.id });
    expect(planB.blocks).toHaveLength(0);
    expect(planB.unscheduled[0].reasonCode).toBe("CROSS_PROJECT_CONFLICT");
    expect(planB.unscheduled[0].message).toContain("其他项目");
  });
});
