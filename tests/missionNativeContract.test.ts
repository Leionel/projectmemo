import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-r34-")), file = path.join(dir, "native.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_UI_ENABLED: "true", MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true", LLM_MODE: "mock" });
  const sql = new Database(file);
  for (const dir of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", dir, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission, missionDetail, commandMission, missionEvents, editContinuationPolicy } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { event } from "@/lib/mission/repository";
import type { Choice } from "@/lib/mission/contracts";
import { POST as webCreate } from "@/app/api/missions/route";
import { GET as webDetail } from "@/app/api/missions/[id]/route";
import { GET as webEvents } from "@/app/api/missions/[id]/events/route";
import { GET as capabilities } from "@/app/api/missions/capabilities/route";
import { POST as approval } from "@/app/api/missions/[id]/approvals/[approvalId]/route";
import { POST as previewMaterial } from "@/app/api/missions/[id]/continuations/preview/route";
import { POST as confirmMaterial } from "@/app/api/missions/[id]/continuations/confirm/route";
import { POST as previewArtifact } from "@/app/api/missions/[id]/outputs/[outputId]/artifact-preview/route";
import { POST as confirmArtifact } from "@/app/api/missions/[id]/outputs/[outputId]/artifact-confirm/route";
import { POST as inspectXiaoyi } from "@/app/xiaoyi/v1/missions/inspect/route";
import { POST as resumeXiaoyi } from "@/app/xiaoyi/v1/missions/resume/route";

// 执行实际 ArkTS 服务与纯契约模块；@ohos 网络仅以真实 Next route 替换。
class NativeApiError extends Error { constructor(public code: string, message: string, public status = 0) { super(message); } }
let valid = true, expired = false;
const moduleCache = new Map<string, Record<string, unknown>>();
function nativeModule(relative: string): Record<string, unknown> {
  const file = path.resolve("harmonyos/entry/src/main/ets", relative);
  const found = moduleCache.get(file); if (found) return found;
  const exports: Record<string, unknown> = {}; moduleCache.set(file, exports);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const require = (name: string) => {
    if (name.endsWith("/ApiClient")) return { ApiClient: class {} };
    if (name.endsWith("/SessionStore")) return { SessionStore: { isTokenValid: () => valid, handleSessionExpired: () => { valid = false; expired = true; } } };
    if (name.endsWith("/models/Project")) return { ApiError: NativeApiError };
    return nativeModule(path.relative(path.resolve("harmonyos/entry/src/main/ets"), path.resolve(path.dirname(file), `${name}.ets`)));
  };
  vm.runInNewContext("(function(require,exports){" + compiled.outputText + "\n})", {})(require, exports);
  return exports;
}
interface NativeService {
  create(body: object): Promise<{ mission: { id: string } }>;
  detail(id: string): ReturnType<typeof missionDetail>;
  events(id: string, seq: number): ReturnType<typeof missionEvents>;
  command(id: string, action: string, body: object, approvalId: string): Promise<unknown>;
  previewMaterial(id: string, body: object): Promise<Record<string, unknown>>;
  confirmMaterial(id: string, body: object): Promise<{ continued: boolean }>;
  previewArtifact(id: string, outputId: string, body: object): Promise<{ receipt: Record<string, unknown> }>;
  confirmArtifact(id: string, outputId: string, body: object): Promise<{ receipt: { artifactId: string } }>;
}
let userId = "", projectId = "", token = "", requests = 0;
async function dispatch(method: string, url: string, body?: object) {
  requests++;
  const request = new Request(`https://fixture.invalid${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const parts = new URL(request.url).pathname.split("/"); const id = parts[3], key = parts[4];
  let response: Response;
  if (url === "/api/missions") response = await webCreate(request);
  else if (key === "events") response = await webEvents(request, { params: Promise.resolve({ id }) });
  else if (key === "approvals") response = await approval(request, { params: Promise.resolve({ id, approvalId: parts[5] }) });
  else if (key === "continuations") response = await (parts[5] === "preview" ? previewMaterial : confirmMaterial)(request, { params: Promise.resolve({ id }) });
  else if (key === "outputs") response = await (parts[6] === "artifact-preview" ? previewArtifact : confirmArtifact)(request, { params: Promise.resolve({ id, outputId: parts[5] }) });
  else response = await webDetail(request, { params: Promise.resolve({ id }) });
  const success = nativeModule("common/ApiContract.ets").isSuccessCode as (method: string, code: number) => boolean;
  const value = await response.json();
  if (!success(method, response.status)) throw new NativeApiError(value.error.code, value.error.message, response.status);
  return value;
}
const Service = nativeModule("services/MissionService.ets").MissionService as new (client: object) => NativeService;
const native = new Service({ get: (url: string) => dispatch("GET", url), post: (url: string, body: object) => dispatch("POST", url, body) });
async function fixture(readOnly = false) {
  return createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "准备阶段实验汇报", llmContextApproved: true,
    missionConstraints: { executionBoundary: readOnly ? "READ_ANALYZE" : "PROPOSE_ACTION" }, continuationPolicy: { mode: "LOW_RISK_READ_ANALYZE" } });
}
async function slice(id: string, choice: Choice) { await runMissionSlice({ id, provider: async () => ({ choice, provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } }) }); }
beforeAll(async () => {
  const user = await db.user.create({ data: { username: `native-${Date.now()}`, displayName: "跨端隔离测试", passwordHash: "unused" } }); userId = user.id;
  const project = await db.project.create({ data: { title: "原生接续隔离项目", description: "fixture", goal: "完成阶段报告", scenario: "RESEARCH" } }); projectId = project.id;
  await db.projectMembership.create({ data: { userId, projectId } }); token = (await createSession(userId)).token;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
describe("R3.4 实际 ArkTS 服务 ↔ Next 路由", () => {
  it("Web 创建、原生读取同ID，202只受理，超过100事件按实际路由游标接续", async () => {
    const created = await native.create({ projectId, requestId: crypto.randomUUID(), goal: "继续整理实验汇报" });
    expect((await native.detail(created.mission.id)).status).toBe("READY");
    await db.$transaction(async tx => { for (let i = 0; i < 125; i++) await event(tx, created.mission.id, "FIXTURE", { i }); });
    const first = await native.events(created.mission.id, 0), second = await native.events(created.mission.id, first.nextAfterSeq);
    expect(first.events).toHaveLength(100); expect(second.events).toHaveLength(26); expect(second.events[0].seq).toBe(101);
  });
  it("失效会话在发请求之前拦截；直接API无认证401，别人的任务404", async () => {
    const count = requests; valid = false;
    await expect(native.detail("secret")).rejects.toMatchObject({ status: 401 }); expect(requests).toBe(count); expect(expired).toBe(true); valid = true;
    expect((await webDetail(new Request("https://fixture.invalid/api/missions/secret"), { params: Promise.resolve({ id: "secret" }) })).status).toBe(401);
    const m = await fixture(), old = token;
    const outsider = await db.user.create({ data: { username: `outsider-${Date.now()}`, displayName: "无权限用户", passwordHash: "unused" } }); token = (await createSession(outsider.id)).token;
    await expect(native.detail(m.id)).rejects.toMatchObject({ status: 404 }); token = old;
  });
  it("原生批准同一提案重复提交只创建一个TODO行动，旧版本拒绝", async () => {
    const m = await fixture(); await slice(m.id, { kind: "tool", tool: "propose_action", args: { title: "验证一次新实验" }, summary: "提案" });
    const d = await native.detail(m.id), a = d.approvals[0];
    const body = { requestId: "native-approval", expectedVersion: d.version, decision: "APPROVED", proposalHash: a.proposalHash };
    await native.command(m.id, "approval", body, a.id); await native.command(m.id, "approval", body, a.id);
    await runMissionSlice({ id: m.id });
    const actions = await db.actionItem.findMany({ where: { projectId, dedupeKey: { not: null } } }); expect(actions).toHaveLength(1); expect(actions[0].status).toBe("TODO");
    await expect(native.command(m.id, "approval", { ...body, requestId: "other" }, a.id)).rejects.toMatchObject({ status: 409 });
  });
  it("原生预览确认材料保持Mission，固定Output归入回执可重试", async () => {
    const m = await fixture(); await slice(m.id, { kind: "ask", question: "请补充实验结果", missing: "PRIVATE", requirements: { terms: ["准确率"], unit: "", period: "", sourceType: "CAPTURE" } });
    const d = await native.detail(m.id), capture = await db.capture.create({ data: { projectId, sourceType: "实验记录", rawText: "准确率达到82%，用户提供，含义待核验" } });
    const { readProjectMaterial } = await import("@/lib/mission/sourceSignals"); const source = (await readProjectMaterial(projectId, `capture:${capture.id}`))!;
    const selected = { questionId: d.question!.id, sourcePointers: [{ id: source.id, hash: source.hash }] };
    const p = await native.previewMaterial(m.id, selected); expect(p.assessment).toBe("SUFFICIENT");
    expect(await native.confirmMaterial(m.id, { ...selected, requestId: "native-material", expectedVersion: p.version, expectedContextVersion: p.contextVersion, assessmentHash: p.assessmentHash, answer: "已核对本次结果", confirmedGap: true })).toMatchObject({ continued: true });
    await slice(m.id, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "summary", kind: "INFERENCE", text: "建议按新实验结果补充报告。", sourceIds: [] }] }, summary: "草稿" });
    const current = await native.detail(m.id), output = current.outputs[0], preview = (await native.previewArtifact(m.id, output.id, { expectedOutputRevision: output.revision, artifactType: "weekly_report" })).receipt;
    const confirm = { requestId: "native-adopt", artifactType: "weekly_report", expectedOutputRevision: output.revision, expectedContextVersion: preview.contextVersion, previewHash: preview.previewHash };
    const one = await native.confirmArtifact(m.id, output.id, confirm), two = await native.confirmArtifact(m.id, output.id, confirm);
    expect(one.receipt.artifactId).toBe(two.receipt.artifactId); expect((await native.detail(m.id)).id).toBe(m.id);
  });
  it("UI独立开关只控制新入口；capabilities仍需项目归属", async () => {
    const request = () => new Request(`https://fixture.invalid/api/missions/capabilities?projectId=${projectId}`, { headers: { authorization: `Bearer ${token}` } });
    process.env.MISSION_UI_ENABLED = "false"; expect(await (await capabilities(request())).json()).toMatchObject({ enabled: false, widgetEnabled: false }); process.env.MISSION_UI_ENABLED = "true";
    expect((await capabilities(new Request("https://fixture.invalid/api/missions/capabilities?projectId=other", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(404);
  });
});
describe("R3.4 小艺受限接续", () => {
  const adapterToken = "r34-test-adapter-token-more-than-thirty-two-characters";
  function request(path: string, body: object, authenticated = true) { return new Request(`https://fixture.invalid/xiaoyi/v1/missions/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${adapterToken}` } : {}) }, body: JSON.stringify(body) }); }
  async function bind(id: string) { Object.assign(process.env, { XIAOYI_ENABLED: "true", XIAOYI_ADAPTER_ENABLED: "true", XIAOYI_ADAPTER_TOKEN: adapterToken, XIAOYI_TEST_PROJECT_ID: projectId, XIAOYI_TEST_USER_ID: userId, XIAOYI_MISSION_ALLOWLIST: id, XIAOYI_MISSION_ENABLED: "true" }); }
  it("默认关闭；需要token、固定身份与Mission白名单，禁止伪造owner", async () => {
    const m = await fixture(true); await bind(m.id); process.env.XIAOYI_MISSION_ENABLED = "false";
    expect((await inspectXiaoyi(request("inspect", { mission_id: m.id, request_id: "disabled" }))).status).toBe(503); process.env.XIAOYI_MISSION_ENABLED = "true";
    expect((await inspectXiaoyi(request("inspect", { mission_id: m.id, request_id: "anonymous" }, false))).status).toBe(401);
    expect((await inspectXiaoyi(request("inspect", { mission_id: "outside", request_id: "outside" }))).status).toBe(404);
    expect((await inspectXiaoyi(request("inspect", { mission_id: m.id, request_id: "forge", ownerUserId: userId }))).status).toBe(422);
  });
  it("同一Mission事件seq与App一致；已授权只读恢复幂等，不重置预算或写行动", async () => {
    const m = await fixture(true); await bind(m.id); await commandMission(userId, m.id, "pause", { requestId: "pause", expectedVersion: m.version });
    const paused = await native.detail(m.id); const state = await (await inspectXiaoyi(request("inspect", { mission_id: m.id, request_id: "inspect" }))).json();
    expect(state.mission.event_seq).toBe((await missionEvents(userId, m.id)).events.at(-1)!.seq); expect(state.mission.id).toBe(m.id);
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
    const body = { mission_id: m.id, expected_version: paused.version, request_id: "stable-resume" };
    expect((await resumeXiaoyi(request("resume", body))).status).toBe(202); expect((await resumeXiaoyi(request("resume", body))).status).toBe(202);
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } }); expect(after.budgetUsedJson).toEqual(before.budgetUsedJson); expect(after.version).toBe(before.version + 1);
    expect(await db.agentMissionEvent.count({ where: { missionId: m.id, commandRequestId: "cmd:xiaoyi-mission:stable-resume" } })).toBe(1);
  });
  it("行动提议授权不能通过小艺恢复；身份绑定或成员撤销后404", async () => {
    const m = await fixture(); await bind(m.id); await commandMission(userId, m.id, "pause", { requestId: "pause-write", expectedVersion: m.version });
    expect((await resumeXiaoyi(request("resume", { mission_id: m.id, expected_version: m.version + 1, request_id: "write" }))).status).toBe(409);
    process.env.XIAOYI_TEST_USER_ID = "other"; expect((await inspectXiaoyi(request("inspect", { mission_id: m.id, request_id: "revoked" }))).status).toBe(404);
    process.env.XIAOYI_TEST_USER_ID = userId;
  });
  it("授权快照后撤销自动许可，即使猜中未来版本也不能恢复", async () => {
    const m = await fixture(true); await bind(m.id);
    await commandMission(userId, m.id, "pause", { requestId: "race-pause", expectedVersion: m.version });
    const paused = await missionDetail(userId, m.id);
    const original = db.agentMission.findFirst.bind(db.agentMission);
    const spy = vi.spyOn(db.agentMission, "findFirst");
    spy.mockImplementationOnce(args => {
      const request = original(args);
      return request.then(async snapshot => {
        await editContinuationPolicy(userId, m.id, { requestId: "race-revoke", expectedVersion: paused.version, policy: { mode: "MANUAL" } });
        return snapshot;
      }) as typeof request;
    });
    try {
      const result = await resumeXiaoyi(request("resume", { mission_id: m.id, expected_version: paused.version + 1, request_id: "race-resume" }));
      expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ error: { code: "XIAOYI_MISSION_APP_REQUIRED" } });
      expect((await missionDetail(userId, m.id)).status).toBe("PAUSED");
      expect(await db.agentMissionEvent.count({ where: { missionId: m.id, type: "RESUME" } })).toBe(0);
    } finally { spy.mockRestore(); }
  });
});
