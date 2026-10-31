import { ExperienceSuggestion } from '../models/Experience';

// P3-A / CT-8 项目内经验展示契约：状态、条件匹配与来源口径双端一致。
// 只有条件 MATCH + ACTIVE + 来源有效才注入；未知条件不当成无条件。

export function experienceStatusLabel(item: ExperienceSuggestion): string {
  if (item.status === 'ACTIVE') { return item.eligibleForInjection ? '注入中·建议' : '已暂停·不注入'; }
  if (item.status === 'SHADOW') { return '影子观察·不注入'; }
  if (item.status === 'CANDIDATE') { return '案例参考·不注入'; }
  if (item.status === 'REVOKED') { return '已撤销（保留历史）'; }
  return '状态待确认';
}

export function experienceMatchLabel(item: ExperienceSuggestion): string {
  if (item.matchState === 'MATCH') { return '条件匹配'; }
  if (item.matchState === 'MISMATCH') { return '条件不匹配'; }
  if (item.matchState === 'UNKNOWN') { return '条件未知'; }
  return '条件待核对';
}

export function experienceSourceText(item: ExperienceSuggestion): string {
  return `来源：${item.sampleCount} 个样本（支持 ${item.supportCount} / 反例 ${item.counterCount} / 案例 ${item.caseReferenceCount}）；建议不改变权限。`;
}

export function experienceUnknownText(item: ExperienceSuggestion): string {
  if (item.unknownConditions.length === 0) { return ''; }
  return '未知条件：' + item.unknownConditions.join('；') + '（未知不当成无条件）';
}

export function isInjectableExperience(item: ExperienceSuggestion): boolean {
  return item.eligibleForInjection;
}
