/**
 * 独立验收 fixture（A1 最终 HEAD 3a62dce / 代码 b243f62）：针对 A1 收尾补丁的三项纯合同语义。
 *
 * Lead 指定断言：
 * 1) RUNNING + 有效 lease：primaryAction=WAIT_FOR_OBSERVATION「查看委托进展（执行中）」、waitingOn=SYSTEM_WORKER；
 * 2) UNAVAILABLE + LEASE_UNCONFIRMED：WAIT_FOR_OBSERVATION「等待租约重新确认」，无 AUTHORITY blocker；
 * 3) 个人记忆边界越过：RECHECK_AUTHORITY + TIME_BOUNDARY/PERSONAL_MEMORY_BOUNDARY_PASSED + requires.boundaryAt=最早边界。
 *
 * 纯函数，无数据库/模型/网络；在最终 A1 HEAD 的 git archive shadow 内运行（cwd = shadow）：
 *   npx.cmd tsx <此文件> <输出JSON绝对路径>
 */
import fs from "node:fs";
import path from "node:path";
import { buildMissionWorkPacket, type WorkPacketInput } from "@/lib/mission/workPacket";
import { missionWorkState } from "@/lib/mission/workState";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a1-final-head-probe.ts <输出JSON绝对路径>");

const NOW = new Date("2026-11-03T04:00:00.000Z");
const checks: Array<Record<string, unknown>> = [];
function check(id: string, question: string, pass: boolean, observed: unknown) {
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed });
}
const missionFacts = {
  missionId: "final-head-m-1", projectId: "final-head-p-1",
  missionVersion: 6, missionStatus: "WAITING_INPUT",
  planRevision: 3, contextVersion: 4, constraintsVersion: 2, researchScopeVersion: 2,
};
const base = { id: missionFacts.missionId, version: missionFacts.missionVersion };
const ws = (extra: Record<string, unknown>, at: Date = NOW) => missionWorkState({ ...base, ...extra } as never, at);
const build = (input: Partial<WorkPacketInput>, at: Date = NOW) => buildMissionWorkPacket({
  mission: { ...missionFacts }, workState: ws({ status: "READY" }), ...input,
} as WorkPacketInput, at);

/* ---- 1) RUNNING + 有效 lease ---- */
const runningState = ws({ status: "RUNNING", leaseUntil: new Date(+NOW + 60_000) });
const runningPacket = build({
  mission: { ...missionFacts, missionStatus: "RUNNING" }, workState: runningState,
  responsibility: { controlVersion: "c-final", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "RECENT" },
});
// 用 string 拓宽避免对联合字面量直接连续比较；`=== WAIT_FOR_OBSERVATION` 已蕴含“不再是 RECHECK_AUTHORITY”，
// 因此不再重复写 `!== "RECHECK_AUTHORITY"`（等值窄化后该断言恒真，会触发 TS2367）。
const runningAction = runningPacket.next.primaryAction;
const runningKind: string = runningAction?.kind ?? "";
check("A1-FINAL-01", "RUNNING+有效 lease：主操作=查看委托进展（执行中），waitingOn=SYSTEM_WORKER，不再是 RECHECK_AUTHORITY",
  runningState.phase === "RUNNING" && runningState.reasonCode === "LEASE_ACTIVE"
  && runningKind === "WAIT_FOR_OBSERVATION"
  && runningAction?.label === "查看委托进展（执行中）"
  && runningPacket.next.waitingOn === "SYSTEM_WORKER"
  && !/继续|恢复/.test(runningAction?.label ?? "")
  && runningAction?.target?.kind === "MISSION"
  && runningAction?.target?.id === missionFacts.missionId,
  { workState: { phase: runningState.phase, reasonCode: runningState.reasonCode, actionLabel: runningState.actionLabel },
    primaryAction: runningPacket.next.primaryAction, waitingOn: runningPacket.next.waitingOn,
    blockers: runningPacket.blockers.map((b) => ({ kind: b.kind, code: b.code })) });

/* ---- 2) UNAVAILABLE + LEASE_UNCONFIRMED ---- */
const unavailableState = ws({ status: "RUNNING", leaseUntil: new Date(+NOW - 60_000) });
const unavailablePacket = build({
  mission: { ...missionFacts, missionStatus: "RUNNING" }, workState: unavailableState,
  responsibility: { controlVersion: "c-final", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "STALE" },
});
const unavailableKinds = unavailablePacket.blockers.map((b) => b.kind);
check("A1-FINAL-02", "UNAVAILABLE+LEASE_UNCONFIRMED：等待租约重新确认，不误标 AUTHORITY 重核",
  unavailableState.phase === "UNAVAILABLE" && unavailableState.reasonCode === "LEASE_UNCONFIRMED"
  && unavailablePacket.next.primaryAction?.kind === "WAIT_FOR_OBSERVATION"
  && unavailablePacket.next.primaryAction?.label === "等待租约重新确认"
  && unavailableKinds.includes("LEASE")
  && !unavailableKinds.includes("AUTHORITY"),
  { workState: { phase: unavailableState.phase, reasonCode: unavailableState.reasonCode, freshness: unavailableState.freshness },
    primaryAction: unavailablePacket.next.primaryAction, waitingOn: unavailablePacket.next.waitingOn,
    blockerKinds: unavailableKinds, blockers: unavailablePacket.blockers.map((b) => ({ kind: b.kind, code: b.code })) });

/* ---- 3) 个人记忆边界越过 ---- */
const boundaryAt = "2026-11-03T00:00:00.000Z";
const questionState = ws({
  status: "WAITING_INPUT",
  waitStateJson: { questionId: "q-final", question: "请补齐对照组", waitingFor: "USER" },
  continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-20T00:00:00.000Z" },
});
const boundaryPacket = build({
  workState: questionState,
  pendingOriginalRefs: { questionId: "q-final", approvals: [] },
  responsibility: {
    controlVersion: "c-final", permissionState: "WITHIN_TIME_BOUNDARY",
    permissionExpiresAt: "2026-11-10T00:00:00.000Z",
    personalMemoryNextBoundary: boundaryAt,
  },
});
const personalBlocker = boundaryPacket.blockers.find((b) => b.code === "PERSONAL_MEMORY_BOUNDARY_PASSED");
check("A1-FINAL-03", "个人记忆边界越过：RECHECK_AUTHORITY + TIME_BOUNDARY/PERSONAL_MEMORY_BOUNDARY_PASSED + requires.boundaryAt=最早边界",
  boundaryPacket.next.primaryAction?.kind === "RECHECK_AUTHORITY"
  && boundaryPacket.next.primaryAction?.label === "重新核对许可与期限"
  && boundaryPacket.blockers.some((b) => b.kind === "TIME_BOUNDARY" && b.code === "PERSONAL_MEMORY_BOUNDARY_PASSED")
  && personalBlocker?.at === boundaryAt
  && boundaryPacket.stopped.primaryBlock?.kind === "TIME_BOUNDARY"
  && boundaryPacket.next.primaryAction?.requires.boundaryAt === boundaryAt,
  { primaryAction: boundaryPacket.next.primaryAction,
    personalBlocker: personalBlocker ?? null,
    primaryBlock: boundaryPacket.stopped.primaryBlock ?? null,
    blockerKinds: boundaryPacket.blockers.map((b) => ({ kind: b.kind, code: b.code, at: b.at })) });

const failed = checks.filter((c) => c.verdict === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "INDEPENDENT_CONTRACT_PROBE_A1_FINAL_HEAD",
  runner: "evidence/final-a/20261103/verify/fixtures/a1-final-head-probe.ts",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "A1 final HEAD 3a62dce via git archive",
  env: { database: "none (pure functions)", modelProviderCalls: 0, network: 0 },
  summary: { total: checks.length, pass: checks.filter((c) => c.verdict === "PASS").length, fail: failed },
  checks,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: failed === 0, outPath, summary: evidence.summary }));
process.exit(failed === 0 ? 0 : 1);
