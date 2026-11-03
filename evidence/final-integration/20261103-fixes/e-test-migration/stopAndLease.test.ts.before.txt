/**
 * Track E 独立验收：停止在途与租约围栏（E-WRK-03 的进程内局部证据；不是真实 Worker/自然日证据）。
 *
 * 依据 07_执行准备/03_鸿蒙与独立验收职责.md 的 E-WRK-03 与 FS-A02/FS-A07：
 * 用户请求停止后，在途执行不得继续提交业务副作用；Worker 重启/换租约后旧租约不能重放。
 * 这里用真实 claimMission/fenced 与真实数据库行，不启动后台 Worker 进程。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("../helpers/continuityDatabase")).continuityDatabase("final-e-stop-lease"),
);
import fs from "node:fs";
import { db } from "@/lib/db";
import { commandMission, createMission, editMission } from "@/lib/mission/missionService";
import { readMissionBack } from "@/lib/mission/readback";
import { claimMission, fenced, type Lease } from "@/lib/mission/runtimeStore";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({
    data: {
      title: label, description: "FINAL_E_SYNTHETIC_ONLY", goal: "独立验收合成项目", scenario: "RESEARCH",
      memberships: { create: { userId: user.id } },
    },
  });
  const mission = await createMission(user.id, { projectId: project.id, requestId: `m-${crypto.randomUUID()}`, goal: "核对停止在途与租约" });
  // 每个用例使用同一合成库；claimMission 的 executionSlot 是全局单槽，先结算上一个用例遗留的在途任务。
  await db.agentMission.updateMany({
    where: { executionSlot: { not: null } },
    data: { executionSlot: null, status: "CANCELLED", leaseOwner: null, leaseUntil: null, finishedAt: new Date() },
  });
  return { user, project, mission };
}

const leaseOf = (m: { id: string; leaseEpoch: number; contextVersion: number; planRevision: number }, owner: string): Lease =>
  ({ id: m.id, owner, epoch: m.leaseEpoch, contextVersion: m.contextVersion, planRevision: m.planRevision });

describe("FS-A02 停止在途：用户请求停止后，在途执行不得继续提交", () => {
  it("RUNNING 期间暂停：任务保持 RUNNING 未结算，执行围栏拒绝继续", async () => {
    const { user, mission } = await fixture("E 暂停在途用户");
    const claimed = await claimMission("worker-e1", mission.id);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("RUNNING");
    const lease = leaseOf(claimed!, "worker-e1");
    await db.$transaction(async tx => expect(await fenced(tx, lease)).toMatchObject({ id: mission.id }));

    const paused = await commandMission(user.id, claimed!.id, "pause", {
      requestId: `pause-${crypto.randomUUID()}`,
      expectedVersion: claimed!.version,
    });
    // 原 RUNNING 保护保留：暂停请求登记在途，不提前变成 PAUSED。
    expect(paused.status).toBe("RUNNING");
    expect(paused.pauseRequestedAt).not.toBeNull();
    expect(paused.version).toBe(claimed!.version + 1);

    // 在途执行必须被围栏拦下，不能继续写业务副作用。
    await db.$transaction(async tx => {
      await expect(fenced(tx, lease)).rejects.toMatchObject({ code: "STOP_REQUESTED", status: 409 });
    });
    // 也不能在没有结算的情况下被“恢复”成可执行。
    await expect(commandMission(user.id, claimed!.id, "resume", {
      requestId: `resume-${crypto.randomUUID()}`,
      expectedVersion: paused.version,
    })).rejects.toMatchObject({ code: "MISSION_NOT_PAUSED", status: 409 });

    const readback = await readMissionBack(user.id, claimed!.id);
    expect(readback.workState.phase).toBe("RUNNING");
    expect(readback.workState.phase).not.toBe("COMPLETED");
    expect(await db.actionItem.count({ where: { projectId: mission.projectId } })).toBe(0);
  });

  it("RUNNING 期间取消：保持 RUNNING 且登记取消请求；租约过期换 Worker 后仍不继续", async () => {
    const { user, mission } = await fixture("E 取消在途用户");
    const claimed = await claimMission("worker-e2", mission.id);
    expect(claimed).not.toBeNull();
    const firstLease = leaseOf(claimed!, "worker-e2");
    const cancelled = await commandMission(user.id, claimed!.id, "cancel", {
      requestId: `cancel-${crypto.randomUUID()}`,
      expectedVersion: claimed!.version,
    });
    expect(cancelled.status).toBe("RUNNING");
    expect(cancelled.cancelRequestedAt).not.toBeNull();
    await db.$transaction(async tx => {
      await expect(fenced(tx, firstLease)).rejects.toMatchObject({ code: "STOP_REQUESTED", status: 409 });
    });

    // 模拟原 Worker 崩溃、租约过期后另一个 Worker 领取同一 Mission。
    await db.agentMission.update({ where: { id: claimed!.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const reClaimed = await claimMission("worker-e3", claimed!.id);
    expect(reClaimed?.id).toBe(claimed!.id);
    expect(reClaimed!.leaseEpoch).toBeGreaterThan(claimed!.leaseEpoch);
    expect(reClaimed!.leaseOwner).toBe("worker-e3");
    // 旧租约不能在新租约/新 epoch 下继续写。
    await db.$transaction(async tx => {
      await expect(fenced(tx, firstLease)).rejects.toMatchObject({ code: "LEASE_LOST", status: 409 });
    });
    // 新租约同样受用户取消请求约束：只允许结算取消，不允许执行。
    await db.$transaction(async tx => {
      await expect(fenced(tx, leaseOf(reClaimed!, "worker-e3"))).rejects.toMatchObject({ code: "STOP_REQUESTED", status: 409 });
    });

    // 结算取消：终态后任何旧租约都不再有效。
    await db.agentMission.update({
      where: { id: claimed!.id },
      data: { status: "CANCELLED", leaseOwner: null, leaseUntil: null, executionSlot: null, finishedAt: new Date() },
    });
    await db.$transaction(async tx => {
      await expect(fenced(tx, leaseOf(reClaimed!, "worker-e3"))).rejects.toMatchObject({ code: "LEASE_LOST", status: 409 });
    });
    const readback = await readMissionBack(user.id, claimed!.id);
    expect(readback.missionStatus).toBe("CANCELLED");
    expect(readback.workState.reasonCode).toBe("CANCELLED");
    expect(await db.actionItem.count({ where: { projectId: mission.projectId } })).toBe(0);
  });
});

describe("FS-A07 Worker 上下文变化：旧租约不能按旧 planRevision 继续提交", () => {
  it("运行中约束被修改后，旧租约执行围栏返回 CONTEXT_CHANGED", async () => {
    const { user, mission } = await fixture("E 上下文变化用户");
    const claimed = await claimMission("worker-e4", mission.id);
    expect(claimed).not.toBeNull();
    const lease = leaseOf(claimed!, "worker-e4");
    await db.$transaction(async tx => expect(await fenced(tx, lease)).toMatchObject({ id: mission.id }));

    const edited = await editMission(user.id, claimed!.id, "constraints", {
      requestId: `edit-${crypto.randomUUID()}`,
      expectedVersion: claimed!.version,
      expectedConstraintsVersion: claimed!.constraintsVersion,
      constraints: { deadline: null, forbiddenApproaches: ["再引入新的付费服务"], executionBoundary: "PROPOSE_ACTION" },
    });
    expect(edited.version).toBe(claimed!.version + 1);
    expect(edited.planRevision).toBe(claimed!.planRevision + 1);

    await db.$transaction(async tx => {
      await expect(fenced(tx, lease)).rejects.toMatchObject({ code: "CONTEXT_CHANGED", status: 409 });
    });
    // 原批准/步骤被失效，旧执行不能借旧版本继续。
    const staleApprovals = await db.agentMissionApproval.count({
      where: { missionId: claimed!.id, status: { in: ["PENDING", "APPROVED"] } },
    });
    expect(staleApprovals).toBe(0);
  });
});
