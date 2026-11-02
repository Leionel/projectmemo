import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { recordProcessingConsent } from "@/lib/services/projectIntakeService";
import { z } from "zod";

export const runtime = "nodejs";

/** 显式的云处理同意。它只覆盖这份材料预览，不沿用到项目内的其它能力。 */
export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    const raw = await request.text();
    const body = z.object({ consent: z.boolean().default(true) }).strict().parse(raw.trim() ? JSON.parse(raw) : {});
    return Response.json(await recordProcessingConsent({ userId: user.id, sessionId: session.id }, draftId, body.consent));
  } catch (error) {
    return apiError(error);
  }
}
