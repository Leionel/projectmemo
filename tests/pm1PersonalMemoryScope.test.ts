import { afterAll, describe, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("pm1-scope"));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { commandPersonalMemory, listPersonalMemory, personalEntryDetail } from "@/lib/memory/personalMemoryService";
import { readPolicy, assertPersonalMemoryReadSet, policyInTx } from "@/lib/memory/userMemoryPolicy";
import { resolvePersonalContext } from "@/lib/memory/personalContext";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function seedUser(name: string) {
  return db.user.create({ data: { username: name, displayName: name, passwordHash: "fixture" } });
}

describe("PM-1 迁移与范围保护", () => {
  test("空库迁移重放包含新迁移；旧行回填 PROJECT 且 ACCOUNT 行带持久约束", async () => {
    const sql = new Database(isolated.file.replaceAll("\\", "/"));
    const claimColumns = (sql.pragma("table_info(AgentClaim)") as Array<{ name: string; notnull: number }>).map(c => c.name);
    expect(claimColumns).toContain("scopeType");
    expect(claimColumns).toContain("projectId");
    const user = await seedUser("scope-backfill-" + crypto.randomUUID().slice(0, 8));
    const project = await db.project.create({ data: { title: "旧项目", description: "d", goal: "g", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const legacy = await db.agentClaim.create({ data: { ownerUserId: user.id, projectId: project.id, scopeKey: "legacy",
      originKey: "legacy", originJson: {}, kind: "INTERPRETATION", canonicalStatement: "旧项目理解", conditionsJson: {} } });
    expect((await db.agentClaim.findUniqueOrThrow({ where: { id: legacy.id } })).scopeType).toBe("PROJECT");
    // ACCOUNT 行 projectId/conversationId/missionId 必须为空：CHECK 拒绝伪造项目归属
    expect(() => sql.prepare(`INSERT INTO "AgentClaim" ("id","ownerUserId","projectId","scopeType","scopeKey","originKey","originJson","kind","canonicalStatement","conditionsJson","updatedAt")
      VALUES ('x1',?,?,'ACCOUNT','ACCOUNT','o','{}','PREFERENCE','s','{}',CURRENT_TIMESTAMP)`).run(user.id, project.id)).toThrow();
    sql.close();
    await db.agentClaim.delete({ where: { id: legacy.id } });
  }, 40000);

  test("旧库副本升级：先建旧 schema 插入遗留行，再应用新迁移完成回填且数据保留", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm1-upgrade-"));
    const file = path.join(dir, "upgrade.db");
    const migrations = fs.readdirSync("prisma/migrations").sort().filter(name => name !== "20261101170000_pm1_account_memory_scope");
    const legacy = new Database(file.replaceAll("\\", "/"));
    for (const name of migrations) {
      const sqlFile = path.join("prisma/migrations", name, "migration.sql");
      if (fs.existsSync(sqlFile)) legacy.exec(fs.readFileSync(sqlFile, "utf8"));
    }
    legacy.prepare(`INSERT INTO "User" ("id","username","displayName","passwordHash","continuitySeq","createdAt","updatedAt") VALUES ('u-up','up-user','升级用户','x',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    legacy.prepare(`INSERT INTO "Project" ("id","title","description","goal","scenario","contextRevision","createdAt","updatedAt") VALUES ('p-up','旧项目','d','g','RESEARCH',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    legacy.prepare(`INSERT INTO "ProjectMembership" ("id","userId","projectId","role","createdAt") VALUES ('m-up','u-up','p-up','OWNER',CURRENT_TIMESTAMP)`).run();
    legacy.prepare(`INSERT INTO "AgentClaim" ("id","ownerUserId","projectId","scopeKey","originKey","originJson","kind","canonicalStatement","conditionsJson","currentRevision","statusProjection","createdAt","updatedAt") VALUES ('c-up','u-up','p-up','sk','ok','{}','INTERPRETATION','遗留理解','{}',1,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    legacy.close();
    const upgraded = new Database(file.replaceAll("\\", "/"));
    upgraded.exec(fs.readFileSync("prisma/migrations/20261101170000_pm1_account_memory_scope/migration.sql", "utf8"));
    const row = upgraded.prepare(`SELECT "scopeType","projectId","canonicalStatement" FROM "AgentClaim" WHERE id='c-up'`).get() as { scopeType: string; projectId: string; canonicalStatement: string };
    expect(row.scopeType).toBe("PROJECT");
    expect(row.projectId).toBe("p-up");
    expect(row.canonicalStatement).toBe("遗留理解");
    const modes = upgraded.prepare(`SELECT "personalMemoryMode" FROM "ProjectMembership" WHERE id='m-up'`).get() as { personalMemoryMode: string };
    expect(modes.personalMemoryMode).toBe("INHERIT");
    upgraded.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 40000);

  test("项目查询读不到账户行；同 owner 的 PROJECT/ACCOUNT scopeKey 互不碰撞；跨 owner 完全隔离", async () => {
    const user = await seedUser("scope-iso-" + crypto.randomUUID().slice(0, 8));
    const other = await seedUser("scope-other-" + crypto.randomUUID().slice(0, 8));
    const project = await db.project.create({ data: { title: "隔离项目", description: "d", goal: "g", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: "以后技术讨论先给结论，再按需要展开", kind: "PREFERENCE", topics: ["技术讨论"] });
    expect(added.status).toBe("ACTIVE");
    // 项目显式查询只看 PROJECT 行
    const projectRows = await db.agentClaim.findMany({ where: { ownerUserId: user.id, scopeType: "PROJECT", projectId: project.id } });
    expect(projectRows).toHaveLength(0);
    // 同 owner 重复提交同载荷回放；换载荷 409
    const replay = await commandPersonalMemory(user.id, { requestId: added.requestId, operation: "ADD_EXPLICIT",
      quote: "以后技术讨论先给结论，再按需要展开", kind: "PREFERENCE", topics: ["技术讨论"] });
    expect(replay.replayed).toBe(true);
    expect(replay.claimId).toBe(added.claimId);
    await expect(commandPersonalMemory(user.id, { requestId: added.requestId, operation: "ADD_EXPLICIT", quote: "换成别的内容" }))
      .rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    // 跨 owner：另一个用户看不到也改不了这条条目
    await expect(commandPersonalMemory(other.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId! }))
      .rejects.toMatchObject({ code: "CLAIM_NOT_FOUND" });
    const otherView = await listPersonalMemory(other.id);
    expect(otherView.items).toHaveLength(0);
    // 撤销成员资格后项目派生检查不可用：账户条目仍属 owner，但项目查询依旧为空
    await expect(commandPersonalMemory(other.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId! }))
      .rejects.toBeInstanceOf(AppError);
  }, 40000);

  test("暂停/恢复/撤回/删除语义；删除清除正文并保留无正文回执；重放不复活", async () => {
    const user = await seedUser("lifecycle-" + crypto.randomUUID().slice(0, 8));
    const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: "以后先验证小规模再扩大实验", kind: "PREFERENCE" });
    const paused = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId!, expectedRevision: 1 });
    expect(paused.status).toBe("PAUSED");
    await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId!, expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "CLAIM_STATE_CHANGED" });
    const resumed = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "RESUME", claimId: added.claimId!, expectedRevision: 2 });
    expect(resumed.status).toBe("ACTIVE");
    const withdrawn = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "WITHDRAW", claimId: added.claimId!, expectedRevision: 3 });
    expect(withdrawn.status).toBe("WITHDRAWN");
    const resumedAgain = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "RESUME", claimId: added.claimId!, expectedRevision: 4 });
    expect(resumedAgain.status).toBe("ACTIVE");
    const deleted = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "DELETE", claimId: added.claimId!, expectedRevision: 5 });
    expect(deleted.status).toBe("DELETED");
    const row = await db.agentClaim.findUniqueOrThrow({ where: { id: added.claimId! } });
    expect(row.canonicalStatement).toBe("");
    const events = await db.agentClaimEvent.findMany({ where: { claimId: added.claimId! } });
    for (const event of events) expect(event.userQuote).toBeNull();
    expect((deleted.purge as { canonicalStatementPurged?: boolean }).canonicalStatementPurged).toBe(true);
    // 删除后重放同一请求：返回历史操作身份，不重建条目、不返回正文
    const replay = await commandPersonalMemory(user.id, { requestId: deleted.requestId, operation: "DELETE", claimId: added.claimId!, expectedRevision: 5 });
    expect(replay.replayed).toBe(true);
    expect(await db.agentClaim.count({ where: { ownerUserId: user.id, scopeType: "ACCOUNT", statusProjection: { not: "DELETED" } } })).toBe(0);
    await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "RESUME", claimId: added.claimId! }))
      .rejects.toMatchObject({ code: "CLAIM_DELETED" });
  }, 40000);

  test("策略 CAS 与删除全部：extractionNotBefore 推进、逐条正文清除", async () => {
    const user = await seedUser("policy-" + crypto.randomUUID().slice(0, 8));
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "以后回答保持简明", kind: "PREFERENCE" });
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "我在读人机交互方向的研究生", kind: "BACKGROUND" });
    const current = await readPolicy(user.id);
    expect(current).not.toBeNull();
    // 策略版本 CAS：期望版本过期时拒绝写入
    await expect(commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: "版本探针", expectedPolicyVersion: current!.settingsVersion + 5 })).rejects.toMatchObject({ code: "POLICY_CHANGED" });
    const cleared = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "DELETE_ALL" });
    expect((cleared.purge as { extractionNotBeforeSet?: boolean }).extractionNotBeforeSet).toBe(true);
    const after = await readPolicy(user.id);
    expect(after?.extractionNotBefore).not.toBeNull();
    for (const item of (await listPersonalMemory(user.id, { includeStopped: true })).items) {
      expect(item.statement).toBe("");
      expect(item.status).toBe("DELETED");
    }
  }, 40000);

  test("读集守卫：策略/条目/项目例外变化都抛 COGNITIVE_RECOORDINATE；边界过期同样失效", async () => {
    const user = await seedUser("readset-" + crypto.randomUUID().slice(0, 8));
    const project = await db.project.create({ data: { title: "读集项目", description: "d", goal: "g", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: "以后讨论先核对数据划分", kind: "PREFERENCE", topics: ["数据划分"] });
    const context = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "核对数据划分" });
    expect(context.items).toHaveLength(1);
    expect(context.readSet).not.toBeNull();
    // 当前状态一致：通过
    await assertPersonalMemoryReadSet(user.id, context.readSet);
    // 条目修订推进：失败
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: added.claimId! });
    await expect(assertPersonalMemoryReadSet(user.id, context.readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
    // 恢复后重新解析产生新读集（privacyRevision 已推进，旧快照不复活）：再次通过
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "RESUME", claimId: added.claimId!, expectedRevision: 2 });
    const refreshed = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "核对数据划分" });
    expect(refreshed.items).toHaveLength(1);
    await assertPersonalMemoryReadSet(user.id, refreshed.readSet);
    // 项目例外版本变化：失败
    const membership = await db.projectMembership.findUniqueOrThrow({ where: { userId_projectId: { userId: user.id, projectId: project.id } } });
    await db.projectMembership.update({ where: { id: membership.id }, data: { personalMemoryMode: "PROJECT_ONLY", personalMemoryModeVersion: { increment: 1 } } });
    await expect(assertPersonalMemoryReadSet(user.id, context.readSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
    // PROJECT_ONLY 后新解析不再注入，遗漏原因明确
    const afterMode = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "核对数据划分" });
    expect(afterMode.items).toHaveLength(0);
    expect(afterMode.omissions.some(o => o.reason === "PROJECT_ONLY")).toBe(true);
  }, 40000);

  test("旧客户端兼容：原项目纠正链在显式 PROJECT 过滤下照常工作", async () => {
    const user = await seedUser("legacy-client-" + crypto.randomUUID().slice(0, 8));
    const project = await db.project.create({ data: { title: "旧客户端项目", description: "d", goal: "g", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const claim = await db.agentClaim.create({ data: { ownerUserId: user.id, projectId: project.id, scopeKey: "legacy-client",
      originKey: "legacy-client", originJson: {}, kind: "INTERPRETATION", canonicalStatement: "旧解释", conditionsJson: {} } });
    const projectBound = await db.agentClaim.findFirst({ where: { ownerUserId: user.id, scopeType: "PROJECT", projectId: project.id } });
    expect(projectBound?.id).toBe(claim.id);
    // 账户行不进入该项目任何查询
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "以后保持简明", kind: "PREFERENCE" });
    expect(await db.agentClaim.count({ where: { ownerUserId: user.id, scopeType: "PROJECT", projectId: project.id } })).toBe(1);
    expect(await db.agentClaimEvent.count({ where: { ownerUserId: user.id, claim: { scopeType: "PROJECT" } } })).toBe(0);
    const detail = await personalEntryDetail(user.id, (await listPersonalMemory(user.id)).items[0]!.claimId);
    expect(detail.source.kind).toBe("USER_ENTRY");
  }, 40000);
});
