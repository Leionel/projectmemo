import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertProject } from "@/lib/conversation/repository";
import { assertContinuityBinding, assertDirectiveEffect, effectiveContinuity } from "@/lib/continuity/directiveService";
import { ownedMission } from "@/lib/mission/repository";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { jsonHash } from "@/lib/mission/contracts";
import type { ConversationActor } from "@/lib/types/conversation";
import type { RepositorySourceMeta } from "@/lib/types/repositoryCi";

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const checkSchema = z.object({ id: z.number().int().positive(), head_sha: shaSchema, name: z.string().max(1000), status: z.string().max(80), conclusion: z.string().max(80).nullable() });
const runSchema = z.object({ id: z.number().int().positive(), head_sha: shaSchema, run_attempt: z.number().int().positive(), name: z.string().max(1000).nullable(), status: z.string().max(80), conclusion: z.string().max(80).nullable() });
const jobSchema = z.object({ id: z.number().int().positive(), run_id: z.number().int().positive(), run_attempt: z.number().int().positive(), head_sha: shaSchema,
  name: z.string().max(1000), status: z.string().max(80), conclusion: z.string().max(80).nullable() });
export type CiHttpResult = { status: number; body: unknown; truncated?: boolean; range?: string | null; observedAt?: string };
export type CiTransport = (url: string, signal: AbortSignal, mode?: "JSON" | "LOG") => Promise<CiHttpResult>;
export type CiDispatch = (resource: string, units: number, run: () => Promise<CiHttpResult>) => Promise<CiHttpResult>;
const label = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
export type RepositoryActor = { userId: string; sessionId?: string; missionId?: string; conversationId?: string; missionProjectId?: string };
async function owner(actor: RepositoryActor, projectId: string) {
  if (actor.sessionId) { if ((await assertProject(actor as ConversationActor, projectId)).role === "OWNER") return; }
  else if (actor.missionId && (await ownedMission(actor.userId, actor.missionId)).projectId === projectId) return;
  throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
}
export function redactCiLog(text: string) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[已隐藏私钥]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g, "[已隐藏凭据]")
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)[^\r\n]+/gi, "$1[已隐藏凭据]")
    .replace(/(https:\/\/[^\s?]+)\?[^\s]+/g, "$1?[已隐藏查询参数]").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
}
/** Signed download URLs stay transient; the dispatch ledger receives only the API resource. */
export const ciTransport: CiTransport = async (url, signal, mode = "JSON") => {
  let response = await fetch(url, { signal, redirect: "manual", headers: { Accept: "application/vnd.github+json", "User-Agent": "projectmemo-ci-observer", "X-GitHub-Api-Version": "2026-03-10" } });
  if (mode === "LOG" && response.status === 302) {
    const target = new URL(response.headers.get("location") ?? ""); await response.body?.cancel();
    if (target.protocol !== "https:" || target.username || target.password || target.port || !/^(?:[a-z0-9-]+\.)?(?:actions\.githubusercontent\.com|blob\.core\.windows\.net)$/.test(target.hostname))
      throw new AppError("CI_REDIRECT_DENIED", "日志下载地址不在允许范围", 502);
    response = await fetch(target, { signal, redirect: "error", headers: { Range: "bytes=-32768" } });
  }
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, body: null }; }
  const reader = response.body?.getReader(); if (!reader) throw new AppError("CI_RESPONSE_INVALID", "未取得 CI 观察正文", 502);
  const limit = mode === "LOG" ? 32768 : 2 * 1024 * 1024, chunks: Uint8Array[] = []; let size = 0, truncated = false;
  try { for (;;) { const item = await reader.read(); if (item.done) break; const remaining = limit - size; chunks.push(item.value.slice(0, remaining)); size += Math.min(item.value.byteLength, remaining);
    if (item.value.byteLength > remaining || size === limit) { truncated = true; if (mode !== "LOG") throw new AppError("CI_RESPONSE_LIMIT", "CI 观察超过读取上限", 502); break; } } }
  finally { await reader.cancel(); }
  const text = Buffer.concat(chunks).toString("utf8");
  return { status: response.status, body: mode === "LOG" ? redactCiLog(text) : JSON.parse(text), truncated, range: response.headers.get("content-range") };
};

async function context(actor: RepositoryActor, projectId: string, connectionId: string, fetcher: CiTransport, dispatch?: CiDispatch, parent?: RepositorySourceMeta) {
  if (!isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false)) throw new AppError("CI_OBSERVER_DISABLED", "CI 观察暂未开启", 503);
  const scope = { projectId, ...(actor.conversationId ? { conversationId: actor.conversationId } : {}), ...(actor.missionId && (actor.missionProjectId ?? projectId) === projectId ? { missionId: actor.missionId } : {}) };
  await owner(actor, projectId);
  const c = await db.sourceConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: actor.userId, status: "ACTIVE", revokedAt: null } });
  if (!c || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(c.repo)) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
  if (!["COMMITS_AND_CI", "COMMITS_CI_LOGS"].includes(c.signalKind)) throw new AppError("CI_NOT_AUTHORIZED", "请先明确允许读取 CI", 409);
  if (parent && (parent.connectionRevision !== c.revision || parent.repo !== c.repo)) throw new AppError("CONNECTION_CHANGED", "原 CI 来源的授权已变化，请重新读取", 409);
  const continuity = await effectiveContinuity(actor.userId, scope);
  const guard = async () => {
    if (!isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false)) throw new AppError("CI_OBSERVER_DISABLED", "CI 观察暂未开启", 503);
    await owner(actor, projectId);
    const current = await db.sourceConnection.findUnique({ where: { id: c.id } });
    if (!current || current.ownerUserId !== actor.userId || current.projectId !== projectId || current.repo !== c.repo || current.ref !== c.ref || current.signalKind !== c.signalKind || current.status !== "ACTIVE" || current.revokedAt || current.revision !== c.revision)
      throw new AppError("CONNECTION_CHANGED", "仓库授权或版本已变化，请重新定位", 409);
    assertDirectiveEffect(await assertContinuityBinding(actor.userId, scope, continuity), "EXTERNAL_READ");
    await assertSourceUse(actor.userId, projectId, "repo:" + connectionId, db, scope);
  };
  let requests = 0, observedAt = ""; const signal = AbortSignal.timeout(15000);
  const read = async (path: string, mode: "JSON" | "LOG" = "JSON") => {
    await guard(); const units = mode === "LOG" ? 2 : 1; requests += units;
    const url = `https://api.github.com/repos/${c.repo}${path}`;
    const run = async () => { const r = await fetcher(url, signal, mode); return { ...r, observedAt: r.observedAt ?? new Date().toISOString(), ...(mode === "LOG" && typeof r.body === "string" ? { body: redactCiLog(r.body) } : {}) }; }, response = await (dispatch ? dispatch(url, units, run) : run()); await guard();
    if (response.observedAt && response.observedAt > observedAt) observedAt = response.observedAt;
    if (![200, 206].includes(response.status)) throw new AppError(response.status === 404 ? "CI_NOT_ACCESSIBLE" : response.status === 403 || response.status === 429 ? "CI_RATE_OR_PERMISSION" : "CI_HTTP_FAILED", "未取得 CI 观察，不自动重试", 502);
    return response;
  };
  return { c, continuity, guard, read, requests: () => requests, observedAt: () => observedAt || new Date().toISOString() };
}
export async function readRepositoryCi(actor: RepositoryActor, projectId: string, connectionId: string, rawSha: string, fetcher: CiTransport = ciTransport, dispatch?: CiDispatch) {
  const sha = shaSchema.parse(rawSha), ctx = await context(actor, projectId, connectionId, fetcher, dispatch);
  const commit = z.object({ sha: shaSchema }).parse((await ctx.read(`/commits/${sha}`)).body);
  if (commit.sha !== sha) throw new AppError("CI_IDENTITY_CHANGED", "提交标识与请求不一致", 409);
  const checks = z.object({ total_count: z.number().int().nonnegative(), check_runs: z.array(checkSchema).max(100) }).parse((await ctx.read(`/commits/${sha}/check-runs?filter=latest&per_page=100`)).body);
  const runs = z.object({ total_count: z.number().int().nonnegative(), workflow_runs: z.array(runSchema).max(20) }).parse((await ctx.read(`/actions/runs?head_sha=${sha}&per_page=20`)).body);
  if (checks.check_runs.some(c => c.head_sha !== sha) || runs.workflow_runs.some(r => r.head_sha !== sha)) throw new AppError("CI_IDENTITY_CHANGED", "返回的 CI 不属于所选提交", 409);
  const attempts = new Map<number, z.infer<typeof runSchema>>();
  for (const run of runs.workflow_runs) if (!attempts.has(run.id) || attempts.get(run.id)!.run_attempt < run.run_attempt) attempts.set(run.id, run);
  const observedAt = ctx.observedAt();
  const result = { schemaVersion: 1, kind: "REPOSITORY_CI", knowledgeClass: "EXTERNAL_REFERENCE", verification: "CI_OBSERVATION_NOT_DEPLOYMENT", projectId, connectionId, connectionRevision: ctx.c.revision,
    repo: ctx.c.repo, sha, observedAt, intentHash: ctx.continuity.intentHash, reusePolicyHash: ctx.continuity.reusePolicyHash,
    checks: checks.check_runs.map(c => ({ id: c.id, name: label(c.name), status: c.status, conclusion: c.conclusion })),
    runs: [...attempts.values()].map(r => ({ id: r.id, attempt: r.run_attempt, name: label(r.name ?? "工作流"), status: r.status, conclusion: r.conclusion })),
    coverage: { complete: checks.total_count <= checks.check_runs.length && runs.total_count <= runs.workflow_runs.length, totalChecks: checks.total_count, totalRuns: runs.total_count, requests: ctx.requests(), logsRead: false, refResolved: false },
    authority: "UNTRUSTED_TOOL_DATA_NEVER_USER_DIRECTIVE", goalImpact: "UNKNOWN", href: `https://github.com/${ctx.c.repo}/commit/${sha}` } as const;
  await ctx.guard(); return { ...result, revision: jsonHash(result) };
}
export async function readRepositoryCiDetail(actor: RepositoryActor, projectId: string, parent: RepositorySourceMeta, query: { runId?: number; attempt?: number; jobId?: number }, fetcher: CiTransport = ciTransport, dispatch?: CiDispatch) {
  const ctx = await context(actor, projectId, parent.connectionId, fetcher, dispatch, parent), log = query.jobId !== undefined;
  const runId = log ? parent.runId : query.runId, attempt = log ? parent.attempt : query.attempt;
  if (!runId || !attempt || (log ? parent.kind !== "JOBS" || !parent.jobs?.some(j => j.id === query.jobId && ["failure", "timed_out", "cancelled"].includes(j.conclusion ?? "")) : parent.kind !== "STATUS" || !parent.runs?.some(r => r.id === runId && r.attempt === attempt)))
    throw new AppError("CI_TARGET_NOT_OBSERVED", "请从原 CI 观察中选择失败任务", 409);
  if (log && ctx.c.signalKind !== "COMMITS_CI_LOGS") throw new AppError("CI_LOG_NOT_AUTHORIZED", "当前只允许 CI 元数据；日志需另行授权", 409);
  const current = runSchema.parse((await ctx.read(`/actions/runs/${runId}`)).body);
  if (current.head_sha !== parent.sha || current.run_attempt !== attempt) throw new AppError("CI_ATTEMPT_CHANGED", "工作流已出现新尝试，请重新读取状态", 409);
  let body: unknown, jobs: RepositorySourceMeta["jobs"], truncated = false, range: string | null | undefined;
  if (log) {
    const job = jobSchema.parse((await ctx.read(`/actions/jobs/${query.jobId}`)).body);
    if (job.run_id !== runId || job.run_attempt !== attempt || job.head_sha !== parent.sha) throw new AppError("CI_IDENTITY_CHANGED", "日志不属于原提交和尝试", 409);
    const result = await ctx.read(`/actions/jobs/${query.jobId}/logs`, "LOG");
    body = redactCiLog(z.string().parse(result.body)); truncated = result.truncated ?? true; range = result.range;
  } else {
    const result = z.object({ total_count: z.number().int().nonnegative(), jobs: z.array(jobSchema).max(30) }).parse((await ctx.read(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=30`)).body);
    if (result.jobs.some(j => j.run_id !== runId || j.run_attempt !== attempt || j.head_sha !== parent.sha)) throw new AppError("CI_IDENTITY_CHANGED", "任务列表不属于原提交和尝试", 409);
    jobs = result.jobs.map(j => ({ id: j.id, name: label(j.name), status: j.status, conclusion: j.conclusion })); body = jobs; truncated = result.total_count > jobs.length;
  }
  await ctx.guard();
  const repository: RepositorySourceMeta = { connectionId: ctx.c.id, connectionRevision: ctx.c.revision, repo: ctx.c.repo, sha: parent.sha,
    kind: log ? "LOG" : "JOBS", runId, attempt, ...(log ? { jobId: query.jobId } : { jobs }), observedAt: ctx.observedAt() };
  return { repository, body, coverage: { complete: !truncated, truncated, range: range ?? null, requests: ctx.requests(), description: log ? "脱敏日志片段，不证明部署或行动完成" : "固定提交与尝试的任务列表" } };
}
