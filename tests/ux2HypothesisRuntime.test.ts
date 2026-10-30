import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  process.env.MISSION_SEMANTIC_CHECK_ENABLED = "false";
  return (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-hypotheses");
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, commandMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { buildContext } from "@/lib/mission/contextBuilder";
import { sourceHash } from "@/lib/mission/repository";
import { enqueueImpact } from "@/lib/decision/impactJobs";
import { readHypotheses, assertCognitiveReadSet } from "@/lib/memory/hypothesisService";
import { readEffectiveDigests } from "@/lib/memory/digestService";
import { completeProjectAction } from "@/lib/services/actionService";
import type { Choice } from "@/lib/mission/contracts";
import type { HypothesisUpdate } from "@/lib/memory/synthesisContract";
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const provider = (choice: Choice) => async () => ({ choice, provider: "UX2_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
const tool = (tool: string, args: unknown): Choice => ({ kind: "tool", tool, args, summary: "独立测试步骤" });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "假设验证", passwordHash: "fixture" } });
  const p = await db.project.create({ data: { title: "设备启动核对", goal: "完成真实设备验证", description: "隔离测试", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: p.id, rawText: "D1 只有安装记录，没有目标设备启动记录。" } });
  const m = await createMission(user.id, { projectId: p.id, requestId: crypto.randomUUID(), goal: "调查启动失败条件", llmContextApproved: true });
  return { user, p, m, capture };
}
async function read(missionId: string, projectId: string, captureId: string) {
  const sourceId = "capture:" + captureId;
  await runMissionSlice({ id: missionId, provider: provider(tool("read_project_material", { sourceId, sourceHash: await sourceHash(projectId, sourceId) })) });
}
async function assess(missionId: string, h: HypothesisUpdate, commitments: Array<{ actionId?: string; missionId?: string; note: string }> = []) {
  await runMissionSlice({ id: missionId, provider: provider(tool("save_mission_output", { schemaVersion: 1, kind: "NOTE",
    blocks: [{ blockId: "judgment", kind: "INFERENCE", text: h.statement, sourceIds: h.evidence.map(e => e.sourceId) }],
    memorySynthesis: { summary: h.explanation, conditions: h.conditions, retainedReasons: ["安装与启动分开判断"], openQuestions: [h.nextInformationNeed], commitments, hypotheses: [h] } })) });
}
function initial(sourceId: string, quote: string): HypothesisUpdate {
  return { statement: "安装成功尚不能推出目标设备可启动", conditions: ["同一目标设备、同一安装包"], state: "PROPOSED",
    explanation: "还缺启动证据", nextInformationNeed: "读取目标设备启动日志", evidence: [{ sourceId, role: "TRIGGER", quote }] };
}

test("D1提出、D3同一推测反证、D5新任务接续，原批准→真实Action→resultCardId读回", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const day1 = Date.now();
  try {
    const { user, p, m, capture } = await fixture();
    await read(m.id, p.id, capture.id); await assess(m.id, initial("capture:" + capture.id, capture.rawText));
    let h = (await readHypotheses(user.id, p.id)).items[0];
    expect(h.effectiveStatus).toBe("PROPOSED"); expect(h.revision).toBe(1);
    const oldContext = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })));
    vi.setSystemTime(day1 + 2 * 86400000);
    const counter = await db.$transaction(async tx => {
      const c = await tx.capture.create({ data: { projectId: p.id, rawText: "D3 同一设备、同一安装包已完成启动实测，日志确认启动成功。" } });
      await enqueueImpact(tx, p.id, "counter:" + c.id, ["capture:" + c.id]); return c;
    });
    expect((await readHypotheses(user.id, p.id)).items[0].effectiveStatus).toBe("EXPIRED");
    expect((await readEffectiveDigests(user.id, p.id)).items[0].effectiveState).toBe("STALE");
    await expect(assertCognitiveReadSet(user.id, oldContext.hypotheses.readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
    await read(m.id, p.id, counter.id);
    await assess(m.id, { ...initial("capture:" + counter.id, counter.rawText), claimId: h.id, expectedRevision: 1, state: "REFUTED",
      explanation: "在相同条件下已有启动实测，原缺证据判断已不适用", nextInformationNeed: "核对其他验收条件", evidence: [{ sourceId: "capture:" + counter.id, role: "COUNTER", quote: counter.rawText }] });
    h = (await readHypotheses(user.id, p.id)).items[0];
    expect(h.effectiveStatus).toBe("REFUTED"); expect(h.revision).toBe(2);
    expect(await db.agentClaim.count({ where: { projectId: p.id, kind: "HYPOTHESIS" } })).toBe(1);
    expect(await db.agentClaimEvent.count({ where: { claimId: h.id } })).toBe(2);
    vi.setSystemTime(day1 + 4 * 86400000);
    const next = await createMission(user.id, { projectId: p.id, requestId: crypto.randomUUID(), goal: "接着处理验收条件", llmContextApproved: true });
    const context = JSON.parse(await buildContext(next)); expect(context.hypotheses.items[0]).toMatchObject({ id: h.id, revision: 2, effectiveStatus: "REFUTED" });
    await runMissionSlice({ id: next.id, provider: provider(tool("propose_action", { title: "核对其余验收条件", description: "读取同一设备的完整验收清单" })) });
    const detail = await missionDetail(user.id, next.id); const approval = detail.approvals[0]; expect(approval).toBeTruthy();
    expect(await db.actionItem.count({ where: { projectId: p.id } })).toBe(0);
    await commandMission(user.id, next.id, "approval", { requestId: "approve", expectedVersion: detail.version, decision: "APPROVED", proposalHash: approval.proposalHash }, approval.id);
    await runMissionSlice({ id: next.id });
    const action = await db.actionItem.findFirstOrThrow({ where: { projectId: p.id } });
    const completed = await completeProjectAction(p.id, action.id, "在目标设备逐项验收完成，原启动日志已核对。"); expect(completed.resultCardId).toBeTruthy();
    // Readback is the original result card, not model-inferred completion.
    await assess(next.id, { ...initial("capture:" + counter.id, counter.rawText), statement: "剩余条件已记录完成，仍保留原启动反例", state: "INCONCLUSIVE", evidence: [] }, [{ actionId: action.id, note: "回读原结果" }]);
    const digest = (await readEffectiveDigests(user.id, p.id)).items.find(d => d.sourceMissionId === next.id);
    expect(digest?.commitments[0]).toMatchObject({ actionStatus: "DONE", resultCardId: completed.resultCardId });
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: next.id } })).budgetUsedJson).toMatchObject({ models: 2 });
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).goal).toBe(p.goal);
  } finally { vi.useRealTimers(); }
}, 45000);

test("模型请求支持但没有合格原证据只能未定；到期无事件即时失效，纯读取零写入", async () => {
  const { user, p, m, capture } = await fixture(); await read(m.id, p.id, capture.id);
  await assess(m.id, { ...initial("capture:" + capture.id, "伪造的引文"), state: "SUPPORTED", validUntil: new Date(Date.now() + 10000).toISOString() });
  const h = (await readHypotheses(user.id, p.id)).items[0]; expect(h.effectiveStatus).toBe("INCONCLUSIVE"); expect(h.evidence[0].qualified).toBe(false);
  const count = await db.agentClaimEvent.count(), budget = (await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).budgetUsedJson;
  vi.useFakeTimers({ toFake: ["Date"] }); try { vi.setSystemTime(Date.now() + 20000); expect((await readHypotheses(user.id, p.id)).items[0].effectiveStatus).toBe("EXPIRED"); } finally { vi.useRealTimers(); }
  expect(await db.agentClaimEvent.count()).toBe(count); expect((await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).budgetUsedJson).toEqual(budget);
  const outsider = await fixture(); await expect(readHypotheses(outsider.user.id, p.id)).rejects.toMatchObject({ status: 404 });
}, 30000);

test("模型在途收到新输入，旧选择不发布、原预算保留，原Runner可接续", async () => {
  const { user, p, m } = await fixture(); let arrived!: () => void, resume!: () => void;
  const started = new Promise<void>(r => { arrived = r; }), barrier = new Promise<void>(r => { resume = r; });
  const running = runMissionSlice({ id: m.id, provider: async () => { arrived(); await barrier; return provider(tool("save_mission_output", { blocks: [{ blockId: "old", kind: "INFERENCE", text: "旧判断", sourceIds: [] }] }))(); } });
  await started;
  await db.$transaction(tx => enqueueImpact(tx, p.id, "new-input", ["project:" + p.id])); resume(); await running;
  let row = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } }); expect(row.status).toBe("READY");
  expect(row.budgetUsedJson).toMatchObject({ models: 1 }); expect(await db.agentMissionOutput.count({ where: { missionId: m.id } })).toBe(0);
  const version = (await db.project.findUniqueOrThrow({ where: { id: p.id } })).contextRevision;
  await db.$transaction(tx => enqueueImpact(tx, p.id, "new-input", ["project:" + p.id]));
  expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).contextRevision).toBe(version);
  await runMissionSlice({ id: m.id, provider: provider({ kind: "ask", question: "新条件下缺哪份日志？", missing: "PRIVATE" }) });
  row = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } }); expect(row.status).toBe("WAITING_INPUT"); expect(row.budgetUsedJson).toMatchObject({ models: 2 });
  expect(await db.agentMissionEvent.count({ where: { missionId: m.id, type: "COGNITIVE_RECOORDINATED" } })).toBe(1);
  expect(await db.agentClaim.count({ where: { ownerUserId: user.id } })).toBe(0);
}, 30000);
