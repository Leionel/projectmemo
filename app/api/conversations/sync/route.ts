import { conversationHttp } from "@/lib/conversation/http";
import { syncWorkspaceAnchors } from "@/lib/conversation/anchorService";
export const runtime = "nodejs";
export async function POST(request: Request) { return conversationHttp(request, syncWorkspaceAnchors); }
