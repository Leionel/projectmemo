import { db } from "@/lib/db";
import { conversationHttp } from "@/lib/conversation/http";
import { assertProject } from "@/lib/conversation/repository";
import { saveFocusPreference } from "@/lib/conversation/service";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{projectId: string}> }) { return conversationHttp(request, async actor => { const { projectId } = await context.params; await assertProject(actor, projectId); return { preference: await db.focusProjectPreference.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId } } }) }; }); }
export async function PATCH(request: Request, context: { params: Promise<{projectId: string}> }) { return conversationHttp(request, async actor => ({ preference: await saveFocusPreference(actor, (await context.params).projectId, await request.json()) })); }
