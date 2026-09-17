import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { createProject, listProjects } from "@/lib/repositories/projects";
import { projectCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request?: Request) {
  try {
    const req = request ?? new Request("http://localhost/api/projects");
    const { user } = await authenticateUser(req);

    // 默认只返回在册项目；`?archived=true` 只返回已归档项目。
    // 不做「一次返回全部、由客户端过滤」：跨项目聚合（提醒 / 待办 / 记忆检索）
    // 直接消费这个列表，多传一份归档数据等于让归档项目继续打扰用户。
    const archivedParam = new URL(req.url).searchParams.get("archived");
    const archived = archivedParam === "true" ? "only" : archivedParam === "include" ? "include" : "exclude";

    const projects = await listProjects(user.id, { archived });
    return Response.json({ projects });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const input = projectCreateSchema.parse(await request.json());
    const project = await createProject(input);

    // 自动将当前用户作为 OWNER 建立项目归属
    await db.projectMembership.create({
      data: {
        userId: user.id,
        projectId: project.id,
        role: "OWNER",
      },
    });

    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
