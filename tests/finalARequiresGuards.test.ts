/**
 * A-新1（第二批）：primaryAction.requires 字段 → 原端点合同独立负例矩阵。
 *
 * 目的：为 C/D 接线提供“readback 读取建议 ≠ 请求字段/执行令牌”的真实入口证据。
 * - 每个 requires 字段至少一个篡改/过期/跨对象负例，断言真实服务/路由返回的 HTTP 状态与错误码；
 * - requiredSourceRevisions 不是请求字段：证明服务端从原 readSet/sourceRefs/sourcePointers 重导出，
 *   continuation / approval / adoption 三处来源哈希变化都以 409 SOURCE_CHANGED 拒绝；
 * - controlVersion / boundaryAt 按“入口即拒”与“执行 fence 才拒”分别取证。
 *
 * 本套件独立建库（tests/helpers/continuityDatabase），不复用实现者测试断言；
 * 只调用真实 route handler / 真实服务函数，不 mock 实现。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const iso = (await import("./helpers/continuityDatabase")).continuityDatabase("final-a-requires-guards");
  Object.assign(process.env, {
    MISSION_UI_ENABLED: "true",
    MISSION_EVENT_CONTINUATION_ENABLED: "true",
    MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
    MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  });
  return iso;
});
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { createSession } from "@/lib/auth/session";
import { createMission } from "@/lib/mission/missionService";
import { readMissionBack, type MissionReadback } from "@/lib/mission/readback";
import { readMissionResponsibility, reviseMissionResponsibility } from "@/lib/mission/responsibility";
import { event } from "@/lib/mission/repository";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { runMissionSlice } from "@/lib/mission/runner";
import { fenced, type Lease } from "@/lib/mission/runtimeStore";
import { jsonHash, type Source } from "@/lib/mission/contracts";
import { POST as postInput } from "@/app/api/missions/[id]/input/route";
import { POST as postApproval } from "@/app/api/missions/[id]/approvals/[approvalId]/route";
import { POST as postPause } from "@/app/api/missions/[id]/pause/route";
import { POST as postResume } from "@/app/api/missions/[id]/resume/route";
import { POST as postReplan } from "@/app/api/missions/[id]/replan/route";
import { PATCH as patchConstraints } from "@/app/api/missions/[id]/constraints/route";
import { PATCH as patchResearchScope } from "@/app/api/missions/[id]/research-scope/route";
import { PATCH as patchContinuationPolicy } from "@/app/api/missions/[id]/continuation-policy/route";
import { PATCH as patchResponsibility } from "@/app/api/missions/[id]/responsibility/route";
import { POST as postContinuationPreview } from "@/app/api/missions/[id]/continuations/preview/route";
import { POST as postContinuationConfirm } from "@/app/api/missions/[id]/continuations/confirm/route";
import { GET as getReadback } from "@/app/api/missions/[id]/readback/route";
import { POST as postArtifactPreview } from "@/app/api/missions/[id]/outputs/[outputId]/artifact-preview/route";
import { POST as postArtifactConfirm } from "@/app/api/missions/[id]/outputs/[outputId]/artifact-confirm/route";
import { PATCH as patchAction } from "@/app/api/projects/[id]/actions/[actionId]/route";

// 后台 Worker 心跳写到临时目录，不污染工作树 .runtime/。
process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "worker-presence.json");

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 最小真实调用辅助：全部走 route handler，读真实 HTTP 状态与错误码。
// ---------------------------------------------------------------------------
const json = (value: unknown) => value as Prisma.InputJsonValue;
type ApiResult = { status: number; body: unknown };
type MissionParams = { params: Promise<{ id: string }> };
const missionParams = (id: string): MissionParams => ({ params: Promise.resolve({ id }) });
const outputParams = (id: string, outputId: string) => ({ params: Promise.resolve({ id, outputId }) });

let token = "";
function request(method: string, url: string, body?: unknown): Request {
  return new Request(`https://fixture.invalid${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function readResponse(response: Response): Promise<ApiResult> {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}
const errorCode = (result: ApiResult): string | undefined =>
  (result.body as { error?: { code?: string } } | null)?.error?.code;
function expectRejected(result: ApiResult, status: number, code: string) {
  expect({ status: result.status, code: errorCode(result) }).toEqual({ status, code });
}
const callInput = async (id: string, body: unknown) => readResponse(await postInput(request("POST", `/api/missions/${id}/input`, body), missionParams(id)));
const callApproval = async (id: string, approvalId: string, body: unknown) =>
  readResponse(await postApproval(request("POST", `/api/missions/${id}/approvals/${approvalId}`, body), { params: Promise.resolve({ id, approvalId }) }));
const callResume = async (id: string, body: unknown) => readResponse(await postResume(request("POST", `/api/missions/${id}/resume`, body), missionParams(id)));
const callConstraints = async (id: string, body: unknown) => readResponse(await patchConstraints(request("PATCH", `/api/missions/${id}/constraints`, body), missionParams(id)));
const callResearchScope = async (id: string, body: unknown) =>
  readResponse(await patchResearchScope(request("PATCH", `/api/missions/${id}/research-scope`, body), missionParams(id)));
const callPolicy = async (id: string, body: unknown) =>
  readResponse(await patchContinuationPolicy(request("PATCH", `/api/missions/${id}/continuation-policy`, body), missionParams(id)));
const callResponsibility = async (id: string, body: unknown) =>
  readResponse(await patchResponsibility(request("PATCH", `/api/missions/${id}/responsibility`, body), missionParams(id)));
const callContinuationPreview = async (id: string, body: unknown) =>
  readResponse(await postContinuationPreview(request("POST", `/api/missions/${id}/continuations/preview`, body), missionParams(id)));
const callContinuationConfirm = async (id: string, body: unknown) =>
  readResponse(await postContinuationConfirm(request("POST", `/api/missions/${id}/continuations/confirm`, body), missionParams(id)));
const callArtifactPreview = async (id: string, outputId: string, body: unknown) =>
  readResponse(await postArtifactPreview(request("POST", `/api/missions/${id}/outputs/${outputId}/artifact-preview`, body), outputParams(id, outputId)));
const callArtifactConfirm = async (id: string, outputId: string, body: unknown) =>
  readResponse(await postArtifactConfirm(request("POST", `/api/missions/${id}/outputs/${outputId}/artifact-confirm`, body), outputParams(id, outputId)));
const callAction = async (projectId: string, actionId: string, body: unknown) =>
  readResponse(await patchAction(request("PATCH", `/api/projects/${projectId}/actions/${actionId}`, body), { params: Promise.resolve({ id: projectId, actionId }) }));

async function readback(id: string): Promise<MissionReadback> {
  const result = await readResponse(await getReadback(request("GET", `/api/missions/${id}/readback`), missionParams(id)));
  expect(result.status).toBe(200);
  const back = (result.body as { readback: MissionReadback }).readback;
  expect(back.workPacket).toBeDefined();
  return back;
}
function requirePrimary(back: MissionReadback) {
  const action = back.workPacket!.next.primaryAction;
  expect(action).not.toBeNull();
  return action!;
}

// ---------------------------------------------------------------------------
// 原事实夹具：真实 createMission 服务 + 显式原事件/批准记录（与生产写入同形状）。
// ---------------------------------------------------------------------------
let counter = 0;
type Owner = { userId: string; projectId: string };
async function owner(label: string): Promise<Owner> {
  counter += 1;
  const user = await db.user.create({
    data: { username: `requires-${label}-${counter}-${crypto.randomUUID().slice(0, 8)}`, displayName: `A-新1 ${label}`, passwordHash: "unused" },
  });
  const project = await db.project.create({
    data: {
      title: `requires 端点合同 ${label}`, description: "SYNTHETIC_FINAL_A_REQUIRES", goal: "核对 requires 端点映射",
      scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  token = (await createSession(user.id)).token;
  return { userId: user.id, projectId: project.id };
}
async function mission(o: Owner) {
  return createMission(o.userId, {
    projectId: o.projectId,
    requestId: `create-${crypto.randomUUID()}`,
    goal: "核对 requires 端点合同",
    llmContextApproved: true,
  });
}
async function addEvent(missionId: string, type: string, payload: unknown) {
  const m = await db.agentMission.update({ where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true } });
  return db.agentMissionEvent.create({ data: { missionId, seq: m.nextEventSeq, type, payloadJson: json(payload) } });
}
/** 等待用户回答的原问题（真实 QUESTION 事件 + waitState）。 */
async function waitingInput(o: Owner, requirements: Record<string, unknown> = {}) {
  const m = await mission(o);
  const question = await addEvent(m.id, "QUESTION", { question: "请补充对照实验指标", missing: "PRIVATE", requirements, phase: "DECISION" });
  const updated = await db.agentMission.update({
    where: { id: m.id },
    data: {
      status: "WAITING_INPUT",
      waitStateJson: json({ waitingFor: "USER", questionId: question.id, gapId: question.id, question: "请补充对照实验指标",
        missing: "PRIVATE", requirements, startedAt: new Date().toISOString(), readSet: [] }),
    },
  });
  return { mission: updated, question };
}
/** 等待用户批准的原始提案（真实 Step + Approval 形状）。 */
async function waitingApproval(o: Owner, options: { expiresAt?: Date; readSet?: Source[]; planRevision?: number } = {}) {
  const m = await mission(o);
  const readSet = options.readSet ?? [];
  const step = await db.agentMissionStep.create({
    data: {
      missionId: m.id, ordinal: 1, planRevision: m.planRevision, toolName: "propose_action", toolVersion: "1",
      canonicalInputJson: json({ title: "验证一次新实验" }), inputHash: `step-${crypto.randomUUID()}`,
      readSetJson: json(readSet), status: "WAITING_APPROVAL",
    },
  });
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 600_000);
  const proposalJson = { tool: "create_action", toolVersion: "1", args: { title: "验证一次新实验" }, ownerUserId: o.userId,
    projectId: o.projectId, planRevision: options.planRevision ?? m.planRevision, contextVersion: m.contextVersion,
    readSet, expiresAt: expiresAt.toISOString() };
  const proposalHash = jsonHash(proposalJson);
  const approval = await db.agentMissionApproval.create({
    data: {
      missionId: m.id, stepId: step.id, proposalHash, proposalJson: json(proposalJson),
      expectedPlanRevision: options.planRevision ?? m.planRevision, readSetJson: json(readSet),
      status: "PENDING", expiresAt,
    },
  });
  const updated = await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_APPROVAL" } });
  return { mission: updated, step, approval, proposalHash };
}
/** 项目记录（capture）来源：真实 readProjectMaterial 身份。 */
async function projectCapture(o: Owner, text: string) {
  const row = await db.capture.create({ data: { projectId: o.projectId, rawText: text, sourceType: "实验记录" } });
  const source = await readProjectMaterial(o.projectId, `capture:${row.id}`);
  expect(source).not.toBeNull();
  return { row, source: source! };
}
function boundedPolicy(expiresAt: Date) {
  return {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: expiresAt.toISOString(), checkEveryMinutes: 15,
    maxModels: 10, maxTools: 20, maxMetadataRequests: 10, allowedTools: ["inspect_project"], connectionIds: [],
    timezone: "Asia/Shanghai", quietStart: 22, quietEnd: 8, attention: "IMPORTANT_ONLY",
  };
}

// ---------------------------------------------------------------------------
// 1. 严格请求 schema：requires 的形状不是任何命令端点的请求体。
// ---------------------------------------------------------------------------
describe("requires 不是请求体：严格 schema 入口即拒", () => {
  it("把整包 requires 键盲发给 input / continuation confirm / artifact confirm / responsibility PATCH 均为 422", async () => {
    await owner("strict-schema"); // 先建立登录会话：严格 schema 在业务查询之前拒绝额外字段。
    // 形状取自 lib/types/workPacket.ts WorkPacketRequires；这里故意把所有键原样提交。
    const blindRequires = {
      missionVersion: 1, planRevision: 1, contextVersion: 1, constraintsVersion: 1, researchScopeVersion: 1,
      controlVersion: "0".repeat(64), questionId: "q-blind", approvalId: "ap-blind", proposalHash: "p".repeat(64),
      requiredSourceRevisions: ["capture:blind@" + "a".repeat(64)], boundaryAt: new Date().toISOString(),
    };
    // 命令端点命令体只接受 requestId/expectedVersion/questionId/answer/decision/proposalHash/evidenceReview（strict）。
    expectRejected(await callInput("missing-mission", { requestId: "blind-input", expectedVersion: 1, ...blindRequires }), 422, "VALIDATION_ERROR");
    // 续接确认体只接受 previewSchema + expectedVersion/expectedContextVersion/assessmentHash/fitHash/answer/confirmedGap（strict）。
    expectRejected(await callContinuationConfirm("missing-mission", {
      requestId: "blind-continuation", expectedVersion: 1, expectedContextVersion: 1, assessmentHash: "0".repeat(64),
      answer: "盲发", confirmedGap: true, ...blindRequires,
    }), 422, "VALIDATION_ERROR");
    // 归入确认体只接受 artifactType/expectedOutputRevision/requestId/previewHash/expectedContextVersion（strict）。
    expectRejected(await callArtifactConfirm("missing-mission", "missing-output", {
      requestId: "blind-adoption", previewHash: "h", expectedOutputRevision: 1, expectedContextVersion: 1, ...blindRequires,
    }), 422, "VALIDATION_ERROR");
    // 责任修订体只接受 expectedControlVersion，不接受 controlVersion 原名；missionVersion 等也不接受。
    expectRejected(await callResponsibility("missing-mission", {
      requestId: "blind-responsibility", expectedControlVersion: "c".repeat(64), ...blindRequires,
    }), 422, "VALIDATION_ERROR");
  });

  it("requiredSourceRevisions 不能整包提交给 continuation/approval；来源由服务端从原记录重导出", async () => {
    await owner("strict-schema-2");
    // approval 命令体同样 strict：requiredSourceRevisions/planRevision 等额外键 → 422。
    expectRejected(await callApproval("missing-mission", "missing-approval", {
      requestId: "blind-approval", expectedVersion: 1, decision: "APPROVED", proposalHash: "p".repeat(64),
      requiredSourceRevisions: ["capture:x@" + "a".repeat(64)],
    }), 422, "VALIDATION_ERROR");
    // continuation preview 只接受 questionId/sourcePointers/evidenceReview：requiredSourceRevisions 不是它的字段。
    expectRejected(await callContinuationPreview("missing-mission", {
      questionId: "q", sourcePointers: [{ id: "capture:x", hash: "a".repeat(64) }],
      requiredSourceRevisions: ["capture:x@" + "a".repeat(64)],
    }), 422, "VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// 2. missionVersion → expectedVersion（命令入口即拒）。
// ---------------------------------------------------------------------------
describe("missionVersion → expectedVersion", () => {
  it("input：旧 missionVersion 入口即拒 409 MISSION_CHANGED；当前版本受理", async () => {
    const o = await owner("mission-version");
    const f = await waitingInput(o);
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    expect(action.kind).toBe("ANSWER_QUESTION");
    expect(action.requires.missionVersion).toBe(f.mission.version);

    // 合法推进版本且保持 WAITING_INPUT。
    const policy = await callPolicy(f.mission.id, { requestId: "policy-bump", expectedVersion: f.mission.version, policy: { mode: "MANUAL" } });
    expect(policy.status).toBe(200);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(current.version).toBeGreaterThan(f.mission.version);
    expect(current.status).toBe("WAITING_INPUT");

    // requires.missionVersion 已经过期 → 入口拒。
    expectRejected(await callInput(f.mission.id, {
      requestId: "input-stale-version", expectedVersion: action.requires.missionVersion,
      questionId: f.question.id, answer: "按旧版本补充实验条件",
    }), 409, "MISSION_CHANGED");

    // 当前版本受理，服务端推进 contextVersion。
    const accepted = await callInput(f.mission.id, {
      requestId: "input-current-version", expectedVersion: current.version,
      questionId: f.question.id, answer: "按当前版本补充实验条件",
    });
    expect(accepted.status).toBe(202);
    const done = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(done.status).toBe("READY");
    expect(done.contextVersion).toBe(current.contextVersion + 1);
  });

  it("pause/resume/replan 也以 expectedVersion 绑定；不存在的命令返回 422", async () => {
    const o = await owner("command-version");
    const m = await mission(o);
    // 非法命令名走同一 commandSchema，先拒绝超集字段再拒绝命令。
    expectRejected(await callInput(m.id, { requestId: "unknown-extra", expectedVersion: m.version, missionVersion: m.version, answer: "a" }), 422, "VALIDATION_ERROR");
    // pause 的入口版本校验：先把版本推进，再用旧版本暂停。
    const paused = await readResponse(await postPause(request("POST", `/api/missions/${m.id}/pause`, { requestId: "pause-ok", expectedVersion: m.version }), missionParams(m.id)));
    expect(paused.status).toBe(202);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    expect(current.status).toBe("PAUSED");
    expectRejected(await callResume(m.id, { requestId: "resume-stale", expectedVersion: m.version }), 409, "MISSION_CHANGED");
    const resumed = await callResume(m.id, { requestId: "resume-current", expectedVersion: current.version });
    expect(resumed.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// 3. planRevision：不是请求字段；服务端用 approval.expectedPlanRevision 复核。
// ---------------------------------------------------------------------------
describe("planRevision → approval.expectedPlanRevision（服务端重导出）", () => {
  it("计划推进后旧批准以 409 APPROVAL_CHANGED 拒绝，请求体不携带 planRevision", async () => {
    const o = await owner("plan-revision");
    const f = await waitingApproval(o);
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    expect(action.kind).toBe("REVIEW_APPROVAL");
    expect(action.requires.planRevision).toBe(f.mission.planRevision);
    expect(action.requires.approvalId).toBe(f.approval.id);
    expect(action.requires.proposalHash).toBe(f.proposalHash);

    // 计划推进（replan 语义）：直接推进 planRevision，保留 PENDING 原批准以隔离 expectedPlanRevision 检查。
    await db.agentMission.update({ where: { id: f.mission.id }, data: { planRevision: { increment: 1 } } });
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(current.version).toBe(f.mission.version);
    // 版本、状态、提案哈希都正确，只有服务端重导出的 planRevision 不一致 → 409。
    expectRejected(await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-old-plan", expectedVersion: current.version, decision: "APPROVED", proposalHash: f.proposalHash,
    }), 409, "APPROVAL_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 4. contextVersion → continuation confirm / adoption confirm 的 expectedContextVersion。
// ---------------------------------------------------------------------------
describe("contextVersion → expectedContextVersion", () => {
  it("continuation confirm：上下文推进后旧 expectedContextVersion 409 ASSESSMENT_CHANGED", async () => {
    const o = await owner("context-continuation");
    const f = await waitingInput(o, { terms: ["准确率"], sourceType: "CAPTURE" });
    const material = await projectCapture(o, "10月对照实验准确率82%，用户提供，含义待核验");
    const pointer = { id: material.source.id, hash: material.source.hash };
    const preview = await callContinuationPreview(f.mission.id, { questionId: f.question.id, sourcePointers: [pointer] });
    expect(preview.status).toBe(200);
    const previewBody = preview.body as { version: number; contextVersion: number; assessmentHash: string };

    // 合法推进 contextVersion（保持原问题不变）。
    const policy = await callPolicy(f.mission.id, { requestId: "policy-context-bump", expectedVersion: previewBody.version, policy: { mode: "MANUAL" } });
    expect(policy.status).toBe(200);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(current.contextVersion).toBeGreaterThan(previewBody.contextVersion);

    // expectedVersion 用当前值，expectedContextVersion 用旧值 → 服务端上下文复核拒绝。
    expectRejected(await callContinuationConfirm(f.mission.id, {
      requestId: "continuation-stale-context", questionId: f.question.id, sourcePointers: [pointer],
      expectedVersion: current.version, expectedContextVersion: previewBody.contextVersion,
      assessmentHash: previewBody.assessmentHash, answer: "旧上下文提交", confirmedGap: true,
    }), 409, "ASSESSMENT_CHANGED");
  });

  it("adoption confirm：旧 expectedContextVersion 409 OUTPUT_CHANGED；预览/确认都不接受 requiredSourceRevisions", async () => {
    const o = await owner("context-adoption");
    const f = await adoptionFixture(o);
    // 上下文推进（策略编辑同时推进 contextVersion/version）。
    const policy = await callPolicy(f.mission.id, { requestId: "policy-adoption-bump", expectedVersion: f.mission.version, policy: { mode: "MANUAL" } });
    expect(policy.status).toBe(200);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(current.contextVersion).toBeGreaterThan(f.preview.contextVersion);
    expectRejected(await callArtifactConfirm(f.mission.id, f.output.id, {
      requestId: "adoption-stale-context", artifactType: "weekly_report", expectedOutputRevision: f.output.revision,
      expectedContextVersion: f.preview.contextVersion, previewHash: f.preview.previewHash,
    }), 409, "OUTPUT_CHANGED");
    // 正确上下文 + 旧 previewHash 也不被接受（哈希绑定同一份内容）。
    expectRejected(await callArtifactConfirm(f.mission.id, f.output.id, {
      requestId: "adoption-stale-hash", artifactType: "weekly_report", expectedOutputRevision: f.output.revision,
      expectedContextVersion: current.contextVersion, previewHash: "0".repeat(64),
    }), 409, "OUTPUT_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 5. constraintsVersion / researchScopeVersion → PATCH 编辑端点的 expected*Version。
// ---------------------------------------------------------------------------
describe("constraintsVersion / researchScopeVersion → PATCH expected*Version", () => {
  it("constraints PATCH：过期或缺失 expectedConstraintsVersion 都 409 MISSION_CHANGED", async () => {
    const o = await owner("constraints-version");
    const m = await mission(o);
    const first = await callConstraints(m.id, {
      requestId: "constraints-first", expectedVersion: m.version, expectedConstraintsVersion: m.constraintsVersion, constraints: {},
    });
    expect(first.status).toBe(200);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    expect(current.constraintsVersion).toBeGreaterThan(m.constraintsVersion);
    // 过期约束版本。
    expectRejected(await callConstraints(m.id, {
      requestId: "constraints-stale", expectedVersion: current.version, expectedConstraintsVersion: m.constraintsVersion, constraints: {},
    }), 409, "MISSION_CHANGED");
    // schema 里 optional，但工作路径上缺失同样被 409 拒绝（实现不把它当默认值）。
    expectRejected(await callConstraints(m.id, {
      requestId: "constraints-missing", expectedVersion: current.version, constraints: {},
    }), 409, "MISSION_CHANGED");
  });

  it("research-scope PATCH：过期 expectedScopeVersion 409 MISSION_CHANGED", async () => {
    const o = await owner("scope-version");
    const m = await mission(o);
    const first = await callResearchScope(m.id, {
      requestId: "scope-first", expectedVersion: m.version, expectedScopeVersion: m.researchScopeVersion, scope: {},
    });
    expect(first.status).toBe(200);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    expect(current.researchScopeVersion).toBeGreaterThan(m.researchScopeVersion);
    expectRejected(await callResearchScope(m.id, {
      requestId: "scope-stale", expectedVersion: current.version, expectedScopeVersion: m.researchScopeVersion, scope: {},
    }), 409, "MISSION_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 6. questionId → input 的命令字段；绑定原问题。
// ---------------------------------------------------------------------------
describe("questionId → input 绑定原问题", () => {
  it("错误 questionId 409 INPUT_CHANGED；正确 questionId 受理", async () => {
    const o = await owner("question-id");
    const f = await waitingInput(o);
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    expect(action.requires.questionId).toBe(f.question.id);
    expectRejected(await callInput(f.mission.id, {
      requestId: "input-wrong-question", expectedVersion: f.mission.version, questionId: `other-${f.question.id}`, answer: "回答另一项问题",
    }), 409, "INPUT_CHANGED");
    const accepted = await callInput(f.mission.id, {
      requestId: "input-right-question", expectedVersion: f.mission.version, questionId: action.requires.questionId, answer: "按原问题补充对照条件",
    });
    expect(accepted.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// 7. approvalId / proposalHash → 批准端点路径参数与请求字段。
// ---------------------------------------------------------------------------
describe("approvalId / proposalHash → 批准端点", () => {
  it("approvalId 来自原批准；跨 mission 的 approvalId 409 APPROVAL_CHANGED", async () => {
    const o = await owner("approval-cross");
    const a = await waitingApproval(o);
    const b = await waitingApproval(o);
    expectRejected(await callApproval(a.mission.id, b.approval.id, {
      requestId: "approval-cross-mission", expectedVersion: a.mission.version, decision: "APPROVED", proposalHash: b.proposalHash,
    }), 409, "APPROVAL_CHANGED");
  });

  it("proposalHash：缺失或篡改都 409；正确哈希与当前版本受理", async () => {
    const o = await owner("proposal-hash");
    const f = await waitingApproval(o);
    expectRejected(await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-tampered-hash", expectedVersion: f.mission.version, decision: "APPROVED", proposalHash: "c".repeat(64),
    }), 409, "APPROVAL_CHANGED");
    expectRejected(await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-missing-hash", expectedVersion: f.mission.version, decision: "APPROVED",
    }), 409, "APPROVAL_CHANGED");
    const accepted = await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-accepted", expectedVersion: f.mission.version, decision: "APPROVED", proposalHash: f.proposalHash,
    });
    expect(accepted.status).toBe(202);
    const done = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(done.status).toBe("READY");
  });

  it("跨账号 404 MISSION_NOT_FOUND；无凭据 401 UNAUTHORIZED", async () => {
    const o = await owner("ownership");
    const f = await waitingInput(o);
    const outsider = await db.user.create({ data: { username: `outsider-${crypto.randomUUID()}`, displayName: "越权", passwordHash: "unused" } });
    const previous = token;
    token = (await createSession(outsider.id)).token;
    expectRejected(await callInput(f.mission.id, {
      requestId: "outsider-input", expectedVersion: f.mission.version, questionId: f.question.id, answer: "越权回答",
    }), 404, "MISSION_NOT_FOUND");
    token = previous;
    const anonymous = await postInput(new Request(`https://fixture.invalid/api/missions/${f.mission.id}/input`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), missionParams(f.mission.id));
    expectRejected(await readResponse(anonymous), 401, "UNAUTHORIZED");
  });

  it("过期批准：入口即拒 409 APPROVAL_CHANGED（boundaryAt 的批准边界）", async () => {
    const o = await owner("approval-expiry");
    const expiredAt = new Date(Date.now() - 60_000);
    const f = await waitingApproval(o, { expiresAt: expiredAt });
    const back = await readback(f.mission.id);
    // 已过期批准不是“当前有效提案”：读取建议改为重核，不再给出 approvalId 作为可提交目标。
    expect(requirePrimary(back).kind).toBe("RECHECK_AUTHORITY");
    expect(requirePrimary(back).requires.approvalId).toBeNull();
    expectRejected(await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-expired", expectedVersion: f.mission.version, decision: "APPROVED", proposalHash: f.proposalHash,
    }), 409, "APPROVAL_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 8. controlVersion → 只在 PATCH /responsibility 以 expectedControlVersion 校验。
// ---------------------------------------------------------------------------
describe("controlVersion → PATCH /responsibility expectedControlVersion", () => {
  it("读取 = 责任快照；读取不扩授权；旧 controlVersion 409 MISSION_CHANGED，当前值受理", async () => {
    const o = await owner("control-version");
    const m = await mission(o);
    const responsibility = await readMissionResponsibility(o.userId, m.id);
    const back = await readback(m.id);
    const action = requirePrimary(back);
    expect(action.requires.controlVersion).toBe(responsibility.controlVersion);
    expect(action.requires.controlVersion).toBeTruthy();
    // 读取建议不扩授权：读取不推进 Mission 版本。
    const afterRead = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    expect(afterRead.version).toBe(m.version);

    // 责任合同变化（直接改原事实模拟另一消费者写入）→ controlVersion 立即变化。
    await db.agentMission.update({ where: { id: m.id }, data: { goal: "读取建议之外的责任变更" } });
    const current = await readMissionResponsibility(o.userId, m.id);
    expect(current.controlVersion).not.toBe(responsibility.controlVersion);

    // 旧快照不可用于修订。
    await expect(reviseMissionResponsibility(o.userId, m.id, {
      requestId: "responsibility-stale", expectedControlVersion: responsibility.controlVersion, goal: "用旧快照扩大授权",
    })).rejects.toMatchObject({ code: "MISSION_CHANGED", status: 409 });
    // 当前 controlVersion 受理。
    const accepted = await callResponsibility(m.id, {
      requestId: "responsibility-current", expectedControlVersion: current.controlVersion, goal: "按当前快照微调目标",
    });
    expect(accepted.status).toBe(200);

    // 命令端点不接受 controlVersion 原名（strict 422）；只有责任修订端点接受 expectedControlVersion。
    expectRejected(await callInput("missing-mission", {
      requestId: "blind-control", expectedVersion: 1, controlVersion: current.controlVersion,
    }), 422, "VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// 9. requiredSourceRevisions：非请求字段；服务端从原 sourcePointers/readSet/sourceRefs 重导出。
// ---------------------------------------------------------------------------
describe("requiredSourceRevisions → 服务端从原来源记录重导出", () => {
  it("continuation：原 sourcePointer 哈希变化 → 409 SOURCE_CHANGED（preview/confirm 都拒）", async () => {
    const o = await owner("source-continuation");
    const f = await waitingInput(o, { terms: ["准确率"], sourceType: "CAPTURE" });
    const material = await projectCapture(o, "10月对照实验准确率82%，用户提供，含义待核验");
    const pointer = { id: material.source.id, hash: material.source.hash };
    const preview = await callContinuationPreview(f.mission.id, { questionId: f.question.id, sourcePointers: [pointer] });
    expect(preview.status).toBe(200);
    const previewBody = preview.body as { version: number; contextVersion: number; assessmentHash: string };
    // 原来源到达事件（生产由 scanWaitingMaterialBatch 写入）：工作包据此推导 requiredSourceRevisions。
    await addEvent(f.mission.id, "SOURCE_ARRIVED", { questionId: f.question.id, sourcePointer: pointer, readable: true, observedAt: new Date().toISOString() });
    const back = await readback(f.mission.id);
    // readback 的 requiredSourceRevisions 是服务端按来源策略推导的 `${id}@${hash}`，不是可回传的请求字段。
    expect(requirePrimary(back).requires.requiredSourceRevisions).toEqual([`${pointer.id}@${pointer.hash}`]);

    // 原始资料修订（真实行更新）→ 哈希变化。
    await db.capture.update({ where: { id: material.row.id }, data: { rawText: "10月对照实验准确率91%，修订后版本" } });
    expectRejected(await callContinuationPreview(f.mission.id, { questionId: f.question.id, sourcePointers: [pointer] }), 409, "SOURCE_CHANGED");
    expectRejected(await callContinuationConfirm(f.mission.id, {
      requestId: "continuation-stale-source", questionId: f.question.id, sourcePointers: [pointer],
      expectedVersion: previewBody.version, expectedContextVersion: previewBody.contextVersion,
      assessmentHash: previewBody.assessmentHash, answer: "旧资料提交", confirmedGap: true,
    }), 409, "SOURCE_CHANGED");
  });

  it("approval：原 readSet 中的来源哈希变化 → 409 SOURCE_CHANGED", async () => {
    const o = await owner("source-approval");
    const material = await projectCapture(o, "对照实验读数 82，用户提供，含义待核验");
    const f = await waitingApproval(o, { readSet: [material.source] });
    // 服务端在批准入口重校验 readSet；请求体没有 requiredSourceRevisions/sourcePointers 字段。
    await db.capture.update({ where: { id: material.row.id }, data: { rawText: "对照实验读数 97，修订后版本" } });
    expectRejected(await callApproval(f.mission.id, f.approval.id, {
      requestId: "approval-stale-readset", expectedVersion: f.mission.version, decision: "APPROVED", proposalHash: f.proposalHash,
    }), 409, "SOURCE_CHANGED");
  });

  it("adoption：原 output.sourceRefs 来源哈希变化 → 409 SOURCE_CHANGED", async () => {
    const o = await owner("source-adoption");
    const f = await adoptionFixture(o);
    // 原成果引用了 project:<id> 容器来源；改动项目原事实 → 来源哈希变化。
    await db.project.update({ where: { id: o.projectId }, data: { goal: "成果归入前的项目目标变更" } });
    expectRejected(await callArtifactConfirm(f.mission.id, f.output.id, {
      requestId: "adoption-stale-source", artifactType: "weekly_report", expectedOutputRevision: f.output.revision,
      expectedContextVersion: f.preview.contextVersion, previewHash: f.preview.previewHash,
    }), 409, "SOURCE_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 10. boundaryAt：批准/许可过期分别是入口拒与执行 fence 拒。
// ---------------------------------------------------------------------------
describe("boundaryAt → 批准入口 / 持续调查许可 fence", () => {
  it("等待批准时读取 boundaryAt 就是批准到期时间；到期由批准端点入口拒绝（已在上方取证）", async () => {
    const o = await owner("boundary-approval-read");
    const f = await waitingApproval(o);
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    expect(action.kind).toBe("REVIEW_APPROVAL");
    expect(action.requires.boundaryAt).toBe(f.approval.expiresAt.toISOString());
    expect(back.workPacket!.authority.nextBoundary).toBe(f.approval.expiresAt.toISOString());
  });

  it("持续调查许可到期：resume 入口不核许可，执行 fence 才以 409 DELEGATION_EXPIRED 拒绝", async () => {
    const o = await owner("boundary-fence");
    const m = await mission(o);
    const expired = boundedPolicy(new Date(Date.now() - 60_000));
    const paused = await db.agentMission.update({
      where: { id: m.id },
      data: { status: "PAUSED", pauseReason: "USER", continuationPolicyJson: json(expired) },
    });
    const back = await readback(m.id);
    expect(back.workPacket!.stopped.workState.nextBoundary).toBe(expired.expiresAt);
    expect(back.workPacket!.next.primaryAction!.requires.boundaryAt).toBe(expired.expiresAt);
    // 入口命令只核对生命周期与版本，不核对持续调查许可：resume 被受理。
    const resumed = await callResume(m.id, { requestId: "resume-expired-policy", expectedVersion: paused.version });
    expect(resumed.status).toBe(202);
    const ready = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    expect(ready.status).toBe("READY");
    // 执行 fence 复核许可到期：同一许可进不了执行路径。
    const running = await db.agentMission.update({
      where: { id: m.id },
      data: { status: "RUNNING", leaseOwner: "worker-requires", leaseEpoch: 1, leaseUntil: new Date(Date.now() + 60_000) },
    });
    const lease: Lease = { id: running.id, owner: "worker-requires", epoch: 1, contextVersion: running.contextVersion, planRevision: running.planRevision };
    await expect(db.$transaction(tx => fenced(tx, lease))).rejects.toMatchObject({ code: "DELEGATION_EXPIRED", status: 409 });
  });
});

// ---------------------------------------------------------------------------
// 11. 完成回执端点（Action PATCH）：不是 requires 的执行栅栏。
// ---------------------------------------------------------------------------
describe("Action 完成回执端点 → 不受 mission 版本栅栏约束", () => {
  it("action PATCH 的 schema 宽松：requires 形状字段被静默忽略，完成结果与 resultCardId 由服务端建立", async () => {
    const o = await owner("action-receipt");
    const action = await db.actionItem.create({ data: { projectId: o.projectId, title: "完成一次对照实验", status: "TODO" } });
    const completed = await callAction(o.projectId, action.id, {
      status: "DONE", resultText: "已按原委托记录完成对照实验并复核",
      // 这些都不是 actionUpdateSchema 字段；schema 不是 strict，因此不会 422，也不会被当作栅栏。
      missionVersion: 1, controlVersion: "0".repeat(64), requiredSourceRevisions: ["capture:x@" + "a".repeat(64)],
    });
    expect(completed.status).toBe(200);
    const body = completed.body as { action: { status: string; resultCardId: string | null } };
    expect(body.action.status).toBe("DONE");
    expect(body.action.resultCardId).toBeTruthy();
    // 幂等：重复提交返回同一 resultCardId，不产生第二个回执。
    const replay = await callAction(o.projectId, action.id, {
      status: "DONE", resultText: "已按原委托记录完成对照实验并复核", missionVersion: 99,
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { action: { resultCardId: string } }).action.resultCardId).toBe(body.action.resultCardId);
  });
});

// ---------------------------------------------------------------------------
// 12. questionId 身份来源：当前未解决原问题（=waitState.questionId）优先，
//     与 readback requires.questionId / continuation questionId 同源；
//     已解决旧问题、跨问题、非等待状态仍拒绝。
// ---------------------------------------------------------------------------
describe("requires.questionId 与原问题事件的身份一致性（最小修补）", () => {
  it.each(["resolved-user", "resolved-observation", "missing-sql", "missing-json"])("已解决或丢失等待绑定必须拒绝且无写入：%s", async mode => {
    const o = await owner(`input-invalid-${mode}`);
    const f = await waitingInput(o);
    // 没有追加新事件：旧 QUESTION 仍是最新事件，不能靠碰巧出现更新事件才拒绝。
    const invalidWait = mode === "missing-sql" ? Prisma.DbNull : mode === "missing-json" ? Prisma.JsonNull : json({
      waitingFor: mode === "resolved-user" ? "USER" : "OBSERVATION", questionId: f.question.id,
      question: "已经解决的原问题", missing: "PRIVATE", requirements: {}, resolved: true,
    });
    await db.agentMission.update({ where: { id: f.mission.id }, data: { waitStateJson: invalidWait } });
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    const eventsBefore = await db.agentMissionEvent.count({ where: { missionId: f.mission.id } });
    const result = await callInput(f.mission.id, {
      requestId: `invalid-input-${mode}`, expectedVersion: before.version, questionId: f.question.id, answer: "不应再次处理的答复",
    });
    expectRejected(result, 409, "INPUT_CHANGED");
    expect(await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).toEqual(before);
    expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id } })).toBe(eventsBefore);
  });

  it("观察事件不能冒充待回答QUESTION，拒绝时保留全部原事实", async () => {
    const o = await owner("observation-is-not-question");
    const f = await waitingInput(o);
    const observation = await addEvent(f.mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false });
    await db.agentMission.update({ where: { id: f.mission.id }, data: { waitStateJson: json({
      questionId: observation.id, waitingFor: "USER", requirements: {}, resolved: false,
    }) } });
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    const eventsBefore = await db.agentMissionEvent.count({ where: { missionId: f.mission.id } });
    expectRejected(await callInput(f.mission.id, { requestId: "observation-answer", expectedVersion: before.version, questionId: observation.id, answer: "不是原问题的答复" }), 409, "INPUT_CHANGED");
    expect(await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).toEqual(before);
    expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id } })).toBe(eventsBefore);
  });

  it("等待回答期间追加原观察事件后，readback requires.questionId 可原样提交（202，状态 READY）", async () => {
    const o = await owner("question-mismatch");
    const f = await waitingInput(o);
    // 在等待回答期间，原委托写入一条观察结论事件（delegation 观察的真实事件形状）。
    await addEvent(f.mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { questionId: f.question.id, observedAt: new Date().toISOString() });
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    // 读取侧把待回答的原问题作为唯一主操作目标。
    expect(action.kind).toBe("ANSWER_QUESTION");
    expect(action.target).toMatchObject({ kind: "QUESTION", id: f.question.id });
    expect(action.requires.questionId).toBe(f.question.id);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    // 修补后：input 身份来源 = waitState 中当前未解决原问题，与 requires.questionId 同源。
    const accepted = await callInput(f.mission.id, {
      requestId: "input-requires-question", expectedVersion: current.version, questionId: action.requires.questionId, answer: "按 readback 建议回答原问题",
    });
    expect(accepted.status).toBe(202);
    const done = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(done.status).toBe("READY");
    // input 只推进 contextVersion（原逻辑），不推进 planRevision。
    expect(done.contextVersion).toBe(current.contextVersion + 1);
    expect(done.planRevision).toBe(current.planRevision);
  });

  it("问题后没有观察事件时，同一映射保持原行为（202，状态 READY）", async () => {
    const o = await owner("question-normal");
    const f = await waitingInput(o);
    const back = await readback(f.mission.id);
    const action = requirePrimary(back);
    expect(action.requires.questionId).toBe(f.question.id);
    const accepted = await callInput(f.mission.id, {
      requestId: "input-normal-question", expectedVersion: f.mission.version, questionId: action.requires.questionId, answer: "按原问题补充实验条件",
    });
    expect(accepted.status).toBe(202);
    const done = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    expect(done.status).toBe("READY");
    expect(done.contextVersion).toBe(f.mission.contextVersion + 1);
    expect(done.planRevision).toBe(f.mission.planRevision);
  });

  it("没有放宽：跨问题、已解决旧问题、非等待状态提交仍 409 INPUT_CHANGED", async () => {
    const o = await owner("question-negative");
    const f = await waitingInput(o);
    // a) 跨问题/不属于当前原问题的 id。
    expectRejected(await callInput(f.mission.id, {
      requestId: "input-foreign-question", expectedVersion: f.mission.version, questionId: `foreign-${crypto.randomUUID()}`, answer: "回答另一项问题",
    }), 409, "INPUT_CHANGED");

    // b) 已解决旧问题不再按 wait.questionId 接受：wait.resolved=true 且其后已有更新事件。
    const newer = await addEvent(f.mission.id, "QUESTION", { question: "更晚出现的问题事件" });
    const resolved = await db.agentMission.update({
      where: { id: f.mission.id },
      data: { waitStateJson: json({ waitingFor: "OBSERVATION", questionId: f.question.id, question: "已解决旧问题",
        missing: "PRIVATE", requirements: {}, startedAt: new Date().toISOString(), readSet: [], resolved: true }) },
    });
    expect(newer.id).not.toBe(f.question.id);
    expectRejected(await callInput(f.mission.id, {
      requestId: "input-resolved-old-question", expectedVersion: resolved.version, questionId: f.question.id, answer: "回答已解决的旧问题",
    }), 409, "INPUT_CHANGED");

    // c) 非等待状态：正常回答后再次提交（新 requestId、旧 questionId）仍拒绝。
    const g = await waitingInput(o);
    const answered = await callInput(g.mission.id, {
      requestId: "input-first-answer", expectedVersion: g.mission.version, questionId: g.question.id, answer: "第一次正常回答",
    });
    expect(answered.status).toBe(202);
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: g.mission.id } });
    expect(after.status).toBe("READY");
    expectRejected(await callInput(g.mission.id, {
      requestId: "input-after-ready", expectedVersion: after.version, questionId: g.question.id, answer: "状态已推进后的重复回答",
    }), 409, "INPUT_CHANGED");
  });
});

// ---------------------------------------------------------------------------
// 成果归入夹具：真实 runMissionSlice 写 Output，再走真实 artifact-preview。
// ---------------------------------------------------------------------------
async function adoptionFixture(o: Owner) {
  const m = await mission(o);
  await runMissionSlice({
    id: m.id,
    provider: async () => ({
      choice: { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目" },
      provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 },
    }),
  });
  await runMissionSlice({
    id: m.id,
    provider: async () => ({
      choice: {
        kind: "tool", tool: "save_mission_output",
        args: { blocks: [{ blockId: "goal", kind: "PROJECT_OBSERVATION", text: "本月进展仍需完善", sourceIds: [`project:${o.projectId}`] }] },
        summary: "草稿",
      },
      provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 },
    }),
  });
  const detail = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: m.id }, orderBy: { revision: "desc" } });
  const previewResult = await callArtifactPreview(m.id, detail.id, { expectedOutputRevision: detail.revision, artifactType: "weekly_report" });
  expect(previewResult.status).toBe(200);
  const preview = (previewResult.body as { receipt: { contextVersion: number; previewHash: string } }).receipt;
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  return { mission: current, output: detail, preview };
}
