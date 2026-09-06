import { db } from "../lib/db";
import { getEmbeddingProviderConfig } from "../lib/config/provider";
import { backfillProjectEmbeddings } from "../lib/repositories/embeddings";

async function main() {
  if (process.env.SEMANTIC_MEMORY_ENABLED !== "true") {
    throw new Error("Embedding backfill requires SEMANTIC_MEMORY_ENABLED=true.");
  }
  if (!getEmbeddingProviderConfig()) {
    throw new Error("Embedding backfill requires a configured OpenAI-compatible embeddings provider (EMBEDDING_BASE_URL and EMBEDDING_MODEL_NAME for a DeepSeek chat setup).");
  }
  const projectId = process.argv.slice(2).find((value) => value && !value.startsWith("-"));
  if (!projectId) {
    throw new Error("Usage: npm run db:backfill-embeddings -- <projectId>");
  }
  const result = await backfillProjectEmbeddings(projectId);
  console.log(JSON.stringify({ projectId, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
