import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { researchScopeSchema } from "@/lib/types/mission";
import { publicUrl } from "@/lib/research/queryPolicy";
import { observation, textHash } from "@/lib/research/sourceRepository";
import type { Source } from "../contracts";
import { fenced, reserveBrowser, settleBrowserUsage, type Lease } from "../runtimeStore";
import type { ToolSet } from "../tools";
import { browserReadAvailable, isolatedBrowserReader } from "@/lib/browser/reader";
import { DEFAULT_BROWSER_LIMITS, type BrowserReader, type BrowserSourceMeta } from "@/lib/browser/contracts";

export type BrowserDependencies = { reader?: BrowserReader };
const schema = z.object({ sourceId: z.string().min(1), scopeRevision: z.number().int().positive(),
  mode: z.enum(["READ_VISIBLE", "READ_DETAILS"]).default("READ_VISIBLE"), scrolls: z.number().int().min(0).max(2).default(0) }).strict();
const effects = { businessWrite: false, cacheWrite: false, externalDisclosure: true };
const failureMessage = (code: string) => ({
  BROWSER_EMPTY: "页面没有可见正文", BROWSER_URL_BLOCKED: "页面导航或子请求超出公开读取策略",
  BROWSER_NAVIGATION_TIMEOUT: "页面在时限内未完成加载", BROWSER_NAVIGATION_FAILED: "页面未能打开",
  BROWSER_PARTIAL_RENDER: "页面仍在异步加载", BROWSER_BUDGET_EXCEEDED: "页面请求超出本次读取预算",
} as Record<string, string>)[code] ?? "隔离浏览器没有取得可核验内容";

export function browserTools(lease: Lease, deps: BrowserDependencies = {}): ToolSet {
  if (!browserReadAvailable()) return {};
  const reader = deps.reader ?? isolatedBrowserReader;
  return {
    browser_read: {
      version: "1",
      description: "在已获准公开范围内渲染读取一个已观察网页的可见正文。隔离临时浏览器，无用户登录态；不填表、不购买、不上传、不绕过验证或付费墙；只可展开原生 details。子请求与跳转受同一公开网络策略约束。",
      schema, effects,
      run: async (actor, raw) => {
        const input = schema.parse(raw);
        const { mission, scope } = await db.$transaction(async tx => {
          const current = await fenced(tx, lease), parsed = researchScopeSchema.parse(current.researchScopeJson);
          if (!parsed.enabled) throw new AppError("RESEARCH_NOT_ALLOWED", "请先确认公开研究范围", 409);
          return { mission: current, scope: parsed };
        });
        if (input.scopeRevision !== mission.researchScopeVersion) throw new AppError("SCOPE_CHANGED", "公开研究授权已变化", 409);
        const found = await db.externalSource.findFirst({ where: { id: input.sourceId, missionId: mission.id } });
        if (!found) throw new AppError("SOURCE_NOT_FOUND", "资料不属于当前委托", 404);
        const url = publicUrl(found.requestedUrl, scope.allowedHosts);
        const reserved = { requests: DEFAULT_BROWSER_LIMITS.maxRequests, bytes: DEFAULT_BROWSER_LIMITS.maxBytes };
        await reserveBrowser(lease, reserved.requests, reserved.bytes);
        const result = await reader.read({ url, allowedHosts: scope.allowedHosts, mode: input.mode, scrolls: input.scrolls, limits: DEFAULT_BROWSER_LIMITS },
          { signal: AbortSignal.timeout(DEFAULT_BROWSER_LIMITS.maxRenderMs + 5000) });
        await settleBrowserUsage(lease, reserved, { requests: result.coverage.requests, bytes: result.coverage.bytes });
        if (result.status === "BLOCKED" || result.status === "FAILED")
          throw new AppError(result.failure?.code ?? "BROWSER_BLOCKED", result.failure?.message ?? failureMessage("BROWSER_BLOCKED"), result.status === "BLOCKED" ? 409 : 503);
        if (!result.visibleText.trim()) throw new AppError("BROWSER_EMPTY", failureMessage("BROWSER_EMPTY"), 422);
        const record = observation(mission.id, url, "BROWSER_RENDER", result.title, result.visibleText, found.publishedAt?.toISOString(), mission.researchScopeVersion);
        record.id = "src_" + textHash(`${mission.id}:${url}:${result.finalUrl}:${result.observedAt}`).slice(0, 40);
        record.observedAt = result.observedAt;
        record.resolvedUrl = result.finalUrl;
        const browser: BrowserSourceMeta = { renderer: "ISOLATED_BROWSER", version: 1, status: result.status, requestedUrl: url, finalUrl: result.finalUrl,
          observedAt: result.observedAt, renderMs: result.renderMs, mode: result.mode, readyState: result.readyState, coverage: result.coverage,
          locator: result.locator, screenshotHash: result.screenshotHash, failureCode: result.failure?.code ?? null, failureMessage: result.failure?.message ?? null };
        record.browser = browser;
        const source: Source = { id: record.id, kind: "EXTERNAL", entityType: "EXTERNAL_SOURCE", revision: record.normalizedContentHash, hash: record.normalizedContentHash,
          identityKey: url, text: record.excerpt.text, observedAt: new Date().toISOString(), knowledgeClass: "EXTERNAL_REFERENCE", temporalState: "UNKNOWN", browser };
        return { data: { sourceId: record.id, title: record.title, url, finalUrl: result.finalUrl, retrievalMode: "BROWSER_RENDER", browser,
          truncated: record.excerpt.truncated, coverage: result.coverage, observations: [record] }, sources: [source],
          coverage: { complete: result.coverage.complete, description: `隔离浏览器可见正文；页面请求 ${result.coverage.requests}，拦截 ${result.coverage.blockedRequests}${result.failure ? `；${result.failure.message}` : ""}` } };
      },
    },
  };
}
