import { conversationHttp } from "@/lib/conversation/http";
import { previewConversationResume } from "@/lib/conversation/missionCommands";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string;missionId:string}>}){return conversationHttp(request,async actor=>{const p=await context.params;return previewConversationResume(actor,p.id,p.missionId);});}
