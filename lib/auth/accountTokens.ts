import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { generateToken, hashToken } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { requireAccountMail, sendAccountMail } from "@/lib/auth/mail";

export const tokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "链接无效，请重新申请邮件");
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("请输入有效邮箱地址")
  .max(254);
export type AccountTokenPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";

export async function sendAccountToken(
  userId: string,
  email: string,
  purpose: AccountTokenPurpose,
): Promise<void> {
  const { baseUrl } = requireAccountMail();
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (purpose === "VERIFY_EMAIL" ? 24 * 3600_000 : 30 * 60_000),
  );
  const record = await db.$transaction(async (tx) => {
    await tx.accountToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    return tx.accountToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
    });
  });
  const verification = purpose === "VERIFY_EMAIL";
  const url =
    baseUrl +
    (verification ? "/verify-email" : "/reset-password") +
    "?token=" +
    token;
  try {
    await sendAccountMail({
      idempotencyKey: "account-token/" + record.id,
      to: email,
      subject: verification ? "验证你的忆程邮箱" : "重设你的忆程密码",
      text:
        (verification
          ? "请打开以下链接，验证你的忆程账号邮箱。链接在 24 小时内有效。"
          : "请打开以下链接，设置新的忆程密码。链接在 30 分钟内有效。") +
        "\n\n" +
        url +
        "\n\n如果这不是你的操作，请忽略这封邮件。不要将链接转发给他人。",
    });
  } catch (error) {
    await db.accountToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    throw error;
  }
}

export async function consumeAccountToken(
  token: string,
  purpose: AccountTokenPurpose,
  password?: string,
): Promise<void> {
  const tokenHash = hashToken(tokenSchema.parse(token));
  const passwordHash =
    purpose === "RESET_PASSWORD" && password
      ? await hashPassword(password)
      : undefined;
  const now = new Date();
  await db.$transaction(async (tx) => {
    const record = await tx.accountToken.findUnique({ where: { tokenHash } });
    if (
      !record ||
      record.purpose !== purpose ||
      record.usedAt ||
      record.expiresAt <= now
    ) {
      throw new AppError(
        "ACCOUNT_LINK_EXPIRED",
        "链接无效、已使用或已过期，请重新申请邮件",
        422,
      );
    }
    const used = await tx.accountToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (used.count !== 1)
      throw new AppError(
        "ACCOUNT_LINK_EXPIRED",
        "链接已使用，请重新申请邮件",
        422,
      );
    if (purpose === "VERIFY_EMAIL") {
      await tx.accountSecurity.update({
        where: { userId: record.userId },
        data: { emailVerifiedAt: now },
      });
    } else {
      if (!passwordHash)
        throw new AppError("INVALID_PASSWORD", "请输入新密码", 422);
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.accountToken.updateMany({
        where: { userId: record.userId, purpose, usedAt: null },
        data: { usedAt: now },
      });
    }
  });
}
