/**
 * 独立集成验收：读取时刻、原观察和正常控制停止必须分开。
 * 使用隔离 mock 数据库中的原 Mission/Event 记录，不调用模型、Worker 或设备。
 * 不修改 E 原红例；本文件验证接受的兼容合同及其真实语义边界。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("final-integration-observation"),
);

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { readMissionBack } from "@/lib/mission/readback";
import type { Prisma } from "@/lib/generated/prisma/client";

const savedPresence = process.env.WORKER_PRESENCE_FILE;
process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "presence.json");

afterAll(async () => {
  await db.$disconnect();
  if (savedPresence === undefined) delete process.env.WORKER_PRESENCE_FILE;
  else process.env.WORKER_PRESENCE_FILE = savedPresence;
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

const payload = (value: unknown) => value as Prisma.InputJsonValue;

async function fixture(label: string, delegationObservedAt?: Date) {
  const user = await db.user.create({
    data: { username: `integration-observation-${crypto.randomUUID()}`, displayName: label, passwordHash: "unused" },
  });
  const project = await db.project.create({
    data: {
      title: label, description: "SYNTHETIC_INDEPENDENT_OBSERVATION_ONLY", goal: "核对读取与观察的区别", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const mission = await db.agentMission.create({
    data: {
      ownerUserId: user.id, projectId: project.id, createRequestId: crypto.randomUUID(),
      createPayloadHash: "independent-observation", goal: "核对原观察与当前等待原因", status: "READY",
      successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, researchScopeJson: {}, budgetJson: {},
      continuationPolicyJson: { mode: "MANUAL" },
      planJson: delegationObservedAt ? { delegation: { lastObservedAt: delegationObservedAt.toISOString() } } : {},
    },
  });
  return { userId: user.id, missionId: mission.id };
}

async function event(missionId: string, type: string, value: unknown, createdAt: Date) {
  return db.$transaction(async tx => {
    const mission = await tx.agentMission.update({
      where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true },
    });
    return tx.agentMissionEvent.create({
      data: { missionId, seq: mission.nextEventSeq, type, payloadJson: payload(value), createdAt },
    });
  });
}

function sameObservation(back: Awaited<ReturnType<typeof readMissionBack>>) {
  expect(back.workPacket).toBeDefined();
  expect(back.workPacket!.observations).toEqual(back.observation);
  expect(back.observation.readAt).toBe(back.readAt);
  // 旧字段明确保留读取时间语义；不把命名不佳改成另一种时间以破坏旧消费者。
  expect(back.observedAt).toBe(back.readAt);
}

describe("独立合同：旧 observedAt 表示读取，新 observation 表示原成功/失败观察", () => {
  it("FI-OBS-01 无原观察记录：重复 GET 推进读取时刻，成功/失败/无变化仍为 null，业务记录不变", async () => {
    const f = await fixture("没有观察的委托");
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.missionId } });
    const eventCount = await db.agentMissionEvent.count({ where: { missionId: f.missionId } });
    const first = await readMissionBack(f.userId, f.missionId);
    await new Promise(resolve => setTimeout(resolve, 25));
    const second = await readMissionBack(f.userId, f.missionId);
    sameObservation(first);
    sameObservation(second);
    expect(Date.parse(second.readAt)).toBeGreaterThan(Date.parse(first.readAt));
    for (const back of [first, second]) {
      expect(back.observation).toMatchObject({
        state: "NOT_OBSERVED", lastSuccessfulAt: null, lastFailedAt: null, lastNoNewInformationAt: null,
      });
      expect(back.workState.observedAt).toBeNull();
      expect(back.workPacket!.done.note).not.toContain("无新变化");
    }
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.missionId } });
    expect(after).toEqual(before);
    expect(await db.agentMissionEvent.count({ where: { missionId: f.missionId } })).toBe(eventCount);
  });

  it("FI-OBS-02 原成功观察事件是证据：没有 delegation 时间时，使用事件时间而非 GET 时间", async () => {
    const observedAt = new Date(Date.now() - 120_000);
    const f = await fixture("原成功观察事件");
    await event(f.missionId, "INVESTIGATION_OBSERVATION_CHANGED", { changed: true }, observedAt);
    const back = await readMissionBack(f.userId, f.missionId);
    sameObservation(back);
    expect(back.observation).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: observedAt.toISOString(), lastFailedAt: null });
    expect(Date.parse(back.readAt)).toBeGreaterThan(+observedAt);
  });

  it("FI-OBS-03 原 delegation 成功时间稳定：重复 GET 不推进它，随后工具观察失败保留旧成功与失败时间", async () => {
    const successfulAt = new Date(Date.now() - 180_000);
    const failedAt = new Date(Date.now() - 60_000);
    const f = await fixture("成功后观察失败", successfulAt);
    await event(f.missionId, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false }, successfulAt);
    const first = await readMissionBack(f.userId, f.missionId);
    const second = await readMissionBack(f.userId, f.missionId);
    expect(first.observation).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: successfulAt.toISOString() });
    expect(second.observation.lastSuccessfulAt).toBe(first.observation.lastSuccessfulAt);
    // 与原 runner 的 EXECUTION_STOPPED 载荷保持同型：这里是工具执行失败，而非正常控制停止。
    await event(f.missionId, "EXECUTION_STOPPED", {
      code: "TOOL_FAILED", phase: "TOOL", purpose: "DECLARED_OBSERVATION",
      recovery: { kind: "REVIEW_REQUIRED", automatic: false },
    }, failedAt);
    const failed = await readMissionBack(f.userId, f.missionId);
    sameObservation(failed);
    expect(failed.observation).toMatchObject({
      state: "FAILED_LAST", lastSuccessfulAt: successfulAt.toISOString(), lastFailedAt: failedAt.toISOString(),
      lastNoNewInformationAt: successfulAt.toISOString(),
    });
    expect(failed.workPacket!.next.note).toContain("观察失败");
    expect(failed.workPacket!.done.note).not.toContain("无新变化");
  });
});

describe("正常停止与额度控制不是观察失败（不以 EXECUTION_STOPPED 类型一概判断）", () => {
  it.each([
    { label: "用户暂停", code: "STOP_REQUESTED", status: "PAUSED", pauseReason: "USER", recovery: "STOP_REQUESTED" },
    { label: "用户取消", code: "STOP_REQUESTED", status: "CANCELLED", pauseReason: "USER", recovery: "STOP_REQUESTED" },
    { label: "累计预算耗尽", code: "BUDGET_EXHAUSTED", status: "PAUSED", pauseReason: "BUDGET", recovery: "BUDGET_REVIEW" },
  ])("FI-OBS-04 $label：原成功观察保留，控制停止不新增 lastFailedAt", async control => {
    const successfulAt = new Date(Date.now() - 180_000);
    const stoppedAt = new Date(Date.now() - 60_000);
    const f = await fixture(control.label, successfulAt);
    await event(f.missionId, "INVESTIGATION_OBSERVATION_CHANGED", { changed: true }, successfulAt);
    await db.agentMission.update({
      where: { id: f.missionId },
      data: {
        status: control.status, pauseReason: control.pauseReason,
        ...(control.label === "用户取消" ? { cancelRequestedAt: stoppedAt } : control.label === "用户暂停" ? { pauseRequestedAt: stoppedAt } : {}),
        lastErrorJson: { code: control.code, recovery: { kind: control.recovery, automatic: false } },
      },
    });
    // 原观察步骤也能被用户停止或额度守卫拦下：即使声明了观察 purpose，控制边界也不是观察失败。
    await event(f.missionId, "EXECUTION_STOPPED", {
      code: control.code, phase: "TOOL", purpose: "DECLARED_OBSERVATION", category: "DOMAIN",
      recovery: { kind: control.recovery, automatic: false },
    }, stoppedAt);
    const back = await readMissionBack(f.userId, f.missionId);
    sameObservation(back);
    expect(back.missionStatus).toBe(control.status);
    expect(back.observation.lastSuccessfulAt).toBe(successfulAt.toISOString());
    expect.soft(back.observation.lastFailedAt).toBeNull();
    expect.soft(back.observation.state).toBe("OBSERVED");
    expect.soft(back.workPacket!.next.note).not.toContain("观察失败");
  });

  it("FI-OBS-05 每日额度等待不新增观察失败，也不生成成功观察", async () => {
    const f = await fixture("每日额度等待，无观察记录");
    const at = new Date(Date.now() - 30_000);
    await db.agentMission.update({ where: { id: f.missionId }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    await event(f.missionId, "DAILY_BUDGET_WAITING", { nextAttemptAt: new Date(Date.now() + 3_600_000).toISOString(), budgetRetained: true }, at);
    const back = await readMissionBack(f.userId, f.missionId);
    sameObservation(back);
    expect(back.observation).toMatchObject({ state: "NOT_OBSERVED", lastSuccessfulAt: null, lastFailedAt: null });
    expect(back.workPacket!.next.note).not.toContain("观察失败");
  });

  it("FI-OBS-06 已有真实工具失败后用户停止：保留真正失败时间，不被较晚的控制停止覆盖", async () => {
    const successfulAt = new Date(Date.now() - 180_000);
    const failedAt = new Date(Date.now() - 120_000);
    const stoppedAt = new Date(Date.now() - 60_000);
    const f = await fixture("先失败再主动停止", successfulAt);
    await event(f.missionId, "EXECUTION_STOPPED", { code: "TOOL_FAILED", phase: "TOOL", purpose: "DECLARED_OBSERVATION", recovery: { kind: "REVIEW_REQUIRED", automatic: false } }, failedAt);
    await event(f.missionId, "EXECUTION_STOPPED", { code: "STOP_REQUESTED", phase: "TOOL", purpose: "DECLARED_OBSERVATION", category: "DOMAIN", recovery: { kind: "STOP_REQUESTED", automatic: false } }, stoppedAt);
    const back = await readMissionBack(f.userId, f.missionId);
    sameObservation(back);
    expect(back.observation.state).toBe("FAILED_LAST");
    expect(back.observation.lastSuccessfulAt).toBe(successfulAt.toISOString());
    expect(back.observation.lastFailedAt).toBe(failedAt.toISOString());
  });

  it.each([
    { label: "无观察声明的旧工具失败", type: "EXECUTION_STOPPED", code: "EXECUTION_FAILED", phase: "TOOL", category: "EXECUTION", recovery: "REVIEW_REQUIRED" },
    { label: "模型格式错误", type: "MODEL_PROTOCOL_ERROR", code: "MODEL_PROTOCOL_ERROR", phase: "DECISION", category: "MODEL_PROTOCOL", recovery: "MODEL_FORMAT_RETRY" },
  ])("FI-OBS-07 $label：保留原失败事件，但不能将无证据的失败推断为观察失败", async failure => {
    const successfulAt = new Date(Date.now() - 180_000);
    const f = await fixture(failure.label, successfulAt);
    await event(f.missionId, "INVESTIGATION_OBSERVATION_CHANGED", { changed: true }, successfulAt);
    const original = await event(f.missionId, failure.type, {
      code: failure.code, phase: failure.phase, category: failure.category,
      recovery: { kind: failure.recovery, automatic: failure.recovery === "MODEL_FORMAT_RETRY" },
    }, new Date(Date.now() - 60_000));
    const back = await readMissionBack(f.userId, f.missionId);
    sameObservation(back);
    expect(back.observation).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: successfulAt.toISOString(), lastFailedAt: null });
    expect(back.workPacket!.next.note).not.toContain("观察失败");
    expect(await db.agentMissionEvent.findUnique({ where: { id: original.id } })).toEqual(original);
  });
});
