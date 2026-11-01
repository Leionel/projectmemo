import { PriorityReason, ConversationSource } from '../models/Conversation';

/**
 * 把服务端「优先级理由」的原始维度文本，映射成少量用户可读的判断要点。
 * 只做字段到短语的映射，不补充字段里没有的结论；UNKNOWN 保持“尚未明确”。
 */
export class ConversationPresentation {
  static readonly NO_BLOCKING: string = '观察范围内没有等待回应的委托';
  static readonly NO_DEADLINE: string = '未记录项目截止日';
  static readonly NO_IMPORTANCE: string = '长期重要性未明确';
  static readonly NO_EFFORT: string = '本次投入未知';

  /** 回答下方默认展示的判断要点（最多 4 条），按“压力 → 阻塞 → 未明确”排序。 */
  static headlines(p: PriorityReason): string[] {
    const lines: string[] = [];
    if (p.urgency !== ConversationPresentation.NO_DEADLINE) {
      lines.push(p.urgency.indexOf('已过') >= 0 ? '项目截止日已过，需核对适用阶段' : p.urgency.replace('距项目截止日约 ', '距截止日约 '));
    }
    if (p.blocking !== ConversationPresentation.NO_BLOCKING) { lines.push(p.blocking); }
    if (p.importance === ConversationPresentation.NO_IMPORTANCE) { lines.push('长期重要性尚未明确'); }
    if (p.effort === ConversationPresentation.NO_EFFORT) { lines.push('本次可投入时间尚未提供'); }
    if (lines.length === 0) { lines.push('当前依据里没有需要特别处理的压力或缺口'); }
    return lines.slice(0, 4);
  }

  /** 次级详情里的完整判断依据，保持原始字段文本，不重新概括。 */
  static detail(p: PriorityReason): string[] {
    const lines: string[] = [];
    if (p.importance !== '') { lines.push('重要性：' + p.importance); }
    if (p.urgency !== '') { lines.push('紧急程度：' + p.urgency); }
    if (p.blocking !== '') { lines.push('阻塞状态：' + p.blocking); }
    if (p.effort !== '') { lines.push('可投入时间：' + p.effort); }
    if (p.preference !== '') { lines.push('你的偏好：' + p.preference); }
    if (p.tradeoff !== '') { lines.push('取舍说明：' + p.tradeoff); }
    if (p.unknown.length > 0) { lines.push('待明确：' + p.unknown.join('、')); }
    return lines;
  }

  static basisLabel(p: PriorityReason): string {
    return p.basis === 'MODEL_ADVICE' ? '依据：模型建议，可纠正' : '依据：项目状态与你标记的偏好';
  }

  static sourceKindLabel(source: ConversationSource): string {
    if (source.calendar !== undefined) { return '日历来源'; }
    if (source.external !== undefined) { return '网页引用'; }
    if (source.document !== undefined) { return '文档与附件'; }
    return '项目记录';
  }
}
