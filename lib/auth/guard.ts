import { AppError } from "@/lib/api";
import { findValidSessionByToken } from "./session";
import { db } from "@/lib/db";
import type { AuthSession, Project, User } from "@/lib/generated/prisma/client";

export interface AuthenticatedContext {
  user: User;
  session: AuthSession;
}

export interface AuthorizedProjectContext extends AuthenticatedContext {
  project: Project;
}

/**
 * 从请求头 Authorization 读取 Bearer Token，若无则从 Cookie (pm_session) 读取。
 */
export function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }

  // 支持从 Cookie 读取会话凭据（适配 Web 端）
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("pm_session=")) {
        const val = cookie.substring("pm_session=".length).trim();
        if (val) return decodeURIComponent(val);
      }
      if (cookie.startsWith("session_token=")) {
        const val = cookie.substring("session_token=".length).trim();
        if (val) return decodeURIComponent(val);
      }
    }
  }

  return "";
}

/**
 * 校验请求携带的用户会话。
 * 未登录、Token 格式错误、Token 过期或被撤销统一返回 401。
 */
export async function authenticateUser(request: Request): Promise<AuthenticatedContext> {
  const token = readBearerToken(request);
  if (!token) {
    throw new AppError("UNAUTHORIZED", "未提供身份凭据，请先登录", 401);
  }

  const result = await findValidSessionByToken(token);
  if (!result) {
    throw new AppError("UNAUTHORIZED", "登录状态已失效，请重新登录", 401);
  }

  return {
    user: result.user,
    session: result.session,
  };
}

/**
 * 校验当前用户是否拥有该项目的访问权限。
 * 1. 先验证会话（未登录 401）；
 * 2. 再验证项目归属（项目不存在或无 membership 统一 404）。
 *
 * 越权沿用「统一 404」而不是 403：403 与 404 的差异会让已登录用户逐个
 * 试探 projectId 是否存在。Server Component 页面端
 * （lib/auth/serverSession.ts）已经这么做，API 必须与之一致。
 */
export async function authorizeProjectAccess(
  request: Request,
  projectId: string
): Promise<AuthorizedProjectContext> {
  if (!projectId || typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new AppError("INVALID_PROJECT_ID", "无效的项目 ID", 400);
  }

  const { user, session } = await authenticateUser(request);

  const project = await db.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
  }

  const membership = await db.projectMembership.findUnique({
    where: {
      userId_projectId: {
        userId: user.id,
        projectId: project.id,
      },
    },
  });

  if (!membership) {
    throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
  }

  return {
    user,
    session,
    project,
  };
}

// -------------------------------------------------------------
// 登录失败限流器：防止暴力破解
// -------------------------------------------------------------
type FailureRecord = { count: number; windowStart: number; blockedUntil?: number };
const loginFailureBuckets = new Map<string, FailureRecord>();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;
const LOCKOUT_DURATION_MS = 120_000;

/**
 * 解析登录限流用的客户端标识。
 *
 * 反向代理必须「覆盖」而不是「追加」这两个头。旧实现取 X-Forwarded-For 最左值，
 * 而 nginx 的 `$proxy_add_x_forwarded_for` 会把客户端自带的 XFF 前置拼接，
 * 于是外部只要轮换这个头就能让每次请求落在不同桶里，限流形同不存在。
 *
 * 这里优先用 `X-Real-IP`（nginx 固定重写为 `$remote_addr`，客户端无法伪造），
 * 退路才取 XFF 最右侧一跳——无论代理是覆盖还是追加，最右侧都是代理自己写的那一跳。
 * 两个头都缺失（无代理直连）时返回 "local"，此时本来就拿不到真实来源地址。
 */
export function resolveClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  return hops[hops.length - 1] ?? "local";
}

export function enforceLoginRateLimit(identifier: string): void {
  const now = Date.now();
  const record = loginFailureBuckets.get(identifier);
  if (!record) return;

  if (record.blockedUntil && now < record.blockedUntil) {
    const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
    throw new AppError(
      "LOGIN_RATE_LIMITED",
      `连续登录失败次数过多，请在 ${retryAfter} 秒后再试`,
      429,
      { retryAfter }
    );
  }

  // 检查滑动窗口是否过期
  if (now - record.windowStart >= LOGIN_WINDOW_MS) {
    loginFailureBuckets.delete(identifier);
  }
}

export function recordLoginFailure(identifier: string): void {
  const now = Date.now();
  const record = loginFailureBuckets.get(identifier) ?? { count: 0, windowStart: now };

  if (now - record.windowStart >= LOGIN_WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
    record.blockedUntil = undefined;
  } else {
    record.count += 1;
  }

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.blockedUntil = now + LOCKOUT_DURATION_MS;
  }

  loginFailureBuckets.set(identifier, record);

  // 清理过期记录防止内存泄漏
  if (loginFailureBuckets.size > 512) {
    for (const [key, val] of loginFailureBuckets) {
      if (now - val.windowStart >= LOGIN_WINDOW_MS && (!val.blockedUntil || now >= val.blockedUntil)) {
        loginFailureBuckets.delete(key);
      }
    }
  }
}

export function clearLoginFailure(identifier: string): void {
  loginFailureBuckets.delete(identifier);
}
