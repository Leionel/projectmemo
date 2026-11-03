/**
 * A2 真实序列化样本生成器（final-a-workpacket-v1）。
 *
 * 在独立临时 SQLite 上（按 prisma/migrations 顺序重放）造 12 种原委托状态，
 * 调用真实 readMissionBack 读取，并把真实 JSON 响应写到
 * evidence/final-a/20261103/samples/a2/。另附一份“旧服务缺增量字段”变体，
 * 供 C/D 验证旧后端降级：缺 workPacket 时退回原详情，不构造默认成功事实。
 *
 * 运行（仓库根目录）：
 *   npm.cmd exec -- tsx scripts/final-a/generate-samples.ts
 *
 * 边界：只用临时库；不调用模型、不发网络、不写真实库；样本里只有合成用户与合成项目，
 * 不含密钥或真实用户数据。退出码 0 = 样本全部生成；非零 = 脚本失败。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "evidence/final-a/20261103/samples/a2");
const command = "npm.cmd exec -- tsx scripts/final-a/generate-samples.ts";
const generatedAt = new Date().toISOString();
/** A2 样本基于 A1 最终态生成；baseSha/headSha 都记录生成时 HEAD，另标注 A1 合同与修复提交。 */
const headSha = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return "UNKNOWN"; }
})();
const baseSha = headSha;
const A1_CONTRACT_COMMIT = "f267aec674dbb9c28f6fa79bf428816016d2bee5";
const A1_FIX_COMMIT = "b243f62a2970ffc1bd070ba6c2933690c230d72f";

// 1) 独立临时库：必须在 import lib/db 之前设置 DATABASE_URL 等环境变量。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-final-a-samples-"));
const file = path.join(dir, "samples.db");
const databaseUrl = "file:" + file.replaceAll("\\", "/");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "false",
  FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false",
  LLM_MODE: "mock",
  WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
});
const sql = new Database(file);
sql.pragma("journal_mode = WAL");
for (const name of fs.readdirSync(path.join(repoRoot, "prisma/migrations")).sort()) {
  const migration = path.join(repoRoot, "prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();

const { db } = await import("@/lib/db");
const { readMissionBack } = await import("@/lib/mission/readback");
type PrismaLike = typeof db;
type Owner = { userId: string; projectId: string };

const json = (value: unknown) => value as never;
let counter = 0;
async function ownerProject(label: string): Promise<Owner> {
  counter += 1;
  const user = await db.user.create({ data: { username: `a2-sample-${label}-${counter}-${randomUUID().slice(0, 8)}`, displayName: `A2 样本 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: `A2 样本项目 ${label}`, description: "SYNTHETIC_FINAL_A_SAMPLE", goal: "生成四问工作包真实样本", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { userId: user.id, projectId: project.id };
}
async function createMissionRow(owner: Owner, overrides: Record<string, unknown> = {}) {
  const data = {
    projectId: owner.projectId, ownerUserId: owner.userId,
    createRequestId: `req-${randomUUID()}`, createPayloadHash: "synthetic-final-a-sample",
    goal: "核对四问工作包样本", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, researchScopeJson: {},
    continuationPolicyJson: { mode: "MANUAL" }, planJson: {}, budgetJson: {},
    ...overrides,
  } as never;
  return db.agentMission.create({ data });
}
async function addEvent(missionId: string, type: string, payload: unknown) {
  const mission = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: mission.nextEventSeq, type, payloadJson: json(payload) } });
}
function boundedPolicy(expiresAt: Date) {
  return { mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: expiresAt.toISOString(), checkEveryMinutes: 30,
    maxModels: 5, maxTools: 10, maxMetadataRequests: 5, dailyBurst: { maxModels: 2, maxTools: 4 }, allowedTools: ["inspect_project"],
    connectionIds: [], trackBranchHead: false, timezone: "Asia/Shanghai", quietStart: 22, quietEnd: 8, attention: "IMPORTANT_ONLY" };
}
const snapshotOf = async (missionId: string) => {
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  return { version: row.version, status: row.status, updatedAt: row.updatedAt.toISOString(), budgetUsedJson: row.budgetUsedJson };
};

type Scenario = { name: string; file: string; missionStatus: string; phaseHint: string; fixture: (owner: Owner) => Promise<{ mission: { id: string }; note: string }> };
const scenarios: Scenario[] = [
  { name: "运行", file: "a2-running.json", missionStatus: "RUNNING", phaseHint: "RUNNING",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "RUNNING", leaseUntil: new Date(Date.now() + 60_000) }); return { mission, note: "RUNNING + 有效 lease；读取不续租、不派发" }; } },
  { name: "排队", file: "a2-queued.json", missionStatus: "READY", phaseHint: "QUEUED",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "READY" }); return { mission, note: "READY，等待原委托执行" }; } },
  { name: "等待用户", file: "a2-waiting-user.json", missionStatus: "WAITING_INPUT", phaseHint: "WAITING_USER",
    fixture: async owner => {
      const mission = await createMissionRow(owner, { status: "WAITING_INPUT", waitStateJson: { questionId: "q-sample-user", question: "请补充同条件下的对照组指标", waitingFor: "USER", missing: "PRIVATE", resolved: false } });
      await addEvent(mission.id, "QUESTION", { question: "请补充同条件下的对照组指标" });
      return { mission, note: "原问题等待用户补充；主操作绑定原问题" };
    } },
  { name: "等待批准", file: "a2-waiting-approval.json", missionStatus: "WAITING_APPROVAL", phaseHint: "WAITING_APPROVAL",
    fixture: async owner => {
      const mission = await createMissionRow(owner, { status: "WAITING_APPROVAL" });
      const step = await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 1, planRevision: mission.planRevision, toolName: "propose_action", toolVersion: "1", canonicalInputJson: json({ title: "验证一次新实验" }), inputHash: "sample-approval", readSetJson: json([]), status: "WAITING_APPROVAL" } });
      await db.agentMissionApproval.create({ data: { missionId: mission.id, stepId: step.id, proposalHash: "b".repeat(64), proposalJson: json({ tool: "create_action", args: { title: "验证一次新实验" } }), expectedPlanRevision: mission.planRevision, readSetJson: json([]), status: "PENDING", expiresAt: new Date(Date.now() + 600_000) } });
      return { mission, note: "当前有效提案等待批准；过期批准不应生成审阅动作" };
    } },
  { name: "观察无变化", file: "a2-observation-no-change.json", missionStatus: "WAITING_INPUT", phaseHint: "WAITING_OBSERVATION",
    fixture: async owner => {
      const observedAt = new Date(Date.now() - 60_000);
      const mission = await createMissionRow(owner, { status: "WAITING_INPUT", planJson: { delegation: { lastObservedAt: observedAt.toISOString() } }, continuationPolicyJson: boundedPolicy(new Date(Date.now() + 3_600_000)), waitStateJson: { questionId: "q-sample-observation", resolved: true, waitingFor: "OBSERVATION" } });
      await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
      return { mission, note: "最近成功观察结论为无新变化；读取不推进成功观察时间" };
    } },
  { name: "失败", file: "a2-failed.json", missionStatus: "FAILED", phaseHint: "FAILED",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "FAILED", lastErrorJson: { code: "TOOL_FAILED", message: "这一步未完成，已保存进度", phase: "TOOL" } }); return { mission, note: "原步骤失败；不自动重试" }; } },
  { name: "停止请求中", file: "a2-stop-requested.json", missionStatus: "RUNNING", phaseHint: "RUNNING",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "RUNNING", leaseUntil: new Date(Date.now() + 60_000), pauseRequestedAt: new Date(Date.now() - 5_000) }); return { mission, note: "RUNNING 且已收到停止请求，尚未结算；不建议继续派发" }; } },
  { name: "已暂停", file: "a2-paused.json", missionStatus: "PAUSED", phaseHint: "PAUSED",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "PAUSED", pauseRequestedAt: new Date(Date.now() - 60_000), pauseReason: "USER" }); return { mission, note: "暂停请求已结算；恢复会重新核对条件" }; } },
  { name: "未知", file: "a2-unknown.json", missionStatus: "PAUSED", phaseHint: "UNKNOWN",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "PAUSED", lastErrorJson: { code: "TOOL_UNKNOWN", message: "原请求结果尚未结算" } }); return { mission, note: "原请求/外部效果未结算；读取只展示，不核销" }; } },
  { name: "取消", file: "a2-cancelled.json", missionStatus: "CANCELLED", phaseHint: "COMPLETED",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "CANCELLED", finishedAt: new Date(Date.now() - 30_000) }); return { mission, note: "原委托已取消；取消不显示成功完成" }; } },
  { name: "成功", file: "a2-succeeded.json", missionStatus: "SUCCEEDED", phaseHint: "COMPLETED",
    fixture: async owner => { const mission = await createMissionRow(owner, { status: "SUCCEEDED", finishedAt: new Date(Date.now() - 30_000) }); return { mission, note: "完成条件已通过；现实效果仍以原结果为准" }; } },
  { name: "额度等待", file: "a2-daily-budget-waiting.json", missionStatus: "READY", phaseHint: "QUEUED",
    fixture: async owner => {
      const nextAttemptAt = new Date(Date.now() + 3_600_000);
      const mission = await createMissionRow(owner, { status: "READY", nextAttemptAt, budgetUsedJson: { models: 3, tools: 2, searches: 1, inputTokens: 40, outputTokens: 12, unknownCalls: 1 } });
      await addEvent(mission.id, "DAILY_BUDGET_WAITING", { nextAttemptAt: nextAttemptAt.toISOString(), budgetRetained: true });
      return { mission, note: "今日额度用完；累计预算不清零，到下次检查时间再核对" };
    } },
];

/** 模拟旧服务响应：移除 final-a 增量字段，只留基线 readback 形状，供客户端降级验证。 */
const ADDITIVE_PATHS = [
  "workPacket", "readAt", "observation",
  "workState.terminal", "workState.unsettledEffect", "workState.stopRequest",
  "materialUses.items[].currentUse", "materialUses.items[].availabilityMeaning",
  "materialUses.coverage.eventsInspected", "materialUses.coverage.stepsInspected", "materialUses.coverage.outputsInspected",
  "materialUses.coverage.receiptsInspected", "materialUses.coverage.runLimit", "materialUses.coverage.runsInspected",
  "materialUses.coverage.runScope", "callCoverage.runScope",
];
function legacyVariant(readback: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(readback)) as Record<string, unknown>;
  delete clone.workPacket; delete clone.readAt; delete clone.observation;
  const workState = clone.workState as Record<string, unknown> | undefined;
  if (workState) { delete workState.terminal; delete workState.unsettledEffect; delete workState.stopRequest; }
  const materialUses = clone.materialUses as { items?: Array<Record<string, unknown>>; coverage?: Record<string, unknown> } | undefined;
  for (const item of materialUses?.items ?? []) { delete item.currentUse; delete item.availabilityMeaning; }
  if (materialUses?.coverage) for (const key of ["eventsInspected", "stepsInspected", "outputsInspected", "receiptsInspected", "runLimit", "runsInspected", "runScope"] as const) delete materialUses.coverage[key];
  const callCoverage = clone.callCoverage as Record<string, unknown> | undefined;
  if (callCoverage) delete callCoverage.runScope;
  return clone;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const written: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) {
    const owner = await ownerProject(scenario.file);
    const { mission, note } = await scenario.fixture(owner);
    const before = await snapshotOf(mission.id);
    const readback = await readMissionBack(owner.userId, mission.id);
    const after = await snapshotOf(mission.id);
    const payload = {
      sample: `a2-${scenario.file.replace(/^a2-|\.json$/g, "")}`,
      label: scenario.name,
      generatedAt, command, baseSha, headSha, a1ContractCommit: A1_CONTRACT_COMMIT, a1FixCommit: A1_FIX_COMMIT,
      contract: { contractVersion: readback.workPacket?.contractVersion ?? null, schemaVersion: readback.workPacket?.schemaVersion ?? null },
      environment: {
        database: "EPHEMERAL_TEMP_SQLITE（prisma/migrations 顺序重放，脚本结束删除）",
        modelCalls: "none（LLM_MODE=mock；readback 不调用模型）",
        workerPresence: readback.workPacket?.authority.workerPresence ?? "UNOBSERVED",
        data: "SYNTHETIC_ONLY（合成用户/合成项目，无真实用户数据）",
      },
      fixture: { missionStatus: scenario.missionStatus, expectedPhase: scenario.phaseHint, note },
      observed: {
        missionVersion: readback.missionVersion,
        missionStatus: readback.missionStatus,
        phase: readback.workState.phase,
        observationState: readback.observation.state,
        primaryAction: readback.workPacket?.next.primaryAction
          ? { kind: readback.workPacket.next.primaryAction.kind, label: readback.workPacket.next.primaryAction.label, waitingOn: readback.workPacket.next.waitingOn }
          : null,
        snapshotConsistency: readback.workPacket?.snapshot.consistency ?? null,
        readSideEffects: {
          missionVersionUnchanged: after.version === before.version,
          missionStatusUnchanged: after.status === before.status,
          budgetUsedJsonUnchanged: JSON.stringify(after.budgetUsedJson) === JSON.stringify(before.budgetUsedJson),
          updatedAtUnchanged: after.updatedAt === before.updatedAt,
        },
      },
      readback,
    };
    const target = path.join(outputDir, scenario.file);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
    written.push({ file: scenario.file, path: `evidence/final-a/20261103/samples/a2/${scenario.file}`, label: scenario.name, missionStatus: readback.missionStatus, phase: readback.workState.phase,
      primaryAction: payload.observed.primaryAction ? (payload.observed.primaryAction as { kind: string }).kind : null,
      observationState: readback.observation.state, bytes: fs.statSync(target).size });
  }
  // 旧服务变体：用“额度等待”样本移除全部增量字段，明确标注为模拟旧后端响应。
  const source = JSON.parse(fs.readFileSync(path.join(outputDir, "a2-daily-budget-waiting.json"), "utf8")) as { readback: Record<string, unknown> };
  const legacy = {
    sample: "a2-legacy-server-without-workpacket",
    label: "旧服务缺 workPacket 变体",
    generatedAt, command, baseSha, headSha, a1ContractCommit: A1_CONTRACT_COMMIT, a1FixCommit: A1_FIX_COMMIT,
    variant: "LEGACY_SERVER_WITHOUT_WORKPACKET",
    note: "由新服务真实响应移除下列增量字段得到，模拟旧后端/旧缓存；客户端缺 workPacket 时必须退回原详情，不得构造默认成功事实。",
    removedPaths: ADDITIVE_PATHS,
    readback: legacyVariant(source.readback),
  };
  const legacyFile = "a2-legacy-server-without-workpacket.json";
  fs.writeFileSync(path.join(outputDir, legacyFile), JSON.stringify(legacy, null, 2) + "\n", "utf8");
  written.push({ file: legacyFile, path: `evidence/final-a/20261103/samples/a2/${legacyFile}`, label: legacy.label, variant: legacy.variant, bytes: fs.statSync(path.join(outputDir, legacyFile)).size });
  const index = {
    generatedAt, command, baseSha, headSha, a1ContractCommit: A1_CONTRACT_COMMIT, a1FixCommit: A1_FIX_COMMIT,
    output: "evidence/final-a/20261103/samples/a2/",
    contractVersion: "final-a-workpacket-v1",
    note: "A2 readMissionBack 真实序列化样本；基于 A1-fix（b243f62）后重新生成：RUNNING+有效 lease 样本的 primaryAction 已变为 WAIT_FOR_OBSERVATION（查看委托进展（执行中））。合成隔离库；不含密钥/真实用户数据；与 probe-service 的 FS-A0x 样本分目录存放。",
    samples: written,
  };
  fs.writeFileSync(path.join(outputDir, "a2-index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`[samples] 已生成 ${written.length} 个真实样本 → ${path.relative(repoRoot, outputDir).replaceAll("\\", "/")}`);
  console.log(JSON.stringify(written, null, 2));
}

try {
  await main();
  await db.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
} catch (error) {
  console.error("[samples] 生成失败：", error);
  try { await db.$disconnect(); } catch { /* ignore */ }
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = 1;
}


