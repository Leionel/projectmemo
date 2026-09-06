import { structureCaptureWithMeta } from "../lib/agent";
import { getChatProviderConfig } from "../lib/config/provider";
import { knowledgeCardDraftSchema } from "../lib/validation/schemas";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const CAPTURE_BENCHMARK_SAMPLES = [
  "今天读了 Agent Memory 论文，发现 episodic memory 和 semantic memory 的切分非常重要。",
  "导师建议：不要做普通待办工具，核心是做过程资产沉淀与决策手账。",
  "消融实验完成了 baseline 对比，准确率达到 89.2%，但缺少低资源环境的实验数据。",
  "遇到 SQLite 数据库锁定报错 database is locked，排查发现是并发事务未正确等待。",
  "参赛要求明确作品说明书需要附带至少三组对比评测数据和答辩 PPT 结构。",
  "下周一上午 10:00 召开组会，讨论初赛申报书与关键证据链梳理。",
  "想到一个新功能点：可以在 App 关闭时对紧急截止日发出系统本地提醒通知。",
  "阶段复盘：前期代码结构太散，今天统一把 API 契约收敛到 ApiContract 模块中。",
  "完成作品说明大纲第一版初稿，待补充实验图表和创新点总结。",
  "评审老师指出研究背景缺少与传统项目管理工具（如 Jira、Notion）的差异化说明。",
  "实现混合向量检索算法，把关键词匹配与语义嵌入向量按权重融合排序。",
  "测试发现当输入文本少于 5 个字时后端会返回 422 验证错误，体验符合预期。",
  "代码重构完成：将所有页面颜色提取为 DesignTokens，支持浅色与深色主题切换。",
  "实验记录：在 1000 条记忆规模下，本地余弦相似度检索 p95 延迟控制在 45ms 以内。",
  "组长建议增加图片和 PDF 上传支持，作为佐证材料自动提取内容并关联卡片。",
  "竞赛备赛进度达到 75%，剩余缺口主要集中在答辩 PPT 和完整消融对比图。",
  "修复鸿蒙端 ActionBoard 在 resultCard 为空时的空指针异常，已补充严格防护。",
  "问答模块接入混合检索：问忆程能准确引用知识卡片并给出两步确认行动建议。",
  "今天完成 README 草稿编写，详细记录了部署说明、环境探针与测试运行方式。",
  "全量回归通过：38 项后端集成测试与 23 项鸿蒙 Hypium 契约单测全部 PASS。"
];

export async function runCaptureProbe() {
  if (process.env.LLM_MODE !== "openai-compatible") {
    throw new Error("S03 provider gate not runnable: set LLM_MODE=openai-compatible. Mock/fallback results do not count.");
  }
  const providerConfig = getChatProviderConfig();
  console.log("=== ProjectMemo LLM / Capture Probe (20 Samples) ===");
  console.log(`Current LLM_PROVIDER: ${providerConfig.provider}`);
  console.log(`Current LLM_MODEL: ${providerConfig.model}`);
  console.log(`Current LLM_BASE_URL: ${providerConfig.baseUrl}`);
  console.log("-----------------------------------------------------");

  const project = {
    title: "人工智能创意赛 忆程 ProjectMemo 作品开发",
    description: "面向大学生项目制学习的知识资产沉淀与主动推进 Agent",
    goal: "完成可演示的 MVP 并锁定完整证据链"
  };

  let successCount = 0;
  let fallbackCount = 0;
  let validCount = 0;
  let totalDuration = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (let i = 0; i < CAPTURE_BENCHMARK_SAMPLES.length; i++) {
    const rawText = CAPTURE_BENCHMARK_SAMPLES[i];
    const result = await structureCaptureWithMeta({
      project,
      rawText,
      historyKeywords: ["Agent", "Memory", "消融实验", "参赛要求", "复盘"]
    });

    totalDuration += result.durationMs;
    if (result.status === "SUCCESS") {
      successCount++;
    } else {
      fallbackCount++;
    }
    const validation = knowledgeCardDraftSchema.safeParse(result.data);
    if (validation.success) validCount++;
    samples.push({
      index: i + 1,
      status: result.status,
      provider: result.provider,
      durationMs: result.durationMs,
      valid: validation.success,
      fallbackReason: result.fallbackReason,
      type: result.data.type,
      title: result.data.title,
    });

    console.log(`[${i + 1}/20] (${result.durationMs}ms) [${result.status}] [${result.provider}] => 【${result.data.type}】${result.data.title}`);
    if (result.fallbackReason) {
      console.log(`      ↳ Fallback reason: ${result.fallbackReason}`);
    }
  }

  console.log("-----------------------------------------------------");
  const passed = validCount >= 19 && successCount >= 19 && fallbackCount === 0;
  const report = {
    gate: "S03-provider-20-sample",
    generatedAt: new Date().toISOString(),
    provider: providerConfig.provider,
    model: providerConfig.model,
    sampleCount: CAPTURE_BENCHMARK_SAMPLES.length,
    successCount,
    fallbackCount,
    validCount,
    validRate: validCount / CAPTURE_BENCHMARK_SAMPLES.length,
    averageLatencyMs: Math.round(totalDuration / CAPTURE_BENCHMARK_SAMPLES.length),
    passed,
    criteria: "at least 19/20 provider SUCCESS and schema-valid; zero fallback",
    samples,
  };
  const outputDir = path.resolve(process.cwd(), "output");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "s03-llm-probe.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Summary: Success=${successCount}, Fallback=${fallbackCount}, Valid=${validCount}, Passed=${passed}`);
  console.log(`Receipt: ${outputPath}`);
  if (!passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && process.argv[1].includes("probe-llm")) {
  runCaptureProbe().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
