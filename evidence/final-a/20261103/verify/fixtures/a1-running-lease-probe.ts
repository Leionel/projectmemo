/**
 * 独立验收观测：A1-HEAD（543162f）构建器对 RUNNING + LEASE_ACTIVE（无停止请求）的主操作。
 * 该行为不在 A1 task-1 的验收语句里，但作为“主操作是否误导继续派发”的补充观测记录；
 * 验证期间工作树出现了未提交的 workPacket.ts 修订（新增 WAIT_FOR_OBSERVATION），本探针只测 HEAD。
 * 纯函数，无数据库/模型/网络。在 A1-HEAD 干净 shadow 内运行（cwd = shadow）。
 */
import fs from "node:fs";
import path from "node:path";
import { buildMissionWorkPacket } from "@/lib/mission/workPacket";
import { missionWorkState } from "@/lib/mission/workState";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a1-running-lease-probe.ts <输出JSON绝对路径>");
const NOW = new Date("2026-11-03T04:00:00.000Z");
const base = { id: "obs-running", version: 5 };
const workState = missionWorkState({ ...base, status: "RUNNING", leaseUntil: new Date(+NOW + 60_000) } as never, NOW);
const packet = buildMissionWorkPacket({
  mission: {
    missionId: "obs-running", projectId: "obs-p", missionVersion: 5, missionStatus: "RUNNING",
    planRevision: 2, contextVersion: 2, constraintsVersion: 1, researchScopeVersion: 1,
  },
  workState,
  responsibility: { controlVersion: "c", permissionState: "WITHIN_TIME_BOUNDARY", workerPresence: "RECENT" },
}, NOW);
const evidence = {
  generatedAt: new Date().toISOString(),
  stage: "A1_HEAD_OBSERVATION_NOT_ACCEPTANCE",
  headCommit: "543162f9424659c00f3f2abdee4a43fe2189aabc",
  input: { status: "RUNNING", leaseActive: true, stopRequest: "NONE" },
  workState: {
    phase: workState.phase, reasonCode: workState.reasonCode, actionLabel: workState.actionLabel,
    stopRequest: workState.stopRequest, unsettledEffect: workState.unsettledEffect,
  },
  packet: {
    primaryActionKind: packet.next.primaryAction?.kind,
    primaryActionLabel: packet.next.primaryAction?.label,
    waitingOn: packet.next.waitingOn,
    target: packet.next.primaryAction?.target,
    isContinueOrResume: /继续|恢复/.test(packet.next.primaryAction?.label ?? ""),
  },
  note: "A1 task-1 未要求 RUNNING 非停止态主操作；HEAD 返回 RECHECK_AUTHORITY（不含继续/恢复）。验证期间工作树已出现未提交修订改为 WAIT_FOR_OBSERVATION（未提交、不在 A1 HEAD），需按最终 A1 修订复核。",
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, outPath, primaryActionKind: evidence.packet.primaryActionKind, label: evidence.packet.primaryActionLabel }));
