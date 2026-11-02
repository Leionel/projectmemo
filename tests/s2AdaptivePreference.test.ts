import { afterAll, describe, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s2-adaptive"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective, effectiveContinuity } from "@/lib/continuity/directiveService";
import { admitDirective } from "@/lib/continuity/admission";
import { createMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { buildContext } from "@/lib/mission/contextBuilder";
import { applyInterventionPolicy, getOrCreatePolicy, interventionPolicyScopeForUser, updatePolicy } from "@/lib/services/interventionPolicyService";
import type { ConversationActor } from "@/lib/types/conversation";
import type { Choice } from "@/lib/mission/contracts";

/**
 * S2 第三批：Adaptive 偏好的边界。
 *
 * 只验证“少打扰”类表达不会变成更高权限或更少澄清：
 * 自由文本仍按原 Directive Admission 处理；静默时段只影响提醒派发，
 * 不改变 Mission 的必答问题、批准、预算、工具约束或失败说明。
 */

process.env.INTERVENTION_BUDGET_ENABLED = "true";

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

const scriptProvider = (choice: Choice) => async () => ({
  choice, provider: "S2_ADAPTIVE_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 },
});

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: `${label}-${crypto.randomUUID()}`, displayName: label, passwordHash: "unused" } });
  const session = await createSession(user.id);
  const project = await db.project.create({ data: { title: "自适应偏好项目", description: "合成隔离项目", goal: "核对偏好边界",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const actor: ConversationActor = { userId: user.id, sessionId: session.session.id };
  return { user, actor, project };
}

describe("S2 第三批 · 偏好不扩大权限也不吞掉必要澄清", () => {
  test("“少问我/安静一点”这类表达不会被当成已生效指令", () => {
    for (const quote of ["少问我一点", "安静一点", "以后少打扰我"]) {
      const admission = admitDirective({ commandId: `c-${quote}`, expectedSeq: 0, operation: "SET", scope: { projectId: "p" },
        quote, admission: "LITERAL", timezone: "Asia/Shanghai" });
      expect(admission.status).not.toBe("DIRECT_APPLIED");
      expect(admission.status).not.toBe("CONFIRMED_APPLIED");
    }
  });

  test("走原指令入口也不会生成约束、改预算或放宽工具；Mission 约束保持原样", async () => {
    const { user, actor, project } = await fixture("quiet");
    const conversation = await createConversation(actor, { requestId: `c-${crypto.randomUUID()}`, scope: "PROJECT", projectId: project.id });
    const before = await effectiveContinuity(user.id, { projectId: project.id });
    const result = await submitDirective(actor, conversation.id, { commandId: "quiet-1", expectedSeq: before.seq,
      operation: "SET", scope: { projectId: project.id }, quote: "安静一点", admission: "LITERAL", timezone: "Asia/Shanghai" });
    const admission = result.admission as { status?: string } | null;
    expect(["INTERPRETATION_CANDIDATE", "NEEDS_CLARIFICATION"]).toContain(admission?.status ?? "");
    // 没有生效就不会产生指令事件，也不会留下约束。
    const after = await effectiveContinuity(user.id, { projectId: project.id });
    expect(after.constraints).toHaveLength(0);
    expect(after.workingObjective).toBeNull();
    expect(await db.agentDirectiveEvent.count({ where: { ownerUserId: user.id, projectId: project.id } })).toBe(0);

    const mission = await createMission(user.id, { requestId: `m-${crypto.randomUUID()}`, projectId: project.id,
      goal: "核对偏好不改变委托边界", llmContextApproved: false });
    const snapshot = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await submitDirective(actor, conversation.id, { commandId: "quiet-2", expectedSeq: after.seq, operation: "SET",
      scope: { projectId: project.id }, quote: "少问我一点", admission: "LITERAL", timezone: "Asia/Shanghai" });
    const unchanged = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(unchanged.constraintsJson).toEqual(snapshot.constraintsJson);
    expect(unchanged.budgetJson).toEqual(snapshot.budgetJson);
    expect(unchanged.planJson).toEqual(snapshot.planJson);
  });

  test("静默时段只抑制提醒派发；Mission 的必答问题与等待状态不变", async () => {
    const { user, project } = await fixture("silent");
    const mission = await createMission(user.id, { requestId: `m-${crypto.randomUUID()}`, projectId: project.id,
      goal: "等待用户补充条件", llmContextApproved: true });
    await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "ask", question: "请补充实验条件", missing: "PRIVATE" }) });
    const asked = await missionDetail(user.id, mission.id);
    expect(asked.status).toBe("WAITING_INPUT");
    expect((asked.question?.payloadJson as { question?: string } | null)?.question).toBe("请补充实验条件");
    const contextBefore = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));

    // 把静默时段设为全天（用用户作用域的原有策略）。
    const scope = interventionPolicyScopeForUser(user.id);
    await getOrCreatePolicy(scope);
    // 20:00–20:30（上海）设为静默；评估时刻落在窗口内。
    await updatePolicy({ quietStartMinute: 20 * 60, quietEndMinute: 20 * 60 + 30, timezone: "Asia/Shanghai" }, scope);
    const decisions = await applyInterventionPolicy(project.id, [{ candidateKey: "RISK_UNHANDLED:quiet",
      triggerType: "RISK_UNHANDLED", dedupeKey: "quiet", severity: 4, title: "提醒", content: "内容",
      evidenceFacts: ["合成事实：今天需要核对实验条件"], evidenceCardIds: [], evidenceRule: "test", proposedActions: [], isSimulated: false }],
      new Date("2026-11-02T12:10:00Z"), scope);
    expect(decisions[0]).toMatchObject({ decision: "SUPPRESS", reasonCode: "QUIET_HOURS" });

    // 必答问题仍在等待，且上下文约束未被静默策略改写。
    const after = await missionDetail(user.id, mission.id);
    expect(after.status).toBe("WAITING_INPUT");
    expect((after.question?.payloadJson as { question?: string } | null)?.question).toBe("请补充实验条件");
    const contextAfter = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));
    expect(contextAfter.constraints).toEqual(contextBefore.constraints);
    expect(contextAfter.budgetLimits).toEqual(contextBefore.budgetLimits);
  });
});





