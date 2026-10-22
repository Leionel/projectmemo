// 与Web共享呈现顺序，不产生业务状态或改变授权。
export function selectProjectFocus(missionStatus: string, severity: number, deadlineRank: number, hasAction: boolean): string {
  if (severity >= 4) return 'reminder';
  if (['WAITING_INPUT', 'WAITING_APPROVAL', 'PAUSED', 'FAILED'].includes(missionStatus)) return 'mission';
  if (deadlineRank >= 3) return 'deadline';
  if (['READY', 'RUNNING'].includes(missionStatus)) return 'mission';
  if (hasAction) return 'action';
  if (severity > 0) return 'reminder';
  return 'capture';
}
