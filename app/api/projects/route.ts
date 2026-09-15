import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repositories/projects";
import { projectCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request?: Request) {
  try {
    const req = request ?? new Request("http://localhost/api/projects");
    const { user } = await authenticateUser(req);
    const memberships = await db.projectMembership.findMany({
      where: { userId: user.id },
      include: { project: true },
      orderBy: { createdAt: "desc" },
    });
    const projects = memberships.map((m) => m.project);
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
