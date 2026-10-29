import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { executeCopilotTool } from "@/lib/services/copilotService";
import { agentToolConfirmSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, session } = await authorizeProjectAccess(request, id);
    const input = agentToolConfirmSchema.parse(await request.json());
    return Response.json(await executeCopilotTool(id, input, { userId: user.id, sessionId: session.id }));
  } catch (error) {
    return apiError(error);
  }
}
