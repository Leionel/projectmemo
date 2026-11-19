import fs from "node:fs";
import path from "node:path";
const [manifestPath, workerId] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { databaseUrl: string; deadline: number; missions: Array<{ missionId: string; projectId: string; captureId: string }> };
Object.assign(process.env, { DATABASE_URL: config.databaseUrl, LLM_MODE: "mock", MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
const { db } = await import("../lib/db");
const { runMissionSlice } = await import("../lib/mission/runner");
const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
const { fixtureSkillProvider } = await import("./fixtures/v2-provider");
const log = path.join(path.dirname(manifestPath), workerId + ".jsonl");
const append = (value: unknown) => fs.appendFileSync(log, JSON.stringify(value) + "\n");
append({ type: "START", pid: process.pid, at: Date.now() });
const missions = config.missions.map(m => ({ ...m, provider: fixtureSkillProvider(async () => {
  const s = (await readProjectMaterial(m.projectId, "capture:" + m.captureId))!; return { sourceId: s.id, sourceHash: s.hash };
}) }));
try {
  while (Date.now() < config.deadline) {
    let pending = false;
    for (const m of missions) {
      const row = await db.agentMission.findUniqueOrThrow({ where: { id: m.missionId } });
      if (!["READY", "RUNNING"].includes(row.status)) continue;
      pending = true;
      try {
        const begin = Date.now(), claimed = await runMissionSlice({ id: m.missionId, provider: m.provider, workerId });
        if (claimed) append({ type: "SLICE", missionId: m.missionId, begin, at: Date.now(), outputs: await db.agentMissionOutput.count({ where: { missionId: m.missionId } }) });
      } catch (error) {
        append({ type: "ERROR", missionId: m.missionId, at: Date.now(), code: (error as { code?: string }).code ?? "UNKNOWN", message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!pending) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
} finally { await db.$disconnect(); append({ type: "EXIT", pid: process.pid, at: Date.now() }); }
