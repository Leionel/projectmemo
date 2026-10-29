import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

it("PR6 增量迁移保留旧会话/回执，空库也可完整重放", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pr6-upgrade-")), db = new Database(path.join(dir, "old.sqlite"));
  try {
    const migrations = fs.readdirSync("prisma/migrations").sort();
    for (const name of migrations.filter(x => x !== "20261028010000_conversation_research")) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) db.exec(fs.readFileSync(p, "utf8")); }
    db.exec("INSERT INTO User(id,username,passwordHash,displayName,updatedAt) VALUES('old-user','old-user','unused','旧用户',CURRENT_TIMESTAMP); INSERT INTO Conversation(id,ownerUserId,createRequestId,createInputHash,scope,updatedAt) VALUES('old-conversation','old-user','old-create','hash','WORKSPACE',CURRENT_TIMESTAMP); INSERT INTO ConversationTurn(id,conversationId,requestId,inputHash,inputJson,baseVersion,status) VALUES('old-turn','old-conversation','old-input','hash','{}',1,'ANSWERED');");
    db.exec(fs.readFileSync("prisma/migrations/20261028010000_conversation_research/migration.sql", "utf8"));
    expect(db.prepare("SELECT researchScopeVersion FROM Conversation WHERE id='old-conversation'").get()).toEqual({ researchScopeVersion: 1 });
    expect(db.prepare("SELECT status,sessionId,leaseToken FROM ConversationTurn WHERE id='old-turn'").get()).toEqual({ status: "ANSWERED", sessionId: null, leaseToken: null });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
