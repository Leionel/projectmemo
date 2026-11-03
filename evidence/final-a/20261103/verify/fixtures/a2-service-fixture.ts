/**
 * 独立验收 fixture（A2）：四问工作包只读服务 + 负例 + 零副作用 + FS-A03/04/05/06/07 + A1-RESIDUAL-01。
 *
 * 运行（必须在 A2 最终 HEAD 的干净 shadow 内，cwd = shadow 根目录）：
 *   npx.cmd tsx verify-fixtures/a2-service-fixture.ts <输出JSON绝对路径>
 *
 * 隔离：top-level 只 import node 内建 + better-sqlite3；先 mkdtemp 建临时 SQLite、WAL、
 * 按序重放 prisma/migrations，设置 DATABASE_URL 等 env，之后才动态 import lib/。
 * 不读 .env、不碰真实库、LLM_MODE=mock、无模型/网络/外部写入。
 * 该文件全部断言由独立验收编写，不复用实现者测试断言。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx a2-service-fixture.ts <输出JSON绝对路径>");

/* ---------- 1) 独立临时库（必须在 import lib/db 之前） ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-a2-verify-"));
const dbFile = path.join(dir, "verify.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"),
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "false", FOCUS_CONTINUITY_ENABLED: "true",
  FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false",
  LLM_MODE: "mock", WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
});
const sql = new Database(dbFile);
sql.pragma("journal_mode = WAL");
const migrationNames = fs.readdirSync("prisma/migrations").sort();
for (const name of migrationNames) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
const schemaTables = (sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
sql.close();

/* ---------- 2) 动态 import ---------- */
const { db } = await import("@/lib/db");
const { readMissionBack } = await import("@/lib/mission/readback");
const { missionDetail } = await import("@/lib/mission/missionService");
const { missionWorkspaceSummary } = await import("@/lib/mission/workspaceSummary");
const { validateSources } = await import("@/lib/mission/repository");
const { sourceUse } = await import("@/lib/continuity/sourcePolicy");
const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
const { createSession } = await import("@/lib/auth/session");
const { createConversation } = await import("@/lib/conversation/service");
const { submitDirective } = await import("@/lib/continuity/directiveService");
const { jsonHash } = await import("@/lib/mission/contracts");
const { GET: readbackGet } = await import("@/app/api/missions/[id]/readback/route");

/* ---------- 3) 检查记录 ---------- */
type Check = { id: string; question: string; verdict: "PASS" | "FAIL" | "NOT_RUN"; observed: unknown; note?: string };
const checks: Check[] = [];
function check(id: string, question: string, pass: boolean, observed: unknown, note?: string) {
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wsFacts = (ws: Record<string, unknown>) => ({
  phase: ws.phase, nextActor: ws.nextActor, requiresUser: ws.requiresUser, reasonCode: ws.reasonCode,
  reasonText: ws.reasonText, actionLabel: ws.actionLabel, observedAt: ws.observedAt, checkedAt: ws.checkedAt,
  nextCheckAt: ws.nextCheckAt, nextBoundary: ws.nextBoundary, terminal: ws.terminal ?? null,
  unsettledEffect: ws.unsettledEffect ?? null, stopRequest: ws.stopRequest ?? null,
});
const packetBrief = (packet: Record<string, unknown> | undefined | null) => packet ? {
  contractVersion: packet.contractVersion, schemaVersion: packet.schemaVersion, readAt: packet.readAt,
  identity: packet.identity, snapshot: packet.snapshot, realityOutcome: packet.realityOutcome,
  observationsState: (packet.observations as { state?: string } | undefined)?.state,
  primaryAction: (packet.next as { primaryAction?: unknown } | undefined)?.primaryAction,
  coveragePolicy: (packet.coverage as { policy?: string } | undefined)?.policy,
  blockerCodes: (packet.blockers as Array<{ kind: string; code: string }> | undefined)?.map((b) => `${b.kind}:${b.code}`),
} : null;

/* ---------- 4) fixture 基础 ---------- */
const DEFAULT_BUDGET = {
  models: 12, tools: 16, searches: 3, fetches: 4, browserRequests: 40, browserBytes: 4_000_000,
  calendarRequests: 8, externalWrites: 2, activeMs: 180_000, reservedOutputTokens: 12_000,
};
type Owner = { userId: string; projectId: string };
async function createOwner(label: string, title = `独立验收 A2 ${label}`, scenario = "RESEARCH"): Promise<Owner> {
  const user = await db.user.create({ data: { username: `a2-verify-${label}-${randomUUID()}`, displayName: `A2 验收 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: { title, description: "SYNTHETIC_A2_VERIFY", goal: "验证 A2 四问工作包", scenario: scenario as never, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { userId: user.id, projectId: project.id };
}
async function createMission(owner: Owner, overrides: Record<string, unknown> = {}) {
  return db.agentMission.create({
    data: {
      ownerUserId: owner.userId, projectId: owner.projectId,
      createRequestId: `a2-verify-${randomUUID()}`, createPayloadHash: `hash-${randomUUID()}`,
      goal: "独立验收委托：四问工作包", successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {},
      researchScopeJson: {}, continuationPolicyJson: { mode: "MANUAL" }, planJson: {},
      budgetJson: DEFAULT_BUDGET, ...overrides,
    },
  });
}
async function addEvent(missionId: string, type: string, payload: unknown) {
  const mission = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: mission.nextEventSeq, type, payloadJson: payload as never } });
}
async function addStep(input: { missionId: string; ordinal: number; toolName?: string; status?: string; resultJson?: unknown }) {
  return db.agentMissionStep.create({
    data: {
      missionId: input.missionId, ordinal: input.ordinal, planRevision: 1,
      toolName: input.toolName ?? "search_project_memory", status: input.status ?? "SUCCEEDED",
      canonicalInputJson: {}, inputHash: `hash-${randomUUID()}`, readSetJson: [],
      resultJson: (input.resultJson ?? { data: {}, sources: [] }) as never, finishedAt: new Date(),
    },
  });
}
async function addOutput(input: { missionId: string; revision: number; claimChecksJson?: unknown }) {
  return db.agentMissionOutput.create({
    data: { missionId: input.missionId, revision: input.revision, kind: "RESEARCH", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: (input.claimChecksJson ?? []) as never },
  });
}
async function addAgentRun(input: { projectId: string; trace: unknown; createdAt?: Date }) {
  return db.agentRun.create({
    data: { projectId: input.projectId, runType: "CHAT", status: "SUCCESS", provider: "A2_VERIFY_FIXTURE", trace: input.trace as never, ...(input.createdAt ? { createdAt: input.createdAt } : {}) },
  });
}
async function materialScenario(label: string, sourceType?: string) {
  const owner = await createOwner(`mat-${label}`);
  const text = `2026-10-30 ${label} 原始记录：演示环境启动日志需现场核对，安装自报不等于启动成功。`;
  const capture = await db.capture.create({ data: { projectId: owner.projectId, rawText: text, ...(sourceType ? { sourceType } : {}) } });
  const source = await readProjectMaterial(owner.projectId, `capture:${capture.id}`);
  if (!source) throw new Error(`readProjectMaterial 失败：capture:${capture.id}`);
  const pointer = { id: source.id, hash: source.hash };
  const mission = await createMission(owner, { status: "WAITING_INPUT", version: 2 });
  const question = await addEvent(mission.id, "QUESTION", { question: `请补充 ${label} 的原始对照记录`, requirements: { sourceType: "EITHER" } });
  const step = await addStep({
    missionId: mission.id, ordinal: 1, toolName: "bind_project_sources",
    resultJson: {
      data: { questionId: question.id },
      sources: [{ id: pointer.id, kind: "PROJECT", entityType: "CAPTURE", revision: pointer.hash, hash: pointer.hash, text: source.text, observedAt: new Date().toISOString() }],
    },
  });
  await addEvent(mission.id, "SOURCE_ARRIVED", { questionId: question.id, sourcePointer: pointer, readable: true });
  await addEvent(mission.id, "SOURCE_ASSOCIATED", { questionId: question.id, pointers: [pointer] });
  return { owner, missionId: mission.id, questionId: question.id, pointer, stepId: step.id, captureId: capture.id, text };
}
async function expectError(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { rejected: false };
  } catch (error) {
    const e = error as { code?: string; status?: number; message?: string };
    return { rejected: true, code: e.code ?? null, status: e.status ?? null, message: e.message ?? String(error) };
  }
}
const missionSnapshot = async (id: string) => {
  const m = await db.agentMission.findUniqueOrThrow({ where: { id } });
  return plain({
    id: m.id, version: m.version, status: m.status, planRevision: m.planRevision, contextVersion: m.contextVersion,
    constraintsVersion: m.constraintsVersion, researchScopeVersion: m.researchScopeVersion,
    budgetUsedJson: m.budgetUsedJson, lastErrorJson: m.lastErrorJson, waitStateJson: m.waitStateJson,
    updatedAt: m.updatedAt, pauseRequestedAt: m.pauseRequestedAt, cancelRequestedAt: m.cancelRequestedAt,
  });
};

/* ================================================================
 * 1) 正常 workPacket：四问 + 身份/版本/快照 + 观察 + 覆盖
 * ================================================================ */
const owner1 = await createOwner("normal");
const capture1 = await db.capture.create({ data: { projectId: owner1.projectId, rawText: "10月推理显存6.2GB，用户提供的实验记录", sourceType: "实验记录" } });
const source1 = (await readProjectMaterial(owner1.projectId, `capture:${capture1.id}`))!;
const pointer1 = { id: source1.id, hash: source1.hash };
const LAST_OBSERVED = new Date(Date.now() - 2 * 24 * 3600 * 1000);
const m1 = await createMission(owner1, {
  status: "WAITING_INPUT", version: 2, budgetUsedJson: { models: 5, tools: 2, inputTokens: 900, outputTokens: 120, unknownCalls: 1 },
  waitStateJson: { questionId: "to-be-refreshed", question: "请补充同条件下的对照组指标", waitingFor: "USER" },
  planJson: { delegation: { lastObservedAt: LAST_OBSERVED.toISOString() } },
});
const q1 = await addEvent(m1.id, "QUESTION", { question: "请补充同条件下的对照组指标" });
await db.agentMission.update({ where: { id: m1.id }, data: { waitStateJson: { questionId: q1.id, question: "请补充同条件下的对照组指标", waitingFor: "USER" } } });
await addStep({
  missionId: m1.id, ordinal: 1, toolName: "bind_project_sources",
  resultJson: { data: { questionId: q1.id }, sources: [{ id: pointer1.id, kind: "PROJECT", entityType: "CAPTURE", revision: pointer1.hash, hash: pointer1.hash, text: source1.text, observedAt: LAST_OBSERVED.toISOString() }] },
});
await addEvent(m1.id, "SOURCE_ARRIVED", { questionId: q1.id, sourcePointer: pointer1, readable: true });
await addEvent(m1.id, "SOURCE_ASSOCIATED", { questionId: q1.id, pointers: [pointer1] });
const out1 = await addOutput({ missionId: m1.id, revision: 1, claimChecksJson: [{ status: "ENTAILS", claimId: "claim-1" }] });
const m1Row = await db.agentMission.findUniqueOrThrow({ where: { id: m1.id } });
const rb1 = await readMissionBack(owner1.userId, m1.id, { questionId: q1.id });
const p1 = rb1.workPacket as unknown as Record<string, unknown> | undefined;
const ident1 = p1?.identity as Record<string, unknown> | undefined;
const requires1 = (p1?.next as { primaryAction?: { requires?: Record<string, unknown> } } | undefined)?.primaryAction?.requires;
const snapshot1 = p1?.snapshot as Record<string, unknown> | undefined;
const observations1 = p1?.observations as Record<string, unknown> | undefined;
const authority1 = p1?.authority as Record<string, unknown> | undefined;
const coverage1 = p1?.coverage as Record<string, unknown> | undefined;
const done1 = p1?.done as { recentSteps?: Array<{ id: string }>; latestOutput?: { id: string } } | undefined;
const basis1 = p1?.basis as Record<string, unknown> | undefined;
const next1 = p1?.next as { primaryAction?: Record<string, unknown>; waitingOn?: string } | undefined;

check("A2-IND-WP-01", "四问工作包存在且契约字段完整（final-a-workpacket-v1）",
  !!p1 && p1.contractVersion === "final-a-workpacket-v1" && p1.schemaVersion === 1
  && !!p1.done && !!p1.basis && !!p1.stopped && !!p1.next && Array.isArray(p1.blockers)
  && coverage1?.policy === "NOT_FOUND_IS_NOT_NEVER" && p1.realityOutcome === "NOT_INFERRED",
  { packet: packetBrief(p1), doneRecentSteps: done1?.recentSteps?.map((s) => s.id) ?? null, latestOutput: done1?.latestOutput ?? null });

check("A2-IND-WP-02", "身份与版本同快照：readback/workPacket/identity/requires 的 missionVersion 全部一致",
  !!ident1 && ident1.missionId === m1.id && ident1.projectId === owner1.projectId
  && ident1.missionVersion === rb1.missionVersion && ident1.missionVersion === m1Row.version
  && (ident1.originalRef as { version?: number } | undefined)?.version === rb1.missionVersion
  && (p1?.stopped as { workState?: { originalRef?: { version?: number } } } | undefined)?.workState?.originalRef?.version === rb1.missionVersion
  && requires1?.missionVersion === ident1.missionVersion
  && ident1.planRevision === m1Row.planRevision && ident1.contextVersion === m1Row.contextVersion
  && ident1.constraintsVersion === m1Row.constraintsVersion && ident1.researchScopeVersion === m1Row.researchScopeVersion
  && ident1.missionStatus === rb1.missionStatus,
  { identity: ident1, readbackVersion: rb1.missionVersion, dbVersion: m1Row.version });

check("A2-IND-WP-03", "四问内容指向原对象：done 有原步骤/草稿，basis 指向原问题+材料，next 是回答原问题",
  done1?.recentSteps?.some((s) => s.id) === true && done1?.latestOutput?.id === out1.id
  && basis1?.questionId === q1.id && (basis1?.materialUses as { items?: unknown[] } | undefined)?.items?.length === 1
  && next1?.primaryAction?.kind === "ANSWER_QUESTION"
  && (next1?.primaryAction?.target as { kind?: string; id?: string } | undefined)?.kind === "QUESTION"
  && (next1?.primaryAction?.target as { id?: string } | undefined)?.id === q1.id
  && next1?.waitingOn === "USER_INPUT",
  { done: done1, basisQuestionId: basis1?.questionId, next: next1, materialUsesCoverage: (basis1?.materialUses as { coverage?: unknown } | undefined)?.coverage });

check("A2-IND-WP-04", "primaryAction 只读 + 全量版本要求 + 服务端重查守卫；controlVersion/边界同源",
  !!next1?.primaryAction && next1.primaryAction.readOnly === true
  && next1.primaryAction.submissionGuard === "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY"
  && requires1?.controlVersion === ident1?.controlVersion && requires1?.controlVersion === authority1?.controlVersion
  && requires1?.approvalId === null && requires1?.proposalHash === null
  && Array.isArray(requires1?.requiredSourceRevisions) && (requires1.requiredSourceRevisions as string[]).includes(`${pointer1.id}@${pointer1.hash}`)
  && requires1?.boundaryAt === authority1?.nextBoundary,
  { primaryAction: next1?.primaryAction, requires: requires1, controlVersionIdentity: ident1?.controlVersion, authority: authority1 });

check("A2-IND-WP-05", "读取时间语义：readAt=observedAt=readback.observedAt=工作包 readAt=observation.readAt；快照单事务",
  typeof rb1.readAt === "string" && rb1.readAt === rb1.observedAt
  && p1?.readAt === rb1.readAt && observations1?.readAt === rb1.readAt
  && snapshot1?.mode === "SINGLE_READ_TRANSACTION"
  && snapshot1?.checkedAt === rb1.readAt
  && ["VERSION_STABLE", "RETRIED", "VERSION_ADVANCED"].includes(String(snapshot1?.consistency)),
  { readAt: rb1.readAt, readbackObservedAt: rb1.observedAt, packetReadAt: p1?.readAt, observations: packetBrief(p1)?.identity, snapshot: snapshot1 });

check("A2-IND-WP-06", "观察分离：lastSuccessfulAt 来自原委托观察记录，lastFailedAt/lastNoNewInformationAt 为真实 null",
  observations1?.state === "OBSERVED"
  && observations1?.lastSuccessfulAt === LAST_OBSERVED.toISOString()
  && observations1?.lastFailedAt === null && observations1?.lastNoNewInformationAt === null
  && observations1?.authority === "ORIGINAL_DELEGATION_RECORDS_ONLY"
  && Object.prototype.hasOwnProperty.call(observations1, "lastSuccessfulAt"),
  { observations: observations1 });

check("A2-IND-WP-07", "覆盖窗口齐全且注明有界；材料使用窗口为 Mission-first（runScope=MISSION_FILTERED）",
  Array.isArray((coverage1?.windows as unknown[] | undefined)) && (coverage1?.windows as Array<{ name: string }>).length >= 6
  && (coverage1?.windows as Array<{ name: string; note?: string }>).every((w) => typeof w.note === "string" && w.note.length > 0)
  && ((basis1?.materialUses as { coverage?: { runScope?: string; runLimit?: number } } | undefined)?.coverage?.runScope === "MISSION_FILTERED")
  && (basis1?.materialUses as { coverage?: { runLimit?: number } } | undefined)?.coverage?.runLimit === 40,
  { coverage: coverage1, materialUsesCoverage: (basis1?.materialUses as { coverage?: unknown } | undefined)?.coverage });

/* ================================================================
 * 2) 负例：异 Owner / 成员 / 异项目 target / 旧 target 404/409 / 匿名 401
 * ================================================================ */
const owner2 = await createOwner("other-owner");
const member = await db.user.create({ data: { username: `a2-verify-member-${randomUUID()}`, displayName: "成员", passwordHash: "unused" } });
await db.projectMembership.create({ data: { projectId: owner1.projectId, userId: member.id, role: "MEMBER" } });
const otherMission = await createMission(owner2, { status: "READY" });
const otherQuestion = await addEvent(otherMission.id, "QUESTION", { question: "另一个项目的问题" });
const otherOutput = await addOutput({ missionId: otherMission.id, revision: 1 });

const negOtherOwner = await expectError(() => readMissionBack(owner2.userId, m1.id));
const negMember = await expectError(() => readMissionBack(member.id, m1.id));
const negCrossProjectQuestion = await expectError(() => readMissionBack(owner1.userId, m1.id, { questionId: otherQuestion.id }));
const negCrossProjectOutput = await expectError(() => readMissionBack(owner1.userId, m1.id, { outputId: otherOutput.id, revision: 1 }));
const negMissingApproval = await expectError(() => readMissionBack(owner1.userId, m1.id, { approvalId: "nonexistent-approval" }));
const negMissingReceipt = await expectError(() => readMissionBack(owner1.userId, m1.id, { receiptId: "nonexistent-receipt" }));
check("A2-IND-NEG-01", "异 Owner / 非 OWNER 成员读取拒绝（404，不泄漏委托内容）",
  negOtherOwner.rejected && negOtherOwner.status === 404 && negOtherOwner.code === "MISSION_NOT_FOUND"
  && negMember.rejected && negMember.status === 404,
  { otherOwner: negOtherOwner, member: negMember });

check("A2-IND-NEG-02", "跨项目/不存在的原问题或成果 target 返回 404，不改为另一对象",
  negCrossProjectQuestion.rejected && negCrossProjectQuestion.status === 404 && negCrossProjectQuestion.code === "MISSION_TARGET_NOT_FOUND"
  && negCrossProjectOutput.rejected && negCrossProjectOutput.status === 404 && negCrossProjectOutput.code === "MISSION_TARGET_NOT_FOUND"
  && negMissingApproval.rejected && negMissingApproval.status === 404
  && negMissingReceipt.rejected && negMissingReceipt.status === 404,
  { crossProjectQuestion: negCrossProjectQuestion, crossProjectOutput: negCrossProjectOutput, missingApproval: negMissingApproval, missingReceipt: negMissingReceipt });

// 409：回执与指定草稿版本不一致（原合同 MISSION_TARGET_MISMATCH 不回归）
const out1b = await addOutput({ missionId: m1.id, revision: 2 });
const artifact = await db.generatedArtifact.create({ data: { projectId: owner1.projectId, artifactType: "weekly_report", content: "fixture artifact" } });
const receipt = await db.missionArtifactReceipt.create({
  data: {
    projectId: owner1.projectId, missionId: m1.id, outputId: out1b.id, outputRevision: 2,
    outputHash: "sha256-fixture-output", artifactId: artifact.id, artifactType: "weekly_report",
    sourceManifestJson: [], blockMapJson: {}, verificationSnapshotJson: {},
    createdByUserId: owner1.userId, requestId: `receipt-${randomUUID()}`, payloadHash: `payload-${randomUUID()}`,
  },
});
const negReceiptMismatch = await expectError(() => readMissionBack(owner1.userId, m1.id, { outputId: out1.id, revision: 1, receiptId: receipt.id }));
check("A2-IND-NEG-03", "回执与指定成果版本不一致 → 409 MISSION_TARGET_MISMATCH（旧 target 保护不回归）",
  negReceiptMismatch.rejected && negReceiptMismatch.status === 409 && negReceiptMismatch.code === "MISSION_TARGET_MISMATCH",
  { mismatch: negReceiptMismatch, receiptId: receipt.id, requestedOutputId: out1.id });

const session1 = await createSession(owner1.userId);
const anonResponse = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m1.id}/readback`), { params: Promise.resolve({ id: m1.id }) });
const authedResponse = await readbackGet(new Request(`https://fixture.invalid/api/missions/${m1.id}/readback`, { headers: { authorization: `Bearer ${session1.token}` } }), { params: Promise.resolve({ id: m1.id }) });
const authedBody = plain(await authedResponse.json()) as { readback?: { workPacket?: unknown; readAt?: string } };
check("A2-IND-NEG-04", "匿名读回 401；已认证 200 且响应含 workPacket（API 路由未回归）",
  anonResponse.status === 401 && authedResponse.status === 200
  && !!authedBody.readback?.workPacket && typeof authedBody.readback?.readAt === "string",
  { anonymousStatus: anonResponse.status, authedStatus: authedResponse.status, authedHasWorkPacket: !!authedBody.readback?.workPacket, authedReadAt: authedBody.readback?.readAt });

/* ================================================================
 * 3) GET 前后零副作用
 * ================================================================ */
async function sideEffectSnapshot() {
  return plain({
    counts: {
      events: await db.agentMissionEvent.count(),
      agentRuns: await db.agentRun.count(),
      steps: await db.agentMissionStep.count(),
      outputs: await db.agentMissionOutput.count(),
      receipts: await db.missionArtifactReceipt.count(),
      directiveEvents: await db.agentDirectiveEvent.count(),
      missions: await db.agentMission.count(),
    },
    mission: await missionSnapshot(m1.id),
    user: plain(await db.user.findUniqueOrThrow({ where: { id: owner1.userId }, select: { continuitySeq: true } })),
  });
}
await sleep(15);
const beforeEffects = await sideEffectSnapshot();
const rb1Again = await readMissionBack(owner1.userId, m1.id, { questionId: q1.id });
await readMissionBack(owner1.userId, m1.id);
await missionDetail(owner1.userId, m1.id);
await missionWorkspaceSummary(owner1.userId, owner1.projectId);
const afterEffects = await sideEffectSnapshot();
check("A2-IND-SIDE-01", "GET/读回前后：事件/AgentRun/Step/Output/Receipt/预算/版本状态/updatedAt/continuitySeq 零变化",
  JSON.stringify(beforeEffects) === JSON.stringify(afterEffects)
  && rb1Again.missionVersion === rb1.missionVersion
  && (rb1Again.workPacket as { readAt?: string } | undefined)?.readAt !== undefined,
  { before: beforeEffects, after: afterEffects, secondReadVersion: rb1Again.missionVersion });

/* ================================================================
 * 4) 旧服务缺 workPacket/readAt/observation 降级 + 真实 null
 * ================================================================ */
const legacyShape = { ...rb1 } as Record<string, unknown>;
delete legacyShape.workPacket; delete legacyShape.readAt; delete legacyShape.observation;
const legacyTyped: { workPacket?: unknown; readAt?: string; observation?: unknown; workState?: unknown; missionVersion?: number } = legacyShape;
check("A2-IND-LEGACY-01", "旧服务缺 workPacket/readAt/observation：旧字段与原详情仍在，缺字段为 undefined 而非伪造成功",
  legacyTyped.workPacket === undefined && legacyTyped.readAt === undefined && legacyTyped.observation === undefined
  && legacyTyped.workState !== undefined && legacyTyped.missionVersion === rb1.missionVersion
  && (legacyShape.materialUses as unknown) !== undefined && legacyShape.realityOutcome === "NOT_INFERRED",
  { legacyKeys: Object.keys(legacyShape).sort(), workStatePresent: legacyTyped.workState !== undefined, workPacketPresent: legacyTyped.workPacket });

const mNull = await createMission(owner1, { status: "READY", budgetUsedJson: {}, planJson: {}, nextAttemptAt: null, lastErrorJson: null });
const rbNull = await readMissionBack(owner1.userId, mNull.id);
const pNull = rbNull.workPacket as unknown as Record<string, unknown> | undefined;
const obsNull = pNull?.observations as Record<string, unknown> | undefined;
const authNull = pNull?.authority as { budget?: { cumulativeUsed?: Record<string, number | null> } } | undefined;
const usesNull = (pNull?.basis as { materialUses?: { items?: unknown[] } } | undefined)?.materialUses;
const cumulative = authNull?.budget?.cumulativeUsed ?? {};
check("A2-IND-NULL-01", "真实 null：无观察/无错误/无额度时为 null 且字段显式存在（不补 0、不写成发生）",
  !!obsNull && Object.prototype.hasOwnProperty.call(obsNull, "lastSuccessfulAt") && obsNull.lastSuccessfulAt === null
  && Object.prototype.hasOwnProperty.call(obsNull, "lastFailedAt") && obsNull.lastFailedAt === null
  && Object.prototype.hasOwnProperty.call(obsNull, "lastNoNewInformationAt") && obsNull.lastNoNewInformationAt === null
  && obsNull.nextCheckAt === null && obsNull.state === "NOT_OBSERVED"
  && !!pNull?.stopped && (pNull.stopped as { unknownEffect?: unknown }).unknownEffect === null
  && Object.prototype.hasOwnProperty.call(cumulative, "inputTokens") && cumulative.inputTokens === null
  && (pNull.done as { latestOutput?: unknown }).latestOutput === null
  && Array.isArray(usesNull?.items) && usesNull.items.length === 0,
  { observations: obsNull, authorityBudgetCumulativeUsed: cumulative, unknownEffect: (pNull?.stopped as { unknownEffect?: unknown } | undefined)?.unknownEffect, latestOutput: (pNull?.done as { latestOutput?: unknown } | undefined)?.latestOutput, materialUsesItems: usesNull?.items });

/* ================================================================
 * 5) FS-A03：额度等待三处一致 + 预算不清零
 * ================================================================ */
const NEXT_ATTEMPT = new Date(Date.now() + 6 * 3600 * 1000);
const m3 = await createMission(owner1, { status: "READY", version: 2, nextAttemptAt: NEXT_ATTEMPT, budgetUsedJson: { models: 5, tools: 2, inputTokens: 900, outputTokens: 120, unknownCalls: 1 } });
await addEvent(m3.id, "DAILY_BUDGET_WAITING", { budgetRetained: true, nextAttemptAt: NEXT_ATTEMPT.toISOString(), reason: "今日模型调用额度已用完，等待许可时区次日" });
const detail3 = await missionDetail(owner1.userId, m3.id);
const summary3 = await missionWorkspaceSummary(owner1.userId, owner1.projectId);
const summaryItem3 = summary3.items.find((item) => item.id === m3.id) ?? null;
const rb3 = await readMissionBack(owner1.userId, m3.id);
const p3 = rb3.workPacket as unknown as Record<string, unknown> | undefined;
const ws3 = {
  detail: plain(detail3.workState) as Record<string, unknown>,
  summary: (summaryItem3?.workState ?? null) as unknown as Record<string, unknown> | null,
  readback: rb3.workState as unknown as Record<string, unknown>,
};
const cumulative3 = (p3?.authority as { budget?: { cumulativeUsed?: Record<string, number | null> } } | undefined)?.budget?.cumulativeUsed;
check("A2-IND-FS-A03-01", "FS-A03：DAILY_BUDGET_WAITING 三处一致解释 QUEUED + nextCheckAt，累计预算不清零",
  ws3.detail.phase === "QUEUED" && ws3.detail.reasonCode === "DAILY_BUDGET_WAITING"
  && ws3.summary?.phase === "QUEUED" && ws3.summary?.reasonCode === "DAILY_BUDGET_WAITING"
  && ws3.readback.phase === "QUEUED" && ws3.readback.reasonCode === "DAILY_BUDGET_WAITING"
  && ws3.detail.nextCheckAt === NEXT_ATTEMPT.toISOString() && ws3.summary?.nextCheckAt === NEXT_ATTEMPT.toISOString() && ws3.readback.nextCheckAt === NEXT_ATTEMPT.toISOString()
  && (plain(detail3.used) as { models?: number }).models === 5 && rb3.resourceUsage.models === 5
  && cumulative3?.models === 5 && cumulative3?.unknownCalls === 1
  && ((p3?.next as { waitingOn?: string } | undefined)?.waitingOn === "BUDGET_RESET"),
  { workStates: ws3, detailUsed: plain(detail3.used), readbackUsage: rb3.resourceUsage, packetCumulativeUsed: cumulative3 });

/* ================================================================
 * 6) FS-A04：读取时间/成功观察时间分离；失败不显示“无变化”
 * ================================================================ */
const FIXED_OBSERVED = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
const m4 = await createMission(owner1, {
  status: "READY", version: 2,
  planJson: { delegation: { lastObservedAt: FIXED_OBSERVED } },
  continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString() },
});
const noChangeEvent = await addEvent(m4.id, "INVESTIGATION_NO_NEW_INFORMATION", {});
const rb4a = await readMissionBack(owner1.userId, m4.id);
await sleep(30);
const rb4b = await readMissionBack(owner1.userId, m4.id);
const p4a = rb4a.workPacket as unknown as Record<string, unknown>;
const p4b = rb4b.workPacket as unknown as Record<string, unknown>;
const ws4a = rb4a.workState as unknown as Record<string, unknown>;
const ws4b = rb4b.workState as unknown as Record<string, unknown>;
const obs4a = p4a.observations as Record<string, unknown>;
const obs4b = p4b.observations as Record<string, unknown>;
check("A2-IND-FS-A04-01", "FS-A04：反复 GET 不推进成功观察时间；checkedAt/readAt 前进；无变化是观察结论",
  ws4a.observedAt === FIXED_OBSERVED && ws4b.observedAt === FIXED_OBSERVED
  && Date.parse(String(ws4b.checkedAt)) > Date.parse(String(ws4a.checkedAt))
  && Date.parse(rb4b.readAt) > Date.parse(rb4a.readAt)
  && obs4b.lastSuccessfulAt === FIXED_OBSERVED
  && obs4b.lastNoNewInformationAt === noChangeEvent.createdAt.toISOString()
  && obs4b.state === "OBSERVED"
  && (p4b.done as { note?: string }).note?.includes("无新变化") === true
  && (p4b.done as { note?: string }).note?.includes("不是委托生命周期") === true,
  { first: { checkedAt: ws4a.checkedAt, observedAt: ws4a.observedAt, readAt: rb4a.readAt }, second: { checkedAt: ws4b.checkedAt, observedAt: ws4b.observedAt, readAt: rb4b.readAt }, observations: obs4b, doneNote: (p4b.done as { note?: string }).note });
const failureEvent = await addEvent(m4.id, "EXECUTION_STOPPED", { reason: "fixture failure" });
await sleep(10);
const rb4c = await readMissionBack(owner1.userId, m4.id);
const p4c = rb4c.workPacket as unknown as Record<string, unknown>;
const obs4c = p4c.observations as Record<string, unknown>;
check("A2-IND-FS-A04-02", "FS-A04：最近观察失败后 state=FAILED_LAST、lastFailedAt 真实，不显示“无新变化”",
  obs4c.state === "FAILED_LAST" && obs4c.lastFailedAt === failureEvent.createdAt.toISOString()
  && obs4c.lastSuccessfulAt === FIXED_OBSERVED
  && (p4c.next as { note?: string }).note?.includes("未发现新变化") !== true
  && (p4c.done as { note?: string }).note?.includes("无新变化") !== true,
  { observations: obs4c, nextNote: (p4c.next as { note?: string }).note, doneNote: (p4c.done as { note?: string }).note });

/* ================================================================
 * 7) FS-A05：抑制 / 撤权 / 来源链未知 → currentUse；历史 facts 保留；写守卫拒绝
 * ================================================================ */
const normalMat = await materialScenario("normal");
const rbNormalMat = await readMissionBack(normalMat.owner.userId, normalMat.missionId, { questionId: normalMat.questionId });
const itemNormalMat = rbNormalMat.materialUses.items[0] as unknown as Record<string, unknown> | undefined;
const baselineKinds = (itemNormalMat?.facts as Array<{ kind: string }> | undefined)?.map((f) => f.kind) ?? [];
check("A2-IND-FS-A05-01", "FS-A05 基线：正常来源 currentUse=ALLOWED、availability=CURRENT、有历史 facts 与摘录",
  (itemNormalMat?.currentUse as { state?: string } | undefined)?.state === "ALLOWED"
  && itemNormalMat?.availability === "CURRENT"
  && itemNormalMat?.availabilityMeaning === "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION"
  && baselineKinds.includes("BOUND") && typeof itemNormalMat?.excerpt === "string",
  { item: itemNormalMat });

const sessionMat = await createSession(normalMat.owner.userId);
const conversationMat = await createConversation({ userId: normalMat.owner.userId, sessionId: sessionMat.session.id }, { requestId: `a2-conv-${normalMat.owner.projectId}`, scope: "PROJECT", projectId: normalMat.owner.projectId });
const suppression = await submitDirective({ userId: normalMat.owner.userId, sessionId: sessionMat.session.id }, conversationMat.id, {
  commandId: `a2-suppress-${randomUUID()}`, expectedSeq: 0, scope: { projectId: normalMat.owner.projectId }, operation: "SUPPRESS_USE", sourceIds: [normalMat.pointer.id],
});
const suppressionUse = await sourceUse(normalMat.owner.userId, normalMat.owner.projectId, normalMat.pointer.id, db, { missionId: normalMat.missionId });
const rbSuppressed = await readMissionBack(normalMat.owner.userId, normalMat.missionId, { questionId: normalMat.questionId });
const itemSuppressed = rbSuppressed.materialUses.items[0] as unknown as Record<string, unknown> | undefined;
const suppressedKinds = (itemSuppressed?.facts as Array<{ kind: string }> | undefined)?.map((f) => f.kind) ?? [];
const suppressedGuard = await expectError(() => validateSources(normalMat.owner.projectId, [{ id: normalMat.pointer.id } as never], db, normalMat.missionId));
const pSuppressed = rbSuppressed.workPacket as unknown as Record<string, unknown>;
check("A2-IND-FS-A05-02", "FS-A05 抑制：currentUse=SUPPRESSED、independentEvidence=false、历史 facts/摘录保留、写守卫仍拒绝",
  suppressionUse.state === "SUPPRESSED" && suppressionUse.independentEvidence === false
  && (itemSuppressed?.currentUse as { state?: string; independentEvidence?: boolean } | undefined)?.state === "SUPPRESSED"
  && (itemSuppressed?.currentUse as { independentEvidence?: boolean } | undefined)?.independentEvidence === false
  && JSON.stringify(suppressedKinds) === JSON.stringify(baselineKinds)
  && typeof itemSuppressed?.excerpt === "string"
  && suppressedGuard.rejected === true && suppressedGuard.code === "SOURCE_USE_SUPPRESSED"
  && (pSuppressed.blockers as Array<{ code: string }>).some((b) => b.code === "CURRENT_USE_SUPPRESSED")
  && ((pSuppressed.next as { primaryAction?: { requires?: { requiredSourceRevisions?: string[] } } }).primaryAction?.requires?.requiredSourceRevisions ?? []).length === 0,
  { directiveAdmission: suppression.admission, sourceUse: suppressionUse, item: itemSuppressed, writeGuard: suppressedGuard, packetBlockers: (pSuppressed.blockers as Array<{ code: string }>).map((b) => b.code) });

// 撤权：仓库信号采纳的 capture，撤销连接
const revokedMat = await materialScenario("revoked", "仓库信号");
const connection = await db.sourceConnection.create({
  data: {
    projectId: revokedMat.owner.projectId, ownerUserId: revokedMat.owner.userId, provider: "GITHUB",
    repo: `a2-verify/${revokedMat.captureId}`, ref: "main", signalKind: "COMMITS", status: "ACTIVE", revision: 1,
  },
});
await db.externalSignal.create({
  data: {
    connectionId: connection.id, projectId: revokedMat.owner.projectId, ownerUserId: revokedMat.owner.userId,
    sha: `a2-sha-${revokedMat.captureId}`, kind: "COMMITS", title: "验收提交信号", authorName: "verify",
    url: `https://verify.invalid/${revokedMat.captureId}`, adoptedCaptureId: revokedMat.captureId,
    adoptedByUserId: revokedMat.owner.userId, adoptedAt: new Date(),
    // 与 lib/sensing/repoGrantBinding.repositoryGrantBinding 相同的授权绑定（否则来源链判为 UNKNOWN）。
    sourceBindingJson: {
      schemaVersion: 1, connectionId: connection.id, observedRevision: 0,
      scopeHash: jsonHash({ connectionId: connection.id, projectId: revokedMat.owner.projectId, ownerUserId: revokedMat.owner.userId, repo: connection.repo, ref: connection.ref }),
    },
  },
});
const rbRevokedBefore = await readMissionBack(revokedMat.owner.userId, revokedMat.missionId, { questionId: revokedMat.questionId });
const itemRevokedBefore = rbRevokedBefore.materialUses.items[0] as unknown as Record<string, unknown> | undefined;
const revokedKindsBefore = (itemRevokedBefore?.facts as Array<{ kind: string }> | undefined)?.map((f) => f.kind) ?? [];
await db.sourceConnection.update({ where: { id: connection.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "A2_VERIFY_REVOKED", revision: { increment: 1 } } });
const revokedUseAfter = await sourceUse(revokedMat.owner.userId, revokedMat.owner.projectId, revokedMat.pointer.id, db, { missionId: revokedMat.missionId });
const rbRevokedAfter = await readMissionBack(revokedMat.owner.userId, revokedMat.missionId, { questionId: revokedMat.questionId });
const itemRevokedAfter = rbRevokedAfter.materialUses.items[0] as unknown as Record<string, unknown> | undefined;
const revokedKindsAfter = (itemRevokedAfter?.facts as Array<{ kind: string }> | undefined)?.map((f) => f.kind) ?? [];
const pRevoked = rbRevokedAfter.workPacket as unknown as Record<string, unknown>;
check("A2-IND-FS-A05-03", "FS-A05 撤权：连接撤销后 currentUse=SUPPRESSED（SOURCE_PERMISSION_REVOKED），历史 facts 保留",
  (itemRevokedBefore?.currentUse as { state?: string } | undefined)?.state === "ALLOWED"
  && revokedUseAfter.state === "SUPPRESSED" && revokedUseAfter.reason === "SOURCE_PERMISSION_REVOKED"
  && (itemRevokedAfter?.currentUse as { state?: string } | undefined)?.state === "SUPPRESSED"
  && JSON.stringify(revokedKindsAfter) === JSON.stringify(revokedKindsBefore) && revokedKindsAfter.includes("BOUND")
  && (pRevoked.blockers as Array<{ code: string }>).some((b) => b.code === "CURRENT_USE_SUPPRESSED"),
  { before: { sourceUse: itemRevokedBefore?.currentUse, facts: revokedKindsBefore }, after: { sourceUse: revokedUseAfter, itemCurrentUse: itemRevokedAfter?.currentUse, facts: revokedKindsAfter } });

// 来源链未知：仓库信号类型 capture 但没有 ExternalSignal
const unknownMat = await materialScenario("unknown", "仓库信号");
const unknownUse = await sourceUse(unknownMat.owner.userId, unknownMat.owner.projectId, unknownMat.pointer.id, db, { missionId: unknownMat.missionId });
const rbUnknown = await readMissionBack(unknownMat.owner.userId, unknownMat.missionId, { questionId: unknownMat.questionId });
const itemUnknown = rbUnknown.materialUses.items[0] as unknown as Record<string, unknown> | undefined;
const pUnknown = rbUnknown.workPacket as unknown as Record<string, unknown>;
check("A2-IND-FS-A05-04", "FS-A05 未知：来源链未知时 currentUse=UNKNOWN、不称独立证据；历史 facts 保留",
  unknownUse.state === "UNKNOWN" && unknownUse.reason === "LINEAGE_UNKNOWN"
  && (itemUnknown?.currentUse as { state?: string; independentEvidence?: boolean } | undefined)?.state === "UNKNOWN"
  && (itemUnknown?.currentUse as { independentEvidence?: boolean } | undefined)?.independentEvidence === false
  && Array.isArray(itemUnknown?.facts) && (itemUnknown.facts as unknown[]).length > 0
  && (pUnknown.blockers as Array<{ code: string }>).some((b) => b.code === "CURRENT_USE_UNKNOWN"),
  { sourceUse: unknownUse, item: itemUnknown, packetBlockers: (pUnknown.blockers as Array<{ code: string }>).map((b) => b.code) });

/* ================================================================
 * 8) FS-A06：Mission-first 窗口，无关 AgentRun 不能挤掉本委托
 * ================================================================ */
const owner6 = await createOwner("fs-a06");
const capture6 = await db.capture.create({ data: { projectId: owner6.projectId, rawText: "10月推理显存6.2GB（A2 FS-A06 目标记录）", sourceType: "实验记录" } });
const source6 = (await readProjectMaterial(owner6.projectId, `capture:${capture6.id}`))!;
const pointer6 = { id: source6.id, hash: source6.hash };
const m6 = await createMission(owner6, { status: "WAITING_INPUT", version: 2 });
const q6 = await addEvent(m6.id, "QUESTION", { question: "请补充 10 月对照记录" });
const step6 = await addStep({
  missionId: m6.id, ordinal: 1, toolName: "bind_project_sources",
  resultJson: { data: { questionId: q6.id }, sources: [{ id: pointer6.id, kind: "PROJECT", entityType: "CAPTURE", revision: pointer6.hash, hash: pointer6.hash, text: source6.text, observedAt: new Date().toISOString() }] },
});
await addEvent(m6.id, "SOURCE_ARRIVED", { questionId: q6.id, sourcePointer: pointer6, readable: true });
const missionRun = await addAgentRun({
  projectId: owner6.projectId, createdAt: new Date(Date.now() - 3600 * 1000),
  trace: { missionId: m6.id, contextManifest: { sourcePointers: [pointer6], includedStepIds: [step6.id] } },
});
for (let i = 0; i < 45; i++) {
  await addAgentRun({ projectId: owner6.projectId, createdAt: new Date(Date.now() + i + 1), trace: { missionId: `unrelated-mission-${i}` } });
}
const rb6 = await readMissionBack(owner6.userId, m6.id, { questionId: q6.id });
const item6 = rb6.materialUses.items[0] as unknown as { facts?: Array<{ kind: string }> } | undefined;
const facts6 = item6?.facts?.map((f) => f.kind) ?? [];
const cov6 = rb6.materialUses.coverage as unknown as Record<string, unknown>;
const p6 = rb6.workPacket as unknown as Record<string, unknown>;
check("A2-IND-FS-A06-01", "FS-A06：45 条更新的无关 AgentRun 不能把本委托运行挤出窗口（runScope=MISSION_FILTERED、CONTEXT_POINTER 保留）",
  cov6.runScope === "MISSION_FILTERED" && cov6.runLimit === 40 && cov6.runsTruncated === false
  && cov6.runsInspected === 1 && facts6.includes("CONTEXT_POINTER")
  && (rb6.callCoverage as unknown as { inspected?: { agentRuns?: number } }).inspected?.agentRuns === 1,
  { coverage: cov6, facts: facts6, callCoverage: rb6.callCoverage, missionRunId: missionRun.id, unrelatedRunCount: 45 });

const owner6b = await createOwner("fs-a06-empty");
const capture6b = await db.capture.create({ data: { projectId: owner6b.projectId, rawText: "另一份没有运行记录的来源（A2 FS-A06 空窗口对照）", sourceType: "实验记录" } });
const source6b = (await readProjectMaterial(owner6b.projectId, `capture:${capture6b.id}`))!;
const pointer6b = { id: source6b.id, hash: source6b.hash };
const m6b = await createMission(owner6b, { status: "WAITING_INPUT", version: 2 });
const q6b = await addEvent(m6b.id, "QUESTION", { question: "空窗口对照问题" });
await addStep({
  missionId: m6b.id, ordinal: 1, toolName: "bind_project_sources",
  resultJson: { data: { questionId: q6b.id }, sources: [{ id: pointer6b.id, kind: "PROJECT", entityType: "CAPTURE", revision: pointer6b.hash, hash: pointer6b.hash, text: source6b.text, observedAt: new Date().toISOString() }] },
});
const rb6b = await readMissionBack(owner6b.userId, m6b.id, { questionId: q6b.id });
const p6b = rb6b.workPacket as unknown as Record<string, unknown>;
const cov6b = rb6b.materialUses.coverage as unknown as Record<string, unknown>;
const missWindow6b = (p6b.coverage as { windows?: Array<{ name: string; note?: string }> } | undefined)?.windows?.find((w) => w.name === "MATERIAL_MISSION_RUNS");
check("A2-IND-FS-A06-02", "FS-A06 未找到≠从未发生：空运行窗口 coverage 明示有界，MATERIAL_MISSION_RUNS 窗口写明“未找到不等于从未使用”",
  cov6b.runScope === "MISSION_FILTERED" && cov6b.runsInspected === 0 && cov6b.runsTruncated === false
  && (p6b.coverage as { policy?: string }).policy === "NOT_FOUND_IS_NOT_NEVER"
  && typeof missWindow6b?.note === "string" && missWindow6b.note.includes("未找到不等于从未使用")
  && (p6b.basis as { note?: string }).note?.includes("历史留痕保留原身份") === true,
  { coverage: cov6b, missionRunsWindow: missWindow6b ?? null, basisNote: (p6b.basis as { note?: string }).note });

/* ================================================================
 * 9) FS-A07：时间跨界无新事件 → 权限失效 + 主操作重核；许可变化不升 version 的快照语义
 * ================================================================ */
const EXPIRED_AT = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const m7 = await createMission(owner1, {
  status: "WAITING_INPUT", version: 2,
  continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: EXPIRED_AT },
  constraintsJson: { deadline: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString() },
});
const q7 = await addEvent(m7.id, "QUESTION", { question: "时间跨界问题仍等待用户" });
await db.agentMission.update({ where: { id: m7.id }, data: { waitStateJson: { questionId: q7.id, question: "时间跨界问题仍等待用户", waitingFor: "USER" } } });
const eventsBefore7 = await db.agentMissionEvent.count({ where: { missionId: m7.id } });
const rb7 = await readMissionBack(owner1.userId, m7.id, { questionId: q7.id });
const p7 = rb7.workPacket as unknown as Record<string, unknown>;
const authority7 = p7.authority as Record<string, unknown>;
const next7 = p7.next as { primaryAction?: { kind?: string; requires?: { boundaryAt?: string | null } } };
const eventsAfter7 = await db.agentMissionEvent.count({ where: { missionId: m7.id } });
check("A2-IND-FS-A07-01", "FS-A07 时间跨界无新事件：permissionState=EXPIRED、主操作重核、boundaryAt=最早边界、事件数不变",
  authority7.permissionState === "EXPIRED"
  && next7.primaryAction?.kind === "RECHECK_AUTHORITY"
  && next7.primaryAction?.requires?.boundaryAt === EXPIRED_AT
  && (p7.blockers as Array<{ code: string }>).some((b) => b.code === "PERMISSION_EXPIRED")
  && eventsBefore7 === eventsAfter7,
  { authority: authority7, primaryAction: next7.primaryAction, blockers: (p7.blockers as Array<{ code: string }>).map((b) => b.code), eventsBefore: eventsBefore7, eventsAfter: eventsAfter7 });

// 许可变化（抑制来源）推进 controlVersion：公开 submitDirective 路径会经连续性失效联动推进 Mission version，
// 这里记录真实公开路径语义（快照仍一致、requires 携带新 controlVersion、被抑制来源不作当前依据）。
const m7b = await materialScenario("control-version");
const rb7bBefore = await readMissionBack(m7b.owner.userId, m7b.missionId, { questionId: m7b.questionId });
const versionBefore7b = rb7bBefore.missionVersion;
const controlBefore7b = (rb7bBefore.workPacket as { identity?: { controlVersion?: string } } | undefined)?.identity?.controlVersion;
const session7b = await createSession(m7b.owner.userId);
const conversation7b = await createConversation({ userId: m7b.owner.userId, sessionId: session7b.session.id }, { requestId: `a2-conv-${m7b.owner.projectId}`, scope: "PROJECT", projectId: m7b.owner.projectId });
await submitDirective({ userId: m7b.owner.userId, sessionId: session7b.session.id }, conversation7b.id, {
  commandId: `a2-suppress-${randomUUID()}`, expectedSeq: 0, scope: { projectId: m7b.owner.projectId }, operation: "SUPPRESS_USE", sourceIds: [m7b.pointer.id],
});
const rb7bAfter = await readMissionBack(m7b.owner.userId, m7b.missionId, { questionId: m7b.questionId });
const p7bAfter = rb7bAfter.workPacket as unknown as Record<string, unknown>;
const ident7b = p7bAfter.identity as Record<string, unknown>;
const requires7b = (p7bAfter.next as { primaryAction?: { requires?: Record<string, unknown> } }).primaryAction?.requires ?? {};
check("A2-IND-FS-A07-02", "FS-A07 公开抑制路径：快照一致、requires.controlVersion 携带责任视图版本、被抑制来源不作当前依据",
  (ident7b.controlVersion as string) !== (controlBefore7b as string)
  && requires7b.controlVersion === ident7b.controlVersion
  && (requires7b.requiredSourceRevisions as string[]).length === 0
  && ["VERSION_STABLE", "RETRIED"].includes(String((p7bAfter.snapshot as { consistency?: string }).consistency))
  && (p7bAfter.blockers as Array<{ code: string }>).some((b) => b.code === "CURRENT_USE_SUPPRESSED"),
  { missionVersionBefore: versionBefore7b, missionVersionAfter: rb7bAfter.missionVersion, controlVersionBefore: controlBefore7b, controlVersionAfter: ident7b.controlVersion, requires: requires7b, snapshot: p7bAfter.snapshot }, "公开 submitDirective 会经连续性失效联动推进 Mission version（本 fixture 观测到版本前进），因此“许可变化但 mission.version 未变”的读取窗口由下一项受控持久化复现。");

// 受控持久化：直接写入 mission 级 USE_SUPPRESSION 控制事实（不触发版本失效联动），复现“许可已变、mission.version 未变”读取窗口。
const m7c = await materialScenario("control-version-direct");
const rb7cBefore = await readMissionBack(m7c.owner.userId, m7c.missionId, { questionId: m7c.questionId });
const versionBefore7c = rb7cBefore.missionVersion;
const controlBefore7c = (rb7cBefore.workPacket as { identity?: { controlVersion?: string } } | undefined)?.identity?.controlVersion;
const user7c = await db.user.findUniqueOrThrow({ where: { id: m7c.owner.userId } });
await db.agentDirectiveEvent.create({
  data: {
    ownerUserId: m7c.owner.userId, seq: user7c.continuitySeq + 1, commandId: `a2-suppress-direct-${randomUUID()}`, eventIndex: 0,
    inputHash: "e".repeat(64), directiveId: randomUUID(), projectId: m7c.owner.projectId, missionId: m7c.missionId,
    kind: "USE_SUPPRESSION", operation: "SET", quote: "停止使用这条资料",
    sourceJson: { origin: "A2_INDEPENDENT_VERIFY" }, admissionJson: { status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION" },
    sourceIdsJson: [m7c.pointer.id], validFrom: new Date(), timezone: "Asia/Shanghai",
  } as never,
});
await db.user.update({ where: { id: m7c.owner.userId }, data: { continuitySeq: { increment: 1 } } });
const rb7cAfter = await readMissionBack(m7c.owner.userId, m7c.missionId, { questionId: m7c.questionId });
const p7cAfter = rb7cAfter.workPacket as unknown as Record<string, unknown>;
const ident7c = p7cAfter.identity as Record<string, unknown>;
const requires7c = (p7cAfter.next as { primaryAction?: { requires?: Record<string, unknown> } }).primaryAction?.requires ?? {};
check("A2-IND-FS-A07-03", "FS-A07 许可变化但 Mission version 未变（受控持久化窗口）：快照仍 VERSION_STABLE、requires.controlVersion 已更新、被抑制来源不作当前依据",
  rb7cAfter.missionVersion === versionBefore7c
  && (ident7c.controlVersion as string) !== (controlBefore7c as string)
  && requires7c.controlVersion === ident7c.controlVersion
  && (requires7c.requiredSourceRevisions as string[]).length === 0
  && (p7cAfter.snapshot as { consistency?: string }).consistency === "VERSION_STABLE"
  && (p7cAfter.blockers as Array<{ code: string }>).some((b) => b.code === "CURRENT_USE_SUPPRESSED"),
  { missionVersionBefore: versionBefore7c, missionVersionAfter: rb7cAfter.missionVersion, controlVersionBefore: controlBefore7c, controlVersionAfter: ident7c.controlVersion, requires: requires7c, snapshot: p7cAfter.snapshot });

/* ================================================================
 * 10) A1-RESIDUAL-01：workspaceSummary 对 RUNNING+停止请求在途
 * ================================================================ */
const owner10 = await createOwner("residual-01");
const lease10 = new Date(Date.now() + 10 * 60 * 1000);
const m10a = await createMission(owner10, { status: "RUNNING", version: 2, leaseUntil: lease10, pauseRequestedAt: new Date(), pauseReason: "USER" });
const m10b = await createMission(owner10, { status: "RUNNING", version: 2, leaseUntil: lease10, cancelRequestedAt: new Date() });
const summary10 = await missionWorkspaceSummary(owner10.userId, owner10.projectId);
const item10a = summary10.items.find((item) => item.id === m10a.id) ?? null;
const item10b = summary10.items.find((item) => item.id === m10b.id) ?? null;
const detail10a = await missionDetail(owner10.userId, m10a.id);
const rb10a = await readMissionBack(owner10.userId, m10a.id);
const p10a = rb10a.workPacket as unknown as Record<string, unknown>;
const summaryWs10a = item10a?.workState as unknown as Record<string, unknown> | undefined;
const summaryWs10b = item10b?.workState as unknown as Record<string, unknown> | undefined;
const stopOf = (ws: Record<string, unknown> | undefined) => ws?.stopRequest as { state?: string; settled?: boolean } | undefined;
check("A2-IND-RESIDUAL-01", "A1-RESIDUAL-01：workspaceSummary 对 RUNNING+停止请求在途显示 STOP_REQUESTED_IN_FLIGHT（pause/cancel 两例）",
  summary10.enabled === true
  && summaryWs10a?.phase === "RUNNING" && summaryWs10a?.reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && stopOf(summaryWs10a)?.state === "PAUSE_REQUESTED" && stopOf(summaryWs10a)?.settled === false
  && summaryWs10a?.actionLabel === "核对停止结算" && !/继续|恢复/.test(String(summaryWs10a?.actionLabel))
  && summaryWs10b?.reasonCode === "STOP_REQUESTED_IN_FLIGHT" && stopOf(summaryWs10b)?.state === "CANCEL_REQUESTED"
  && (detail10a.workState as unknown as { reasonCode?: string }).reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && (rb10a.workState as unknown as { reasonCode?: string }).reasonCode === "STOP_REQUESTED_IN_FLIGHT"
  && (p10a.next as { primaryAction?: { kind?: string } }).primaryAction?.kind === "CHECK_STOP_SETTLEMENT",
  { summaryEnabled: summary10.enabled, totalActive: summary10.totalActive, pauseItem: { status: item10a?.status, attention: item10a?.attention, workState: summaryWs10a }, cancelItem: { status: item10b?.status, workState: summaryWs10b }, detailReasonCode: (detail10a.workState as unknown as { reasonCode?: string }).reasonCode, readbackReasonCode: (rb10a.workState as unknown as { reasonCode?: string }).reasonCode, packetPrimaryAction: (p10a.next as { primaryAction?: unknown }).primaryAction });

/* ---------- 写证据 ---------- */
const failed = checks.filter((c) => c.verdict === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "INDEPENDENT_FIXTURE_A2",
  runner: "evidence/final-a/20261103/verify/fixtures/a2-service-fixture.ts",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "A2 HEAD clean shadow (git archive d428314)",
  database: { mechanism: "mkdtemp + better-sqlite3 replay prisma/migrations", temporaryDir: dir, migrationCount: migrationNames.length, schemaTables },
  env: { llmMode: "mock", modelProviderCalls: 0, externalWrites: 0 },
  summary: { total: checks.length, pass: checks.filter((c) => c.verdict === "PASS").length, fail: failed, notRun: checks.filter((c) => c.verdict === "NOT_RUN").length },
  checks,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: failed === 0, outPath, summary: evidence.summary }));
await db.$disconnect();
process.exit(failed === 0 ? 0 : 1);
