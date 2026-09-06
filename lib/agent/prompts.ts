import type { ArtifactTypeValue, CardDraft } from "@/lib/types";

export function buildCapturePrompt(input: {
  project: { title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
}) {
  return `你是忆程 ProjectMemo 的知识资产结构化 Agent。\n项目：${input.project.title}\n项目描述：${input.project.description}\n项目目标：${input.project.goal}\n历史关键词：${input.historyKeywords.join("、") || "暂无"}\n用户记录：${input.rawText}\n\n只返回一个合法 JSON 对象，不要使用 Markdown 代码块。字段必须为：type、title、summary、keywords、relatedTasks、nextActions、importance。type 只能是 paper_note/code_issue/experiment_log/meeting_note/idea/task/risk/requirement/reflection，importance 为 1-5 整数，三个数组字段必须是中文字符串数组。`;
}

export function buildArtifactPrompt(input: {
  project: { title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  const cardText = input.cards.map((card) => `- [${card.type}] ${card.title}：${card.summary}；下一步：${card.nextActions.join("、")}`).join("\n");
  return `你是忆程 ProjectMemo 成果生成 Agent。请为项目《${input.project.title}》生成 ${input.artifactType}。\n目标：${input.project.goal}\n知识资产：\n${cardText}\n\n输出中文结构化文档，使用清晰 Markdown 标题和列表；必须基于给定知识资产，不要编造数据。`;
}

export function buildCopilotPrompt(input: {
  project: { title: string; description: string; goal: string };
  question: string;
  cards: Array<{ id: string; title: string; summary: string; type: string }>;
  interventions: Array<{ id: string; title: string; content: string; status: string }>;
  actions: Array<{ id: string; title: string; status: string }>;
}) {
  const cards = input.cards.map((card) => `[${card.id}] ${card.title} (${card.type}): ${card.summary}`).join("\n");
  const interventions = input.interventions.map((item) => `[${item.id}] ${item.title} (${item.status}): ${item.content}`).join("\n");
  const actions = input.actions.map((item) => `[${item.id}] ${item.title} (${item.status})`).join("\n");
  return `You are the memory copilot of 忆程 ProjectMemo. Answer only from the supplied project memory.
Project: ${input.project.title}
Goal: ${input.project.goal}
Question: ${input.question}
Cards:\n${cards || "none"}
Interventions:\n${interventions || "none"}
Actions:\n${actions || "none"}
Return strict JSON with keys message (string), citations (array of objects {cardId,title,excerpt}), claims (array of objects {text,cardIds}), proposedActions (array of objects with kind=create_action or generate_artifact, label,title,description,priority,artifactType). Split every verifiable conclusion into a claim and attach only the supplied card ids that directly support it. If no supplied card directly supports a claim, use an empty cardIds array and do not propose a write action. Never invent card ids or project facts. The server independently validates card ownership, currentness, conflicts and write permission. Do not reveal hidden reasoning.`;
}
