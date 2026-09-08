import { notificationManager } from '@kit.NotificationKit';
import { wantAgent } from '@kit.AbilityKit';
import { Intervention } from '../models/Intervention';

export interface NotificationOpResult {
  success: boolean;
  status: 'SCHEDULED' | 'PUBLISHED' | 'SKIPPED_LOW_SEVERITY' | 'PERMISSION_DENIED' | 'UNSUPPORTED' | 'FAILED';
  message: string;
}

export class NotificationService {
  private notificationPermission: boolean | undefined = undefined;

  async checkNotificationPermission(): Promise<boolean> {
    try {
      const enabled = await notificationManager.isNotificationEnabled();
      this.notificationPermission = enabled;
      return enabled;
    } catch (err) {
      this.notificationPermission = false;
      return false;
    }
  }

  private async ensureNotificationPermission(): Promise<boolean> {
    const isEnabled = await this.checkNotificationPermission();
    if (isEnabled) {
      return true;
    }
    try {
      await notificationManager.requestEnableNotification();
      return await this.checkNotificationPermission();
    } catch (err) {
      console.warn('Notification permission is unavailable:', JSON.stringify(err));
      return false;
    }
  }

  /**
   * 基于 interventionId 派生稳定的 31 位正整数 ID，用于通知去重与更新
   */
  private getNotificationId(interventionId: string): number {
    let hash = 0;
    for (let i = 0; i < interventionId.length; i++) {
      hash = (hash << 5) - hash + interventionId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 100000);
  }

  /**
   * 发布/更新高风险介入系统通知 (Severity >= 4)
   */
  private async buildWantAgent(interventionId: string, projectId: string, requestCode: number) {
    const info: wantAgent.WantAgentInfo = {
      wants: [{
        bundleName: 'com.example.projectmemo',
        abilityName: 'EntryAbility',
        parameters: {
          notificationProjectId: projectId,
          notificationInterventionId: interventionId,
          targetTab: 0,
        },
      }],
      operationType: wantAgent.OperationType.START_ABILITY,
      requestCode,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    };
    return await wantAgent.getWantAgent(info);
  }

  async publishInterventionNotification(intervention: Intervention, projectId: string): Promise<NotificationOpResult> {
    if (intervention.severity < 4) {
      return { success: false, status: 'SKIPPED_LOW_SEVERITY', message: '当前严重程度无需系统级即时打扰' };
    }

    const hasPermission = await this.ensureNotificationPermission();
    if (!hasPermission) {
      return { success: false, status: 'PERMISSION_DENIED', message: '通知权限未开启，无法发布系统通知' };
    }

    const id = this.getNotificationId(intervention.id);
    try {
      const want = await this.buildWantAgent(intervention.id, projectId, id);
      const notificationRequest: notificationManager.NotificationRequest = {
        id,
        badgeNumber: 1,
        isAlertOnce: false,
        notificationSlotType: notificationManager.SlotType.OTHER_TYPES,
        label: `pm-intervention-${projectId}`,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: `【忆程主动介入】${intervention.title}`,
            text: intervention.content,
            additionalText: '需要负责人决策',
          },
        },
        wantAgent: want,
      };

      await notificationManager.publish(notificationRequest);
      return { success: true, status: 'PUBLISHED', message: '系统通知已发送' };
    } catch (err) {
      console.warn(`Failed to publish notification for ${intervention.id}:`, JSON.stringify(err));
      return { success: false, status: 'FAILED', message: '系统通知发送失败' };
    }
  }

  /**
   * 计划在未来时间提醒（Snooze）。
   * 严禁将未来 deliveryTime 直接传给 publish 伪装定时发送；返回具体调度状态供页面提示。
   */
  async scheduleInterventionNotification(intervention: Intervention, projectId: string, deliveryTime: number): Promise<NotificationOpResult> {
    await this.cancelInterventionNotification(intervention.id, projectId);

    if (deliveryTime <= Date.now()) {
      return this.publishInterventionNotification(intervention, projectId);
    }

    if (intervention.severity < 4) {
      return { success: false, status: 'SKIPPED_LOW_SEVERITY', message: '当前严重程度无需系统级定时打扰，已在工作台延期' };
    }

    const hasPermission = await this.ensureNotificationPermission();
    if (!hasPermission) {
      return { success: false, status: 'PERMISSION_DENIED', message: '通知权限未开启，无法安排系统定时提醒' };
    }

    // 当前运行环境未接入真机后台代理提醒（reminderAgentManager 依赖系统特权与后台代理常驻）；
    // 如实反馈调度状态，仅在工作台完成业务延期，杜绝虚报系统提醒已安排
    return { success: false, status: 'UNSUPPORTED', message: '当前设备未接入系统代理定时提醒，已在工作台完成延期' };
  }

  /**
   * 取消指定的介入通知 (Snooze/Dismiss/Resolve 时调用)
   */
  async cancelInterventionNotification(interventionId: string, projectId: string): Promise<void> {
    const id = this.getNotificationId(interventionId);
    try {
      await notificationManager.cancel(id, `pm-intervention-${projectId}`);
    } catch (err) {
      // ignore
    }
  }
}
