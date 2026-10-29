import { z } from "zod";
import { accountRequestBody, accountError } from "@/lib/auth/accountRequest";
import { consumeAccountToken, tokenSchema } from "@/lib/auth/accountTokens";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { token } = z.strictObject({ token: tokenSchema }).parse(await accountRequestBody(request, "verify"));
    await consumeAccountToken(token, "VERIFY_EMAIL");
    return Response.json({ message: "邮箱已验证，现在可以登录" }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return accountError(error); }
}
