import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct9a-"));
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"), LLM_MODE: "mock",
    FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", FOCUS_WEB_ENABLED: "true", BROWSER_READ_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new DB(path.join(dir, "test.sqlite"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, appendConversationMessage } from "@/lib/conversation/service";
import { submitConversationTurn, stopConversationTurn } from "@/lib/conversation/turnService";
import { updateResearchScope, validateWebSource } from "@/lib/conversation/researchScope";
import { registerUserUrls, readConversationResearchTool } from "@/lib/conversation/researchTools";
import { emptyBlocks, record } from "@/lib/conversation/repository";
import type { BrowserObservation, BrowserReader, BrowserReadRequest } from "@/lib/browser/contracts";

const url = "https://arxiv.org/abs/2601.00001";
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolation.dir, { recursive: true, force: true }); });

const observation = (overrides: Partial<BrowserObservation> = {}): BrowserObservation => {
  const text = overrides.visibleText ?? "动态正文：公开方法要求同条件验证。";
  return { status: "RENDERED", requestedUrl: url, finalUrl: url, title: "公开方法", observedAt: new Date().toISOString(), renderMs: 120,
    readyState: "complete", mode: "READ_VISIBLE", visibleText: text,
    headings: [{ level: 2, text: "公开方法" }],
    locator: { selector: "body", headingPath: ["公开方法"], quote: text.slice(0, 240), start: 0, end: Math.min(240, text.length), textHash: createHash("sha256").update(text).digest("hex") },
    coverage: { complete: true, visibleCharacters: text.length, totalCharacters: text.length, truncated: false, scrolls: 0, pages: 1, requests: 3, blockedRequests: 1, bytes: 1200 },
    screenshotHash: "a".repeat(64), failure: null, ...overrides };
};
const fakeReader = (impl?: (request: BrowserReadRequest) => Promise<BrowserObservation>) => {
  const read = vi.fn(impl ?? (async () => observation()));
  return { name: "fixture-browser", read } as BrowserReader & { read: typeof read };
};
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "浏览器隔离", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "隔离浏览器项目", description: "CT9A_SYNTHETIC_ONLY", goal: "比较公开方法，不把渲染片段当项目实测", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const c = await createConversation(actor, { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: project.id });
  const input = { requestId: "original", expectedVersion: 1, message: "请读取这份公开资料 " + url, projectId: project.id };
  const turn = await submitConversationTurn(actor, c.id, input, undefined, { defer: true });
  const [original] = await registerUserUrls(actor, c.id, turn.turnId, project.id, input.message);
  return { actor, project, id: c.id, turnId: turn.turnId, original };
}
const call = (projectId: string, sourceId: string, revision: string, extra: object = {}) => ({ tool: "browser_read" as const, projectId, sourceId, revision,
  scopeRevision: 1, mode: "READ_VISIBLE" as const, scrolls: 0, ...extra });

describe("CT-9A Conversation 隔离浏览器读取", () => {
  it("真实浏览器观察写入原来源与原操作账本，重复步骤回放不再启动", async () => {
    const f = await fixture(), browser = fakeReader();
    const first = await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-1", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser);
    const source = first.sources[0];
    expect(browser.read).toHaveBeenCalledTimes(1);
    expect(browser.read.mock.calls[0][0]).toMatchObject({ url, allowedHosts: [], mode: "READ_VISIBLE", scrolls: 0 });
    expect(source).toMatchObject({ knowledgeClass: "EXTERNAL_REFERENCE", temporalState: "UNKNOWN",
      external: { readLevel: "BROWSER_RENDER", retrievalMethod: "ISOLATED_BROWSER", resolvedUrl: url, browser: { renderer: "ISOLATED_BROWSER", status: "RENDERED", coverage: { complete: true, requests: 3, blockedRequests: 1 } } } });
    expect(source.excerpt).toContain("同条件验证");
    await validateWebSource(f.actor, source);
    const second = await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-1", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser);
    expect(browser.read).toHaveBeenCalledTimes(1); expect(second.sources).toEqual(first.sources);
    const op = record(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).operations)["browser-1"];
    expect(op).toMatchObject({ kind: "BROWSER_READ", status: "SUCCEEDED", result: { coverage: { requests: 3 } } });
  });
  it("模型不能对未定位链接启动浏览器，Fetch 已足够时零浏览器调用", async () => {
    const f = await fixture(), browser = fakeReader(), provider = { name: "fixture-fetch", search: vi.fn(async () => []), fetchPage: vi.fn(async () => ({ title: "公开方法", content: "正文已足够回答。" })) };
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "bad", { ...call(f.project.id, "https://example.org/x", "fake") }, provider, browser)).rejects.toMatchObject({ code: "SOURCE_NOT_OBSERVED" });
    const fetched = await readConversationResearchTool(f.actor, f.id, f.turnId, "fetch-1", { tool: "web_fetch", projectId: f.project.id, sourceId: f.original.sourceId, scopeRevision: 1 }, provider, browser);
    expect(fetched.sources[0].external?.readLevel).toBe("FETCH_EXCERPT");
    expect(browser.read).not.toHaveBeenCalled();
  });
  it("部分渲染保留实际片段但标记覆盖不完整", async () => {
    const f = await fixture(), browser = fakeReader(async () => observation({ status: "PARTIAL", coverage: { ...observation().coverage, complete: false }, failure: { code: "BROWSER_PARTIAL_RENDER", message: "页面仍在异步加载" }, visibleText: "已显示部分正文" }));
    const result = await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-partial", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser);
    expect(result.sources[0].excerpt).toBe("已显示部分正文");
    expect(result.sources[0].external?.browser?.coverage.complete).toBe(false);
    expect(result.sources[0].external?.browser?.failureCode).toBe("BROWSER_PARTIAL_RENDER");
    expect(result.coverage.complete).toBe(false);
  });
  it("被策略阻断的导航不生成来源", async () => {
    const f = await fixture(), browser = fakeReader(async () => observation({ status: "BLOCKED", visibleText: "", failure: { code: "BROWSER_URL_BLOCKED", message: "页面导航或子请求超出公开读取策略" } }));
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "browser-blocked", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser)).rejects.toMatchObject({ code: "BROWSER_URL_BLOCKED" });
    const saved = record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).webSources as Array<{ sourceId: string }>;
    expect(saved.map(source => source.sourceId)).toEqual([f.original.sourceId]);
  });
  it("浏览器结果未知不自动重发，保留原operation预占", async () => {
    const f = await fixture(), browser = fakeReader(async () => { throw new TypeError("browser crashed"); });
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "browser-unknown", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser)).rejects.toMatchObject({ code: "EXTERNAL_RESULT_UNKNOWN" });
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "browser-unknown", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser)).rejects.toMatchObject({ code: "EXTERNAL_RESULT_UNKNOWN" });
    expect(browser.read).toHaveBeenCalledTimes(1);
    const op = record(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).operations)["browser-unknown"];
    expect(op).toMatchObject({ status: "UNKNOWN", reservedMicrousd: 750, billedMicrousd: null });
  });
  it("本轮最多两次不同输入的浏览器读取，重复步骤回放不计新派发", async () => {
    const f = await fixture(), browser = fakeReader();
    await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-1", call(f.project.id, f.original.sourceId, f.original.revision, { scrolls: 0 }), undefined, browser);
    await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-2", call(f.project.id, f.original.sourceId, f.original.revision, { scrolls: 1 }), undefined, browser);
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "browser-3", call(f.project.id, f.original.sourceId, f.original.revision, { scrolls: 2 }), undefined, browser)).rejects.toMatchObject({ code: "BROWSER_TURN_LIMIT" });
    expect(browser.read).toHaveBeenCalledTimes(2);
  });
  it("撤权后原浏览器来源立即不可再消费", async () => {
    const f = await fixture(), browser = fakeReader();
    const result = await readConversationResearchTool(f.actor, f.id, f.turnId, "browser-1", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser);
    await updateResearchScope(f.actor, f.id, { expectedRevision: 1, projectId: f.project.id, scope: { enabled: false } });
    await expect(validateWebSource(f.actor, result.sources[0])).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    await db.$transaction(tx => appendConversationMessage(tx, f.id, f.actor.userId, "ASSISTANT", "原回答", { ...emptyBlocks(), sources: [result.sources[0]] }));
    const { readConversation } = await import("@/lib/conversation/service");
    expect((await readConversation(f.actor, f.id)).messages.at(-1)?.restricted).toBe(true);
  });
  it("其他项目或其他账号不能借用已观察网页", async () => {
    const a = await fixture(), b = await fixture(), browser = fakeReader();
    await expect(readConversationResearchTool(b.actor, b.id, b.turnId, "borrow", call(b.project.id, a.original.sourceId, a.original.revision), undefined, browser)).rejects.toMatchObject({ code: "SOURCE_NOT_OBSERVED" });
    expect(browser.read).not.toHaveBeenCalled();
  });
  it("关闭能力时不向模型开放，也不伪造浏览器成功", async () => {
    const f = await fixture(), browser = fakeReader();
    vi.stubEnv("BROWSER_READ_ENABLED", "false");
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "browser-off", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser)).rejects.toMatchObject({ code: "BROWSER_UNAVAILABLE" });
    expect(browser.read).not.toHaveBeenCalled();
  });
  it("停止请求中止在途浏览器观察，不发布迟到内容", async () => {
    const f = await fixture();
    let release: (() => void) | undefined;
    const browser = fakeReader(async () => { await new Promise<void>(resolve => { release = resolve; }); return observation({ visibleText: "迟到正文" }); });
    const running = readConversationResearchTool(f.actor, f.id, f.turnId, "browser-late", call(f.project.id, f.original.sourceId, f.original.revision), undefined, browser);
    await stopConversationTurn(f.actor, f.id, f.turnId);
    // The polling abort is not instant; settle the fake so the abort path can finish instead of hanging.
    setTimeout(() => release?.(), 800);
    await expect(running).rejects.toMatchObject({ code: expect.stringMatching(/^TURN_(STOP_REQUESTED|CHANGED)$/) });
    const saved = record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).webSources as Array<{ sourceId: string }>;
    expect(saved.map(source => source.sourceId)).toEqual([f.original.sourceId]);
  });
});
