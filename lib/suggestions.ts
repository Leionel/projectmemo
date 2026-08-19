import type { KnowledgeTypeValue, Suggestion } from "@/lib/types";

export function generateSuggestions(input: {
  cards: Array<{ type: KnowledgeTypeValue }>;
  deadline: Date | null;
}): Suggestion[] {
  const count = (type: KnowledgeTypeValue) => input.cards.filter((card) => card.type === type).length;
  const suggestions: Suggestion[] = [];
  if (count("risk") >= 1) suggestions.push({ id: "risks", tone: "risk", title: "先收敛项目风险", content: "当前项目已记录风险，建议整理影响、概率和规避方案，优先守住 MVP 闭环。", priority: 100 });
  if (count("task") + count("requirement") >= 2 && count("reflection") === 0) suggestions.push({ id: "reflect", tone: "insight", title: "安排一次阶段复盘", content: "你已经记录了多个任务与要求，建议生成阶段复盘，确认哪些工作真正形成了成果。", priority: 80 });
  if (count("paper_note") >= 2 && count("experiment_log") === 0) suggestions.push({ id: "experiment", tone: "action", title: "补一次最小实验", content: "资料沉淀较多但实验记录偏少，建议用最小实验验证关键假设。", priority: 70 });
  if (count("idea") >= 2 && count("task") === 0) suggestions.push({ id: "milestone", tone: "action", title: "把灵感拆成里程碑", content: "灵感较多但缺少可执行任务，请明确下一项可交付成果。", priority: 65 });
  if (input.deadline) {
    const days = Math.ceil((input.deadline.getTime() - Date.now()) / 86_400_000);
    if (days <= 14) suggestions.push({ id: "deadline", tone: "deadline", title: days < 0 ? `已逾期 ${Math.abs(days)} 天` : `距截止约 ${days} 天`, content: "建议优先生成提交材料清单，并预留一次完整演示和彩排时间。", priority: 90 });
  }
  const fallback: Suggestion[] = [
    { id: "capture", tone: "insight", title: "持续沉淀关键决策", content: "把老师反馈、实验结果和关键取舍及时记录，项目记忆会越来越有价值。", priority: 20 },
    { id: "artifact", tone: "action", title: "用成果检验沉淀质量", content: "尝试生成一次周报或 PPT 大纲，快速发现项目记录中的信息缺口。", priority: 10 },
  ];
  return [...suggestions, ...fallback].sort((a, b) => b.priority - a.priority).slice(0, 4);
}
