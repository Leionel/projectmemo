import { hashPassword } from "../lib/auth/password";
import { E2E_DATABASE_URL, E2E_EMAIL, E2E_PASSWORD, E2E_UNVERIFIED_EMAIL, E2E_USERNAME } from "./e2e-env";

if (process.env.DATABASE_URL !== E2E_DATABASE_URL || process.env.LLM_MODE !== "mock") {
  throw new Error("仅允许在隔离 E2E 数据库和 mock 模式创建测试身份");
}
const { db } = await import("../lib/db");

const SEED_PROJECT_TITLES = [
  "人工智能创意赛 忆程 ProjectMemo 作品开发",
  "人工智能创意赛 ProjectMemo 作品开发",
];

/**
 * 为隔离 E2E 库建立独立测试身份，并把它授权到种子项目。
 *
 * 页面接入会话校验后，E2E 不能再匿名打开 /projects；
 * 也不能靠放宽断言绕过——这里补的是真实身份与真实授权。
 * 只在 setup-e2e 中调用，不进入 prisma/seed.ts。
 */
async function main() {
  const project = await db.project.findFirst({
    where: { title: { in: SEED_PROJECT_TITLES } },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });

  if (!project) {
    throw new Error("E2E 授权失败：隔离库里找不到种子项目，请先执行 seed。");
  }

  const passwordHash = await hashPassword(E2E_PASSWORD);
  const user = await db.user.upsert({
    where: { username: E2E_USERNAME },
    create: { username: E2E_USERNAME, displayName: "E2E 评审身份", passwordHash },
    update: { passwordHash },
  });

  await db.projectMembership.upsert({
    where: { userId_projectId: { userId: user.id, projectId: project.id } },
    create: { userId: user.id, projectId: project.id, role: "OWNER" },
    update: {},
  });
  // 同一账号绑定已验证邮箱：E2E 既要覆盖原用户名登录，也要覆盖“用户名或邮箱”中的邮箱路径。
  // 仅隔离 E2E 评审身份具有有界的合成调用额度，保持原有研究/接续旅程可执行。
  // E2E_ENV 的 LLM_MODE=mock；真实注册账号及下方待验证账号仍保持默认0。
  await db.accountSecurity.upsert({
    where: { userId: user.id },
    create: { userId: user.id, email: E2E_EMAIL, emailVerifiedAt: new Date(), dailyCloudLimit: 100 },
    update: { email: E2E_EMAIL, emailVerifiedAt: new Date(), dailyCloudLimit: 100 },
  });
  // 未验证邮箱账号：用于浏览器旅程验证“提示重新发信”而不是误报密码错误。
  const pending = await db.user.upsert({
    where: { username: `${E2E_USERNAME}-pending` },
    create: { username: `${E2E_USERNAME}-pending`, displayName: "E2E 待验证身份", passwordHash },
    update: { passwordHash },
  });
  await db.accountSecurity.upsert({
    where: { userId: pending.id },
    create: { userId: pending.id, email: E2E_UNVERIFIED_EMAIL, emailVerifiedAt: null },
    update: { email: E2E_UNVERIFIED_EMAIL, emailVerifiedAt: null },
  });
  const member = await db.user.upsert({ where: { username: `${E2E_USERNAME}-member` },
    create: { username: `${E2E_USERNAME}-member`, displayName: "E2E 普通成员", passwordHash }, update: { passwordHash } });
  await db.projectMembership.upsert({ where: { userId_projectId: { userId: member.id, projectId: project.id } },
    create: { userId: member.id, projectId: project.id, role: "MEMBER" }, update: { role: "MEMBER" } });

  console.log(`[e2e setup] auth identity ready: ${E2E_USERNAME} -> ${project.title} (${project.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
