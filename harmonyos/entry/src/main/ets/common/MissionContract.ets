import { MissionEvent, MissionConstraints } from '../models/Mission';

export function missionStatusLabel(status: string): string {
  const labels: Record<string, string> = { 'READY': '等待执行', 'RUNNING': '执行中', 'WAITING_INPUT': '等待补充资料',
    'WAITING_APPROVAL': '等待批准', 'PAUSED': '已暂停', 'SUCCEEDED': '委托已完成', 'CANCELLED': '已取消',
    'FAILED': '执行失败', 'OBSOLETE': '已被新计划替代', 'SKIPPED': '已跳过' };
  return labels[status] ?? status;
}
export function missionEventLabel(type: string): string {
  const labels: Record<string, string> = { 'CREATED': '已接受委托', 'QUESTION': '需要补充信息',
    'INPUT': '已补充答复', 'APPROVAL': '已记录审批', 'PAUSE': '已请求暂停', 'RESUME': '已请求继续',
    'CANCEL': '已请求取消', 'CONSTRAINTS_CHANGED': '约束已更新', 'RESEARCH_SCOPE_CHANGED': '研究范围已更新',
    'CONTINUATION_POLICY_CHANGED': '自动接续许可已更新', 'MATERIAL_CANDIDATE': '发现候选资料',
    'MATERIAL_CONTINUED': '已使用新资料接续', 'ARTIFACT_ADOPTED': '已归入项目成果' };
  return labels[type] ?? '执行记录';
}
export function mergeMissionEvents(previous: MissionEvent[], incoming: MissionEvent[]): MissionEvent[] {
  const result: MissionEvent[] = previous.slice();
  incoming.forEach((entry: MissionEvent) => {
    if (!result.some((old: MissionEvent) => old.seq === entry.seq)) result.push(entry);
  });
  return result.sort((a: MissionEvent, b: MissionEvent) => a.seq - b.seq);
}
// 模型摘要不回写约束；显式复制字段，排除服务端只读的 llmContextApproved。
export function editableMissionConstraints(value: MissionConstraints): MissionConstraints {
  const result = new MissionConstraints();
  result.availableMinutes = value.availableMinutes; result.resourceLimits = value.resourceLimits.slice();
  result.costCeiling = value.costCeiling; result.deadline = value.deadline; result.priority = value.priority;
  result.forbiddenApproaches = value.forbiddenApproaches.slice(); result.rejectedActions = value.rejectedActions.slice();
  result.executionBoundary = value.executionBoundary;
  return result;
}
export function missionTerminal(status: string): boolean { return status === 'SUCCEEDED' || status === 'CANCELLED'; }
export function missionToolLabel(tool: string): string {
  const labels: Record<string, string> = { 'inspect_project': '读取项目状态', 'search_memory': '检索项目记忆',
    'web_search': '搜索公开资料', 'web_fetch': '读取公开来源', 'save_mission_output': '保存草稿',
    'propose_action': '提议行动', 'create_action': '创建行动', 'inspect_action': '检查行动结果', 'bind_project_sources': '绑定补充资料' };
  return labels[tool] ?? '处理任务资料';
}
