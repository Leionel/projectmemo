import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const { continuityDatabase } = await import("./helpers/continuityDatabase");
  Object.assign(process.env, { REPO_SENSING_ENABLED: "true" });
  return continuityDatabase("ux2-source-binding");
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createConnection, actOnConnection, actOnSignal, refreshConnection, listSignals, type FetchLike } from "@/lib/sensing/repoSource";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
let owner: string;
beforeAll(async () => { owner = (await db.user.create({ data: { username: crypto.randomUUID(), displayName: "来源测试", passwordHash: "fixture" } })).id; });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const fetcher: FetchLike = async () => ({ status: 200, etag: "fixture", body: [{ sha: "a".repeat(40), commit: { message: "候选资料", author: { name: "测试" } } }] });
async function fixture() {
  const p = await db.project.create({ data: { title: "来源隔离", goal: "核对", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: owner, role: "OWNER" } } } });
  const { connection: c } = await createConnection(owner, p.id, { repo: "fixture/repo", ref: "main", requestId: crypto.randomUUID() }, fetcher);
  const s = await db.externalSignal.findFirstOrThrow({ where: { connectionId: c.id } });
  return { p, c, s };
}
describe("UX-2A 来源准入与转存血缘", () => {
  it("撤权后的新采纳被拒绝，历史候选仍可见且不可采纳", async () => {
    const { p, c, s } = await fixture();
    await actOnConnection(owner, p.id, c.id, { action: "REVOKE", requestId: crypto.randomUUID() });
    await expect(actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
    expect(await db.capture.count({ where: { projectId: p.id } })).toBe(0);
    expect((await listSignals(owner, p.id)).signals[0]).toMatchObject({ canAdopt: false });
  });
  it("304 只改变观察版本，不撤销合法候选的授权", async () => {
    const { p, c, s } = await fixture();
    await refreshConnection(owner, p.id, c.id, async () => ({ status: 304, etag: "fixture", body: null }));
    const result = await actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId: crypto.randomUUID() });
    expect(result.captureId).toBeTruthy();
    expect(await sourceUse(owner, p.id, "capture:" + result.captureId)).toMatchObject({ state: "ALLOWED", independentEvidence: false });
  });
  it("原已提交请求在撤权后只回放原效果，不再创建 Capture", async () => {
    const { p, c, s } = await fixture(), command = { action: "ADOPT", requestId: crypto.randomUUID() };
    const first = await actOnSignal(owner, p.id, s.id, command);
    await actOnConnection(owner, p.id, c.id, { action: "REVOKE", requestId: crypto.randomUUID() });
    expect(await actOnSignal(owner, p.id, s.id, command)).toEqual(first);
    expect(await db.capture.count({ where: { projectId: p.id } })).toBe(1);
    expect(await sourceUse(owner, p.id, "capture:" + first.captureId)).toMatchObject({ state: "SUPPRESSED", reason: "SOURCE_PERMISSION_REVOKED" });
  });
  it("旧无绑定候选不能凭当前 ACTIVE 猜测授权", async () => {
    const { p, c } = await fixture();
    const legacy = await db.externalSignal.create({ data: { connectionId: c.id, projectId: p.id, ownerUserId: owner, sha: "b".repeat(40), title: "旧候选", authorName: "测试", url: "https://github.com/fixture/repo" } });
    await expect(actOnSignal(owner, p.id, legacy.id, { action: "ADOPT", requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "SIGNAL_SOURCE_RECHECK_REQUIRED" });
  });
  it("来源身份损坏或换连接的同 SHA 不能借新许可复活", async () => {
    const { p, c, s } = await fixture();
    await db.externalSignal.update({ where: { id: s.id }, data: { sourceBindingJson: { schemaVersion: 1, connectionId: "other", scopeHash: "other", observedRevision: c.revision } } });
    await expect(actOnSignal(owner, p.id, s.id, { action: "ADOPT", requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "SIGNAL_SOURCE_RECHECK_REQUIRED" });
  });
});
