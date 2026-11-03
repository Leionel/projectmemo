import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// 独立临时库必须在 import lib/db 之前设置；本文件只验证原摘要入口的只读投影，不触碰用户库。
const isolated = await vi.hoisted(async () => {
  const helper = await import("./helpers/continuityDatabase");
  const database = helper.continuityDatabase("final-a-terminal-unknown");
  process.env.MISSION_UI_ENABLED = "true";
  return database;
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { missionDetail } from "@/lib/mission/missionService";
import { readMissionBack } from "@/lib/mission/readback";
import { missionWorkspaceSummary, TERMINAL_UNSETTLED_LIMIT } from "@/lib/mission/workspaceSummary";
import type { Prisma } from "@/lib/generated/prisma/client";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

/**
 * 终态 + 未结算 UNKNOWN 的“现有摘要入口”回归：
 * 只投影既有 Mission/Step 事实；不核销 UNKNOWN、不改生命周期、不建新收件箱，窗口覆盖必须诚实。
 */
type Owner = { userId: string; projectId: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const iso = (date: Date) => date.toISOString();
let counter = 0;

async function ownerProject(label: string): Promise<Owner> {
  counter += 1;
  const user = await db.user.create({ data: { username: `final-a-tu-${label}-${counter}-${crypto.randomUUID().slice(0, 8)}`, displayName: `终态未结算 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({ data: {
    title: `终态未结算窗口 ${label}`, description: "SYNTHETIC_FINAL_A_TERMINAL_UNSETTLED", goal: "从原摘要找回终态未结算 UNKNOWN",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } },
  } });
  return { userId: user.id, projectId: project.id };
}

type TerminalOptions = {
  key: string;
  status: "SUCCEEDED" | "CANCELLED";
  updatedAt: Date;
  lastErrorJson?: Record<string, unknown>;
  cancelRequestedAt?: Date;
  unknownSteps?: number;
};

/** 原样写入终态 Mission/Step 行；updatedAt/finishedAt 显式给定，保证窗口顺序可复现。 */
async function terminalMission(owner: Owner, options: TerminalOptions) {
  const mission = await db.agentMission.create({ data: {
    ownerUserId: owner.userId, projectId: owner.projectId,
    createRequestId: `req-${options.key}-${crypto.randomUUID()}`, createPayloadHash: "synthetic-final-a-terminal",
    goal: `终态委托 ${options.key}`, successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, budgetJson: {},
    status: options.status, version: 2, updatedAt: options.updatedAt, finishedAt: options.updatedAt,
    ...(options.lastErrorJson ? { lastErrorJson: json(options.lastErrorJson) } : {}),
    ...(options.cancelRequestedAt ? { cancelRequestedAt: options.cancelRequestedAt } : {}),
  } });
  for (let index = 0; index < (options.unknownSteps ?? 0); index += 1) {
    await db.agentMissionStep.create({ data: {
      missionId: mission.id, ordinal: index + 1, planRevision: 1, toolName: "web_search", toolVersion: "1",
      canonicalInputJson: json({ query: "核对未结算的外部调用" }), inputHash: `input-${mission.id}-${index}`, readSetJson: json([]),
      status: "UNKNOWN", startedAt: options.updatedAt, finishedAt: options.updatedAt,
    } });
  }
  return mission;
}

let main: Owner;
let truncation: Owner;
let clean: Owner;
let memberId = "";
let succeededUnknownError: Awaited<ReturnType<typeof terminalMission>>;
let cancelledUnknownStep: Awaited<ReturnType<typeof terminalMission>>;
let normalSucceeded: Awaited<ReturnType<typeof terminalMission>>;
let normalCancelled: Awaited<ReturnType<typeof terminalMission>>;

const mainSucceededAt = new Date("2026-02-04T03:00:00.000Z");
const mainCancelledAt = new Date("2026-02-03T03:00:00.000Z");

beforeAll(async () => {
  main = await ownerProject("main");
  succeededUnknownError = await terminalMission(main, {
    key: "succeeded-external-unknown", status: "SUCCEEDED", updatedAt: mainSucceededAt,
    lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部写入结果尚未结算，读取不会自动核销" },
  });
  cancelledUnknownStep = await terminalMission(main, {
    key: "cancelled-unknown-step", status: "CANCELLED", updatedAt: mainCancelledAt,
    cancelRequestedAt: new Date(mainCancelledAt.getTime() - 60_000), unknownSteps: 2,
  });
  normalSucceeded = await terminalMission(main, { key: "normal-succeeded", status: "SUCCEEDED", updatedAt: new Date("2026-02-02T03:00:00.000Z") });
  normalCancelled = await terminalMission(main, { key: "normal-cancelled", status: "CANCELLED", updatedAt: new Date("2026-02-01T03:00:00.000Z") });
  const member = await db.user.create({ data: { username: `final-a-tu-member-${crypto.randomUUID().slice(0, 8)}`, displayName: "只读成员", passwordHash: "unused" } });
  memberId = member.id;
  await db.projectMembership.create({ data: { projectId: main.projectId, userId: memberId, role: "MEMBER" } });

  // 7 条终态 + 全部未结算：验证窗口 take 6+1 的截断标记为真，且 items 不超过 limit。
  truncation = await ownerProject("truncation");
  for (let index = 0; index < TERMINAL_UNSETTLED_LIMIT + 1; index += 1) {
    const updatedAt = new Date(Date.UTC(2026, 2, 1, 0, index, 0));
    await terminalMission(truncation, index % 2 === 0
      ? { key: `trunc-succeeded-${index}`, status: "SUCCEEDED", updatedAt, lastErrorJson: { code: "EXTERNAL_UNKNOWN" } }
      : { key: `trunc-cancelled-${index}`, status: "CANCELLED", updatedAt, unknownSteps: 1 });
  }

  // 正常终态：窗口应返回空 items，并用 note 说明“窗口内未找到不等于全库没有”。
  clean = await ownerProject("clean");
  await terminalMission(clean, { key: "clean-succeeded", status: "SUCCEEDED", updatedAt: new Date("2026-02-05T03:00:00.000Z") });
  await terminalMission(clean, { key: "clean-cancelled", status: "CANCELLED", updatedAt: new Date("2026-02-04T03:00:00.000Z") });
});

describe("原摘要入口：终态 + 未结算 UNKNOWN 可找回", () => {
  it("SUCCEEDED+EXTERNAL_UNKNOWN 与 CANCELLED+UNKNOWN Step 都能从 terminalUnsettled 重新找到", async () => {
    const summary = await missionWorkspaceSummary(main.userId, main.projectId);
    expect(summary.enabled).toBe(true);
    // 原有 semantics 不变：totalActive 只统计非终态，正常终态不进入 items。
    expect(summary.totalActive).toBe(0);
    expect(summary.items).toEqual([]);
    const window = summary.terminalUnsettled!;
    expect(window.limit).toBe(TERMINAL_UNSETTLED_LIMIT);
    expect(window.inspected).toBe(4);
    expect(window.truncated).toBe(false);
    expect(window.note).toContain("不等于全库没有");
    expect(window.identityNote).toContain("不核销 UNKNOWN");

    expect(window.items.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);

    const succeeded = window.items[0]!;
    expect(succeeded).toMatchObject({ status: "SUCCEEDED", version: 2, goal: succeededUnknownError.goal });
    expect(succeeded.workState).toMatchObject({
      phase: "COMPLETED", nextActor: "USER", requiresUser: true,
      terminal: { status: "SUCCEEDED", at: iso(mainSucceededAt), atSource: "FINISHED_AT", reasonCode: "SUCCEEDED" },
      unsettledEffect: { present: true, code: "EXTERNAL_UNKNOWN", source: "LAST_ERROR", resolvedByRead: false },
    });
    expect(succeeded.workState!.unsettledEffect!.reasonText).toContain("读取不会自动核销");

    const cancelled = window.items[1]!;
    expect(cancelled).toMatchObject({ status: "CANCELLED", version: 2 });
    expect(cancelled.workState).toMatchObject({
      phase: "COMPLETED", requiresUser: true,
      terminal: { status: "CANCELLED", at: iso(mainCancelledAt), atSource: "FINISHED_AT", reasonCode: "CANCELLED" },
      unsettledEffect: { present: true, code: null, source: "STEP", resolvedByRead: false },
    });
    // 终态不被 UNKNOWN 擦掉，取消也不能被写成成功。
    expect(cancelled.workState!.reasonText).toContain("不能视为成功完成");
    expect(cancelled.workState!.unsettledEffect!.reasonText).toContain("2 个步骤");
  });

  it("与 missionDetail / readMissionBack 同一 missionVersion 与 identity，读取不改终态", async () => {
    const summary = await missionWorkspaceSummary(main.userId, main.projectId);
    const window = summary.terminalUnsettled!;
    for (const item of window.items) {
      const missionId = item.id;
      const detail = await missionDetail(main.userId, missionId);
      const back = await readMissionBack(main.userId, missionId);
      expect(item.version).toBe(detail.version);
      expect(back.missionVersion).toBe(item.version);
      expect(back.missionStatus).toBe(item.status);
      expect(back.missionId).toBe(missionId);
      expect(item.workState!.originalRef).toEqual({ kind: "MISSION", id: missionId, version: item.version });
      // 终态时间/未结算事实来自同一份原记录投影。
      expect(item.workState!.terminal).toEqual(detail.workState.terminal);
      expect(item.workState!.unsettledEffect).toEqual(detail.workState.unsettledEffect);
      expect(item.workState!.terminal).toEqual(back.workState.terminal);
      expect(item.workState!.unsettledEffect).toEqual(back.workState.unsettledEffect);
      expect(item.workState!.requiresUser).toBe(true);
    }
  });

  it("正常终态不出现，且窗口为空时用 note 保留“未找到≠全库没有”的边界", async () => {
    const summary = await missionWorkspaceSummary(clean.userId, clean.projectId);
    expect(summary.items).toEqual([]);
    const window = summary.terminalUnsettled!;
    expect(window.items).toEqual([]);
    expect(window.inspected).toBe(2);
    expect(window.truncated).toBe(false);
    expect(window.note).toContain("不等于全库没有");
    // 正常终态直接核对：没有被投影成未结算。
    for (const missionId of [normalSucceeded.id, normalCancelled.id]) {
      const detail = await missionDetail(main.userId, missionId);
      expect(detail.workState.terminal?.status).toBe(detail.status);
      expect(detail.workState.unsettledEffect?.present).toBe(false);
    }
  });

  it("窗口有界：终态超过 limit 时 truncated=true、inspected=limit+1、items 不超过 limit", async () => {
    const summary = await missionWorkspaceSummary(truncation.userId, truncation.projectId);
    const window = summary.terminalUnsettled!;
    expect(window.limit).toBe(TERMINAL_UNSETTLED_LIMIT);
    expect(window.inspected).toBe(TERMINAL_UNSETTLED_LIMIT + 1);
    expect(window.truncated).toBe(true);
    expect(window.items).toHaveLength(TERMINAL_UNSETTLED_LIMIT);
    expect(window.note).toContain("窗口已截断");
    expect(window.items.every(item => item.workState?.unsettledEffect?.present === true)).toBe(true);
    // 按 updatedAt 倒序取最近：最旧的一条被窗口截掉，不冒充“没有”。
    expect(window.items.map(item => item.status)).toEqual(["SUCCEEDED", "CANCELLED", "SUCCEEDED", "CANCELLED", "SUCCEEDED", "CANCELLED"]);
  });

  it("没有任何终态委托时窗口为空且 note 不冒充“全库没有未结算”", async () => {
    const empty = await ownerProject("empty");
    await db.agentMission.create({ data: {
      ownerUserId: empty.userId, projectId: empty.projectId, createRequestId: `req-empty-${crypto.randomUUID()}`, createPayloadHash: "synthetic-final-a-terminal",
      goal: "只有一个未结束的委托", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, budgetJson: {}, status: "READY",
    } });
    const summary = await missionWorkspaceSummary(empty.userId, empty.projectId);
    expect(summary.enabled).toBe(true);
    expect(summary.totalActive).toBe(1);
    expect(summary.items).toHaveLength(1);
    const window = summary.terminalUnsettled!;
    expect(window).toMatchObject({ items: [], inspected: 0, limit: TERMINAL_UNSETTLED_LIMIT, truncated: false });
    expect(window.note).toContain("没有已结束");
    expect(window.note).toContain("非终态 UNKNOWN 仍由原 items");
  });

  it("非 Owner 仍是 404（不因为新增窗口放宽权限）", async () => {
    await expect(missionWorkspaceSummary(memberId, main.projectId)).rejects.toMatchObject({ status: 404 });
    const outsider = await db.user.create({ data: { username: `final-a-tu-outsider-${crypto.randomUUID().slice(0, 8)}`, displayName: "外部用户", passwordHash: "unused" } });
    await expect(missionWorkspaceSummary(outsider.id, main.projectId)).rejects.toMatchObject({ status: 404 });
  });

  it("feature 关闭保持旧客户端合同 enabled=false，不抛错也不携带新字段", async () => {
    const before = await db.agentMission.findMany({ where: { projectId: main.projectId }, orderBy: { id: "asc" } });
    process.env.MISSION_UI_ENABLED = "false";
    try {
      const summary = await missionWorkspaceSummary(main.userId, main.projectId);
      expect(summary).toEqual({ enabled: false, totalActive: 0, items: [] });
      expect(summary).not.toHaveProperty("terminalUnsettled");
      expect(await db.agentMission.findMany({ where: { projectId: main.projectId }, orderBy: { id: "asc" } })).toEqual(before);
    } finally {
      process.env.MISSION_UI_ENABLED = "true";
    }
  });

  it("读取零写入：Mission/Step/Event/Output/Approval 前后逐行一致，终态 lifecycle 不变", async () => {
    const snapshot = () => Promise.all([
      db.agentMission.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionStep.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionEvent.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionOutput.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionApproval.findMany({ orderBy: { id: "asc" } }),
    ]);
    const before = await snapshot();
    const summary = await missionWorkspaceSummary(main.userId, main.projectId);
    expect(summary.terminalUnsettled!.items).toHaveLength(2);
    // 多读几个入口（详情/读回）也不得写入。
    for (const item of summary.terminalUnsettled!.items) {
      await missionDetail(main.userId, item.id);
      await readMissionBack(main.userId, item.id);
    }
    const after = await snapshot();
    expect(after).toEqual(before);

    const lifecycle = (mission: typeof succeededUnknownError) => ({
      status: mission.status, version: mission.version, updatedAt: mission.updatedAt,
      finishedAt: mission.finishedAt, lastErrorJson: mission.lastErrorJson, cancelRequestedAt: mission.cancelRequestedAt,
    });
    for (const mission of [succeededUnknownError, cancelledUnknownStep, normalSucceeded, normalCancelled]) {
      const reloaded = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
      expect(lifecycle(reloaded)).toEqual(lifecycle(mission));
    }
  });

  it("终态窗口读取失败降级为空窗口 + note，不拖垮原 items/totalActive，也不宣称“不存在”", async () => {
    const spy = vi.spyOn(db.agentMissionStep, "groupBy").mockRejectedValueOnce(new Error("SYNTHETIC_TERMINAL_WINDOW_READ_FAILURE"));
    try {
      const summary = await missionWorkspaceSummary(main.userId, main.projectId);
      expect(summary.enabled).toBe(true);
      expect(summary.totalActive).toBe(0);
      expect(summary.items).toEqual([]);
      const window = summary.terminalUnsettled!;
      expect(window).toMatchObject({ items: [], inspected: 0, limit: TERMINAL_UNSETTLED_LIMIT, truncated: false });
      expect(window.note).toContain("读取失败");
      expect(window.note).toContain("未确认不存在");
    } finally {
      spy.mockRestore();
    }
    // 恢复后同一入口仍能找回两条，说明降级不是缓存/状态残留。
    const recovered = await missionWorkspaceSummary(main.userId, main.projectId);
    expect(recovered.terminalUnsettled!.items.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);
  });
});
