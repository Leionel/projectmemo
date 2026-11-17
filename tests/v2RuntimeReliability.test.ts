import { afterAll, afterEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-runtime-rel"));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { inspectV2Rollout } from "@/lib/mission/rolloutCheck";
import { clearWorkerPresenceForTest, recordWorkerPresence } from "@/lib/mission/workerPresence";
import { WORKER_CAPABILITY_VERSION } from "@/lib/mission/workerRelease";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";

Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" });
const originalPresenceFile = process.env.WORKER_PRESENCE_FILE;
afterEach(() => {
  vi.useRealTimers();
  process.env.MISSION_V2_ENABLED = "true";
  clearWorkerPresenceForTest();
  if (originalPresenceFile) process.env.WORKER_PRESENCE_FILE = originalPresenceFile; else delete process.env.WORKER_PRESENCE_FILE;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: "rr-" + crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: label, description: "隔离运行可靠性", goal: "整理持续报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: label + "：第一版资料，仍待核对。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理持续报告", llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 100, maxTools: 100, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  let selected = capture.id;
  const provider = fixtureSkillProvider(async () => {
    const source = await readProjectMaterial(project.id, "capture:" + selected);
    return { sourceId: source!.id, sourceHash: source!.hash };
  });
  return { user, project, mission, capture, provider, select: (id: string) => { selected = id; } };
}
async function settle(f: Awaited<ReturnType<typeof fixture>>) {
  for (let index = 0; index < 8; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: row.id, provider: f.provider });
  }
  return db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
}

test("clock advance: the next observation is only woken once nextAttemptAt is due", async () => {
  const f = await fixture("时钟推进");
  await settle(f);
  const now = new Date("2026-11-17T10:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(now);
  await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "时钟推进：新材料到达。" } });
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(now.getTime() + 60 * 60000) } });
  const beforeDue = await processInvestigationDelegations(32);
  expect(beforeDue.checked).toBe(0);
  expect(beforeDue.woken).toBe(0);
  vi.setSystemTime(new Date(now.getTime() + 61 * 60000));
  const afterDue = await processInvestigationDelegations(32);
  expect(afterDue.woken).toBe(1);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).status).toBe("READY");
});

test("clock advance: an expired lease is recovered by a later Worker without duplicating output", async () => {
  const f = await fixture("租约到期");
  await settle(f);
  const now = new Date("2026-11-17T11:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(now);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { status: "RUNNING", executionSlot: 1, leaseOwner: "dead-worker",
    leaseUntil: new Date(now.getTime() + 60000), leaseEpoch: { increment: 1 } } });
  vi.setSystemTime(new Date(now.getTime() + 61000));
  const claimed = await runMissionSlice({ id: f.mission.id, provider: f.provider });
  expect(claimed).toBe(true);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(1);
});

test("a worker without v2 support neither resets nor claims v2 rows", async () => {
  const f = await fixture("v2关闭");
  await settle(f);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { status: "READY", nextAttemptAt: null, pauseReason: null } });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  const claimedEventsBefore = await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "CLAIMED" } });
  process.env.MISSION_V2_ENABLED = "false";
  const claimed = await runMissionSlice({ id: f.mission.id, provider: f.provider });
  expect(claimed).toBe(false);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("READY");
  expect(after.version).toBe(before.version);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "CLAIMED" } })).toBe(claimedEventsBefore);
});

test("rollout gate blocks v2 rows while disabled and mixed worker versions", async () => {
  process.env.WORKER_PRESENCE_FILE = path.join(os.tmpdir(), "pm-rollout-" + crypto.randomUUID() + ".json");
  const f = await fixture("升级检查");
  // Empty v2 set → v1-only deployment is safe even with V2 off. Earlier tests in this file leave v2 rows,
  // so normalize the isolated DB first (the gate is intentionally DB-wide, not per-project).
  await db.agentMission.updateMany({ data: { runtimeProtocolVersion: 1 } });
  process.env.MISSION_V2_ENABLED = "false";
  const v1Only = await inspectV2Rollout();
  expect(v1Only.verdict).toBe("V1_ONLY_SAFE");
  expect(v1Only.ok).toBe(true);
  // v2 row while flag off is blocked.
  await db.agentMission.update({ where: { id: f.mission.id }, data: { runtimeProtocolVersion: 2 } });
  const disabled = await inspectV2Rollout();
  expect(disabled.verdict).toBe("BLOCKED");
  expect(disabled.reason).toBe("V2_ROWS_PRESENT_WHILE_DISABLED");
  // Flag on with an old Worker build is blocked; the v2-capable build passes.
  process.env.MISSION_V2_ENABLED = "true";
  recordWorkerPresence({ workerId: "old-worker", version: "r4-ux3-worker" });
  const mixed = await inspectV2Rollout();
  expect(mixed.reason).toBe("MIXED_WORKER_VERSION");
  recordWorkerPresence({ workerId: "new-worker", version: WORKER_CAPABILITY_VERSION });
  const ready = await inspectV2Rollout();
  expect(ready.verdict).toBe("V2_READY");
  expect(ready.ok).toBe(true);
});

test("enabling V2 requires a recent compatible Worker even before the first v2 row", async () => {
  process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "first-v2-presence.json");
  await db.agentMission.updateMany({ data: { runtimeProtocolVersion: 1 } });
  expect((await inspectV2Rollout()).ok).toBe(false);
  const now = Date.now();
  recordWorkerPresence({ workerId: "v2-worker", version: WORKER_CAPABILITY_VERSION, now });
  expect((await inspectV2Rollout({ now })).ok).toBe(true);
  expect((await inspectV2Rollout({ now: now + 61000 })).ok).toBe(false);
  process.env.MISSION_V2_ENABLED = "false";
  recordWorkerPresence({ workerId: "v2-worker", version: WORKER_CAPABILITY_VERSION, now });
  process.env.MISSION_V2_ENABLED = "true";
  expect((await inspectV2Rollout({ now })).ok).toBe(false);
});

test("long-run harness: start --wait, status and report produce wall-clock evidence", async () => {
  const out = path.join(os.tmpdir(), "pm-long-run-" + crypto.randomUUID());
  const run = (args: string[]) => new Promise<{ code: number | null; stdout: string }>(resolve => {
    const child = spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/v2-long-run.ts"), ...args, "--out", out],
      { cwd: process.cwd(), env: { ...process.env, LLM_MODE: "mock" }, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stdout += String(chunk); });
    child.on("exit", code => resolve({ code, stdout }));
  });
  const started = await run(["start", "--interval-ms", "20", "--cycles", "8", "--material-every", "2", "--wait"]);
  expect(started.code, started.stdout).toBe(0);
  expect(fs.existsSync(path.join(out, "evidence.jsonl"))).toBe(true);
  const lines = fs.readFileSync(path.join(out, "evidence.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThanOrEqual(6);
  const status = await run(["status"]);
  expect(status.code).toBe(0);
  expect(status.stdout).toContain("evidenceLines");
  const report = await run(["report"]);
  expect(report.code).toBe(0);
  const reportJson = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
  expect(reportJson.budgetMonotonic).toBe(true);
  expect(reportJson.reservedReleased).toBe(true);
  expect(reportJson.note).toContain("not a claim of 72h");
  fs.rmSync(out, { recursive: true, force: true });
});
