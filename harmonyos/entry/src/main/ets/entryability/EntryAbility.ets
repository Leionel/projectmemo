import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { font, window } from '@kit.ArkUI';
import { PMWindowMetrics } from '../common/WindowMetrics';
import { DeviceIdentity } from '../common/DeviceIdentity';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private clearMissionIntent(): void {
    AppStorage.setOrCreate<string>('pendingMissionId', '');
    AppStorage.setOrCreate<string>('pendingMissionProjectId', '');
    AppStorage.setOrCreate<string>('pendingQuestionId', '');
    AppStorage.setOrCreate<string>('pendingApprovalId', '');
    AppStorage.setOrCreate<string>('pendingSourceId', '');
    AppStorage.setOrCreate<string>('pendingOutputId', '');
    AppStorage.setOrCreate<string>('pendingReceiptId', '');
    AppStorage.setOrCreate<string>('pendingMissionVersion', '');
    AppStorage.setOrCreate<string>('pendingHandoffExpiresAt', '');
  }

  private clearNotificationIntent(): void {
    AppStorage.setOrCreate<string>('notificationProjectId', '');
    AppStorage.setOrCreate<string>('notificationInterventionId', '');
  }

  private captureNotificationRoute(want: Want): void {
    const params = want.parameters;
    const projectId = params?.['notificationProjectId'] ?? params?.['projectId'];
    const interventionId = params?.['notificationInterventionId'];
    const targetTab = params?.['targetTab'];
    const missionId = params?.['missionId'];
    const missionIntent = typeof missionId === 'string' && missionId !== '' && typeof projectId === 'string' && projectId !== '';
    // 一次新的 Want 会替换旧意图：先把上一轮未消费的定位参数清空，避免旧问题/旧提醒被重新打开。
    if (missionIntent) {
      this.clearNotificationIntent();
    } else {
      this.clearMissionIntent();
      this.clearNotificationIntent();
    }
    if (missionIntent) {
      AppStorage.setOrCreate<string>('pendingMissionId', missionId as string);
      AppStorage.setOrCreate<string>('pendingMissionProjectId', projectId as string);
      // 只解析“打开哪个原对象”：不携带批准令牌、私人原话或任意跳转 URL。
      const questionId = params?.['questionId'];
      const approvalId = params?.['approvalId'];
      const sourceId = params?.['sourceId'];
      const outputId = params?.['outputId'];
      const receiptId = params?.['receiptId'];
      const missionVersion = params?.['missionVersion'];
      const handoffExpiresAt = params?.['handoffExpiresAt'];
      AppStorage.setOrCreate<string>('pendingQuestionId', typeof questionId === 'string' ? questionId : '');
      AppStorage.setOrCreate<string>('pendingApprovalId', typeof approvalId === 'string' ? approvalId : '');
      AppStorage.setOrCreate<string>('pendingSourceId', typeof sourceId === 'string' ? sourceId : '');
      AppStorage.setOrCreate<string>('pendingOutputId', typeof outputId === 'string' ? outputId : '');
      AppStorage.setOrCreate<string>('pendingReceiptId', typeof receiptId === 'string' ? receiptId : '');
      AppStorage.setOrCreate<string>('pendingMissionVersion', typeof missionVersion === 'string' ? missionVersion : '');
      AppStorage.setOrCreate<string>('pendingHandoffExpiresAt', typeof handoffExpiresAt === 'string' ? handoffExpiresAt : '');
    } else if (typeof projectId === 'string' && projectId !== '') {
      AppStorage.setOrCreate<string>('notificationProjectId', projectId);
      if (typeof interventionId === 'string' && interventionId !== '') {
        AppStorage.setOrCreate<string>('notificationInterventionId', interventionId);
      }
    }
    if (typeof targetTab === 'number') {
      AppStorage.setOrCreate<number>('targetTab', targetTab);
    }
    // 通知/卡片在 App 已在前台时由 onNewWant 投递：递增序号让可见页面消费一次新意图。
    if (missionIntent || (typeof projectId === 'string' && projectId !== '')) {
      const seq = (AppStorage.get<number>('pm.handoffSeq') ?? 0) + 1;
      AppStorage.setOrCreate<number>('pm.handoffSeq', seq);
    }
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.captureNotificationRoute(want);
    DeviceIdentity.init(this.context);
    // 品牌名用思源宋体子集（Noto Serif SC，SIL OFL 1.1）；系统无 CJK 衬线时保证衬线生效
    try {
      font.registerFont({ familyName: 'PMSerifBrand', familySrc: $rawfile('fonts/pm-serif-brand.ttf') });
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to register brand font. Cause: %{public}s', JSON.stringify(err));
    }
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onNewWant(want: Want): void {
    this.captureNotificationRoute(want);
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      PMWindowMetrics.start(windowStage.getMainWindowSync());
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    AppStorage.setOrCreate<boolean>('missionAppActive', true);
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    AppStorage.setOrCreate<boolean>('missionAppActive', false);
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
