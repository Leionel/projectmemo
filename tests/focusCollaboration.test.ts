import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-focus-f2-")), file = path.join(dir, "test.db");
  Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", MISSION_ENABLED: "true",
    MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", DECISION_SCENARIOS_ENABLED: "true", LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file);
  for (const n of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", n, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation, bindRefs } from "@/lib/conversation/service";
import { readConversationWork, previewConversationWork, compareConversationScenarios, assessConversationMaterials } from "@/lib/conversation/workService";
import { confirmConversationProposal } from "@/lib/conversation/missionCommands";
import { declineConversationAction } from "@/lib/conversation/commands";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { createMission, missionDetail, commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { json, jsonHash, type Choice } from "@/lib/mission/contracts";
import { actionResultVersion, prepareActionResult, commitActionResult } from "@/lib/services/actionService";
import type { ConversationWorkPreview, ConversationWorkRef } from "@/lib/types/conversationWork";
import { GET as getWork, POST as postWork } from "@/app/api/conversations/[id]/work/route";
import { POST as confirmRoute } from "@/app/api/conversations/[id]/proposals/[executionId]/confirm/route";
import { POST as reconcileRoute } from "@/app/api/conversations/[id]/reconcile/route";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "F2隔离验证", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "原始实验项目", description: "隔离资料", goal: "实验报告", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const c = await createConversation(actor, { requestId: "create", scope: "WORKSPACE" });
  const m = await createMission(user.id, { projectId: project.id, requestId: "mission", goal: "核对部署证据", llmContextApproved: true });
  const action = await db.actionItem.create({ data: { projectId: project.id, title: "验证部署条件", description: "记录真实结果" } });
  await db.$transaction(async tx => {
    await bindRefs(tx, c.id, [{ kind: "MISSION", id: m.id, projectId: project.id, title: m.goal, href: "/projects/" + project.id + "/missions?mission=" + m.id },
      { kind: "ACTION", id: action.id, projectId: project.id, title: action.title, href: "/projects/" + project.id + "/actions" }]);
    await tx.conversation.update({ where: { id: c.id }, data: { focusJson: { projectId: project.id } } });
  });
  return { actor, user, project, id: c.id, m, action,
    ref: { kind: "MISSION", id: m.id, projectId: project.id } as ConversationWorkRef,
    actionRef: { kind: "ACTION", id: action.id, projectId: project.id } as ConversationWorkRef };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function preview(f: F, ref: ConversationWorkRef, operation: ConversationWorkPreview["operation"], extra = {}) {
  const c = await readConversation(f.actor, f.id), w = await readConversationWork(f.actor, f.id, ref);
  const r = await previewConversationWork(f.actor, f.id, { requestId: crypto.randomUUID(), expectedConversationVersion: c.version, ref, versionToken: w.versionToken, operation, ...extra });
  return r.conversation.messages.at(-1)!.proposal!;
}
async function confirm(f: F, p: Awaited<ReturnType<typeof preview>>, requestId = crypto.randomUUID()) {
  return confirmConversationProposal(f.actor, f.id, p.executionId, { requestId, proposalHash: p.proposalHash, confirmed: true });
}
async function slice(f: F, choice: Choice) {
  await runMissionSlice({ id: f.m.id, provider: async () => ({ choice, provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  return missionDetail(f.user.id, f.m.id);
}
async function waiting(f: F) {
  await slice(f, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "gap", kind: "INFERENCE", text: "实验指标待补充", sourceIds: [] }] }, summary: "保留草稿" });
  return slice(f, { kind: "ask", question: "10月本地实验 Dice 数值？", missing: "PRIVATE", requirements: { terms: ["Dice", "10月"], unit: "%", period: "10月", sourceType: "CAPTURE" } });
}
describe.sequential("F2 original-object collaboration", () => {
  it("completes the same Action, persists one reflection and reads it after repeated confirmation", async () => {
    const f = await fixture(), p = await preview(f, f.actionRef, "complete_action", { answer: "实测推理通过，结果已复核。" });
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: f.action.id } })).status).toBe("TODO");
    const results = await Promise.all([confirm(f, p, "confirm"), confirm(f, p, "confirm")]);
    expect(results.map(r => "resultId" in r ? r.resultId : null)).toEqual([f.action.id, f.action.id]);
    const a = await db.actionItem.findUniqueOrThrow({ where: { id: f.action.id } });
    expect(a.status).toBe("DONE"); expect(a.resultCardId).toBeTruthy();
    expect(await db.knowledgeCard.count({ where: { projectId: f.project.id, type: "reflection" } })).toBe(1);
    expect((await readConversation(f.actor, f.id)).messages.find(m => m.proposal?.executionId === p.executionId)?.proposal).toMatchObject({ resultId: a.id, actionStatus: "DONE", resultCardId: a.resultCardId });
    await expect(confirm(f, { ...p, proposalHash: "0".repeat(64) }, "confirm")).rejects.toMatchObject({ code: "PROPOSAL_CHANGED" });
  });
  it("rolls back the effect if persisting its conversation receipt fails", async () => {
    const f = await fixture(), p = await preview(f, f.actionRef, "complete_action", { answer: "已完成一次完整验证。" });
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_f2_receipt BEFORE INSERT ON ConversationTurn WHEN NEW.requestId='fail-receipt' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`);
    try { await expect(confirm(f, p, "fail-receipt")).rejects.toThrow(); } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_f2_receipt"); }
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: f.action.id } })).status).toBe("TODO");
    expect(await db.knowledgeCard.count({ where: { projectId: f.project.id } })).toBe(0);
    await confirm(f, p, "fail-receipt");
    expect((await readConversationWork(f.actor, f.id, f.actionRef)).resultCardId).toBeTruthy();
  });
  it("cancellation and action edits defeat a frozen completion, including the original service transaction", async () => {
    const f = await fixture(), prepared = await prepareActionResult(f.project.id, f.action.id, "实际完成了验证。", true);
    const p = await preview(f, f.actionRef, "complete_action", { answer: "实际完成了验证。" });
    await db.actionItem.update({ where: { id: f.action.id }, data: { status: "CANCELLED" } });
    await expect(confirm(f, p)).rejects.toMatchObject({ code: "OBJECT_CHANGED" });
    await expect(db.$transaction(tx => commitActionResult(tx, prepared))).rejects.toMatchObject({ code: "ACTION_CHANGED" });
    expect(await db.capture.count({ where: { projectId: f.project.id } })).toBe(0);
  });
  it("preserves the target across continuous result references and asks before writing", async () => {
    const f = await fixture();
    let c = await readConversation(f.actor, f.id);
    await submitConversationTurn(f.actor, f.id, { requestId: "inspect", expectedVersion: c.version, message: "查已有证据", entityRef: f.actionRef });
    c = await readConversation(f.actor, f.id);
    const r = await submitConversationTurn(f.actor, f.id, { requestId: "result", expectedVersion: c.version, message: "验证结果是：设备测试通过，仍待正式复测。" });
    expect(r.conversation.messages.at(-1)?.proposal?.tool).toBe("complete_action");
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: f.action.id } })).status).toBe("TODO");
    const replay = await submitConversationTurn(f.actor, f.id, { requestId: "result", expectedVersion: c.version, message: "验证结果是：设备测试通过，仍待正式复测。" });
    expect(replay.conversation.messages.at(-1)?.proposal?.executionId).toBe(r.conversation.messages.at(-1)?.proposal?.executionId);
  });
  it("binds an answer to the exact original question, and never substitutes a second Mission", async () => {
    const f = await fixture(); await waiting(f);
    const second = await createMission(f.user.id, { projectId: f.project.id, requestId: "other", goal: "另一个目标" });
    const p = await preview(f, f.ref, "input", { answer: "10月本地实验 Dice 为82%，来源待补充。" });
    await confirm(f, p);
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).status).toBe("READY");
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: second.id } })).version).toBe(second.version);
    expect(await db.agentMission.count({ where: { projectId: f.project.id } })).toBe(2);
  });
  it.each(["APPROVED", "REJECTED"])("confirms %s against the original approval; approval alone is not Action completion", async decision => {
    const f = await fixture();
    await db.agentMission.update({ where: { id: f.m.id }, data: { constraintsJson: json({ ...f.m.constraintsJson as object, executionBoundary: "PROPOSE_ACTION" }) } });
    await slice(f, { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目" });
    await slice(f, { kind: "tool", tool: "propose_action", args: { title: "核对部署证据" }, summary: "等待批准" });
    const w = await readConversationWork(f.actor, f.id, f.ref);
    expect(w.status).toBe("WAITING_APPROVAL"); expect(w.approval).toBeTruthy();
    const p = await preview(f, f.ref, "approval", { decision }); await confirm(f, p); await confirm(f, p);
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: w.approval!.id } })).status).toBe(decision);
    expect(await db.actionItem.count({ where: { projectId: f.project.id } })).toBe(1);
    if (decision === "APPROVED") {
      await slice(f, { kind: "ask", question: "下一步仍需确认什么？", missing: "PRIVATE" });
      const a = await db.actionItem.findMany({ where: { projectId: f.project.id, dedupeKey: { not: null } } });
      expect(a).toHaveLength(1); expect(a[0].status).toBe("TODO"); expect(a[0].resultCardId).toBeNull();
    }
  });
  it("uses real materials, preserves unmet gaps and refuses changed sources", async () => {
    const f = await fixture(); await waiting(f);
    const capture = await db.capture.create({ data: { projectId: f.project.id, rawText: "10月本地实验 Dice 为82%" } });
    const work = await readConversationWork(f.actor, f.id, f.ref), pointer = work.candidates.find(c => c.sourcePointer.id === "capture:" + capture.id)!.sourcePointer;
    const c = await readConversation(f.actor, f.id);
    const input = { requestId: "materials", expectedConversationVersion: c.version, ref: f.ref, versionToken: work.versionToken, operation: "continuation", answer: "核对数值和期间一致", sourcePointers: [pointer] };
    expect((await assessConversationMaterials(f.actor, f.id, input)).assessment).toBe("SUFFICIENT");
    const p = (await previewConversationWork(f.actor, f.id, input)).conversation.messages.at(-1)!.proposal!;
    await db.capture.update({ where: { id: capture.id }, data: { rawText: "已修正为11月数据" } });
    await expect(confirm(f, p)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).status).toBe("WAITING_INPUT");
  });
  it("commits selected materials to the same Mission once and reads a READY receipt", async () => {
    const f = await fixture(); await waiting(f);
    await db.capture.create({ data: { projectId: f.project.id, rawText: "10月本地实验 Dice 82%" } });
    const w = await readConversationWork(f.actor, f.id, f.ref);
    const p = await preview(f, f.ref, "continuation", { answer: "已核对原实验条件和期间", sourcePointers: w.candidates.map(c => c.sourcePointer) });
    await confirm(f, p); await confirm(f, p);
    expect((await readConversationWork(f.actor, f.id, f.ref)).status).toBe("READY");
    expect(await db.agentMissionStep.count({ where: { missionId: f.m.id, toolName: "bind_project_sources" } })).toBe(1);
  });
  it("freezes option order, resolves first choice to the original proposal and keeps a user veto", async () => {
    const f = await fixture(), w = await readConversationWork(f.actor, f.id, f.ref);
    const compared = await compareConversationScenarios(f.actor, f.id, { ref: f.ref, versionToken: w.versionToken, requestId: "compare", availableMinutes: 60, deliveryMinutes: 20 });
    const source = compared.conversation.messages.at(-1)!;
    expect(source.options?.map(o => o.key)).toEqual(["VERIFY_FIRST", "DELIVER_FIRST"]);
    const r = await submitConversationTurn(f.actor, f.id, { requestId: "choice", expectedVersion: compared.conversation.version, message: "选第一种" });
    expect(r.conversation.messages.at(-1)?.proposal?.tool).toBe("adopt_scenario");
    const p = r.conversation.messages.at(-1)!.proposal!;
    await declineConversationAction(f.actor, f.id, p.executionId);
    await expect(confirm(f, p)).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    expect((await db.decisionScenarioProposal.findUniqueOrThrow({ where: { id: source.options![0].proposalId } })).status).toBe("READY");
  });
  it("adopts the existing scenario without creating another proposal or Mission", async () => {
    const f = await fixture();
    await commandMission(f.user.id, f.m.id, "pause", { requestId: "pause", expectedVersion: f.m.version });
    const w = await readConversationWork(f.actor, f.id, f.ref);
    const compared = await compareConversationScenarios(f.actor, f.id, { ref: f.ref, versionToken: w.versionToken, requestId: "compare", availableMinutes: 60, deliveryMinutes: 20 });
    const option = compared.conversation.messages.at(-1)!.options![1];
    const p = await preview(f, f.ref, "adopt_scenario", { scenarioProposalId: option.proposalId, scenarioKey: option.key });
    await confirm(f, p); await confirm(f, p);
    expect((await db.decisionScenarioProposal.findUniqueOrThrow({ where: { id: option.proposalId } })).selectedKey).toBe("DELIVER_FIRST");
    expect(await db.agentMission.count({ where: { projectId: f.project.id } })).toBe(1);
    expect(await db.decisionScenarioProposal.count({ where: { missionId: f.m.id } })).toBe(1);
  });
  it("lets a vetoed first option remain unadopted while previewing a different frozen option", async () => {
    const f = await fixture(), w = await readConversationWork(f.actor, f.id, f.ref);
    const r = await compareConversationScenarios(f.actor, f.id, { ref: f.ref, versionToken: w.versionToken, requestId: "options", availableMinutes: 60, deliveryMinutes: 20 });
    const first = r.conversation.messages.at(-1)!.options![0], second = r.conversation.messages.at(-1)!.options![1];
    await db.conversation.update({ where: { id: f.id }, data: { pinnedStateJson: ["不要选择第一种，换一种"] } });
    await expect(preview(f, f.ref, "adopt_scenario", { scenarioProposalId: first.proposalId, scenarioKey: first.key })).rejects.toMatchObject({ code: "READ_ONLY_CONSTRAINT" });
    const p = await preview(f, f.ref, "adopt_scenario", { scenarioProposalId: second.proposalId, scenarioKey: second.key });
    await confirm(f, p);
    expect((await db.decisionScenarioProposal.findUniqueOrThrow({ where: { id: second.proposalId } })).selectedKey).toBe("DELIVER_FIRST");
  });
  it("resolves first-choice replies against their original project and refuses a contradictory project parameter", async () => {
    const f = await fixture(), w = await readConversationWork(f.actor, f.id, f.ref);
    const a = await compareConversationScenarios(f.actor, f.id, { ref: f.ref, versionToken: w.versionToken, requestId: "project-a", availableMinutes: 60, deliveryMinutes: 20 });
    const original = a.conversation.messages.at(-1)!;
    const b = await db.project.create({ data: { title: "另一项目", description: "独立范围", goal: "不同目标", scenario: "RESEARCH", memberships: { create: { userId: f.user.id } } } });
    const bm = await createMission(f.user.id, { projectId: b.id, requestId: "mission-b", goal: "整理不同目标" });
    await db.$transaction(tx => bindRefs(tx, f.id, [{ kind: "MISSION", id: bm.id, projectId: b.id, title: bm.goal, href: "/projects/" + b.id + "/missions" }]));
    const ref: ConversationWorkRef = { kind: "MISSION", id: bm.id, projectId: b.id }, bw = await readConversationWork(f.actor, f.id, ref);
    const compared = await compareConversationScenarios(f.actor, f.id, { ref, versionToken: bw.versionToken, requestId: "project-b", availableMinutes: 60, deliveryMinutes: 20 });
    await expect(submitConversationTurn(f.actor, f.id, { requestId: "contradiction", expectedVersion: compared.conversation.version, projectId: b.id, replyToMessageId: original.id, message: "选第一种" })).rejects.toMatchObject({ code: "CONTEXT_SCOPE_CHANGED" });
    const current = await readConversation(f.actor, f.id);
    const chosen = await submitConversationTurn(f.actor, f.id, { requestId: "original-choice", expectedVersion: current.version, replyToMessageId: original.id, message: "选第一种" });
    expect(chosen.conversation.messages.at(-1)?.proposal?.projectId).toBe(f.project.id);
  });
  it("keeps an unrelated new capture from invalidating a local action-result proposal", async () => {
    const f = await fixture(), p = await preview(f, f.actionRef, "complete_action", { answer: "独立验证已完成，结果正常。" });
    await db.capture.create({ data: { projectId: f.project.id, rawText: "与本行动无关的新课程笔记" } });
    await confirm(f, p);
    expect((await readConversationWork(f.actor, f.id, f.actionRef)).status).toBe("DONE");
  });
  it("adopts one exact Output revision and reads the original artifact receipt", async () => {
    const f = await fixture();
    await slice(f, { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目" });
    const d = await slice(f, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "goal", kind: "PROJECT_OBSERVATION", text: "项目仍需核对部署依据", sourceIds: ["project:" + f.project.id] }] }, summary: "保存草稿" });
    const output = d.outputs[0], p = await preview(f, f.ref, "adopt_artifact", { outputId: output.id, outputRevision: output.revision });
    await confirm(f, p); await confirm(f, p);
    const receipts = await db.missionArtifactReceipt.findMany({ where: { missionId: f.m.id } });
    expect(receipts).toHaveLength(1); expect(receipts[0]).toMatchObject({ outputId: output.id, outputRevision: output.revision });
    expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(1);
  });
  it.each(["READY", "RUNNING", "WAITING_INPUT", "WAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"])("refuses a resume shortcut for %s", async status => {
    const f = await fixture(); await db.agentMission.update({ where: { id: f.m.id }, data: { status } });
    await expect(preview(f, f.ref, "resume")).rejects.toMatchObject({ code: "MISSION_NOT_PAUSED" });
  });
  it("resumes a PAUSED Mission, rejects tampering, expiry, changed constraints and revoked access", async () => {
    const f = await fixture(); await db.agentMission.update({ where: { id: f.m.id }, data: { status: "PAUSED" } });
    const p = await preview(f, f.ref, "resume");
    await expect(confirm(f, { ...p, proposalHash: "0".repeat(64) })).rejects.toMatchObject({ code: "PROPOSAL_CHANGED" });
    await db.conversation.update({ where: { id: f.id }, data: { pinnedStateJson: ["只读，不执行操作"] } });
    await expect(confirm(f, p)).rejects.toMatchObject({ code: "READ_ONLY_CONSTRAINT" });
    await db.conversation.update({ where: { id: f.id }, data: { pinnedStateJson: [] } });
    const e = await db.copilotToolExecution.findUniqueOrThrow({ where: { id: p.executionId } });
    const payload = { ...e.proposalJson as object, expiresAt: Date.now() - 1 };
    await db.copilotToolExecution.update({ where: { id: e.id }, data: { proposalJson: json(payload), proposalHash: jsonHash(payload) } });
    await expect(confirm(f, { ...p, proposalHash: jsonHash(payload) })).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    const fresh = await preview(f, f.ref, "resume"); await confirm(f, fresh);
    expect((await readConversationWork(f.actor, f.id, f.ref)).status).toBe("READY");
    await db.projectMembership.delete({ where: { userId_projectId: { userId: f.user.id, projectId: f.project.id } } });
    await expect(confirm(f, fresh)).rejects.toMatchObject({ status: 404 });
    expect((await readConversation(f.actor, f.id)).messages.every(m => m.restricted)).toBe(true);
  });
  it("refuses an unbound or cross-project object and a changed source fingerprint", async () => {
    const a = await fixture(), b = await fixture();
    await expect(readConversationWork(a.actor, a.id, b.ref)).rejects.toMatchObject({ status: 404 });
    await expect(readConversationWork(a.actor, a.id, { ...a.ref, id: b.m.id })).rejects.toMatchObject({ code: "OBJECT_NOT_BOUND" });
    const scalar = await db.actionItem.findUniqueOrThrow({ where: { id: a.action.id } });
    expect(actionResultVersion(scalar)).toBe(actionResultVersion({ ...scalar, status: scalar.status }));
  });
  it("runs the ArkTS adapter through authenticated work, preview, confirm and receipt reconciliation APIs", async () => {
    const f = await fixture(), session = await createSession(f.user.id);
    class Client {
      async send(path: string, method: string, body?: unknown) {
        const r = new Request("https://fixture.invalid" + path, { method, headers: { Authorization: "Bearer " + session.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const parts = path.split("?")[0].split("/"), id = parts[3], context = { params: Promise.resolve({ id }) };
        const response = parts[4] === "work" ? method === "GET" ? await getWork(r, context) : await postWork(r, context)
          : parts[4] === "reconcile" ? await reconcileRoute(r, context) : await confirmRoute(r, { params: Promise.resolve({ id, executionId: parts[5] }) });
        const value = await response.json(); if (!response.ok) throw value; return value;
      }
      get(path: string) { return this.send(path, "GET"); }
      post(path: string, body: unknown) { return this.send(path, "POST", body); }
    }
    const exports: Record<string, unknown> = {}, code = ts.transpileModule(fs.readFileSync("harmonyos/entry/src/main/ets/services/ConversationService.ets", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext("(function(require,exports){" + code + "})", {})(() => ({ ApiClient: Client }), exports);
    const Service = exports.ConversationService as new () => {
      work(id: string, ref: ConversationWorkRef): ReturnType<typeof readConversationWork>;
      previewWork(id: string, input: unknown): ReturnType<typeof previewConversationWork>;
      confirm(id: string, execution: string, input: unknown): Promise<unknown>;
      reconcile(id: string): Promise<{ conversation: Awaited<ReturnType<typeof readConversation>> }>;
    };
    const native = new Service(), w = await native.work(f.id, f.actionRef), c = await readConversation(f.actor, f.id);
    const r = await native.previewWork(f.id, { ref: f.actionRef, requestId: "native-result", expectedConversationVersion: c.version, versionToken: w.versionToken, operation: "complete_action", answer: "原生端实测验证完成，保留回执。" });
    const p = r.conversation.messages.at(-1)!.proposal!;
    await native.confirm(f.id, p.executionId, { requestId: "native-confirm", proposalHash: p.proposalHash, confirmed: true });
    expect((await native.reconcile(f.id)).conversation.messages.find(m => m.proposal?.executionId === p.executionId)?.proposal?.resultCardId).toBeTruthy();
  });
});
