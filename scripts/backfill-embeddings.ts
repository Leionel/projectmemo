import { db } from "../lib/db";
import { backfillProjectEmbeddings } from "../lib/repositories/embeddings";

async function main() {
  console.log("=== Backfilling Card Embeddings for all projects ===");
  const projects = await db.project.findMany({ select: { id: true, title: true } });
  let totalIndexed = 0;

  for (const project of projects) {
    const { total, indexedCount } = await backfillProjectEmbeddings(project.id);
    console.log(`Project: [${project.title}] -> Indexed ${indexedCount} / ${total} cards`);
    totalIndexed += indexedCount;
  }

  console.log(`=== Backfill complete. Total indexed cards: ${totalIndexed} ===`);
}

main().catch(console.error);
