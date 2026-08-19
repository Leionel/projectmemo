import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { generateArtifactWithLLM } from "@/lib/agent/llmAgent";
import { cardToDraft, generateMockArtifact } from "@/lib/generators/templates";
import { saveArtifact } from "@/lib/repositories/artifacts";
import { requireProject } from "@/lib/repositories/projects";
import type { ArtifactTypeValue } from "@/lib/types";
import { artifactContentSchema } from "@/lib/validation/schemas";

async function loadArtifactContext(projectId: string) {
  const project = await requireProject(projectId);
  const rawCards = await db.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  if (!rawCards.length) throw new AppError("NO_KNOWLEDGE_CARDS", "请先输入至少一条项目记录，再生成成果", 400);
  return { project, cards: rawCards.map(cardToDraft) };
}

export async function generateArtifact(projectId: string, artifactType: ArtifactTypeValue) {
  const { project, cards } = await loadArtifactContext(projectId);
  let content: string | null = null;
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      content = await generateArtifactWithLLM({ project, artifactType, cards });
    } catch (error) {
      console.warn("LLM artifact generation failed; using mock template", error);
    }
  }
  content ??= generateMockArtifact(artifactType, { project, cards });
  return saveArtifact(projectId, artifactType, content);
}

export async function saveEditedArtifactVersion(projectId: string, artifactType: ArtifactTypeValue, content: string) {
  await loadArtifactContext(projectId);
  return saveArtifact(projectId, artifactType, artifactContentSchema.parse(content));
}
