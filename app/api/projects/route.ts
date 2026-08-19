import { apiError } from "@/lib/api";
import { createProject, listProjects } from "@/lib/repositories/projects";
import { projectCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json({ projects: await listProjects() }); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = projectCreateSchema.parse(await request.json());
    return Response.json({ project: await createProject(input) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
