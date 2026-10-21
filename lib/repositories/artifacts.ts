import { db } from "@/lib/db";
import type { ArtifactTypeValue } from "@/lib/types";
import type { ArtifactType, Prisma } from "@/lib/generated/prisma/client";

export async function listArtifacts(projectId: string) {
  return db.generatedArtifact.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
}

export async function saveArtifact(
  projectId: string,
  artifactType: ArtifactTypeValue,
  content: string,
  sourceRefs?: Prisma.InputJsonValue,
  claims?: Prisma.InputJsonValue,
) {
  return db.$transaction(tx=>saveArtifactInTx(tx,projectId,artifactType,content,sourceRefs,claims));
}
export async function saveArtifactInTx(tx:Prisma.TransactionClient,projectId:string,artifactType:ArtifactTypeValue,content:string,sourceRefs?:Prisma.InputJsonValue,claims?:Prisma.InputJsonValue){
 const artifact=await tx.generatedArtifact.create({data:{projectId,artifactType:artifactType as ArtifactType,content,...(sourceRefs!==undefined?{sourceRefs}:{}),...(claims!==undefined?{claims}:{})}});
 await tx.project.update({where:{id:projectId},data:{updatedAt:new Date()}});return artifact;
}
