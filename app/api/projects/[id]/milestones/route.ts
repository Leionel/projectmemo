import { NextRequest, NextResponse } from "next/server";
import { createProjectMilestone, ensureDefaultMilestones, listProjectMilestones } from "@/lib/services/milestoneService";
import { requireProject } from "@/lib/repositories/projects";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await requireProject(projectId);
    await ensureDefaultMilestones(projectId);
    const milestones = await listProjectMilestones(projectId);
    return NextResponse.json(milestones);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch milestones";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await requireProject(projectId);

    const body = await request.json();
    const milestone = await createProjectMilestone({
      projectId,
      title: body.title,
      targetDate: body.targetDate,
      deliverables: body.deliverables,
    });

    return NextResponse.json(milestone, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create milestone";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
