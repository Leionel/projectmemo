import { expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
it("S0 迁移能升级旧库副本，保留原行；源库不被迁移", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-s0-upgrade-"));
  const original = new Database(path.join(dir, "old.db"));
  let copy: Database.Database | undefined;
  try {
    const migrations = fs.readdirSync("prisma/migrations").sort();
    for (const name of migrations.filter(n => n < "20261102010000")) {
      const file = path.join("prisma/migrations", name, "migration.sql");
      if (fs.existsSync(file)) original.exec(fs.readFileSync(file, "utf8"));
    }
    original.prepare("INSERT INTO Project(id,title,description,goal,scenario,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("synthetic", "旧库项目", "合成材料", "保留原记录", "RESEARCH", 1, 1);
    await original.backup(path.join(dir, "copy.db"));
    copy = new Database(path.join(dir, "copy.db"));
    for (const name of migrations.filter(n => n >= "20261102010000")) {
      const file = path.join("prisma/migrations", name, "migration.sql");
      if (fs.existsSync(file)) copy.exec(fs.readFileSync(file, "utf8"));
    }
    expect(copy.prepare("SELECT title,deletionRequestedAt FROM Project WHERE id=?").get("synthetic")).toEqual({ title: "旧库项目", deletionRequestedAt: null });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(copy.pragma("foreign_key_check")).toEqual([]);
    expect(() => original.prepare("SELECT deletionRequestedAt FROM Project")).toThrow();
  } finally { copy?.close(); original.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
