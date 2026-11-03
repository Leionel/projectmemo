/**
 * Track E 第二批独立复验（候选 4b69614）：读回期间的权限/控制版本竞争。
 *
 * 依据 16_第二批ABCDE收尾Prompts.md E 段（控制版本竞争、Owner 撤权、持续控制变化 409）
 * 与 04_工程验收/09 §1、10 §4 R04/R09：
 * - 快照采集后撤权：不能返回上一事务的私有快照；
 * - 控制版本（来源许可/指引）推进：整包重读并标记 RETRIED，持续推进则 WORK_PACKET_AUTHORITY_CHANGED/409；
 * - 仅 Mission 版本推进：可 VERSION_ADVANCED，但主操作 requires 必须携带全量版本由服务端重查。
 * 真实第二连接（同一临时库 WAL）注入写入，不是 mock 标签。
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("../helpers/continuityDatabase")).continuityDatabase("final-e-round2-authority"),
);
import fs from "node:fs";
import { db } from "@/lib/db";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createMission } from "@/lib/mission/missionService";
import { readMissionBack, type MissionReadback } from "@/lib/mission/readback";
import { sourceHash } from "@/lib/mission/repository";
import { json } from "@/lib/mission/contracts";

const databaseUrl = `file:${isolated.file.replaceAll("\\", "/")}`;
// 真实第二连接：与主客户端同一临时库文件（WAL），用于确定性注入并发写入。
const writer = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await writer.$disconnect();
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({
    data: {
      title: label, description: "FINAL_E_ROUND2_AUTHORITY_ONLY", goal: "核对读取期间的控制变化", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const mission = await createMission(user.id, { projectId: project.id, requestId: `m-${crypto.randomUUID()}`, goal: "核对读取期间的控制变化" });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "读取竞争期间的原始记录：撤权后不得发布" } });
  const sourceId = `capture:${capture.id}`;
  const hash = (await sourceHash(project.id, sourceId))!;
  const withQuestion = await db.agentMission.update({
    where: { id: mission.id }, data: { status: "WAITING_INPUT", nextEventSeq: { increment: 1 } },
  });
  const questionEvent = await db.agentMissionEvent.create({
    data: { missionId: mission.id, seq: withQuestion.nextEventSeq, type: "QUESTION", payloadJson: json({ question: "请核对原来源" }) },
  });
  const questionId = questionEvent.id;
  await db.agentMission.update({
    where: { id: mission.id },
    data: {
      waitStateJson: json({ questionId, question: "请核对原来源", waitingFor: "ANSWER", startedAt: new Date(Date.now() - 3_600_000).toISOString() }),
      nextEventSeq: { increment: 1 },
    },
  });
  const updated = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  await db.agentMissionEvent.create({
    data: { missionId: mission.id, seq: updated.nextEventSeq, type: "SOURCE_ARRIVED", payloadJson: json({ questionId, sourcePointer: { id: sourceId, hash } }) },
  });
  return { user, project, mission: await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } }), capture, sourceId, hash, questionId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** 经第二连接注入一次“停止使用该来源”控制变化；不改 Mission 版本（模拟来源/许可变化）。 */
async function injectSuppression(fx: Fixture) {
  await writer.$transaction(async tx => {
    const owner = await tx.user.findUniqueOrThrow({ where: { id: fx.user.id }, select: { continuitySeq: true } });
    await tx.agentDirectiveEvent.create({
      data: {
        ownerUserId: fx.user.id, projectId: fx.project.id, missionId: fx.mission.id,
        seq: owner.continuitySeq + 1, commandId: crypto.randomUUID(), eventIndex: 0,
        inputHash: "b".repeat(64), directiveId: crypto.randomUUID(),
        kind: "USE_SUPPRESSION", operation: "SET", quote: "停止使用这条来源",
        sourceIdsJson: json([fx.sourceId]), sourceJson: json({ origin: "E_ROUND2_AUTHORITY_RACE" }),
        admissionJson: json({ status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION" }),
        validFrom: new Date(), timezone: "Asia/Shanghai",
      },
    });
    await tx.user.update({ where: { id: fx.user.id }, data: { continuitySeq: { increment: 1 } } });
  });
}

async function injectVersionAdvance(fx: Fixture) {
  await writer.agentMission.update({ where: { id: fx.mission.id }, data: { version: { increment: 1 } } });
}

const itemOf = (back: MissionReadback, sourceId: string) => {
  const item = back.materialUses.items.find(entry => entry.sourcePointer.id === sourceId);
  expect(item).toBeTruthy();
  return item!;
};

/**
 * 把注入点钉在“快照已读取、第二只读事务尚未开始”的真实窗口：
 * 单进程 better-sqlite3 同步驱动无法在事务中间插入第二连接写入，因此以 spy 包住 db.$transaction，
 * 在第 N 次事务调用前由第二连接提交真实写入。不是 mock 业务结果。
 */
function installInjection(onCall: (call: number) => Promise<void> | void) {
  const original = db.$transaction.bind(db);
  let calls = 0;
  const spy = vi.spyOn(db, "$transaction");
  spy.mockImplementation((async (callback: unknown, options: unknown) => {
    calls += 1;
    await onCall(calls);
    return original(callback as never, options as never);
  }) as never);
  return () => spy.mockRestore();
}

describe("FI-E-AUTH 读取期间控制版本与权限竞争", () => {
  it("FI-E-AUTH-01 快照后撤回来源一次：整包重读并标记 RETRIED，返回的仍是新许可下的内部一致快照", async () => {
    const fx = await fixture("撤回竞争");
    const before = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    expect(itemOf(before, fx.sourceId).availability).toBe("CURRENT");
    const controlBefore = before.workPacket!.identity.controlVersion;

    let injected = false;
    const restore = installInjection(async call => {
      if (call === 2 && !injected) { injected = true; await injectSuppression(fx); }
    });
    let after: MissionReadback;
    try {
      after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    } finally { restore(); }

    expect(injected).toBe(true);
    expect(after.missionVersion).toBe(before.missionVersion);
    expect(after.workPacket!.snapshot).toMatchObject({ consistency: "RETRIED", retries: 1 });
    expect(after.workPacket!.identity.controlVersion).not.toBe(controlBefore);
    const item = itemOf(after, fx.sourceId);
    expect(item).toMatchObject({ availability: "UNAVAILABLE", excerpt: null, revisionAvailability: "CURRENT", currentUse: { state: "SUPPRESSED" } });
    expect(after.workPacket!.blockers.map(blocker => blocker.code)).toContain("CURRENT_USE_SUPPRESSED");
  });

  it("FI-E-AUTH-02 持续控制变化：重试耗尽返回 WORK_PACKET_AUTHORITY_CHANGED/409，不发布旧许可快照", async () => {
    const fx = await fixture("持续控制变化");
    let injections = 0;
    const restore = installInjection(async call => {
      if (call % 2 === 0 && injections < 3) { injections += 1; await injectSuppression(fx); }
    });
    try {
      await expect(readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId }))
        .rejects.toMatchObject({ code: "WORK_PACKET_AUTHORITY_CHANGED", status: 409 });
    } finally { restore(); }
    expect(injections).toBe(3);
    // 读取本身不写 Mission 业务字段；509 之后新读一次必须反映当前许可。
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: fx.mission.id } });
    expect(current.version).toBe(fx.mission.version);
    const fresh = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    expect(itemOf(fresh, fx.sourceId).availability).toBe("UNAVAILABLE");
    expect(itemOf(fresh, fx.sourceId).excerpt).toBeNull();
  });

  it("FI-E-AUTH-03 快照后 Owner 项目访问被删除：第二事务重新鉴权，拒绝返回私有快照", async () => {
    const fx = await fixture("访问撤回");
    const restore = installInjection(async call => {
      if (call === 2) {
        await writer.projectMembership.delete({ where: { userId_projectId: { userId: fx.user.id, projectId: fx.project.id } } });
      }
    });
    try {
      await expect(readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId }))
        .rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    } finally { restore(); }
  });

  it("FI-E-AUTH-04 快照后 Owner 角色降级为 MEMBER：同样不能返回原 Owner 私有读回", async () => {
    const fx = await fixture("角色降级");
    const restore = installInjection(async call => {
      if (call === 2) {
        await writer.projectMembership.update({
          where: { userId_projectId: { userId: fx.user.id, projectId: fx.project.id } }, data: { role: "MEMBER" },
        });
      }
    });
    try {
      await expect(readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId }))
        .rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    } finally { restore(); }
  });

  it("FI-E-AUTH-05 仅 Mission 版本推进一次：不报权限错误，整包重读并标记 RETRIED，requires 携带快照版本", async () => {
    const fx = await fixture("版本推进一次");
    let injected = false;
    const restore = installInjection(async call => {
      if (call === 2 && !injected) { injected = true; await injectVersionAdvance(fx); }
    });
    let after: MissionReadback;
    try { after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId }); }
    finally { restore(); }
    expect(injected).toBe(true);
    expect(after.workPacket!.snapshot).toMatchObject({ consistency: "RETRIED", retries: 1 });
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: fx.mission.id } });
    // 重读后的身份来自最新快照；requires 与身份同源且完整携带版本字段。
    expect(after.workPacket!.identity.missionVersion).toBe(current.version);
    const action = after.workPacket!.next.primaryAction;
    if (action) {
      expect(action.requires).toMatchObject({
        missionVersion: after.workPacket!.identity.missionVersion,
        planRevision: after.workPacket!.identity.planRevision,
        contextVersion: after.workPacket!.identity.contextVersion,
      });
      expect(action.submissionGuard).toBe("SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY");
    }
  });

  it("FI-E-AUTH-06 持续 Mission 版本推进：返回 VERSION_ADVANCED 一致快照并标记需重核，不冒充稳定版", async () => {
    const fx = await fixture("持续版本推进");
    let injections = 0;
    const restore = installInjection(async call => {
      if (call % 2 === 0 && injections < 3) { injections += 1; await injectVersionAdvance(fx); }
    });
    let after: MissionReadback;
    try { after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId }); }
    finally { restore(); }
    expect(injections).toBe(3);
    expect(after.workPacket!.snapshot).toMatchObject({ consistency: "VERSION_ADVANCED", retries: 2 });
    expect(after.workPacket!.snapshot.note).toContain("重新核对");
    const advancedBlocker = after.workPacket!.blockers.find(blocker => blocker.code === "SNAPSHOT_VERSION_ADVANCED");
    expect(advancedBlocker).toMatchObject({ blocksActions: true });
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: fx.mission.id } });
    // 快照身份不冒充当前：DB 版本已高于返回快照，主操作必须由服务端重查版本。
    expect(current.version).toBeGreaterThan(after.workPacket!.identity.missionVersion);
    expect(after.workPacket!.next.primaryAction!.submissionGuard).toBe("SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY");
  });
});
