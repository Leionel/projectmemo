import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createProjectMilestone, listProjectMilestones } from "@/lib/services/milestoneService";
import { requireProject } from "@/lib/repositories/projects";
import { apiError } from "@/lib/api";
import { milestoneCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await authorizeProjectAccess(request, projectId);
    await requireProject(projectId);
    const milestones = await listProjectMilestones(projectId);
    return NextResponse.json(milestones);
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await authorizeProjectAccess(request, projectId);
    await requireProject(projectId);

    const body = milestoneCreateSchema.parse(await request.json());
    const milestone = await createProjectMilestone({ projectId, ...body });

    return NextResponse.json(milestone, { status: 201 });
  } catch (error) { return apiError(error); }
}
