import { apiError, AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  registrationSchema,
  enforceAccountRateLimit,
} from "@/lib/auth/registration";
import { requireAccountMail } from "@/lib/auth/mail";
import { sendAccountToken } from "@/lib/auth/accountTokens";
import { accountRequestBody } from "@/lib/auth/accountRequest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAccountMail();
    const input = registrationSchema.parse(
      await accountRequestBody(request, "register"),
    );
    await enforceAccountRateLimit(
      "mail-recipient",
      input.email,
      3,
      30 * 60_000,
    );
    // Never allow a public signup to reserve an account later bound by demo setup.
    const reserved = [
      "contest-demo",
      process.env.DEMO_USERNAME?.trim().toLowerCase(),
    ];
    if (reserved.includes(input.username)) {
      throw new AppError(
        "USERNAME_UNAVAILABLE",
        "这个账号或邮箱不可用，请更换或使用找回密码",
        409,
      );
    }
    // Also respect legacy accounts that used uppercase before public signup existed.
    const existing = await db.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM User WHERE username = ${input.username} COLLATE NOCASE LIMIT 1`;
    if (existing.length)
      throw new AppError(
        "USERNAME_UNAVAILABLE",
        "这个账号或邮箱不可用，请更换或使用找回密码",
        409,
      );
    const passwordHash = await hashPassword(input.password);
    // New accounts have no memberships, no session and no cloud quota.
    const user = await db.user.create({
      data: {
        username: input.username,
        displayName: input.username,
        passwordHash,
        security: { create: { email: input.email } },
      },
      select: { id: true, username: true, displayName: true },
    });
    await sendAccountToken(user.id, input.email, "VERIFY_EMAIL");
    return Response.json(
      {
        verificationRequired: true,
        message: "验证邮件已发送，请打开邮件中的链接后登录",
      },
      {
        status: 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return apiError(
        new AppError(
          "USERNAME_UNAVAILABLE",
          "这个账号或邮箱不可用，请更换或使用找回密码",
          409,
        ),
      );
    }
    const response = apiError(error);
    if (error instanceof AppError && error.status === 429) {
      response.headers.set(
        "Retry-After",
        String((error.details as { retryAfter: number }).retryAfter),
      );
    }
    return response;
  }
}
