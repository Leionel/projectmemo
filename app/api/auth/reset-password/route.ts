import { z } from "zod";
import { accountRequestBody, accountError } from "@/lib/auth/accountRequest";
import { consumeAccountToken, tokenSchema } from "@/lib/auth/accountTokens";
export const runtime = "nodejs";
const schema = z.strictObject({ token: tokenSchema, password: z.string().min(10, "密码至少需要 10 个字符").max(128).refine(value => value.trim().length > 0, "密码不能全部为空格"), confirmPassword: z.string().max(128) }).refine(value => value.password === value.confirmPassword, { message: "两次输入的密码不一致", path: ["confirmPassword"] });
export async function POST(request: Request) {
  try {
    const input = schema.parse(await accountRequestBody(request, "reset-password"));
    await consumeAccountToken(input.token, "RESET_PASSWORD", input.password);
    return Response.json({ message: "密码已更新，请使用新密码登录。原有登录状态已退出。" }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return accountError(error); }
}
