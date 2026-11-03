/**
 * Track E 独立验收：跨账号隔离与来源撤回/修订（R02/R04/R09、E-SEC-01、D-SRC-01、FS-A05）。
 *
 * 关键判据：服务端拒绝而不是 UI 禁用；撤回后历史保留但当前依据失效；
 * 来源修订后读回不得拼接新旧正文。失败即缺口，不放宽断言。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () =>
  (await import("../helpers/continuityDatabase")).continuityDatabase("final-e-isolation"),
);
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { addTextMaterial, createIntakeDraft, readIntake, readIntakeMaterialText } from "@/lib/services/projectIntakeService";
import { commandMission, createMission } from "@/lib/mission/missionService";
import { readMissionBack } from "@/lib/mission/readback";
import { sourceHash, validateSources } from "@/lib/mission/repository";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

async function user(label: string) {
  return db.user.create({ data: { username: crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
}

async function projectWithOwner(ownerUserId: string, label: string) {
  return db.project.create({
    data: {
      title: label,
      description: "FINAL_E_SYNTHETIC_ONLY",
      goal: "独立验收合成项目",
      scenario: "RESEARCH",
      memberships: { create: { userId: ownerUserId } },
    },
  });
}

async function actorOf(userId: string) {
  return { userId, sessionId: (await createSession(userId)).session.id };
}

/** 合成 WAITING_INPUT：QUESTION 事件 id 就是原问题身份。 */
async function waitingInput(ownerUserId: string, projectId: string) {
  const mission = await createMission(ownerUserId, {
    projectId,
    requestId: `m-${crypto.randomUUID()}`,
    goal: "核对来源许可与当前依据",
  });
  const updated = await db.agentMission.update({
    where: { id: mission.id },
    data: { status: "WAITING_INPUT", nextEventSeq: { increment: 1 } },
  });
  const questionEvent = await db.agentMissionEvent.create({
    data: { missionId: mission.id, seq: updated.nextEventSeq, type: "QUESTION", payloadJson: json({ question: "请补充原始要求" }) },
  });
  await db.agentMission.update({
    where: { id: mission.id },
    data: {
      waitStateJson: json({ questionId: questionEvent.id, question: "请补充原始要求", waitingFor: "ANSWER", startedAt: new Date().toISOString() }),
    },
  });
  return { mission: await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } }), questionId: questionEvent.id };
}

describe("R04 账户 A 的草稿/材料不能被账号 B 读取或续写", () => {
  it("换账号后读预览、读原文、追加材料都被服务端拒绝；A 自己的仍可读", async () => {
    const owner = await user("材料所有者");
    const stranger = await user("另一账号");
    const actorA = await actorOf(owner.id);
    const actorB = await actorOf(stranger.id);

    const { draftId } = await createIntakeDraft(actorA, { requestId: `d-${crypto.randomUUID()}` });
    const material = await addTextMaterial(actorA, draftId, { requestId: `t-${crypto.randomUUID()}`, text: "A 的私有阶段记录：先验证最小演示路径" });

    await expect(readIntake(actorB, draftId)).rejects.toMatchObject({ code: "INTAKE_NOT_FOUND", status: 404 });
    await expect(readIntakeMaterialText(actorB, draftId, material.materialId)).rejects.toMatchObject({ code: "INTAKE_NOT_FOUND", status: 404 });
    await expect(addTextMaterial(actorB, draftId, { requestId: `x-${crypto.randomUUID()}`, text: "B 注入的材料" }))
      .rejects.toMatchObject({ code: "INTAKE_NOT_FOUND", status: 404 });
    expect(await db.projectIntakeMaterial.count({ where: { draftId } })).toBe(1);

    // 原所有者仍能核对原文。
    const ownText = await readIntakeMaterialText(actorA, draftId, material.materialId);
    expect(ownText.text).toContain("先验证最小演示路径");
    expect(JSON.stringify(await readIntake(actorA, draftId))).toContain(draftId);
  });
});

describe("R02 来源文件修订：读回不得拼接新旧正文", () => {
  it("修订后旧指针显示 CHANGED，不再给出旧摘录作当前依据", async () => {
    const owner = await user("修订来源用户");
    const project = await projectWithOwner(owner.id, "来源修订项目");
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: "旧要求：先做全部高级功能" } });
    const sourceId = `capture:${capture.id}`;
    const oldHash = await sourceHash(project.id, sourceId);
    expect(oldHash).toBeTruthy();
    const { mission, questionId } = await waitingInput(owner.id, project.id);
    const updated = await db.agentMission.update({ where: { id: mission.id }, data: { nextEventSeq: { increment: 1 } } });
    await db.agentMissionEvent.create({
      data: {
        missionId: mission.id,
        seq: updated.nextEventSeq,
        type: "SOURCE_ARRIVED",
        payloadJson: json({ questionId, sourcePointer: { id: sourceId, hash: oldHash } }),
      },
    });

    // 原件被修订：同一 capture 的正文变化，旧指针不再等于当前 hash。
    await db.capture.update({ where: { id: capture.id }, data: { rawText: "新要求：先验证最小演示路径，再考虑高级功能" } });
    const readback = await readMissionBack(owner.id, mission.id, { questionId });
    const item = readback.materialUses.items.find(entry => entry.sourcePointer.id === sourceId);
    expect(item).toBeTruthy();
    expect(item!.availability).toBe("CHANGED");
    expect(item!.excerpt).toBeNull();
    expect(item!.bodyCoverage).toBe("NOT_RECORDED");
  });
});

describe("R09 / FS-A05 来源撤回：执行路径拒绝，读投影不得继续当当前依据", () => {
  it("用户撤回某来源后：批准执行被服务端拒绝，但读回仍把它当作 CURRENT 可引用正文", async () => {
    const owner = await user("撤回来源用户");
    const project = await projectWithOwner(owner.id, "撤回来源项目");
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: "撤回来源的原始记录：私人内容不得继续使用" } });
    const sourceId = `capture:${capture.id}`;
    const hash = (await sourceHash(project.id, sourceId))!;

    const mission = await createMission(owner.id, {
      projectId: project.id,
      requestId: `m-${crypto.randomUUID()}`,
      goal: "依据原始记录提出下一步",
      missionConstraints: { executionBoundary: "PROPOSE_ACTION" },
    });
    const stepId = `step-${crypto.randomUUID()}`;
    await db.agentMissionStep.create({
      data: {
        id: stepId, missionId: mission.id, ordinal: 1, planRevision: mission.planRevision, toolName: "propose_action",
        canonicalInputJson: json({ title: "整理提纲" }), inputHash: "synthetic-source", readSetJson: json([]),
        effectKey: `effect-${crypto.randomUUID()}`, status: "WAITING_APPROVAL", protocolJson: json({}),
      },
    });
    const proposal = { tool: "propose_action", args: { title: "整理提纲" } };
    const readSet = [{ id: sourceId, kind: "PROJECT", entityType: "CAPTURE", revision: hash, hash, text: "撤回来源的原始记录", observedAt: new Date().toISOString() }];
    const approval = await db.agentMissionApproval.create({
      data: {
        missionId: mission.id, stepId, proposalHash: jsonHash(proposal), proposalJson: json(proposal),
        expectedPlanRevision: mission.planRevision, readSetJson: json(readSet), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await db.agentMission.update({ where: { id: mission.id }, data: { status: "WAITING_APPROVAL" } });

    // 用户在讨论里明确撤回该来源（服务端指令，不是 UI 状态）。
    const actor = await actorOf(owner.id);
    const conversation = await createConversation(actor, { requestId: `c-${crypto.randomUUID()}`, scope: "PROJECT", projectId: project.id });
    const directive = await submitDirective(actor, conversation.id, {
      commandId: `suppress-${crypto.randomUUID()}`,
      expectedSeq: 0,
      scope: { projectId: project.id, missionId: mission.id },
      operation: "SUPPRESS_USE",
      sourceIds: [sourceId],
      quote: "停止使用这条原始记录",
    });
    expect(JSON.stringify(directive.view.directives)).toContain(sourceId);

    // 1) 当前许可已变为 SUPPRESSED（服务端事实）。
    expect((await sourceUse(owner.id, project.id, sourceId, db, { missionId: mission.id })).state).toBe("SUPPRESSED");
    // 2) 原读集直接过服务端校验必须被拒绝（E-SEC-01：撤回来源不能继续作为本次依据）。
    await expect(validateSources(project.id, readSet as Source[], db, mission.id))
      .rejects.toMatchObject({ code: "SOURCE_USE_SUPPRESSED", status: 409 });
    // 3) 撤回指令使原提案/步骤失效、任务进入待复核：旧批准不能再执行。
    const invalidated = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(invalidated.status).toBe("PAUSED");
    expect(invalidated.pauseReason).toBe("REVIEW_REQUIRED");
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("OBSOLETE");
    await expect(
      commandMission(owner.id, mission.id, "approval", {
        requestId: `approve-${crypto.randomUUID()}`,
        expectedVersion: invalidated.version,
        decision: "APPROVED",
        proposalHash: approval.proposalHash,
      }, approval.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);

    // 4) 历史仍保留：原 Capture 没被删除。
    expect(await db.capture.findUnique({ where: { id: capture.id } })).toMatchObject({ rawText: "撤回来源的原始记录：私人内容不得继续使用" });

    // 5) 读投影：撤回后不得继续显示为 CURRENT，也不得把正文摘录当当前依据。
    const readback = await readMissionBack(owner.id, mission.id, { sourceId });
    const item = readback.materialUses.items.find(entry => entry.sourcePointer.id === sourceId);
    expect(item).toBeTruthy();
    // soft：让回执同时记录“可用性”和“正文摘录”两个实际值，便于定位缺陷范围。
    expect.soft(item!.availability).not.toBe("CURRENT");
    expect.soft(item!.excerpt).toBeNull();
  });
});
