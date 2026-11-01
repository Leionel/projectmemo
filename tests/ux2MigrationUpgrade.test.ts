import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("UX2 在旧库副本增量升级，保留原记录且不猜测回填授权", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-ux2-upgrade-"));
  const oldFile = path.join(dir, "old.db"), copy = path.join(dir, "copy.db");
  const migrations = fs.readdirSync("prisma/migrations").sort().filter(name => fs.existsSync(path.join("prisma/migrations", name, "migration.sql")));
  // 旧基线 = UX2 之前的全部迁移；增量 = UX2 与其后的功能迁移（PM-1 账户范围重建依赖 UX2 的 AgentClaim）。
  const additions = migrations.filter(name => name.includes("ux2_") || name.includes("pm1_"));
  expect(additions.length).toBeGreaterThanOrEqual(2);
  const old = new Database(oldFile);
  try {
    for (const name of migrations.filter(n => !additions.includes(n))) old.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
    const insert = (table: string, values: Record<string, string | number>) => {
      const columns = old.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
      for (const c of columns) if (c.notnull && c.dflt_value === null && !(c.name in values)) values[c.name] = c.type.includes("INT") ? 0 : "fixture";
      const names = Object.keys(values);
      old.prepare(`INSERT INTO "${table}" (${names.map(n => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(values));
    };
    insert("User", { id: "u", username: "ux2-copy", displayName: "隔离旧库", passwordHash: "fixture" });
    insert("Project", { id: "p", title: "原项目", description: "原材料保留", goal: "原目标", scenario: "RESEARCH" });
    insert("SourceConnection", { id: "c", projectId: "p", ownerUserId: "u", repo: "fixture/repo", ref: "main" });
    insert("ExternalSignal", { id: "s", connectionId: "c", projectId: "p", ownerUserId: "u", sha: "a".repeat(40), title: "旧候选", authorName: "fixture", url: "https://github.com/fixture/repo" });
  } finally { old.close(); }
  // Copy synchronously after closing, including every committed old row.
  fs.copyFileSync(oldFile, copy);
  const upgraded = new Database(copy);
  try {
    for (const name of additions) upgraded.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
    expect(upgraded.prepare('SELECT title,goal FROM "Project"').get()).toEqual({ title: "原项目", goal: "原目标" });
    expect(upgraded.prepare('SELECT id,title,"sourceBindingJson" FROM "ExternalSignal"').get()).toEqual({ id: "s", title: "旧候选", sourceBindingJson: null });
    expect(upgraded.prepare('SELECT count(*) AS n FROM "AgentClaimEvent"').get()).toEqual({ n: 0 });
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    const untouched = new Database(oldFile, { readonly: true });
    try { expect(untouched.prepare('PRAGMA table_info("ExternalSignal")').all().some(c => (c as { name: string }).name === "sourceBindingJson")).toBe(false); }
    finally { untouched.close(); }
  } finally { upgraded.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 60000);
