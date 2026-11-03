/**
 * BEFORE_FIX 独立特征化 3/3：primaryAction.requires 字段在 12 个原端点上的真实接受/拒绝矩阵。
 *
 * 运行（干净 shadow 根目录）：npx.cmd tsx verify-fixtures/baseline-requires.ts <输出JSON绝对路径>
 *
 * 方法：每个端点先用真实服务建最小合法 fixture（真实 session cookie 调真实 route handler），
 * 记录 base body 的基线结果；再把每个 requires 字段单独注入 base body，区分：
 *   ENTRY_ZOD_REJECTS_UNKNOWN_FIELD (422 VALIDATION_ERROR + unrecognized_keys 含该字段)
 *   ENTRY_ACCEPTS_AS_REQUEST_FIELD  (2xx 或进入服务 fence 的 409/422-other)
 * 另外每端点做一次“整包 requires 盲发”与一组真实 fence 负例（错误码来自真实服务）。
 * 独立临时 SQLite、migrations 重放、mock、未改产品源码、无网络/外部写入。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const outPath = process.argv[2];
if (!outPath) throw new Error("用法：tsx baseline-requires.ts <输出JSON绝对路径>");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-post-base-requires-"));
const dbFile = path.join(dir, "verify.db");
process.env.DATABASE_URL = "file:" + dbFile.replaceAll("\\", "/");
Object.assign(process.env, {
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
const { readMissionResponsibility } = await import("@/lib/mission/responsibility");
const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
const { event } = await import("@/lib/mission/repository");
const { createSession } = await import("@/lib/auth/session");

const inputPost = (await import("@/app/api/missions/[id]/input/route")).POST;
const approvalPost = (await import("@/app/api/missions/[id]/approvals/[approvalId]/route")).POST;
const pausePost = (await import("@/app/api/missions/[id]/pause/route")).POST;
const cancelPost = (await import("@/app/api/missions/[id]/cancel/route")).POST;
const resumePost = (await import("@/app/api/missions/[id]/resume/route")).POST;
const replanPost = (await import("@/app/api/missions/[id]/replan/route")).POST;
const constraintsPatch = (await import("@/app/api/missions/[id]/constraints/route")).PATCH;
const researchScopePatch = (await import("@/app/api/missions/[id]/research-scope/route")).PATCH;
const continuationPolicyPatch = (await import("@/app/api/missions/[id]/continuation-policy/route")).PATCH;
const responsibilityPatch = (await import("@/app/api/missions/[id]/responsibility/route")).PATCH;
const continuationConfirmPost = (await import("@/app/api/missions/[id]/continuations/confirm/route")).POST;
const artifactConfirmPost = (await import("@/app/api/missions/[id]/outputs/[outputId]/artifact-confirm/route")).POST;

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const REQUIRES_FIELDS = [
  { key: "missionVersion", sample: 1 },
  { key: "planRevision", sample: 1 },
  { key: "contextVersion", sample: 1 },
  { key: "constraintsVersion", sample: 1 },
  { key: "researchScopeVersion", sample: 1 },
  { key: "controlVersion", sample: "cv-post-verify" },
  { key: "questionId", sample: "question-post-verify" },
  { key: "approvalId", sample: "approval-post-verify" },
  { key: "proposalHash", sample: "proposal-hash-post-verify" },
  { key: "requiredSourceRevisions", sample: ["capture:post-verify@deadbeef"] },
  { key: "boundaryAt", sample: "2026-12-31T00:00:00.000Z" },
];
const ENDPOINTS = [
  { kind: "input", method: "POST" }, { kind: "approvals", method: "POST" },
  { kind: "pause", method: "POST" }, { kind: "cancel", method: "POST" }, { kind: "resume", method: "POST" },
  { kind: "replan", method: "POST" }, { kind: "constraints", method: "PATCH" }, { kind: "research-scope", method: "PATCH" },
  { kind: "continuation-policy", method: "PATCH" }, { kind: "responsibility", method: "PATCH" },
  { kind: "continuations-confirm", method: "POST" }, { kind: "artifact-confirm", method: "POST" },
];

async function owner(label: string) {
  const user = await db.user.create({ data: { username: `post-req-${label}-${randomUUID()}`, displayName: `独立验收 ${label}`, passwordHash: "unused" } });
  const project = await db.project.create({
    data: { title: `独立验收 requires ${label}`, description: "SYNTHETIC_POST_VERIFY_REQUIRES", goal: "requires 字段端点矩阵", scenario: "RESEARCH" as never, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  const session = await createSession(user.id);
  return { userId: user.id, projectId: project.id, token: session.token };
}
async function addEvent(missionId: string, type: string, payload: unknown) {
  const m = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: m.nextEventSeq, type, payloadJson: payload as never } });
}
async function newMission(ctx: { userId: string; projectId: string }, goal: string) {
  return createMission(ctx.userId, {
    projectId: ctx.projectId, requestId: `req-${randomUUID()}`, goal, successCriteria: ["DRAFT_EXISTS"],
    missionConstraints: {}, researchScope: {}, llmContextApproved: false, continuationPolicy: { mode: "MANUAL" },
  });
}

/** 每端点一个模板：返回 fresh fixture 上下文（mission 已置为端点所需状态）。 */
async function setup(kind: string, ctx: { userId: string; projectId: string; token: string; capture?: { id: string; hash: string } }) {
  const m = await newMission(ctx, `独立验收 requires 矩阵 ${kind} ${randomUUID()}`);
  const out: Record<string, any> = { missionId: m.id, version: m.version, contextVersion: m.contextVersion, constraintsVersion: m.constraintsVersion, researchScopeVersion: m.researchScopeVersion };
  if (kind === "input" || kind === "continuations-confirm") {
    const question = await addEvent(m.id, "QUESTION", { question: `独立验收问题（${kind}）`, missing: "PRIVATE", requirements: {} });
    const pointer = ctx.capture ?? { id: "capture:missing", hash: "0".repeat(64) };
    await db.agentMission.update({
      where: { id: m.id },
      data: {
        status: "WAITING_INPUT", version: { increment: 1 },
        waitStateJson: { waitingFor: "USER", questionId: question.id, question: `独立验收问题（${kind}）`, missing: "PRIVATE", requirements: {}, startedAt: new Date().toISOString(), readSet: [] },
      },
    });
    out.questionId = question.id; out.pointer = pointer;
    const fresh = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    out.version = fresh.version;
  } else if (kind === "approvals" || kind === "replan") {
    const question = await addEvent(m.id, "QUESTION", { question: `独立验收提案问题（${kind}）` });
    const step = await db.agentMissionStep.create({
      data: {
        missionId: m.id, ordinal: 1, planRevision: m.planRevision, toolName: "propose_action", status: "WAITING_APPROVAL",
        canonicalInputJson: {}, inputHash: `hash-${randomUUID()}`, readSetJson: [],
      },
    });
    const approval = await db.agentMissionApproval.create({
      data: {
        missionId: m.id, stepId: step.id, proposalHash: `proposal-${randomUUID()}`,
        proposalJson: { args: { title: "独立验收待批准行动", action: { title: "独立验收行动" } } },
        expectedPlanRevision: m.planRevision, readSetJson: [], status: "PENDING",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_APPROVAL", version: { increment: 1 } } });
    out.approvalId = approval.id; out.proposalHash = approval.proposalHash; out.questionId = question.id;
    out.version = (await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).version;
  } else if (kind === "resume") {
    await db.agentMission.update({ where: { id: m.id }, data: { status: "PAUSED", version: { increment: 1 }, planJson: { resumeStatus: "READY" }, pauseReason: "USER", pauseRequestedAt: new Date() } });
    out.version = (await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).version;
  } else if (kind === "artifact-confirm") {
    const output = await db.agentMissionOutput.create({
      data: {
        missionId: m.id, revision: 1, kind: "RESEARCH",
        contentJson: { schemaVersion: 1, kind: "RESEARCH", blocks: [{ blockId: "b1", text: "独立验收草稿：推断段落，不宣称现实成立。", kind: "INFERENCE", sourceIds: [] }], missingInformation: [] },
        sourceRefsJson: [], claimChecksJson: [],
      },
    });
    out.outputId = output.id;
  }
  // constraints / research-scope / continuation-policy / responsibility / pause / cancel 保持默认 READY。
  return { ...ctx, ...out, missionId: m.id };
}

function request(ctx: any, urlPath: string, method: string, body: unknown) {
  return new Request(`https://fixture.invalid${urlPath}`, {
    method, headers: { cookie: `pm_session=${ctx.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
async function call(kind: string, ctx: any, body: unknown, override?: Record<string, any>) {
  const id = ctx.missionId;
  switch (kind) {
    case "input": return inputPost(request(ctx, `/api/missions/${id}/input`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "approvals": return approvalPost(request(ctx, `/api/missions/${id}/approvals/${override?.approvalId ?? ctx.approvalId}`, "POST", body), { params: Promise.resolve({ id, approvalId: override?.approvalId ?? ctx.approvalId }) } as never);
    case "pause": return pausePost(request(ctx, `/api/missions/${id}/pause`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "cancel": return cancelPost(request(ctx, `/api/missions/${id}/cancel`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "resume": return resumePost(request(ctx, `/api/missions/${id}/resume`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "replan": return replanPost(request(ctx, `/api/missions/${id}/replan`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "constraints": return constraintsPatch(request(ctx, `/api/missions/${id}/constraints`, "PATCH", body), { params: Promise.resolve({ id }) } as never);
    case "research-scope": return researchScopePatch(request(ctx, `/api/missions/${id}/research-scope`, "PATCH", body), { params: Promise.resolve({ id }) } as never);
    case "continuation-policy": return continuationPolicyPatch(request(ctx, `/api/missions/${id}/continuation-policy`, "PATCH", body), { params: Promise.resolve({ id }) } as never);
    case "responsibility": return responsibilityPatch(request(ctx, `/api/missions/${id}/responsibility`, "PATCH", body), { params: Promise.resolve({ id }) } as never);
    case "continuations-confirm": return continuationConfirmPost(request(ctx, `/api/missions/${id}/continuations/confirm`, "POST", body), { params: Promise.resolve({ id }) } as never);
    case "artifact-confirm": return artifactConfirmPost(request(ctx, `/api/missions/${id}/outputs/${ctx.outputId}/artifact-confirm`, "POST", body), { params: Promise.resolve({ id, outputId: ctx.outputId }) } as never);
    default: throw new Error(`未知端点 ${kind}`);
  }
}
async function baseBody(kind: string, ctx: any) {
  const requestId = `post-req-${randomUUID()}`;
  switch (kind) {
    case "input": return { requestId, expectedVersion: ctx.version, questionId: ctx.questionId, answer: "独立验收：补充原始记录（fixture）" };
    case "approvals": return { requestId, expectedVersion: ctx.version, decision: "REJECTED", proposalHash: ctx.proposalHash };
    case "pause": case "cancel": case "replan": return { requestId, expectedVersion: ctx.version };
    case "resume": return { requestId, expectedVersion: ctx.version };
    case "constraints": return { requestId, expectedVersion: ctx.version, expectedConstraintsVersion: ctx.constraintsVersion, constraints: {} };
    case "research-scope": return { requestId, expectedVersion: ctx.version, expectedScopeVersion: ctx.researchScopeVersion, scope: {} };
    case "continuation-policy": return { requestId, expectedVersion: ctx.version, policy: { mode: "MANUAL" } };
    case "responsibility": {
      const r = await readMissionResponsibility(ctx.userId, ctx.missionId);
      return { requestId, expectedControlVersion: r.controlVersion };
    }
    case "continuations-confirm": return {
      requestId, expectedVersion: ctx.version, expectedContextVersion: ctx.contextVersion,
      questionId: ctx.questionId, sourcePointers: [ctx.pointer], answer: "独立验收材料接续回答",
      confirmedGap: true, assessmentHash: "post-verify-assessment-hash",
    };
    case "artifact-confirm": return { requestId, artifactType: "weekly_report", expectedOutputRevision: 1, expectedContextVersion: ctx.contextVersion, previewHash: "post-verify-preview-hash" };
    default: throw new Error(`未知端点 base ${kind}`);
  }
}
async function execute(kind: string, ctx: any, body: unknown, override?: Record<string, any>) {
  const res = await call(kind, ctx, body, override);
  const json = plain(await res.json().catch(() => ({})));
  return {
    status: res.status, errorCode: json?.error?.code ?? null,
    errorMessage: json?.error?.message ?? null,
    issues: Array.isArray(json?.error?.details) ? json.error.details : [],
    hasMissionOrResult: !!json?.mission || !!json?.responsibility || !!json?.receipt || json?.continued !== undefined,
    bodyPreview: JSON.stringify(json).slice(0, 400),
  };
}
function classify(kind: string, field: string, outcome: any) {
  const unrecognized = outcome.issues.filter((i: any) => i?.code === "unrecognized_keys");
  const rejectedKeys = unrecognized.flatMap((i: any) => i?.keys ?? []);
  if (outcome.status === 422 && rejectedKeys.includes(field)) return { layer: "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD", rejectedKeys };
  if (outcome.status === 200 || outcome.status === 202) return { layer: "ENTRY_ACCEPTS_AS_REQUEST_FIELD", rejectedKeys };
  return { layer: "ENTRY_ACCEPTS_FIELD_THEN_SERVICE_FENCE", rejectedKeys };
}

const result: Record<string, any> = {
  generatedAt: new Date().toISOString(),
  purpose: "POST 独立复验：requires 端点矩阵 + 认证/越权/契约/服务端重导出/新 fence",
  sourceTree: process.env.VERIFY_SOURCE_TREE ?? "workspace HEAD 4b69614 via git archive shadow",
  method: "真实 route handler + 真实 AuthSession cookie + 独立临时 SQLite fixture；每个矩阵单元使用全新 mission；base body 对照 + 单字段注入 + requires 整包盲发 + 真实 fence 负例",
  db: dbFile,
  requiresFields: REQUIRES_FIELDS.map((f) => f.key),
  endpoints: ENDPOINTS.map((e) => e.kind),
  fieldSemantics: {
    missionVersion: { requestField: "expectedVersion", endpoints: ["input", "approvals", "pause", "cancel", "resume", "replan", "continuation-policy", "continuations-confirm"], fence: "commandMission/editContinuationPolicy/confirmContinuation 直接比较 m.version" },
    planRevision: { requestField: null, fence: "approval.expectedPlanRevision 在提案时固化，服务端比较 m.planRevision；无请求字段" },
    contextVersion: { requestField: "expectedContextVersion", endpoints: ["continuations-confirm", "artifact-confirm"], fence: "服务端比较 m.contextVersion" },
    constraintsVersion: { requestField: "expectedConstraintsVersion", endpoints: ["constraints"], fence: "editMission 比较 m.constraintsVersion" },
    researchScopeVersion: { requestField: "expectedScopeVersion", endpoints: ["research-scope"], fence: "editMission 比较 m.researchScopeVersion" },
    controlVersion: { requestField: "expectedControlVersion", endpoints: ["responsibility"], fence: "readMissionResponsibility 重算 controlVersion 后比较" },
    questionId: { requestField: "questionId", endpoints: ["input", "continuations-confirm"], fence: "服务端匹配当前 QUESTION 事件/ waitStateJson.questionId" },
    approvalId: { requestField: "路径参数 approvalId", endpoints: ["approvals"], fence: "服务端按 missionId+status=PENDING 查原审批" },
    proposalHash: { requestField: "proposalHash", endpoints: ["approvals"], fence: "服务端比较 approval.proposalHash" },
    requiredSourceRevisions: { requestField: null, fence: "服务端从原 Source 指针/sourceRefsJson 重查 validateSources；无请求字段" },
    boundaryAt: { requestField: null, fence: "服务端在提交时重读责任/权限/边界；无请求字段" },
  },
  matrix: [] as any[], controls: [] as any[], fullForward: [] as any[], fences: [] as any[],
};

const ctxs: Record<string, any> = {};
for (const endpoint of ENDPOINTS) {
  const kind = endpoint.kind;
  const ctxBase: {userId: string; projectId: string; token: string; capture?: {id: string; hash: string}} = await owner(kind);
  // 材料接续需要真实可读 capture
  if (kind === "continuations-confirm") {
    const capture = await db.capture.create({ data: { projectId: ctxBase.projectId, rawText: "2026-10-30 独立验收接续材料：推理显存 6.2 GB，演示数据。" } });
    const source = await readProjectMaterial(ctxBase.projectId, `capture:${capture.id}`);
    ctxBase.capture = { id: source!.id, hash: source!.hash };
  }
  ctxs[kind] = ctxBase;

  // requires 采样：真实 readback 的 primaryAction.requires
  {
    const sample = await setup(kind, ctxBase);
    const rb = await readMissionBack(ctxBase.userId, sample.missionId);
    result[`requiresSample_${kind}`] = rb.workPacket?.next?.primaryAction?.requires ?? null;
  }

  // 1) 控制组：base body（单次全新 fixture）
  {
    const ctx = await setup(kind, ctxBase);
    const body = await baseBody(kind, ctx);
    const outcome = await execute(kind, ctx, body);
    result.controls.push({ endpoint: kind, ...outcome, classified: outcome.status === 200 || outcome.status === 202 ? "BASE_VALID_ACCEPTED" : outcome.status === 409 ? "BASE_STRUCTURALLY_VALID_REACHED_FENCE" : outcome.status === 422 ? "BASE_INVALID" : "OTHER" });
  }

  // 2) 矩阵：每个 requires 字段单独注入
  for (const field of REQUIRES_FIELDS) {
    const ctx = await setup(kind, ctxBase);
    const body = { ...(await baseBody(kind, ctx)), [field.key]: field.sample };
    const outcome = await execute(kind, ctx, body);
    result.matrix.push({ endpoint: kind, field: field.key, sampleValue: field.sample, ...outcome, ...classify(kind, field.key, outcome) });
  }

  // 3) 整包 requires 盲发（C/D 若把 requires 当请求字段透传会发生什么）
  {
    const ctx = await setup(kind, ctxBase);
    const body = { ...(await baseBody(kind, ctx)), ...(result[`requiresSample_${kind}`] ?? {}) };
    const outcome = await execute(kind, ctx, body);
    const unrecognized = outcome.issues.filter((i: any) => i?.code === "unrecognized_keys");
    result.fullForward.push({
      endpoint: kind, status: outcome.status, errorCode: outcome.errorCode,
      rejectedRequiresKeys: unrecognized.flatMap((i: any) => i?.keys ?? []),
      note: "把 readback.primaryAction.requires 作为请求字段整包盲发",
    });
  }
}

/* ---------- 真实 fence 负例（错误码来自真实服务） ---------- */
async function fence(label: string, kind: string, build: (ctx: any) => Promise<{ body: unknown; override?: Record<string, any>; ctxPatch?: (ctx: any) => Promise<void> }>) {
  const ctx = await setup(kind, ctxs[kind]);
  if (build.length) { /* noop */ }
  const spec = await build(ctx);
  if (spec.ctxPatch) await spec.ctxPatch(ctx);
  const outcome = await execute(kind, ctx, spec.body, spec.override);
  result.fences.push({ label, endpoint: kind, ...outcome });
}
{
  const mk = async (kind: string, bodyPatch: (b: any, ctx: any) => any) => {
    const ctx = await setup(kind, ctxs[kind]);
    const body = await baseBody(kind, ctx);
    return { ctx, body: bodyPatch(body, ctx) };
  };
  // input：旧 expectedVersion / 旧 question
  { const { ctx, body } = await mk("input", (b, c) => ({ ...b, expectedVersion: c.version + 7 })); const outcome = await execute("input", ctx, body); result.fences.push({ label: "input 旧 expectedVersion（missionVersion 等价字段）", endpoint: "input", ...outcome }); }
  { const { ctx, body } = await mk("input", (b) => ({ ...b, questionId: "stale-question-id" })); const outcome = await execute("input", ctx, body); result.fences.push({ label: "input 错误 questionId", endpoint: "input", ...outcome }); }
  // approvals：错误 proposalHash；错误 approvalId 路径
  { const { ctx, body } = await mk("approvals", (b) => ({ ...b, proposalHash: "wrong-hash" })); const outcome = await execute("approvals", ctx, body); result.fences.push({ label: "approvals 错误 proposalHash", endpoint: "approvals", ...outcome }); }
  { const { ctx, body } = await mk("approvals", (b) => b); const outcome = await execute("approvals", ctx, body, { approvalId: "missing-approval-id" }); result.fences.push({ label: "approvals 错误 approvalId（路径）", endpoint: "approvals", ...outcome }); }
  // pause/cancel/resume：旧 expectedVersion
  for (const kind of ["pause", "cancel", "resume"]) { const { ctx, body } = await mk(kind, (b, c) => ({ ...b, expectedVersion: c.version + 7 })); const outcome = await execute(kind, ctx, body); result.fences.push({ label: `${kind} 旧 expectedVersion`, endpoint: kind, ...outcome }); }
  // resume：非 PAUSED 状态
  { const ctx = await setup("pause", ctxs.pause); const body = await baseBody("resume", ctx); const outcome = await execute("resume", ctx, body); result.fences.push({ label: "resume 在非 PAUSED 状态", endpoint: "resume", ...outcome }); }
  // replan：非 WAITING_APPROVAL
  { const ctx = await setup("pause", ctxs.pause); const body = await baseBody("replan", ctx); const outcome = await execute("replan", ctx, body); result.fences.push({ label: "replan 在非 WAITING_APPROVAL 状态", endpoint: "replan", ...outcome }); }
  // constraints / research-scope：旧版本期望
  { const { ctx, body } = await mk("constraints", (b) => ({ ...b, expectedConstraintsVersion: 99 })); const outcome = await execute("constraints", ctx, body); result.fences.push({ label: "constraints 旧 expectedConstraintsVersion", endpoint: "constraints", ...outcome }); }
  { const { ctx, body } = await mk("research-scope", (b) => ({ ...b, expectedScopeVersion: 99 })); const outcome = await execute("research-scope", ctx, body); result.fences.push({ label: "research-scope 旧 expectedScopeVersion", endpoint: "research-scope", ...outcome }); }
  { const { ctx, body } = await mk("continuation-policy", (b, c) => ({ ...b, expectedVersion: c.version + 7 })); const outcome = await execute("continuation-policy", ctx, body); result.fences.push({ label: "continuation-policy 旧 expectedVersion", endpoint: "continuation-policy", ...outcome }); }
  // responsibility：错误 expectedControlVersion
  { const { ctx, body } = await mk("responsibility", (b) => ({ ...b, expectedControlVersion: "stale-control-version" })); const outcome = await execute("responsibility", ctx, body); result.fences.push({ label: "responsibility 错误 expectedControlVersion（controlVersion 等价字段）", endpoint: "responsibility", ...outcome }); }
  // continuations-confirm：错误 expectedContextVersion
  { const { ctx, body } = await mk("continuations-confirm", (b) => ({ ...b, expectedContextVersion: 99 })); const outcome = await execute("continuations-confirm", ctx, body); result.fences.push({ label: "continations-confirm 旧 expectedContextVersion", endpoint: "continuations-confirm", ...outcome }); }
  // artifact-confirm：错误 expectedContextVersion
  { const { ctx, body } = await mk("artifact-confirm", (b) => ({ ...b, expectedContextVersion: 99 })); const outcome = await execute("artifact-confirm", ctx, body); result.fences.push({ label: "artifact-confirm 旧 expectedContextVersion", endpoint: "artifact-confirm", ...outcome }); }
}

/* ---------- POST 追加：认证 / 越权 / 契约 / 服务端重导出 / 新 fence 负例 ---------- */
const postChecks: Array<{ id: string; question: string; verdict: "PASS" | "FAIL" | "NOT_RUN"; observed: unknown; note?: string }> = [];
const pc = (id: string, question: string, pass: boolean, observed: unknown, note?: string) =>
  postChecks.push({ id, question, verdict: pass ? "PASS" : "FAIL", observed, ...(note ? { note } : {}) });
const outsider = await db.user.create({ data: { username: `post-req-outsider-${randomUUID()}`, displayName: "越权测试用户", passwordHash: "unused" } });
const outsiderSession = await createSession(outsider.id);

// 1) 未认证 → 401 UNAUTHORIZED（12 端点真实入口）
const unauth: any[] = [];
for (const endpoint of ENDPOINTS) {
  const kind = endpoint.kind;
  const ctx = await setup(kind, ctxs[kind]);
  const body = await baseBody(kind, ctx);
  const outcome = await execute(kind, { ...ctx, token: "" }, body);
  unauth.push({ endpoint: kind, status: outcome.status, errorCode: outcome.errorCode });
}
pc("PST-REQ-01", "12 个端点未认证请求真实返回 401 UNAUTHORIZED", unauth.length === 12 && unauth.every((u) => u.status === 401 && u.errorCode === "UNAUTHORIZED"), unauth);

// 2) 非 Owner → 404 MISSION_NOT_FOUND（12 端点真实入口，统一 404 不泄露存在性）
const forbidden: any[] = [];
for (const endpoint of ENDPOINTS) {
  const kind = endpoint.kind;
  const ctx = await setup(kind, ctxs[kind]);
  const body = await baseBody(kind, ctx);
  const outcome = await execute(kind, { ...ctx, token: outsiderSession.token }, body);
  forbidden.push({ endpoint: kind, status: outcome.status, errorCode: outcome.errorCode });
}
pc("PST-REQ-02", "12 个端点非 Owner 请求真实返回 404 MISSION_NOT_FOUND（不返回 403/数据）", forbidden.length === 12 && forbidden.every((f) => f.status === 404 && f.errorCode === "MISSION_NOT_FOUND"), forbidden);

// 3) requires 契约形状稳定（11 字段，名称不漂移；target/readOnly/submissionGuard 存在）
{
  const ctx = await setup("pause", ctxs.pause);
  const rb = await readMissionBack(ctx.userId, ctx.missionId);
  const action = rb.workPacket?.next?.primaryAction;
  const keys = action?.requires ? Object.keys(action.requires).sort() : [];
  const expected = REQUIRES_FIELDS.map((f) => f.key).sort();
  pc("PST-REQ-03", "readback.primaryAction.requires 仍为 11 个约定字段（C/D 消费形状稳定）", JSON.stringify(keys) === JSON.stringify(expected) && action?.readOnly === true && typeof action?.submissionGuard === "string",
    { keys, expected, readOnly: action?.readOnly ?? null, submissionGuard: action?.submissionGuard ?? null });
}

// 4) requiredSourceRevisions 由服务端从原来源重导出（不是请求字段）：真实材料绑定后出现在 requires 中
{
  const ctxBase: any = ctxs["input"];
  const capture = await db.capture.create({ data: { projectId: ctxBase.projectId, rawText: "2026-10-30 独立复验重导出材料：推理显存 6.2 GB，演示数据。" } });
  const source = await readProjectMaterial(ctxBase.projectId, `capture:${capture.id}`);
  const ctx: any = await setup("input", { ...ctxBase, capture: { id: source!.id, hash: source!.hash } });
  await addEvent(ctx.missionId, "SOURCE_ASSOCIATED", { questionId: ctx.questionId, pointers: [ctx.pointer] });
  const rb = await readMissionBack(ctx.userId, ctx.missionId, { questionId: ctx.questionId });
  const derived = rb.workPacket?.next?.primaryAction?.requires?.requiredSourceRevisions ?? [];
  const expectedEntry = `${source!.id}@${source!.hash}`;
  pc("PST-REQ-04", "requiredSourceRevisions 由服务端从原来源重导出且包含真实绑定来源", Array.isArray(derived) && derived.includes(expectedEntry), { derived, expectedEntry, materialItems: rb.materialUses?.items?.length ?? null, currentUse: rb.materialUses?.items?.map((i: any) => i.currentUse?.state ?? null) ?? null });
}

// 5) requiredSourceRevisions 作为请求字段被 strict 入口拒绝（非请求字段）
{
  const ctx = await setup("input", ctxs["input"]);
  const body = { ...(await baseBody("input", ctx)), requiredSourceRevisions: ["capture:x@deadbeef"] };
  const outcome = await execute("input", ctx, body);
  const rejectedKeys = outcome.issues.filter((i: any) => i?.code === "unrecognized_keys").flatMap((i: any) => i?.keys ?? []);
  pc("PST-REQ-05", "requiredSourceRevisions 仍是入口拒绝的非请求字段（422 unrecognized_keys）", outcome.status === 422 && rejectedKeys.includes("requiredSourceRevisions"), { status: outcome.status, errorCode: outcome.errorCode, rejectedKeys });
}

// 6) 服务端对来源重新校验（不是只信客户端 requiredSourceRevisions）：continuations confirm 旧 hash → 409 SOURCE_CHANGED
{
  const ctx: any = await setup("continuations-confirm", ctxs["continuations-confirm"]);
  const body = await baseBody("continuations-confirm", ctx);
  const stale = { ...body, sourcePointers: [{ id: ctx.pointer.id, hash: "0".repeat(64) }] };
  const outcome = await execute("continuations-confirm", ctx, stale);
  pc("PST-REQ-06", "材料接续：旧来源 hash 被服务端重查拒绝 409 SOURCE_CHANGED", outcome.status === 409 && outcome.errorCode === "SOURCE_CHANGED", { status: outcome.status, errorCode: outcome.errorCode });
}

// 7) input 原问题 fence：以 waitState 未解决原问题为准（新观察事件不得替换原问题身份）
{
  const ctxBase: any = ctxs["input"];
  const ctx = await setup("input", ctxBase);
  const newer = await addEvent(ctx.missionId, "INVESTIGATION_OBSERVATION_CHANGED", { questionId: `obs-${randomUUID()}`, summary: "新观察事件" });
  const bodyStale = { ...(await baseBody("input", ctx)), questionId: newer.id };
  const stale = await execute("input", ctx, bodyStale);
  const ctx2 = await setup("input", ctxBase);
  const newer2 = await addEvent(ctx2.missionId, "INVESTIGATION_OBSERVATION_CHANGED", { questionId: `obs-${randomUUID()}`, summary: "新观察事件" });
  const bodyWait = await baseBody("input", ctx2);
  const accepted = await execute("input", ctx2, bodyWait);
  pc("PST-REQ-07", "input：等待回答的原问题身份按 waitState 绑定（waitState.questionId 被接受、更新观察事件 id 被拒绝 INPUT_CHANGED）", accepted.status === 202 && stale.status === 409 && stale.errorCode === "INPUT_CHANGED",
    { waitStateQuestionAccepted: { status: accepted.status, errorCode: accepted.errorCode }, newerEventQuestion: { id: newer2.id, status: stale.status, errorCode: stale.errorCode } });
}

// 7b) 跨问题 409：任务已有更新的 QUESTION 事件（q2）但不是当前未解决原问题时，回答 q2 必须被拒绝
{
  const ctx = await setup("input", ctxs["input"]);
  const q2 = await addEvent(ctx.missionId, "QUESTION", { question: "另一个问题（不是当前等待原问题）", missing: "PRIVATE", requirements: {} });
  const stale = await execute("input", ctx, { ...(await baseBody("input", ctx)), questionId: q2.id });
  pc("PST-REQ-15", "跨问题：用另一个 QUESTION 事件 id 回答（且该事件更新）被 409 INPUT_CHANGED 拒绝", stale.status === 409 && stale.errorCode === "INPUT_CHANGED", { question2EventId: q2.id, status: stale.status, errorCode: stale.errorCode });
}
// 8) GET readback 仍拒绝 requires 字段作为查询参数（入口即拒）
{
  const ctx = await setup("pause", ctxs.pause);
  const session = await createSession(ctx.userId);
  const res = await (await import("@/app/api/missions/[id]/readback/route")).GET(
    new Request(`https://fixture.invalid/api/missions/${ctx.missionId}/readback?missionVersion=1&boundaryAt=x`, { headers: { cookie: `pm_session=${session.token}` } }),
    { params: Promise.resolve({ id: ctx.missionId }) } as never,
  );
  const body = plain(await res.json());
  const rejectedKeys = (Array.isArray(body?.error?.details) ? body.error.details : []).filter((i: any) => i?.code === "unrecognized_keys").flatMap((i: any) => i?.keys ?? []);
  pc("PST-REQ-08", "GET readback 把 requires 字段当查询参数时 422 VALIDATION_ERROR（unrecognized_keys）", res.status === 422 && rejectedKeys.includes("missionVersion"), { status: res.status, errorCode: body?.error?.code ?? null, rejectedKeys });
}

// 8b) requires.controlVersion 与 responsibility 重算值一致；boundaryAt 与最早有效边界一致（服务端重导出可核）
{
  const ctx = await setup("pause", ctxs.pause);
  const rb = await readMissionBack(ctx.userId, ctx.missionId);
  const requires = rb.workPacket?.next?.primaryAction?.requires ?? null;
  const resp = await readMissionResponsibility(ctx.userId, ctx.missionId);
  const boundary = rb.workPacket?.authority?.nextBoundary ?? null;
  pc("PST-REQ-12", "requires.controlVersion 与服务端 readMissionResponsibility 重算值一致（不是客户端可伪造字段）", !!requires && requires.controlVersion === resp.controlVersion, { requiresControlVersion: requires?.controlVersion ?? null, responsibilityControlVersion: resp.controlVersion });
  pc("PST-REQ-13", "requires.boundaryAt 等于服务端从原记录重算的最早有效边界", (requires?.boundaryAt ?? null) === boundary, { requiresBoundaryAt: requires?.boundaryAt ?? null, authorityNextBoundary: boundary });
}
{
  // 设置未来 deadline，验证 boundaryAt 由原 constraints 重导出
  const ctx = await setup("pause", ctxs.pause);
  const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const constraints = { ...(await db.agentMission.findUniqueOrThrow({ where: { id: ctx.missionId } })).constraintsJson as object, deadline };
  await db.agentMission.update({ where: { id: ctx.missionId }, data: { constraintsJson: constraints as never } });
  const rb = await readMissionBack(ctx.userId, ctx.missionId);
  const requires = rb.workPacket?.next?.primaryAction?.requires ?? null;
  const resp = await readMissionResponsibility(ctx.userId, ctx.missionId);
  pc("PST-REQ-14", "未来 deadline 被服务端重导出为 requires.boundaryAt（=deadline）且与 authority.nextBoundary 一致", requires?.boundaryAt === deadline && rb.workPacket?.authority?.nextBoundary === deadline && resp.permissionState === "WITHIN_TIME_BOUNDARY", { deadline, requiresBoundaryAt: requires?.boundaryAt ?? null, authorityNextBoundary: rb.workPacket?.authority?.nextBoundary ?? null, permissionState: resp.permissionState });
}
// 9) fence 期望表（与 BEFORE 基线同错误码；真实服务返回）
const FENCE_EXPECT: Record<string, { status: number; code: string }> = {
  "input 旧 expectedVersion（missionVersion 等价字段）": { status: 409, code: "MISSION_CHANGED" },
  "input 错误 questionId": { status: 409, code: "INPUT_CHANGED" },
  "approvals 错误 proposalHash": { status: 409, code: "APPROVAL_CHANGED" },
  "approvals 错误 approvalId（路径）": { status: 409, code: "APPROVAL_CHANGED" },
  "pause 旧 expectedVersion": { status: 409, code: "MISSION_CHANGED" },
  "cancel 旧 expectedVersion": { status: 409, code: "MISSION_CHANGED" },
  "resume 旧 expectedVersion": { status: 409, code: "MISSION_CHANGED" },
  "resume 在非 PAUSED 状态": { status: 409, code: "MISSION_NOT_PAUSED" },
  "replan 在非 WAITING_APPROVAL 状态": { status: 409, code: "INVALID_TRANSITION" },
  "constraints 旧 expectedConstraintsVersion": { status: 409, code: "MISSION_CHANGED" },
  "research-scope 旧 expectedScopeVersion": { status: 409, code: "MISSION_CHANGED" },
  "continuation-policy 旧 expectedVersion": { status: 409, code: "MISSION_CHANGED" },
  "responsibility 错误 expectedControlVersion（controlVersion 等价字段）": { status: 409, code: "MISSION_CHANGED" },
  "continations-confirm 旧 expectedContextVersion": { status: 409, code: "ASSESSMENT_CHANGED" },
  "artifact-confirm 旧 expectedContextVersion": { status: 409, code: "OUTPUT_CHANGED" },
};
const fenceMismatch = result.fences.filter((f: any) => !FENCE_EXPECT[f.label] || FENCE_EXPECT[f.label].status !== f.status || FENCE_EXPECT[f.label].code !== f.errorCode);
pc("PST-REQ-09", "15 项真实 fence 负例全部返回预期 409 + 错误码", fenceMismatch.length === 0, { fences: result.fences.map((f: any) => ({ label: f.label, status: f.status, errorCode: f.errorCode })), mismatch: fenceMismatch.map((f: any) => f.label) });

// 10) requires 整包盲发在 12 端点仍全部 422
pc("PST-REQ-10", "12 端点对 requires 整包盲发仍全部 422（不得当请求字段透传）", result.fullForward.every((f: any) => f.status === 422 && f.rejectedRequiresKeys.length > 0),
  result.fullForward.map((f: any) => ({ endpoint: f.endpoint, status: f.status, rejected: f.rejectedRequiresKeys.length })));

// 11) planRevision / boundaryAt 仍无任何请求字段
{
  const nonRequest = ["planRevision", "requiredSourceRevisions", "boundaryAt"];
  const bad = result.matrix.filter((r: any) => nonRequest.includes(r.field) && r.layer !== "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD");
  pc("PST-REQ-11", "planRevision / requiredSourceRevisions / boundaryAt 在 12 端点仍全部为入口拒绝的非请求字段", bad.length === 0, { nonRequestRejectedEverywhere: nonRequest.map((f) => ({ field: f, rejectedOn: result.matrix.filter((r: any) => r.field === f && r.layer === "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD").length })), unexpected: bad.map((r: any) => ({ endpoint: r.endpoint, field: r.field, status: r.status, layer: r.layer })) });
}
result.postChecks = postChecks;


/* ---------- 结论汇总 ---------- */
const byEndpoint: Record<string, any> = {};
for (const endpoint of ENDPOINTS) {
  const kind = endpoint.kind;
  const rows = result.matrix.filter((r: any) => r.endpoint === kind);
  const control = result.controls.find((c: any) => c.endpoint === kind);
  byEndpoint[kind] = {
    baseControl: control ? { status: control.status, errorCode: control.errorCode, classified: control.classified } : null,
    entryRejects: rows.filter((r: any) => r.layer === "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD").map((r: any) => r.field),
    entryAccepts: rows.filter((r: any) => r.layer !== "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD").map((r: any) => ({ field: r.field, status: r.status, errorCode: r.errorCode })),
    fullForwardStatus: result.fullForward.find((f: any) => f.endpoint === kind)?.status ?? null,
    fullForwardRejectedKeys: result.fullForward.find((f: any) => f.endpoint === kind)?.rejectedRequiresKeys ?? null,
  };
}
result.byEndpoint = byEndpoint;
const totalCells = result.matrix.length;
const entryRejected = result.matrix.filter((r: any) => r.layer === "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD").length;
const nonRequestFields = ["planRevision", "requiredSourceRevisions", "boundaryAt"];
result.verdict = {
  matrixCells: totalCells,
  entryRejectedCells: entryRejected,
  entryRejectedCases: totalCells - entryRejected,
  allEndpointsRejectBlindRequiresForward: result.fullForward.every((f: any) => f.status === 422 && f.rejectedRequiresKeys.length > 0),
  blindForwardRejectedKeyCounts: Object.fromEntries(result.fullForward.map((f: any) => [f.endpoint, f.rejectedRequiresKeys.length])),
  nonRequestFieldMatrix: nonRequestFields.map((field) => ({ field, endpointsWhereRejected: result.matrix.filter((r: any) => r.field === field && r.layer === "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD").map((r: any) => r.endpoint) })),
  fenceErrors: result.fences.map((f: any) => ({ label: f.label, endpoint: f.endpoint, status: f.status, errorCode: f.errorCode })),
  controlAcceptedOrFence: result.controls.map((c: any) => ({ endpoint: c.endpoint, status: c.status, errorCode: c.errorCode, classified: c.classified })),
  conclusion: "requires 不是可盲发的请求字段集合：missionVersion/planRevision/contextVersion/constraintsVersion/researchScopeVersion/controlVersion/questionId/approvalId/proposalHash/requiredSourceRevisions/boundaryAt 在大多数端点被 strict schema 以 422 VALIDATION_ERROR(unrecognized_keys) 拒绝；各端点真正接受的是改名后的 expectedVersion/expectedContextVersion/expectedConstraintsVersion/expectedScopeVersion/expectedControlVersion、questionId、路径 approvalId、proposalHash 等字段，并在服务层真实 409 fence 重查；requiredSourceRevisions 与 boundaryAt 无任何请求字段，只能由服务端从原来源/责任记录重推导。",
};

const postPass = postChecks.filter((c) => c.verdict === "PASS").length;
const postFail = postChecks.filter((c) => c.verdict !== "PASS").length;
result.verdict.postChecks = { total: postChecks.length, pass: postPass, fail: postFail, failedIds: postChecks.filter((c) => c.verdict !== "PASS").map((c) => c.id) };
result.summary = { total: postChecks.length, pass: postPass, fail: postFail, notRun: 0 };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, summary: result.summary, failed: postChecks.filter((c) => c.verdict !== "PASS").map((c) => ({ id: c.id, detail: c.observed })) }, null, 2));
process.exit(postFail > 0 ? 1 : 0);





