import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("worker-lifecycle"));
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { WORKER_CAPABILITY_VERSION } from "@/lib/mission/workerRelease";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

function worker(extra: Record<string, string>, args: string[] = []) {
  return spawn(process.execPath, ["--import", "tsx", "scripts/mission-worker.ts", ...args], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, LLM_MODE: "mock", MISSION_WAIT_EMAIL_ENABLED: "false",
      WORKER_PRESENCE_FILE: path.join(isolated.dir, "presence.json"), ...extra }, stdio: "ignore",
  });
}
test("production Worker keeps its capability after a scheduled heartbeat", async () => {
  const file = path.join(isolated.dir, "presence.json");
  const child = worker({ MISSION_ENABLED: "false", MISSION_V2_ENABLED: "true" });
  try {
    let first = "";
    await vi.waitFor(() => {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(data.version).toBe(WORKER_CAPABILITY_VERSION); first = data.lastHeartbeatAt;
    }, { timeout: 10000, interval: 100 });
    await new Promise(resolve => setTimeout(resolve, 11000));
    await vi.waitFor(() => {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(Date.parse(data.lastHeartbeatAt)).toBeGreaterThan(Date.parse(first));
      expect(data.version).toBe(WORKER_CAPABILITY_VERSION);
    }, { timeout: 15000, interval: 200 });
  } finally {
    const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited;
  }
}, 30000);

test("V2-off rollback Worker can process v1 without modifying frozen v2 rows", async () => {
  process.env.MISSION_ENABLED = "true"; process.env.MISSION_V2_ENABLED = "true";
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成回滚", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "回滚", goal: "核对资料", description: "合成", scenario: "RESEARCH", memberships: { create: { userId: u.id, role: "OWNER" } } } });
  const v2 = await createMission(u.id, { runtimeProtocolVersion: 2, projectId: p.id, requestId: "v2", goal: "核对持续资料" });
  const v1 = await createMission(u.id, { projectId: p.id, requestId: "v1", goal: "核对旧版资料" });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: v2.id } });
  const child = worker({ MISSION_ENABLED: "true", MISSION_V2_ENABLED: "false" }, ["--once"]);
  expect(await new Promise(resolve => child.once("exit", resolve))).toBe(0);
  expect(await db.agentMission.findUniqueOrThrow({ where: { id: v2.id } })).toEqual(before);
  expect(await db.agentMissionEvent.count({ where: { missionId: v1.id, type: "CLAIMED" } })).toBe(1);
}, 30000);
