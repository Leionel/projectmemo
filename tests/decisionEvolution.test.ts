import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-p2-"));
  const file = path.join(dir, "confirmations.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, {
    MISSION_ENABLED: "true",
    MISSION_UI_ENABLED: "true",
    COPILOT_CONTINUATION_ENABLED: "true",
    PROJECT_AGENT_CONTEXT_ENABLED: "true",
  });
  process.env.INTERVENTION_BUDGET_ENABLED = "true";
  process.env.LLM_MODE = "mock";
  process.env.SEMANTIC_MEMORY_ENABLED = "false";
  process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = "true";
  process.env.TEMPORAL_MEMORY_ENABLED = "true";
  const sql = new Database(file);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const migrationFile = path.join(
      "prisma/migrations",
      migration,
      "migration.sql",
    );
    if (fs.existsSync(migrationFile))
      sql.exec(fs.readFileSync(migrationFile, "utf8"));
  }
  sql.close();
  return { dir, file };
});

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission } from "@/lib/mission/missionService";
import { readDecisionSnapshot } from "@/lib/decision/snapshot";
import { assessImpact } from "@/lib/decision/impact";
import {
  createScenarios,
  adoptScenario,
  readScenario,
  rejectScenario,
} from "@/lib/decision/scenarios";
import { consumeImpactJobs, enqueueImpact } from "@/lib/decision/impactJobs";
import { confirmTemporalRelation } from "@/lib/repositories/temporalRelations";
import {
  currentGoalQuestion,
  interactGoalQuestion,
} from "@/lib/decision/questions";
import { getOrCreatePolicy } from "@/lib/services/interventionPolicyService";
import { event } from "@/lib/mission/repository";
import { runMissionSlice } from "@/lib/mission/runner";
import { claimMission, fenced } from "@/lib/mission/runtimeStore";
import { analyzeChangeImpact } from "@/lib/services/changeImpactService";
import { buildContext } from "@/lib/mission/contextBuilder";
import { listInterventions } from "@/lib/repositories/agent";
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});
async function fixture() {
  const u = await db.user.create({
      data: {
        username: crypto.randomUUID(),
        displayName: "隔离验收",
        passwordHash: "unused",
      },
    }),
    p = await db.project.create({
      data: {
        title: "来源变化验收",
        description: "本地mock",
        goal: "准备有依据的汇报",
        scenario: "RESEARCH",
        memberships: { create: { userId: u.id, role: "OWNER" } },
      },
    });
  const auth = await createSession(u.id);
  const actor = { userId: u.id, sessionId: auth.session.id };
  const m = await createMission(u.id, {
    projectId: p.id,
    goal: "整理阶段汇报，缺少的指标明确列为缺口",
    requestId: crypto.randomUUID(),
    missionConstraints: { executionBoundary: "READ_ANALYZE" },
  });
  await getOrCreatePolicy(`USER:${u.id}`);
  await db.interventionPolicy.update({
    where: { scope: `USER:${u.id}` },
    data: { quietStartMinute: 0, quietEndMinute: 0, dailyBudget: 3 },
  });
  return { u, p, m, actor, token: auth.token };
}
async function card(projectId: string, title: string) {
  const c = await db.capture.create({
    data: { projectId, rawText: title, sourceType: "隔离实验记录" },
  });
  return db.knowledgeCard.create({
    data: {
      projectId,
      captureId: c.id,
      type: "experiment_log",
      title,
      summary: title,
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance: 3,
    },
  });
}
async function link(
  from: string,
  to: string,
  type: "SUPPORTS" | "SUPERSEDES" = "SUPPORTS",
  confirmed = true,
) {
  return db.cardRelation.create({
    data: {
      currentCardId: from,
      relatedCardId: to,
      relationType: type,
      reason: "隔离测试关系",
      score: 100,
      confirmed,
      confirmedAt: confirmed ? new Date() : null,
      validFrom: new Date(),
    },
  });
}
async function chain() {
  const f = await fixture(),
    a = await card(f.p.id, "旧实验设置"),
    c = await card(f.p.id, "汇报采用的指标"),
    replacement = await card(f.p.id, "新实验设置");
  await link(a.id, c.id);
  const x = await db.actionItem.create({
      data: { projectId: f.p.id, title: "验证指标", status: "TODO" },
    }),
    y = await db.actionItem.create({
      data: { projectId: f.p.id, title: "整理验证结果", status: "TODO" },
    });
  await db.actionRequirement.createMany({
    data: [
      {
        projectId: f.p.id,
        actionId: x.id,
        targetKind: "card",
        targetId: c.id,
        hard: true,
      },
      {
        projectId: f.p.id,
        actionId: y.id,
        targetKind: "action",
        targetId: x.id,
        hard: true,
      },
    ],
  });
  const o = await db.agentMissionOutput.create({
    data: {
      missionId: f.m.id,
      revision: 1,
      kind: "NOTE",
      contentJson: {
        blocks: [
          {
            blockId: "result",
            text: "待核对",
            kind: "INFERENCE",
            sourceIds: [`action:${y.id}`],
          },
        ],
      },
      sourceRefsJson: [],
      claimChecksJson: [],
    },
  });
  return { ...f, a, c, replacement, x, y, o };
}
async function scenarios(
  f: Awaited<ReturnType<typeof fixture>>,
  patch: object = {},
) {
  return createScenarios(f.actor, f.m.id, {
    requestId: crypto.randomUUID(),
    availableMinutes: 60,
    deliveryMinutes: 30,
    ...patch,
  });
}
function confirm(
  f: Awaited<ReturnType<typeof fixture>>,
  p: Awaited<ReturnType<typeof scenarios>>,
  key = "VERIFY_FIRST",
  requestId = crypto.randomUUID(),
) {
  return adoptScenario(f.actor, p.id, {
    requestId,
    proposalHash: p.proposalHash,
    scenarioKey: key,
    expectedVersion: p.base.expectedVersion,
    confirmed: true,
  });
}
describe.sequential("P2-A typed impact and durable compensation", () => {
  it("one root traverses typed two-layer requirements, one exact block and original Mission", async () => {
    const f = await chain();
    await link(f.replacement.id, f.a.id, "SUPERSEDES");
    const s = await db.$transaction((tx) =>
        readDecisionSnapshot(tx, f.p.id, f.u.id),
      ),
      assessment = assessImpact(s, [`card:${f.a.id}`]);
    expect(
      assessment.items.find((i) => i.target === `action:${f.y.id}`),
    ).toMatchObject({ kind: "HARD_PREREQUISITE_UNMET", state: "UNMET" });
    const item = assessment.items.find(
      (i) => i.target === `mission:${f.m.id}`,
    )!;
    expect(item.path.map((e) => e.kind)).toEqual([
      "DECLARED_SUPPORT",
      "REQUIREMENT",
      "REQUIREMENT",
      "BLOCK_CITATION",
      "MISSION_OUTPUT",
    ]);
    expect(assessment.coverage.state).toBe("COMPLETE");
    expect(
      assessment.items.find((i) => i.target === `card:${f.c.id}`)?.kind,
    ).toBe("SUPPORT_CHANGED");
    expect(
      assessment.items.find((i) => i.target === `card:${f.c.id}`)?.state,
    ).toBe("MET");
  });
  it("confirmed alternative evidence is OR while hard requirements are AND; superseded is unknown, not false", async () => {
    const f = await chain();
    await link(f.replacement.id, f.a.id, "SUPERSEDES");
    await link(f.replacement.id, f.c.id);
    const milestone = await db.milestone.create({
      data: { projectId: f.p.id, title: "汇报" },
    });
    const d = await db.deliverable.create({
      data: {
        milestoneId: milestone.id,
        title: "实验说明",
        expectedEvidence: JSON.stringify(["experiment_log"]),
        evidences: {
          create: [
            { cardId: f.a.id, evidenceType: "experiment_log", confirmed: true },
            { cardId: f.c.id, evidenceType: "experiment_log", confirmed: true },
          ],
        },
      },
    });
    await db.actionRequirement.create({
      data: {
        projectId: f.p.id,
        actionId: f.x.id,
        targetKind: "deliverable",
        targetId: d.id,
        hard: true,
      },
    });
    const s = await db.$transaction((tx) =>
        readDecisionSnapshot(tx, f.p.id, f.u.id),
      ),
      r = assessImpact(s, [`card:${f.a.id}`]);
    expect(r.items.find((i) => i.target === `deliverable:${d.id}`)?.state).toBe(
      "MET",
    );
    expect(r.actionStates.find((a) => a.id === f.x.id)?.state).toBe("MET");
    await db.actionRequirement.create({
      data: {
        projectId: f.p.id,
        actionId: f.x.id,
        targetKind: "card",
        targetId: f.a.id,
        hard: true,
      },
    });
    expect(
      assessImpact(
        await db.$transaction((tx) => readDecisionSnapshot(tx, f.p.id, f.u.id)),
        [],
      ).actionStates.find((a) => a.id === f.x.id)?.state,
    ).toBe("UNKNOWN");
  });
  it("support cycles and truncated neighborhoods are incomplete; reads do not mutate plans", async () => {
    const f = await chain();
    await link(f.c.id, f.a.id);
    const before = await db.agentMission.findUniqueOrThrow({
        where: { id: f.m.id },
      }),
      s = await db.$transaction((tx) =>
        readDecisionSnapshot(tx, f.p.id, f.u.id),
      );
    expect(assessImpact(s, [`card:${f.a.id}`]).coverage.reasons).toContain(
      "DEPENDENCY_CYCLE",
    );
    expect(
      assessImpact(
        {
          ...s,
          coverage: {
            ...s.coverage,
            state: "INCOMPLETE",
            reasons: ["NEIGHBORHOOD_LIMIT"],
          },
        },
        [],
      ).coverage.state,
    ).toBe("INCOMPLETE");
    expect(
      (await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))
        .planRevision,
    ).toBe(before.planRevision);
  });
  it("relation confirmation writes one intent in the mutation transaction; duplicate workers bump once and preserve old successes", async () => {
    const f = await chain();
    const done = await db.agentMissionStep.create({
      data: {
        missionId: f.m.id,
        ordinal: 1,
        planRevision: 1,
        toolName: "inspect_project",
        status: "SUCCEEDED",
        canonicalInputJson: {},
        inputHash: "h",
        readSetJson: [],
      },
    });
    const r = await link(f.replacement.id, f.a.id, "SUPERSEDES", false);
    await confirmTemporalRelation(f.p.id, r.id);
    await confirmTemporalRelation(f.p.id, r.id);
    expect(
      await db.projectImpactJob.count({ where: { projectId: f.p.id } }),
    ).toBe(1);
    await Promise.all([consumeImpactJobs(), consumeImpactJobs()]);
    const m = await db.agentMission.findUniqueOrThrow({
      where: { id: f.m.id },
    });
    expect(m.planRevision).toBe(2);
    expect(m.status).toBe("PAUSED");
    expect(
      await db.projectImpactEffect.count({ where: { missionId: m.id } }),
    ).toBe(1);
    expect(
      (await db.agentMissionStep.findUniqueOrThrow({ where: { id: done.id } }))
        .status,
    ).toBe("SUCCEEDED");
    expect(
      await db.agentMissionOutput.count({ where: { missionId: m.id } }),
    ).toBe(1);
    await consumeImpactJobs();
    expect(
      (await db.agentMission.findUniqueOrThrow({ where: { id: m.id } }))
        .planRevision,
    ).toBe(2);
  });
  it("unrelated recent artifacts are not marked invalid", async () => {
    const f = await chain();
    for (let i = 0; i < 3; i++)
      await db.generatedArtifact.create({
        data: {
          projectId: f.p.id,
          artifactType: "weekly_report",
          content: "没有引用旧设置",
          claims: { claims: [] },
        },
      });
    const p = await analyzeChangeImpact(
      f.p.id,
      `将${f.a.title}替换为新的实验方案`,
    );
    expect(p.impactedArtifacts).toHaveLength(0);
  });
});
describe.sequential("P2-B original Mission scenario adoption", () => {
  it("keeps the original plan plus two substantive alternatives, without creating actions or scheduling during preview", async () => {
    const f = await fixture(),
      p = await scenarios(f);
    expect(p.scenarios.map((s) => s.key)).toEqual([
      "BASELINE",
      "VERIFY_FIRST",
      "DELIVER_FIRST",
    ]);
    expect(p.scenarios[1].minutes).toBe(15);
    expect(p.scenarios[2].minutes).toBe(30);
    expect(p.scenarios[1].resourceLimit).not.toBe(p.scenarios[2].resourceLimit);
    expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(0);
    expect(await db.agentMission.count({ where: { projectId: f.p.id } })).toBe(
      1,
    );
    const again = await createScenarios(f.actor, f.m.id, {
      requestId: (
        await db.decisionScenarioProposal.findUniqueOrThrow({
          where: { id: p.id },
        })
      ).createRequestId,
      availableMinutes: 60,
      deliveryMinutes: 30,
    });
    expect(again.id).toBe(p.id);
  });
  it("adopts once in the same Mission, exact lost-response replay, competing selection rejected, success criteria unchanged", async () => {
    const f = await fixture(),
      p = await scenarios(f),
      requestId = crypto.randomUUID();
    const [a, b] = await Promise.all([
      confirm(f, p, "VERIFY_FIRST", requestId),
      confirm(f, p, "VERIFY_FIRST", requestId),
    ]);
    expect(a).toEqual(b);
    expect((a as { missionId: string }).missionId).toBe(f.m.id);
    await expect(confirm(f, p, "DELIVER_FIRST")).rejects.toMatchObject({
      code: "PROPOSAL_CHANGED",
    });
    const m = await db.agentMission.findUniqueOrThrow({
      where: { id: f.m.id },
    });
    expect(m.planRevision).toBe(2);
    expect(m.successCriteriaJson).toEqual(f.m.successCriteriaJson);
    expect(
      (m.constraintsJson as { llmContextApproved: boolean }).llmContextApproved,
    ).toBe(false);
    expect(
      await db.agentMissionEvent.count({
        where: { missionId: m.id, type: "DECISION_SCENARIO_ADOPTED" },
      }),
    ).toBe(1);
    expect(JSON.parse(await buildContext(m)).decisionScenario.key).toBe(
      "VERIFY_FIRST",
    );
  });
  it("new source invalidates old preview, even with unconsumed jobs; a new preview changes its available choices", async () => {
    const f = await fixture(),
      p = await scenarios(f, { availableMinutes: 20, deliveryMinutes: 30 });
    expect(p.scenarios[2].feasibility).toBe("UNMET");
    await card(f.p.id, "补充了新实验记录");
    await expect(confirm(f, p)).rejects.toMatchObject({
      code: "STALE_SCENARIO_BASE",
    });
    expect((await readScenario(f.actor, p.id)).stale).toBe(true);
    const revised = await scenarios(f, {
      parentId: p.id,
      availableMinutes: 60,
      deliveryMinutes: 20,
    });
    expect(revised.revision).toBe(2);
    expect(revised.scenarios[2].feasibility).toBe("READY");
    await confirm(f, revised, "DELIVER_FIRST");
  });
  it("blocks expired, revoked, wrong-user, unknown estimate and over-budget adoption; rejects without changing the Mission", async () => {
    const f = await fixture(),
      p = await scenarios(f, { availableMinutes: 5 });
    await expect(confirm(f, p)).rejects.toMatchObject({
      code: "UNKNOWN_HARD_CONSTRAINT",
    });
    await rejectScenario(f.actor, p.id);
    expect(
      (await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))
        .planRevision,
    ).toBe(1);
    const q = await scenarios(f);
    await db.decisionScenarioProposal.update({
      where: { id: q.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(confirm(f, q)).rejects.toMatchObject({
      code: "SCENARIO_EXPIRED",
    });
    const other = await fixture();
    await expect(readScenario(other.actor, q.id)).rejects.toMatchObject({
      status: 404,
    });
    await db.authSession.update({
      where: { id: f.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(readScenario(f.actor, q.id)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      scenarios(other, { deliveryMinutes: undefined }),
    ).rejects.toThrow();
  });
  it("new critical executions check semantic dependencies before submission independently of the Worker job", async () => {
    const f = await fixture(),
      p = await scenarios(f);
    await confirm(f, p);
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { status: "READY" },
    });
    const m = await claimMission("old-worker", f.m.id);
    expect(m).toBeTruthy();
    await card(f.p.id, "发生于执行期间的新来源");
    const lease = {
      id: m!.id,
      owner: m!.leaseOwner!,
      epoch: m!.leaseEpoch,
      contextVersion: m!.contextVersion,
      planRevision: m!.planRevision,
    };
    await expect(
      db.$transaction((tx) => fenced(tx, lease)),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    await db.agentMission.update({
      where: { id: f.m.id },
      data: {
        status: "PAUSED",
        executionSlot: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  });
  it("never lowers original action-success criteria to make a read-only choice pass", async () => {
    const f = await fixture();
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { successCriteriaJson: ["ACTION_CREATED"] },
    });
    const p = await scenarios(f);
    expect(p.scenarios.slice(1).every((s) => s.feasibility === "UNMET")).toBe(
      true,
    );
  });
});
describe.sequential("P2-C one actionable goal question", () => {
  async function waiting() {
    const f = await fixture();
    const q = await db.$transaction((tx) =>
      event(tx, f.m.id, "QUESTION", {
        question: "请补充本项目的 Dice 实验结果",
        requirements: { terms: ["Dice"] },
      }),
    );
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { status: "WAITING_INPUT" },
    });
    return { ...f, q };
  }
  it("no records never means real work is unfinished; only an explicit pending gap is selected", async () => {
    const f = await fixture();
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
    const w = await waiting(),
      r = await currentGoalQuestion(w.actor, w.p.id);
    expect(r.question?.questionId).toBe(w.q.id);
    expect(r.question?.unansweredConsequence).toContain("不自动猜测");
    expect(r.question?.deviceDelivered).toBe(false);
  });
  it("keeps generation, policy, exposure and delivery separate; no-change refresh uses one USER budget", async () => {
    const f = await waiting(),
      q = (await currentGoalQuestion(f.actor, f.p.id)).question!;
    const body = {
      questionId: q.questionId,
      contextHash: q.contextHash,
      requestId: "present",
      action: "PRESENT",
    };
    const a = await interactGoalQuestion(f.actor, f.p.id, body);
    expect(a).toMatchObject({ allowed: true });
    await interactGoalQuestion(f.actor, f.p.id, {
      ...body,
      requestId: "present-again",
    });
    expect(
      await db.interventionDecision.count({
        where: { projectId: f.p.id, decision: "FIRE" },
      }),
    ).toBe(1);
    await interactGoalQuestion(f.actor, f.p.id, {
      ...body,
      action: "EXPOSED",
      requestId: "expose",
    });
    expect(
      await db.interventionFeedback.count({
        where: { projectId: f.p.id, feedbackType: "EXPOSED" },
      }),
    ).toBe(1);
    expect(
      await db.interventionDelivery.count({ where: { projectId: f.p.id } }),
    ).toBe(0);
    expect(await listInterventions(f.p.id)).toHaveLength(0);
    expect(
      JSON.stringify(
        await db.agentIntervention.findMany({ where: { projectId: f.p.id } }),
      ),
    ).not.toContain("请补充本项目的 Dice 实验结果");
  });
  it("unknown is preserved; irrelevant records do not re-ask, a relevant new record reopens the same question", async () => {
    const f = await waiting(),
      q = (await currentGoalQuestion(f.actor, f.p.id)).question!;
    await interactGoalQuestion(f.actor, f.p.id, {
      questionId: q.questionId,
      contextHash: q.contextHash,
      requestId: "unknown",
      action: "UNKNOWN",
    });
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
    await card(f.p.id, "无关的课程安排");
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
    await card(f.p.id, "Dice 用户提供的实验记录");
    expect(
      (await currentGoalQuestion(f.actor, f.p.id)).question?.questionId,
    ).toBe(q.questionId);
    expect(
      (await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))
        .status,
    ).toBe("WAITING_INPUT");
  });
  it("quiet hours, budget, snooze, stop and cancellation suppress new presentation without extra model calls", async () => {
    const f = await waiting(),
      q = (await currentGoalQuestion(f.actor, f.p.id)).question!;
    await db.interventionPolicy.update({
      where: { scope: `USER:${f.u.id}` },
      data: { dailyBudget: 0 },
    });
    expect(
      await interactGoalQuestion(f.actor, f.p.id, {
        action: "PRESENT",
        questionId: q.questionId,
        contextHash: q.contextHash,
        requestId: "budget",
      }),
    ).toMatchObject({ allowed: false, reason: "BUDGET_EXHAUSTED" });
    await interactGoalQuestion(f.actor, f.p.id, {
      action: "LATER",
      questionId: q.questionId,
      contextHash: q.contextHash,
      requestId: "later",
    });
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
    expect(
      (
        await currentGoalQuestion(
          f.actor,
          f.p.id,
          new Date(Date.now() + 2 * 86400000),
        )
      ).question?.questionId,
    ).toBe(q.questionId);
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { status: "CANCELLED" },
    });
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
  });
});

it("相同目标与时间输入下，相关新证据改变后续方案；无关材料不会伪造取舍变化", async () => {
  const f = await chain(),
    before = await scenarios(f);
  expect(before.scenarios[2].feasibility).toBe("READY");
  await card(f.p.id, "与指标无关的课程笔记");
  const unrelated = await scenarios(f);
  expect(unrelated.scenarios[2].feasibility).toBe("READY");
  await link(f.replacement.id, f.a.id, "SUPERSEDES");
  const after = await scenarios(f);
  expect(after.scenarios[2].feasibility).toBe("UNKNOWN");
  expect(after.scenarios[1].feasibility).toBe("READY");
  expect(after.base.roots).toContain(`card:${f.a.id}`);
  expect(after.scenarios[2].reasons.join()).toContain("引用路径");
});

describe.sequential("P2 recovery and isolation regressions", () => {
  it("no-root cycles cannot certify a scenario; reads and job bookkeeping do not change source manifests", async () => {
    const f = await chain(),
      s = await db.$transaction((tx) =>
        readDecisionSnapshot(tx, f.p.id, f.u.id),
      );
    await db.$transaction((tx) => enqueueImpact(tx, f.p.id, "bookkeeping", []));
    await consumeImpactJobs();
    expect(
      (await db.$transaction((tx) => readDecisionSnapshot(tx, f.p.id, f.u.id)))
        .hash,
    ).toBe(s.hash);
    await link(f.c.id, f.a.id);
    await expect(scenarios(f)).rejects.toMatchObject({
      code: "INCOMPLETE_DECISION_BASE",
    });
  });
  it("finite revisions, immutable request payloads, and two competing choices have one durable winner", async () => {
    const f = await fixture(),
      one = await scenarios(f),
      two = await scenarios(f, { parentId: one.id }),
      three = await scenarios(f, { parentId: two.id });
    await expect(scenarios(f, { parentId: three.id })).rejects.toMatchObject({
      code: "REVISION_LIMIT",
    });
    const settled = await Promise.allSettled([
      confirm(f, three, "VERIFY_FIRST"),
      confirm(f, three, "DELIVER_FIRST"),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const read = await readScenario(f.actor, three.id);
    expect(read.receipt).toBeTruthy();
    expect(read.status).toBe("CONFIRMED");
    const stored = await db.decisionScenarioProposal.findUniqueOrThrow({
      where: { id: three.id },
    });
    await expect(
      adoptScenario(f.actor, three.id, {
        requestId: stored.confirmRequestId,
        proposalHash: three.proposalHash,
        scenarioKey: stored.selectedKey,
        expectedVersion: 999,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  });
  it("adopted plan uses fresh observations while prior successful steps remain labelled history", async () => {
    const f = await fixture(),
      c = await card(f.p.id, "旧资料");
    await db.agentMissionStep.create({
      data: {
        missionId: f.m.id,
        ordinal: 1,
        planRevision: 1,
        toolName: "inspect_project",
        status: "SUCCEEDED",
        canonicalInputJson: {},
        inputHash: "old",
        readSetJson: [],
        resultJson: {
          data: { old: true },
          sources: [
            {
              id: `card:${c.id}`,
              kind: "PROJECT",
              hash: "old",
              entityType: "CARD",
              revision: "1",
              text: "历史",
              observedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });
    const p = await scenarios(f);
    await confirm(f, p);
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { status: "READY" },
    });
    await runMissionSlice({
      id: f.m.id,
      provider: async () => ({
        choice: {
          kind: "tool",
          tool: "inspect_project",
          args: {},
          summary: "重新读取",
        },
        provider: "TEST_FIXTURE",
        model: "scripted",
        protocol: "JSON_CHOICE",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    const steps = await db.agentMissionStep.findMany({
      where: { missionId: f.m.id },
      orderBy: { ordinal: "asc" },
    });
    expect(steps[0].status).toBe("SUCCEEDED");
    expect(steps[1].status).toBe("SUCCEEDED");
    expect(steps[1].planRevision).toBe(2);
    expect(steps[1].readSetJson).toEqual([]);
    const context = JSON.parse(
      await buildContext(
        await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }),
      ),
    );
    expect(context.observations[0].historical).toBe(true);
    expect(
      context.sourceIndex.some((v: { hash: string }) => v.hash === "old"),
    ).toBe(false);
  });
  it("source mutation before adoption is rejected even when both commands start together", async () => {
    const f = await fixture(),
      p = await scenarios(f);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const change = db.$transaction(async (tx) => {
      const capture = await tx.capture.create({
        data: { projectId: f.p.id, sourceType: "实验记录", rawText: "新来源" },
      });
      const c = await tx.knowledgeCard.create({
        data: {
          projectId: f.p.id,
          captureId: capture.id,
          type: "experiment_log",
          title: "新来源",
          summary: "新来源",
          keywords: [],
          relatedTasks: [],
          nextActions: [],
          importance: 3,
        },
      });
      await enqueueImpact(tx, f.p.id, "concurrent", [`card:${c.id}`]);
      release();
    });
    await gate;
    const adopt = confirm(f, p);
    await change;
    await expect(adopt).rejects.toMatchObject({ code: "STALE_SCENARIO_BASE" });
    expect(
      await db.agentMissionEvent.count({
        where: { missionId: f.m.id, type: "DECISION_SCENARIO_ADOPTED" },
      }),
    ).toBe(0);
  });
  it("a reverted relevant source reopens the same unknown question; unrelated mutations stay silent", async () => {
    const f = await fixture(),
      c = await card(f.p.id, "Dice 实验结果"),
      q = await db.$transaction((tx) =>
        event(tx, f.m.id, "QUESTION", {
          question: "请核对 Dice",
          requirements: { terms: ["Dice"] },
        }),
      );
    await db.agentMission.update({
      where: { id: f.m.id },
      data: { status: "WAITING_INPUT" },
    });
    const before = (await currentGoalQuestion(f.actor, f.p.id)).question!;
    await interactGoalQuestion(f.actor, f.p.id, {
      questionId: q.id,
      contextHash: before.contextHash,
      action: "UNKNOWN",
      requestId: "unknown-reversal",
    });
    await db.$transaction((tx) =>
      enqueueImpact(tx, f.p.id, "unrelated", ["card:not-relevant"]),
    );
    expect((await currentGoalQuestion(f.actor, f.p.id)).question).toBeNull();
    await db.$transaction((tx) =>
      enqueueImpact(tx, f.p.id, "A-to-B-to-A", [`card:${c.id}`]),
    );
    expect(
      (await currentGoalQuestion(f.actor, f.p.id)).question?.questionId,
    ).toBe(q.id);
  });
  it("a process dying after durable intent leaves work for two replacement OS consumers; effect is once", async () => {
    const f = await chain(),
      r = await link(f.replacement.id, f.a.id, "SUPERSEDES", false);
    await confirmTemporalRelation(f.p.id, r.id);
    const options = {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${isolated.file.replaceAll("\\", "/")}`,
      },
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    };
    const old = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/impact-worker.ts", "--hold"],
      options,
    );
    await new Promise<void>((resolve, reject) => {
      old.stdout.once("data", () => resolve());
      old.once("error", reject);
      old.once("exit", (code) => {
        if (code) reject(new Error(`old process exited ${code}`));
      });
    });
    old.kill();
    await new Promise<void>((resolve) => old.once("exit", () => resolve()));
    async function child() {
      const p = spawn(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/impact-worker.ts"],
        options,
      );
      let out = "";
      p.stderr.on("data", (d) => (out += d));
      await new Promise<void>((resolve, reject) => {
        p.once("error", reject);
        p.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(out)),
        );
      });
    }
    await Promise.all([child(), child()]);
    expect(
      await db.projectImpactEffect.count({ where: { missionId: f.m.id } }),
    ).toBe(1);
    expect(
      (await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } }))
        .planRevision,
    ).toBe(2);
  }, 30000);
});

// Execute the shipped ArkTS service; replace only transport with authenticated real Next handlers.
import { POST as scenarioCreate } from "@/app/api/missions/[id]/decision-scenarios/route";
import {
  GET as scenarioRead,
  POST as scenarioAdopt,
  DELETE as scenarioReject,
} from "@/app/api/decision-scenarios/[id]/route";
import { GET as impactRead } from "@/app/api/projects/[id]/impact/route";
import {
  GET as questionRead,
  POST as questionPost,
} from "@/app/api/projects/[id]/goal-question/route";
import { DELETE as questionReset } from "@/app/api/missions/[id]/goal-question-preference/route";
function nativeService(token: string) {
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(
    fs.readFileSync(
      path.resolve(
        "harmonyos/entry/src/main/ets/services/DecisionEvolutionService.ets",
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext("(function(require,exports){" + source + "})", {})(
    () => ({ ApiClient: class {} }),
    exports,
  );
  async function dispatch(method: string, url: string, body?: object) {
    const parts = url.split("/"),
      id = parts[3],
      key = parts[4];
    const request = new Request(`https://fixture.invalid${url}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const route =
      parts[2] === "decision-scenarios"
        ? method === "GET"
          ? scenarioRead
          : method === "POST"
            ? scenarioAdopt
            : scenarioReject
        : key === "decision-scenarios"
          ? scenarioCreate
          : key === "impact"
            ? impactRead
            : key === "goal-question"
              ? method === "GET"
                ? questionRead
                : questionPost
              : questionReset;
    const result = await route(request, { params: Promise.resolve({ id }) }),
      value = await result.json();
    if (!result.ok)
      throw Object.assign(new Error(value.error.message), {
        status: result.status,
        code: value.error.code,
      });
    return value;
  }
  const Service = exports.DecisionEvolutionService as new (client: object) => {
    create: (
      id: string,
      body: object,
    ) => Promise<{ proposal: Awaited<ReturnType<typeof scenarios>> }>;
    read: (
      id: string,
    ) => Promise<{ proposal: Awaited<ReturnType<typeof readScenario>> }>;
    adopt: (
      id: string,
      body: object,
    ) => Promise<{ receipt: { missionId: string } }>;
    impact: (id: string) => Promise<{ enabled: boolean }>;
    question: (id: string) => Promise<{ question: unknown }>;
    respond: (id: string, body: object) => Promise<{ allowed: boolean }>;
    resetQuestion: (id: string) => Promise<unknown>;
    reject: (id: string) => Promise<unknown>;
  };
  return new Service({
    get: (u: string) => dispatch("GET", u),
    post: (u: string, b: object) => dispatch("POST", u, b),
    delete: (u: string) => dispatch("DELETE", u),
  });
}
it("actual ArkTS ↔ Next routes round-trip the same proposal, Mission and receipt, with revoked and cross-user boundaries", async () => {
  const f = await fixture(),
    native = nativeService(f.token),
    other = await fixture();
  const { proposal: p } = await native.create(f.m.id, {
    requestId: "native-p2",
    availableMinutes: 60,
    deliveryMinutes: 30,
  });
  expect((await native.read(p.id)).proposal.id).toBe(p.id);
  const body = {
    requestId: "native-adopt",
    proposalHash: p.proposalHash,
    scenarioKey: "VERIFY_FIRST",
    expectedVersion: p.base.expectedVersion,
    confirmed: true,
  };
  const a = await native.adopt(p.id, body),
    b = await native.adopt(p.id, body);
  expect(a).toEqual(b);
  expect(a.receipt.missionId).toBe(f.m.id);
  expect((await native.read(p.id)).proposal.receipt).toEqual(a.receipt);
  expect((await native.impact(f.p.id)).enabled).toBe(true);
  await expect(nativeService(other.token).read(p.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    native.adopt(p.id, { ...body, scenarioKey: "DELIVER_FIRST" }),
  ).rejects.toMatchObject({ status: 409 });
  const q = await db.$transaction((tx) =>
    event(tx, f.m.id, "QUESTION", { question: "请补充本轮实验结果" }),
  );
  await db.agentMission.update({
    where: { id: f.m.id },
    data: { status: "WAITING_INPUT" },
  });
  const { question } = (await native.question(f.p.id)) as {
    question: { questionId: string; contextHash: string };
  };
  expect(question.questionId).toBe(q.id);
  expect(
    await native.respond(f.p.id, {
      questionId: q.id,
      contextHash: question.contextHash,
      action: "PRESENT",
      requestId: "native-present",
    }),
  ).toMatchObject({ allowed: true });
  await native.respond(f.p.id, {
    questionId: q.id,
    contextHash: question.contextHash,
    action: "STOP",
    requestId: "native-stop",
  });
  expect((await native.question(f.p.id)).question).toBeNull();
  await native.resetQuestion(f.m.id);
  expect((await native.question(f.p.id)).question).not.toBeNull();
  await db.authSession.update({
    where: { id: f.actor.sessionId },
    data: { revokedAt: new Date() },
  });
  await expect(native.read(p.id)).rejects.toMatchObject({ status: 401 });
});

it("源文本 A→B→A 仍有新版本身份，旧预览不能因内容相同恢复可用",async()=>{
 const {updateKnowledgeCard}=await import("@/lib/repositories/cards");const f=await fixture(),c=await card(f.p.id,"原始条件"),p=await scenarios(f);
 await updateKnowledgeCard(f.p.id,c.id,{summary:"条件变更"});await updateKnowledgeCard(f.p.id,c.id,{summary:c.summary});
 await expect(confirm(f,p)).rejects.toMatchObject({code:"STALE_SCENARIO_BASE"});expect(await db.projectImpactJob.count({where:{projectId:f.p.id}})).toBe(2);
});
it("影响补偿保留原等待问题；撤销支持环后不再把它当作当前证据环",async()=>{
 const f=await chain(),cycle=await link(f.c.id,f.a.id);await db.cardRelation.update({where:{id:cycle.id},data:{revokedAt:new Date()}});
 expect(assessImpact(await db.$transaction(tx=>readDecisionSnapshot(tx,f.p.id,f.u.id)),[]).coverage.state).toBe("COMPLETE");
 const q=await db.$transaction(tx=>event(tx,f.m.id,"QUESTION",{question:"补充同条件指标"}));await db.agentMission.update({where:{id:f.m.id},data:{status:"WAITING_INPUT"}});
 const r=await link(f.replacement.id,f.a.id,"SUPERSEDES",false);await confirmTemporalRelation(f.p.id,r.id);await consumeImpactJobs();
 expect((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).status).toBe("WAITING_INPUT");expect((await currentGoalQuestion(f.actor,f.p.id)).question?.questionId).toBe(q.id);
});
it("模型只能补充定性取舍，沿用原在线模式、许可及预算；确定性计算不能被模型改写",async()=>{
 const llm=await import("@/lib/agent/llmAgent");const mocked=vi.spyOn(llm,"chatJsonWithMeta").mockResolvedValue({data:{verify:"先确认设备条件的适用范围。",deliver:"草稿先留出待核对段落。"},provider:"TEST_FIXTURE",status:"SUCCESS",fallbackReason:null,durationMs:1});const oldMode=process.env.LLM_MODE;process.env.LLM_MODE="openai-compatible";
 try{const f=await fixture();await expect(scenarios(f,{requestModelAdvice:true})).rejects.toMatchObject({code:"MODEL_ADVICE_UNAVAILABLE"});expect(mocked).not.toHaveBeenCalled();await db.agentMission.update({where:{id:f.m.id},data:{constraintsJson:{...(await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).constraintsJson as object,llmContextApproved:true}}});const p=await scenarios(f,{requestModelAdvice:true});expect(p.scenarios[1].minutes).toBe(15);expect(p.scenarios[2].minutes).toBe(30);expect(p.scenarios[1]).toHaveProperty("modelProvider","TEST_FIXTURE");expect((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).budgetUsedJson).toMatchObject({models:1,reservedOutputTokens:2048,unknownCalls:1});}
 finally{mocked.mockRestore();process.env.LLM_MODE=oldMode;}
});
