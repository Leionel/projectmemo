/**
 * 建立隔离的 Web 玩法演示库。仅在 prisma/projectmemo-web-games.db 上操作。
 * 用法：npm.cmd exec tsx -- scripts/seed-web-games-demo.ts
 */
import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve("prisma", "projectmemo-web-games.db");
const databaseUrl = "file:" + databasePath.replaceAll("\\", "/");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== databaseUrl) {
  throw new Error("拒绝在非演示数据库上建立合成数据：" + process.env.DATABASE_URL);
}
process.env.DATABASE_URL = databaseUrl;
Object.assign(process.env, {
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_WEB_ENABLED: "true",
  MISSION_V2_ENABLED: "true", MISSION_CHALLENGES_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", LLM_MODE: "mock",
});
if (!fs.existsSync(databasePath)) throw new Error("演示库不存在，请先运行迁移：" + databasePath);
const { seedWebGamesFixture } = await import("./web-games-fixture");
const fixture = await seedWebGamesFixture();
console.log(JSON.stringify({ missionId: fixture.mission.id, projectId: fixture.project.id, user: fixture.user.username, databasePath }, null, 2));
const { db } = await import("../lib/db");
await db.$disconnect();
