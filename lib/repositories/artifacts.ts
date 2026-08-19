import { db } from "@/lib/db";
import type { ArtifactTypeValue } from "@/lib/types";
import type { ArtifactType } from "@/lib/generated/prisma/client";

export async function listArtifacts(projectId: string) {
  return db.generatedArtifact.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
}

export async function saveArtifact(projectId: string, artifactType: ArtifactTypeValue, content: string) {
  return db.$transaction(async (tx) => {
    const artifact = await tx.generatedArtifact.create({
      data: { projectId, artifactType: artifactType as ArtifactType, content },
    });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return artifact;
  });
}
