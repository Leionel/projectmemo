import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pr6-"));
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"), LLM_MODE: "mock", FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", FOCUS_WEB_ENABLED: "true", FOCUS_ASYNC_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new DB(path.join(dir, "test.sqlite"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation, appendConversationMessage } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { readResearchScope, updateResearchScope, validateWebSource } from "@/lib/conversation/researchScope";
import { registerUserUrls, safeResearchUrl, userUrls, readConversationResearchTool } from "@/lib/conversation/researchTools";
import { mutateTurn, turnOperation, withTurnLease } from "@/lib/conversation/turnRuntime";
import { runConversationTurn } from "@/lib/conversation/turnWorker";
import { emptyBlocks, record } from "@/lib/conversation/repository";
import { resolveFileGuides } from "@/lib/conversation/fileGuides";
import { searchResponseSchema } from "@/lib/research/contracts";
import { researchCoverageSchema } from "@/lib/types/conversationResearch";
import { adoptResearchSummary } from "@/lib/conversation/researchSummary";
import { listConversationAnchors, commandConversationAnchor, syncConversationAnchors } from "@/lib/conversation/anchorService";
import { bindResearchCoverage } from "@/lib/conversation/researchCoverage";
import { stopConversationTurn } from "@/lib/conversation/turnService";
import { readWorkspaceTool } from "@/lib/conversation/toolAdapter";
import { prepareExperienceDraft } from "@/lib/conversation/presentationRuntime";
import { json } from "@/lib/mission/contracts";

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolation.dir, { recursive: true, force: true }); });
const url = "https://arxiv.org/abs/2601.00001";
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "联网隔离", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "合成公开研究项目", description: "PR6_SYNTHETIC_ONLY", goal: "比较同条件方法，不把公开指标当实测", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const c = await createConversation(actor, { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: project.id });
  const input = { requestId: "original", expectedVersion: 1, message: "请读取这份公开资料 " + url, projectId: project.id };
  const turn = await submitConversationTurn(actor, c.id, input, undefined, { defer: true });
  return { actor, project, id: c.id, turnId: turn.turnId, input };
}
const provider = () => ({ name: "HTTP_STUB_NO_PAID_CALLS", search: vi.fn(async () => []), fetchPage: vi.fn(async () => ({ title: "公开方法", content: "论文仅在公开数据集报告指标；当前项目尚未完成同条件验证。" })) });

describe("PR6 原会话联网边界", () => {
  it("服务端登记用户原链接，不需要搜索或额外 Mission", async () => {
    const f = await fixture(), missionCount = await db.agentMission.count();
    const rows = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    expect(rows).toHaveLength(1); expect(rows[0].external).toMatchObject({ origin: "USER_PROVIDED", readLevel: "UNAVAILABLE" });
    expect(await db.agentMission.count()).toBe(missionCount);
    expect(userUrls("看看 " + url)).toEqual([url]);
    expect(() => userUrls("没有链接", [url])).toThrow();
  });
  it("拒绝私网地址、带密钥链接及越出授权域名", () => {
    for (const target of ["http://localhost/a", "https://127.0.0.1/a", "https://docs.internal/a", "https://x.org/a?token=secret", "https://x.org/private/x"])
      expect(() => safeResearchUrl(target)).toThrow();
    expect(() => safeResearchUrl(url, ["example.org"])).toThrow();
  });
  it("同原步骤 Fetch 仅请求一次，回读保留原时间和片段", async () => {
    const f = await fixture(), p = provider(), [original] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    const call = { tool: "web_fetch" as const, projectId: f.project.id, scopeRevision: 1, sourceId: original.sourceId, revision: original.revision };
    const a = await readConversationResearchTool(f.actor, f.id, f.turnId, "fetch-1", call, p);
    const b = await readConversationResearchTool(f.actor, f.id, f.turnId, "fetch-1", call, p);
    expect(p.fetchPage).toHaveBeenCalledTimes(1); expect(a.sources).toEqual(b.sources);
    expect(a.sources[0]).toMatchObject({ knowledgeClass: "EXTERNAL_REFERENCE", temporalState: "UNKNOWN", external: { readLevel: "FETCH_EXCERPT", resolvedUrl: null } });
    const guides = await resolveFileGuides(a.sources); expect(guides[0].kind).toBe("WEB"); expect(guides[0].href).toContain(f.id);
  });
  it("模型不能用任意 sourceId 取得 URL 抓取权", async () => {
    const f = await fixture(), p = provider();
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "bad", { tool: "web_fetch", projectId: f.project.id, scopeRevision: 1, sourceId: "https://example.org", revision: "fake" }, p)).rejects.toMatchObject({ code: "SOURCE_NOT_OBSERVED" });
    expect(p.fetchPage).not.toHaveBeenCalled();
  });
  it("公开授权修改使原来源不可用，其他 owner 不能读取", async () => {
    const f = await fixture(), other = await fixture(), [original] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    await expect(validateWebSource(other.actor, original)).rejects.toMatchObject({ status: 404 });
    await updateResearchScope(f.actor, f.id, { expectedRevision: 1, projectId: f.project.id, scope: { enabled: false } });
    await expect(validateWebSource(f.actor, original)).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    expect((await readResearchScope(f.actor, f.id)).revision).toBe(2);
  });
  it("撤权发生在 Fetch 返回前，迟到结果不成为可用来源", async () => {
    const f = await fixture(), [original] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    const p = provider(); p.fetchPage.mockImplementation(async () => {
      await updateResearchScope(f.actor, f.id, { expectedRevision: 1, projectId: f.project.id, scope: { enabled: false } });
      return { title: "迟到", content: "不能发布" };
    });
    await expect(readConversationResearchTool(f.actor, f.id, f.turnId, "late", { tool: "web_fetch", projectId: f.project.id, scopeRevision: 1, sourceId: original.sourceId, revision: original.revision }, p)).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    const saved = record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).webSources as unknown[];
    expect(saved).toHaveLength(1);
  });
  it("网络结果 UNKNOWN 保留预占，重复派发不会再次调用", async () => {
    const f = await fixture(), run = vi.fn(async () => { throw new TypeError("socket interrupted"); });
    await expect(turnOperation(f.actor, f.id, f.turnId, "uncertain", "WEB_FETCH", { url }, run, true)).rejects.toThrow();
    await expect(turnOperation(f.actor, f.id, f.turnId, "uncertain", "WEB_FETCH", { url }, run, true)).rejects.toMatchObject({ code: "EXTERNAL_RESULT_UNKNOWN" });
    expect(run).toHaveBeenCalledTimes(1);
    const ops = record(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).operations);
    expect(ops.uncertain).toMatchObject({ status: "UNKNOWN", reservedMicrousd: 750, billedMicrousd: null });
  });
  it("四次外部请求是总上限，不是固定执行顺序", async () => {
    const f = await fixture(), run = vi.fn(async () => []);
    for (let i = 0; i < 4; i++) await turnOperation(f.actor, f.id, f.turnId, "search-" + i, "WEB_SEARCH", { i }, run, true);
    await expect(turnOperation(f.actor, f.id, f.turnId, "fifth", "WEB_SEARCH", {}, run, true)).rejects.toMatchObject({ code: "EXTERNAL_BUDGET_EXHAUSTED" });
    expect(run).toHaveBeenCalledTimes(4);
  });
  it("原 lease 被替换后，旧推进者不能提交检查点", async () => {
    const f = await fixture(); await db.conversationTurn.update({ where: { id: f.turnId }, data: { leaseToken: "new", leaseUntil: new Date(Date.now() + 60000) } });
    await expect(withTurnLease(f.turnId, "old", () => mutateTurn(f.actor, f.id, f.turnId, m => ({ ...m, forbidden: true })))).rejects.toMatchObject({ code: "TURN_LEASE_LOST" });
    await withTurnLease(f.turnId, "new", () => mutateTurn(f.actor, f.id, f.turnId, m => ({ ...m, checkpoint: "saved" })));
    expect(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson).forbidden).toBeUndefined();
  });
  it("HTTP 接受与原 turn 推进分离，重试不会重复用户消息", async () => {
    const f = await fixture();
    const again = await submitConversationTurn(f.actor, f.id, f.input, undefined, { defer: true });
    expect(again.turnId).toBe(f.turnId);
    // Isolate scheduling from preceding intentionally interrupted test turns.
    await db.conversationTurn.updateMany({ where: { id: { not: f.turnId }, status: { in: ["OBSERVING", "GENERATING"] } }, data: { status: "FAILED" } });
    expect(await runConversationTurn()).toBe(true);
    expect((await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).status).toBe("ANSWERED");
    expect((await readConversation(f.actor, f.id)).messages.filter(m => m.role === "USER")).toHaveLength(1);
  });
  it("旧网页历史撤权后受到限制，不能从保存的回答绕过", async () => {
    const f = await fixture(), [s] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    await db.$transaction(tx => appendConversationMessage(tx, f.id, f.actor.userId, "ASSISTANT", "原回答", { ...emptyBlocks(), sources: [s], observedProjectIds: [f.project.id] }));
    await updateResearchScope(f.actor, f.id, { expectedRevision: 1, projectId: f.project.id, scope: { enabled: false } });
    expect((await readConversation(f.actor, f.id)).messages.at(-1)?.restricted).toBe(true);
  });
  it("保留搜索长摘要和内联正文；覆盖合同有界", () => {
    const hit = searchResponseSchema.parse({ results: [{ title: "x", url, snippet: "短", summary: "长", content: "原文", authority: 3, rerank_score: 2 }] }).results[0];
    expect(hit.summary).toBe("长"); expect(hit.content).toBe("原文");
    expect(researchCoverageSchema.safeParse({ facets: [] }).success).toBe(false);
  });
  it("排队中可以停止，无 worker 时也不会一直等待", async () => {
    const f = await fixture(); await stopConversationTurn(f.actor, f.id, f.turnId);
    const view = await readConversation(f.actor, f.id); expect(view.activeTurn).toBeNull(); expect(view.latestTurn?.status).toBe("CANCELLED");
  });
  it("已读网页可以定向回读原快照，不冒充再次联网或升级范围", async () => {
    const f = await fixture(), p = provider(), [original] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    const result = await readConversationResearchTool(f.actor, f.id, f.turnId, 'cached-read', { tool: 'web_fetch', projectId: f.project.id, scopeRevision: 1, sourceId: original.sourceId }, p);
    const s = result.sources[0];
    const read = await readWorkspaceTool(f.actor, { tool: 'read_project_material', projectId: f.project.id, sourceId: s.sourceId, revision: s.revision }, [f.project.id], result.discovered, [s]);
    expect(read.sources[0]).toEqual(s); expect(p.fetchPage).toHaveBeenCalledTimes(1);
  });
  it("原待确认提案恢复不重复创建草稿，变化输入不能复用", async () => {
    const f = await fixture(), action = { projectId: f.project.id, title: '先做同条件验证', description: '合成测试', priority: 3 };
    const first = await prepareExperienceDraft(f.actor, f.id, f.turnId, action, 'fixture');
    const again = await prepareExperienceDraft(f.actor, f.id, f.turnId, action, 'fixture');
    expect(again.runId).toBe(first.runId); expect(again.proposal?.executionId).toBe(first.proposal?.executionId);
    await expect(prepareExperienceDraft(f.actor, f.id, f.turnId, { ...action, title: '不同提案' }, 'fixture')).rejects.toMatchObject({ code: 'DRAFT_CHECKPOINT_CHANGED' });
  });
  it("原授权仓库入口复用同会话，关注去重、忽略不误报、撤销限制历史", async () => {
    const f = await fixture();
    const connection = await db.sourceConnection.create({ data: { projectId: f.project.id, ownerUserId: f.actor.userId, repo: "vercel/ai", ref: "main" } });
    const add = (sha: string) => db.externalSignal.create({ data: { projectId: f.project.id, ownerUserId: f.actor.userId, connectionId: connection.id, sha: sha.repeat(40), title: "合成提交线索", authorName: "fixture", url: "https://github.com/vercel/ai/commit/" + sha.repeat(40) } });
    const old = await add("a");
    const entry = { kind: "SOURCE_OBSERVATION", projectId: f.project.id, id: connection.id };
    const a = await createConversation(f.actor, { requestId: "entry-a", scope: "PROJECT", projectId: f.project.id, entry });
    const b = await createConversation(f.actor, { requestId: "entry-b", scope: "PROJECT", projectId: f.project.id, entry });
    expect(a.id).toBe(b.id);
    const anchor = (await listConversationAnchors(f.actor, a.id)).anchors[0];
    await commandConversationAnchor(f.actor, a.id, anchor.id, { requestId: "follow", expectedVersion: anchor.version, action: "FOLLOW" });
    const before = (await readConversation(f.actor, a.id)).messages.length;
    await add("b"); await syncConversationAnchors(f.actor, a.id); const after = (await readConversation(f.actor, a.id)).messages.length;
    expect(after).toBe(before + 1); await syncConversationAnchors(f.actor, a.id); expect((await readConversation(f.actor, a.id)).messages.length).toBe(after);
    await db.externalSignal.update({ where: { id: old.id }, data: { status: "DISMISSED" } }); await syncConversationAnchors(f.actor, a.id);
    expect((await readConversation(f.actor, a.id)).messages.length).toBe(after);
    await db.sourceConnection.update({ where: { id: connection.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    expect((await readConversation(f.actor, a.id)).messages.every(m => m.restricted)).toBe(true);
    expect(await db.capture.count({ where: { projectId: f.project.id } })).toBe(0);
  });
  it("覆盖不能用摘要证明项目结果，生效状态不能由抓取日期推断", async () => {
    const f = await fixture(), [s] = await registerUserUrls(f.actor, f.id, f.turnId, f.project.id, f.input.message);
    s.excerpt = "适用 2026 届，自 2026-10-01 至 2026-10-31。"; s.readScope = "SUMMARY";
    const coverage = researchCoverageSchema.parse({ schemaVersion: 1, questionHash: "test", scopeRevision: 1, asOf: "2026-10-27", facets: [{ id: "rule", question: "项目完成了吗", kind: "PROJECT_FACT", coverage: "READ_SUFFICIENT", sourceIds: [s.sourceId], missing: [], conflicts: [] }],
      temporalAssessments: [{ sourceId: s.sourceId, quote: s.excerpt, edition: "2026", effectiveFrom: "2026-10-01", effectiveUntil: "2026-10-31", status: "CURRENT" }], nextDecision: "ANSWER_CONDITIONALLY", expectedDecisionChange: "确认适用期但不推断项目完成", stopReason: null });
    const bound = bindResearchCoverage(coverage, [s]); expect(bound.facets[0].coverage).not.toBe("READ_SUFFICIENT"); expect(bound.temporalAssessments?.[0].status).toBe("CURRENT");
    bound.temporalAssessments![0].effectiveFrom = null; bound.temporalAssessments![0].effectiveUntil = null;
    expect(bindResearchCoverage(bound, [s]).temporalAssessments?.[0].status).toBe("UNKNOWN");
    s.excerpt = '2026-02-30 至 2026-03-01'; bound.temporalAssessments![0] = { sourceId:s.id, quote:s.excerpt, edition:null, effectiveFrom:'2026-02-30', effectiveUntil:'2026-03-01', status:'CURRENT' };
    expect(bindResearchCoverage(bound,[s]).temporalAssessments?.[0].effectiveFrom).toBeNull();
    s.excerpt = '2026-11-01 至 2026-10-01'; bound.temporalAssessments![0] = { sourceId:s.id, quote:s.excerpt, edition:null, effectiveFrom:'2026-11-01', effectiveUntil:'2026-10-01', status:'CURRENT' };
    expect(bindResearchCoverage(bound,[s]).temporalAssessments?.[0].status).toBe('CONFLICTED');
  });
  it("原 HTTP 适配器与 Focus 完成用户 URL→读取→引用→确认归入→重放", async () => {
    const f = await fixture();
    await db.conversationTurn.update({ where: { id: f.turnId }, data: { status: "FAILED" } });
    await db.conversation.update({ where: { id: f.id }, data: { activeTurnId: null } });
    vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_PROVIDER", "deepseek"); vi.stubEnv("LLM_API_KEY", "fixture-no-paid-key");
    const stages: string[] = [];
    const http = vi.fn(async (target: unknown, init?: RequestInit) => {
      if (String(target).endsWith("/v1/tools/fetch")) return new Response(JSON.stringify({ title: "官方论文", content: "本论文只报告公开数据集结果，不能证明用户项目已达到该指标。" }), { headers: { "Content-Type": "application/json" } });
      const body = JSON.parse(String(init?.body)), stage = body.messages[0].content.match(/^任务 (\S+)/)?.[1]; stages.push(stage);
      const data = JSON.parse(body.messages[1].content).data;
      let output: unknown;
      if (stage === "focus.route.v2") output = { intent: "ANSWER", projectIds: [f.project.id], query: "公开论文", investigate: true, informationNeeds: ["核对正文"] };
      else if (stage === "focus.investigate.v1") {
        const fetched = data.sources.find((s: { external?: { readLevel: string } }) => s.external?.readLevel === "FETCH_EXCERPT");
        const original = data.sources.find((s: { external?: { readLevel: string } }) => s.external?.readLevel === "UNAVAILABLE");
        output = { goalAssessments: [{ projectId: f.project.id, goalQuote: f.project.goal, criteria: [{ requirement: f.project.goal, state: "UNKNOWN", explanation: "公开指标不等于项目实测", observations: [] }], blockers: [], keyUnknowns: ["项目实测"], nextInformationNeed: "核对正文" }],
          decision: fetched ? { decision: "ANSWER_NOW", reason: "已读片段足够解释边界" } : { decision: "READ_EXISTING", informationNeed: "核对正文", expectedObservation: "读到原论文的适用条件", call: { tool: "web_fetch", projectId: f.project.id, scopeRevision: 1, sourceId: original.sourceId, revision: original.revision } } };
      } else if (stage === "focus.answer.v2") {
        const s = data.sources.find((s: { external?: { readLevel: string } }) => s.external?.readLevel === "FETCH_EXCERPT");
        output = { advice: "该公开结果不能直接当作项目验证。【" + (data.sources.indexOf(s) + 1) + "】", recommendedProjectId: f.project.id, observations: [{ sourceId: s.id, quote: s.excerpt }], priorities: [], action: null };
      } else if (stage === "focus.ui_plan.v1") output = { schemaVersion: 2, intent: "EXPLAIN", primaryIntent: "EXPLAIN", composition: [{ blockKey: "answer", emphasis: "primary", semanticType: "prose", text: "公开结果需经本项目验证。", dataRefs: [] }] };
      else throw new Error("Unexpected model stage " + stage);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 50, completion_tokens: 50 } }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", http);
    const before = await readConversation(f.actor, f.id);
    const result = await submitConversationTurn(f.actor, f.id, { ...f.input, requestId: "real-pipeline", expectedVersion: before.version, llmContextApproved: true });
    const view = await readConversation(f.actor, f.id), message = view.messages.at(-1)!;
    expect(result.status).toBe("ANSWERED"); expect(message.sources.some(s => s.external?.readLevel === "FETCH_EXCERPT")).toBe(true);
    expect(message.fileGuides?.some(g => g.kind === "WEB" && !!g.quote)).toBe(true);
    expect(http.mock.calls.filter(c => String(c[0]).endsWith("/v1/tools/fetch"))).toHaveLength(1);
    expect(stages.filter(s => s === "focus.investigate.v1")).toHaveLength(2);
    const preview = await adoptResearchSummary(f.actor, f.id, message.id, { action: "PREVIEW", expectedConversationVersion: view.version });
    const first = await adoptResearchSummary(f.actor, f.id, message.id, { action: "CONFIRM", expectedConversationVersion: view.version, previewHash: preview.previewHash });
    const replay = await adoptResearchSummary(f.actor, f.id, message.id, { action: "CONFIRM", expectedConversationVersion: view.version, previewHash: preview.previewHash });
    expect(first.artifactId).toBe(replay.artifactId); expect(await db.generatedArtifact.count({ where: { projectId: f.project.id } })).toBe(1);
    const originalTurn = await db.conversationTurn.findUniqueOrThrow({where:{id:result.turnId}});
    const manifest = record(originalTurn.readManifestJson);
    const events = manifest.progressEvents as Array<{seq:number}>;
    expect(events.length).toBeGreaterThan(2); expect(events.map(e=>e.seq)).toEqual([...new Set(events.map(e=>e.seq))].sort((a,b)=>a-b));
    await db.conversationTurn.update({where:{id:originalTurn.id},data:{readManifestJson:json({...manifest,researchSummaryReceipts:{},researchSummaryPreviews:{}})}});
    await expect(adoptResearchSummary(f.actor,f.id,message.id,{action:'CONFIRM',expectedConversationVersion:view.version,previewHash:preview.previewHash})).rejects.toMatchObject({code:'SUMMARY_PREVIEW_REQUIRED'});
    await updateResearchScope(f.actor,f.id,{expectedRevision:1,projectId:f.project.id,scope:{enabled:false}});
    await expect(adoptResearchSummary(f.actor,f.id,message.id,{action:'CONFIRM',expectedConversationVersion:view.version,previewHash:preview.previewHash})).rejects.toMatchObject({code:'SCOPE_CHANGED'});
    vi.unstubAllEnvs();
  });
});
