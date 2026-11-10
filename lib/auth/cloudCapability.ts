import { shanghaiDay } from "@/lib/time/shanghai";
import { db } from "@/lib/db";
import { getChatProviderConfig } from "@/lib/config/provider";

/** 只读资格快照，不请求 provider、不预占配额，也不把配置存在当作服务健康。 */
export async function cloudCapability(userId: string) {
  const base = { networkHealth: "UNTESTED" as const, remainingToday: null as number | null };
  if (process.env.LLM_MODE !== "openai-compatible") return { ...base, available: false, reason: "RULE_MODE" };
  try { getChatProviderConfig(); } catch { return { ...base, available: false, reason: "NOT_CONFIGURED" }; }
  const account = await db.accountSecurity.findUnique({ where: { userId } });
  if (!account) return { ...base, available: true, reason: "CONFIGURED_LEGACY_ACCOUNT" };
  if (!account.emailVerifiedAt || account.dailyCloudLimit <= 0) return { ...base, available: false, reason: "ACCOUNT_NOT_ELIGIBLE", remainingToday: 0 };
  const usage = await db.accountCloudUsage.findUnique({ where: { userId_day: { userId, day: shanghaiDay() } } });
  const remainingToday = Math.max(0, account.dailyCloudLimit - (usage?.used ?? 0));
  return { ...base, remainingToday, available: remainingToday > 0, reason: remainingToday > 0 ? "CONFIGURED" : "DAILY_QUOTA_EXHAUSTED" };
}
