import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertProject } from "@/lib/conversation/repository";
import { actorDirectiveScope, assertContinuityBinding, assertDirectiveEffect, effectiveContinuity } from "@/lib/continuity/directiveService";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { jsonHash } from "@/lib/mission/contracts";
import type { ConversationActor } from "@/lib/types/conversation";

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const checkSchema = z.object({ id: z.number().int().positive(), head_sha: shaSchema, name: z.string().max(1000), status: z.string().max(80), conclusion: z.string().max(80).nullable(), html_url: z.string().optional() });
const runSchema = z.object({ id: z.number().int().positive(), head_sha: shaSchema, run_attempt: z.number().int().positive(), name: z.string().max(1000).nullable(), status: z.string().max(80), conclusion: z.string().max(80).nullable() });
type Transport = (url: string, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
const MAX_BYTES = 2 * 1024 * 1024;
const transport: Transport = async (url, signal) => {
  const response = await fetch(url, { signal, redirect: "error", headers: { Accept: "application/vnd.github+json", "User-Agent": "projectmemo-ci-observer", "X-GitHub-Api-Version": "2026-03-10" } });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, body: null }; }
  const reader = response.body?.getReader(); if (!reader) throw new AppError("CI_RESPONSE_INVALID", "未取得 CI 观察正文", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > MAX_BYTES) throw new AppError("CI_RESPONSE_LIMIT", "CI 观察超过读取上限", 502); chunks.push(item.value); } }
  finally { await reader.cancel(); }
  return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
};
const label = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);

/** CT-2 foundation: public metadata only, pinned SHA; caller persists the observation in the original Turn/Step result.
 * No moving-ref resolution, logs, tokens, retries, model call, business effect, or new runner is introduced here.
 */
export async function readRepositoryCi(actor: ConversationActor, projectId: string, connectionId: string, rawSha: string, fetcher: Transport = transport) {
  if (!isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false)) throw new AppError("CI_OBSERVER_DISABLED", "CI 观察暂未开启", 503);
  const sha = shaSchema.parse(rawSha), scope = actorDirectiveScope(actor, projectId);
  if ((await assertProject(actor, projectId)).role !== "OWNER") throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
  const connection = await db.sourceConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: actor.userId, status: "ACTIVE", revokedAt: null } });
  if (!connection || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(connection.repo)) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
  if (connection.signalKind !== "COMMITS_AND_CI") throw new AppError("CI_NOT_AUTHORIZED", "当前连接只允许提交观察，请先明确允许读取 CI", 409);
  const continuity = await effectiveContinuity(actor.userId, scope);
  const guard = async () => {
    if (!isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false)) throw new AppError("CI_OBSERVER_DISABLED", "CI 观察暂未开启", 503);
    if ((await assertProject(actor, projectId)).role !== "OWNER") throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不可访问", 404);
    const current = await db.sourceConnection.findUnique({ where: { id: connection.id } });
    if (!current || current.ownerUserId !== actor.userId || current.projectId !== projectId || current.repo !== connection.repo || current.ref !== connection.ref || current.signalKind !== connection.signalKind || current.status !== "ACTIVE" || current.revokedAt || current.revision !== connection.revision) throw new AppError("CONNECTION_CHANGED", "仓库授权或版本已变化，请重新定位", 409);
    const view = await assertContinuityBinding(actor.userId, scope, continuity);
    assertDirectiveEffect(view, "EXTERNAL_READ");
    await assertSourceUse(actor.userId, projectId, "repo:" + connectionId, db, scope);
  };
  const base = `https://api.github.com/repos/${connection.repo}`, signal = AbortSignal.timeout(15000);
  let requests = 0;
  const read = async (path: string) => {
    await guard(); requests++;
    const response = await fetcher(base + path, signal);
    await guard();
    if (response.status !== 200) throw new AppError(response.status === 404 ? "CI_NOT_ACCESSIBLE" : response.status === 403 || response.status === 429 ? "CI_RATE_OR_PERMISSION" : "CI_HTTP_FAILED", "未能取得该提交的公开 CI 观察，不自动重试", 502);
    return response.body;
  };
  // Verify the commit belongs to this repository before accepting its checks.
  const commit = z.object({ sha: shaSchema }).parse(await read(`/commits/${sha}`));
  if (commit.sha !== sha) throw new AppError("CI_IDENTITY_CHANGED", "提交标识与请求不一致", 409);
  const checks = z.object({ total_count: z.number().int().nonnegative(), check_runs: z.array(checkSchema).max(100) }).parse(await read(`/commits/${sha}/check-runs?filter=latest&per_page=100`));
  const runs = z.object({ total_count: z.number().int().nonnegative(), workflow_runs: z.array(runSchema).max(20) }).parse(await read(`/actions/runs?head_sha=${sha}&per_page=20`));
  if (checks.check_runs.some(c => c.head_sha !== sha) || runs.workflow_runs.some(r => r.head_sha !== sha)) throw new AppError("CI_IDENTITY_CHANGED", "返回的 CI 不属于所选提交", 409);
  const attempts = new Map<number, z.infer<typeof runSchema>>();
  for (const run of runs.workflow_runs) if (!attempts.has(run.id) || attempts.get(run.id)!.run_attempt < run.run_attempt) attempts.set(run.id, run);
  const observedAt = new Date().toISOString();
  const result = { schemaVersion: 1, kind: "REPOSITORY_CI", knowledgeClass: "EXTERNAL_REFERENCE", verification: "CI_OBSERVATION_NOT_DEPLOYMENT", projectId, connectionId, connectionRevision: connection.revision,
    repo: connection.repo, sha, observedAt, intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash,
    checks: checks.check_runs.map(c => ({ id: c.id, name: label(c.name), status: c.status, conclusion: c.conclusion })),
    runs: [...attempts.values()].map(r => ({ id: r.id, attempt: r.run_attempt, name: label(r.name ?? "工作流"), status: r.status, conclusion: r.conclusion })),
    coverage: { complete: checks.total_count <= checks.check_runs.length && runs.total_count <= runs.workflow_runs.length, totalChecks: checks.total_count, totalRuns: runs.total_count, requests, logsRead: false, refResolved: false },
    authority: "UNTRUSTED_TOOL_DATA_NEVER_USER_DIRECTIVE", goalImpact: "UNKNOWN", href: `https://github.com/${connection.repo}/commit/${sha}` } as const;
  await guard();
  return { ...result, revision: jsonHash(result) };
}
