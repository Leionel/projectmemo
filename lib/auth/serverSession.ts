import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { findValidSessionByToken } from "./session";
import { SESSION_COOKIE } from "./sessionCookie";
import type { User } from "@/lib/generated/prisma/client";

export { SESSION_COOKIE };

/**
 * 服务端页面（RSC）侧的会话恢复。
 *
 * `lib/auth/guard.ts` 从 Request 头取凭据，只能用于 Route Handler；
 * 服务端组件没有 Request，必须经 `next/headers` 读 Cookie。
 * 保护 `/api` 不等于保护服务端渲染出来的数据，两者要各自校验。
 */

export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const result = await findValidSessionByToken(decodeURIComponent(token));
  return result?.user ?? null;
}

/**
 * 页面在读取项目数据前调用。查不到 membership 时页面应按 404 处理，
 * 不返回 403，避免用响应差异暴露项目是否存在。
 */
export async function hasProjectAccess(userId: string, projectId: string): Promise<boolean> {
  const membership = await db.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });
  return membership !== null;
}
