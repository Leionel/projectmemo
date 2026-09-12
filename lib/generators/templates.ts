import { artifactTypeLabels, knowledgeTypeLabels, type ArtifactTypeValue, type CardDraft } from "@/lib/types";
import type { ArtifactClaimEntry } from "@/lib/types";

type Context = {
  project: { title: string; description: string; goal: string };
  /** 带 id 时同步生成逐句映射；不带 id 的调用（如纯文本测试）claims 为空 */
  cards: Array<CardDraft & { id?: string }>;
};

/** 模板绑定的逐句映射：每条 claim 文本在成果正文中逐字出现 */
export interface MockArtifactResult {
  content: string;
  claims: ArtifactClaimEntry[];
}

function grouped(cards: CardDraft[], types: CardDraft["type"][]) {
  return cards.filter((card) => types.includes(card.type));
}

function bullets(cards: CardDraft[], fallback: string) {
  return cards.length ? cards.map((card) => `- **${card.title}**：${card.summary}`).join("\n") : `- ${fallback}`;
}

function actions(cards: CardDraft[]) {
  const all = [...new Set(cards.flatMap((card) => card.nextActions))].slice(0, 6);
  return all.map((item, index) => `${index + 1}. ${item}`).join("\n") || "1. 继续沉淀项目记录并明确下一步。";
}

export function generateMockArtifactWithClaims(type: ArtifactTypeValue, context: Context): MockArtifactResult {
  const { project, cards } = context;
  const progress = grouped(cards, ["experiment_log", "meeting_note", "paper_note", "reflection"]);
  const tasks = grouped(cards, ["task", "requirement"]);
  const risks = grouped(cards, ["risk", "code_issue"]);
  const keywords = [...new Set(cards.flatMap((card) => card.keywords))].slice(0, 10).join("、");
  const claims: ArtifactClaimEntry[] = [];

  // 渲染卡片条目的同时登记模板绑定 claim：标题与摘要在正文中逐字出现
  const bulletClaims = (group: Array<CardDraft & { id?: string }>, section: string, fallback: string) => {
    for (const card of group) {
      if (!card.id) continue;
      claims.push({
        claimId: "",
        // 与渲染行逐字一致（含加粗标记），保证“正文定位”可验证
        text: `**${card.title}**：${card.summary}`,
        section,
        verification: "TEMPLATE_BOUND",
        cardIds: [card.id],
      });
    }
    return bullets(group, fallback);
  };

  const common = `> 由忆程 ProjectMemo 基于 ${cards.length} 张知识卡片生成\n\n`;
  // 惰性求值：仅渲染所选类型，避免 bulletClaims 副作用在其他模板中重复登记
  const templates: Record<ArtifactTypeValue, () => string> = {
    weekly_report: () => `# ${project.title}｜项目周报\n\n${common}## 本周目标\n${project.goal}\n\n## 本周进展\n${bulletClaims(progress, "本周进展", "本周暂无明确进展记录。") }\n\n## 任务与材料\n${bulletClaims(tasks, "任务与材料", "暂无新增任务。") }\n\n## 风险与问题\n${bulletClaims(risks, "风险与问题", "当前未记录显著风险。") }\n\n## 下周行动\n${actions(cards)}`,
    competition_outline: () => `# ${project.title}｜比赛作品说明大纲\n\n${common}## 一、项目背景与痛点\n${project.description}\n\n## 二、核心定位\n${project.goal}\n\n## 三、方案与创新点\n${bulletClaims(progress, "方案与创新点", "说明碎片资产化、项目记忆关联与主动复用闭环。") }\n\n## 四、实现与演示\n${bulletClaims(tasks, "实现与演示", "展示项目创建、知识沉淀与成果生成。") }\n\n## 五、风险控制\n${bulletClaims(risks, "风险控制", "坚持 MVP 优先。") }\n\n## 六、后续规划\n${actions(cards)}`,
    defense_ppt: () => `# ${project.title}｜答辩 PPT 大纲\n\n${common}## 01 封面与一句话价值\n- ${project.goal}\n\n## 02 用户痛点\n- 项目过程信息碎片化、难检索、难复用\n\n## 03 产品方案\n- 碎片输入 → 知识卡片 → 语义关联 → 主动提醒 → 成果生成\n\n## 04 关键进展\n${bulletClaims(progress, "关键进展", "展示完整 Demo 闭环。") }\n\n## 05 风险与取舍\n${bulletClaims(risks, "风险与取舍", "聚焦可运行 MVP。") }\n\n## 06 现场演示\n${actions(cards)}\n\n## 07 未来规划\n- 真实 embedding、鸿蒙端与小艺 Agent/Skills`,
    readme: () => `# ${project.title}\n\n${project.description}\n\n## 项目目标\n\n${project.goal}\n\n## 核心能力\n\n- 碎片信息自动资产化\n- 项目记忆关键词关联\n- 主动风险与下一步提醒\n- 周报、PPT、README 等成果生成\n\n## 当前知识资产\n\n${bulletClaims(cards, "当前知识资产", "运行 Demo 后添加项目记录。") }\n\n## 关键词\n\n${keywords || "忆程 ProjectMemo、项目制学习"}\n\n## 下一步\n\n${actions(cards)}`,
    resume_description: () => `# 简历项目描述｜${project.title}\n\n**项目简介：** ${project.description}\n\n**个人工作：** 围绕${keywords || "项目知识管理"}，设计并实现碎片结构化、知识关联、主动提醒与成果生成闭环。\n\n**项目成果：** 沉淀 ${cards.length} 张结构化知识卡片，并支持多类中文项目材料一键生成。\n\n**关键行动：**\n${actions(cards)}`,
    next_week_plan: () => `# ${project.title}｜下一周行动计划\n\n${common}## 本周核心目标\n${project.goal}\n\n## 优先任务\n${actions([...tasks, ...risks, ...cards])}\n\n## 风险预案\n${bulletClaims(risks, "风险预案", "保持范围收敛，每天验证一次完整闭环。") }\n\n## 周末验收\n- 核心链路可连续演示\n- 关键材料已有可复制草稿\n- 新增问题均沉淀为知识卡片`,
  };
  const content = (templates[type] ?? (() => `# ${artifactTypeLabels[type]}\n\n${project.title}`))();
  const finalClaims = claims.map((claim, index) => ({ ...claim, claimId: `claim-${index + 1}` }));
  return { content, claims: finalClaims };
}

export function generateMockArtifact(type: ArtifactTypeValue, context: Context): string {
  return generateMockArtifactWithClaims(type, context).content;
}

export function cardToDraft(card: {
  type: string; title: string; summary: string; keywords: unknown; relatedTasks: unknown; nextActions: unknown; importance: number;
}): CardDraft {
  return {
    type: card.type as CardDraft["type"], title: card.title, summary: card.summary,
    keywords: card.keywords as string[], relatedTasks: card.relatedTasks as string[], nextActions: card.nextActions as string[], importance: card.importance,
  };
}

export { knowledgeTypeLabels };
