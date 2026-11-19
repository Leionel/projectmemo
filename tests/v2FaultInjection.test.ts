import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-faults"));
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";

Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_WORKBENCH_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const childScript = path.resolve("scripts/reliability-fault-child.ts");
function childEnv() {
  return { ...process.env, DATABASE_URL: "file:" + isolated.file.replaceAll("\\", "/"), LLM_MODE: "mock",
    MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" };
}
type ChildResult = { code: number | null; signal: string | null; result: Record<string, unknown> | null; stderr: string };
function runChild(mode: string, args: { mission: string; project: string; capture: string; barrier?: string }): Promise<ChildResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--import", "tsx", childScript, "--mode=" + mode,
      "--mission=" + args.mission, "--project=" + args.project, "--capture=" + args.capture, ...(args.barrier ? ["--barrier=" + args.barrier] : [])],
      { cwd: process.cwd(), env: childEnv(), windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill(); resolve({ code: null, signal: "TIMEOUT", result: null, stderr }); }, 120000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).reverse().find(item => item.startsWith("RESULT:"));
      let result: Record<string, unknown> | null = null;
      try { result = line ? JSON.parse(line.slice("RESULT:".length)) : null; } catch { result = null; }
      resolve({ code, signal, result, stderr });
    });
  });
}

async function fixture(goal: string) {
  const user = await db.user.create({ data: { username: "fault-" + crypto.randomUUID(), displayName: "故障测试", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "故障注入项目", description: "隔离测试", goal: "整理持续报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: "第一版资料：登录流程已完成；移动端回归尚未记录。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal, llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 100, maxTools: 100, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  return { user, project, mission, capture };
}
async function checkpointInChild(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await runChild("checkpoint", { mission: f.mission.id, project: f.project.id, capture: f.capture.id });
  expect(result.code).toBe(0);
  expect(result.result?.status).toBe("WAITING_INPUT");
  return result.result!;
}
async function wakeWithMaterial(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  const capture = await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: text } });
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  const scan = await processInvestigationDelegations(32);
  expect(scan.woken).toBeGreaterThanOrEqual(1);
  return capture;
}
const count = (missionId: string) => db.agentMissionOutput.count({ where: { missionId } });
const budget = async (missionId: string) => (await db.agentMission.findUniqueOrThrow({ where: { id: missionId } })).budgetUsedJson as { models: number; tools: number };

test("crash after read: a new process resumes the same Mission and reaches the next checkpoint", async () => {
  const f = await fixture("整理持续报告"), first = await checkpointInChild(f);
  const newer = await wakeWithMaterial(f, "第二版资料：移动端回归已补测，分享入口未验证。");
  const crashed = await runChild("read-crash", { mission: f.mission.id, project: f.project.id, capture: newer.id });
  expect(crashed.code).toBe(0);
  expect(crashed.result?.status).toBe("READY");
  expect(await count(f.mission.id)).toBe(1);
  const resumed = await runChild("resume", { mission: f.mission.id, project: f.project.id, capture: newer.id });
  expect(resumed.code).toBe(0);
  expect(resumed.result?.status, JSON.stringify(resumed.result)).toBe("WAITING_INPUT");
  expect((resumed.result?.outputs as unknown[]).length).toBe(2);
  expect(await count(f.mission.id)).toBe(2);
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(mission.status).toBe("WAITING_INPUT");
  expect((mission.planJson as { checkpoint?: { outputId?: string } }).checkpoint?.outputId).toBeTruthy();
  expect(first.version).toBeLessThan(mission.version);
  expect((await budget(f.mission.id)).models).toBeGreaterThanOrEqual(3);
});

test("crash before output commit: restart re-runs the unfinished step and commits one revision", async () => {
  const f = await fixture("整理持续报告");
  await checkpointInChild(f);
  const newer = await wakeWithMaterial(f, "第二版资料：移动端回归已补测，分享入口未验证。");
  const crashed = await runChild("save-crash", { mission: f.mission.id, project: f.project.id, capture: newer.id });
  expect(crashed.code, JSON.stringify(crashed.result) + crashed.stderr).toBe(137);
  expect(crashed.result?.crash).toBe("BEFORE_OUTPUT_COMMIT");
  const stranded = await db.agentMissionStep.findFirst({ where: { missionId: f.mission.id, toolName: "save_mission_output" }, orderBy: { ordinal: "desc" } });
  expect(stranded?.status).toBe("RUNNING");
  // Simulate the lease expiring after the process died (clock advance in tests, not a real 60s wait).
  await db.agentMission.update({ where: { id: f.mission.id }, data: { leaseUntil: new Date(0) } });
  const resumed = await runChild("resume", { mission: f.mission.id, project: f.project.id, capture: newer.id });
  expect(resumed.code).toBe(0);
  expect(resumed.result?.status).toBe("WAITING_INPUT");
  const outputs = await db.agentMissionOutput.findMany({ where: { missionId: f.mission.id }, orderBy: { revision: "asc" }, select: { revision: true } });
  expect(outputs.map(output => output.revision)).toEqual([1, 2]);
  expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id, toolName: "save_mission_output", status: "SUCCEEDED" } })).toBe(2);
});

test("crash after receipt commit: restart scans never re-trigger the delivered output", async () => {
  const f = await fixture("整理持续报告");
  const settled = await checkpointInChild(f);
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  const state = await runChild("state", { mission: f.mission.id, project: f.project.id, capture: f.capture.id });
  expect(state.code).toBe(0);
  expect(state.result?.status).toBe("WAITING_INPUT");
  expect((state.result?.outputs as unknown[]).length).toBe(1);
  expect((state.result?.checkpoint as { outputId?: string } | null)?.outputId).toBeTruthy();
  for (let index = 0; index < 100; index++) {
    await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
    expect((await processInvestigationDelegations(32)).woken).toBe(0);
  }
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("WAITING_INPUT");
  expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(await count(f.mission.id)).toBe(1);
  void settled;
});

test("two worker processes racing one READY mission: exactly one claims and writes once", async () => {
  const f = await fixture("整理持续报告");
  await checkpointInChild(f);
  const newer = await wakeWithMaterial(f, "第二版资料：移动端回归已补测，分享入口未验证。");
  const barrier = path.join(isolated.dir, "claim-barrier"); fs.mkdirSync(barrier);
  const attempts = [runChild("work", { mission: f.mission.id, project: f.project.id, capture: newer.id, barrier }),
    runChild("work", { mission: f.mission.id, project: f.project.id, capture: newer.id, barrier })];
  const loser = await Promise.race(attempts);
  fs.writeFileSync(path.join(barrier, "release"), "release");
  const [left, right] = await Promise.all(attempts);
  expect(loser.result?.claimed).toBe(false);
  expect(left.code).toBe(0);
  expect(right.code).toBe(0);
  const claimed = [left.result?.claimed, right.result?.claimed].filter(Boolean).length;
  expect(claimed).toBe(1);
  expect(await count(f.mission.id)).toBe(1);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "CLAIMED" } })).toBeGreaterThan(0);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(["READY", "RUNNING", "WAITING_INPUT"]).toContain(row.status);
});

test.each([
  ["这次只做计划，报告不要动", "project-planning", "skill-artifact"],
  ["先研究，不开始写报告", "evidence-research", "skill-artifact"],
  ["只复盘，不创建行动", "project-review", "skill-artifact"],
  ["整理持续报告", null, "report"],
] as const)("a second process recovers the delivery of %s", async (goal, skillId, kind) => {
  const f = await fixture(goal);
  const settled = await runChild("checkpoint", { mission: f.mission.id, project: f.project.id, capture: f.capture.id });
  expect(settled.code).toBe(0);
  const state = await runChild("state", { mission: f.mission.id, project: f.project.id, capture: f.capture.id });
  expect(state.code).toBe(0);
  const artifacts = state.result?.skillArtifacts as Array<{ skillId: string; blocks: number }> | undefined;
  if (kind === "skill-artifact") {
    expect(artifacts?.length).toBe(1);
    expect(artifacts?.[0].skillId).toBe(skillId);
    expect(artifacts?.[0].blocks).toBeGreaterThan(0);
    expect((state.result?.outputs as unknown[]).length).toBe(0);
    expect(state.result?.pauseReason).toBe("SKILL_DELIVERABLE_READY");
  } else {
    expect((state.result?.outputs as Array<{ revision: number }>).length).toBeGreaterThanOrEqual(1);
    expect(state.result?.status).toBe("WAITING_INPUT");
    expect(state.result?.checkpoint).toBeTruthy();
  }
});
