import { afterAll, beforeAll, expect, it } from "vitest";
import { continuityDatabase } from "./helpers/continuityDatabase";
const isolated = continuityDatabase("conversation-memory-use");
let db: typeof import("@/lib/db").db;
beforeAll(async () => { db = (await import("@/lib/db")).db; });
afterAll(async () => { await db.$disconnect(); void isolated; });

async function fixture() {
  const owner = await db.user.create({ data: { username: "memory-use-owner", displayName: "合成用户", passwordHash: "unused" } });
  const other = await db.user.create({ data: { username: "memory-use-other", displayName: "另一位合成用户", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "记忆使用投影", description: "", goal: "核对回答参考了哪些记忆", scenario: "RESEARCH",
    memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const claim = (data: { scopeType: string; projectId?: string; statement: string; status: string; kind: string; key: string }) => db.agentClaim.create({ data: {
    ownerUserId: owner.id, scopeType: data.scopeType, projectId: data.projectId ?? null, scopeKey: data.scopeType === "ACCOUNT" ? "account" : "project:" + data.projectId,
    originKey: data.key, originJson: {}, kind: data.kind, canonicalStatement: data.statement, conditionsJson: {}, statusProjection: data.status } });
  const active = await claim({ scopeType: "ACCOUNT", statement: "实验比较先核对数据划分", status: "ACTIVE", kind: "PREFERENCE", key: "a" });
  const deleted = await claim({ scopeType: "ACCOUNT", statement: "不应再出现的原文", status: "DELETED", kind: "PREFERENCE", key: "b" });
  const judgment = await claim({ scopeType: "PROJECT", projectId: project.id, statement: "基线结果可能来自旧划分", status: "REFUTED", kind: "HYPOTHESIS", key: "c" });
  await db.agentClaim.update({ where: { id: judgment.id }, data: { currentRevision: 2 } });
  const manifest = {
    personalMemoryReadSet: { items: [{ claimId: active.id, revision: 1, contentHash: "h" }, { claimId: deleted.id, revision: 1, contentHash: "h" }] },
    cognitiveReadSet: [{ claimId: judgment.id, projectId: project.id, revision: 1, validityHash: "v" }],
    experienceReadSet: [],
  };
  return { owner, other, manifest };
}

it("按当前状态展示本轮参考的记忆：删除不回显原文，之后修订会标出", async () => {
  const { readMemoryUse } = await import("@/lib/conversation/memoryUse");
  const { owner, other, manifest } = await fixture();
  const view = await readMemoryUse(owner.id, manifest);
  expect(view?.items).toEqual([
    expect.objectContaining({ kind: "PERSONAL", title: "实验比较先核对数据划分", stateLabel: "使用中", active: true, changedSince: false }),
    expect.objectContaining({ kind: "PERSONAL", title: "一条已删除的个人偏好", stateLabel: "已删除", active: false }),
    expect.objectContaining({ kind: "JUDGMENT", title: "基线结果可能来自旧划分", stateLabel: "发现反例", active: false, changedSince: true }),
  ]);
  expect(JSON.stringify(view)).not.toContain("不应再出现的原文");
  // 其他账号即使拿到同一读集也读不到任何条目
  expect(await readMemoryUse(other.id, manifest)).toBeNull();
  // 没有读集的旧轮次不返回该字段
  expect(await readMemoryUse(owner.id, {})).toBeNull();
});
