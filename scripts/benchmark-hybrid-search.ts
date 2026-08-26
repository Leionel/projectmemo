import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db";
import { searchProjectCards } from "../lib/memory/hybridSearch";
import { backfillProjectEmbeddings } from "../lib/repositories/embeddings";

const SCALES = [50, 100, 500, 1000];
const TOPICS = [
  ["learning_rate", "学习率调整", "为什么降低 learning rate"],
  ["ablation", "消融实验", "消融对比少了哪些结果"],
  ["literature", "文献创新", "相关论文的创新点"],
  ["presentation", "答辩材料", "答辩 PPT 怎么组织"],
  ["database", "数据库排障", "database locked 如何处理"],
  ["requirements", "参赛要求", "提交材料有哪些要求"],
  ["architecture", "系统架构", "记忆系统架构设计"],
  ["evaluation", "评测指标", "Recall 和 MRR 指标"],
  ["notification", "系统通知", "高风险提醒如何触发"],
  ["reflection", "阶段复盘", "前一阶段有哪些教训"],
] as const;

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function main() {
  if (!process.argv.includes("--confirm-provider-cost")) {
    throw new Error("Refusing a potentially billable 1,000-card benchmark. Re-run with --confirm-provider-cost.");
  }
  if (process.env.LLM_MODE !== "openai-compatible" || !process.env.LLM_BASE_URL || !process.env.LLM_API_KEY) {
    throw new Error("S04 semantic benchmark requires a configured OpenAI-compatible embeddings provider.");
  }

  const project = await db.project.create({
    data: {
      title: "S04 isolated hybrid-search benchmark",
      description: "Synthetic labelled benchmark; deleted automatically after the run.",
      goal: "Measure semantic retrieval without contaminating demo data",
      scenario: "COMPETITION",
    },
  });
  const cardTopics = new Map<string, string>();
  const reports: Array<Record<string, unknown>> = [];
  let seeded = 0;

  try {
    for (const scale of SCALES) {
      const captures: Array<Record<string, unknown>> = [];
      const cards: Array<Record<string, unknown>> = [];
      for (let index = seeded; index < scale; index++) {
        const [topic, label] = TOPICS[index % TOPICS.length];
        const captureId = randomUUID();
        const cardId = randomUUID();
        captures.push({ id: captureId, projectId: project.id, rawText: `${label} 第 ${index + 1} 条标注记忆` });
        cards.push({
          id: cardId,
          projectId: project.id,
          captureId,
          type: "experiment_log",
          title: `${label}记录 ${index + 1}`,
          summary: `围绕${label}的项目过程证据与决策原因，主题标记 ${topic}`,
          keywords: [label, topic, "benchmark"],
          relatedTasks: [],
          nextActions: ["复核证据"],
          importance: 3 + (index % 3),
        });
        cardTopics.set(cardId, topic);
      }
      await db.capture.createMany({ data: captures as never[] });
      await db.knowledgeCard.createMany({ data: cards as never[] });
      seeded = scale;
      await backfillProjectEmbeddings(project.id);

      const latencies: number[] = [];
      let recalls = 0;
      let reciprocalRankSum = 0;
      let relevantReturned = 0;
      let returned = 0;
      for (const [topic, , query] of TOPICS) {
        for (const suffix of ["", " 请找回历史依据"]) {
          const started = performance.now();
          const results = await searchProjectCards({ projectId: project.id, query: `${query}${suffix}`, limit: 8 });
          latencies.push(performance.now() - started);
          if (results.some((result) => result.retrievalMode !== "hybrid")) {
            throw new Error("Embedding provider fell back during benchmark; semantic metrics are invalid.");
          }
          const firstRelevant = results.findIndex((result) => cardTopics.get(result.cardId) === topic);
          if (firstRelevant >= 0) {
            recalls++;
            reciprocalRankSum += 1 / (firstRelevant + 1);
          }
          relevantReturned += results.filter((result) => cardTopics.get(result.cardId) === topic).length;
          returned += results.length;
        }
      }
      const queryCount = TOPICS.length * 2;
      reports.push({
        scale,
        queryCount,
        recallAt8: recalls / queryCount,
        mrr: reciprocalRankSum / queryCount,
        evidencePrecision: returned === 0 ? 0 : relevantReturned / returned,
        p95LatencyMs: Math.round(percentile(latencies, 0.95)),
      });
    }

    const final = reports.at(-1) as Record<string, number>;
    const passed = reports.every((report) =>
      Number(report.recallAt8) >= 0.8 &&
      Number(report.mrr) >= 0.65 &&
      Number(report.evidencePrecision) >= 0.9,
    ) && final.p95LatencyMs < 500;
    const receipt = {
      gate: "S04-labelled-hybrid-search",
      generatedAt: new Date().toISOString(),
      providerModel: process.env.EMBEDDING_MODEL_NAME ?? "text-embedding-3-small",
      criteria: { recallAt8: 0.8, mrr: 0.65, evidencePrecision: 0.9, p95At1000Ms: 500 },
      reports,
      passed,
    };
    const outputDir = path.resolve(process.cwd(), "output");
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "s04-hybrid-search-benchmark.json");
    await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(receipt, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await db.project.delete({ where: { id: project.id } });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
