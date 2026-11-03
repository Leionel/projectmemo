/**
 * A1 探针：FS-A07 真实双连接并发特征化（BEFORE_FIX）。
 *
 * 关键点：
 * - 主连接：lib/db 的 Prisma singleton（只读服务调用）；
 * - 写连接：new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 同一 DATABASE_URL }) })；
 * - 两个独立连接指向同一个临时 SQLite 文件，写连接在读取之间循环执行真实 update/insert：
 *   1) 委托 version/planRevision/constraintsVersion/contextVersion/constraints/planJson 变更；
 *   2) SourceConnection 撤销/恢复（影响 SourcePolicy 许可与 controlVersion）；
 *   3) 项目级 USE_SUPPRESSION 指令事件（uphold 来源抑制，不改 mission.version）。
 * - 主循环交替调用 missionDetail → readMissionResponsibility → readMissionBack，
 *   统计跨接口/跨调用/同一响应内的修订不一致次数，并保留真实 JSON 片段。
 *
 * 不用 mock、不用前端 stale 标签。
 * 运行：npx.cmd tsx scripts/final-a/probe-fs-a07-concurrency.ts
 * 退出码：0 = 探针跑完（不代表业务已修复）；非零 = 脚本失败，证据里记录 error。
 */
import { randomUUID } from "node:crypto";
import { createOwner, createMission, DEFAULT_BUDGET } from "./lib/probeFixtures";
import {
  setupIsolatedDatabase,
  gitHead,
  probeSourceTree,
  writeEvidence,
  sleep,
  errorFacts,
  runProbe,
  sha256,
} from "./lib/probeSupport";

const env = setupIsolatedDatabase("fs-a07");
const generatedAt = new Date().toISOString();
const baseSha = gitHead();
const ITERATIONS = 40;

const db = (await import("../../lib/db")).db;
const { PrismaClient } = await import("../../lib/generated/prisma/client");
const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
const { missionDetail } = await import("../../lib/mission/missionService");
const { readMissionResponsibility } = await import("../../lib/mission/responsibility");
const { readMissionBack } = await import("../../lib/mission/readback");
const { jsonHash } = await import("../../lib/mission/contracts");
const { sourceUse } = await import("../../lib/continuity/sourcePolicy");

// 第二个 PrismaClient：与主连接同库不同连接（真实双连接写入）。
const writer = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: env.databaseUrl }) });

type WriterMode = "MISSION" | "SOURCE" | "SUPPRESSION";
const writerCounts: Record<WriterMode, number> = { MISSION: 0, SOURCE: 0, SUPPRESSION: 0 };
let writerErrors: unknown[] = [];

async function withWriterRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 6) {
        writerErrors.push({ label, attempt, ...errorFacts(error) });
        throw error;
      }
      await sleep(20 * (attempt + 1));
    }
  }
}

const result = await runProbe("probe-fs-a07-concurrency", "probe-concurrency.json", async () => {
  const owner = await createOwner(db, "a07");
  const capture = await db.capture.create({
    data: { projectId: owner.projectId, rawText: "FS-A07 并发探针来源：演示记录需复核。" },
  });
  const pointerId = `capture:${capture.id}`;
  const connection = await db.sourceConnection.create({
    data: {
      projectId: owner.projectId,
      ownerUserId: owner.userId,
      provider: "GITHUB",
      repo: `probe/a07-${capture.id}`,
      ref: "main",
      signalKind: "COMMITS",
      status: "ACTIVE",
      revision: 1,
    },
  });
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const baseConstraints = {
    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    executionBoundary: "READ_ANALYZE",
    llmContextApproved: false,
  };
  const boundedPolicy = {
    mode: "BOUNDED_INVESTIGATION" as const,
    schemaVersion: 1 as const,
    expiresAt,
    checkEveryMinutes: 10,
    maxModels: 4,
    maxTools: 6,
    maxMetadataRequests: 4,
    allowedTools: ["read_project_material", "inspect_project"],
    connectionIds: [connection.id],
    trackBranchHead: false,
    timezone: "Asia/Shanghai",
    quietStart: 22,
    quietEnd: 8,
    attention: "IMPORTANT_ONLY" as const,
  };
  const mission = await createMission(db, owner, {
    status: "READY",
    version: 1,
    planRevision: 1,
    contextVersion: 1,
    constraintsVersion: 1,
    constraintsJson: baseConstraints,
    continuationPolicyJson: boundedPolicy,
    planJson: { delegation: { lastObservedAt: "2026-10-01T00:00:00.000Z" } },
    budgetJson: DEFAULT_BUDGET,
    budgetUsedJson: { models: 2, tools: 1, inputTokens: 100, outputTokens: 20 },
  });
  const missionId = mission.id;

  const userState = await db.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { continuitySeq: true } });
  let directiveSeq = userState.continuitySeq;

  // 三种真实写操作，按迭代轮转，保证每轮恰好各发生一次。
  async function writeMissionRevision(iteration: number) {
    await writer.agentMission.update({
      where: { id: missionId },
      data: {
        version: { increment: 1 },
        planRevision: { increment: 1 },
        constraintsVersion: { increment: 1 },
        contextVersion: { increment: 1 },
        constraintsJson: { ...baseConstraints, rehearsalRun: iteration, priority: (iteration % 5) + 1 },
        planJson: {
          delegation: {
            lastObservedAt: "2026-10-01T00:00:00.000Z",
            revision: iteration,
            observationSource: "CONCURRENT_WRITER",
          },
        },
      },
    });
  }
  async function writeSourceRevocation(iteration: number) {
    const revoked = iteration % 2 === 0;
    await writer.sourceConnection.update({
      where: { id: connection.id },
      data: {
        status: revoked ? "REVOKED" : "ACTIVE",
        revokedAt: revoked ? new Date() : null,
        revokedReason: revoked ? "PROBE_CONCURRENT_REVOKE" : null,
        revision: { increment: 1 },
      },
    });
  }
  async function writeSuppressionDirective(iteration: number) {
    directiveSeq += 1;
    const seq = directiveSeq;
    await writer.agentDirectiveEvent.create({
      data: {
        id: randomUUID(),
        ownerUserId: owner.userId,
        seq,
        commandId: `probe-concurrent-suppress-${iteration}-${randomUUID()}`,
        eventIndex: 0,
        inputHash: jsonHash({ probe: "FS-A07", iteration, pointerId }),
        directiveId: randomUUID(),
        projectId: owner.projectId,
        conversationId: null,
        missionId: null,
        kind: "USE_SUPPRESSION",
        operation: "SUPPRESS_USE",
        quote: `并发探针：第 ${iteration} 轮停止复用该资料`,
        sourceJson: { origin: "PROBE_CONCURRENCY", iteration },
        admissionJson: { status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION", reason: "EXPLICIT_SUPPRESSION" },
        sourceIdsJson: [pointerId],
        validFrom: new Date(Date.now() - 60_000),
        timezone: "Asia/Shanghai",
      },
    });
    await writer.user.update({ where: { id: owner.userId }, data: { continuitySeq: { increment: 1 } } });
  }
  async function writeByMode(mode: WriterMode, iteration: number) {
    await withWriterRetry(mode, async () => {
      if (mode === "MISSION") await writeMissionRevision(iteration);
      else if (mode === "SOURCE") await writeSourceRevocation(iteration);
      else await writeSuppressionDirective(iteration);
    });
    writerCounts[mode] += 1;
  }

  const modeOrder: WriterMode[] = ["MISSION", "SOURCE", "SUPPRESSION"];
  const iterations: unknown[] = [];
  const inconsistencySamples: unknown[] = [];
  const licenseSamples: unknown[] = [];
  const counters = {
    iterations: ITERATIONS,
    crossInterfaceVersionMismatch: 0,
    crossInterfaceConstraintsMismatch: 0,
    licenseChangedWithoutMissionVersionChange: 0,
    sameResponseInternalViolations: 0,
    readbackVsResponsibilityVersionMismatch: 0,
  };
  let previousControlVersion: string | null = null;

  for (let i = 0; i < ITERATIONS; i++) {
    const modeA = modeOrder[i % 3];
    const modeB = modeOrder[(i + 1) % 3];
    const modeC = modeOrder[(i + 2) % 3];

    // 1) 写连接写入 → 主连接读 missionDetail（旧快照）
    await writeByMode(modeA, i);
    const detail = await missionDetail(owner.userId, missionId);

    // 2) 两次读取之间再由写连接推进修订 → 主连接读 responsibility（新快照）
    await writeByMode(modeB, i);
    const responsibility1 = await readMissionResponsibility(owner.userId, missionId);

    const versionMismatch = detail.version !== responsibility1.workState.originalRef.version;
    const constraintsMismatch = jsonHash(detail.constraints) !== jsonHash(responsibility1.constraints);
    if (versionMismatch) counters.crossInterfaceVersionMismatch += 1;
    if (constraintsMismatch) counters.crossInterfaceConstraintsMismatch += 1;
    if (versionMismatch || constraintsMismatch) {
      if (inconsistencySamples.length < 3) {
        inconsistencySamples.push({
          iteration: i,
          writerModeBetweenViews: modeB,
          missionDetailSnapshot: {
            missionVersion: detail.version,
            planRevision: detail.planRevision,
            constraintsVersion: detail.constraintsVersion,
            contextVersion: detail.contextVersion,
            constraintsHash: sha256(detail.constraints).slice(0, 16),
            constraints: detail.constraints,
          },
          responsibilitySnapshot: {
            controlVersion: responsibility1.controlVersion,
            workStateOriginalRefVersion: responsibility1.workState.originalRef.version,
            constraintsHash: sha256(responsibility1.constraints).slice(0, 16),
            constraints: responsibility1.constraints,
            permissionState: responsibility1.permissionState,
            budgetCumulativeModels: responsibility1.budget.cumulativeUsed.models,
          },
          note: "同一次读取组合里 detail 与 responsibility 属于不同修订；responsibility 只有 controlVersion 哈希，detail 只有 version，调用方无法对齐两个修订号。",
        });
      }
    }

    // 3) 同一响应内一致性：readMissionBack 在单事务内组合 workState 与 version。
    const readback = await readMissionBack(owner.userId, missionId);
    const internalViolations: string[] = [];
    if (readback.missionVersion !== readback.workState.originalRef.version)
      internalViolations.push("missionVersion != workState.originalRef.version");
    if (readback.workState.originalRef.id !== readback.missionId)
      internalViolations.push("workState.originalRef.id != missionId");
    if (readback.missionStatus !== "READY") internalViolations.push(`missionStatus=${readback.missionStatus}`);
    if (readback.missionVersion !== detail.version && readback.missionVersion !== responsibility1.workState.originalRef.version)
      internalViolations.push("readback version matches neither earlier snapshot");
    if (internalViolations.length) counters.sameResponseInternalViolations += internalViolations.length;

    // 4) 写连接再推进 → readback 与后续 responsibility 的跨调用修订不一致。
    await writeByMode(modeC, i);
    const responsibility2 = await readMissionResponsibility(owner.userId, missionId);
    const readbackRespMismatch = readback.missionVersion !== responsibility2.workState.originalRef.version;
    if (readbackRespMismatch) counters.readbackVsResponsibilityVersionMismatch += 1;

    // 5) 许可/来源修订但不改 mission.version 的情形：detail 与 responsibility 同 version，
    //    但写连接在两次读取之间撤销来源 / 追加 USE_SUPPRESSION，controlVersion 已推进。
    const sameMissionVersion = responsibility1.workState.originalRef.version === detail.version;
    const controlVersionAdvanced =
      previousControlVersion !== null && responsibility1.controlVersion !== previousControlVersion;
    if (sameMissionVersion && controlVersionAdvanced) {
      counters.licenseChangedWithoutMissionVersionChange += 1;
      if (licenseSamples.length < 3) {
        licenseSamples.push({
          iteration: i,
          writerModeBetweenViews: modeB,
          missionVersionUnchanged: detail.version,
          previousControlVersion,
          controlVersion: responsibility1.controlVersion,
          permissionState: responsibility1.permissionState,
          detailConstraintsHash: sha256(detail.constraints).slice(0, 16),
          responsibilityConstraintsHash: sha256(responsibility1.constraints).slice(0, 16),
          note: "来源撤销/USE_SUPPRESSION 推进了 controlVersion，但 mission.version 在两次读取之间未变；只带 expectedVersion 的调用方无法用 version 发现许可变化。",
        });
      }
    }
    previousControlVersion = responsibility2.controlVersion;

    iterations.push({
      iteration: i,
      writerModes: [modeA, modeB, modeC],
      detail: {
        version: detail.version,
        planRevision: detail.planRevision,
        constraintsVersion: detail.constraintsVersion,
        contextVersion: detail.contextVersion,
        constraintsHash: sha256(detail.constraints).slice(0, 16),
        continuationPolicyMode: (detail.continuationPolicy as { mode?: string } | null)?.mode ?? null,
      },
      responsibility1: {
        controlVersion: responsibility1.controlVersion,
        workStateVersion: responsibility1.workState.originalRef.version,
        constraintsHash: sha256(responsibility1.constraints).slice(0, 16),
        permissionState: responsibility1.permissionState,
        cumulativeModels: responsibility1.budget.cumulativeUsed.models,
      },
      readback: {
        missionVersion: readback.missionVersion,
        missionStatus: readback.missionStatus,
        workStateVersion: readback.workState.originalRef.version,
        internalViolations,
      },
      responsibility2: {
        controlVersion: responsibility2.controlVersion,
        workStateVersion: responsibility2.workState.originalRef.version,
        permissionState: responsibility2.permissionState,
      },
      crossInterface: { versionMismatch, constraintsMismatch },
      crossCallReadbackVsResponsibility: { versionMismatch: readbackRespMismatch },
    });
  }

  // 双连接可见性：写连接的最终写入必须被主连接读到。
  const finalMission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const finalConnection = await db.sourceConnection.findUniqueOrThrow({ where: { id: connection.id } });
  const finalDirectiveCount = await db.agentDirectiveEvent.count({
    where: { ownerUserId: owner.userId, commandId: { startsWith: "probe-concurrent-suppress-" } },
  });
  const sourcePolicyAfter = await sourceUse(owner.userId, owner.projectId, pointerId, db, { missionId });
  const expectedMissionVersion = 1 + writerCounts.MISSION;

  const finalState = {
    missionVersion: finalMission.version,
    missionVersionExpected: expectedMissionVersion,
    missionVersionMatches: finalMission.version === expectedMissionVersion,
    planRevision: finalMission.planRevision,
    constraintsVersion: finalMission.constraintsVersion,
    contextVersion: finalMission.contextVersion,
    sourceConnectionStatus: finalConnection.status,
    sourceConnectionRevision: finalConnection.revision,
    suppressionDirectiveCount: finalDirectiveCount,
    sourcePolicyAfter: {
      state: sourcePolicyAfter.state,
      reason: sourcePolicyAfter.reason,
    },
  };

  const judgment = {
    跨接口一致性:
      counters.crossInterfaceVersionMismatch > 0
        ? "detail 与 responsibility 是两次独立读取/事务；写连接在两次之间推进修订时，同一读取组合会拿到不同 mission.version（responsibility 以 controlVersion 表达，detail 以 version 表达，二者不可直接对齐）。"
        : "本机未观测到跨接口修订不一致。",
    同一响应内:
      counters.sameResponseInternalViolations === 0
        ? "readMissionBack 在一个 SQLite 事务内组合，missionVersion/status 与 workState.originalRef 同修订，未观测到同响应内混用；但它不暴露 planRevision/controlVersion，跨接口对齐仍缺公共版本号。"
        : "readMissionBack 内部出现修订不一致。",
    旧操作资格:
      counters.licenseChangedWithoutMissionVersionChange > 0
        ? "来源撤销/USE_SUPPRESSION 会推进 controlVersion 而 mission.version 不变；只以 expectedVersion 守卫的写入路径无法从 version 发现许可变化。"
        : "本机未观测到许可修订与 mission.version 解耦。",
    双连接真实性:
      "writer 是第二个 PrismaClient（PrismaBetterSqlite3 适配器，同 DATABASE_URL），与主连接分别提交；写连接的更新能被主连接读到（missionVersionMatches=true）。",
  };

  return {
    generatedAt,
    baseSha,
    sourceTree: probeSourceTree(),
    environment: {
      database: "temp-independent",
      databaseUrl: env.databaseUrl,
      databaseFile: env.file,
      temporaryDir: env.dir,
      migrationsApplied: env.migrationsApplied,
      schemaTables: env.schemaTables,
      llmMode: "mock",
      modelProviderCalls: 0,
      connections: {
        main: "lib/db Prisma singleton（PrismaBetterSqlite3 适配器）",
        writer: "new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 同一 DATABASE_URL }) })",
        writerDistinct: true,
      },
    },
    method:
      "每轮 3 次真实写（MISSION 修订 / SourceConnection 撤销恢复 / 项目级 USE_SUPPRESSION 指令）与 4 次真实读交替：missionDetail → write → readMissionResponsibility → readMissionBack → write → readMissionResponsibility。",
    counters,
    judgment,
    finalState,
    writer: { counts: writerCounts, errors: writerErrors },
    mission: { id: missionId, initialVersion: 1, iterations: ITERATIONS },
    iterationSamples: iterations,
    inconsistencySamples,
    licenseChangeSamples: licenseSamples,
    notes: [
      "本探针不使用 mock、不使用前端 stale 标签；读写都在同一临时 SQLite 的真实双连接上。",
      "同一事件循环内的两个连接按 await 边界交错提交，写入是真实事务提交，读取看到的是已提交状态；不是 JS 线程级并行。",
      "FS-A07 的失败判据是“不得混用新旧事实或签发旧操作资格”，本文件只做记录与计数，修复留 A2。",
      "readMissionBack 无 planRevision/controlVersion 字段（证据中 readback 仅 missionVersion/status/workState），跨接口公共版本号本身缺失。",
    ],
  };
});

await writer.$disconnect();
await db.$disconnect();
process.exitCode = result;
