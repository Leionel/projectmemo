import { db } from "../lib/db";
import { hashPassword } from "../lib/auth/password";
import { E2E_PASSWORD, E2E_USERNAME } from "./e2e-env";

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

  console.log(`[e2e setup] auth identity ready: ${E2E_USERNAME} -> ${project.title} (${project.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
