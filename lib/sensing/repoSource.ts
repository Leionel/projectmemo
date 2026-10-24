import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { z } from "zod";
import { writeTransaction } from "@/lib/copilot/confirmation";
import { json, jsonHash } from "@/lib/mission/contracts";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * P3-B 单仓库只读感知（最小版）：GitHub 公开仓库 commits 信号。
 * - 只在用户显式刷新时发请求（无轮询守护）；匿名 + ETag 条件请求。
 * - 信号只是候选资料：未采纳零事实写入；采纳须用户确认，只产生 Capture 记录与可选行动关联。
 * - commit/标题内容一律当作不可信文本存储与展示，绝不执行其中指令；
 *   信号存在不等于现实完成，行动完成仍由用户回执（resultCardId）决定。
 * - 撤销连接立即停止新请求，游标与历史保留；迟到响应不自动应用（每次刷新读当前连接状态）。
 */

const REPO_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const REF_PATTERN = /^[A-Za-z0-9_./-]{1,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_CONNECTIONS_PER_PROJECT = 3;
const PAGE_SIZE = 30;
const MAX_PAGES_PER_REFRESH = 4;
const TITLE_LIMIT = 200;
const FETCH_TIMEOUT_MS = 15_000;

function requireEnabled() {
  if (!isFeatureEnabled("REPO_SENSING_ENABLED", true))
    throw new AppError("REPO_SENSING_DISABLED", "仓库感知当前未开启", 403);
}

/** 不可信文本清洗：去控制字符、首行化、限长。 */
function sanitizeTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const cleaned = firstLine.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "(无标题)").slice(0, TITLE_LIMIT);
}

export type FetchResult = { status: number; etag: string | null; body: unknown };
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<FetchResult>;

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  const text = response.status === 304 ? "" : await response.text();
  return { status: response.status, etag: response.headers.get("etag"), body: text ? JSON.parse(text) : null };
};

export const connectionCreateSchema = z
  .object({ repo: z.string().regex(REPO_PATTERN), ref: z.string().regex(REF_PATTERN), requestId: z.string().min(1).max(128) })
  .strict();
export const connectionActionSchema = z
  .object({ action: z.enum(["REFRESH", "REVOKE"]), requestId: z.string().min(1).max(128), reason: z.string().trim().max(200).optional() })
  .strict();
export const signalActionSchema = z
  .object({ action: z.enum(["ADOPT", "DISMISS"]), requestId: z.string().min(1).max(128), actionId: z.string().min(1).optional() })
  .strict();

async function ownedProject(userId: string, projectId: string, client: Prisma.TransactionClient = db) {
  const membership = await client.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } });
  if (!membership) throw new AppError("PROJECT_NOT_FOUND", "项目不存在或不可访问", 404);
}

async function ownedConnection(userId: string, projectId: string, connectionId: string) {
  const row = await db.sourceConnection.findFirst({ where: { id: connectionId, projectId } });
  if (!row || row.ownerUserId !== userId) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不存在或不可访问", 404);
  return row;
}

export async function createConnection(userId: string, projectId: string, raw: unknown, fetcher: FetchLike = defaultFetch) {
  requireEnabled();
  await ownedProject(userId, projectId);
  const input = connectionCreateSchema.parse(raw);
  const existing = await db.sourceConnection.findUnique({ where: { projectId_repo_ref: { projectId, repo: input.repo, ref: input.ref } } });
  if (existing) {
    if (existing.ownerUserId !== userId) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不存在或不可访问", 404);
    if (existing.status === "REVOKED") throw new AppError("CONNECTION_REVOKED", "该连接已撤销；撤销长期生效，请新建其他 ref 的连接", 409);
    return { connection: existing, summary: await refreshSummary(existing) };
  }
  const count = await db.sourceConnection.count({ where: { projectId, status: "ACTIVE" } });
  if (count >= MAX_CONNECTIONS_PER_PROJECT)
    throw new AppError("CONNECTION_LIMIT", `每个项目最多 ${MAX_CONNECTIONS_PER_PROJECT} 个活跃连接`, 409);
  const created = await db.sourceConnection.create({ data: { projectId, ownerUserId: userId, repo: input.repo, ref: input.ref } });
  const summary = await refreshConnection(userId, projectId, created.id, fetcher);
  return { connection: summary.connection, summary };
}

type GithubCommit = { sha: string; html_url?: string; commit?: { message?: string; author?: { name?: string; date?: string } } };

export async function refreshConnection(userId: string, projectId: string, connectionId: string, fetcher: FetchLike = defaultFetch) {
  requireEnabled();
  await ownedProject(userId, projectId);
  const connection = await ownedConnection(userId, projectId, connectionId);
  if (connection.status === "REVOKED")
    throw new AppError("CONNECTION_REVOKED", "连接已撤销，不再发起任何新请求；历史信号保留", 409);
  const commitResult = async (work: (tx: Prisma.TransactionClient) => Promise<{ status: string; error?: string; created: number }>) =>
    writeTransaction(`repo-refresh:${connectionId}`, async tx => {
      requireEnabled();
      await ownedProject(userId, projectId, tx);
      const current = await tx.sourceConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: userId } });
      if (!current) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不存在或不可访问", 404);
      if (current.status !== "ACTIVE") throw new AppError("CONNECTION_REVOKED", "连接已撤销；本次迟到响应未写入", 409);
      if (current.revision !== connection.revision) throw new AppError("CONNECTION_CHANGED", "连接已发生变化，本次响应未写入；请重新刷新", 409);
      const result = await work(tx);
      await tx.sourceConnection.update({ where: { id: connectionId }, data: { revision: { increment: 1 }, lastFetchedAt: new Date(), lastStatus: result.status, lastError: result.error ?? null } });
      return { connection: await tx.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } }), ...result };
    });
  try {
    const fresh: GithubCommit[] = [];
    let page = connection.scanNextPage ?? 1, head = connection.scanHeadSha, etag = connection.scanEtag, complete = false;
    // 按冻结 head 翻页，避免刷新期间仓库新提交令页边界漂移；每次最多四页，缺口持久续取。
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    for (let fetched = 0; fetched < MAX_PAGES_PER_REFRESH; fetched++, page++) {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "projectmemo-sensing" };
      if (page === 1 && !head && connection.etag) headers["If-None-Match"] = connection.etag;
      const response = await fetcher(`https://api.github.com/repos/${connection.repo}/commits?sha=${encodeURIComponent(head ?? connection.ref)}&per_page=${PAGE_SIZE}&page=${page}`, { headers, signal: timeout });
      if (response.status !== 200) {
        if (response.status === 304 && page === 1 && !head) return await commitResult(async tx => {
          await tx.sourceConnection.update({ where: { id: connectionId }, data: { etag: response.etag ?? connection.etag } });
          return { status: "NOT_MODIFIED", created: 0 };
        });
        const status = response.status === 403 ? "FORBIDDEN" : response.status === 429 ? "RATE_LIMITED" : response.status === 404 ? "NOT_FOUND" : "ERROR";
        return await commitResult(async () => ({ status, created: 0, error: status === "NOT_FOUND" ? "仓库或分支不存在（或为私有仓库）" : `GitHub 返回 ${response.status}；未推进同步游标，请稍后重试` }));
      }
      if (!Array.isArray(response.body)) throw new Error("GitHub 提交列表格式不正确");
      const commits = response.body as GithubCommit[];
      if (!head) { head = commits[0]?.sha ?? null; etag = response.etag; }
      for (const commit of commits) {
        if (!SHA_PATTERN.test(commit.sha ?? "")) throw new Error("GitHub 提交标识不正确");
        if (connection.cursorSha && commit.sha === connection.cursorSha) { complete = true; break; }
        fresh.push(commit);
      }
      // 初次仅建立最近 30 条基线；已有游标必须找到旧边界或读到末页。
      if (complete || !connection.cursorSha || commits.length < PAGE_SIZE) { complete = true; break; }
    }
    return await commitResult(async tx => {
      let created = 0;
      for (const commit of fresh.reverse()) {
        const existing = await tx.externalSignal.findUnique({ where: { connectionId_sha: { connectionId, sha: commit.sha } } });
        if (!existing) {
          await tx.externalSignal.create({
            data: {
              connectionId: connection.id, projectId, ownerUserId: userId, sha: commit.sha,
              kind: "COMMITS", title: sanitizeTitle(commit.commit?.message ?? ""),
              authorName: (commit.commit?.author?.name ?? "未知").slice(0, 80),
              committedAt: commit.commit?.author?.date ? new Date(commit.commit.author.date) : null,
               url: `https://github.com/${connection.repo}/commit/${commit.sha}`,
            },
          });
          created += 1;
        }
      }
      await tx.sourceConnection.update({ where: { id: connectionId }, data: complete
        ? { cursorSha: head ?? connection.cursorSha, etag, scanHeadSha: null, scanNextPage: null, scanEtag: null }
        : { scanHeadSha: head, scanNextPage: page, scanEtag: etag } });
      return { status: complete ? "OK" : "PARTIAL", created, ...(complete ? {} : { error: "还有较早的新提交未读取；再次刷新将继续，不会跳过这段记录" }) };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "网络请求失败";
    // 失败事务回滚全部信号；只记录错误，不确认 cursor / ETag，仍须重验撤销与授权。
    return commitResult(async () => ({ status: "ERROR", created: 0, error: `刷新失败：${message.slice(0, 160)}` }));
  }
}

async function refreshSummary(connection: { id: string }) {
  const [candidateCount, adoptedCount] = await Promise.all([
    db.externalSignal.count({ where: { connectionId: connection.id, status: "CANDIDATE" } }),
    db.externalSignal.count({ where: { connectionId: connection.id, status: "ADOPTED" } }),
  ]);
  return { candidateCount, adoptedCount };
}

export async function listSignals(userId: string, projectId: string) {
  requireEnabled();
  await ownedProject(userId, projectId);
  const connections = await db.sourceConnection.findMany({
    where: { projectId, ownerUserId: userId },
    orderBy: { createdAt: "asc" },
  });
  const signals = await db.externalSignal.findMany({
    where: { projectId, ownerUserId: userId },
    orderBy: { committedAt: "desc" },
    take: 40,
  });
  return {
    enabled: true,
    note: "信号只是候选资料；采纳需确认，未采纳不写入任何项目事实。commit/CI 不构成现实完成证明。",
    connections: await Promise.all(connections.map(async c => ({ ...viewOfConnection(c), ...(await refreshSummary(c)) }))),
    signals: signals.map(viewOfSignal),
  };
}

function viewOfConnection(c: { id: string; repo: string; ref: string; status: string; lastFetchedAt: Date | null; lastStatus: string | null; lastError: string | null; revokedAt: Date | null; revokedReason: string | null }) {
  return {
    id: c.id, repo: c.repo, ref: c.ref, status: c.status,
    lastFetchedAt: c.lastFetchedAt?.toISOString() ?? null, lastStatus: c.lastStatus, lastError: c.lastError,
    revokedAt: c.revokedAt?.toISOString() ?? null, revokedReason: c.revokedReason ?? null,
  };
}
function viewOfSignal(s: { id: string; connectionId: string; kind: string; sha: string; title: string; authorName: string; committedAt: Date | null; url: string; status: string; adoptedAt: Date | null; adoptedCaptureId: string | null; linkedActionId: string | null }) {
  return {
    id: s.id, connectionId: s.connectionId, kind: s.kind, sha: s.sha, title: s.title, authorName: s.authorName,
    committedAt: s.committedAt?.toISOString() ?? null, url: s.url, status: s.status,
    adoptedAt: s.adoptedAt?.toISOString() ?? null, adoptedCaptureId: s.adoptedCaptureId, linkedActionId: s.linkedActionId,
  };
}

export async function actOnConnection(userId: string, projectId: string, connectionId: string, raw: unknown, fetcher: FetchLike = defaultFetch) {
  requireEnabled();
  const input = connectionActionSchema.parse(raw);
  if (input.action === "REFRESH") return refreshConnection(userId, projectId, connectionId, fetcher);
  return writeTransaction(`repo-revoke:${connectionId}`, async tx => {
    await ownedProject(userId, projectId, tx);
    const connection = await tx.sourceConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: userId } });
    if (!connection) throw new AppError("CONNECTION_NOT_FOUND", "仓库连接不存在或不可访问", 404);
    if (connection.status === "REVOKED") return { connection, status: "REVOKED", created: 0 };
    const updated = await tx.sourceConnection.update({
      where: { id: connection.id },
      data: { status: "REVOKED", revision: { increment: 1 }, revokedAt: new Date(), revokedReason: input.reason ?? "USER_REVOKED" },
    });
    return { connection: updated, status: "REVOKED", created: 0 };
  });
}

export async function actOnSignal(userId: string, projectId: string, signalId: string, raw: unknown) {
  requireEnabled();
  const input = signalActionSchema.parse(raw);
  const payloadHash = jsonHash({ projectId, signalId, action: input.action, actionId: input.actionId ?? null });
  return writeTransaction(`repo-signal:${signalId}`, async tx => {
  await ownedProject(userId, projectId, tx);
  const signal = await tx.externalSignal.findFirst({ where: { id: signalId, projectId } });
  if (!signal || signal.ownerUserId !== userId) throw new AppError("SIGNAL_NOT_FOUND", "信号不存在或不可访问", 404);
  const previous = await tx.repoSignalCommand.findUnique({ where: { ownerUserId_requestId: { ownerUserId: userId, requestId: input.requestId } } });
  if (previous) {
    if (previous.payloadHash !== payloadHash) throw new AppError("REQUEST_CONFLICT", "该请求编号已用于其他操作，请刷新后重试", 409);
    return previous.resultJson as unknown as { signal: ReturnType<typeof viewOfSignal>; captureId?: string };
  }
  const finish = async (result: { signal: ReturnType<typeof viewOfSignal>; captureId?: string }) => {
    await tx.repoSignalCommand.create({ data: { signalId, ownerUserId: userId, requestId: input.requestId, payloadHash, resultJson: json(result) } });
    return result;
  };
  if (input.action === "DISMISS") {
    if (signal.status === "ADOPTED") throw new AppError("SIGNAL_ADOPTED", "已采纳的信号不再变更；项目事实请从资料侧修改", 409);
    const updated = await tx.externalSignal.update({ where: { id: signal.id }, data: { status: "DISMISSED" } });
    return finish({ signal: viewOfSignal(updated) });
  }
  if (signal.status === "ADOPTED") {
    if (input.actionId && input.actionId !== signal.linkedActionId) throw new AppError("SIGNAL_CHANGED", "已采纳信号的关联行动不能通过重试更换", 409);
    return finish({ signal: viewOfSignal(signal), ...(signal.adoptedCaptureId ? { captureId: signal.adoptedCaptureId } : {}) });
  }
  if (signal.status !== "CANDIDATE") throw new AppError("SIGNAL_CHANGED", "该信号已处理，请刷新列表", 409);
  let linkedActionId: string | null = null;
  if (input.actionId) {
    // 关联行动只作资料指引：不改变行动状态，不产生完成回执；跨项目/模拟/已完成行动一律拒绝。
    const action = await tx.actionItem.findFirst({ where: { id: input.actionId, projectId } });
    if (!action) throw new AppError("ACTION_NOT_FOUND", "关联的行动不存在或不属于当前项目", 404);
    if (action.isSimulated) throw new AppError("SIMULATED_ACTION", "演示模拟行动不能作为信号关联对象", 409);
    if (["DONE", "CANCELLED"].includes(action.status)) throw new AppError("ACTION_DONE", "行动已结束；信号可作为资料但不改变完成事实", 409);
    linkedActionId = action.id;
  }
  const capture = await tx.capture.create({
    data: { projectId, rawText: `仓库提交 ${signal.sha.slice(0, 10)}：${signal.title}（${signal.url}）`, sourceType: "仓库信号" },
  });
  const updated = await tx.externalSignal.update({
    where: { id: signal.id },
    data: { status: "ADOPTED", adoptedByUserId: userId, adoptedAt: new Date(), adoptedCaptureId: capture.id, linkedActionId },
  });
  return finish({ signal: viewOfSignal(updated), captureId: capture.id });
  });
}
