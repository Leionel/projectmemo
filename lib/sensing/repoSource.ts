import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { z } from "zod";

/**
 * P3-B 单仓库只读感知（最小版）：GitHub 公开仓库 commits 信号。
 * - 只在用户显式刷新时发请求（无轮询守护）；匿名 + ETag 条件请求（304 不计限额）。
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

async function ownedProject(userId: string, projectId: string) {
  const membership = await db.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } });
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
  const connection = await ownedConnection(userId, projectId, connectionId);
  if (connection.status === "REVOKED")
    throw new AppError("CONNECTION_REVOKED", "连接已撤销，不再发起任何新请求；历史信号保留", 409);
  let result: { status: string; error?: string; created: number };
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "projectmemo-sensing" };
    if (connection.etag) headers["If-None-Match"] = connection.etag;
    const response = await fetcher(
      `https://api.github.com/repos/${connection.repo}/commits?sha=${encodeURIComponent(connection.ref)}&per_page=${PAGE_SIZE}`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (response.status === 304) {
      result = { status: "NOT_MODIFIED", created: 0 };
    } else if (response.status === 403 || response.status === 429) {
      result = { status: response.status === 403 ? "FORBIDDEN" : "RATE_LIMITED", created: 0, error: "GitHub 拒绝或限流；稍后再刷新" };
    } else if (response.status === 404) {
      result = { status: "NOT_FOUND", created: 0, error: "仓库或分支不存在（或为私有仓库）" };
    } else if (response.status !== 200) {
      result = { status: "ERROR", created: 0, error: `GitHub 返回 ${response.status}` };
    } else {
      const commits = Array.isArray(response.body) ? (response.body as GithubCommit[]) : [];
      // 重叠扫描：按新到旧读取，遇到已见过的游标即停；同 sha 重复到达靠唯一约束去重。
      const fresh: GithubCommit[] = [];
      for (const commit of commits) {
        if (connection.cursorSha && commit.sha === connection.cursorSha) break;
        fresh.push(commit);
      }
      let created = 0;
      for (const commit of fresh.reverse()) {
        if (!SHA_PATTERN.test(commit.sha ?? "")) continue;
        try {
          await db.externalSignal.create({
            data: {
              connectionId: connection.id, projectId, ownerUserId: userId, sha: commit.sha,
              kind: "COMMITS", title: sanitizeTitle(commit.commit?.message ?? ""),
              authorName: (commit.commit?.author?.name ?? "未知").slice(0, 80),
              committedAt: commit.commit?.author?.date ? new Date(commit.commit.author.date) : null,
              url: (commit.html_url ?? `https://github.com/${connection.repo}/commit/${commit.sha}`).slice(0, 300),
            },
          });
          created += 1;
        } catch { /* 唯一约束冲突：该 sha 已存在（重试/重复推送），不重复计信号 */ }
      }
      const top = commits[0]?.sha;
      result = { status: "OK", created };
      await db.sourceConnection.update({ where: { id: connection.id }, data: { cursorSha: SHA_PATTERN.test(top ?? "") ? top : connection.cursorSha } });
    }
    if (response.status === 200 || response.status === 304) {
      await db.sourceConnection.update({ where: { id: connection.id }, data: { etag: response.etag ?? connection.etag, lastFetchedAt: new Date(), lastStatus: result.status, lastError: result.error ?? null } });
    } else {
      await db.sourceConnection.update({ where: { id: connection.id }, data: { lastFetchedAt: new Date(), lastStatus: result.status, lastError: result.error ?? null } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败";
    await db.sourceConnection.update({ where: { id: connection.id }, data: { lastFetchedAt: new Date(), lastStatus: "ERROR", lastError: `刷新失败：${message.slice(0, 160)}` } });
    result = { status: "ERROR", created: 0, error: message };
  }
  return { connection: await db.sourceConnection.findUniqueOrThrow({ where: { id: connection.id } }), ...result };
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
  const connection = await ownedConnection(userId, projectId, connectionId);
  if (connection.status === "REVOKED") return { connection, status: "REVOKED", created: 0 };
  const updated = await db.sourceConnection.update({
    where: { id: connection.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: input.reason ?? "USER_REVOKED" },
  });
  return { connection: updated, status: "REVOKED", created: 0 };
}

export async function actOnSignal(userId: string, projectId: string, signalId: string, raw: unknown) {
  requireEnabled();
  const input = signalActionSchema.parse(raw);
  const signal = await db.externalSignal.findFirst({ where: { id: signalId, projectId } });
  if (!signal || signal.ownerUserId !== userId) throw new AppError("SIGNAL_NOT_FOUND", "信号不存在或不可访问", 404);
  if (input.action === "DISMISS") {
    if (signal.status === "ADOPTED") throw new AppError("SIGNAL_ADOPTED", "已采纳的信号不再变更；项目事实请从资料侧修改", 409);
    const updated = await db.externalSignal.update({ where: { id: signal.id }, data: { status: "DISMISSED" } });
    return { signal: viewOfSignal(updated) };
  }
  if (signal.status === "ADOPTED") return { signal: viewOfSignal(signal) };
  if (signal.status !== "CANDIDATE") throw new AppError("SIGNAL_CHANGED", "该信号已处理，请刷新列表", 409);
  let linkedActionId: string | null = null;
  if (input.actionId) {
    // 关联行动只作资料指引：不改变行动状态，不产生完成回执；跨项目/模拟/已完成行动一律拒绝。
    const action = await db.actionItem.findFirst({ where: { id: input.actionId, projectId } });
    if (!action) throw new AppError("ACTION_NOT_FOUND", "关联的行动不存在或不属于当前项目", 404);
    if (action.isSimulated) throw new AppError("SIMULATED_ACTION", "演示模拟行动不能作为信号关联对象", 409);
    if (action.status === "DONE") throw new AppError("ACTION_DONE", "行动已完成；信号可作为资料但不改变完成事实", 409);
    linkedActionId = action.id;
  }
  const capture = await db.capture.create({
    data: { projectId, rawText: `仓库提交 ${signal.sha.slice(0, 10)}：${signal.title}（${signal.url}）`, sourceType: "仓库信号" },
  });
  const updated = await db.externalSignal.update({
    where: { id: signal.id },
    data: { status: "ADOPTED", adoptedByUserId: userId, adoptedAt: new Date(), adoptedCaptureId: capture.id, linkedActionId },
  });
  return { signal: viewOfSignal(updated), captureId: capture.id };
}
