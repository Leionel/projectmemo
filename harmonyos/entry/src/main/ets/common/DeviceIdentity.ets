import preferences from '@ohos.data.preferences';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'DeviceIdentity';
const DOMAIN = 0x0000;
const PREFS_NAME = 'projectmemo_identity';
const KEY_CONSUMER_KEY = 'consumerKey';

export class CaptureDraft {
  rawText: string = '';
  sourceType: string = '随手记录';
  requestId: string = '';
}

/**
 * 本地安装身份：当前无用户系统时作为状态游标 consumerKey。
 * 范围是单端单安装，不宣称跨设备/多人同步；UI 需如实说明共享行为。
 */
export class DeviceIdentity {
  private static consumerKey: string = '';
  private static appContext: common.Context | undefined = undefined;

  static async init(context: common.Context): Promise<void> {
    DeviceIdentity.appContext = context;
    if (DeviceIdentity.consumerKey !== '') {
      return;
    }
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, PREFS_NAME);
      const existing: preferences.ValueType = await store.get(KEY_CONSUMER_KEY, '');
      if (typeof existing === 'string' && existing !== '') {
        DeviceIdentity.consumerKey = existing;
      } else {
        DeviceIdentity.consumerKey = `device-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        await store.put(KEY_CONSUMER_KEY, DeviceIdentity.consumerKey);
        await store.flush();
      }
      AppStorage.setOrCreate<string>('deviceConsumerKey', DeviceIdentity.consumerKey);
    } catch (err) {
      // 读取失败时退化为进程内随机身份：游标仍可用，但不跨启动持久
      hilog.error(DOMAIN, TAG, 'Failed to init consumer key: %{public}s', JSON.stringify(err));
      DeviceIdentity.consumerKey = `device-ephemeral-${Date.now()}`;
      AppStorage.setOrCreate<string>('deviceConsumerKey', DeviceIdentity.consumerKey);
    }
  }

  static getConsumerKey(): string {
    return DeviceIdentity.consumerKey;
  }

  static async loadCaptureDraft(projectId: string): Promise<CaptureDraft | undefined> {
    const context = DeviceIdentity.appContext;
    if (context === undefined || projectId === '') return undefined;
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, 'projectmemo_capture_drafts');
      const stored: preferences.ValueType = await store.get(`capture:${projectId}`, '');
      if (typeof stored !== 'string' || stored === '') return undefined;
      const parsed = JSON.parse(stored) as Record<string, string>;
      if (typeof parsed.rawText !== 'string' || parsed.rawText === '' || typeof parsed.requestId !== 'string') {
        return undefined;
      }
      const draft = new CaptureDraft();
      draft.rawText = parsed.rawText;
      draft.sourceType = typeof parsed.sourceType === 'string' && parsed.sourceType !== '' ? parsed.sourceType : '随手记录';
      draft.requestId = parsed.requestId;
      return draft;
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to load capture draft: %{public}s', JSON.stringify(err));
      return undefined;
    }
  }

  static async saveCaptureDraft(projectId: string, rawText: string, sourceType: string, requestId: string): Promise<void> {
    const context = DeviceIdentity.appContext;
    if (context === undefined || projectId === '' || rawText === '') return;
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, 'projectmemo_capture_drafts');
      await store.put(`capture:${projectId}`, JSON.stringify({ rawText, sourceType, requestId }));
      await store.flush();
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to save capture draft: %{public}s', JSON.stringify(err));
    }
  }

  static async clearCaptureDraft(projectId: string): Promise<void> {
    const context = DeviceIdentity.appContext;
    if (context === undefined || projectId === '') return;
    try {
      const store: preferences.Preferences = await preferences.getPreferences(context, 'projectmemo_capture_drafts');
      await store.put(`capture:${projectId}`, '');
      await store.flush();
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to clear capture draft: %{public}s', JSON.stringify(err));
    }
  }
}
