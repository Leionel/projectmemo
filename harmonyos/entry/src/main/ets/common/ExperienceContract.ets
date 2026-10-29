import { ExperienceSuggestion } from '../models/Experience';

// P3-A 项目内经验展示契约：状态文案与来源摘要，双端口径一致。
// ACTIVE 才注入建议；SHADOW 只观察；建议不改变权限。

export function experienceStatusLabel(status: string): string {
  if (status === 'ACTIVE') { return '注入中·建议'; }
  if (status === 'SHADOW') { return '影子观察·不注入'; }
  if (status === 'CANDIDATE') { return '候选（样本不足）'; }
  if (status === 'REVOKED') { return '已撤销（保留历史）'; }
  return '状态待确认';
}

export function experienceSourceText(item: ExperienceSuggestion): string {
  return `来源：${item.sampleCount} 个委托样本（支持 ${item.supportCount} / 反例 ${item.counterCount}）；建议不改变权限。`;
}

export function isInjectableExperience(item: ExperienceSuggestion): boolean {
  return item.status === 'ACTIVE';
}
