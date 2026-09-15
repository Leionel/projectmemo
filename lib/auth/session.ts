import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { AuthSession, User } from "@/lib/generated/prisma/client";

const DEFAULT_SESSION_TTL_DAYS = 7;

/**
 * 生成 32 字节高熵安全随机会话 Token。
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 计算 Token 的 SHA-256 哈希值，用于数据库持久化比对。
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 为用户创建新会话。
 * 仅返回原始 Token 给客户端，数据库仅保存哈希值。
 */
export async function createSession(userId: string, ttlDays = DEFAULT_SESSION_TTL_DAYS): Promise<{
  token: string;
  session: AuthSession;
  expiresAt: Date;
}> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const session = await db.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return { token, session, expiresAt };
}

/**
 * 根据原始 Token 查找有效会话与关联用户。
 * 过期或已撤销的会话均视为无效，返回 null。
 */
export async function findValidSessionByToken(token: string): Promise<{
  session: AuthSession;
  user: User;
} | null> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return null;
  }

  const tokenHash = hashToken(token.trim());
  const now = new Date();

  const session = await db.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  // 检查是否已被撤销
  if (session.revokedAt !== null) {
    return null;
  }

  // 检查是否已过期
  if (session.expiresAt <= now) {
    return null;
  }

  // 异步更新 lastSeenAt，不阻塞主链路
  void db.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  }).catch(() => {
    // 忽略统计更新偶发失败
  });

  return {
    session,
    user: session.user,
  };
}

/**
 * 撤销指定 Token 对应的会话。
 * 保持幂等：即便 Token 不存在或已撤销，也正常完成。
 */
export async function revokeSession(token: string): Promise<boolean> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return false;
  }

  const tokenHash = hashToken(token.trim());

  try {
    await db.authSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}
