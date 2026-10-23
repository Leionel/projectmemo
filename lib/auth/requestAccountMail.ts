import { z } from "zod";
import { db } from "@/lib/db";
import { accountRequestBody, accountError } from "@/lib/auth/accountRequest";
import {
  emailSchema,
  sendAccountToken,
  type AccountTokenPurpose,
} from "@/lib/auth/accountTokens";
import { requireAccountMail } from "@/lib/auth/mail";
import { enforceAccountRateLimit } from "@/lib/auth/registration";

export async function requestAccountMail(
  request: Request,
  purpose: AccountTokenPurpose,
) {
  try {
    requireAccountMail();
    const { email } = z
      .strictObject({ email: emailSchema })
      .parse(await accountRequestBody(request, "mail-request"));
    await enforceAccountRateLimit("mail-recipient", email, 3, 30 * 60_000);
    const account = await db.accountSecurity.findUnique({ where: { email } });
    if (account && (purpose !== "VERIFY_EMAIL" || !account.emailVerifiedAt)) {
      try {
        await sendAccountToken(account.userId, email, purpose);
      } catch {
        /* Same response protects account existence; failed tokens are revoked. */
      }
    }
    return Response.json(
      {
        message:
          "如果邮箱与账号匹配，我们会尝试发送邮件。请检查收件箱和垃圾邮件，未收到时稍后重试。",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return accountError(error);
  }
}
