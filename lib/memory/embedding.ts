import crypto from "crypto";

export interface EmbeddingResult {
  vector: number[];
  dimensions: number;
  provider: string;
  model: string;
  isMock: boolean;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return Math.max(0, Math.min(1, dotProduct / denominator));
}

export function computeContentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

/**
 * 确定性本地离线高维向量生成器 (128 维，基于 N-gram 哈希和特征频率，归一化)，
 * 保证在离线、断网或 Mock 模式下 100% 具备稳定的语义相似度计算能力。
 */
export function generateDeterministicEmbedding(text: string, dimensions = 128): number[] {
  const vector = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();
  if (!normalized) return vector;

  // 1. 单字与双字 N-Gram 频次投影
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const idx1 = (charCode * 31) % dimensions;
    vector[idx1] += 1.0;

    if (i < normalized.length - 1) {
      const biGramCode = (charCode << 5) + normalized.charCodeAt(i + 1);
      const idx2 = Math.abs(biGramCode * 17) % dimensions;
      vector[idx2] += 1.5;
    }
  }

  // 2. L2 归一化
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  const sqrtNorm = Math.sqrt(norm);
  if (sqrtNorm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i] / sqrtNorm;
    }
  }
  return vector;
}

/**
 * 嵌入向量服务：优先调用 OpenAI-compatible /embeddings，失败或未配置时自动回退为确定性向量。
 */
export async function getEmbedding(text: string): Promise<EmbeddingResult> {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const embeddingModel = process.env.EMBEDDING_MODEL_NAME || "text-embedding-3-small";
  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? 10000);

  const isLlmConfigured = process.env.LLM_MODE === "openai-compatible" && Boolean(apiKey) && Boolean(baseUrl);

  if (isLlmConfigured) {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: text.slice(0, 8000),
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (response.ok) {
        const json = await response.json();
        const vector = json?.data?.[0]?.embedding;
        if (Array.isArray(vector) && vector.length > 0) {
          return {
            vector,
            dimensions: vector.length,
            provider: `openai:${embeddingModel}`,
            model: embeddingModel,
            isMock: false,
          };
        }
      }
    } catch (error) {
      console.warn("Remote embedding failed; falling back to deterministic local embedding:", error);
    }
  }

  // 确定性本地回退
  const vector = generateDeterministicEmbedding(text, 128);
  return {
    vector,
    dimensions: 128,
    provider: "deterministic-mock",
    model: "hash-n-gram-128d",
    isMock: true,
  };
}
