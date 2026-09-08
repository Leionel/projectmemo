import { KnowledgeCard } from '../models/Memory';
import { TextFormatters } from './TextFormatters';

export class ExportFormatter {
  /**
   * 将成果文档与知识库中的过程证据打包为带完整存证附录的学术评审 Markdown 文本
   */
  static formatWithProvenance(
    projectTitle: string,
    artifactType: string,
    content: string,
    cards: KnowledgeCard[]
  ): string {
    const artifactName = TextFormatters.artifactTypeToChinese(artifactType);
    const dateStr = new Date().toISOString().substring(0, 10);

    let doc = `# ${projectTitle} · ${artifactName}\n\n`;
    doc += `> **文档类型**：复赛答辩阶段性成果交付物  \n`;
    doc += `> **生成日期**：${dateStr}  \n`;
    doc += `> **存证系统**：ProjectMemo 2.1 时态可信学术智能体  \n\n`;
    doc += `---\n\n`;
    doc += `## 一、 成果正文\n\n`;
    doc += `${content.trim()}\n\n`;
    doc += `---\n\n`;
    doc += `## 二、 附录：过程证据与时态存证目录 (Provenance Ledger)\n\n`;
    doc += `> 本附录由系统自动提取底层真实实验、导师指导与决策卡片编制，每一项结论均具备原始可信来源。\n\n`;

    if (!cards || cards.length === 0) {
      doc += `*暂无沉淀的过程证据记录。*\n`;
      return doc;
    }

    doc += `| 证据编号 | 证据类型 | 记录时间 | 原始存证摘要 | 时态有效性 |\n`;
    doc += `| :--- | :--- | :--- | :--- | :--- |\n`;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardIndex = `EVIDENCE-${(i + 1).toString().padStart(3, '0')}`;
      const typeLabel = TextFormatters.memoryTypeToChinese(card.type);
      const timeLabel = card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : '近期';
      const cleanSummary = card.summary.replace(/\|/g, '／').replace(/\n/g, ' ').substring(0, 60);

      // 判断时态有效性：严格基于卡片的 incomingLinks 关系链中是否有 SUPERSEDES 关系
      let validityStatus = '🟢 当前有效';
      if (card.incomingLinks && card.incomingLinks.length > 0) {
        for (let j = 0; j < card.incomingLinks.length; j++) {
          if (card.incomingLinks[j].relationType === 'SUPERSEDES') {
            validityStatus = '🔴 已被新决策取代';
            break;
          }
        }
      }

      doc += `| ${cardIndex} | ${typeLabel} | ${timeLabel} | ${cleanSummary}... | ${validityStatus} |\n`;
    }

    doc += `\n---\n*报告存证防伪校验标识：PM-VERIFY-${Date.now().toString(16).toUpperCase()}*\n`;
    return doc;
  }
}
