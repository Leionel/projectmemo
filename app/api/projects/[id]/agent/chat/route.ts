import { apiError } from "@/lib/api";
import { answerProjectQuestion, getProjectChat } from "@/lib/services/copilotService";
import { agentChatSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ messages: await getProjectChat(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = agentChatSchema.parse(await request.json());
    return Response.json(await answerProjectQuestion(id, input.message));
  } catch (error) {
    return apiError(error);
  }
}
