import {apiError} from "@/lib/api";
import {authorizeProjectAccess} from "@/lib/auth/guard";
import {controlDeploymentConnection} from "@/lib/sensing/deploymentConnections";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;connectionId:string}>}){
  try{const {id,connectionId}=await params,{user}=await authorizeProjectAccess(request,id);return Response.json(await controlDeploymentConnection(user.id,id,connectionId,await request.json()),{headers:{"cache-control":"no-store"}});}catch(error){return apiError(error);}
}
