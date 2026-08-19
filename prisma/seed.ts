import { db } from "../lib/db";
import { processCapture } from "../lib/services/captureService";
import { evaluateProjectContext } from "../lib/services/agentContextService";

const title = "人工智能创意赛 忆程 ProjectMemo 作品开发";
const legacyTitle = "人工智能创意赛 ProjectMemo 作品开发";
const captures = [
  ["论文笔记", "今天阅读了一篇关于 Agent Memory 的论文，里面提到长期记忆需要区分 episodic memory 和 semantic memory。"],
  ["实验记录", "RAG 检索效果不稳定，可能是知识切片粒度太粗，导致召回内容不准确。"],
  ["老师建议", "老师建议作品不要叫普通学习助手，要突出项目制学习和知识资产复用。"],
  ["比赛材料", "初赛需要准备创意描述、设计稿、作品介绍文档和演示材料。"],
  ["任务安排", "目前还没有完整 Demo，需要先完成项目创建、碎片捕获和成果生成闭环。"],
  ["灵感想法", "需要设计一个主动提醒模块，体现 Agent 不是被动问答工具。"],
  ["比赛材料", "复赛阶段可能需要演示视频和源代码文件，因此代码结构要清晰。"],
  ["风险记录", "风险：如果功能太多，单人开发时间不够，应该优先保证 MVP 闭环。"],
] as const;

async function main() {
  const existing = await db.project.findFirst({ where: { title: { in: [title, legacyTitle] } } });
  if (existing) await db.project.delete({ where: { id: existing.id } });
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 14);
  const project = await db.project.create({
    data: {
      title,
      description: "忆程 ProjectMemo 是面向大学生项目制学习的知识资产沉淀与主动推进 Agent。",
      goal: "完成可本地演示的忆程 MVP 与初赛材料，清晰展示知识沉淀、主动提醒、行动闭环和成果复用。",
      scenario: "COMPETITION",
      deadline,
    },
  });
  for (const [sourceType, rawText] of captures) {
    await processCapture(project.id, rawText, sourceType);
  }
  await evaluateProjectContext(project.id);
  console.log(`Seed complete: ${project.title} (${project.id}), ${captures.length} captures`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
