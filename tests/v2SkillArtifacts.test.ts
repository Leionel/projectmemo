import { afterAll, beforeAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-artifacts"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { textHash } from "@/lib/research/sourceRepository";
import { json, type Source } from "@/lib/mission/contracts";

let userId = "";
beforeAll(async () => {
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
    MISSION_WORKBENCH_ENABLED: "true" });
  userId = (await db.user.create({ data: { username: "artifact-" + crypto.randomUUID(), displayName: "阶段成果测试", passwordHash: "unused" } })).id;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

type SourceLike = Source;
async function fixture(goal: string) {
  const { createMission, editContinuationPolicy } = await import("@/lib/mission/missionService");
  const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
  const project = await db.project.create({ data: { title: "阶段成果项目", description: "隔离测试", goal: "整理交付", scenario: "RESEARCH",
    memberships: { create: { userId, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT",
    rawText: "课程要求：提交设计说明与 SQL 脚本；截止日期未写明；评分口径未给出。" } });
  const created = await createMission(userId, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(),
    goal, llmContextApproved: true });
  const mission = await editContinuationPolicy(userId, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 24, maxTools: 32, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  const source = (await readProjectMaterial(project.id, "capture:" + capture.id))! as SourceLike;
  return { project, capture, mission, source };
}

async function seedExistingReport(missionId: string, source: SourceLike) {
  const { saveOutput } = await import("@/lib/mission/outputService");
  const step = await db.agentMissionStep.create({ data: { missionId, ordinal: 1, planRevision: 1, toolName: "save_mission_output",
    status: "SUCCEEDED", canonicalInputJson: {}, inputHash: crypto.randomUUID(), readSetJson: json([source]), finishedAt: new Date() } });
  const excerpt = source.text.slice(0, 40);
  await saveOutput(db, missionId, step.id, { blocks: [
    { blockId: "existing", kind: "PROJECT_OBSERVATION", text: "原有报告：" + excerpt, sourceIds: [source.id],
      citations: [{ sourceId: source.id, start: 0, end: excerpt.length, excerptHash: textHash(excerpt) }] },
  ] }, [source]);
}

function artifactProvider() {
  return async (raw: string) => {
    const context = JSON.parse(raw) as { skillExecution: { stage: string; evidencePack?: { sources: Array<{ id: string; text: string }> } } };
    const skill = context.skillExecution;
    const source = skill.evidencePack?.sources[0];
    if (!source) {
      return { choice: { kind: "tool" as const, tool: "read_project_material", args: { sourceId: "", sourceHash: "" }, summary: "读取原资料" },
        provider: "INJECTED_ARTIFACT_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
    }
    const excerpt = source.text.slice(0, 80);
    return { choice: { kind: "tool" as const, tool: "save_mission_output", summary: "交付阶段成果", args: {
      blocks: [
        { blockId: "stage-summary", kind: "INFERENCE" as const, text: "本阶段只交付" + skill.stage + "结果；未知项保持未知，不修改原报告。", sourceIds: [] as string[] },
        { blockId: "stage-evidence", kind: "PROJECT_OBSERVATION" as const, text: "项目资料记载：" + excerpt, sourceIds: [source.id],
          citations: [{ sourceId: source.id, start: 0, end: excerpt.length, excerptHash: textHash(excerpt) }] },
      ],
      missingInformation: ["截止日期未写明", "评分口径未给出"],
    } }, provider: "INJECTED_ARTIFACT_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
  };
}

// The first decision fills the read tool arguments from the real project source.
function resolvingProvider(readSource: () => Promise<{ sourceId: string; sourceHash: string }>) {
  const base = artifactProvider();
  return async (raw: string) => {
    const choice = await base(raw);
    if (choice.choice.kind === "tool" && choice.choice.tool === "read_project_material")
      return { ...choice, choice: { ...choice.choice, args: await readSource() } };
    return choice;
  };
}

async function runScenario(goal: string, withExistingReport: boolean) {
  const { mission, project, capture, source } = await fixture(goal);
  if (withExistingReport) await seedExistingReport(mission.id, source);
  const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
  const { runMissionSlice } = await import("@/lib/mission/runner");
  const provider = resolvingProvider(async () => {
    const latest = (await readProjectMaterial(project.id, "capture:" + capture.id))!;
    return { sourceId: latest.id, sourceHash: latest.hash };
  });
  for (let index = 0; index < 6; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: mission.id, provider });
  }
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  return { mission, project, capture, source, row };
}

test.each([
  ["这次只做计划，报告不要动", "project-planning"],
  ["先研究，不开始写报告", "evidence-research"],
  ["只复盘，不创建行动", "project-review"],
])("%s：交付可查看阶段成果，原报告与行动不变，并进入可恢复状态", async (goal, skillId) => {
  const { mission, project, row, source } = await runScenario(goal, true);
  if (process.env.DEBUG_ARTIFACTS) console.log("DEBUG", row.status, row.pauseReason, JSON.stringify(row.lastErrorJson), JSON.stringify((row.planJson as {skillCursor?:unknown}).skillCursor).slice(0,300));
  const plan = row.planJson as { skillArtifacts?: Array<{ id: string; skillId: string; blocks: Array<{ sourceIds: string[]; text: string }>;
    sources: Array<{ id: string; hash: string }>; checks: Array<{ name: string; passed: boolean }> }> };
  expect(row.pauseReason).toBe("SKILL_DELIVERABLE_READY");
  expect(row.lastErrorJson).toBeNull();
  expect(row.status).toBe("PAUSED");
  expect(plan.skillArtifacts).toHaveLength(1);
  const artifact = plan.skillArtifacts![0];
  expect(artifact.skillId).toBe(skillId);
  expect(artifact.sources.map(item => item.id)).toContain(source.id);
  expect(artifact.blocks.some(block => block.sourceIds.includes(source.id))).toBe(true);
  expect(artifact.checks.every(check => check.passed)).toBe(true);
  expect(await db.agentMissionOutput.count({ where: { missionId: mission.id } })).toBe(1);
  expect(await db.agentMissionStep.count({ where: { missionId: mission.id, toolName: "save_mission_output" } })).toBe(2);
  expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
  expect(await db.agentMissionEvent.count({ where: { missionId: mission.id, type: "SKILL_ARTIFACT_SAVED" } })).toBe(1);
  const { readMissionWorkbench } = await import("@/lib/mission/workbenchService");
  const view = await readMissionWorkbench(userId, mission.id);
  expect(view.outputs).toHaveLength(1);
  expect(view.stageArtifacts).toHaveLength(1);
  expect(view.stageArtifacts[0].skillId).toBe(skillId);
  expect(view.stageArtifacts[0].blocks.some(block => block.sourceIds.includes(source.id))).toBe(true);
  expect(view.stageArtifacts[0].presentation.schemaVersion).toBe(1);
  expect(view.phase).toBe("PAUSED");
  expect(view.reasonCode).toBe("SKILL_DELIVERABLE_READY");
  const { commandMission } = await import("@/lib/mission/missionService");
  const resumed = await commandMission(userId, mission.id, "resume", { requestId: "resume-artifact", expectedVersion: row.version });
  expect(["READY", "WAITING_INPUT"]).toContain(resumed.status);
});

test("阶段成果缺少真实来源时被拒绝，不会写进原报告或进入已交付状态", async () => {
  const { mission, project, capture } = await fixture("这次只做计划，报告不要动");
  const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
  const { runMissionSlice } = await import("@/lib/mission/runner");
  const provider = resolvingProvider(async () => {
    const latest = (await readProjectMaterial(project.id, "capture:" + capture.id))!;
    return { sourceId: latest.id, sourceHash: latest.hash };
  });
  const good = provider;
  const bad = async (raw: string) => {
    const parsed = JSON.parse(raw) as { skillExecution?: { evidencePack?: { sources?: unknown[] } } };
    if (!parsed.skillExecution?.evidencePack?.sources?.length) return good(raw);
    return { choice: { kind: "tool" as const, tool: "save_mission_output", summary: "无来源阶段成果",
      args: { blocks: [{ blockId: "unsupported", kind: "PROJECT_OBSERVATION" as const, text: "没有来源的结论", sourceIds: [], citations: [] }] } },
      provider: "INJECTED_ARTIFACT_TEST", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
  };
  for (let index = 0; index < 6; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: mission.id, provider: bad });
  }
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  expect(row.pauseReason).not.toBe("SKILL_DELIVERABLE_READY");
  expect(((row.planJson as { skillArtifacts?: unknown[] }).skillArtifacts ?? [])).toHaveLength(0);
  expect(await db.agentMissionOutput.count({ where: { missionId: mission.id } })).toBe(0);
});
