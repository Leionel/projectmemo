import preferences from '@ohos.data.preferences';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'DeviceIdentity';
const DOMAIN = 0x0000;
const PREFS_NAME = 'projectmemo_identity';
const KEY_CONSUMER_KEY = 'consumerKey';

/**
 * 本地安装身份：当前无用户系统时作为状态游标 consumerKey。
 * 范围是单端单安装，不宣称跨设备/多人同步；UI 需如实说明共享行为。
 */
export class DeviceIdentity {
  private static consumerKey: string = '';

  static async init(context: common.Context): Promise<void> {
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
}
