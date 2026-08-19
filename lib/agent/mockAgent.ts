import type { CardDraft, KnowledgeTypeValue } from "@/lib/types";

const keywordDictionary = [
  "Agent Memory", "episodic memory", "semantic memory", "RAG", "知识资产", "项目制学习",
  "检索", "知识库", "切片", "召回", "论文", "方法", "模型", "实验", "准确率", "loss", "baseline",
  "报错", "bug", "traceback", "老师建议", "会议", "组会", "风险", "不稳定", "来不及", "不确定",
  "初赛", "复赛", "提交", "文档", "演示", "源码", "Demo", "主动提醒", "README", "PPT", "MVP",
];

function containsAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

export function classifyRawText(text: string): KnowledgeTypeValue {
  if (containsAny(text, ["风险", "来不及", "不确定", "不稳定", "时间不够"])) return "risk";
  if (containsAny(text, ["报错", "bug", "运行失败", "traceback", "exception"])) return "code_issue";
  if (containsAny(text, ["老师建议", "组会", "会议", "讨论纪要"])) return "meeting_note";
  if (containsAny(text, ["准确率", "loss", "baseline", "实验结果", "召回率"])) return "experiment_log";
  if (containsAny(text, ["初赛需要", "复赛需要", "复赛阶段", "材料要求", "作品要求", "需要准备"])) return "requirement";
  if (containsAny(text, ["需要做", "需要先", "需要设计", "ddl", "提交", "待办", "完成"])) return "task";
  if (containsAny(text, ["论文", "方法", "模型", "文献", "paper"])) return "paper_note";
  if (containsAny(text, ["灵感", "想法", "可以设计", "创意"])) return "idea";
  return "reflection";
}

export function extractKeywords(text: string): string[] {
  const matched = keywordDictionary.filter((word) => text.toLowerCase().includes(word.toLowerCase()));
  const latin = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];
  return [...new Set([...matched, ...latin])].slice(0, 6).length
    ? [...new Set([...matched, ...latin])].slice(0, 6)
    : ["项目记录"];
}

function buildTitle(text: string, type: KnowledgeTypeValue) {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  const first = clean.split(/[。！？；]/)[0].slice(0, 28);
  const prefix: Partial<Record<KnowledgeTypeValue, string>> = { risk: "风险：", task: "任务：", requirement: "要求：" };
  const label = prefix[type] ?? "";
  const needsPrefix = label && !first.startsWith(label.slice(0, -1));
  return `${needsPrefix ? label : ""}${first}${clean.length > 28 ? "…" : ""}`.slice(0, 60);
}

function actionsFor(type: KnowledgeTypeValue, keywords: string[]) {
  const focus = keywords.slice(0, 2).join("、");
  const map: Record<KnowledgeTypeValue, string[]> = {
    paper_note: [`提炼 ${focus} 的可复用结论`, "将论文观点映射到当前方案"],
    code_issue: ["记录复现步骤与错误日志", "验证最小修复并补充回归测试"],
    experiment_log: ["补充实验配置和对照组", "记录指标变化并形成结论"],
    meeting_note: ["确认建议对应的负责人和截止时间", "把会议结论转为可执行任务"],
    idea: ["把想法拆成最小可验证原型", "定义验证成功的判断标准"],
    task: ["明确负责人、产出物和截止时间", "完成后记录结果并生成阶段复盘"],
    risk: ["评估影响范围与发生概率", "制定规避方案和最小交付范围"],
    requirement: ["整理材料清单与验收标准", "将要求拆解到项目里程碑"],
    reflection: ["提炼本条记录中的关键决策", "补充下一步可执行动作"],
  };
  return map[type];
}

export function createMockCard(rawText: string, forcedType?: KnowledgeTypeValue): CardDraft {
  const type = forcedType ?? classifyRawText(rawText);
  const keywords = extractKeywords(rawText);
  const urgency = type === "risk" || containsAny(rawText, ["风险", "来不及", "截止", "ddl", "提交", "初赛", "复赛"]);
  const relatedTasks = type === "task" || type === "requirement" ? [rawText.slice(0, 80)] : [];
  return {
    type,
    title: buildTitle(rawText, type),
    summary: rawText.replace(/[\r\n]+/g, " ").trim().slice(0, 180),
    keywords,
    relatedTasks,
    nextActions: actionsFor(type, keywords),
    importance: urgency ? 5 : ["code_issue", "experiment_log", "meeting_note"].includes(type) ? 4 : 3,
  };
}
