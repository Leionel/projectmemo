import { TextFormatters } from './TextFormatters';
import { ArtifactAuditResponse, ArtifactAuditRecheckItem } from '../models/Artifact';

export class ExportFormatter {
  /**
   * 将成果正文与「生成时回执 + 当前重新检查」审计结果打包为导出 Markdown。
   * 与证据透视镜抽屉同口径：逐项状态来自后端时态账本的结构化字段，
   * 不按标题关键词判断，也不把全项目知识卡当作证据附录。
   */
  static formatWithProvenance(
    projectTitle: string,
    artifactType: string,
    content: string,
    audit: ArtifactAuditResponse
  ): string {
    const artifactName = TextFormatters.artifactTypeToChinese(artifactType);
    const dateStr = new Date().toISOString().substring(0, 10);

    let doc = `# ${projectTitle} · ${artifactName}\n\n`;
    doc += `> **文档类型**：复赛答辩阶段性成果交付物  \n`;
    doc += `> **导出日期**：${dateStr}  \n`;
    doc += `> **证据口径**：生成时回执 + 当前重新检查（时态账本结构化状态）  \n\n`;
    doc += `---\n\n`;
    doc += `## 一、 成果正文\n\n`;
    doc += `${content.trim()}\n\n`;
    doc += `---\n\n`;
    doc += `## 二、 附录：证据审计（Provenance Audit）\n\n`;

    if (audit.untraceable) {
      doc += `> ${audit.message}\n`;
      return doc;
    }

    doc += `> ${audit.message}\n\n`;
    doc += `### 当前重新检查（截至 ${audit.recheckedAt.substring(0, 10)}）\n\n`;
    doc += `| 编号 | 证据摘要（生成时快照） | 当前状态 | 取代关系与确认时间 |\n`;
    doc += `| :--- | :--- | :--- | :--- |\n`;

    for (let i = 0; i < audit.recheck.length; i++) {
      const item = audit.recheck[i];
      const index = `AUDIT-${(i + 1).toString().padStart(3, '0')}`;
      const summary = item.summarySnapshot.replace(/\|/g, '／').replace(/\n/g, ' ').substring(0, 60);
      const stateLabel = `${item.statusLabel}`;
      let chain = '—';
      if (item.supersededByTitle !== null) {
        const confirmedAt = item.supersededConfirmedAt !== null && item.supersededConfirmedAt.length >= 10
          ? item.supersededConfirmedAt.substring(0, 10) : '未知';
        chain = `已被「${item.supersededByTitle}」取代（确认于 ${confirmedAt}）`;
      }
      doc += `| ${index} | ${summary}… | ${stateLabel} | ${chain} |\n`;
    }

    doc += `\n### 生成时回执（${audit.generatedAt.substring(0, 10)}，共 ${audit.generationRefs.length} 项，此后不随知识库变化）\n\n`;
    for (let i = 0; i < audit.generationRefs.length; i++) {
      const ref = audit.generationRefs[i];
      const observedAt = ref.observedAt.length >= 10 ? ref.observedAt.substring(0, 10) : '未知';
      const title = ref.titleSnapshot !== '' ? ref.titleSnapshot.replace(/\n/g, ' ') : '（当时记录无标题）';
      doc += `- REF-${(i + 1).toString().padStart(3, '0')}　${title}（观察于 ${observedAt}）\n`;
    }

    doc += `\n---\n*导出时间：${new Date().toISOString()} · 状态以导出时刻时态账本核验为准*\n`;
    return doc;
  }
}
