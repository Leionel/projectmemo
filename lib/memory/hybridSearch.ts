import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { cosineSimilarity, getEmbedding } from "@/lib/memory/embedding";
import { ensureCardEmbedding } from "@/lib/repositories/embeddings";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import type { CardSearchResult, KnowledgeTypeValue } from "@/lib/types";

export interface HybridSearchOptions {
  projectId: string;
  query: string;
  limit?: number;
  typeFilter?: KnowledgeTypeValue | "all";
}

function computeKeywordScore(query: string, card: { title: string; summary: string; keywords: string[] }): { score: number; matchedKeywords: string[] } {
  const queryTokens = query.toLowerCase().split(/[\s,，、。！？!?]+/).filter((t) => t.length > 0);
  if (queryTokens.length === 0) return { score: 0, matchedKeywords: [] };

  const titleLower = card.title.toLowerCase();
  const summaryLower = card.summary.toLowerCase();
  const keywordsLower = card.keywords.map((k) => k.toLowerCase());

  let matchCount = 0;
  const matchedKeywords: string[] = [];

  for (const token of queryTokens) {
    let tokenMatched = false;
    if (titleLower.includes(token)) {
      matchCount += 3; // 标题匹配权重更高
      tokenMatched = true;
    }
    if (summaryLower.includes(token)) {
      matchCount += 1.5;
      tokenMatched = true;
    }
    for (let i = 0; i < keywordsLower.length; i++) {
      if (keywordsLower[i].includes(token) || token.includes(keywordsLower[i])) {
        matchCount += 2;
        matchedKeywords.push(card.keywords[i]);
        tokenMatched = true;
      }
    }
    if (tokenMatched && !matchedKeywords.includes(token)) {
      // 记录匹配的 token
    }
  }

  const normalizedScore = Math.min(1.0, matchCount / (queryTokens.length * 3));
  return { score: normalizedScore, matchedKeywords: [...new Set(matchedKeywords)] };
}

function computeRecencyScore(createdAt: Date, now: Date): number {
  const diffDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  return Math.exp(-diffDays / 30); // 30 天半衰减曲线
}

export async function searchProjectCards(options: HybridSearchOptions): Promise<CardSearchResult[]> {
  const { projectId, query, limit = 8, typeFilter } = options;
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const whereClause: Record<string, unknown> = { projectId };
  if (typeFilter && typeFilter !== "all") {
    whereClause.type = typeFilter;
  }

  const cards = await db.knowledgeCard.findMany({
    where: whereClause,
    include: { embedding: true },
    orderBy: { createdAt: "desc" },
  });

  if (cards.length === 0) {
    return [];
  }

  // 1. 获取 Query 的向量。关闭 feature flag 时严格回到旧关键词路径，
  // 避免把离线哈希向量包装成“真实语义检索”。
  const queryEmbedding = isFeatureEnabled("SEMANTIC_MEMORY_ENABLED", false)
    ? await getEmbedding(trimmedQuery)
    : null;
  const now = new Date();
  const temporalStates = await getTemporalSearchStates(projectId, cards.map((card) => card.id), now);
  const results: CardSearchResult[] = [];

  for (const card of cards) {
    const cardKeywords = Array.isArray(card.keywords) ? (card.keywords as string[]) : [];

    // Offline mode is a keyword/metadata fallback. The deterministic vector is
    // useful for repeatable tests and indexing smoke checks, but is not presented
    // to users as semantic retrieval.
    let cardVector: number[] = [];
    let cardEmbeddingProvider = card.embedding?.provider ?? null;
    let cardEmbeddingModel = card.embedding?.model ?? null;
    let cardEmbeddingDimensions = card.embedding?.dimensions ?? null;
    let embeddingCompatible = queryEmbedding !== null && !queryEmbedding.isMock &&
      cardEmbeddingProvider === queryEmbedding.provider &&
      cardEmbeddingModel === queryEmbedding.model &&
      cardEmbeddingDimensions === queryEmbedding.dimensions;
    if (embeddingCompatible && card.embedding?.vectorJson) {
      try {
        cardVector = JSON.parse(card.embedding.vectorJson);
      } catch {
        // ignore
      }
    }

    if (queryEmbedding !== null && !queryEmbedding.isMock && cardVector.length === 0) {
      const savedEmbedding = await ensureCardEmbedding({
        id: card.id,
        title: card.title,
        summary: card.summary,
        keywords: cardKeywords,
      }, queryEmbedding);
      cardEmbeddingProvider = savedEmbedding.provider;
      cardEmbeddingModel = savedEmbedding.model;
      cardEmbeddingDimensions = savedEmbedding.dimensions;
      embeddingCompatible = savedEmbedding.provider === queryEmbedding.provider &&
        savedEmbedding.model === queryEmbedding.model &&
        savedEmbedding.dimensions === queryEmbedding.dimensions;
      try {
        cardVector = JSON.parse(savedEmbedding.vectorJson);
      } catch {
        cardVector = [];
      }
    }

    // 2. 计算各维度得分
    let semanticScore = 0;
    const hasRemoteSemantic = queryEmbedding !== null && !queryEmbedding.isMock && embeddingCompatible &&
      cardVector.length > 0 && queryEmbedding.vector.length === cardVector.length;
    if (hasRemoteSemantic) {
      semanticScore = cosineSimilarity(queryEmbedding.vector, cardVector);
    }

    const { score: keywordScore, matchedKeywords } = computeKeywordScore(trimmedQuery, {
      title: card.title,
      summary: card.summary,
      keywords: cardKeywords,
    });

    const recencyScore = computeRecencyScore(card.createdAt, now);
    const importanceScore = Math.min(1.0, (card.importance ?? 3) / 5.0);

    // 综合加权评分: Semantic (45%) + Keyword (35%) + Recency (10%) + Importance (10%)
    const weightedScore = !hasRemoteSemantic
      ? 0.70 * keywordScore + 0.15 * recencyScore + 0.15 * importanceScore
      : 0.45 * semanticScore + 0.35 * keywordScore + 0.10 * recencyScore + 0.10 * importanceScore;
    const totalScore = Math.round(weightedScore * 1000) / 1000;

    // 3. 构建可解释原因 (Reason)
    const reasonParts: string[] = [];
    if (semanticScore > 0.65) {
      reasonParts.push(`语义高度相关 (${Math.round(semanticScore * 100)}%)`);
    } else if (semanticScore > 0.4) {
      reasonParts.push(`语义部分相关 (${Math.round(semanticScore * 100)}%)`);
    }

    if (matchedKeywords.length > 0) {
      reasonParts.push(`命中关键词 [${matchedKeywords.slice(0, 3).join(", ")}]`);
    } else if (keywordScore > 0.3) {
      reasonParts.push("正文关键词命中");
    }

    if (recencyScore > 0.8) {
      reasonParts.push("近期沉淀");
    }

    const reason = reasonParts.length > 0 ? reasonParts.join(" · ") : "项目知识库匹配";
    const temporal = temporalStates.get(card.id);

    results.push({
      cardId: card.id,
      title: card.title,
      summary: card.summary,
      type: card.type as KnowledgeTypeValue,
      score: totalScore,
      semanticScore: Math.round(semanticScore * 1000) / 1000,
      keywordScore: Math.round(keywordScore * 1000) / 1000,
      recencyScore: Math.round(recencyScore * 1000) / 1000,
      importanceScore: Math.round(importanceScore * 1000) / 1000,
      reason,
      source: hasRemoteSemantic ? "Hybrid Memory Vector Index" : "Keyword + metadata index",
      retrievalMode: hasRemoteSemantic ? "hybrid" : "keyword_fallback",
      createdAt: card.createdAt.toISOString(),
      current: temporal?.current ?? true,
      supportState: temporal?.supportState ?? "INSUFFICIENT",
      supersededBy: temporal?.supersededBy ?? null,
      temporalReason: temporal?.temporalReason ?? null,
    });
  }

  // 4. 按总分降序排序并截取
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
