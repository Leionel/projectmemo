import { z } from "zod";
import { apiError, AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  enforceLoginRateLimit,
  enforceLoginRateLimits,
  recordLoginFailures,
  clearLoginFailures,
  resolveClientIp,
} from "@/lib/auth/guard";
import { sessionCookieHeader } from "@/lib/auth/sessionCookie";
import { ensureDemoUser } from "@/lib/auth/ensureDemoUser";
import {
  canonicalLoginKey,
  findLoginCandidates,
  LOGIN_TIMING_EQUALIZER_HASH,
} from "@/lib/auth/loginIdentity";

export const runtime = "nodejs";

// 兼容旧客户端：字段名仍为 username，但值为“用户名或已绑定邮箱”。
const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名或邮箱").max(254, "用户名或邮箱过长"),
  password: z.string().min(1, "请输入密码"),
  client: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = loginSchema.parse(json);

    // 限流标识：客户端 IP + 规范化后的输入（大小写/首尾空格变化不换桶）。
    const clientIp = resolveClientIp(request);
    const identifierKey = `${clientIp}:${canonicalLoginKey(input.username)}`;

    enforceLoginRateLimit(identifierKey);

    // 演示账号仅在显式开启的环境下初始化，且不再自动绑定库里最早的项目。
    await ensureDemoUser();

    // 用户名与邮箱只产生候选；是否登录由密码唯一匹配 + 邮箱验证状态决定。
    const candidates = await findLoginCandidates(input.username);
    const accountKeys = candidates.map(
      (candidate) => `${clientIp}:user:${candidate.user.id}`,
    );
    const failureKeys = [identifierKey, ...accountKeys];
    // 同一账号用用户名或邮箱切换尝试时，也沿用同一失败累计与锁定期。
    enforceLoginRateLimits(accountKeys);

    const matches: string[] = [];
    for (const candidate of candidates) {
      if (await verifyPassword(input.password, candidate.user.passwordHash)) {
        matches.push(candidate.user.id);
      }
    }
    if (matches.length === 0) {
      // 账号不存在时也执行一次 scrypt，缩小与“密码错误”的响应时间差。
      if (candidates.length === 0) {
        await verifyPassword(input.password, LOGIN_TIMING_EQUALIZER_HASH);
      }
      recordLoginFailures(failureKeys);
      throw new AppError("AUTH_FAILED", "账号或密码错误", 401);
    }
    if (matches.length > 1) {
      // 同一输入唯一命中多个账号且密码都匹配：不任意选一个，按统一失败处理。
      recordLoginFailures(failureKeys);
      throw new AppError("AUTH_FAILED", "账号或密码错误", 401);
    }

    const userId = matches[0];
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      recordLoginFailures(failureKeys);
      throw new AppError("AUTH_FAILED", "账号或密码错误", 401);
    }

    const security = await db.accountSecurity.findUnique({ where: { userId: user.id } });
    if (security && !security.emailVerifiedAt) {
      recordLoginFailures(failureKeys);
      throw new AppError("EMAIL_NOT_VERIFIED", "请先验证注册邮箱；未收到邮件可以重新发送", 403);
    }

    clearLoginFailures([identifierKey, `${clientIp}:user:${user.id}`]);

    // 创建会话
    const { token, expiresAt } = await createSession(user.id);

    // 获取该用户授权的项目列表
    const memberships = await db.projectMembership.findMany({
      where: { userId: user.id },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
            scenario: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const projects = memberships.map((m) => m.project);

    return Response.json(
      {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
        },
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        projects,
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "set-cookie": sessionCookieHeader(token),
        },
      }
    );
  } catch (error) {
    const response = apiError(error);
    if (error instanceof AppError && error.status === 429) {
      const details = error.details as { retryAfter?: number } | undefined;
      if (details?.retryAfter !== undefined) {
        response.headers.set("Retry-After", String(details.retryAfter));
      }
    }
    return response;
  }
}
