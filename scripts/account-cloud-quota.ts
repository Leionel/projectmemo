import { db } from "../lib/db";

function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const username = argument("--username");
const limit = Number(argument("--daily-limit"));
try {
  if (!username || !Number.isInteger(limit) || limit < 0 || limit > 1000) throw new Error("用法：npm run auth:cloud-quota -- --username 账号 --daily-limit 0至1000 [--confirm]");
  const user = await db.user.findUnique({ where: { username }, include: { security: true } });
  if (!user?.security) throw new Error("未找到公开注册账号；此工具不改变旧账号和比赛演示账号。");
  if (!user.security.emailVerifiedAt && limit > 0) throw new Error("请先完成邮箱验证。");
  if (!process.argv.includes("--confirm")) console.log("预览：" + username + "，每日额度 " + user.security.dailyCloudLimit + " → " + limit + "。确认修改时加 --confirm。");
  else { await db.accountSecurity.update({ where: { userId: user.id }, data: { dailyCloudLimit: limit } }); console.log("每日云调用额度已更新为 " + limit + "；已有使用次数保留。"); }
} catch (error) { console.error(error instanceof Error ? error.message : "更新失败"); process.exitCode = 1; }
finally { await db.$disconnect(); }
