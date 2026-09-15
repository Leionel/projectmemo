import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export async function createTestAuth(projectId?: string) {
  const username = `test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const passwordHash = await hashPassword("testPassword123");
  const user = await db.user.create({
    data: {
      username,
      displayName: "集成测试用户",
      passwordHash,
    },
  });

  if (projectId) {
    await db.projectMembership.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      create: { userId: user.id, projectId, role: "OWNER" },
      update: {},
    });
  }

  const { token } = await createSession(user.id);

  return {
    user,
    token,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    bindProject: async (targetProjectId: string) => {
      await db.projectMembership.upsert({
        where: { userId_projectId: { userId: user.id, projectId: targetProjectId } },
        create: { userId: user.id, projectId: targetProjectId, role: "OWNER" },
        update: {},
      });
    },
  };
}
