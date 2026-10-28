import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
export function continuityDatabase(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-continuity-" + label + "-")), file = path.join(dir, "test.db");
  Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true",
    FOCUS_AGENT_R4_ENABLED: "false", FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "true", MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true",
    LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file); sql.pragma("journal_mode = WAL");
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close(); return { dir, file };
}
