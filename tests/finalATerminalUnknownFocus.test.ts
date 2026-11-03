import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// 独立临时库必须在 import lib/db 之前设置；本文件验证全局 Focus 读取路径，不触碰用户库。
const isolated = await vi.hoisted(async () => {
  const helper = await import("./helpers/continuityDatabase");
  const database = helper.continuityDatabase("final-a-terminal-unknown-focus");
  process.env.MISSION_ENABLED = "true";
  process.env.MISSION_UI_ENABLED = "true";
  return database;
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { loadGlobalFocus } from "@/lib/server/globalFocus";
import { GET as focusRoute } from "@/app/api/workspace/focus/route";
import { createSession } from "@/lib/auth/session";
import { missionWorkspaceSummary } from "@/lib/mission/workspaceSummary";
import { focusPrimary } from "@/lib/client/focusPresentation";
import type { Prisma } from "@/lib/generated/prisma/client";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

/**
 * 终态 + 未结算 UNKNOWN 的 Focus 入口回归：
 * 复用 `/api/workspace/focus` 的 waiting 数组（不新增顶层数组/不收件箱），
 * 终态条目按原 Mission 投影显示 terminal+unsettledEffect，读取零写入、生命周期不变。
 */
type Owner = { userId: string; projectId: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const iso = (date: Date) => date.toISOString();
let seq = 0;

async function makeUser(label: string) {
  seq += 1;
  return db.user.create({ data: { username: `final-a-tuf-${label}-${seq}-${crypto.randomUUID().slice(0, 8)}`, displayName: `Focus 终态 ${label}`, passwordHash: "unused" } });
}
async function ownerProject(userId: string, label: string): Promise<Owner> {
  seq += 1;
  const project = await db.project.create({ data: {
    title: `Focus 终态窗口 ${label}`, description: "SYNTHETIC_FINAL_A_TERMINAL_UNKNOWN_FOCUS", goal: "从 Focus 找回终态未结算 UNKNOWN",
    scenario: "RESEARCH", memberships: { create: { userId, role: "OWNER" } },
  } });
  return { userId, projectId: project.id };
}
type MissionOptions = {
  key: string;
  ownerUserId: string;
  projectId: string;
  status: "SUCCEEDED" | "CANCELLED" | "WAITING_INPUT";
  updatedAt: Date;
  lastErrorJson?: Record<string, unknown>;
  cancelRequestedAt?: Date;
  unknownSteps?: number;
  question?: string;
};
/** 原样写入 Mission/Step/Question 行；时间显式给定，保证窗口/顺序可复现。 */
async function mission(options: MissionOptions) {
  const row = await db.agentMission.create({ data: {
    ownerUserId: options.ownerUserId, projectId: options.projectId,
    createRequestId: `req-${options.key}-${crypto.randomUUID()}`, createPayloadHash: "synthetic-final-a-focus",
    goal: `Focus 委托 ${options.key}`, successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, budgetJson: {},
    status: options.status, version: options.status === "WAITING_INPUT" ? 1 : 2,
    updatedAt: options.updatedAt, ...(options.status === "WAITING_INPUT" ? {} : { finishedAt: options.updatedAt }),
    ...(options.lastErrorJson ? { lastErrorJson: json(options.lastErrorJson) } : {}),
    ...(options.cancelRequestedAt ? { cancelRequestedAt: options.cancelRequestedAt } : {}),
  } });
  for (let index = 0; index < (options.unknownSteps ?? 0); index += 1) {
    await db.agentMissionStep.create({ data: {
      missionId: row.id, ordinal: index + 1, planRevision: 1, toolName: "web_search", toolVersion: "1",
      canonicalInputJson: json({ query: "核对未结算的外部调用" }), inputHash: `input-${row.id}-${index}`, readSetJson: json([]),
      status: "UNKNOWN", startedAt: options.updatedAt, finishedAt: options.updatedAt,
    } });
  }
  if (options.question) {
    await db.agentMissionEvent.create({ data: { missionId: row.id, seq: 1, type: "QUESTION", payloadJson: json({ question: options.question }) } });
  }
  return row;
}

let mainUser: Awaited<ReturnType<typeof makeUser>>;
let otherUser: Awaited<ReturnType<typeof makeUser>>;
let isolationUser: Awaited<ReturnType<typeof makeUser>>;
let foreignUser: Awaited<ReturnType<typeof makeUser>>;
let orderUser: Awaited<ReturnType<typeof makeUser>>;
let main: Owner;
let truncation: Owner;
let succeededUnknownError: Awaited<ReturnType<typeof mission>>;
let cancelledUnknownStep: Awaited<ReturnType<typeof mission>>;
let normalSucceeded: Awaited<ReturnType<typeof mission>>;
let normalCancelled: Awaited<ReturnType<typeof mission>>;
let otherOwnedInMainProject: Awaited<ReturnType<typeof mission>>;
let memberOnlyTerminal: Awaited<ReturnType<typeof mission>>;
let foreignTerminal: Awaited<ReturnType<typeof mission>>;
let activeWaiting: Awaited<ReturnType<typeof mission>>;
const truncationTerminals: Array<Awaited<ReturnType<typeof mission>>> = [];

const mainSucceededAt = new Date("2026-02-04T03:00:00.000Z");
const mainCancelledAt = new Date("2026-02-03T03:00:00.000Z");

beforeAll(async () => {
  mainUser = await makeUser("main");
  otherUser = await makeUser("other");
  isolationUser = await makeUser("isolation");
  foreignUser = await makeUser("foreign");
  orderUser = await makeUser("order");
  main = await ownerProject(mainUser.id, "main");
  truncation = await ownerProject(orderUser.id, "truncation");

  succeededUnknownError = await mission({ key: "succeeded-external-unknown", ownerUserId: mainUser.id, projectId: main.projectId, status: "SUCCEEDED", updatedAt: mainSucceededAt,
    lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部写入结果尚未结算，读取不会自动核销" } });
  cancelledUnknownStep = await mission({ key: "cancelled-unknown-step", ownerUserId: mainUser.id, projectId: main.projectId, status: "CANCELLED", updatedAt: mainCancelledAt,
    cancelRequestedAt: new Date(mainCancelledAt.getTime() - 60_000), unknownSteps: 1 });
  normalSucceeded = await mission({ key: "normal-succeeded", ownerUserId: mainUser.id, projectId: main.projectId, status: "SUCCEEDED", updatedAt: new Date("2026-02-02T03:00:00.000Z") });
  normalCancelled = await mission({ key: "normal-cancelled", ownerUserId: mainUser.id, projectId: main.projectId, status: "CANCELLED", updatedAt: new Date("2026-02-01T03:00:00.000Z") });
  // 同项目但 ownerUserId 不是当前用户：不得因项目 OWNER 身份泄漏。
  otherOwnedInMainProject = await mission({ key: "other-owned-in-main", ownerUserId: otherUser.id, projectId: main.projectId, status: "SUCCEEDED", updatedAt: new Date("2026-02-05T03:00:00.000Z"),
    lastErrorJson: { code: "EXTERNAL_UNKNOWN" } });

  // 当前用户只是 MEMBER 的项目：Mission 访问需要 OWNER membership。
  const shared = await db.project.create({ data: { title: "Focus 仅成员项目", description: "synthetic", goal: "隔离", scenario: "RESEARCH",
    memberships: { create: [{ userId: isolationUser.id, role: "OWNER" }, { userId: mainUser.id, role: "MEMBER" }] } } });
  memberOnlyTerminal = await mission({ key: "member-only-terminal", ownerUserId: isolationUser.id, projectId: shared.id, status: "SUCCEEDED", updatedAt: new Date("2026-02-06T03:00:00.000Z"),
    lastErrorJson: { code: "EXTERNAL_UNKNOWN" } });

  // 完全无关的项目：不得出现在 mainUser 的 Focus。
  const foreign = await ownerProject(foreignUser.id, "foreign");
  foreignTerminal = await mission({ key: "foreign-terminal", ownerUserId: foreignUser.id, projectId: foreign.projectId, status: "CANCELLED", updatedAt: new Date("2026-02-07T03:00:00.000Z"),
    unknownSteps: 1 });

  // 窗口截断场景：1 条非终态待回应 + 7 条终态未结算（成功/取消交替）+ 1 条正常终态。
  activeWaiting = await mission({ key: "active-waiting", ownerUserId: orderUser.id, projectId: truncation.projectId, status: "WAITING_INPUT",
    updatedAt: new Date("2026-02-10T03:00:00.000Z"), question: "请补充对照实验指标" });
  for (let index = 0; index < 7; index += 1) {
    const updatedAt = new Date(Date.UTC(2026, 2, 1, 0, index, 0));
    truncationTerminals.push(await mission(index % 2 === 0
      ? { key: `trunc-succeeded-${index}`, ownerUserId: orderUser.id, projectId: truncation.projectId, status: "SUCCEEDED", updatedAt, lastErrorJson: { code: "EXTERNAL_UNKNOWN" } }
      : { key: `trunc-cancelled-${index}`, ownerUserId: orderUser.id, projectId: truncation.projectId, status: "CANCELLED", updatedAt, unknownSteps: 1 }));
  }
  await mission({ key: "trunc-normal", ownerUserId: orderUser.id, projectId: truncation.projectId, status: "SUCCEEDED", updatedAt: new Date("2026-01-01T00:00:00.000Z") });
});

describe("Focus 入口：终态 + 未结算 UNKNOWN 并入 waiting", () => {
  it("SUCCEEDED+EXTERNAL_UNKNOWN 与 CANCELLED+UNKNOWN Step 出现在 /focus 的 waiting，正常终态不出现", async () => {
    const focus = await loadGlobalFocus(mainUser.id);
    expect(focus.missionEnabled).toBe(true);
    // 不新增顶层数组：最终态条目复用现有 waiting，requiresUser=true 时由原 Focus 渲染路径显示。
    expect(focus.running).toEqual([]);
    expect(focus.waiting.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);
    expect(focus.waiting.some(item => [normalSucceeded.id, normalCancelled.id, otherOwnedInMainProject.id].includes(item.id))).toBe(false);
    expect(focus.counts.waiting).toBe(2);
    // 只有终态未结算条目时没有非终态 primaryContext；Focus 的主项回退到 waiting（与 C/D 现有 focusPrimary 一致）。
    expect(focus.primaryContext).toBeNull();
    expect(focus.coverage?.terminalUnsettled).toMatchObject({ inspected: 4, limit: 6, truncated: false });
    expect(focus.coverage?.terminalUnsettled?.note).toContain("分别有界");
    expect(focus.coverage?.terminalUnsettled?.note).toContain("不等于全库没有");
    expect(focus.coverage?.complete).toBe(true);
    expect(focus.hasMore).toBe(false);

    const succeeded = focus.waiting[0]!;
    expect(succeeded).toMatchObject({ status: "SUCCEEDED", actionLabel: "查看原结果并核对未知调用", title: succeededUnknownError.goal });
    expect(succeeded.workState).toMatchObject({
      phase: "COMPLETED", nextActor: "USER", requiresUser: true,
      terminal: { status: "SUCCEEDED", at: iso(mainSucceededAt), atSource: "FINISHED_AT", reasonCode: "SUCCEEDED" },
      unsettledEffect: { present: true, code: "EXTERNAL_UNKNOWN", source: "LAST_ERROR", resolvedByRead: false },
    });
    expect(succeeded.detail).toBe(succeeded.workState!.reasonText);

    const cancelled = focus.waiting[1]!;
    expect(cancelled).toMatchObject({ status: "CANCELLED", actionLabel: "查看取消前原结果并核对未知调用" });
    expect(cancelled.workState).toMatchObject({
      phase: "COMPLETED", requiresUser: true,
      terminal: { status: "CANCELLED", at: iso(mainCancelledAt), atSource: "FINISHED_AT", reasonCode: "CANCELLED" },
      unsettledEffect: { present: true, code: null, source: "STEP", resolvedByRead: false },
    });
    // UNKNOWN Step 是精确计数而非窗口猜测：详情/读回同一口径。
    expect(cancelled.workState!.unsettledEffect!.reasonText).toContain("1 个步骤");
    expect(cancelled.workState!.reasonText).toContain("不能视为成功完成");

    // C/D 现有 Focus 组件使用 focusPrimary + waiting[].actionLabel：终态条目可被选为主项。
    const primary = focusPrimary(focus);
    expect(primary?.id).toBe(succeededUnknownError.id);
    expect(primary?.actionLabel).toBe("查看原结果并核对未知调用");
  });

  it("/api/workspace/focus 返回同一 waiting 事实，并与 missionWorkspaceSummary 的 WorkState 字段一致", async () => {
    const session = await createSession(mainUser.id);
    const response = await focusRoute(new Request("http://localhost/api/workspace/focus", { headers: { authorization: `Bearer ${session.token}` } }));
    expect(response.status).toBe(200);
    const body = await response.json() as Awaited<ReturnType<typeof loadGlobalFocus>>;
    expect(body.waiting.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);
    expect(body.counts.waiting).toBe(2);
    expect(body.coverage?.terminalUnsettled).toMatchObject({ inspected: 4, limit: 6, truncated: false });

    // 与任务摘要入口同一投影：同 id 的 terminal/unsettledEffect/requiresUser/actionLabel 完全一致。
    const summary = await missionWorkspaceSummary(mainUser.id, main.projectId);
    const summaryItems = summary.terminalUnsettled!.items;
    expect(summaryItems.map(item => item.id).sort()).toEqual(body.waiting.map(item => item.id).sort());
    for (const item of summaryItems) {
      const focusItem = body.waiting.find(entry => entry.id === item.id)!;
      expect(focusItem.status).toBe(item.status);
      expect(focusItem.detail).toBe(item.attention);
      expect(focusItem.actionLabel).toBe(item.workState!.actionLabel);
      expect(focusItem.workState).toMatchObject({
        phase: item.workState!.phase, nextActor: item.workState!.nextActor, requiresUser: item.workState!.requiresUser,
        reasonCode: item.workState!.reasonCode, reasonText: item.workState!.reasonText,
        terminal: item.workState!.terminal, unsettledEffect: item.workState!.unsettledEffect,
      });
    }

    const anonymous = await focusRoute(new Request("http://localhost/api/workspace/focus"));
    expect(anonymous.status).toBe(401);
  });

  it("跨账号/仅成员/非本人 Mission 隔离：非 owner 不可见，也不放宽 OWNER membership", async () => {
    const mainFocus = await loadGlobalFocus(mainUser.id);
    const mainIds = mainFocus.waiting.map(item => item.id);
    expect(mainIds).not.toContain(memberOnlyTerminal.id);
    expect(mainIds).not.toContain(foreignTerminal.id);
    expect(mainIds).not.toContain(otherOwnedInMainProject.id);

    const isolationFocus = await loadGlobalFocus(isolationUser.id);
    expect(isolationFocus.waiting.map(item => item.id)).toEqual([memberOnlyTerminal.id]);

    const unknown = await loadGlobalFocus("unknown-user");
    expect([...unknown.waiting, ...unknown.running, ...unknown.actions, ...unknown.reminders, ...unknown.records]).toEqual([]);
  });

  it("窗口有界：终态超过 limit 时 merged waiting 仍 ≤ LIMIT、counts 如实、truncated/hasMore 为真", async () => {
    const focus = await loadGlobalFocus(orderUser.id);
    const entries = focus.waiting;
    // 非终态 responsive 在前，终态命中项按 updatedAt 倒序随后；正文窗口仍是 LIMIT。
    expect(entries).toHaveLength(6);
    expect(entries[0]!.id).toBe(activeWaiting.id);
    expect(entries[0]!.status).toBe("WAITING_INPUT");
    const terminals = entries.slice(1);
    expect(terminals.every(item => item.workState?.unsettledEffect?.present === true)).toBe(true);
    // 7 条终态窗口里最新的 5 条进入正文，最旧的被截断（不是“没有”）。
    expect(terminals.map(item => item.id)).toEqual([6, 5, 4, 3, 2].map(index => truncationTerminals[index]!.id));
    expect(terminals.map(item => item.status)).toEqual(["SUCCEEDED", "CANCELLED", "SUCCEEDED", "CANCELLED", "SUCCEEDED"]);
    expect(focus.counts.waiting).toBe(8); // 1 条非终态 responsive + 7 条终态未结算
    expect(focus.coverage?.terminalUnsettled).toMatchObject({ inspected: 7, limit: 6, truncated: true });
    expect(focus.coverage?.terminalUnsettled?.note).toContain("窗口内未找到不等于全库没有");
    expect(focus.coverage?.complete).toBe(false);
    expect(focus.hasMore).toBe(true);
    // 正常终态不计入终态窗口，也不进入 waiting。
    expect(entries.some(item => item.workState?.unsettledEffect?.present !== true && item.id !== activeWaiting.id)).toBe(false);
  });

  it("读取零写入：Focus 读取前后 Mission/Step/Event/Output/Approval 逐行一致，终态 lifecycle 不变", async () => {
    const session = await createSession(mainUser.id);
    const snapshot = () => Promise.all([
      db.agentMission.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionStep.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionEvent.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionOutput.findMany({ orderBy: { id: "asc" } }),
      db.agentMissionApproval.findMany({ orderBy: { id: "asc" } }),
    ]);
    const before = await snapshot();
    await loadGlobalFocus(mainUser.id);
    await loadGlobalFocus(orderUser.id);
    const route = await focusRoute(new Request("http://localhost/api/workspace/focus", { headers: { authorization: `Bearer ${session.token}` } }));
    expect(route.status).toBe(200);
    const after = await snapshot();
    expect(after).toEqual(before);

    const lifecycle = (row: typeof succeededUnknownError) => ({
      status: row.status, version: row.version, updatedAt: row.updatedAt,
      finishedAt: row.finishedAt, lastErrorJson: row.lastErrorJson, cancelRequestedAt: row.cancelRequestedAt,
    });
    for (const row of [succeededUnknownError, cancelledUnknownStep, normalSucceeded, normalCancelled]) {
      const reloaded = await db.agentMission.findUniqueOrThrow({ where: { id: row.id } });
      expect(lifecycle(reloaded)).toEqual(lifecycle(row));
    }
  });

  it("feature 关闭保持原 Focus 合同：missionEnabled=false、waiting 空、无新覆盖字段", async () => {
    process.env.MISSION_ENABLED = "false";
    try {
      const focus = await loadGlobalFocus(mainUser.id);
      expect(focus.missionEnabled).toBe(false);
      expect(focus.waiting).toEqual([]);
      expect(focus.running).toEqual([]);
      expect(focus.counts.waiting).toBe(0);
      expect(focus.coverage?.terminalUnsettled).toBeUndefined();
    } finally {
      process.env.MISSION_ENABLED = "true";
    }
    // 恢复后同一入口仍能找回终态未结算条目。
    const recovered = await loadGlobalFocus(mainUser.id);
    expect(recovered.waiting.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);
  });

  it("终态窗口读取失败降级为空窗口 + note，不拖垮 Focus 读取，也不宣称“不存在”", async () => {
    const spy = vi.spyOn(db.agentMissionStep, "groupBy").mockRejectedValueOnce(new Error("SYNTHETIC_FOCUS_TERMINAL_WINDOW_READ_FAILURE"));
    try {
      const focus = await loadGlobalFocus(mainUser.id);
      // 主项目只有终态未结算条目：窗口降级后 waiting 为空（失败不等于“没有”）。
      expect(focus.waiting).toEqual([]);
      expect(focus.counts.waiting).toBe(0);
      expect(focus.coverage?.terminalUnsettled).toMatchObject({ inspected: 4, limit: 6, truncated: false });
      expect(focus.coverage?.terminalUnsettled?.note).toContain("读取失败");
      expect(focus.coverage?.terminalUnsettled?.note).toContain("未确认不存在");
      expect(focus.coverage?.complete).toBe(false);
    } finally {
      spy.mockRestore();
    }
    const recovered = await loadGlobalFocus(mainUser.id);
    expect(recovered.waiting.map(item => item.id)).toEqual([succeededUnknownError.id, cancelledUnknownStep.id]);
  });
});
