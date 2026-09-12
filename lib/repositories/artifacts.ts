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
) {
  return db.$transaction(async (tx) => {
    const artifact = await tx.generatedArtifact.create({
      data: {
        projectId,
        artifactType: artifactType as ArtifactType,
        content,
        // 仅系统生成路径携带证据引用快照；人工编辑版本不传，保持无法逐句回溯的诚实语义
        ...(sourceRefs !== undefined ? { sourceRefs } : {}),
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return artifact;
  });
}
