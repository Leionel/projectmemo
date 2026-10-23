import { z } from "zod";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/session";

export const registrationSchema = z
  .strictObject({
    email: z.string().trim().toLowerCase().email("请输入有效邮箱地址").max(254),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "账号至少需要 3 个字符")
      .max(32, "账号最多 32 个字符")
      .regex(
        /^[a-z0-9][a-z0-9_-]*$/,
        "账号请使用字母、数字、下划线或短横线，并以字母或数字开头",
      ),
    password: z
      .string()
      .min(10, "密码至少需要 10 个字符")
      .max(128, "密码最多 128 个字符")
      .refine((value) => value.trim().length > 0, "密码不能全部为空格"),
    confirmPassword: z.string().max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

/** Persistent buckets count every attempt and cannot be reset by restarting Node. */
export async function enforceAccountRateLimit(
  scope: string,
  identifier: string,
  maximum = 5,
  windowMs = 600_000,
): Promise<void> {
  const key = hashToken(scope + ":" + identifier);
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await tx.authRequestLimit.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const record = await tx.authRequestLimit.upsert({
      where: { key },
      create: { key, count: 0, expiresAt: new Date(now.getTime() + windowMs) },
      update: {},
    });
    const updated = await tx.authRequestLimit.updateMany({
      where: { key, count: { lt: maximum } },
      data: { count: { increment: 1 } },
    });
    return {
      allowed: updated.count === 1,
      retryAfter: Math.max(
        1,
        Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000),
      ),
    };
  });
  if (!result.allowed)
    throw new AppError("ACCOUNT_RATE_LIMITED", "请求较多，请稍后再试", 429, {
      retryAfter: result.retryAfter,
    });
}
