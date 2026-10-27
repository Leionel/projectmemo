import { AgentPresentation } from '../models/AgentExperience';

export function agentStateLabel(value: string): string {
  const labels: Record<string, string> = { 'VERIFIED': '已核验', 'REPORTED': '记录已报告', 'UNKNOWN': '待明确', 'BLOCKED': '有阻碍', 'NOT_APPLICABLE': '本目标不要求',
    'PENDING': '等待你确认', 'COMMITTED': '已采用', 'DECLINED': '已暂缓', 'STALE': '依据有变化', 'EXPIRED': '提案已过期',
    'CREATED': '行动已创建', 'SUBMITTED': '已提交', 'RUNNING': '进行中', 'SUCCEEDED': '结果已保存', 'FAILED': '未完成', 'CANCELLED': '已取消', 'WAITING_USER': '等待你的回应' };
  return labels[value] ?? '状态待核对';
}
export function supportsAgentPresentation(presentation: AgentPresentation | undefined): boolean {
  return presentation?.schemaVersion === 1 && Array.isArray(presentation.blocks) && Array.isArray(presentation.allowedActions);
}
export function receiptDetail(state: string, verification: string): string {
  return state === 'CREATED' ? '等待执行，目标条件尚未验收' : verification === 'VERIFIED' ? '已有独立核验依据' : '按原任务记录显示';
}
