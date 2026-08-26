import { notificationManager } from '@kit.NotificationKit';
import { wantAgent } from '@kit.AbilityKit';
import { Intervention } from '../models/Intervention';

export class NotificationService {
  private notificationPermission: boolean | undefined = undefined;
  private permissionRequest: Promise<boolean> | undefined = undefined;

  private async ensureNotificationPermission(): Promise<boolean> {
    if (this.notificationPermission !== undefined) {
      return this.notificationPermission;
    }
    if (this.permissionRequest !== undefined) {
      return this.permissionRequest;
    }

    this.permissionRequest = (async (): Promise<boolean> => {
      try {
        if (await notificationManager.isNotificationEnabled()) {
          this.notificationPermission = true;
          return true;
        }
        await notificationManager.requestEnableNotification();
        this.notificationPermission = await notificationManager.isNotificationEnabled();
        return this.notificationPermission;
      } catch (err) {
        this.notificationPermission = false;
        console.warn('Notification permission is unavailable:', JSON.stringify(err));
        return false;
      } finally {
        this.permissionRequest = undefined;
      }
    })();
    return this.permissionRequest;
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
          notificationInterventionId: interventionId
        }
      }],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode,
      actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
    };
    return wantAgent.getWantAgent(info);
  }

  private async publish(intervention: Intervention, projectId: string, deliveryTime?: number): Promise<void> {
    if (intervention.severity < 4 || intervention.status !== 'OPEN') {
      return;
    }

    const id = this.getNotificationId(intervention.id);
    const title = `【忆程待办】${intervention.title}`;
    const text = intervention.content.slice(0, 100);

    try {
      if (!await this.ensureNotificationPermission()) {
        console.warn(`Notification permission is disabled; skipped ${intervention.id}`);
        return;
      }
      const routeAgent = await this.buildWantAgent(intervention.id, projectId, id);
      const notificationRequest: notificationManager.NotificationRequest = {
        id,
        notificationSlotType: notificationManager.SlotType.OTHER_TYPES,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title,
            text,
            additionalText: `紧急程度：${intervention.severity === 5 ? '高风险' : '重要'}`
          }
        },
        label: `pm-intervention-${projectId}`,
        wantAgent: routeAgent
      };
      if (deliveryTime !== undefined) {
        notificationRequest.deliveryTime = deliveryTime;
      }

      await notificationManager.publish(notificationRequest);
    } catch (err) {
      // 模拟器/无通知权限降级处理
      console.warn(`Failed to publish notification for ${intervention.id}:`, JSON.stringify(err));
    }
  }

  async publishInterventionNotification(intervention: Intervention, projectId: string): Promise<void> {
    if (intervention.severity < 4 || intervention.status !== 'OPEN') {
      return;
    }
    await this.publish(intervention, projectId);
  }

  async scheduleInterventionNotification(intervention: Intervention, projectId: string, deliveryTime: number): Promise<void> {
    if (intervention.severity < 4 || deliveryTime <= Date.now()) {
      return;
    }
    await this.cancelInterventionNotification(intervention.id, projectId);
    await this.publish(intervention, projectId, deliveryTime);
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
