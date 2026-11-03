/**
 * Track C EV1：隔离 fixture 的只读核对（不启动 Web 服务、不写业务状态）。
 *
 * 读取 seed-web-fixture.ts 写出的 fixture-identity.json，对每个 Mission 调用真实
 * `missionDetail` 与 `readMissionBack`（与 Web 详情/读回同一服务层），核对：
 * - 四问工作包（workPacket）是否存在，phase/主操作/waitingOn/观察状态/阻断是否与预期一致；
 * - 依据项 currentUse 与 revisionAvailability 是否出现 SUPPRESSED / CHANGED / UNKNOWN；
 * - 结果 Action/resultCardId 回执、归入回执、reviewProgress 计数；
 * - 历史旧问题（historical）与过期旧审批（EXPIRED）；
 * - 读取无副作用（version/status/updatedAt/budgetUsed 不变）。
 *
 * 运行（仓库根目录）：
 *   npm.cmd exec -- tsx scripts/final-c/inspect-fixture.ts
 *
 * 退出码：0 = 全部必需检查通过；1 = 有检查失败或脚本错误（证据仍写出）。
 * 输出：evidence/final-c/20261103/fixture-readback-audit.json
 */
import fs from "node:fs";
import {
  applyIsolatedEnv,
  gitFacts,
  identityPath,
  inspectCommand,
  isolatedDbPath,
  readbackAuditPath,
  repoRoot,
} from "./fixturePaths";

type Check = {
  missionKey: string;
  check: string;
  expected: unknown;
  observed: unknown;
  status: "PASS" | "FAIL";
};

const almostEqualJson = (expected: unknown, observed: unknown): boolean => {
  if (expected === observed) return true;
  if (expected === null || observed === null) return expected === observed;
  if (typeof expected !== typeof observed) return false;
  if (typeof expected === "object") {
    return JSON.stringify(expected) === JSON.stringify(observed);
  }
  return false;
};

function deepGet(value: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

async function main() {
  applyIsolatedEnv();
  const git = gitFacts();
  if (!fs.existsSync(identityPath)) {
    throw new Error(`找不到 fixture 身份文件：${identityPath}；请先运行 seed-web-fixture.ts`);
  }
  const identity = JSON.parse(fs.readFileSync(identityPath, "utf8")) as {
    schemaVersion: number;
    exitCode: number;
    environment: { databasePath: string; modelProviderCalls: number };
    account: { username: string };
    missions: Array<{
      key: string;
      id: string;
      projectId: string;
      status: string;
      expected: Record<string, unknown>;
      targets: Record<string, unknown>;
      readTarget?: Record<string, string | number>;
      siblingReadTargets?: Record<string, Record<string, string | number>>;
    }>;
  };
  if (identity.exitCode !== 0) throw new Error("fixture 身份文件记录 seed 失败，拒绝核对");
  if (identity.environment.databasePath !== isolatedDbPath) {
    throw new Error(`身份文件数据库路径不是本工作树隔离库：${identity.environment.databasePath}`);
  }
  const { db } = await import("../../lib/db");
  const { missionDetail } = await import("../../lib/mission/missionService");
  const { readMissionBack } = await import("../../lib/mission/readback");
  const user = await db.user.findUniqueOrThrow({ where: { username: identity.account.username } });

  const checks: Check[] = [];
  const readings: Record<string, unknown> = {};
  const record = (missionKey: string, check: string, expected: unknown, observed: unknown) => {
    checks.push({
      missionKey,
      check,
      expected,
      observed,
      status: almostEqualJson(expected, observed) ? "PASS" : "FAIL",
    });
  };
  const recordIncludes = (missionKey: string, check: string, expected: unknown[], observed: unknown[]) => {
    const missing = expected.filter((value) => !observed.some((item) => almostEqualJson(item, value)));
    checks.push({
      missionKey,
      check,
      expected,
      observed,
      status: missing.length === 0 ? "PASS" : "FAIL",
    });
  };

  const snapshotOf = async (missionId: string) => {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    return {
      version: row.version,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      budgetUsedJson: JSON.stringify(row.budgetUsedJson),
    };
  };

  const condense = (readback: Awaited<ReturnType<typeof readMissionBack>>) => {
    const packet = (
      readback as unknown as { workPacket?: Record<string, unknown> }
    ).workPacket;
    const workState = readback.workState;
    const materialUses = readback.materialUses as {
      items: Array<{
        sourcePointer: { id: string };
        currentUse: { state: string } | null;
        revisionAvailability: string;
        availability: string;
        facts?: Array<{ kind: string }>;
      }>;
    };
    return {
      missionVersion: readback.missionVersion,
      missionStatus: readback.missionStatus,
      phase: workState.phase,
      nextActor: workState.nextActor,
      requiresUser: workState.requiresUser,
      reasonCode: workState.reasonCode,
      workStateTerminal: workState.terminal ?? null,
      unsettledEffect: workState.unsettledEffect ?? null,
      stopRequest: workState.stopRequest ?? null,
      observationState: (readback as unknown as { observation?: { state?: string } }).observation?.state ?? null,
      snapshotConsistency: (deepGet(packet, "snapshot.consistency") as string | undefined) ?? null,
      hasWorkPacket: !!packet,
      primaryActionKind: (deepGet(packet, "next.primaryAction.kind") as string | undefined) ?? null,
      primaryActionTarget: (deepGet(packet, "next.primaryAction.target") as unknown) ?? null,
      waitingOn: (deepGet(packet, "next.waitingOn") as string | undefined) ?? null,
      blockerCodes: Array.isArray(deepGet(packet, "blockers"))
        ? ((deepGet(packet, "blockers") as Array<{ code?: string }>).map((b) => b.code) as string[])
        : [],
      materialUses: Object.fromEntries(
        (materialUses?.items ?? []).map((item) => [
          item.sourcePointer.id,
          {
            currentUse: item.currentUse?.state ?? null,
            revisionAvailability: item.revisionAvailability,
            availability: item.availability,
            facts: (item.facts ?? []).map((fact) => fact.kind),
          },
        ]),
      ),
      materialUseCount: materialUses?.items?.length ?? 0,
      latestOutput: (deepGet(packet, "done.latestOutput") as unknown) ?? null,
      actionReceipts: (deepGet(packet, "done.actionReceipts") as unknown[]) ?? [],
      adoptions: (readback.adoptions as unknown[]) ?? [],
      reviewProgressCounts: (deepGet(readback, "reviewProgress.counts") as unknown) ?? null,
      selectedQuestion: readback.selected.question,
      selectedApproval: readback.selected.approval,
      selectedOutput: readback.selected.output
        ? { id: readback.selected.output.id, revision: readback.selected.output.revision }
        : null,
      selectedReceipt: readback.selected.receipt,
      realityOutcome: readback.realityOutcome,
    };
  };

  for (const mission of identity.missions) {
    const key = mission.key;
    const expected = mission.expected;
    const before = await snapshotOf(mission.id);
    let detail: Awaited<ReturnType<typeof missionDetail>> | null = null;
    let readback: Awaited<ReturnType<typeof readMissionBack>> | null = null;
    let detailError: unknown = null;
    let readbackError: unknown = null;
    try {
      detail = await missionDetail(user.id, mission.id);
    } catch (error) {
      detailError = error;
    }
    try {
      readback = await readMissionBack(user.id, mission.id, mission.readTarget ?? {});
    } catch (error) {
      readbackError = error;
    }
    const after = await snapshotOf(mission.id);
    checks.push({
      missionKey: key,
      check: "readSideEffectsUnchanged",
      expected: before,
      observed: after,
      status:
        before.version === after.version &&
        before.status === after.status &&
        before.updatedAt === after.updatedAt &&
        before.budgetUsedJson === after.budgetUsedJson
          ? "PASS"
          : "FAIL",
    });
    if (detailError || readbackError) {
      readings[key] = {
        detailError: detailError instanceof Error ? detailError.message : String(detailError ?? ""),
        readbackError:
          readbackError instanceof Error ? readbackError.message : String(readbackError ?? ""),
      };
      checks.push({
        missionKey: key,
        check: "servicesReadable",
        expected: "missionDetail + readMissionBack 成功",
        observed: { detailError: !!detailError, readbackError: !!readbackError },
        status: "FAIL",
      });
      continue;
    }
    const observed = condense(readback!);
    const observedRecord = observed as unknown as Record<string, unknown>;
    readings[key] = {
      detail: {
        status: detail!.status,
        version: detail!.version,
        questionId: detail!.question?.id ?? null,
        approvals: detail!.approvals.map((a) => ({ id: a.id, expiresAt: a.expiresAt })),
        steps: detail!.steps.map((s) => ({ ordinal: s.ordinal, toolName: s.toolName, status: s.status })),
        outputs: detail!.outputs.map((o) => ({ id: o.id, revision: o.revision, verificationStatus: o.verificationStatus })),
      },
      readback: observed,
    };
    record(key, "hasWorkPacket", true, observed.hasWorkPacket);
    for (const field of [
      "status",
      "phase",
      "nextActor",
      "requiresUser",
      "reasonCode",
      "primaryActionKind",
      "waitingOn",
      "observationState",
    ] as const) {
      if (field === "status") {
        record(key, field, expected.status, observed.missionStatus);
      } else {
        record(key, field, expected[field], observedRecord[field]);
      }
    }
    if (Array.isArray(expected.blockerCodes)) {
      recordIncludes(key, "blockerCodes", expected.blockerCodes as unknown[], observed.blockerCodes);
    }
    if (expected.primaryActionTarget) {
      record(key, "primaryActionTarget", expected.primaryActionTarget, observed.primaryActionTarget);
    }
    if (expected.unsettledEffect) {
      record(key, "unsettledEffect", expected.unsettledEffect, {
        present: (observed.unsettledEffect as { present?: boolean } | null)?.present,
        code: (observed.unsettledEffect as { code?: string | null } | null)?.code,
        source: (observed.unsettledEffect as { source?: string } | null)?.source,
      });
    }
    if (expected.stopRequestState) {
      record(
        key,
        "stopRequestState",
        expected.stopRequestState,
        (observed.stopRequest as { state?: string } | null)?.state,
      );
      record(
        key,
        "stopRequestSettled",
        expected.stopRequestSettled,
        (observed.stopRequest as { settled?: boolean } | null)?.settled,
      );
    }
    if (expected.materialUses && typeof expected.materialUses === "object") {
      for (const [sourceId, want] of Object.entries(
        expected.materialUses as Record<string, Record<string, unknown>>,
      )) {
        const observedItem = (observed.materialUses as Record<string, unknown>)[sourceId] as
          | Record<string, unknown>
          | undefined;
        const observedSubset = Object.fromEntries(
          Object.keys(want).map((field) => [field, observedItem?.[field] ?? null]),
        );
        record(key, `materialUse:${sourceId}`, want, observedSubset);
      }
      if (typeof expected.materialUseCount === "number") {
        record(key, "materialUseCount", expected.materialUseCount, observed.materialUseCount);
      }
    }
    if (expected.latestOutput) {
      const latest = observed.latestOutput as { id?: string; revision?: number } | null;
      record(key, "latestOutput", expected.latestOutput, {
        id: latest?.id ?? null,
        revision: latest?.revision ?? null,
      });
    }
    if (Array.isArray(expected.actionReceipts)) {
      const receipts = observed.actionReceipts as Array<Record<string, unknown>>;
      for (const want of expected.actionReceipts as Array<Record<string, unknown>>) {
        recordIncludes(
          key,
          `actionReceipt:${String(want.actionId)}`,
          [want],
          receipts.map((receipt) => ({
            actionId: receipt.actionId,
            status: receipt.status,
            resultCardId: receipt.resultCardId,
            isSimulated: receipt.isSimulated,
          })),
        );
      }
    }
    if (Array.isArray(expected.adoptions)) {
      const adoptions = observed.adoptions as Array<Record<string, unknown>>;
      for (const want of expected.adoptions as Array<Record<string, unknown>>) {
        recordIncludes(
          key,
          `adoption:${String(want.receiptId)}`,
          [want],
          adoptions.map((adoption) => ({
            receiptId: adoption.receiptId,
            artifactId: adoption.artifactId,
          })),
        );
      }
    }
    if (expected.reviewProgress && typeof expected.reviewProgress === "object") {
      const counts = (observed.reviewProgressCounts ?? {}) as Record<string, Record<string, number>>;
      for (const [category, wantCounts] of Object.entries(
        expected.reviewProgress as Record<string, number>,
      )) {
        const observedCount =
          category === "userReported"
            ? counts.userReported?.actionReceipts
            : category === "executed"
              ? counts.executed?.steps
              : category === "observed"
                ? counts.observed?.steps
                : undefined;
        record(key, `reviewProgress:${category}`, wantCounts, observedCount ?? null);
      }
    }
    if (expected.selectedApprovalStatus) {
      record(
        key,
        "selectedApprovalStatus",
        expected.selectedApprovalStatus,
        (observed.selectedApproval as { status?: string } | null)?.status ?? null,
      );
    }
    // 历史旧问题 / 过期旧审批：真实种子，不是拦截样本。
    const siblings = mission.siblingReadTargets ?? {};
    for (const [name, target] of Object.entries(siblings)) {
      const beforeSibling = await snapshotOf(mission.id);
      const siblingReadback = await readMissionBack(user.id, mission.id, target);
      const afterSibling = await snapshotOf(mission.id);
      const sibling = condense(siblingReadback);
      readings[`${key}.${name}`] = sibling;
      if (name === "oldQuestion") {
        record(key, "oldQuestion.historical", true, sibling.selectedQuestion?.historical ?? null);
        record(key, "oldQuestion.id", target.questionId, sibling.selectedQuestion?.id ?? null);
      }
      if (name === "oldApproval") {
        record(key, "oldApproval.status", "EXPIRED", sibling.selectedApproval?.status ?? null);
        record(key, "oldApproval.id", target.approvalId, sibling.selectedApproval?.id ?? null);
      }
      checks.push({
        missionKey: key,
        check: `${name}.readSideEffectsUnchanged`,
        expected: beforeSibling,
        observed: afterSibling,
        status:
          beforeSibling.version === afterSibling.version &&
          beforeSibling.status === afterSibling.status &&
          beforeSibling.updatedAt === afterSibling.updatedAt &&
          beforeSibling.budgetUsedJson === afterSibling.budgetUsedJson
            ? "PASS"
            : "FAIL",
      });
    }
  }

  // 隔离与来源边界：库里只有本 fixture 的合成数据。
  const fixtureProjects = await db.project.findMany({
    where: { description: { startsWith: "SYNTHETIC_FINAL_C_FIXTURE_ONLY" } },
    select: { id: true, _count: { select: { missions: true } } },
  });
  const fixtureUsers = await db.user.findMany({
    where: { username: { startsWith: "final-c-" } },
    select: { id: true },
  });
  const providerRuns = await db.agentRun.count();
  record("environment", "fixtureProjectCount", 2, fixtureProjects.length);
  record("environment", "fixtureUserCount", 1, fixtureUsers.length);
  record("environment", "agentRunCount(expect 0 for seed)", 0, providerRuns);
  record("environment", "databasePath", isolatedDbPath, identity.environment.databasePath);
  record("environment", "modelProviderCalls", 0, identity.environment.modelProviderCalls);

  const failed = checks.filter((check) => check.status === "FAIL");
  const audit = {
    schemaVersion: 1,
    track: "C",
    mode: "EV1_FAILURE_FIXTURE_READBACK_AUDIT",
    generatedAt: new Date().toISOString(),
    command: inspectCommand,
    exitCode: failed.length ? 1 : 0,
    git,
    worktree: repoRoot,
    databasePath: isolatedDbPath,
    provider: "mock",
    modelProviderCalls: 0,
    dataSource: "REAL_ISOLATED_DATABASE（本工作树 prisma/final-preparation.db，合成数据）",
    identityPath,
    totals: { checks: checks.length, pass: checks.length - failed.length, fail: failed.length },
    checks,
    readings,
    note:
      "本文件验证 fixture 与真实服务层读回；不代表 Web UI 已验收。Web 截图/异常态证据见 EV2 manifest。",
  };
  fs.writeFileSync(readbackAuditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        auditPath: readbackAuditPath,
        totals: audit.totals,
        failures: failed.slice(0, 20),
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error("[final-c inspect] 失败：", error);
  process.exitCode = 1;
});
