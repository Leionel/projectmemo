import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { answerProjectQuestion, getProjectChat } from "@/lib/services/copilotService";
import { agentChatSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const {user}=await authorizeProjectAccess(request, id);
    return Response.json({ messages: await getProjectChat(id,user.id,new URL(request.url).searchParams.get("sourceRunId")?.slice(0,128)) },{headers:{"cache-control":"no-store"}});
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, session } = await authorizeProjectAccess(request, id);
    const input = agentChatSchema.parse(await request.json());
    return Response.json(await answerProjectQuestion(id, input.message, { userId: user.id, sessionId: session.id },input.requestId));
  } catch (error) {
    return apiError(error);
  }
}
