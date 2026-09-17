import { z } from "zod";
import { apiError, AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { enforceLoginRateLimit, recordLoginFailure, clearLoginFailure, resolveClientIp } from "@/lib/auth/guard";
import { sessionCookieHeader } from "@/lib/auth/sessionCookie";
import { ensureDemoUser } from "@/lib/auth/ensureDemoUser";

export const runtime = "nodejs";

const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
  client: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = loginSchema.parse(json);

    // 提取限流标识（客户端 IP + 用户名）；IP 解析见 resolveClientIp 的伪造防护说明。
    const rateLimitKey = `${resolveClientIp(request)}:${input.username}`;

    enforceLoginRateLimit(rateLimitKey);

    // 演示账号仅在显式开启的环境下初始化，且不再自动绑定库里最早的项目。
    await ensureDemoUser();

    const user = await db.user.findUnique({
      where: { username: input.username },
    });

    if (!user) {
      recordLoginFailure(rateLimitKey);
      throw new AppError("AUTH_FAILED", "账号或密码错误", 401);
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      recordLoginFailure(rateLimitKey);
      throw new AppError("AUTH_FAILED", "账号或密码错误", 401);
    }

    clearLoginFailure(rateLimitKey);

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
    return apiError(error);
  }
}
