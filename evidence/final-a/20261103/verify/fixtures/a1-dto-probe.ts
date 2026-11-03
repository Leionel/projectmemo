/**
 * 独立验收 fixture（A1）——合同/DTO 抽查：四问覆盖、可选字段 vs 真实 null、旧服务降级、
 * primaryAction 原对象身份+全版本要求+readOnly、realityOutcome、NO_CHANGE 非生命周期。
 *
 * 纯函数，无数据库/无模型/无网络；在 A1-HEAD 干净 shadow 树内运行（cwd = shadow 根目录）：
 *   npx.cmd tsx <此文件> <输出JSON绝对路径>
 */
import fs from "node:fs";
import path from "node:path";
import { buildMissionWorkPacket, type WorkPacketInput } from "@/lib/mission/workPacket";
import { missionWorkState } from "@/lib/mission/workState";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a1-dto-probe.ts <输出JSON绝对路径>");

const NOW = new Date("2026-11-03T04:00:00.000Z");
const HASH = "b".repeat(64);
const checks: Array<Record<string, unknown>> = [];
function check(id: string, question: string, pass: boolean, observed: unknown, note?: string) {
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });
}

const missionFacts = {
  missionId: "verify-m-1", projectId: "verify-p-1",
  missionVersion: 9, missionStatus: "WAITING_INPUT",
  planRevision: 4, contextVersion: 5, constraintsVersion: 2, researchScopeVersion: 3,
};
const base = { id: missionFacts.missionId, version: missionFacts.missionVersion };
const ws = (extra: Record<string, unknown>, at: Date = NOW) => missionWorkState({ ...base, ...extra } as never, at);
const materialUses = {
  schemaVersion: 1 as const, questionId: "q-verify",
  items: [{
    sourcePointer: { id: "capture:verify-1", hash: HASH }, title: "项目记录",
    availability: "CURRENT" as const, facts: [{ kind: "SAVED" as const, refId: "capture:verify-1" }],
    coverage: null, bodyCoverage: "NOT_RECORDED" as const, excerpt: "原摘录",
    currentUse: { state: "ALLOWED" as const, independentEvidence: false, reason: "ORIGINAL_OBSERVATION", policy: "SOURCE_POLICY_APPLIED", checkedAt: NOW.toISOString(), appliesTo: "CURRENT_USE_ONLY" as const },
    availabilityMeaning: "CURRENT 只表示版本匹配，不等于当前允许使用或独立证据",
  }],
  coverage: {
    eventLimit: 80, eventsTruncated: false, stepLimit: 40, stepsTruncated: false,
    outputLimit: 20, outputsTruncated: false, receiptsTruncated: false, projectRunLimit: 40, runsTruncated: false,
    sourceLimit: 8, sourceLimitReached: false, mapping: "DIRECT_SOURCE_POINTERS_ONLY" as const,
  },
};
const baseInput = (overrides: Partial<WorkPacketInput> = {}): WorkPacketInput => ({
  mission: { ...missionFacts },
  workState: ws({ status: "WAITING_INPUT", waitStateJson: { questionId: "q-verify", question: "请补齐对照组", waitingFor: "USER" }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-20T00:00:00.000Z" } }),
  responsibility: {
    controlVersion: "control-verify-1", permissionState: "WITHIN_TIME_BOUNDARY",
    permissionExpiresAt: "2026-11-10T00:00:00.000Z", deadline: "2026-11-12T00:00:00.000Z",
    workerPresence: "RECENT", effectiveNextCheckAt: "2026-11-04T00:00:00.000Z",
    personalMemoryNextBoundary: "2026-11-03T12:00:00.000Z",
    budget: { limits: { models: 10, tools: 20 }, cumulativeUsed: { models: 3, tools: 5 }, policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE", monetaryCost: null },
  },
  observations: { lastSuccessfulAt: "2026-11-02T00:00:00.000Z", lastFailedAt: null, lastNoNewInformationAt: null, nextCheckAt: "2026-11-04T00:00:00.000Z" },
  work: {
    steps: Array.from({ length: 3 }, (_, i) => ({ id: `step-${i + 1}`, ordinal: i + 1, toolName: "search_project_memory", status: "SUCCEEDED", at: "2026-11-02T00:00:00.000Z" })),
    stepsLimit: 5,
    latestOutput: { id: "out-verify", revision: 2, createdAt: "2026-11-02T01:00:00.000Z" },
  },
  basis: { questionId: "q-verify", materialUses: materialUses as never, evidenceReviews: { items: [], truncated: false }, currentUsePolicy: "SOURCE_POLICY_APPLIED" },
  pendingOriginalRefs: { questionId: "q-verify", approvals: [] },
  coverage: { windows: [{ name: "RECENT_STEPS", limit: 5, returned: 3, truncated: false }] },
  snapshot: { consistency: "VERSION_STABLE", retries: 0, checkedAt: NOW.toISOString() },
  ...overrides,
});
const build = (overrides: Partial<WorkPacketInput> = {}, at: Date = NOW) => buildMissionWorkPacket(baseInput(overrides), at);

/* ---- DTO-01 四问覆盖 ---- */
const packet = build();
const questionKeys: Record<string, string[]> = {
  "done 已做了什么": Object.keys(packet.done),
  "basis 依据是什么": Object.keys(packet.basis),
  "stopped 为何停下": Object.keys(packet.stopped),
  "next 现在由谁做哪一步": Object.keys(packet.next),
};
check("A1-DTO-01", "四问 DTO 全部有值且可追溯到原事实字段",
  Object.keys(questionKeys).length === 4
  && Array.isArray(packet.done.recentSteps) && packet.done.recentSteps.length === 3
  && packet.done.latestOutput?.id === "out-verify"
  && packet.basis.materialUses?.items[0]?.sourcePointer.id === "capture:verify-1"
  && (packet.stopped.workState as unknown as { phase?: string }).phase === "WAITING_USER"
  && packet.stopped.unknownEffect === null
  && packet.next.primaryAction !== null
  && packet.identity.missionId === "verify-m-1" && packet.identity.originalRef.version === 9
  && packet.snapshot.mode === "SINGLE_READ_TRANSACTION"
  && packet.coverage.policy === "NOT_FOUND_IS_NOT_NEVER"
  && packet.authority.note === "VIEW_ONLY_NO_EXECUTION_PERMISSION",
  { questionKeys, identity: packet.identity, snapshot: packet.snapshot, contractVersion: packet.contractVersion });

/* ---- DTO-02 可选字段 vs 真实 null + 旧服务降级 ---- */
const minimal = buildMissionWorkPacket({ mission: { ...missionFacts, missionStatus: "READY" }, workState: ws({ status: "READY" }) }, NOW);
const observationsJson = JSON.parse(JSON.stringify(minimal.observations)) as Record<string, unknown>;
const legacyWorkState = {
  phase: "UNKNOWN", nextActor: "SYSTEM", requiresUser: false, reasonCode: "WAIT_CONDITION_UNKNOWN",
  reasonText: "等待条件需核对", actionLabel: "核对当前状态",
  originalRef: { kind: "MISSION", id: "verify-m-1", version: 9 },
  exactQuestionRef: null, exactApprovalRef: null, checkedAt: NOW.toISOString(), observedAt: null,
  nextCheckAt: null, nextBoundary: null, freshness: "PARTIAL",
} as unknown as WorkPacketInput["workState"];
const legacyPacket = buildMissionWorkPacket({
  mission: { ...missionFacts, missionStatus: "SUCCEEDED", lastErrorCode: "EXTERNAL_UNKNOWN" },
  workState: legacyWorkState,
}, NOW);
const legacyReadback: { missionId: string; workState: unknown; realityOutcome: "NOT_INFERRED"; workPacket?: unknown } = {
  missionId: "verify-m-1", workState: null, realityOutcome: "NOT_INFERRED",
};
check("A1-DTO-02", "真实 null 显式存在、可选增量缺失不伪造默认成功、旧 WorkState 可降级",
  Object.prototype.hasOwnProperty.call(observationsJson, "lastSuccessfulAt") && observationsJson.lastSuccessfulAt === null
  && observationsJson.lastFailedAt === null && observationsJson.lastNoNewInformationAt === null
  && observationsJson.nextCheckAt === null
  && minimal.done.latestOutput === null && minimal.basis.materialUses === null
  && legacyReadback.workPacket === undefined
  && (legacyPacket.stopped.workState as unknown as { terminal?: unknown }).terminal === undefined
  && legacyPacket.stopped.unknownEffect?.present === true
  && legacyPacket.next.primaryAction?.kind === "CHECK_UNKNOWN_EFFECT",
  { observationsJson, minimalDone: minimal.done, legacyPacket: { unknownEffect: legacyPacket.stopped.unknownEffect, primaryActionKind: legacyPacket.next.primaryAction?.kind, terminalInLegacyWorkState: (legacyPacket.stopped.workState as unknown as { terminal?: unknown }).terminal } });

/* ---- DTO-03 primaryAction 原对象身份 + 全版本要求 + readOnly ---- */
const questionAction = packet.next.primaryAction!;
const stopState = ws({ status: "RUNNING", leaseUntil: new Date(+NOW + 60_000), pauseRequestedAt: new Date(+NOW - 60_000) });
const stopPacket = buildMissionWorkPacket({
  mission: { ...missionFacts, missionStatus: "RUNNING" }, workState: stopState,
  responsibility: { controlVersion: "control-verify-1", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "RECENT" },
}, NOW);
const stopAction = stopPacket.next.primaryAction!;
const expectedRequiresKeys = ["missionVersion", "planRevision", "contextVersion", "constraintsVersion", "researchScopeVersion", "controlVersion", "questionId", "approvalId", "proposalHash", "requiredSourceRevisions", "boundaryAt"];
check("A1-DTO-03", "primaryAction 指向原对象、携带全量版本要求与 readOnly、提交由服务端重查",
  questionAction.kind === "ANSWER_QUESTION"
  && questionAction.target?.kind === "QUESTION" && questionAction.target.id === "q-verify"
  && questionAction.readOnly === true
  && questionAction.submissionGuard === "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY"
  && expectedRequiresKeys.every((key) => Object.prototype.hasOwnProperty.call(questionAction.requires, key))
  && questionAction.requires.missionVersion === missionFacts.missionVersion
  && questionAction.requires.planRevision === missionFacts.planRevision
  && questionAction.requires.contextVersion === missionFacts.contextVersion
  && questionAction.requires.constraintsVersion === missionFacts.constraintsVersion
  && questionAction.requires.researchScopeVersion === missionFacts.researchScopeVersion
  && questionAction.requires.controlVersion === "control-verify-1"
  && questionAction.requires.questionId === "q-verify"
  && stopAction.kind === "CHECK_STOP_SETTLEMENT" && stopAction.target?.kind === "MISSION" && stopAction.target.id === "verify-m-1"
  && !String(stopAction.label).includes("继续") && !String(stopAction.label).includes("恢复"),
  { questionAction, stopAction });

/* ---- DTO-04 realityOutcome 恒为 NOT_INFERRED + 未结算 UNKNOWN 不被推断完成 ---- */
const stateCases: Array<[string, WorkPacketInput]> = [
  ["SUCCEEDED+UNKNOWN", baseInput({ mission: { ...missionFacts, missionStatus: "SUCCEEDED" }, workState: ws({ status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN" } }) })],
  ["CANCELLED", baseInput({ mission: { ...missionFacts, missionStatus: "CANCELLED" }, workState: ws({ status: "CANCELLED", cancelRequestedAt: new Date(+NOW - 60_000) }) })],
  ["WAITING_USER", baseInput()],
  ["RUNNING_STOP", baseInput({ mission: { ...missionFacts, missionStatus: "RUNNING" }, workState: stopState })],
  ["FAILED", baseInput({ mission: { ...missionFacts, missionStatus: "FAILED" }, workState: ws({ status: "FAILED", lastErrorJson: { code: "TOOL_FAILED" } }) })],
  ["QUEUED_BUDGET", baseInput({ mission: { ...missionFacts, missionStatus: "READY" }, workState: ws({ status: "READY", events: [{ id: "e", type: "DAILY_BUDGET_WAITING", payloadJson: {} }], nextAttemptAt: new Date(+NOW + 3_600_000) }) })],
];
const outcomes = stateCases.map(([name, input]) => ({ name, realityOutcome: buildMissionWorkPacket(input, NOW).realityOutcome }));
check("A1-DTO-04", "所有状态的 realityOutcome 都是 NOT_INFERRED（不推断现实完成）",
  outcomes.every((item) => item.realityOutcome === "NOT_INFERRED"),
  { outcomes });

/* ---- DTO-05 NO_CHANGE 不是生命周期 ---- */
const observedWaitInput = baseInput({
  mission: { ...missionFacts, missionStatus: "WAITING_INPUT" },
  workState: ws({ status: "WAITING_INPUT", waitStateJson: { waitingFor: "OBSERVATION" }, planJson: { delegation: { lastObservedAt: "2026-11-02T00:00:00.000Z" } }, continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-20T00:00:00.000Z" } }),
  observations: { lastSuccessfulAt: "2026-11-02T00:00:00.000Z", lastFailedAt: null, lastNoNewInformationAt: "2026-11-02T00:00:00.000Z", nextCheckAt: "2026-11-04T00:00:00.000Z" },
});
const noChangePacket = buildMissionWorkPacket(observedWaitInput, NOW);
const failedLastPacket = buildMissionWorkPacket(baseInput({
  observations: { lastSuccessfulAt: "2026-11-02T00:00:00.000Z", lastFailedAt: "2026-11-03T00:00:00.000Z", lastNoNewInformationAt: "2026-11-02T00:00:00.000Z", nextCheckAt: "2026-11-04T00:00:00.000Z" },
}), NOW);
const workStatePhases = new Set(["QUEUED", "RUNNING", "WAITING_OBSERVATION", "WAITING_USER", "WAITING_APPROVAL", "PAUSED", "FAILED", "UNKNOWN", "COMPLETED", "UNAVAILABLE"]);
check("A1-DTO-05", "NO_CHANGE 仅是成功观察结论，不是生命周期；失败/未观察不显示无变化",
  noChangePacket.observations.state === "OBSERVED"
  && (noChangePacket.stopped.workState as unknown as { phase?: string }).phase === "WAITING_OBSERVATION"
  && !workStatePhases.has("NO_CHANGE")
  && noChangePacket.done.note.includes("无新变化") && noChangePacket.done.note.includes("不是委托生命周期")
  && failedLastPacket.observations.state === "FAILED_LAST"
  && !failedLastPacket.next.note.includes("未发现新变化") && !failedLastPacket.done.note.includes("无新变化"),
  {
    noChangeObservations: noChangePacket.observations,
    noChangeWorkStatePhase: (noChangePacket.stopped.workState as unknown as { phase?: string }).phase,
    noChangeDoneNote: noChangePacket.done.note,
    failedLastObservations: failedLastPacket.observations,
    failedLastNote: failedLastPacket.next.note,
  });

/* ---------- 写证据 ---------- */
const failed = checks.filter((item) => item.verdict === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "INDEPENDENT_CONTRACT_PROBE_A1",
  runner: "evidence/final-a/20261103/verify/fixtures/a1-dto-probe.ts",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "A1-HEAD clean shadow (git archive 543162f)",
  env: { database: "none (pure functions)", modelProviderCalls: 0, network: 0 },
  summary: { total: checks.length, pass: checks.filter((c) => c.verdict === "PASS").length, fail: failed },
  checks,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: failed === 0, outPath, summary: evidence.summary }));
process.exit(failed === 0 ? 0 : 1);
