/**
 * Track E 独立验收：Mission 命令并发/版本/旧批准/丢回包重试/跨账号/同对象身份。
 *
 * 依据 04_工程验收/10_纵向演示与独立验收协议.md 的反例 R04/R05/R06 与
 * 07_执行准备/03_鸿蒙与独立验收职责.md 的 E-SEC-01、D-REC-01、D-ACC-01、FS-A04/FS-A07 验收条件。
 * 独立夹具：合成库 + 合成任务，不使用真实用户材料；服务端断言，不以 UI 禁用代替。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("../helpers/continuityDatabase")).continuityDatabase("final-e-commands"),
);
import fs from "node:fs";
import { db } from "@/lib/db";
import { commandMission, createMission, missionDetail } from "@/lib/mission/missionService";
import { readMissionBack } from "@/lib/mission/readback";
import { json, jsonHash } from "@/lib/mission/contracts";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

const TEN_MINUTES = 10 * 60 * 1000;

async function ownerFixture(label: string) {
  const user = await db.user.create({
    data: { username: crypto.randomUUID(), displayName: label, passwordHash: "unused" },
  });
  const project = await db.project.create({
    data: {
      title: label,
      description: "FINAL_E_SYNTHETIC_ONLY",
      goal: "独立验收合成项目",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id } },
    },
  });
  return { user, project };
}

/** 合成 WAITING_INPUT：真实事件表 + waitState，和 Runner 写入的形状一致。 */
async function waitingInputMission(userId: string, projectId: string) {
  const mission = await createMission(userId, {
    projectId,
    requestId: `m-${crypto.randomUUID()}`,
    goal: "核对最小演示路径是否先于高级功能",
  });
  const question = "还需要补充哪一项原始记录？";
  // createMission 已经写过 seq=1 的 CREATED 事件；先递增 nextEventSeq 再写 QUESTION。
  const updated = await db.agentMission.update({
    where: { id: mission.id },
    data: { status: "WAITING_INPUT", nextEventSeq: { increment: 1 } },
  });
  const questionEvent = await db.agentMissionEvent.create({
    data: { missionId: mission.id, seq: updated.nextEventSeq, type: "QUESTION", payloadJson: json({ question }) },
  });
  // 原问题身份就是 QUESTION 事件 id（服务端 commandMission 用 q.id 校验）。
  const questionId = questionEvent.id;
  await db.agentMission.update({
    where: { id: mission.id },
    data: { waitStateJson: json({ questionId, question, waitingFor: "ANSWER", startedAt: new Date().toISOString() }) },
  });
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  return { mission: current, questionId };
}

const proposal = { tool: "propose_action", args: { title: "整理阶段汇报提纲", dueAt: null } };

/** 合成 WAITING_APPROVAL：step + approval 均为真实表行，读回与服务端校验走原路径。 */
async function waitingApprovalMission(userId: string, projectId: string, expiresAt: Date = new Date(Date.now() + TEN_MINUTES)) {
  const mission = await createMission(userId, {
    projectId,
    requestId: `m-${crypto.randomUUID()}`,
    goal: "为阶段汇报准备一份可核对提纲",
    missionConstraints: { executionBoundary: "PROPOSE_ACTION" },
  });
  const stepId = `step-${crypto.randomUUID()}`;
  await db.agentMissionStep.create({
    data: {
      id: stepId,
      missionId: mission.id,
      ordinal: 1,
      planRevision: mission.planRevision,
      toolName: "propose_action",
      canonicalInputJson: json(proposal.args),
      inputHash: "synthetic-input-hash",
      readSetJson: json([]),
      effectKey: `effect-${crypto.randomUUID()}`,
      status: "WAITING_APPROVAL",
      protocolJson: json({}),
    },
  });
  const approval = await db.agentMissionApproval.create({
    data: {
      missionId: mission.id,
      stepId,
      proposalHash: jsonHash(proposal),
      proposalJson: json(proposal),
      expectedPlanRevision: mission.planRevision,
      readSetJson: json([]),
      expiresAt,
    },
  });
  await db.agentMission.update({ where: { id: mission.id }, data: { status: "WAITING_APPROVAL" } });
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  return { mission: current, stepId, approval, proposalHash: jsonHash(proposal) };
}

describe("R06 丢回包重试：同一 requestId 只有一个业务结果", () => {
  it("补充原问题的回包丢失后重试：不新增事件、不推进版本；同号不同内容被拒绝", async () => {
    const { user, project } = await ownerFixture("E 重试用户");
    const { mission, questionId } = await waitingInputMission(user.id, project.id);
    const requestId = `answer-${crypto.randomUUID()}`;
    const body = { requestId, expectedVersion: mission.version, questionId, answer: "先验证最小演示路径" };

    const first = await commandMission(user.id, mission.id, "input", body);
    expect(first.status).toBe("READY");
    const afterFirst = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    const eventsAfterFirst = await db.agentMissionEvent.count({ where: { missionId: mission.id } });

    // 客户端没收到回包，拿原 requestId 重发同一请求。
    const retry = await commandMission(user.id, mission.id, "input", body);
    const afterRetry = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(retry.id).toBe(mission.id);
    expect(afterRetry.version).toBe(afterFirst.version);
    expect(afterRetry.status).toBe("READY");
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id } })).toBe(eventsAfterFirst);

    // 原回执可按 requestId 查到，且只有一条。
    const receipts = await db.agentMissionEvent.findMany({
      where: { missionId: mission.id, commandRequestId: `cmd:${requestId}` },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].type).toBe("INPUT");

    // 同一 requestId 换了内容：不能当成新操作执行，也不能静默接受。
    await expect(
      commandMission(user.id, mission.id, "input", { ...body, answer: "另一个不同答复" }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });
  });

  it("批准回执重试只留一次决策，不产生第二个批准", async () => {
    const { user, project } = await ownerFixture("E 批准重试用户");
    const { mission, approval, proposalHash } = await waitingApprovalMission(user.id, project.id);
    const requestId = `approve-${crypto.randomUUID()}`;
    const body = { requestId, expectedVersion: mission.version, decision: "APPROVED" as const, proposalHash };

    await commandMission(user.id, mission.id, "approval", body, approval.id);
    const eventsAfterFirst = await db.agentMissionEvent.count({ where: { missionId: mission.id } });
    const afterFirst = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(afterFirst.status).toBe("READY");
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("APPROVED");

    await commandMission(user.id, mission.id, "approval", body, approval.id);
    const afterRetry = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(afterRetry.version).toBe(afterFirst.version);
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id } })).toBe(eventsAfterFirst);
    expect(await db.agentMissionApproval.count({ where: { missionId: mission.id } })).toBe(1);

    // 换新的 requestId 再次确认：旧批准已消费，服务端拒绝，不重复执行。
    await expect(
      commandMission(
        user.id,
        mission.id,
        "approval",
        { requestId: `approve2-${crypto.randomUUID()}`, expectedVersion: afterRetry.version, decision: "APPROVED", proposalHash },
        approval.id,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CHANGED", status: 409 });
  });
});

describe("FS-A07 并发版本变化：旧页面/迟到提交不能覆盖新版本", () => {
  it("另一客户端已写入后，用旧 expectedVersion 提交：409 且不产生第二个业务结果", async () => {
    const { user, project } = await ownerFixture("E 版本用户");
    const { mission, questionId } = await waitingInputMission(user.id, project.id);
    // A、B 两个客户端都读到 version=1；A 先提交成功。
    await commandMission(user.id, mission.id, "input", {
      requestId: `a-${crypto.randomUUID()}`,
      expectedVersion: mission.version,
      questionId,
      answer: "先验证最小演示路径",
    });
    // B 仍按旧版本提交（页面未刷新/回包迟到）。
    await expect(
      commandMission(user.id, mission.id, "input", {
        requestId: `b-${crypto.randomUUID()}`,
        expectedVersion: mission.version,
        questionId,
        answer: "第二个迟到的答复",
      }),
    ).rejects.toMatchObject({ code: "MISSION_CHANGED", status: 409 });
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id, type: "INPUT" } })).toBe(1);
  });

  it("两个并发提交同一 expectedVersion：恰好一个成功，另一个 409，不双写", async () => {
    const { user, project } = await ownerFixture("E 真并发用户");
    const { mission, questionId } = await waitingInputMission(user.id, project.id);
    const results = await Promise.allSettled([
      commandMission(user.id, mission.id, "input", { requestId: `p1-${crypto.randomUUID()}`, expectedVersion: mission.version, questionId, answer: "并发答复一" }),
      commandMission(user.id, mission.id, "input", { requestId: `p2-${crypto.randomUUID()}`, expectedVersion: mission.version, questionId, answer: "并发答复二" }),
    ]);
    const fulfilled = results.filter(result => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code?: string }).code).toBe("MISSION_CHANGED");
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id, type: "INPUT" } })).toBe(1);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(current.version).toBe(mission.version + 1);
  });

  it("planRevision 已被其他操作推进时，旧提案即使版本号最新也不能执行", async () => {
    const { user, project } = await ownerFixture("E 旧提案用户");
    const { mission, approval, proposalHash } = await waitingApprovalMission(user.id, project.id);
    // 另一条真实路径（修改约束）会推进 planRevision 并使原提案失效；这里只推进 planRevision，
    // 模拟“旧写入在服务端再校验”的局部条件，验证服务端不会只信任 UI 的版本号。
    await db.agentMission.update({ where: { id: mission.id }, data: { planRevision: { increment: 1 } } });
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await expect(
      commandMission(
        user.id,
        mission.id,
        "approval",
        { requestId: `stale-${crypto.randomUUID()}`, expectedVersion: current.version, decision: "APPROVED", proposalHash },
        approval.id,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CHANGED", status: 409 });
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("R05 旧批准链接：过期/已替代/已消费都不能直接执行", () => {
  it("重新预览后旧批准变为 EXPIRED：执行拒绝，读回如实显示当前状态", async () => {
    const { user, project } = await ownerFixture("E 旧链接用户");
    const { mission, approval, proposalHash } = await waitingApprovalMission(user.id, project.id);
    const before = await readMissionBack(user.id, mission.id, { approvalId: approval.id });
    expect(before.selected.approval).toMatchObject({ id: approval.id, status: "PENDING" });

    await commandMission(user.id, mission.id, "replan", {
      requestId: `replan-${crypto.randomUUID()}`,
      expectedVersion: mission.version,
    });
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(current.status).toBe("READY");
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("EXPIRED");
    expect((await db.agentMissionStep.findUniqueOrThrow({ where: { id: approval.stepId } })).status).toBe("OBSOLETE");

    // 旧链接执行：即使版本号是最新的，也用不到已失效的批准。
    await expect(
      commandMission(
        user.id,
        mission.id,
        "approval",
        { requestId: `old-${crypto.randomUUID()}`, expectedVersion: current.version, decision: "APPROVED", proposalHash },
        approval.id,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CHANGED", status: 409 });
    // 读回同一旧链接：返回当前状态（EXPIRED），不伪装成 PENDING，且没有行动回执。
    const after = await readMissionBack(user.id, mission.id, { approvalId: approval.id });
    expect(after.selected.approval?.status).toBe("EXPIRED");
    expect(after.actionReceipts).toHaveLength(0);
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("提案已过 expiresAt：等于边界即失效，拒绝执行", async () => {
    const { user, project } = await ownerFixture("E 过期提案用户");
    const { mission, approval, proposalHash } = await waitingApprovalMission(user.id, project.id, new Date(Date.now() - 1));
    await expect(
      commandMission(
        user.id,
        mission.id,
        "approval",
        { requestId: `expired-${crypto.randomUUID()}`, expectedVersion: mission.version, decision: "APPROVED", proposalHash },
        approval.id,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CHANGED", status: 409 });
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("提案 hash 与预览不一致：拒绝执行", async () => {
    const { user, project } = await ownerFixture("E 提案哈希用户");
    const { mission, approval } = await waitingApprovalMission(user.id, project.id);
    await expect(
      commandMission(
        user.id,
        mission.id,
        "approval",
        { requestId: `hash-${crypto.randomUUID()}`, expectedVersion: mission.version, decision: "APPROVED", proposalHash: "f".repeat(64) },
        approval.id,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_CHANGED", status: 409 });
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
  });

  it("批准通过后旧写入仍有服务端校验：其他账号的委托与提案不可见", async () => {
    const { user, project } = await ownerFixture("E 权限用户");
    const { mission, approval, proposalHash } = await waitingApprovalMission(user.id, project.id);
    const other = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "另一账号", passwordHash: "unused" } });
    await expect(commandMission(other.id, mission.id, "approval", {
      requestId: `foreign-${crypto.randomUUID()}`,
      expectedVersion: mission.version,
      decision: "APPROVED",
      proposalHash,
    }, approval.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    await expect(readMissionBack(other.id, mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    await expect(missionDetail(other.id, mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND", status: 404 });
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
  });
});

describe("同一 Mission/Question/Approval/Action/resultCardId 身份", () => {
  it("读回只认本委托的原问题/提案；跨委托对象返回 404，不改指向另一项", async () => {
    const { user, project } = await ownerFixture("E 身份用户");
    const first = await waitingInputMission(user.id, project.id);
    const second = await waitingInputMission(user.id, project.id);
    const secondApproval = await waitingApprovalMission(user.id, project.id);

    await expect(readMissionBack(user.id, first.mission.id, { questionId: second.questionId }))
      .rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });
    await expect(readMissionBack(user.id, first.mission.id, { approvalId: secondApproval.approval.id }))
      .rejects.toMatchObject({ code: "MISSION_TARGET_NOT_FOUND", status: 404 });

    const own = await readMissionBack(user.id, first.mission.id, { questionId: first.questionId });
    expect(own.missionId).toBe(first.mission.id);
    expect(own.selected.question).toMatchObject({ id: first.questionId, historical: false });
    expect(own.workState.exactQuestionRef).toBe(first.questionId);
  });

  it("新问题出现后，旧问题链接标记为历史，不冒充当前问题", async () => {
    const { user, project } = await ownerFixture("E 历史问题用户");
    const { mission, questionId } = await waitingInputMission(user.id, project.id);
    await db.agentMission.update({ where: { id: mission.id }, data: { nextEventSeq: { increment: 1 } } });
    const updated = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await db.agentMissionEvent.create({
      data: { missionId: mission.id, seq: updated.nextEventSeq, type: "QUESTION", payloadJson: json({ question: "新的待核对问题" }) },
    });
    const readback = await readMissionBack(user.id, mission.id, { questionId });
    expect(readback.selected.question).toMatchObject({ id: questionId, historical: true });
  });

  it("Action/resultCardId 回执链保留同一对象；跨项目或模拟回执不被混入真实回执", async () => {
    const { user, project } = await ownerFixture("E 回执身份用户");
    const { mission } = await waitingInputMission(user.id, project.id);
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: "完成回执的原始记录" } });
    const card = await db.knowledgeCard.create({
      data: {
        projectId: project.id, captureId: capture.id, type: "meeting_note", title: "完成回执",
        summary: "用户报告完成", importance: 1, keywords: [], relatedTasks: [], nextActions: [],
      },
    });
    const action = await db.actionItem.create({
      data: { projectId: project.id, title: "提交阶段汇报提纲", status: "DONE", resultCardId: card.id, completedAt: new Date(), resultText: "已提交，待老师反馈" },
    });
    await db.agentMissionStep.create({
      data: {
        missionId: mission.id, ordinal: 2, planRevision: 1, toolName: "propose_action",
        canonicalInputJson: json(proposal.args), inputHash: "synthetic-2", readSetJson: json([]),
        status: "SUCCEEDED", resultJson: json({ data: { actionId: action.id, resultCardId: card.id }, sources: [] }),
      },
    });
    // 另一个项目里的行动不能借由本委托的步骤结果泄漏进来。
    const foreign = await ownerFixture("E 另一项目");
    const foreignCapture = await db.capture.create({ data: { projectId: foreign.project.id, rawText: "别的项目记录" } });
    const foreignCard = await db.knowledgeCard.create({
      data: {
        projectId: foreign.project.id, captureId: foreignCapture.id, type: "meeting_note", title: "别的回执",
        summary: "不应出现", importance: 1, keywords: [], relatedTasks: [], nextActions: [],
      },
    });
    const foreignAction = await db.actionItem.create({
      data: { projectId: foreign.project.id, title: "别的项目行动", status: "DONE", resultCardId: foreignCard.id },
    });
    await db.agentMissionStep.create({
      data: {
        missionId: mission.id, ordinal: 3, planRevision: 1, toolName: "propose_action",
        canonicalInputJson: json(proposal.args), inputHash: "synthetic-3", readSetJson: json([]),
        status: "SUCCEEDED", resultJson: json({ data: { actionId: foreignAction.id }, sources: [] }),
      },
    });
    const readback = await readMissionBack(user.id, mission.id);
    expect(readback.actionReceipts.map(receipt => receipt.id)).toEqual([action.id]);
    expect(readback.actionReceipts[0]).toMatchObject({ resultCardId: card.id, isSimulated: false, status: "DONE" });
    expect(readback.realityOutcome).toBe("NOT_INFERRED");
    expect(readback.reviewProgress.counts.userReported.actionReceipts).toBe(1);
  });
});

/**
 * FS-A04 合同迁移（2026-11-03 主控裁决 + 两组独立源码复核；E 作为原测试作者提交）。
 *
 * 旧断言（原 33 例套件中的红例，证据保留在 evidence/final-e-20261103/）要求 legacy
 * `readback.observedAt` 在无写入时恒定。复核结论：该字段原本就是“本次读取时刻”，
 * 原 Web `components/MissionReadback.tsx:91` 与鸿蒙
 * `harmonyos/entry/src/main/ets/components/MissionReadbackView.ets:74` 都把它渲染为“读取于”，
 * 因此“恒定的成功观察时间”属于 CONTRACT_MISMATCH（字段合同误判），不是产品缺陷。
 *
 * 迁移后的新合同（更强，不是删除断言）：
 * - 旧 `observedAt` 冻结为读取时刻，与 `readAt` 同值；两次 GET 必须前进。
 * - 成功观察时间只看 `observation.lastSuccessfulAt` / `workState.observedAt`；无观察时保持 null。
 * - 读取是只读的：Mission 记录与事件数零变化；`workPacket.observations` 与 `observation` 同源。
 * - 真实失败/控制停止的区分见 tests/final-e/observationAndSourceUse.test.ts。
 */
describe("FS-A04 读回时间与成功观察时间分开（合同迁移：旧 observedAt=读取时刻）", () => {
  it("FI-E-OBS-01 无观察记录：重复 GET 只推进 readAt/旧 observedAt，成功观察保持 null 且业务记录零变化", async () => {
    const { user, project } = await ownerFixture("E 观察时间用户");
    const { mission } = await waitingInputMission(user.id, project.id);
    const beforeMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    const beforeEvents = await db.agentMissionEvent.count({ where: { missionId: mission.id } });

    const first = await readMissionBack(user.id, mission.id);
    await new Promise(resolve => setTimeout(resolve, 25));
    const second = await readMissionBack(user.id, mission.id);

    // 旧字段合同：读取时刻，与 readAt 同值，两次 GET 前进（消费器证据见文件头注释）。
    expect(first.observedAt).toBe(first.readAt);
    expect(second.observedAt).toBe(second.readAt);
    expect(Date.parse(second.readAt)).toBeGreaterThan(Date.parse(first.readAt));

    // 新合同：成功/失败/无变化观察时间不随读取推进；无观察保持 null。
    for (const back of [first, second]) {
      expect(back.workPacket).toBeDefined();
      expect(back.observation).toMatchObject({
        state: "NOT_OBSERVED", lastSuccessfulAt: null, lastFailedAt: null, lastNoNewInformationAt: null,
      });
      expect(back.observation.readAt).toBe(back.readAt);
      expect(back.workState.observedAt).toBeNull();
      expect(back.workPacket!.observations).toEqual(back.observation);
      expect(back.workPacket!.snapshot.checkedAt).toBe(back.readAt);
      expect(back.workPacket!.done.note).not.toContain("无新变化");
    }

    // 读取是只读的：Mission 记录（含 updatedAt）与事件数不变。
    expect(second.missionUpdatedAt).toBe(first.missionUpdatedAt);
    const afterMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(afterMission).toEqual(beforeMission);
    expect(await db.agentMissionEvent.count({ where: { missionId: mission.id } })).toBe(beforeEvents);
  });
});
