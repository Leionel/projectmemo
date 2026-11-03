/**
 * A1 合同切片：从纯函数生成真实序列化样本（无数据库、无模型、无网络）。
 *
 * 只调用 lib/mission/workState.ts 的 missionWorkState 与 lib/mission/workPacket.ts 的
 * buildMissionWorkPacket 构造实例，把真实 JSON 写到
 * evidence/final-a/20261103/samples/a1-pure/。
 *
 * 运行：npx.cmd tsx scripts/final-a/a1-contract-samples.ts
 * 退出码 0 = 样本写完；非零 = 脚本失败（不写部分证据之外的副作用）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { missionWorkState } from "@/lib/mission/workState";
import { buildMissionWorkPacket, type WorkPacketInput } from "@/lib/mission/workPacket";
import {
  WORK_PACKET_CONTRACT_VERSION,
  WORK_PACKET_SCHEMA_VERSION,
  type WorkPacketMaterialUses,
} from "@/lib/types/workPacket";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "evidence/final-a/20261103/samples/a1-pure");
const NOW = new Date("2026-11-03T03:00:00.000Z");
const EARLIER = new Date("2026-11-02T12:00:00.000Z");
const LEASE_FUTURE = new Date("2026-11-03T03:01:00.000Z");
const NEXT_ATTEMPT = new Date("2026-11-04T00:00:00.000Z");
const OBSERVED_AT = "2026-11-01T08:00:00.000Z";

const missionBase = {
  id: "synthetic-final-a-mission",
  version: 7,
  planJson: { delegation: { lastObservedAt: OBSERVED_AT } },
  continuationPolicyJson: { mode: "MANUAL" },
  updatedAt: EARLIER,
};

type MissionInput = Parameters<typeof missionWorkState>[0];
function mission(overrides: Partial<MissionInput>): MissionInput {
  return { ...missionBase, status: "READY", ...overrides } as MissionInput;
}
function workState(overrides: Partial<MissionInput>, now: Date = NOW) {
  return missionWorkState(mission(overrides), now);
}
function basePacketInput(state: ReturnType<typeof missionWorkState>, overrides: Partial<WorkPacketInput> = {}): WorkPacketInput {
  return {
    mission: {
      missionId: "synthetic-final-a-mission",
      projectId: "synthetic-project",
      missionVersion: 7,
      missionStatus: String((missionBase as { status?: string }).status ?? "READY"),
      planRevision: 4,
      contextVersion: 3,
      constraintsVersion: 2,
      researchScopeVersion: 1,
      lastErrorCode: null,
      finishedAt: null,
      updatedAt: EARLIER.toISOString(),
      pauseRequestedAt: null,
      cancelRequestedAt: null,
      pauseReason: null,
    },
    workState: state,
    responsibility: {
      controlVersion: "control-v7",
      permissionState: "WITHIN_TIME_BOUNDARY",
      permissionExpiresAt: null,
      deadline: null,
      workerPresence: "RECENT",
      effectiveNextCheckAt: null,
      personalMemoryNextBoundary: null,
      budget: {
        limits: { models: 12, tools: 16 },
        cumulativeUsed: { models: 5, tools: 2, inputTokens: 900, outputTokens: 120, unknownCalls: 1 },
        policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE",
        monetaryCost: null,
      },
    },
    observations: {
      lastSuccessfulAt: OBSERVED_AT,
      lastFailedAt: null,
      lastNoNewInformationAt: null,
      nextCheckAt: null,
    },
    work: {
      steps: [{ id: "step-2", ordinal: 2, toolName: "inspect_project", status: "SUCCEEDED", at: "2026-11-02T10:00:00.000Z", note: "读取项目" }],
      stepsLimit: 5,
      stepsTruncated: false,
      latestOutput: { id: "output-3", revision: 3, createdAt: "2026-11-02T11:00:00.000Z" },
      actionReceipts: [],
      actionReceiptsLimit: 5,
      actionReceiptsTruncated: false,
      progress: null,
    },
    basis: { questionId: null, materialUses: null, evidenceReviews: null, currentUsePolicy: "SOURCE_POLICY_APPLIED" },
    pendingOriginalRefs: { approvals: [] },
    snapshot: { consistency: "VERSION_STABLE", retries: 0, checkedAt: NOW.toISOString() },
    ...overrides,
  };
}

const materialUses = (currentUseState: "ALLOWED" | "SUPPRESSED" | "UNKNOWN"): WorkPacketMaterialUses => ({
  schemaVersion: 1,
  questionId: "q-1",
  items: [
    {
      sourcePointer: { id: "capture:abc", hash: "a".repeat(64) },
      title: "项目记录",
      availability: "CURRENT",
      availabilityMeaning: "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION",
      currentUse: {
        state: currentUseState,
        independentEvidence: currentUseState === "ALLOWED",
        reason: currentUseState === "SUPPRESSED" ? "ROOT_SUPPRESSED" : currentUseState === "UNKNOWN" ? "LINEAGE_UNKNOWN" : "ORIGINAL_OBSERVATION",
        policy: "SOURCE_POLICY_V1",
        checkedAt: NOW.toISOString(),
        appliesTo: "CURRENT_USE_ONLY",
      },
      facts: [{ kind: "BOUND", refId: "step-1" }, { kind: "OUTPUT_REFERENCE", refId: "output-1", revision: 1 }],
      coverage: { loadedCharacters: 120, totalCharacters: 120, truncated: false, extractionStatus: "SUCCESS" },
      bodyCoverage: "NOT_RECORDED",
      excerpt: "原记录摘录：本地实验记录（历史留痕）。",
    },
  ],
  coverage: {
    eventLimit: 80, eventsInspected: 1, eventsTruncated: false,
    stepLimit: 40, stepsInspected: 1, stepsTruncated: false,
    outputLimit: 20, outputsInspected: 1, outputsTruncated: false,
    receiptsInspected: 0, receiptsTruncated: false,
    runLimit: 40, projectRunLimit: 40, runsInspected: 1, runsTruncated: false,
    runScope: "MISSION_FILTERED",
    sourceLimit: 8, sourceLimitReached: false,
    mapping: "DIRECT_SOURCE_POINTERS_ONLY",
    // 只读量测字段（A-新3）：本样本含 1 个 item 的 currentUse 判定。
    sourcePolicyChecks: 1,
  },
});

const cases: Array<{ id: string; question: string; state: ReturnType<typeof missionWorkState>; packet: WorkPacketInput }> = [];
function addCase(id: string, question: string, state: ReturnType<typeof missionWorkState>, overrides: Partial<WorkPacketInput> = {}) {
  cases.push({ id, question, state, packet: basePacketInput(state, overrides) });
}

// 1. 终态 SUCCEEDED 与未结算 UNKNOWN 并存
addCase("FS-A01-SUCCEEDED-UNKNOWN", "成功终态与未知调用结果同时可见，取消不显示成功、不提供恢复", workState({
  status: "SUCCEEDED", finishedAt: EARLIER, lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "日历写入回包丢失" },
}), { mission: { ...basePacketInput(workState({ status: "SUCCEEDED" })).mission, missionStatus: "SUCCEEDED", lastErrorCode: "EXTERNAL_UNKNOWN", finishedAt: EARLIER.toISOString() } });

// 2. 终态 CANCELLED + UNKNOWN（取消事实保留）
addCase("FS-A01-CANCELLED-UNKNOWN", "取消终态不被未知效果擦掉，也不显示成功完成", workState({
  status: "CANCELLED", cancelRequestedAt: "2026-11-02T09:00:00.000Z", finishedAt: EARLIER, lastErrorJson: { code: "EXTERNAL_UNKNOWN" },
}), { mission: { ...basePacketInput(workState({ status: "CANCELLED" })).mission, missionStatus: "CANCELLED", lastErrorCode: "EXTERNAL_UNKNOWN", finishedAt: EARLIER.toISOString(), cancelRequestedAt: "2026-11-02T09:00:00.000Z" } });

// 3. RUNNING + 停止请求在途（含旧 UNKNOWN 错误，仍以停止结算为主操作）
addCase("FS-A02-RUNNING-PAUSE-IN-FLIGHT", "RUNNING 收到暂停请求但未结算：显示请求在途，不出现继续派发建议", workState({
  status: "RUNNING", leaseUntil: LEASE_FUTURE, pauseRequestedAt: "2026-11-03T02:59:00.000Z", lastErrorJson: { code: "TOOL_UNKNOWN" },
}), { mission: { ...basePacketInput(workState({ status: "RUNNING" })).mission, missionStatus: "RUNNING", lastErrorCode: "TOOL_UNKNOWN", pauseRequestedAt: "2026-11-03T02:59:00.000Z" } });

// 4. RUNNING + 取消请求在途
addCase("FS-A02-RUNNING-CANCEL-IN-FLIGHT", "取消请求已收到但尚未结算，不得显示已取消或可恢复", workState({
  status: "RUNNING", leaseUntil: LEASE_FUTURE, cancelRequestedAt: "2026-11-03T02:59:30.000Z",
}), { mission: { ...basePacketInput(workState({ status: "RUNNING" })).mission, missionStatus: "RUNNING", cancelRequestedAt: "2026-11-03T02:59:30.000Z" } });

// 5. 暂停请求已结算
addCase("FS-A02-PAUSED-SETTLED", "暂停已结算：历史结果保留，恢复需重新核对条件", workState({
  status: "PAUSED", pauseRequestedAt: "2026-11-02T08:00:00.000Z", pauseReason: "USER",
}), { mission: { ...basePacketInput(workState({ status: "PAUSED" })).mission, missionStatus: "PAUSED", pauseRequestedAt: "2026-11-02T08:00:00.000Z", pauseReason: "USER" } });

// 6. 每日额度等待
addCase("FS-A03-DAILY-BUDGET-WAITING", "额度等待进入工作包：累计用量不清零，凭日期不放宽许可", workState({
  status: "READY", nextAttemptAt: NEXT_ATTEMPT, events: [{ id: "evt-budget", type: "DAILY_BUDGET_WAITING", payloadJson: { budgetRetained: true } }],
}));

// 7. 读取时间与成功观察时间分离
const stableState = workState({ status: "WAITING_INPUT", waitStateJson: { resolved: true, waitingFor: "OBSERVATION" }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-06T12:00:00.000Z" } }, NOW);
const laterState = workState({ status: "WAITING_INPUT", waitStateJson: { resolved: true, waitingFor: "OBSERVATION" }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-06T12:00:00.000Z" } }, new Date("2026-11-03T04:00:00.000Z"));
addCase("FS-A04-OBSERVATION-TIME-SEPARATED", "反复读取只推进 readAt/checkedAt，不推进 lastSuccessfulAt", laterState, {
  observations: { lastSuccessfulAt: OBSERVED_AT, lastFailedAt: null, lastNoNewInformationAt: "2026-11-01T08:00:00.000Z", nextCheckAt: null },
});
cases.push({
  id: "FS-A04-OBSERVATION-TIME-SEPARATED-COMPARE",
  question: "同一成功观察在两次读取中的时间对照",
  state: laterState,
  packet: basePacketInput(laterState, {
    observations: { lastSuccessfulAt: OBSERVED_AT, lastFailedAt: null, lastNoNewInformationAt: "2026-11-01T08:00:00.000Z", nextCheckAt: null },
  }),
});
// 上面这条对照用同一输入覆盖两个 readAt，写出时单独补 earlier 投影。
const earlierComparison = { readAt: NOW.toISOString(), workStateObservedAt: stableState.observedAt, workStateCheckedAt: stableState.checkedAt };
const laterComparison = { readAt: "2026-11-03T04:00:00.000Z", workStateObservedAt: laterState.observedAt, workStateCheckedAt: laterState.checkedAt };

// 8. 来源当前许可被抑制：历史留痕保留，当前不作独立证据
addCase("FS-A05-SOURCE-CURRENT-USE-SUPPRESSED", "availability=CURRENT 只表示版本匹配；当前许可被抑制时不得作为当前依据", workState({
  status: "READY",
}), { basis: { questionId: "q-1", materialUses: materialUses("SUPPRESSED"), evidenceReviews: null, currentUsePolicy: "SOURCE_POLICY_APPLIED" } });

// 9. 版本在读取期间推进且未收敛
addCase("FS-A07-SNAPSHOT-VERSION-ADVANCED", "版本推进未收敛时明确标记 VERSION_ADVANCED，提交前必须重新核对全版本", workState({
  status: "READY",
}), { snapshot: { consistency: "VERSION_ADVANCED", retries: 2, checkedAt: NOW.toISOString() } });

// 10. 无新事件但越过许可边界
addCase("FS-A07-TIME-BOUNDARY-CROSSED", "没有新事件但越过许可边界：权限过期，主操作变重核", workState({
  status: "READY",
  continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-03T02:00:00.000Z" },
}), {
  responsibility: {
    ...basePacketInput(workState({ status: "READY" })).responsibility,
    permissionState: "EXPIRED",
    permissionExpiresAt: "2026-11-03T02:00:00.000Z",
  },
});

// 11. 终态缺 finishedAt/updatedAt：NO_TIME
addCase("FS-A01-TERMINAL-NO-TIME", "终态无任何可用时间时 atSource=NO_TIME，不伪造时间", workState({
  status: "SUCCEEDED", updatedAt: null,
}), { mission: { ...basePacketInput(workState({ status: "SUCCEEDED" })).mission, missionStatus: "SUCCEEDED", finishedAt: null, updatedAt: null } });

function packetOf(entry: typeof cases[number]) {
  return buildMissionWorkPacket(entry.packet, NOW);
}

const files: string[] = [];
fs.mkdirSync(outDir, { recursive: true });
const index: Array<Record<string, unknown>> = [];
for (const entry of cases) {
  const state = entry.state;
  const packet = packetOf(entry);
  const payload = {
    contractVersion: WORK_PACKET_CONTRACT_VERSION,
    schemaVersion: WORK_PACKET_SCHEMA_VERSION,
    fixture: "PURE_FUNCTION_NO_DATABASE_NO_MODEL",
    generatedAt: new Date().toISOString(),
    caseId: entry.id,
    question: entry.question,
    workState: state,
    workPacket: packet,
  };
  const file = path.join(outDir, `${entry.id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  files.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
  index.push({
    caseId: entry.id,
    question: entry.question,
    file: path.relative(repoRoot, file).replaceAll("\\", "/"),
    phase: state.phase,
    reasonCode: state.reasonCode,
    terminal: state.terminal ?? null,
    unsettledEffectPresent: state.unsettledEffect?.present === true,
    stopRequestState: state.stopRequest?.state ?? null,
    primaryActionKind: packet.next.primaryAction?.kind ?? null,
    blockerKinds: [...new Set(packet.blockers.map(blocker => blocker.kind))],
    snapshotConsistency: packet.snapshot.consistency,
    observationState: packet.observations.state,
  });
}

// 观察时间对照单独成文件：同一成功观察、不同读取时刻。
const observationComparison = {
  fixture: "PURE_FUNCTION_NO_DATABASE_NO_MODEL",
  note: "readAt 与 workState.checkedAt 前进，lastSuccessfulAt 与 workState.observedAt 不变；读取不推进成功观察。",
  fixedLastSuccessfulAt: OBSERVED_AT,
  earlier: earlierComparison,
  later: laterComparison,
};
const comparisonFile = path.join(outDir, "FS-A04-OBSERVATION-TIME-COMPARE.json");
fs.writeFileSync(comparisonFile, JSON.stringify(observationComparison, null, 2) + "\n", "utf8");
files.push(path.relative(repoRoot, comparisonFile).replaceAll("\\", "/"));

let headSha = "UNKNOWN";
try {
  headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
} catch {
  /* 不在 git 树里时保留 UNKNOWN */
}
const indexPayload = {
  contractVersion: WORK_PACKET_CONTRACT_VERSION,
  schemaVersion: WORK_PACKET_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  baseSha: headSha,
  command: "npx.cmd tsx scripts/final-a/a1-contract-samples.ts",
  fixture: "PURE_FUNCTION_NO_DATABASE_NO_MODEL",
  note: "A1 纯函数真实序列化样本；不是服务层修复回执，服务级修复与并发证据见 A2/探针。",
  cases: index,
  files,
};
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(indexPayload, null, 2) + "\n", "utf8");
console.log(`[a1-contract-samples] 写入 ${files.length + 1} 个文件到 evidence/final-a/20261103/samples/a1-pure/`);
