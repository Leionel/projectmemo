import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getProjectAgentContext, setProjectAgentFocus } from "@/lib/services/projectAgentContextService";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;const {user}=await authorizeProjectAccess(request,id);return Response.json({context:await getProjectAgentContext(user.id,id)},{headers:{"cache-control":"no-store"}});}catch(error){return apiError(error);}
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;const {user}=await authorizeProjectAccess(request,id);const input=z.object({missionId:z.string().min(1).nullable()}).strict().parse(await request.json());return Response.json({context:await setProjectAgentFocus(user.id,id,input.missionId)},{headers:{"cache-control":"no-store"}});}catch(error){return apiError(error);}
}
