import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import Database from "better-sqlite3";
import type { ConversationView } from "../lib/types/conversation";
import type { ReviewView, DynamicReviewResult, ConversationReviews } from "../lib/types/changeReview";

if (!process.argv.includes("--real") || !process.argv.includes("--confirm-paid-calls")) {
  console.log(JSON.stringify({ mode: "PREPARED_ONLY", calls: 0, journey: "D1/D2 → user confirmation → original Runner → same conversation → Web/ArkTS readback" }));
  process.exit(0);
}
const budgetPath = path.resolve(process.env.FOCUS_REVIEW_BUDGET_FILE ?? "output/focus-f3-closeout-20261026/call-budget.json");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8")) as { limit: number; used: number };
if (!Number.isInteger(budget.limit) || budget.limit <= 0 || budget.limit > 12 || budget.used >= budget.limit) throw new Error("追加模型额度不足或未设置本轮12次上限");
if (process.env.LLM_MODE !== "openai-compatible") throw new Error("真实旅程需要已配置的模型");
const output = path.resolve("output", "focus-f3-journey-" + new Date().toISOString().replaceAll(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "pm-f3-journey-"));
// Import db only after assigning an independent database. Never touches the user's project database.
Object.assign(process.env, { DATABASE_URL: "file:" + path.join(isolated, "journey.db").replaceAll("\\", "/"), MISSION_ENABLED: "true",
  FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", GOAL_CHANGE_REVIEW_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false" });
const sql = new Database(path.join(isolated, "journey.db"));
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const file = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8"));
}
sql.close();
const { db } = await import("../lib/db");
const { createSession } = await import("../lib/auth/session");
const { createMission } = await import("../lib/mission/missionService");
const { sourceHash } = await import("../lib/mission/repository");
const { createConversation, bindRefs, readConversation } = await import("../lib/conversation/service");
const { readConversationWork, previewConversationWork } = await import("../lib/conversation/workService");
const { listConversationAnchors, commandConversationAnchor, syncConversationAnchors } = await import("../lib/conversation/anchorService");
const { runMissionSlice } = await import("../lib/mission/runner");
const { GET: webRead } = await import("../app/api/conversations/[id]/route");
const { GET: readReviews, POST: postReview } = await import("../app/api/conversations/[id]/work/review/route");
const { POST: postConfirm } = await import("../app/api/conversations/[id]/proposals/[executionId]/confirm/route");
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (budget.used >= budget.limit) throw new Error("达到本轮追加模型上限，停止调用");
  calls++; budget.used++; fs.writeFileSync(budgetPath, JSON.stringify(budget));
  const response = await originalFetch(...args);
  const payload = await response.clone().json().catch(() => null) as { choices?: unknown; usage?: unknown } | null;
  fs.writeFileSync(path.join(output, `response-${calls}.json`), JSON.stringify({ httpStatus: response.status, choices: payload?.choices, usage: payload?.usage }, null, 2));
  return response;
};
const report: Record<string, unknown> = { kind: "REAL_MODEL_ORIGINAL_RUNNER_JOURNEY", inputOrigin: "ISOLATED_SYNTHETIC_PROJECT", deviceAcceptance: "NOT_RUN", independentQualityReview: "PENDING" };
try {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), passwordHash: "unusable", displayName: "隔离真实旅程" } });
  const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
  const project = await db.project.create({ data: { title: "模型A部署核对", scenario: "RESEARCH", description: "真实模型、原Runner，独立验收资料",
    goal: "在设备D的6GB预算内部署模型A", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const mission = await createMission(user.id, { requestId: "journey-mission", projectId: project.id, goal: project.goal, llmContextApproved: true });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "ISOLATED_EVALUATION",
    rawText: "设备D部署日志：模型A推理batch=1，重复三次的GPU内存峰值均为6.8GB，超过原定6GB预算；是否包含运行时缓存尚未注明。请先核对这份已有原始日志。" } });
  const sourceId = "capture:" + capture.id;
  const conversation = await createConversation(actor, { requestId: "journey-conversation", scope: "PROJECT", projectId: project.id });
  const ref = { kind: "MISSION" as const, id: mission.id, projectId: project.id };
  await db.$transaction(tx => bindRefs(tx, conversation.id, [{ ...ref, title: mission.goal, href: `/projects/${project.id}/missions/${mission.id}` }]));
  const request = (url: string, method: string, body?: unknown) => new Request("http://isolated" + url, { method,
    headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const params = { params: Promise.resolve({ id: conversation.id }) };
  async function review(purpose: string, extra: Record<string, unknown>) {
    const view = await readConversation(actor, conversation.id), work = await readConversationWork(actor, conversation.id, ref);
    const response = await postReview(request(`/api/conversations/${conversation.id}/work/review`, "POST", {
      requestId: crypto.randomUUID(), expectedConversationVersion: view.version, ref, expectedVersion: work.version, purpose, llmContextApproved: true, ...extra,
    }), params);
    if (!response.ok) throw new Error(`Review HTTP ${response.status}: ${await response.text()}`);
    return (await response.json()).review as ReviewView;
  }
  const root = await review("CHANGE_REVIEW", { sources: [{ id: sourceId, hash: await sourceHash(project.id, sourceId) }] });
  report.root = root;
  if (root.status !== "READY" || !root.result || !("decision" in root.result) || root.result.decision === "KEEP_PLAN") throw new Error("相关变化未产生可继续的复核");
  const dynamic = await review("DYNAMIC_PLAN", { reviewId: root.id, feedback: "先核对已保存的设备D部署日志，暂不创建新的现实实验。" });
  report.dynamic = dynamic;
  const selected = (dynamic.result as DynamicReviewResult | null)?.candidates.find(c => c.kind === "READ_EXISTING" && c.feasibility === "READY");
  if (dynamic.status !== "READY" || !selected) throw new Error("模型没有提供可执行的已有资料读取候选");
  const before = await readConversation(actor, conversation.id), work = await readConversationWork(actor, conversation.id, ref);
  const preview = await previewConversationWork(actor, conversation.id, { requestId: "journey-preview", expectedConversationVersion: before.version,
    ref, operation: "adopt_dynamic", versionToken: work.versionToken, dynamicProposalId: dynamic.id, candidateId: selected.candidateId });
  const proposal = preview.conversation.messages.at(-1)!.proposal!;
  const confirmInput = { requestId: "journey-confirm", proposalHash: proposal.proposalHash, confirmed: true };
  const confirmParams = { params: Promise.resolve({ id: conversation.id, executionId: proposal.executionId }) };
  const confirmed = await postConfirm(request(`/api/conversations/${conversation.id}/proposals/${proposal.executionId}/confirm`, "POST", confirmInput), confirmParams);
  if (!confirmed.ok) throw new Error(`Confirm HTTP ${confirmed.status}: ${await confirmed.text()}`);
  report.confirmation = await confirmed.json();
  const duplicate = await postConfirm(request(`/api/conversations/${conversation.id}/proposals/${proposal.executionId}/confirm`, "POST", confirmInput), confirmParams);
  if (!duplicate.ok || !(await duplicate.json()).alreadyExecuted) throw new Error("重复确认未读回原效果");
  const anchor = (await listConversationAnchors(actor, conversation.id)).anchors[0];
  if (!anchor) throw new Error("缺少原任务关注引用");
  await commandConversationAnchor(actor, conversation.id, anchor.id, { requestId: "journey-follow", expectedVersion: anchor.version, action: "FOLLOW" });
  const beforeRunner = calls;
  await runMissionSlice({ id: mission.id }); await runMissionSlice({ id: mission.id });
  if (calls !== beforeRunner) throw new Error("原Runner定向读取意外调用了规划模型");
  const sync = await syncConversationAnchors(actor, conversation.id);
  const count = sync.conversation.messages.length;
  if ((await syncConversationAnchors(actor, conversation.id)).conversation.messages.length !== count) throw new Error("重复结果投影产生重复消息");
  if (!sync.conversation.messages.some(m => m.content.includes("原委托已读回所选资料"))) throw new Error("原会话缺少执行结果");
  const webResponse = await webRead(request(`/api/conversations/${conversation.id}`, "GET"), params);
  const web = await webResponse.json() as ConversationView;
  class NativeClient {
    async get(url: string) {
      const response = url.includes("/work/review") ? await readReviews(request(url, "GET"), params) : await webRead(request(url, "GET"), params);
      if (!response.ok) throw new Error(`Native readback HTTP ${response.status}`);
      return response.json();
    }
  }
  const code = ts.transpileModule(fs.readFileSync("harmonyos/entry/src/main/ets/services/ConversationService.ets", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext("(function(require,exports){" + code + "})", {})((name: string) => name.endsWith("ApiClient") ? { ApiClient: NativeClient } : {}, exports);
  const Service = exports.ConversationService as new () => { read(id: string): Promise<ConversationView>; reviews(id: string, ref: unknown): Promise<ConversationReviews> };
  const native = await new Service().read(conversation.id), nativeReviews = await new Service().reviews(conversation.id, ref);
  if (native.id !== web.id || native.messages.map(m => m.id).join() !== web.messages.map(m => m.id).join() || nativeReviews.dynamic?.id !== dynamic.id) throw new Error("Web与真实ArkTS服务读回的对象不一致");
  const executed = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const steps = await db.agentMissionStep.findMany({ where: { missionId: mission.id }, select: { id: true, toolName: true, status: true, resultJson: true } });
  if (executed.status !== "PAUSED" || !steps.some(s => s.toolName === "read_project_material" && s.status === "SUCCEEDED")) throw new Error("原委托没有完成定向读取并暂停");
  Object.assign(report, { status: "PASS", conversationId: conversation.id, missionId: mission.id, sourceId, selectedCandidateId: selected.candidateId,
    missionStatus: executed.status, runnerExtraModelCalls: calls - beforeRunner, duplicateEffect: false, duplicateProjection: false,
    webArktsSameMessages: true, arktsMode: "ACTUAL_SERVICE_TRANSPILED_TO_AUTHENTICATED_NEXT_HANDLERS", steps, conversation: web });
} catch (error) {
  Object.assign(report, { status: "FAILED", error: error instanceof Error ? error.message : "旅程未完成" });
  process.exitCode = 1;
} finally {
  Object.assign(report, { modelCalls: calls, extraBudgetUsed: budget.used, extraBudgetLimit: budget.limit });
  fs.writeFileSync(path.join(output, "journey.json"), JSON.stringify(report, null, 2));
  globalThis.fetch = originalFetch; await db.$disconnect();
  console.log(JSON.stringify({ output, status: report.status, calls, extraBudgetUsed: budget.used, deviceAcceptance: "NOT_RUN" }));
}
