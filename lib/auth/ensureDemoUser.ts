import { db } from "@/lib/db";
import { hashPassword } from "./password";

const FALLBACK_USERNAME = "contest-demo";
const FALLBACK_PASSWORD = "contest-demo-2026";

/**
 * 演示账号初始化。
 *
 * 两个约束来自真实风险，不是风格偏好：
 * 1. 未显式开启时不创建任何账号——登录接口每次请求都会走到这里，
 *    无条件初始化等于在任何部署上凭空生成一个公开凭据。
 * 2. 绑定项目必须显式指定 DEMO_PROJECT_ID。旧实现在缺省时会取库里
 *    最早创建的项目并授予 OWNER，把真实项目资料授权给公开演示账号。
 *
 * 本函数只新增，不删除或修改既有账号与成员关系；历史数据归属需单独审计。
 */
function readFlag(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
}

export function isDemoUserEnabled(): boolean {
  return readFlag("DEMO_USER_ENABLED") ?? process.env.NODE_ENV !== "production";
}

export async function ensureDemoUser(): Promise<{
  user: { id: string; username: string; displayName: string };
  projectId?: string;
} | null> {
  if (!isDemoUserEnabled()) {
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const username = process.env.DEMO_USERNAME?.trim() || FALLBACK_USERNAME;
  const displayName = process.env.DEMO_DISPLAY_NAME?.trim() || "复赛演示账号";

  let user = await db.user.findUnique({
    where: { username },
  });

  if (!user) {
    let passwordHash = process.env.DEMO_PASSWORD_HASH?.trim();
    if (!passwordHash) {
      const demoPassword = process.env.DEMO_PASSWORD?.trim();
      if (!demoPassword) {
        if (isProduction) {
          // 生产环境不接受源码内置口令：那是公开在登录页上的凭据。
          console.error("[auth] 演示账号已启用但缺少 DEMO_PASSWORD 或 DEMO_PASSWORD_HASH，跳过初始化。");
          return null;
        }
        passwordHash = await hashPassword(FALLBACK_PASSWORD);
      } else {
        passwordHash = await hashPassword(demoPassword);
      }
    }

    user = await db.user.create({
      data: {
        username,
        displayName,
        passwordHash,
      },
    });
  }

  const targetProjectId = process.env.DEMO_PROJECT_ID?.trim();
  if (!targetProjectId) {
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
  }

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

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    projectId: targetProjectId,
  };
}
