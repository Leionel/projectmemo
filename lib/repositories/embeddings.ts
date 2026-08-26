import { db } from "@/lib/db";
import { computeContentHash, getEmbedding } from "@/lib/memory/embedding";

interface PreferredEmbeddingIdentity {
  provider: string;
  model: string;
  dimensions: number;
  isMock: boolean;
}

export async function ensureCardEmbedding(
  card: { id: string; title: string; summary: string; keywords: string[] | unknown },
  preferred?: PreferredEmbeddingIdentity,
) {
  const keywordsStr = Array.isArray(card.keywords) ? card.keywords.join(" ") : "";
  const fullText = `${card.title}\n${card.summary}\n${keywordsStr}`;
  const contentHash = computeContentHash(fullText);

  // 检查是否已有最新哈希的 Embedding
  const existing = await db.cardEmbedding.findUnique({
    where: { cardId: card.id },
  });

  const providerCompatible = !preferred || preferred.isMock || (
    existing?.provider === preferred.provider &&
    existing?.model === preferred.model &&
    existing?.dimensions === preferred.dimensions
  );
  if (existing && existing.contentHash === contentHash && providerCompatible) {
    return existing;
  }

  const embeddingResult = await getEmbedding(fullText);

  // A transient provider outage must not replace a valid remote index with the
  // deterministic offline representation. Keep it so the next request retries.
  if (existing && preferred && !preferred.isMock && embeddingResult.isMock) {
    return existing;
  }

  return db.cardEmbedding.upsert({
    where: { cardId: card.id },
    create: {
      cardId: card.id,
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
      vectorJson: JSON.stringify(embeddingResult.vector),
      contentHash,
    },
    update: {
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
      vectorJson: JSON.stringify(embeddingResult.vector),
      contentHash,
    },
  });
}

export async function getCardEmbeddingsForProject(projectId: string) {
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    include: { embedding: true },
    orderBy: { createdAt: "desc" },
  });

  const validCards: Array<{
    card: typeof cards[0];
    vector: number[];
  }> = [];

  for (const card of cards) {
    if (card.embedding?.vectorJson) {
      try {
        const vector = JSON.parse(card.embedding.vectorJson) as number[];
        validCards.push({ card, vector });
      } catch {
        // ignore parse error
      }
    }
  }

  return validCards;
}

export async function backfillProjectEmbeddings(projectId: string) {
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    select: { id: true, title: true, summary: true, keywords: true },
  });

  let indexedCount = 0;
  for (const card of cards) {
    await ensureCardEmbedding(card);
    indexedCount++;
  }

  return { total: cards.length, indexedCount };
}
