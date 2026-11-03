/**
 * POST 独立复验 2/4：证据审查有界窗口修复（先按选中原问题筛再限额）。
 *
 * 运行（目标提交的干净 shadow 根目录）：npx.cmd tsx verify-fixtures/post-evidence-window-verify.ts <输出JSON绝对路径>
 * 同一脚本对 4b69614 基线复跑会 FAIL（目标问题审查被挤出），对修复提交应 PASS。
 * 真实 recordFitReview/event 写入 + 真实 readMissionBack 读取；独立临时 SQLite、mock、无网络。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx post-evidence-window-verify.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-final-window-"));
const dbFile = path.join(dir, "verify.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"),
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true",
  MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true",
  SEMANTIC_MEMORY_ENABLED: "false", LLM_MODE: "mock", WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
});
const sql = new Database(dbFile);
sql.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const m = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(m)) sql.exec(fs.readFileSync(m, "utf8"));
}
sql.close();

const { db } = await import("@/lib/db");
const { createMission } = await import("@/lib/mission/missionService");
const { readMissionBack } = await import("@/lib/mission/readback");
const { event } = await import("@/lib/mission/repository");
const { recordFitReview } = await import("@/lib/mission/evidenceFitService");

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const iso = (v: Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const checks: Array<{ id: string; question: string; verdict: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED"; observed: unknown; note?: string }> = [];
const check = (id: string, question: string, pass: boolean, observed: unknown, note?: string) =>
  checks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-final-win-${label}-${randomUUID()}`, displayName: `独立复验 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: { title: `独立复验证据窗口 ${label}`, description: "SYNTHETIC_POST_FINAL_WINDOW", goal: "证据窗口先筛后限", scenario: "RESEARCH" as never, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { user, project };
}
async function createFor(userId: string, projectId: string, goal: string) {
  return createMission(userId, { projectId, requestId: `req-${randomUUID()}`, goal, successCriteria: ["DRAFT_EXISTS"], missionConstraints: {}, researchScope: {}, llmContextApproved: false, continuationPolicy: { mode: "MANUAL" } });
}
function syntheticFit(questionId: string, questionText: string) {
  const premiseHash = randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const evidenceFit = {
    schemaVersion: 1, ruleVersion: "post-verify-r1", normalizationVersion: "RAW_UTF16_V1",
    premise: {
      schemaVersion: 1, domain: "TECH_RESOURCE_MEASUREMENT", measurement: { name: "GPU_MEMORY", unit: "GB", period: "本轮实验" },
      checks: [
        { id: "SUBJECT", expected: "模型", basis: { kind: "QUESTION", quote: questionText.slice(0, 40) } },
        { id: "STAGE", expected: "推理", basis: { kind: "QUESTION", quote: questionText.slice(0, 40) } },
      ],
      questionId, goalHash: "g".repeat(64), constraintsVersion: 1, scopeVersion: 1, premiseHash, basisStatus: "UNRESOLVED",
    },
    fitStatus: "UNKNOWN", groups: [], eligibleGroups: [], excludedGroups: [], unresolvedChecks: [], conflicts: [],
    coverage: { sourceCount: 0, truncatedSourceIds: [], groupLimitSourceIds: [] }, semanticVerification: "NOT_CHECKED",
  };
  return {
    evidenceFit,
    fitHash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    observationExcerpts: [],
    review: { schemaVersion: 1, mode: "BACKGROUND_ONLY", note: "独立复验人工核对（fixture）", premiseHash, confirmedPremise: true },
    hardBlocked: false,
  };
}
/** 真实 recordFitReview 写入；返回 event id。 */
async function addReview(missionId: string, questionId: string, questionText: string): Promise<string> {
  let created: any = null;
  await db.$transaction(async (tx: any) => {
    const m = await tx.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    created = await recordFitReview(tx, m, syntheticFit(questionId, questionText) as never, syntheticFit(questionId, questionText).review as never);
  });
  return created.id;
}
async function addQuestion(missionId: string, questionText: string): Promise<string> {
  let created: any = null;
  await db.$transaction(async (tx: any) => { created = await event(tx, missionId, "QUESTION", { question: questionText }); });
  return created.id;
}
async function missionSnapshot(id: string) {
  const m = await db.agentMission.findUniqueOrThrow({ where: { id } });
  const [events, steps, outputs] = await Promise.all([db.agentMissionEvent.count({ where: { missionId: id } }), db.agentMissionStep.count({ where: { missionId: id } }), db.agentMissionOutput.count({ where: { missionId: id } })]);
  return plain({ version: m.version, updatedAt: m.updatedAt, nextEventSeq: m.nextEventSeq, counts: { events, steps, outputs } });
}
function evidenceBrief(rb: any) {
  return {
    legacy: {
      itemCount: rb.evidenceReviews?.items?.length ?? null,
      truncated: rb.evidenceReviews?.truncated ?? null,
      itemQuestionIds: (rb.evidenceReviews?.items ?? []).map((i: any) => i?.premise?.questionId ?? null),
      itemEventIds: (rb.evidenceReviews?.items ?? []).map((i: any) => i.eventId ?? null),
      questionFiltered: rb.evidenceReviews?.questionFiltered ?? null,
      questionId: rb.evidenceReviews?.questionId ?? null,
      windowLimit: rb.evidenceReviews?.windowLimit ?? null,
      displayLimit: rb.evidenceReviews?.displayLimit ?? null,
      inspected: rb.evidenceReviews?.inspected ?? null,
      note: rb.evidenceReviews?.note ?? null,
    },
    packet: {
      itemCount: rb.workPacket?.basis?.evidenceReviews?.items?.length ?? null,
      truncated: rb.workPacket?.basis?.evidenceReviews?.truncated ?? null,
      itemEventIds: (rb.workPacket?.basis?.evidenceReviews?.items ?? []).map((i: any) => i.eventId ?? null),
    },
    coverageWindow: (rb.workPacket?.coverage?.windows ?? []).find((w: any) => w.name === "EVIDENCE_REVIEWS") ?? null,
    basisQuestionId: rb.workPacket?.basis?.questionId ?? null,
    missionVersion: rb.missionVersion,
  };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "POST 独立复验：证据审查有界窗口（目标问题命中 ≤3、截断真、无 question 不回退、读零写入）",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace",
  commit: process.env.VERIFY_COMMIT ?? null,
  db: dbFile,
  scenarios: {},
};

/* ---------- 场景 A：目标审查被 21 条更新其他问题事件包围（BEFORE 复现的挤出场景） ---------- */
{
  const { user, project } = await owner("evicted");
  const m = await createFor(user.id, project.id, "POST 复验：证据窗口挤出场景");
  const targetQ = await addQuestion(m.id, "目标问题：本轮 GPU 显存是否超过上限？");
  const targetEventId = await addReview(m.id, targetQ, "目标问题：本轮 GPU 显存是否超过上限？");
  for (let i = 0; i < 21; i += 1) await addReview(m.id, `question-other-${i}-${randomUUID()}`, `其他问题 ${i}`);
  const before = await missionSnapshot(m.id);
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const after = await missionSnapshot(m.id);
  const brief = evidenceBrief(rb);
  result.scenarios.evicted = { missionId: m.id, targetQuestionId: targetQ, targetReviewEventId: targetEventId, evidence: brief, readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) } };
  check("PST-EVW-01", "21 条更新其他问题审查后，目标问题审查仍被命中", (brief.legacy.itemQuestionIds ?? []).includes(targetQ), { itemQuestionIds: brief.legacy.itemQuestionIds, targetQuestionId: targetQ });
  check("PST-EVW-02", "命中事件就是目标审查事件（身份可核）", (brief.legacy.itemEventIds ?? []).includes(targetEventId), { itemEventIds: brief.legacy.itemEventIds, targetEventId });
  check("PST-EVW-03", "返回条数 ≤3", (brief.legacy.itemCount ?? 99) <= 3, { itemCount: brief.legacy.itemCount });
  check("PST-EVW-04", "packet.basis.evidenceReviews 与 legacy 同命中", (brief.packet.itemEventIds ?? []).includes(targetEventId) && brief.packet.itemCount === brief.legacy.itemCount, brief.packet);
  check("PST-EVW-05", "该问题自身窗口未溢出时 truncated=false（不虚报截断）", brief.legacy.truncated === false && brief.legacy.itemCount === 1, { truncated: brief.legacy.truncated, itemCount: brief.legacy.itemCount });
  check("PST-EVW-06", "读回零写入", JSON.stringify(before) === JSON.stringify(after), { identical: JSON.stringify(before) === JSON.stringify(after) });
}

/* ---------- 场景 B：21 条边界（目标审查最早 + 20 条其他）---------- */
{
  const { user, project } = await owner("boundary");
  const m = await createFor(user.id, project.id, "POST 复验：证据窗口 21 条边界");
  const targetQ = await addQuestion(m.id, "边界问题：目标");
  const targetEventId = await addReview(m.id, targetQ, "边界问题：目标");
  for (let i = 0; i < 20; i += 1) await addReview(m.id, `question-boundary-other-${i}-${randomUUID()}`, `边界其他 ${i}`);
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const brief = evidenceBrief(rb);
  result.scenarios.boundary21 = { missionId: m.id, targetQuestionId: targetQ, evidence: brief };
  check("PST-EVW-07", "21 条边界场景目标审查仍被命中且 ≤3", (brief.legacy.itemEventIds ?? []).includes(targetEventId) && (brief.legacy.itemCount ?? 99) <= 3, { itemEventIds: brief.legacy.itemEventIds, itemCount: brief.legacy.itemCount });
}

/* ---------- 场景 C：同一目标问题超过窗口（22 条同问题审查）→ 截断诚实 ---------- */
{
  const { user, project } = await owner("target-overflow");
  const m = await createFor(user.id, project.id, "POST 复验：同问题窗口溢出");
  const targetQ = await addQuestion(m.id, "溢出问题：目标");
  const ids: string[] = [];
  for (let i = 0; i < 22; i += 1) ids.push(await addReview(m.id, targetQ, "溢出问题：目标"));
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const brief = evidenceBrief(rb);
  const newestIds = ids.slice(-3).reverse();
  result.scenarios.targetOverflow = { missionId: m.id, targetQuestionId: targetQ, authoredReviews: ids.length, newestThreeIds: newestIds, evidence: brief };
  check("PST-EVW-08", "同问题 22 条审查：只返回最近 3 条且 truncated=true", brief.legacy.itemCount === 3 && brief.legacy.truncated === true && JSON.stringify(brief.legacy.itemEventIds) === JSON.stringify(newestIds),
    { itemEventIds: brief.legacy.itemEventIds, newestThreeIds: newestIds, truncated: brief.legacy.truncated });
  check("PST-EVW-09", "窗口/展示上限与 inspected 计数可核（windowLimit=20, displayLimit=3, inspected≥21）", brief.legacy.windowLimit === 20 && brief.legacy.displayLimit === 3 && typeof brief.legacy.inspected === "number" && brief.legacy.inspected >= 21,
    { windowLimit: brief.legacy.windowLimit, displayLimit: brief.legacy.displayLimit, inspected: brief.legacy.inspected });
}

/* ---------- 场景 D：未选中 question（无输入、无 waitState）→ 不回退，保持旧窗口但诚实标注 ---------- */
{
  const { user, project } = await owner("no-question");
  const m = await createFor(user.id, project.id, "POST 复验：未选中问题");
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) ids.push(await addReview(m.id, `question-unselected-${i}-${randomUUID()}`, `未选中问题 ${i}`));
  const before = await missionSnapshot(m.id);
  const rb = await readMissionBack(user.id, m.id);
  const after = await missionSnapshot(m.id);
  const brief = evidenceBrief(rb);
  const expectedLatest3 = ids.slice(-3).reverse();
  result.scenarios.noQuestion = { missionId: m.id, authoredReviews: ids.length, expectedLatest3, evidence: brief, readOnly: { before, after, identical: JSON.stringify(before) === JSON.stringify(after) } };
  check("PST-EVW-10", "未选中问题时不无中生有按问题过滤（questionFiltered=false / questionId=null）", brief.legacy.questionFiltered === false && brief.legacy.questionId === null && (brief.legacy.note ?? "").length > 0,
    { questionFiltered: brief.legacy.questionFiltered, questionId: brief.legacy.questionId, note: brief.legacy.note });
  // BEFORE 语义（真实复现）：未选中问题时 selectedQuestionId=undefined，按 questionId 过滤后必然为空，
  // 旧窗口取 21 条 → items=[]、truncated=true。修复不得把“未找到”写成任何问题的命中，也不得把窗口截断说成没有。
  check("PST-EVW-11", "未选中问题不回退：保持旧窗口语义（items 为空、truncated 按 21 条窗口诚实=true），不伪造问题命中", brief.legacy.itemCount === 0 && brief.legacy.truncated === true && (brief.packet.itemCount ?? -1) === 0,
    { itemCount: brief.legacy.itemCount, truncated: brief.legacy.truncated, packetItemCount: brief.packet.itemCount, expectedLatest3 });
  check("PST-EVW-12", "未选中问题的读取零写入", JSON.stringify(before) === JSON.stringify(after), { identical: JSON.stringify(before) === JSON.stringify(after) });
}

/* ---------- 场景 E：waitStateJson.questionId 回退选中（无显式 questionId 入参）---------- */
{
  const { user, project } = await owner("waitstate");
  const m = await createFor(user.id, project.id, "POST 复验：waitState 选中问题");
  const targetQ = await addQuestion(m.id, "等待问题：目标");
  const targetEventId = await addReview(m.id, targetQ, "等待问题：目标");
  for (let i = 0; i < 21; i += 1) await addReview(m.id, `question-wait-other-${i}-${randomUUID()}`, `等待其他 ${i}`);
  await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_INPUT", waitStateJson: { waitingFor: "USER", questionId: targetQ, question: "等待问题：目标", missing: "PRIVATE", requirements: {}, startedAt: new Date().toISOString() } } });
  const rb = await readMissionBack(user.id, m.id);
  const brief = evidenceBrief(rb);
  result.scenarios.waitStateSelection = { missionId: m.id, targetQuestionId: targetQ, evidence: brief };
  check("PST-EVW-13", "无显式 questionId 时按 waitStateJson.questionId 先筛后限并命中目标审查", (brief.legacy.itemEventIds ?? []).includes(targetEventId) && brief.legacy.itemCount === 1 && brief.legacy.questionId === targetQ,
    { itemEventIds: brief.legacy.itemEventIds, questionId: brief.legacy.questionId, itemCount: brief.legacy.itemCount });
}

/* ---------- 场景 F：小窗口对照（≤窗口、≤3 条）不虚报 ---------- */
{
  const { user, project } = await owner("control");
  const m = await createFor(user.id, project.id, "POST 复验：对照");
  const targetQ = await addQuestion(m.id, "对照问题：目标");
  const targetEventId = await addReview(m.id, targetQ, "对照问题：目标");
  const rb = await readMissionBack(user.id, m.id, { questionId: targetQ });
  const brief = evidenceBrief(rb);
  result.scenarios.control = { missionId: m.id, targetQuestionId: targetQ, evidence: brief };
  check("PST-EVW-14", "对照：单条目标审查命中且 truncated=false", (brief.legacy.itemEventIds ?? []).includes(targetEventId) && brief.legacy.itemCount === 1 && brief.legacy.truncated === false, brief.legacy);
}

const pass = checks.filter((c) => c.verdict === "PASS").length, fail = checks.filter((c) => c.verdict === "FAIL").length;
result.checks = checks;
result.summary = { total: checks.length, pass, fail, notRun: 0 };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, summary: result.summary, failed: checks.filter((c) => c.verdict !== "PASS").map((c) => ({ id: c.id, detail: c.observed })) }, null, 2));
process.exit(fail > 0 ? 1 : 0);

