/**
 * BEFORE_FIX 独立特征化 2/3：证据审查有界窗口是否先筛原问题再限额。
 *
 * 运行（干净 shadow 根目录）：npx.cmd tsx verify-fixtures/baseline-evidence-window.ts <输出JSON绝对路径>
 * 隔离与边界同 baseline-terminal.ts：临时 SQLite、重放 migrations、mock、只读服务取证、零网络。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx baseline-evidence-window.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-base-window-"));
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
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migration = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
}
sql.close();

const { db } = await import("@/lib/db");
const { createMission, missionDetail } = await import("@/lib/mission/missionService");
const { readMissionBack } = await import("@/lib/mission/readback");
const { event } = await import("@/lib/mission/repository");
const { recordFitReview } = await import("@/lib/mission/evidenceFitService");

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const iso = (v: Date | null | undefined) => (v ? new Date(v).toISOString() : null);

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-window-${label}-${randomUUID()}`, displayName: `独立验收 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: {
      title: `独立验收证据窗口 ${label}`, description: "SYNTHETIC_POST_VERIFY_WINDOW", goal: "验证证据审查窗口",
      scenario: "RESEARCH" as never, memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { user, project };
}
async function createFor(userId: string, projectId: string, goal: string) {
  return createMission(userId, {
    projectId, requestId: `req-${randomUUID()}`, goal, successCriteria: ["DRAFT_EXISTS"],
    missionConstraints: {}, researchScope: {}, llmContextApproved: false, continuationPolicy: { mode: "MANUAL" },
  });
}

/** 与真实 recordFitReview 同一写入路径；构造最小但结构完整的 assess 结果。 */
function syntheticFit(questionId: string, questionText: string, fitStatus = "UNKNOWN") {
  const premiseHash = randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const evidenceFit = {
    schemaVersion: 1, ruleVersion: "post-verify-r1", normalizationVersion: "RAW_UTF16_V1",
    premise: {
      schemaVersion: 1, domain: "TECH_RESOURCE_MEASUREMENT",
      measurement: { name: "GPU_MEMORY", unit: "GB", period: "本轮实验" },
      checks: [
        { id: "SUBJECT", expected: "模型", basis: { kind: "QUESTION", quote: questionText.slice(0, 40) } },
        { id: "STAGE", expected: "推理", basis: { kind: "QUESTION", quote: questionText.slice(0, 40) } },
      ],
      questionId, goalHash: "g".repeat(64), constraintsVersion: 1, scopeVersion: 1,
      premiseHash, basisStatus: "UNRESOLVED",
    },
    fitStatus, groups: [], eligibleGroups: [], excludedGroups: [], unresolvedChecks: [], conflicts: [],
    coverage: { sourceCount: 0, truncatedSourceIds: [], groupLimitSourceIds: [] }, semanticVerification: "NOT_CHECKED",
  };
  return {
    evidenceFit,
    fitHash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    observationExcerpts: [],
    review: { schemaVersion: 1, mode: "BACKGROUND_ONLY", note: "独立验收人工核对（fixture）", premiseHash, confirmedPremise: true },
    hardBlocked: false,
  };
}

async function insertReview(missionId: string, questionId: string, questionText: string) {
  await db.$transaction(async (tx: any) => {
    const m = await tx.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    return recordFitReview(tx, m, syntheticFit(questionId, questionText) as never, syntheticFit(questionId, questionText).review as never);
  });
}
async function insertQuestionEvent(missionId: string, questionText: string): Promise<string> {
  let created: any;
  await db.$transaction(async (tx: any) => { created = await event(tx, missionId, "QUESTION", { question: questionText }); });
  return created.id;
}
async function counts(missionId: string) {
  const [fitAll, fitByQuestion] = await Promise.all([
    db.agentMissionEvent.count({ where: { missionId, type: "EVIDENCE_FIT_REVIEWED" } }),
    db.agentMissionEvent.findMany({ where: { missionId, type: "EVIDENCE_FIT_REVIEWED" } }),
  ]);
  return { fitAll, fitQuestionIds: fitByQuestion.map((e: any) => e.payloadJson?.evidenceFit?.premise?.questionId ?? null), seqs: fitByQuestion.map((e: any) => e.seq) };
}
function evidenceBrief(rb: any) {
  return {
    legacyEvidenceReviews: {
      itemCount: rb.evidenceReviews?.items?.length ?? null,
      truncated: rb.evidenceReviews?.truncated ?? null,
      itemQuestionIds: (rb.evidenceReviews?.items ?? []).map((i: any) => i?.premise?.questionId ?? null),
      itemEventIds: (rb.evidenceReviews?.items ?? []).map((i: any) => i.eventId ?? null),
    },
    packetEvidenceReviews: {
      itemCount: rb.workPacket?.basis?.evidenceReviews?.items?.length ?? null,
      truncated: rb.workPacket?.basis?.evidenceReviews?.truncated ?? null,
      items: rb.workPacket?.basis?.evidenceReviews?.items ?? null,
    },
    coverageEvidenceWindow: (rb.workPacket?.coverage?.windows ?? []).find((w: any) => w.name === "EVIDENCE_REVIEWS") ?? null,
    basisQuestionId: rb.workPacket?.basis?.questionId ?? null,
    missionVersion: rb.missionVersion,
  };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "BEFORE_FIX 证据审查有界窗口：目标 question 审查是否被更新事件挤出",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace HEAD 4b69614 via git archive shadow",
  db: { kind: "temporary sqlite (mkdtemp) + prisma migrations replayed", path: dbFile },
  scenarios: {},
};

/* ---------- 场景 A：目标审查最早，之后 21 条其他 question 审查（共 22） ---------- */
{
  const { user, project } = await owner("evicted");
  const m = await createFor(user.id, project.id, "独立验收：证据窗口挤出");
  const targetQ = await insertQuestionEvent(m.id, "目标问题：本轮 GPU 显存是否超过上限？");
  await insertReview(m.id, targetQ, "目标问题：本轮 GPU 显存是否超过上限？");
  for (let i = 0; i < 21; i += 1) {
    const q = `question-other-${i}-${randomUUID()}`;
    await insertReview(m.id, q, `其他问题 ${i}`);
  }
  const before = await counts(m.id);
  const snap0 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const snap1 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const detail = await missionDetail(user.id, m.id);
  const snap2 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  const after = await counts(m.id);
  // 再读一次，确认读取不写入
  const rb2 = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const after2 = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  result.scenarios.evictedByNewerReviews = {
    missionId: m.id,
    targetQuestionId: targetQ,
    dbFacts: { totalFitReviews: before.fitAll, targetReviewPresent: before.fitQuestionIds.includes(targetQ), targetReviewSeq: before.seqs[before.fitQuestionIds.indexOf(targetQ)] },
    readback: evidenceBrief(rb),
    readbackAgain: evidenceBrief(rb2),
    detailEvidencePremise: detail.evidencePremise ?? null,
    readOnly: {
      countsBefore: before.fitAll, countsAfter: after.fitAll,
      readbackOnly: { before: { version: snap0.version, updatedAt: iso(snap0.updatedAt), nextEventSeq: snap0.nextEventSeq }, after: { version: snap1.version, updatedAt: iso(snap1.updatedAt), nextEventSeq: snap1.nextEventSeq }, identical: snap0.version === snap1.version && iso(snap0.updatedAt) === iso(snap1.updatedAt) && snap0.nextEventSeq === snap1.nextEventSeq },
      missionDetail: { identical: snap1.version === snap2.version && iso(snap1.updatedAt) === iso(snap2.updatedAt) && snap1.nextEventSeq === snap2.nextEventSeq },
      secondReadback: { identical: snap2.version === after2.version && iso(snap2.updatedAt) === iso(after2.updatedAt) && snap2.nextEventSeq === after2.nextEventSeq },
      identical: snap0.version === snap1.version && iso(snap0.updatedAt) === iso(snap1.updatedAt) && snap0.nextEventSeq === snap1.nextEventSeq && before.fitAll === after.fitAll,
    },
  };
}

/* ---------- 场景 B：仅 2 条审查（目标命中；对照组） ---------- */
{
  const { user, project } = await owner("control");
  const m = await createFor(user.id, project.id, "独立验收：证据窗口对照");
  const targetQ = await insertQuestionEvent(m.id, "对照问题：目标");
  await insertReview(m.id, targetQ, "对照问题：目标");
  await insertReview(m.id, `question-control-other-${randomUUID()}`, "对照问题：其他");
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  result.scenarios.controlSmallWindow = { missionId: m.id, targetQuestionId: targetQ, dbFacts: await counts(m.id), readback: evidenceBrief(rb) };
}

/* ---------- 场景 C：目标审查第 21 新、恰好 20 条更新在其他问题之后（共 21，slice(0,20) 边界） ---------- */
{
  const { user, project } = await owner("boundary");
  const m = await createFor(user.id, project.id, "独立验收：证据窗口边界 21");
  const targetQ = await insertQuestionEvent(m.id, "边界问题：目标");
  await insertReview(m.id, targetQ, "边界问题：目标");
  for (let i = 0; i < 20; i += 1) await insertReview(m.id, `question-boundary-other-${i}-${randomUUID()}`, `边界其他 ${i}`);
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  result.scenarios.boundary21 = { missionId: m.id, targetQuestionId: targetQ, dbFacts: await counts(m.id), readback: evidenceBrief(rb) };
}

/* ---------- 结论 ---------- */
const a = result.scenarios.evictedByNewerReviews, b = result.scenarios.controlSmallWindow, cc = result.scenarios.boundary21;
const hit = (x: any) => (x.readback.legacyEvidenceReviews.itemQuestionIds ?? []).includes(x.targetQuestionId);
result.verdict = {
  targetReviewExistsInDb: a.dbFacts.targetReviewPresent,
  evictedScenarioHit: hit(a),
  evictedScenarioItemCount: a.readback.legacyEvidenceReviews.itemCount,
  evictedScenarioTruncated: a.readback.legacyEvidenceReviews.truncated,
  controlScenarioHit: hit(b),
  boundary21ScenarioHit: hit(cc),
  boundary21ItemCount: cc.readback.legacyEvidenceReviews.itemCount,
  boundary21Truncated: cc.readback.legacyEvidenceReviews.truncated,
  readOnlyZeroChange: a.readOnly.identical,
  conclusion: hit(a) || hit(cc)
    ? "未复现挤出：目标 question 审查仍被返回。"
    : "BEFORE_FIX 复现：目标 question 的审查事件确实在库中（seq 可查），但当前 readback 先 take 21 再 filter/slice(0,20)，更新的其他 question 审查把目标挤出窗口，legacy evidenceReviews.items 为空；truncated 位虽为 true，但目标问题自己的审查未命中。",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, verdict: result.verdict }, null, 2));



