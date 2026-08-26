import { db } from "../lib/db";
import { backfillProjectEmbeddings } from "../lib/repositories/embeddings";

async function main() {
  if (process.env.SEMANTIC_MEMORY_ENABLED !== "true" || process.env.LLM_MODE !== "openai-compatible" || !process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
    throw new Error("Embedding backfill requires SEMANTIC_MEMORY_ENABLED=true and a configured OpenAI-compatible provider.");
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
