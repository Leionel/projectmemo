import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { font, window } from '@kit.ArkUI';
import { PMWindowMetrics } from '../common/WindowMetrics';
import { DeviceIdentity } from '../common/DeviceIdentity';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private captureNotificationRoute(want: Want): void {
    const projectId = want.parameters?.['notificationProjectId'] ?? want.parameters?.['projectId'];
    const interventionId = want.parameters?.['notificationInterventionId'];
    const targetTab = want.parameters?.['targetTab'];
    if (typeof projectId === 'string') {
      AppStorage.setOrCreate<string>('notificationProjectId', projectId);
      if (typeof interventionId === 'string') {
        AppStorage.setOrCreate<string>('notificationInterventionId', interventionId);
      }
    }
    if (typeof targetTab === 'number') {
      AppStorage.setOrCreate<number>('targetTab', targetTab);
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
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
