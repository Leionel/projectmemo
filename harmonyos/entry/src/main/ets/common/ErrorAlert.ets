import promptAction from '@ohos.promptAction';

const REPEAT_AFTER_MS: number = 60000;
let dialogOpen: boolean = false;
let lastMessage: string = '';
let lastClosedAt: number = 0;

/** 错误统一弹窗。同时只开一个，相同内容短时间不重复，避免后台刷新失败时连续打扰。 */
export function alertError(message: string): void {
  if (message === '' || dialogOpen) return;
  if (message === lastMessage && Date.now() - lastClosedAt < REPEAT_AFTER_MS) return;
  dialogOpen = true;
  lastMessage = message;
  promptAction.showDialog({ message: message, buttons: [{ text: '知道了', color: '#0A7EA4' }] })
    .catch(() => {})
    .finally(() => { dialogOpen = false; lastClosedAt = Date.now(); });
}
