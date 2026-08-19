import { apiError } from "@/lib/api";
import { processCapture } from "@/lib/services/captureService";
import { captureCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = captureCreateSchema.parse(await request.json());
    return Response.json({ card: await processCapture(id, input.rawText, input.sourceType) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
