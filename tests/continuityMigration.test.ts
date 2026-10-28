import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
test("additive upgrade preserves legacy user/conversation bytes and foreign keys; empty replay is covered by integration databases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct1-migration-")), sql = new Database(path.join(dir, "old.sqlite"));
  try {
    const latest = "20261028140000_continuity_directives";
    for (const name of fs.readdirSync("prisma/migrations").sort().filter(n => n < latest)) { const file = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); }
    sql.exec(`INSERT INTO User(id,username,displayName,passwordHash,createdAt,updatedAt) VALUES('legacy-u','legacy','original','unchanged',0,0);
      INSERT INTO Conversation(id,ownerUserId,createRequestId,createInputHash,scope,title,version,updatedAt) VALUES('legacy-c','legacy-u','original-request','original-hash','WORKSPACE','original-title',7,0);`);
    const before = sql.prepare("SELECT * FROM Conversation").get();
    sql.exec(fs.readFileSync(path.join("prisma/migrations", latest, "migration.sql"), "utf8"));
    expect(sql.prepare("SELECT * FROM Conversation").get()).toEqual(before);
    expect(sql.prepare("SELECT continuitySeq,passwordHash FROM User WHERE id='legacy-u'").get()).toEqual({ continuitySeq: 0, passwordHash: "unchanged" });
    expect(sql.pragma("foreign_key_check")).toEqual([]);
  } finally { sql.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
