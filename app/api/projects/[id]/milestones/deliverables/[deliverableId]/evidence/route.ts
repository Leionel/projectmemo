import { NextRequest, NextResponse } from "next/server";
import { confirmDeliverableEvidence } from "@/lib/services/milestoneService";
import { apiError } from "@/lib/api";
import { deliverableEvidenceInputSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> },
) {
  try {
    const { id: projectId, deliverableId } = await params;
    const input = deliverableEvidenceInputSchema.parse(await request.json());
    const evidence = await confirmDeliverableEvidence({ projectId, deliverableId, ...input });
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) { return apiError(error); }
}
