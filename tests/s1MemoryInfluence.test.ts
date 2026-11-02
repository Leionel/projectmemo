import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s1memory"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective, effectiveContinuity, assertContinuityBinding } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { createMission } from "@/lib/mission/missionService";
import { buildContext } from "@/lib/mission/contextBuilder";
import { processCapture } from "@/lib/services/captureService";
import type { ConversationActor } from "@/lib/types/conversation";

/**
 * S1-B 探针：只在既有组合入口上核对“条件是否真的改变判断”。
 * 不新增 Memory/Goal/通知体系；断言打在原 continuity / sourceUse / contextBuilder 边界。
 */

let userId = "";
let actor: ConversationActor;
let projectId = "";

beforeAll(async () => {
  const user = await db.user.create({ data: { username: `s1-memory-${crypto.randomUUID()}`, displayName: "S1 记忆探针", passwordHash: "unused" } });
  userId = user.id;
  actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "科研材料核查", description: "隔离合成项目", goal: "核对数据条件后再下结论", scenario: "RESEARCH" } });
  projectId = project.id;
  await db.projectMembership.create({ data: { userId: user.id, projectId } });
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

describe("S1-B 历史条件与来源资格", () => {
  test("本地工作指令到期跨越（无新事件）后，派发上下文与发布绑定同时失效", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T04:00:00Z")); // 周一 12:00 SGT
    const conversation = await createConversation(actor, { requestId: `c-${crypto.randomUUID()}`, scope: "PROJECT", projectId });
    const admitted = await submitDirective(actor, conversation.id, { commandId: "dir-1", expectedSeq: 0, operation: "SET",
      scope: { projectId }, quote: "本周先稳演示", admission: "LITERAL", timezone: "Asia/Shanghai" });
    const admission = admitted.admission as { status?: string } | null;
    expect(admission?.status ?? "").toBe("DIRECT_APPLIED");
    const binding = { intentHash: admitted.view.intentHash, reusePolicyHash: admitted.view.reusePolicyHash };
    expect(admitted.view.workingObjective).toBe("本周先稳演示");
    const mission = await createMission(userId, { projectId, requestId: `m-${crypto.randomUUID()}`, goal: "核对演示条件", llmContextApproved: true });
    const before = JSON.parse(await buildContext(mission));
    expect(before.continuity.workingObjective).toBe("本周先稳演示");
    expect(admitted.view.nextBoundary).toBeTruthy();

    // 跨过 validUntil：没有任何新事件、没有新指令。
    vi.setSystemTime(new Date("2026-11-10T04:00:00Z"));
    const after = await effectiveContinuity(userId, { projectId });
    expect(after.workingObjective).toBeNull();
    expect(after.intentHash).not.toBe(admitted.view.intentHash);
    // 发布边界：旧绑定不能再当作现行方向。
    await expect(assertContinuityBinding(userId, { projectId, missionId: mission.id }, { ...binding, nextBoundary: admitted.view.nextBoundary }))
      .rejects.toMatchObject({ code: "CONTINUITY_CHANGED" });
    // 派发边界：重建的上下文不再带着过期条件，也没有偷偷保留旧限制。
    const rebuilt = JSON.parse(await buildContext(mission));
    expect(rebuilt.continuity.workingObjective).toBeNull();
  });

  test("派生来源不算独立支持；根来源被抑制后派生引用一起失效", async () => {
    const capture = await processCapture(projectId, "10 月本地实验 Dice 82%，条件和重复次数还要核对。", "用户记录");
    const original = await db.capture.findFirstOrThrow({ where: { projectId, card: { id: capture.id } } });
    const originalUse = await sourceUse(userId, projectId, `capture:${original.id}`);
    expect(originalUse.state).toBe("ALLOWED");
    expect(originalUse.independentEvidence).toBe(true);

    const artifact = await db.generatedArtifact.create({ data: { projectId, artifactType: "weekly_report",
      content: "周报引用了 10 月本地实验数据。",
      sourceRefs: { sources: [{ id: `capture:${original.id}`, projectId }] } } });
    const derivedUse = await sourceUse(userId, projectId, `artifact:${artifact.id}`);
    expect(["ALLOWED", "UNKNOWN"]).toContain(derivedUse.state);
    expect(derivedUse.independentEvidence).toBe(false);
    expect(derivedUse.reason).toBe("DERIVED_REFERENCE");

    // 用户抑制原始记录后，派生成果也不能继续消费。
    await submitDirective(actor, (await createConversation(actor, { requestId: `s-${crypto.randomUUID()}`, scope: "PROJECT", projectId })).id,
      { commandId: "suppress-1", expectedSeq: (await effectiveContinuity(userId, { projectId })).seq, operation: "SUPPRESS_USE",
        scope: { projectId }, quote: "不要再用这条记录", sourceIds: [`capture:${original.id}`],
        admission: "LITERAL", timezone: "Asia/Shanghai" });
    const suppressedOriginal = await sourceUse(userId, projectId, `capture:${original.id}`);
    expect(suppressedOriginal.state).toBe("SUPPRESSED");
    const suppressedDerived = await sourceUse(userId, projectId, `artifact:${artifact.id}`);
    expect(suppressedDerived.state).toBe("SUPPRESSED");
    expect(suppressedDerived.independentEvidence).toBe(false);
  });

  test("来源链未知的引用保留 UNKNOWN，不伪装成独立证据", async () => {
    const unknown = await sourceUse(userId, projectId, "external:never-observed");
    expect(unknown.state).toBe("UNKNOWN");
    expect(unknown.reason).toBe("LINEAGE_UNKNOWN");
    expect(unknown.independentEvidence).toBe(false);
  });

  test("项目局部指令不跨项目生效，账户级范围不被局部范围替代", async () => {
    const otherProject = await db.project.create({ data: { title: "另一个项目", description: "隔离合成项目", goal: "课程交付", scenario: "COURSE_DESIGN" } });
    await db.projectMembership.create({ data: { userId, projectId: otherProject.id } });
    const conversation = await createConversation(actor, { requestId: `c2-${crypto.randomUUID()}`, scope: "PROJECT", projectId });
    const seq = (await effectiveContinuity(userId, { projectId })).seq;
    await submitDirective(actor, conversation.id, { commandId: "local-1", expectedSeq: seq, operation: "SET",
      scope: { projectId }, quote: "本周只读不写", admission: "LITERAL", timezone: "Asia/Shanghai" });
    const localView = await effectiveContinuity(userId, { projectId });
    const otherView = await effectiveContinuity(userId, { projectId: otherProject.id });
    expect(localView.constraints.join()).toContain("只读");
    expect(otherView.constraints).toHaveLength(0);
    expect(otherView.intentHash).not.toBe(localView.intentHash);
  });
});




