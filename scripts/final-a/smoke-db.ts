/**
 * 冒烟：验证独立临时库 + 迁移重放 + 动态 import 顺序 + 真实服务调用可跑通。
 * 不产出正式证据；正式证据由 probe-fs-a.ts / probe-fs-a07-concurrency.ts 生成。
 */
import { createOwner, createMission } from "./lib/probeFixtures";
import { setupIsolatedDatabase } from "./lib/probeSupport";

const env = setupIsolatedDatabase("smoke");
const db = (await import("../../lib/db")).db;
const { readMissionBack } = await import("../../lib/mission/readback");
const { missionDetail } = await import("../../lib/mission/missionService");
const { missionWorkspaceSummary } = await import("../../lib/mission/workspaceSummary");

const owner = await createOwner(db, "smoke");
const mission = await createMission(db, owner, { status: "READY" });
const readback = await readMissionBack(owner.userId, mission.id);
const detail = await missionDetail(owner.userId, mission.id);
const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
console.log(JSON.stringify({
  database: env.databaseUrl,
  migrationsApplied: env.migrationsApplied,
  schemaTables: env.schemaTables,
  missionId: mission.id,
  readback: { missionVersion: readback.missionVersion, missionStatus: readback.missionStatus, phase: readback.workState.phase },
  detail: { status: detail.status, version: detail.version },
  summary: { enabled: summary.enabled, totalActive: summary.totalActive, itemCount: summary.items.length },
}, null, 2));
await db.$disconnect();
