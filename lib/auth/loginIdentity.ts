import { z } from "zod";
import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";

/**
 * 登录标识合同：一个请求字段承载“用户名或已绑定邮箱”。
 *
 * 兼容策略（与 Web / HarmonyOS / 旧客户端一致）：
 * - 请求仍使用 `username` 字段，不新增 `identifier`，旧客户端无需改协议；
 * - 用户名匹配规则保持改动前行为：按 `User.username` 精确匹配，不改变历史账号大小写规则；
 * - 邮箱匹配使用注册/验证/重置链路同一套规范化（trim + 小写），
 *   不合并 Gmail 点号别名、不删除 `+tag`，不做任何账号合并。
 *
 * 安全策略：
 * - 同一输入可能同时是一个历史用户名（历史数据允许包含 `@`）和另一个账号的邮箱；
 *   这里只返回去重后的候选，由调用方用密码唯一匹配决定，绝不 findFirst 任选；
 * - 邮箱查询使用 COLLATE NOCASE：SQLite 的 unique 索引默认区分大小写，历史行可能保留原始大小写；
 *   若历史数据同一规范化邮箱存在多行，则作为多个候选交给密码唯一判定。
 */

const emailFormat = z.string().email();

/** 与注册、验证、重置链路一致的邮箱规范化；仅用于邮箱候选与限流键。 */
export function normalizeEmailIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/** 限流键规范化：大小写/首尾空格变化不能绕过同一桶；不参与身份匹配。 */
export function canonicalLoginKey(value: string): string {
  return value.trim().toLowerCase();
}

export type LoginIdentityCandidate = {
  user: User;
  matchedBy: "USERNAME" | "EMAIL";
};

export async function findLoginCandidates(
  identifier: string,
): Promise<LoginIdentityCandidate[]> {
  const trimmed = identifier.trim();
  if (trimmed === "") return [];

  const candidates: LoginIdentityCandidate[] = [];
  const seen = new Set<string>();

  // 1) 原用户名精确匹配（保持历史行为，不做大小写放宽）。
  const byUsername = await db.user.findUnique({ where: { username: trimmed } });
  if (byUsername) {
    candidates.push({ user: byUsername, matchedBy: "USERNAME" });
    seen.add(byUsername.id);
  }

  // 2) 已绑定邮箱匹配：仅对合法邮箱形态做查询，避免把任意用户名当邮箱查。
  const normalizedEmail = normalizeEmailIdentity(trimmed);
  if (emailFormat.safeParse(normalizedEmail).success) {
    const rows = await db.$queryRaw<Array<{ userId: string }>>`
      SELECT userId FROM AccountSecurity WHERE email = ${normalizedEmail} COLLATE NOCASE
    `;
    for (const row of rows) {
      if (seen.has(row.userId)) continue;
      const user = await db.user.findUnique({ where: { id: row.userId } });
      if (user) {
        candidates.push({ user, matchedBy: "EMAIL" });
        seen.add(user.id);
      }
    }
  }

  return candidates;
}

/**
 * 固定占位哈希：候选为空时也执行一次 scrypt 校验，
 * 缩小“账号不存在”与“密码错误”的响应时间差（不改变任何业务结果）。
 */
export const LOGIN_TIMING_EQUALIZER_HASH =
  "scrypt$a8c9bd7c21a2b3ef2dccf55c3a56cb61$e3969824e43535efaed685fc8b02405bfaaa5446005c4a0fb8b4e60a7b9c63292da95899aab65ce75fac42a3b47c4f3dcf1ccfbbfd8fcbb863ef7941a06879c6";
