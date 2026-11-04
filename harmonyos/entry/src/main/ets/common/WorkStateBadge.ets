import { WorkState } from '../models/WorkState';
import { workPhaseLabel } from './GlobalFocusPresentation';

/**
 * 委托状态徽标规则，与 Web `lib/client/workStateBadge.ts` 同口径：只读服务端 WorkState，不另算阶段或主动作。
 * 色调按“下一步该谁”：你 = 琥珀，忆程 = 墨绿，系统核对 = 虚线中性，暂停/待执行 = 灰，失败 = 砖红。
 */
export function workTone(state: WorkState): string {
  switch (state.phase) {
    case 'WAITING_USER': case 'WAITING_APPROVAL': return 'user';
    case 'RUNNING': return 'agent';
    case 'WAITING_OBSERVATION': return 'observing';
    case 'QUEUED': return 'queued';
    case 'PAUSED': return 'paused';
    case 'FAILED': return 'failed';
    case 'COMPLETED': return state.terminal !== undefined && state.terminal !== null && state.terminal.status === 'SUCCEEDED' ? 'done' : 'cancelled';
    default: return 'system';
  }
}

/** COMPLETED 只靠 terminal 区分验收与取消；旧服务缺 terminal 时不推断为成功。 */
export function workStateLabel(state: WorkState): string {
  if (state.phase === 'COMPLETED' && state.terminal !== undefined && state.terminal !== null) {
    if (state.terminal.status === 'SUCCEEDED') return '条件已验收';
    if (state.terminal.status === 'CANCELLED') return '已取消（不是成功）';
  }
  return workPhaseLabel(state.phase);
}

export function nextActorLabel(actor: string): string {
  return actor === 'USER' ? '你' : actor === 'AGENT' ? '忆程' : actor === 'SYSTEM' ? '系统' : '';
}

/** 已收到停止请求 ≠ 已停止；只有未结算的请求才出第二枚徽标。 */
export function stopRequestBadge(state: WorkState): string {
  const stop = state.stopRequest;
  if (stop === undefined || stop === null || stop.settled) {
    return state.reasonCode === 'STOP_REQUESTED_IN_FLIGHT' ? '停止请求待结算' : '';
  }
  if (stop.state === 'PAUSE_REQUESTED') return '暂停请求待结算';
  if (stop.state === 'CANCEL_REQUESTED') return '取消请求待结算';
  return '';
}

/** 主按钮：轮到你 = 实心；忆程/系统在做 = 描边（secondary）；失败 = 砖红描边。 */
export function primaryActionTone(state: WorkState | undefined): string {
  if (state === undefined) return 'solid';
  if (state.phase === 'FAILED') return 'failed';
  return state.nextActor === 'USER' ? 'solid' : 'outline';
}
