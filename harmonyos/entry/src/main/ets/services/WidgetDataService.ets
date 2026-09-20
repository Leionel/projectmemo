import preferences from '@ohos.data.preferences';
import formProvider from '@ohos.app.form.formProvider';
import formBindingData from '@ohos.app.form.formBindingData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Project, ProjectDashboard } from '../models/Project';
import { ProjectDetail } from '../models/Memory';
import { ReentryData } from '../models/Reentry';

const TAG = 'WidgetDataService';
const DOMAIN = 0x0000;
const PREFS_NAME = 'projectmemo_widget_data';

const KEY_TITLE = 'projectTitle';
const KEY_DAYS_LEFT = 'daysLeft';
const KEY_READINESS = 'readiness';
const KEY_NEXT_ACTION = 'nextAction';
const KEY_STATUS = 'status';
const KEY_CHECKPOINT_INFO = 'checkpointInfo';
const KEY_FORM_IDS = 'widget_form_ids';

export interface WidgetPayload {
  projectTitle: string;
  daysLeft: number;
  readiness: number;
  nextAction: string;
  status: string;
  checkpointInfo: string;
}

/** 检查点状态 → 卡片展示标签；与 EpisodeCheckpointCard 的语义保持一致 */
export function episodeStatusLabel(status: string | null): string {
  if (status === 'PUBLISHED') {
    return '结论有效';
  } else if (status === 'PARTIALLY_STALE') {
    return '部分过期';
  } else if (status === 'STALE') {
    return '需要重整';
  }
  return '待整理';
}

/** reentry 聚合 → 卡片字段；daysLeft/readiness 沿用 dashboard 缓存，保持向后兼容 */
export function mapReentryToWidget(reentry: ReentryData, daysLeft: number, readiness: number): WidgetPayload {
  const statusLabel = episodeStatusLabel(reentry.episode ? reentry.episode.status : null);
  const changes = reentry.episode && reentry.episode.changesSince ? reentry.episode.changesSince.length : 0;
  const nextAction = (reentry.schedule && reentry.schedule.actionTitle)
    ? reentry.schedule.actionTitle
    : (reentry.primaryMessage || '打开应用同步待办');
  let checkpointInfo = statusLabel;
  if (changes > 0) {
    checkpointInfo += ` · ${changes} 条新变化`;
  } else if (reentry.episode && reentry.episode.meta && reentry.episode.meta.status === 'OK') {
    checkpointInfo += ' · 暂无新变化';
  }
  return {
    projectTitle: reentry.projectName || '忆程项目看板',
    daysLeft: daysLeft,
    readiness: readiness,
    nextAction: nextAction,
    status: statusLabel,
    checkpointInfo: checkpointInfo
  };
}

export class WidgetDataService {
  /**
   * 将场景代码转为友好中文场景标签
   */
  private static parseScenario(scenario?: string): string {
    if (!scenario) {
      return '进行中';
    }
    const upper = scenario.toUpperCase();
    if (upper === 'COMPETITION') {
      return '备赛中';
    } else if (upper === 'COURSE_DESIGN') {
      return '课设中';
    } else if (upper === 'RESEARCH') {
      return '科研中';
    } else if (upper === 'INNOVATION') {
      return '双创中';
    }
    return '进行中';
  }

  /**
   * 注册添加到桌面的卡片 FormId
   */
  static async registerFormId(context: common.Context, formId: string): Promise<void> {
    if (!formId || formId.trim() === '') {
      return;
    }
    try {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      const raw = (await store.get(KEY_FORM_IDS, '[]')) as string;
      let ids: string[] = [];
      try {
        ids = JSON.parse(raw) as string[];
      } catch {
        ids = [];
      }
      if (ids.indexOf(formId) === -1) {
        ids.push(formId);
        await store.put(KEY_FORM_IDS, JSON.stringify(ids));
        await store.flush();
        hilog.info(DOMAIN, TAG, 'Registered widget formId: %{public}s, total: %{public}d', formId, ids.length);
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to register formId: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 注销从桌面移除的卡片 FormId
   */
  static async unregisterFormId(context: common.Context, formId: string): Promise<void> {
    if (!formId || formId.trim() === '') {
      return;
    }
    try {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      const raw = (await store.get(KEY_FORM_IDS, '[]')) as string;
      let ids: string[] = [];
      try {
        ids = JSON.parse(raw) as string[];
      } catch {
        ids = [];
      }
      const filtered = ids.filter((id) => id !== formId);
      await store.put(KEY_FORM_IDS, JSON.stringify(filtered));
      await store.flush();
      hilog.info(DOMAIN, TAG, 'Unregistered widget formId: %{public}s, remaining: %{public}d', formId, filtered.length);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to unregister formId: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 同步获取当前缓存的卡片真实数据（供 EntryFormAbility 初始化使用）
   */
  static getCachedWidgetDataSync(context: common.Context): Record<string, string | number> {
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      const title = (store.getSync(KEY_TITLE, '') as string).trim();
      const daysLeft = store.getSync(KEY_DAYS_LEFT, 0) as number;
      const readiness = store.getSync(KEY_READINESS, 0) as number;
      const nextAction = (store.getSync(KEY_NEXT_ACTION, '') as string).trim();
      const status = (store.getSync(KEY_STATUS, '') as string).trim();
      const checkpointInfo = (store.getSync(KEY_CHECKPOINT_INFO, '') as string).trim();

      if (title.length > 0) {
        return {
          'projectTitle': title,
          'daysLeft': daysLeft,
          'readiness': readiness,
          'nextAction': nextAction || '暂无进行中待办',
          'status': status || '进行中',
          'checkpointInfo': checkpointInfo
        };
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to getCachedWidgetDataSync: %{public}s', JSON.stringify(err));
    }

    // 无真实项目持久化时的优雅引导状态（严格不出现任何示例数据字眼）
    return {
      'projectTitle': '忆程项目看板',
      'daysLeft': 0,
      'readiness': 0,
      'nextAction': '打开应用同步项目待办',
      'status': '待同步',
      'checkpointInfo': ''
    };
  }

  /**
   * 使用 Project 模型数据同步卡片并向桌面所有已绑定卡片主动推送
   */
  static async updateWidgetWithProject(context: common.Context, project: Project): Promise<void> {
    if (!project) {
      return;
    }
    const title = project.title || '忆程项目看板';
    const daysLeft = (project.dashboard && project.dashboard.deadline && typeof project.dashboard.deadline.daysRemaining === 'number')
      ? project.dashboard.deadline.daysRemaining
      : 0;
    const readiness = (project.dashboard && project.dashboard.readiness && typeof project.dashboard.readiness.percentage === 'number')
      ? project.dashboard.readiness.percentage
      : 0;
    const nextAction = (project.dashboard && project.dashboard.nextAction && project.dashboard.nextAction.label)
      ? project.dashboard.nextAction.label
      : '暂无进行中待办';
    const status = WidgetDataService.parseScenario(project.scenario);

    const payload: WidgetPayload = {
      projectTitle: title,
      daysLeft: daysLeft,
      readiness: readiness,
      nextAction: nextAction,
      status: status,
      checkpointInfo: ''
    };

    await WidgetDataService.persistAndPushToForms(context, payload);
  }

  /**
   * 使用 ProjectDetail 与 ProjectDashboard 数据同步卡片并主动推送
   */
  static async updateWidgetWithProjectDetail(
    context: common.Context,
    project: ProjectDetail,
    dashboard?: ProjectDashboard
  ): Promise<void> {
    if (!project) {
      return;
    }
    const title = project.title || '忆程项目看板';
    const daysLeft = (dashboard && dashboard.deadline && typeof dashboard.deadline.daysRemaining === 'number')
      ? dashboard.deadline.daysRemaining
      : 0;
    const readiness = (dashboard && dashboard.readiness && typeof dashboard.readiness.percentage === 'number')
      ? dashboard.readiness.percentage
      : 0;
    const nextAction = (dashboard && dashboard.nextAction && dashboard.nextAction.label)
      ? dashboard.nextAction.label
      : '暂无进行中待办';
    const status = WidgetDataService.parseScenario(project.scenario);

    const payload: WidgetPayload = {
      projectTitle: title,
      daysLeft: daysLeft,
      readiness: readiness,
      nextAction: nextAction,
      status: status,
      checkpointInfo: ''
    };

    await WidgetDataService.persistAndPushToForms(context, payload);
  }

  /**
   * 使用 reentry 聚合结果同步卡片：下一行动与检查点状态与 App 同源。
   * 拉取失败由调用方保留上次缓存（getCachedWidgetDataSync），不显示假空态。
   */
  static async updateWidgetWithReentry(context: common.Context, reentry: ReentryData): Promise<void> {
    if (!reentry) {
      return;
    }
    let daysLeft = 0;
    let readiness = 0;
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      daysLeft = store.getSync(KEY_DAYS_LEFT, 0) as number;
      readiness = store.getSync(KEY_READINESS, 0) as number;
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'Failed to read cached widget metrics: %{public}s', JSON.stringify(err));
    }
    await WidgetDataService.persistAndPushToForms(context, mapReentryToWidget(reentry, daysLeft, readiness));
  }

  /**
   * 持久化到 Preferences 并批量更新所有桌面卡片实例
   */
  private static async persistAndPushToForms(context: common.Context, payload: WidgetPayload): Promise<void> {
    try {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      await store.put(KEY_TITLE, payload.projectTitle);
      await store.put(KEY_DAYS_LEFT, payload.daysLeft);
      await store.put(KEY_READINESS, payload.readiness);
      await store.put(KEY_NEXT_ACTION, payload.nextAction);
      await store.put(KEY_STATUS, payload.status);
      await store.put(KEY_CHECKPOINT_INFO, payload.checkpointInfo);
      await store.flush();

      // 获取当前已在桌面展示的所有卡片实例
      const raw = (await store.get(KEY_FORM_IDS, '[]')) as string;
      let ids: string[] = [];
      try {
        ids = JSON.parse(raw) as string[];
      } catch {
        ids = [];
      }

      if (ids.length === 0) {
        hilog.info(DOMAIN, TAG, 'No active formId registered, data persisted for next onAddForm');
        return;
      }

      const updateMap: Record<string, string | number> = {
        'projectTitle': payload.projectTitle,
        'daysLeft': payload.daysLeft,
        'readiness': payload.readiness,
        'nextAction': payload.nextAction,
        'status': payload.status,
        'checkpointInfo': payload.checkpointInfo
      };

      const bindingData = formBindingData.createFormBindingData(updateMap);
      for (const formId of ids) {
        try {
          await formProvider.updateForm(formId, bindingData);
          hilog.info(DOMAIN, TAG, 'Successfully pushed real data to widget formId: %{public}s', formId);
        } catch (pushErr) {
          hilog.warn(DOMAIN, TAG, 'Failed to push to formId %{public}s: %{public}s', formId, JSON.stringify(pushErr));
        }
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed in persistAndPushToForms: %{public}s', JSON.stringify(err));
    }
  }
}
