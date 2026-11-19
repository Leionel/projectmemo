import { AppError } from "@/lib/api";
import type { Source } from "./contracts";
import { validateResearchOutput } from "./researchOutputSchema";

/** Shared source and block invariants for report revisions and private stage artifacts. */
export function validateOutputContent(input: unknown, available: Source[]) {
  const body = validateResearchOutput(input, available);
  if (new Set(body.blocks.map(block => block.blockId)).size !== body.blocks.length)
    throw new AppError("INVALID_BLOCKS", "段落编号不能重复", 422);
  for (const block of body.blocks) {
    if (block.sourceIds.some(id => !available.some(source => source.id === id)))
      throw new AppError("SOURCE_NOT_FOUND", "草稿引用了未读取的来源", 409);
    if (block.kind !== "INFERENCE" && !block.sourceIds.length)
      throw new AppError("SOURCE_REQUIRED", "观察和外部参考必须保留来源", 422);
    if (block.kind === "PROJECT_OBSERVATION" && block.sourceIds.some(id => {
      const source = available.find(item => item.id === id)!;
      return source.kind !== "PROJECT" || source.entityType === "ARTIFACT" && source.knowledgeClass !== "PROJECT_OBSERVATION";
    })) throw new AppError("EXTERNAL_NOT_PROJECT_FACT", "外部资料不能当作项目实测", 422);
  }
  return body;
}
