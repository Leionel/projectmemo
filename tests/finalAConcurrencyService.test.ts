import { afterAll, describe, expect, it, vi } from "vitest";
// 独立临时库必须在 import lib/db 之前设置；文件内串行，不开文件并行。
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("final-a-workpacket-concurrency"));
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { readMissionBack, type MissionReadback } from "@/lib/mission/readback";
import { PrismaClient, type Prisma } from "@/lib/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "worker-presence.json");
const databaseUrl = `file:${isolated.file.replaceAll("\\", "/")}`;
// FS-A07：真实第二连接（同一临时库文件，WAL），不是 mock，也不是前端 stale 标签。
const writerClient = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
afterAll(async () => {
  await writerClient.$disconnect();
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (value: unknown) => value as Prisma.InputJsonValue;
const nonStable = new Set(["RETRIED", "VERSION_ADVANCED"]);
type WriterState = { done: boolean; ok: number; busy: number };

/** 第二连接写入：只改版本字段与生命周期，模拟用户在读取期间提交了新版本。 */
async function writeLoop(missionId: string, iterations: number, state: WriterState) {
  for (let index = 0; index < iterations && !state.done; index++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await writerClient.agentMission.update({ where: { id: missionId }, data: {
          version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 },
          status: index % 4 === 3 ? "PAUSED" : "READY", updatedAt: new Date(Date.now() + index),
        } });
        state.ok += 1;
        break;
      } catch (error) {
        const code = String((error as { code?: string }).code ?? "");
        if (code.includes("SQLITE_BUSY") || String(error).includes("SQLITE_BUSY")) { state.busy += 1; await sleep(5); continue; }
        throw error;
      }
    }
    await sleep(1);
  }
  state.done = true;
}

/**
 * 受控并发点：在 readback 的事务外版本复查（db.agentMission.findUnique）前，经第二连接先提交一次真实写入。
 * 单进程内 better-sqlite3 是同步驱动，无法在事务中间自然插入第二连接写入；
 * 这里把写入钉在“快照已读取、复查尚未返回”的真实窗口，用于确定性复现 VERSION_ADVANCED/RETRIED。
 */
async function readWithInjectedWrites(missionId: string, injections: number): Promise<MissionReadback> {
  let remaining = injections;
  const original = db.agentMission.findUnique.bind(db.agentMission);
  const spy = vi.spyOn(db.agentMission, "findUnique");
  spy.mockImplementation(((args: unknown) => {
    if (remaining > 0) {
      remaining -= 1;
      return writerClient.agentMission.update({ where: { id: missionId }, data: {
        version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 }, updatedAt: new Date(),
      } }).then(() => original(args as never));
    }
    return original(args as never);
  }) as never);
  try {
    return await readMissionBack(missionIdOwner!, missionId);
  } finally {
    spy.mockRestore();
  }
}
let missionIdOwner: string | null = null;

/** 同一响应内部一致性：identity/workState/requires/snapshot 必须来自同一快照。 */
function assertInternalConsistency(back: MissionReadback): void {
  expect(back.workPacket).toBeDefined();
  const workPacket = back.workPacket!;
  expect(back.missionVersion).toBe(back.workState.originalRef.version);
  expect(workPacket.identity.missionVersion).toBe(back.missionVersion);
  expect(workPacket.identity.missionStatus).toBe(back.missionStatus);
  expect(workPacket.stopped.workState.originalRef.version).toBe(back.missionVersion);
  expect(workPacket.stopped.missionStatus).toBe(back.missionStatus);
  expect(workPacket.identity.originalRef).toMatchObject({ kind: "MISSION", id: workPacket.identity.missionId, version: back.missionVersion });
  expect(workPacket.snapshot.checkedAt).toBe(back.readAt);
  expect(workPacket.observations.readAt).toBe(back.readAt);
  expect(["VERSION_STABLE", "RETRIED", "VERSION_ADVANCED"]).toContain(workPacket.snapshot.consistency);
  expect(workPacket.snapshot.retries).toBeGreaterThanOrEqual(0);
  if (workPacket.snapshot.consistency === "VERSION_STABLE") expect(workPacket.snapshot.retries).toBe(0);
  if (workPacket.snapshot.consistency !== "VERSION_STABLE") expect(workPacket.snapshot.retries).toBeGreaterThan(0);
  // 责任摘要与工作包身份同源：controlVersion 只在 identity/authority/requires 出现且一致。
  expect(workPacket.authority.controlVersion).toBe(workPacket.identity.controlVersion ?? "");
  expect(workPacket.next.primaryAction!.requires).toMatchObject({
    missionVersion: workPacket.identity.missionVersion, planRevision: workPacket.identity.planRevision,
    contextVersion: workPacket.identity.contextVersion, constraintsVersion: workPacket.identity.constraintsVersion,
    researchScopeVersion: workPacket.identity.researchScopeVersion, controlVersion: workPacket.identity.controlVersion,
  });
  expect(workPacket.realityOutcome).toBe("NOT_INFERRED");
}

describe("A2 FS-A07 并发：真实双连接写入下 readback 响应内部一致", () => {
  it("第二连接并发推进版本 + 受控复查点：内部不一致=0，RETRIED/VERSION_ADVANCED 正确标记", async () => {
    const user = await db.user.create({ data: { username: `final-a-concurrency-${crypto.randomUUID()}`, displayName: "并发一致性验收", passwordHash: "unused" } });
    const project = await db.project.create({ data: { title: "并发一致性项目", description: "SYNTHETIC_FINAL_A_CONCURRENCY", goal: "核对快照一致性", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const mission = await db.agentMission.create({ data: {
      projectId: project.id, ownerUserId: user.id, createRequestId: `concurrent-${crypto.randomUUID()}`, createPayloadHash: "synthetic-final-a",
      goal: "核对并发读取一致性", successCriteriaJson: json(["DRAFT_EXISTS"]), constraintsJson: json({}), researchScopeJson: json({}),
      continuationPolicyJson: json({ mode: "MANUAL" }), planJson: json({}), budgetJson: json({}),
      budgetUsedJson: json({ models: 1, tools: 0, inputTokens: 3, outputTokens: 2, unknownCalls: 0 }),
    } });
    await db.agentMissionEvent.create({ data: { missionId: mission.id, seq: 0, type: "CREATED", payloadJson: json({ goal: mission.goal }) } });
    missionIdOwner = user.id;
    const beforeMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    const beforeEvents = await db.agentMissionEvent.count({ where: { missionId: mission.id } });

    // 阶段 A：真实第二连接持续写入，期间连续读取；每个响应内部必须一致。
    const writerState: WriterState = { done: false, ok: 0, busy: 0 };
    const readerRounds = 30;
    const writer = writeLoop(mission.id, 400, writerState);
    const concurrentResponses: MissionReadback[] = [];
    for (let round = 0; round < readerRounds; round++) {
      concurrentResponses.push(await readMissionBack(user.id, mission.id));
      await sleep(2);
    }
    writerState.done = true;
    await writer;
    for (const back of concurrentResponses) assertInternalConsistency(back);
    expect(writerState.ok).toBeGreaterThan(0);
    const internalInconsistencies = concurrentResponses.filter(back => {
      try { assertInternalConsistency(back); return false; } catch { return true; }
    }).length;
    expect(internalInconsistencies).toBe(0);

    // 阶段 B：读取期间恰好发生一次版本推进 → 整包重读一次并标记 RETRIED。
    const retried = await readWithInjectedWrites(mission.id, 1);
    assertInternalConsistency(retried);
    expect(retried.workPacket!.snapshot.consistency).toBe("RETRIED");
    expect(retried.workPacket!.snapshot.retries).toBe(1);
    expect(retried.workPacket!.snapshot.note).toContain("已重试 1 次");

    // 阶段 C：读取期间持续推进（3 次复查前各写入一次）→ 重试耗尽后标记 VERSION_ADVANCED，
    // 返回的仍是一致快照，但主操作要求提交时服务端重查，不签发旧操作资格。
    const advanced = await readWithInjectedWrites(mission.id, 3);
    assertInternalConsistency(advanced);
    expect(advanced.workPacket!.snapshot.consistency).toBe("VERSION_ADVANCED");
    expect(advanced.workPacket!.snapshot.retries).toBe(2);
    expect(advanced.workPacket!.blockers.some(blocker => blocker.code === "SNAPSHOT_VERSION_ADVANCED" && blocker.blocksActions)).toBe(true);
    expect(advanced.workPacket!.next.primaryAction!.submissionGuard).toBe("SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY");
    expect(advanced.workPacket!.next.primaryAction!.requires).toMatchObject({
      missionVersion: advanced.workPacket!.identity.missionVersion,
      planRevision: advanced.workPacket!.identity.planRevision,
      contextVersion: advanced.workPacket!.identity.contextVersion,
      constraintsVersion: advanced.workPacket!.identity.constraintsVersion,
      researchScopeVersion: advanced.workPacket!.identity.researchScopeVersion,
    });

    // 读取只读：事件数不变；草稿/回执不被读取创建；Mission 版本推进只来自第二连接写入。
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id } })).toBe(beforeEvents);
    expect(await db.agentMissionOutput.count({ where: { missionId: mission.id } })).toBe(0);
    expect(await db.missionArtifactReceipt.count({ where: { missionId: mission.id } })).toBe(0);
    const afterMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(afterMission.version).toBe(beforeMission.version + writerState.ok + 1 + 3);
    expect(afterMission.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeMission.updatedAt.getTime());

    // 证据化输出：真实迭代、标记分布、内部不一致计数（应恒为 0）。
    const consistencies = [...concurrentResponses, retried, advanced].map(back => back.workPacket!.snapshot.consistency);
    console.log("[final-a-concurrency]", JSON.stringify({
      readerRounds: readerRounds + 2, writerCommits: writerState.ok, writerBusyRetries: writerState.busy,
      consistencies: Object.fromEntries([...new Set(consistencies)].map(value => [value, consistencies.filter(item => item === value).length])),
      unstableResponses: consistencies.filter(value => nonStable.has(value)).length,
      internalInconsistencies: 0, missionVersionBefore: beforeMission.version, missionVersionAfter: afterMission.version,
      snapshotRetries: { retried: retried.workPacket!.snapshot.retries, advanced: advanced.workPacket!.snapshot.retries },
    }));
  }, 60_000);
});
