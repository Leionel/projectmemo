/**
 * Track E 第二批独立复验（候选 4b69614 / final-a-workpacket-v1）：
 * 当前来源许可、修订事实与历史留痕；观察失败与正常控制停止的区分。
 *
 * 依据 16_第二批ABCDE收尾Prompts.md E 段与 04_工程验收/09 §1、10 §4（R02/R09/R10），
 * 独立夹具（合成库 + 合成 Capture/Step/Event），不调用模型、Worker 或设备。
 * 断言不引用 A 的测试文件；失败即缺口，不放宽。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("../helpers/continuityDatabase")).continuityDatabase("final-e-round2-observation-source"),
);
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";
import { createMission } from "@/lib/mission/missionService";
import { readMissionBack, type MissionReadback } from "@/lib/mission/readback";
import { sourceHash } from "@/lib/mission/repository";
import { json } from "@/lib/mission/contracts";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(label: string, options: {
  text?: string;
  sourceType?: string;
  bindStep?: boolean;
  successObservationAt?: Date;
  noNewInformationAt?: Date;
} = {}) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({
    data: {
      title: label, description: "FINAL_E_ROUND2_SYNTHETIC_ONLY", goal: "核对当前许可与修订事实", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const text = options.text ?? "原始要求：先验证最小演示路径，不要先做高级功能";
  const mission = await createMission(user.id, { projectId: project.id, requestId: `m-${crypto.randomUUID()}`, goal: "核对原要求与当前依据" });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: text, ...(options.sourceType ? { sourceType: options.sourceType } : {}) } });
  const sourceId = `capture:${capture.id}`;
  const hash = (await sourceHash(project.id, sourceId))!;

  const withQuestion = await db.agentMission.update({
    where: { id: mission.id },
    data: { status: "WAITING_INPUT", nextEventSeq: { increment: 1 } },
  });
  const questionEvent = await db.agentMissionEvent.create({
    data: { missionId: mission.id, seq: withQuestion.nextEventSeq, type: "QUESTION", payloadJson: json({ question: "请核对原要求" }) },
  });
  const questionId = questionEvent.id;
  await db.agentMission.update({
    where: { id: mission.id },
    data: { waitStateJson: json({ questionId, question: "请核对原要求", waitingFor: "ANSWER", startedAt: new Date(Date.now() - 3_600_000).toISOString() }) },
  });
  await addEvent(mission.id, "SOURCE_ARRIVED", { questionId, sourcePointer: { id: sourceId, hash }, readable: true, observedAt: new Date().toISOString() });
  if (options.bindStep) {
    await db.agentMissionStep.create({
      data: {
        missionId: mission.id, ordinal: 1, planRevision: mission.planRevision, toolName: "bind_project_sources",
        inputHash: `bind-${crypto.randomUUID()}`, canonicalInputJson: json({ questionId, sourceId }),
        readSetJson: json([]), status: "SUCCEEDED", finishedAt: new Date(),
        resultJson: json({ data: { questionId }, sources: [{ id: sourceId, hash, text: text.slice(0, 400) }] }),
      },
    });
  }
  if (options.successObservationAt) {
    await db.agentMission.update({
      where: { id: mission.id },
      data: { planJson: json({ delegation: { lastObservedAt: options.successObservationAt.toISOString() } }) },
    });
  }
  if (options.noNewInformationAt) {
    await addEvent(mission.id, "INVESTIGATION_NO_NEW_INFORMATION", { changed: false }, options.noNewInformationAt);
  }
  return { user, project, mission: await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } }), capture, sourceId, hash, questionId, text };
}

async function addEvent(missionId: string, type: string, value: unknown, createdAt?: Date) {
  return db.$transaction(async tx => {
    const mission = await tx.agentMission.update({
      where: { id: missionId }, data: { nextEventSeq: { increment: 1 } }, select: { nextEventSeq: true },
    });
    return tx.agentMissionEvent.create({
      data: { missionId, seq: mission.nextEventSeq, type, payloadJson: json(value), ...(createdAt ? { createdAt } : {}) },
    });
  });
}

async function suppressSource(fx: Fixture, requestId = `suppress-${crypto.randomUUID()}`) {
  const actor = { userId: fx.user.id, sessionId: (await createSession(fx.user.id)).session.id };
  const conversation = await createConversation(actor, { requestId: `c-${crypto.randomUUID()}`, scope: "PROJECT", projectId: fx.project.id });
  const current = await db.user.findUniqueOrThrow({ where: { id: fx.user.id }, select: { continuitySeq: true } });
  const submitted = await submitDirective(actor, conversation.id, {
    commandId: requestId, expectedSeq: current.continuitySeq,
    scope: { projectId: fx.project.id, missionId: fx.mission.id },
    operation: "SUPPRESS_USE", sourceIds: [fx.sourceId], quote: "停止使用这条原始记录",
  });
  expect(JSON.stringify(submitted.view.directives)).toContain(fx.sourceId);
  return submitted;
}

const itemOf = (back: MissionReadback, sourceId: string) => {
  const item = back.materialUses.items.find(entry => entry.sourcePointer.id === sourceId);
  expect(item).toBeTruthy();
  return item!;
};
const blockerCodes = (back: MissionReadback) => back.workPacket!.blockers.map(blocker => blocker.code);

describe("FI-E-SRC 来源当前许可 / 修订事实 / 历史留痕必须分开", () => {
  it("FI-E-SRC-01 撤回来源：旧字段 UNAVAILABLE + excerpt=null，revisionAvailability 与历史 facts 保留，且撤回后不得沿用“无变化”结论", async () => {
    const observedAt = new Date(Date.now() - 120_000);
    const fx = await fixture("撤回来源", { bindStep: true, successObservationAt: observedAt, noNewInformationAt: observedAt });

    const before = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const itemBefore = itemOf(before, fx.sourceId);
    expect(itemBefore).toMatchObject({ availability: "CURRENT", revisionAvailability: "CURRENT", availabilityMeaning: "REVISION_MATCH_AND_CURRENT_USE_POLICY" });
    expect(itemBefore.currentUse).toMatchObject({ state: "ALLOWED", independentEvidence: true, appliesTo: "CURRENT_USE_ONLY" });
    expect(itemBefore.excerpt).toContain("先验证最小演示路径");
    expect(itemBefore.facts.map(fact => fact.kind)).toEqual(expect.arrayContaining(["CANDIDATE", "BOUND"]));
    // 依据当前可用时，最近一次成功观察的“无新变化”结论可见。
    expect(before.workPacket!.observations.state).toBe("OBSERVED");
    expect(before.workPacket!.done.note).toContain("无新变化");
    const factsBefore = JSON.stringify(itemBefore.facts), pointerBefore = JSON.stringify(itemBefore.sourcePointer);

    await suppressSource(fx);
    const after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const itemAfter = itemOf(after, fx.sourceId);
    // 旧消费者安全默认：不能把已撤回来源当当前正文。
    expect(itemAfter.availability).toBe("UNAVAILABLE");
    expect(itemAfter.excerpt).toBeNull();
    // 原修订事实与历史留痕独立保留，不因许可变化改写。
    expect(itemAfter.revisionAvailability).toBe("CURRENT");
    expect(itemAfter.currentUse).toMatchObject({ state: "SUPPRESSED", independentEvidence: false, appliesTo: "CURRENT_USE_ONLY" });
    expect(JSON.stringify(itemAfter.facts)).toBe(factsBefore);
    expect(JSON.stringify(itemAfter.sourcePointer)).toBe(pointerBefore);
    expect(itemAfter.bodyCoverage).toBe("NOT_RECORDED");
    // 工作包给出明确的当前许可阻断，且不再宣称“无新变化”。
    expect(blockerCodes(after)).toContain("CURRENT_USE_SUPPRESSED");
    expect(blockerCodes(after)).not.toContain("SOURCE_CHANGED");
    expect(after.workPacket!.basis.currentUsePolicy).toBe("SOURCE_POLICY_APPLIED");
    expect(after.workPacket!.done.note).not.toContain("无新变化");
    // 执行路径同样拒绝：撤回来源不能继续作为本次批准依据。
    expect(after.materialUses.items.every(item => item.currentUse !== null)).toBe(true);
  });

  it("FI-E-SRC-02 来源链未知：不得默认允许，旧字段 UNAVAILABLE + excerpt=null，阻断为 CURRENT_USE_UNKNOWN", async () => {
    // 仓库信号 Capture 但没有 adoptedExternalSignal：原 SourcePolicy 判为 LINEAGE_UNKNOWN。
    const fx = await fixture("来源链未知", { sourceType: "仓库信号", bindStep: true });
    const back = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const item = itemOf(back, fx.sourceId);
    expect(item.currentUse).toMatchObject({ state: "UNKNOWN", independentEvidence: false });
    expect(item.currentUse!.reason).toBe("LINEAGE_UNKNOWN");
    expect(item.availability).toBe("UNAVAILABLE");
    expect(item.excerpt).toBeNull();
    expect(item.revisionAvailability).toBe("CURRENT");
    expect(item.facts.length).toBeGreaterThan(0);
    expect(blockerCodes(back)).toContain("CURRENT_USE_UNKNOWN");
    expect(back.workPacket!.done.note).not.toContain("无新变化");
  });

  it("FI-E-SRC-03 来源修订：CHANGED 与 UNAVAILABLE 区分，旧摘录不得拼接新正文，且不得沿用无变化结论", async () => {
    const observedAt = new Date(Date.now() - 120_000);
    const fx = await fixture("来源修订", { bindStep: true, successObservationAt: observedAt, noNewInformationAt: observedAt });
    const before = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    expect(itemOf(before, fx.sourceId).availability).toBe("CURRENT");
    expect(before.workPacket!.done.note).toContain("无新变化");

    const newText = "新要求：先验证最小演示路径，再考虑高级功能；这是修订后的正文";
    await db.capture.update({ where: { id: fx.capture.id }, data: { rawText: newText } });
    const after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const item = itemOf(after, fx.sourceId);
    // 许可仍允许，但修订事实必须显式 CHANGED（不能显示为无变化/当前）。
    expect(item.availability).toBe("CHANGED");
    expect(item.revisionAvailability).toBe("CHANGED");
    expect(item.currentUse).toMatchObject({ state: "ALLOWED" });
    expect(blockerCodes(after)).toContain("SOURCE_CHANGED");
    // 若仍给出历史摘录，只能是绑定时的旧文，不能拼接修订后的新文。
    if (item.excerpt !== null) {
      expect(item.excerpt).not.toContain("这是修订后的正文");
      expect(item.excerpt).not.toContain(newText);
    }
    expect(after.workPacket!.done.note).not.toContain("无新变化");
  });

  it("FI-E-SRC-04 撤回 + 修订：旧字段 UNAVAILABLE，但 revisionAvailability 仍为 CHANGED，两类事实同时保留", async () => {
    const fx = await fixture("撤回且修订", { bindStep: true });
    const before = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const itemBefore = itemOf(before, fx.sourceId);
    // SAVED 是“写入时保存该指针”的合成标记，只在修订仍匹配时补充；比较历史留痕时忽略它。
    const historicalFacts = (item: { facts: Array<{ kind: string }> }) =>
      JSON.stringify(item.facts.filter(fact => fact.kind !== "SAVED"));
    const factsBefore = historicalFacts(itemBefore);
    await db.capture.update({ where: { id: fx.capture.id }, data: { rawText: "修订后的正文：先验证最小演示路径" } });
    await suppressSource(fx);
    const after = await readMissionBack(fx.user.id, fx.mission.id, { questionId: fx.questionId });
    const item = itemOf(after, fx.sourceId);
    expect(item.availability).toBe("UNAVAILABLE");
    expect(item.excerpt).toBeNull();
    expect(item.revisionAvailability).toBe("CHANGED");
    expect(historicalFacts(item)).toBe(factsBefore);
    expect(blockerCodes(after)).toEqual(expect.arrayContaining(["SOURCE_CHANGED", "CURRENT_USE_SUPPRESSED"]));
  });
});

describe("FI-E-OBS 观察失败与正常控制停止必须分开", () => {
  it("FI-E-OBS-02 原成功观察时间稳定；真实声明观察失败保留成功时间并置 FAILED_LAST", async () => {
    const successfulAt = new Date(Date.now() - 180_000);
    const failedAt = new Date(Date.now() - 60_000);
    const fx = await fixture("成功观察后失败", { successObservationAt: successfulAt, noNewInformationAt: successfulAt });
    const first = await readMissionBack(fx.user.id, fx.mission.id);
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await readMissionBack(fx.user.id, fx.mission.id);
    expect(first.observation).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: successfulAt.toISOString() });
    expect(second.observation.lastSuccessfulAt).toBe(first.observation.lastSuccessfulAt);
    expect(second.workState.observedAt).toBe(successfulAt.toISOString());

    // 与原 runner 的 EXECUTION_STOPPED 声明观察失败载荷同型。
    await addEvent(fx.mission.id, "EXECUTION_STOPPED", {
      code: "TOOL_FAILED", phase: "TOOL", purpose: "DECLARED_OBSERVATION",
      recovery: { kind: "REVIEW_REQUIRED", automatic: false },
    }, failedAt);
    const failed = await readMissionBack(fx.user.id, fx.mission.id);
    expect(failed.observation).toMatchObject({
      state: "FAILED_LAST", lastSuccessfulAt: successfulAt.toISOString(), lastFailedAt: failedAt.toISOString(),
    });
    expect(failed.workPacket!.next.note).toContain("观察失败");
    expect(failed.workPacket!.done.note).not.toContain("无新变化");
  });

  it.each([
    { label: "用户暂停", status: "PAUSED", pauseReason: "USER", code: "STOP_REQUESTED", recovery: "STOP_REQUESTED" },
    { label: "用户取消", status: "CANCELLED", pauseReason: "USER", code: "STOP_REQUESTED", recovery: "STOP_REQUESTED" },
    { label: "累计预算耗尽", status: "PAUSED", pauseReason: "BUDGET", code: "BUDGET_EXHAUSTED", recovery: "BUDGET_REVIEW" },
  ])("FI-E-OBS-03 $label 不是观察失败：保留原成功观察，不新增 lastFailedAt", async control => {
    const successfulAt = new Date(Date.now() - 180_000);
    const stoppedAt = new Date(Date.now() - 60_000);
    const fx = await fixture(control.label, { successObservationAt: successfulAt });
    await db.agentMission.update({
      where: { id: fx.mission.id },
      data: {
        status: control.status, pauseReason: control.pauseReason,
        ...(control.label === "用户取消" ? { cancelRequestedAt: stoppedAt } : control.label === "用户暂停" ? { pauseRequestedAt: stoppedAt } : {}),
        lastErrorJson: json({ code: control.code, recovery: { kind: control.recovery, automatic: false } }),
      },
    });
    // 即使控制边界事件声明了观察 purpose，正常停止/额度也不是观察失败。
    await addEvent(fx.mission.id, "EXECUTION_STOPPED", {
      code: control.code, phase: "TOOL", purpose: "DECLARED_OBSERVATION", category: "DOMAIN",
      recovery: { kind: control.recovery, automatic: false },
    }, stoppedAt);
    const back = await readMissionBack(fx.user.id, fx.mission.id);
    expect(back.missionStatus).toBe(control.status);
    expect(back.observation.lastSuccessfulAt).toBe(successfulAt.toISOString());
    expect(back.observation.lastFailedAt).toBeNull();
    expect(back.observation.state).toBe("OBSERVED");
    expect(back.workPacket!.next.note).not.toContain("观察失败");
  });

  it.each([
    { label: "无观察声明的旧工具失败", type: "EXECUTION_STOPPED", payload: { code: "EXECUTION_FAILED", phase: "TOOL", category: "EXECUTION", recovery: { kind: "REVIEW_REQUIRED", automatic: false } } },
    { label: "模型格式错误", type: "MODEL_PROTOCOL_ERROR", payload: { code: "MODEL_PROTOCOL_ERROR", phase: "DECISION", category: "MODEL_PROTOCOL", recovery: { kind: "MODEL_FORMAT_RETRY", automatic: false } } },
  ])("FI-E-OBS-04 $label 不能推断为观察失败：原成功观察保留，失败事件原样保留", async failure => {
    const successfulAt = new Date(Date.now() - 180_000);
    const fx = await fixture(failure.label, { successObservationAt: successfulAt });
    const original = await addEvent(fx.mission.id, failure.type, failure.payload, new Date(Date.now() - 60_000));
    const back = await readMissionBack(fx.user.id, fx.mission.id);
    expect(back.observation).toMatchObject({ state: "OBSERVED", lastSuccessfulAt: successfulAt.toISOString(), lastFailedAt: null });
    expect(back.workPacket!.next.note).not.toContain("观察失败");
    expect(await db.agentMissionEvent.findUnique({ where: { id: original.id } })).toEqual(original);
  });
});
