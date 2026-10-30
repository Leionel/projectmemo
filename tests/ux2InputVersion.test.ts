import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-input-version"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { completeProjectAction } from "@/lib/services/actionService";
import { buildContext } from "@/lib/mission/contextBuilder";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function projectWithMission(title: string) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "输入版本", passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title, goal: "原目标", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const mission = await db.agentMission.create({ data: { projectId: project.id, ownerUserId: user.id, createRequestId: crypto.randomUUID(), createPayloadHash: "hash",
    goal: "核对启动结果", successCriteriaJson: [], constraintsJson: {}, budgetJson: {}, budgetUsedJson: {}, status: "RUNNING" } });
  return { user, project, mission };
}

test("行动复盘是新的项目输入：写入前进一版，重复完成与读取都不再前进", async () => {
  const { project } = await projectWithMission("行动项目");
  const action = await db.actionItem.create({ data: { projectId: project.id, title: "记录启动日志", description: "核对", status: "TODO", priority: 3 } });
  expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).contextRevision).toBe(0);
  const completed = await completeProjectAction(project.id, action.id, "已在目标设备记录启动日志，耗时 3 秒。");
  expect(completed.resultCardId).toBeTruthy();
  expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).contextRevision).toBe(1);
  await completeProjectAction(project.id, action.id, "已在目标设备记录启动日志，耗时 3 秒。");
  expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).contextRevision).toBe(1);
  expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).goal).toBe("原目标");
});

test("大量推测只按剩余容量进入上下文，并明确标注覆盖不足而不是冒充完整读取", async () => {
  const { user, project, mission } = await projectWithMission("容量项目");
  const output = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "ANSWER", contentJson: { text: "原调查产物" },
    sourceRefsJson: [], claimChecksJson: [], verificationStatus: "NEEDS_REVIEW" } });
  const root = { kind: "MISSION_OUTPUT", id: output.id, missionId: mission.id, projectId: project.id, allowedProjectIds: [project.id],
    sourceRevisionReadSet: [{ projectId: project.id, revision: 0, role: "OWNER" }] };
  const quote = "同一设备在不同条件下的启动记录需要逐条核对，".repeat(40);
  for (let index = 0; index < 4; index++) {
    const claim = await db.agentClaim.create({ data: { ownerUserId: user.id, projectId: project.id, scopeKey: "{}", missionId: mission.id, originKey: `root-${index}`,
      kind: "HYPOTHESIS", canonicalStatement: `推测 ${index} ` + "启动条件可能不同，".repeat(80), conditionsJson: ["同一设备"],
      originJson: { ...root, index } } });
    await db.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: user.id, revision: 1, requestId: `model:${index}`, payloadHash: "hash",
      eventKind: "MODEL_PROPOSED", actorKind: "MODEL", targetHash: "hash", validFrom: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 86400000),
      evidenceManifestJson: Array.from({ length: 6 }, (_, i) => ({ sourceId: `capture:fake-${index}-${i}`, projectId: project.id, role: "BACKGROUND", quote, qualified: false, format: "MISSION",
        snapshot: { id: `capture:fake-${index}-${i}`, kind: "PROJECT", hash: "h", revision: "h", text: quote, observedAt: new Date().toISOString(), knowledgeClass: "PROJECT_OBSERVATION" } })),
      assessmentJson: { root, scope: { projectId: project.id, missionId: mission.id }, statement: `推测 ${index}`, effectiveState: "PROPOSED",
        explanation: "原记录不完整", nextInformationNeed: "读取启动日志" } } });
  }
  const context = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));
  expect(context.hypotheses.items.length).toBeLessThan(4);
  expect(context.hypotheses.items.length).toBe(context.hypotheses.readSet.length);
  expect(context.hypotheses.coverage.complete).toBe(false);
  expect(context.manifest.omittedCognition.hypotheses).toBeGreaterThan(0);
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(30000);
}, 30000);
