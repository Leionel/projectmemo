import {apiError} from "@/lib/api";
import {authorizeProjectAccess} from "@/lib/auth/guard";
import {listDeploymentConnections,createDeploymentConnection} from "@/lib/sensing/deploymentConnections";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params,{user}=await authorizeProjectAccess(request,id);return Response.json(await listDeploymentConnections(user.id,id),{headers:{"cache-control":"no-store"}});}catch(error){return apiError(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params,{user}=await authorizeProjectAccess(request,id);return Response.json(await createDeploymentConnection(user.id,id,await request.json()),{headers:{"cache-control":"no-store"}});}catch(error){return apiError(error);}
}
