import { db } from "@/lib/db";
import { hashPassword } from "./password";

/**
 * 确保环境中的复赛演示账号存在，并绑定对应项目。
 * 账号与哈希优先由环境变量注入。
 */
export async function ensureDemoUser(): Promise<{
  user: { id: string; username: string; displayName: string };
  projectId?: string;
}> {
  const username = process.env.DEMO_USERNAME?.trim() || "contest-demo";
  const displayName = process.env.DEMO_DISPLAY_NAME?.trim() || "复赛演示账号";

  let user = await db.user.findUnique({
    where: { username },
  });

  if (!user) {
    let passwordHash = process.env.DEMO_PASSWORD_HASH?.trim();
    if (!passwordHash) {
      const demoPassword = process.env.DEMO_PASSWORD?.trim() || "contest-demo-2026";
      passwordHash = await hashPassword(demoPassword);
    }

    user = await db.user.create({
      data: {
        username,
        displayName,
        passwordHash,
      },
    });
  }

  // 绑定演示项目
  let targetProjectId = process.env.DEMO_PROJECT_ID?.trim();
  if (!targetProjectId) {
    const firstProject = await db.project.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    targetProjectId = firstProject?.id;
  }

  if (targetProjectId) {
    const projectExists = await db.project.findUnique({
      where: { id: targetProjectId },
      select: { id: true },
    });

    if (projectExists) {
      await db.projectMembership.upsert({
        where: {
          userId_projectId: {
            userId: user.id,
            projectId: targetProjectId,
          },
        },
        create: {
          userId: user.id,
          projectId: targetProjectId,
          role: "OWNER",
        },
        update: {},
      });
    }
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    projectId: targetProjectId,
  };
}
