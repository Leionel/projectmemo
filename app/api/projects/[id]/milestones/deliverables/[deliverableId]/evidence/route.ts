import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmDeliverableEvidence } from "@/lib/services/milestoneService";

const requestSchema = z.object({
  evidenceType: z.string().trim().min(1).max(60),
  cardId: z.string().trim().min(1).nullable().optional(),
  attachmentId: z.string().trim().min(1).nullable().optional(),
  confirmed: z.boolean(),
}).refine((input) => Boolean(input.cardId || input.attachmentId), {
  message: "cardId or attachmentId is required",
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> },
) {
  try {
    const { id: projectId, deliverableId } = await params;
    const input = requestSchema.parse(await request.json());
    const evidence = await confirmDeliverableEvidence({ projectId, deliverableId, ...input });
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid evidence" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Evidence association failed";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
