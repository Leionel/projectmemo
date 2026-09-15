import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { confirmChangeImpact } from "@/lib/services/changeImpactService";
import { apiError } from "@/lib/api";
import { z } from "zod";

export const runtime = "nodejs";

const confirmChangeSchema = z.object({
  proposalId: z.string(),
  newFactText: z.string().trim().min(5),
  supersededCardId: z.string().nullable().optional(),
  cancelledActionIds: z.array(z.string()).optional(),
  newActions: z.array(z.object({
    title: z.string().trim().min(1),
    description: z.string().default(""),
    priority: z.number().default(3),
  })).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    await authorizeProjectAccess(request, projectId);
    const json = await request.json();
    const input = confirmChangeSchema.parse(json);
    const result = await confirmChangeImpact(projectId, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
