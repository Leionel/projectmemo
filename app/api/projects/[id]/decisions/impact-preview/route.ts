import { NextRequest, NextResponse } from "next/server";
import { analyzeChangeImpact } from "@/lib/services/changeImpactService";
import { apiError } from "@/lib/api";
import { z } from "zod";

export const runtime = "nodejs";

const impactPreviewSchema = z.object({
  newFactText: z.string().trim().min(5, "变更事实至少 5 个字"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const json = await request.json();
    const { newFactText } = impactPreviewSchema.parse(json);
    const proposal = await analyzeChangeImpact(projectId, newFactText);
    return NextResponse.json(proposal, { status: 200 });
  } catch (error) {
    return apiError(error);
  }
}
