import preferences from '@ohos.data.preferences';
import formProvider from '@ohos.app.form.formProvider';
import formBindingData from '@ohos.app.form.formBindingData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Project, ProjectDashboard } from '../models/Project';
import { ProjectDetail } from '../models/Memory';
import { ReentryData } from '../models/Reentry';
import { Mission } from '../models/Mission';
import { MissionWidgetSnapshot, visibleMissionWidget, widgetAttentionLabel, widgetSyncLabel } from '../common/MissionWidgetContract';
import { missionStatusLabel } from '../common/MissionContract';

const TAG = 'WidgetDataService';
const DOMAIN = 0x0000;
const PREFS_NAME = 'projectmemo_widget_data';

const KEY_PROJECT_ID = 'projectId';
const KEY_OWNER_ID = 'projectOwnerId';
const KEY_TITLE = 'projectTitle';
const KEY_DAYS_LEFT = 'daysLeft';
const KEY_HAS_DEADLINE = 'hasDeadline';
const KEY_DEADLINE_KIND = 'deadlineKind';
const KEY_DEADLINE_TEXT = 'deadlineText';
const KEY_READINESS = 'readiness';
const KEY_NEXT_ACTION_TITLE = 'nextActionTitle';
const KEY_NEXT_ACTION_REASON = 'nextActionReason';
const KEY_NEXT_ACTION = 'nextAction';
const KEY_STATUS = 'status';
const KEY_STATUS_TONE = 'statusTone';
const KEY_CHECKPOINT_INFO = 'checkpointInfo';
const KEY_FORM_IDS = 'widget_form_ids';
const KEY_FORM_DIMENSIONS = 'widget_form_dimensions';

export interface WidgetPayload {
  projectId: string;
  projectTitle: string;
  daysLeft: number;
  hasDeadline: boolean;
  deadlineKind: string; // 'NONE' | 'TODAY' | 'OVERDUE' | 'FUTURE'
  deadlineText: string;
  readiness: number;
  nextActionTitle: string;
  nextActionReason: string;
  nextAction: string; // 兼容旧字段
  status: string;
  statusTone: string; // 'brand' | 'warning' | 'risk' | 'neutral' | 'success'
  checkpointInfo: string;
}

export function visibleProjectWidget(cacheOwnerId: string, ownerId: string, token: string, expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt);
  return ownerId !== '' && cacheOwnerId === ownerId && token !== '' && Number.isFinite(expiry) && expiry > now;
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

/** 检查点状态 → 语义色调类型 */
export function episodeStatusTone(status: string | null): string {
  if (status === 'PUBLISHED') {
    return 'brand';
  } else if (status === 'PARTIALLY_STALE') {
    return 'warning';
  } else if (status === 'STALE') {
    return 'risk';
  }
  return 'neutral';
}

/** 文本安全脱敏与长度截断，避免私人记忆或敏感上下文在桌面外露 */
function safeSanitizeText(raw: string | null | undefined, maxLen: number, fallback: string): string {
  if (!raw || typeof raw !== 'string') {
    return fallback;
  }
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (cleaned.length === 0) {
    return fallback;
  }
  if (cleaned.length > maxLen) {
    return cleaned.substring(0, maxLen) + '…';
  }
  return cleaned;
}

/** 截止时间语义：kind 为 NONE/OVERDUE/TODAY/FUTURE，text 为用户可读文案。 */
export interface DeadlineState {
  kind: string;
  text: string;
}

/** 格式化截止时间语义，区分今天截止、已经逾期、未设置截止日期及缓存过期，不制造虚假倒计时 */
export function formatDeadlineState(daysLeft: number | undefined | null, hasDeadline: boolean): DeadlineState {
  if (!hasDeadline || daysLeft === undefined || daysLeft === null) {
    return { kind: 'NONE', text: '未设截止日' };
  }
  if (daysLeft < 0) {
    return { kind: 'OVERDUE', text: `已逾期 ${Math.abs(daysLeft)} 天` };
  }
  if (daysLeft === 0) {
    return { kind: 'TODAY', text: '今天截止' };
  }
  return { kind: 'FUTURE', text: `距截止 ${daysLeft} 天` };
}

/** reentry 聚合 → 卡片字段；daysLeft/readiness 沿用 dashboard 缓存，保持向后兼容 */
export function mapReentryToWidget(reentry: ReentryData, daysLeft: number, readiness: number, hasDeadlineInput?: boolean): WidgetPayload {
  const statusLabel = episodeStatusLabel(reentry.episode ? reentry.episode.status : null);
  const statusTone = episodeStatusTone(reentry.episode ? reentry.episode.status : null);
  const changes = reentry.episode && reentry.episode.changesSince ? reentry.episode.changesSince.length : 0;

  // P0：优化信息层级，优先使用经过验证的当前下一步标题，长篇原因作为次级说明，并控制隐私长度
  let nextActionTitle = '';
  let nextActionReason = '';

  if (reentry.agentContext !== undefined && reentry.agentContext !== null && reentry.agentContext.nextStep) {
    if (reentry.agentContext.nextStep.title && reentry.agentContext.nextStep.title.trim() !== '') {
      nextActionTitle = reentry.agentContext.nextStep.title.trim();
    } else if (reentry.schedule && reentry.schedule.actionTitle) {
      nextActionTitle = reentry.schedule.actionTitle.trim();
    } else if (reentry.primaryMessage) {
      nextActionTitle = reentry.primaryMessage.trim();
    }
    if (reentry.agentContext.nextStep.reason) {
      nextActionReason = reentry.agentContext.nextStep.reason.trim();
    }
  } else if (reentry.schedule && reentry.schedule.actionTitle) {
    nextActionTitle = reentry.schedule.actionTitle.trim();
  } else if (reentry.primaryMessage) {
    nextActionTitle = reentry.primaryMessage.trim();
  }

  nextActionTitle = safeSanitizeText(nextActionTitle, 28, '暂无进行中待办');
  nextActionReason = safeSanitizeText(nextActionReason, 38, '');

  // P0：删除重复状态。status 和 checkpointInfo 不再重复显示相同的「需要重整」
  let checkpointInfo = '';
  if (changes > 0) {
    checkpointInfo = `${statusLabel} · ${changes} 条新变化`;
  } else if (reentry.episode && reentry.episode.meta && reentry.episode.meta.status === 'OK') {
    checkpointInfo = '暂无新变化';
  } else {
    checkpointInfo = '';
  }

  // P1：规范日期状态。区分今天截止、已经逾期、未设置截止日期及缓存过期，不制造虚假倒计时
  const hasDeadline = hasDeadlineInput !== undefined ? hasDeadlineInput : (daysLeft !== 0);
  const deadlineFormat = formatDeadlineState(daysLeft, hasDeadline);
  const projectTitle = safeSanitizeText(reentry.projectName, 18, '忆程项目看板');

  return {
    projectId: reentry.projectId || '',
    projectTitle: projectTitle,
    daysLeft: hasDeadline ? daysLeft : 0,
    hasDeadline: hasDeadline,
    deadlineKind: deadlineFormat.kind,
    deadlineText: deadlineFormat.text,
    readiness: readiness,
    nextActionTitle: nextActionTitle,
    nextActionReason: nextActionReason,
    nextAction: nextActionTitle, // 兼容旧字段
    status: statusLabel,
    statusTone: statusTone,
    checkpointInfo: checkpointInfo
  };
}

export class WidgetDataService {
  private static missionGeneration: number = 0;
  private static missionWrites: Promise<void> = Promise.resolve();
  private static serializeMission(write: () => Promise<void>): Promise<void> {
    const next = WidgetDataService.missionWrites.catch(() => {}).then(write);
    WidgetDataService.missionWrites = next.catch(() => {});
    return next;
  }

  // 只缓存状态与定位身份，不缓存目标、私有问题正文、审批载荷或来源正文。
  static missionData(context: common.Context): Record<string, string | number> {
    const empty: Record<string, string | number> = {
      'missionId': '',
      'missionProjectId': '',
      'missionSummary': '',
      'missionUpdatedAt': '',
      'missionQuestionId': '',
      'missionApprovalId': '',
      'missionAttention': '',
      'missionSync': ''
    };
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
      const expiresAt = Date.parse(auth.getSync('expires_at', '') as string);
      const user = JSON.parse(auth.getSync('user_info', '{}') as string) as Record<string, string>;
      const snapshot = JSON.parse(store.getSync('mission_snapshot', '{}') as string) as MissionWidgetSnapshot;
      const projectId = store.getSync('active_project_id', '') as string;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !visibleMissionWidget(snapshot, user['id'] ?? '', projectId, Date.now())) {
        return empty;
      }
      return {
        'missionId': snapshot.missionId,
        'missionProjectId': snapshot.projectId,
        'missionSummary': widgetAttentionLabel(snapshot, Date.now()),
        'missionUpdatedAt': snapshot.updatedAt,
        'missionQuestionId': snapshot.questionId,
        'missionApprovalId': snapshot.approvalId,
        'missionAttention': widgetAttentionLabel(snapshot, Date.now()),
        'missionSync': widgetSyncLabel(snapshot),
        'missionExpiresAt': snapshot.expiresAt
      };
    } catch {
      return empty;
    }
  }

  static clearMission(context: common.Context): Promise<void> {
    WidgetDataService.missionGeneration++;
    return WidgetDataService.serializeMission(async () => {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      await store.put('mission_snapshot', '{}');
      // 退出时同样清除旧项目摘要；卡片保留已注册formId，等待下一次认证同步。
      const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
      if ((auth.getSync('access_token', '') as string) === '') {
        await store.put(KEY_OWNER_ID, '');
        await store.put(KEY_PROJECT_ID, '');
        await store.put(KEY_TITLE, '忆程项目看板');
        await store.put(KEY_NEXT_ACTION_TITLE, '请登录后同步项目');
        await store.put(KEY_NEXT_ACTION_REASON, '');
        await store.put(KEY_NEXT_ACTION, '请登录后同步项目');
        await store.put(KEY_STATUS, '待登录');
        await store.put(KEY_STATUS_TONE, 'neutral');
        await store.put(KEY_CHECKPOINT_INFO, '');
        await store.put(KEY_DAYS_LEFT, 0);
        await store.put(KEY_HAS_DEADLINE, false);
        await store.put(KEY_DEADLINE_KIND, 'NONE');
        await store.put(KEY_DEADLINE_TEXT, '待登录');
        await store.put(KEY_READINESS, 0);
      }
      await store.flush();
      await WidgetDataService.pushMission(context);
    });
  }

  static selectProject(context: common.Context, projectId: string): Promise<void> {
    WidgetDataService.missionGeneration++;
    return WidgetDataService.serializeMission(async () => {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      if ((await store.get('active_project_id', '')) !== projectId) {
        await store.put('active_project_id', projectId);
        await store.put('mission_snapshot', '{}');
        await store.flush();
        await WidgetDataService.pushMission(context);
      }
    });
  }

  static updateMission(context: common.Context, mission: Mission, ownerId: string, expiresAt: string): Promise<void> {
    const generation = WidgetDataService.missionGeneration;
    return WidgetDataService.serializeMission(async () => {
      const store = await preferences.getPreferences(context, PREFS_NAME);
      if (ownerId === '' || (await store.get('active_project_id', '')) !== mission.projectId) {
        return;
      }
      const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
      const user = JSON.parse(auth.getSync('user_info', '{}') as string) as Record<string, string>;
      if (generation !== WidgetDataService.missionGeneration || user['id'] !== ownerId ||
        auth.getSync('expires_at', '') !== expiresAt || (auth.getSync('access_token', '') as string) === '') {
        return;
      }
      const snapshot = new MissionWidgetSnapshot();
      snapshot.ownerId = ownerId;
      snapshot.projectId = mission.projectId;
      snapshot.missionId = mission.id;
      snapshot.status = mission.status;
      snapshot.pendingCount = mission.approvals.length + (mission.question ? 1 : 0);
      // 精确定位原问题/提案：卡片点开的是同一个对象与同一版，不是相似的新任务。
      snapshot.questionId = mission.question?.id ?? '';
      snapshot.approvalId = mission.approvals.length > 0 ? mission.approvals[0].id : '';
      snapshot.missionVersion = mission.version;
      snapshot.waitingFor = mission.workState?.nextActor ?? '';
      snapshot.observedAt = mission.workState?.observedAt ?? '';
      snapshot.nextCheckAt = mission.workState?.nextCheckAt ?? '';
      snapshot.updatedAt = new Date().toLocaleString();
      // 同时受会话期限与 5 分钟缓存期限约束。
      snapshot.expiresAt = Math.min(Date.now() + 300000, Date.parse(expiresAt));
      await store.put('mission_snapshot', JSON.stringify(snapshot));
      await store.flush();
      await WidgetDataService.pushMission(context);
    });
  }

  private static async pushMission(context: common.Context): Promise<void> {
    const store = await preferences.getPreferences(context, PREFS_NAME);
    const ids = JSON.parse(await store.get(KEY_FORM_IDS, '[]') as string) as string[];
    const rawDims = (await store.get(KEY_FORM_DIMENSIONS, '{}')) as string;
    let dims: Record<string, number> = {};
    try {
      dims = JSON.parse(rawDims) as Record<string, number>;
    } catch {
      dims = {};
    }
    const values = WidgetDataService.getCachedWidgetDataSync(context);
    const mission = WidgetDataService.missionData(context);
    Object.keys(mission).forEach((key: string) => {
      values[key] = mission[key];
    });
    for (const id of ids) {
      try {
        const dim = typeof dims[id] === 'number' ? dims[id] : 3;
        const itemValues: Record<string, string | number | boolean> = {};
        Object.keys(values).forEach((k: string) => {
          itemValues[k] = values[k];
        });
        itemValues['formDimension'] = dim;
        const data = formBindingData.createFormBindingData(itemValues);
        await formProvider.updateForm(id, data);
      } catch {
        // 下次系统刷新读取同一缓存
      }
    }
  }

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
   * 注册添加到桌面的卡片 FormId 并记录其尺寸
   */
  static async registerFormId(context: common.Context, formId: string, dimension: number = 3): Promise<void> {
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
      }

      const rawDims = (await store.get(KEY_FORM_DIMENSIONS, '{}')) as string;
      let dims: Record<string, number> = {};
      try {
        dims = JSON.parse(rawDims) as Record<string, number>;
      } catch {
        dims = {};
      }
      dims[formId] = dimension;
      await store.put(KEY_FORM_DIMENSIONS, JSON.stringify(dims));
      await store.flush();
      hilog.info(DOMAIN, TAG, 'Registered widget formId: %{public}s (dim: %{public}d), total: %{public}d', formId, dimension, ids.length);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to register formId: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 获取指定卡片的尺寸（2=2*2, 3=2*4）
   */
  static getFormDimension(context: common.Context, formId: string): number {
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      const rawDims = (store.getSync(KEY_FORM_DIMENSIONS, '{}')) as string;
      const dims = JSON.parse(rawDims) as Record<string, number>;
      if (typeof dims[formId] === 'number') {
        return dims[formId];
      }
    } catch {
      // 降级使用默认 2*4
    }
    return 3;
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

      const rawDims = (await store.get(KEY_FORM_DIMENSIONS, '{}')) as string;
      let dims: Record<string, number> = {};
      try {
        dims = JSON.parse(rawDims) as Record<string, number>;
      } catch {
        dims = {};
      }
      const nextDims: Record<string, number> = {};
      Object.keys(dims).forEach((k: string) => {
        if (k !== formId) {
          nextDims[k] = dims[k];
        }
      });
      await store.put(KEY_FORM_DIMENSIONS, JSON.stringify(nextDims));

      await store.flush();
      hilog.info(DOMAIN, TAG, 'Unregistered widget formId: %{public}s, remaining: %{public}d', formId, filtered.length);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to unregister formId: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 同步获取当前缓存的卡片真实数据（供 EntryFormAbility 初始化使用）
   */
  static getCachedWidgetDataSync(context: common.Context): Record<string, string | number | boolean> {
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
      const user = JSON.parse(auth.getSync('user_info', '{}') as string) as Record<string, string>;
      const visible = visibleProjectWidget(store.getSync(KEY_OWNER_ID, '') as string, user['id'] ?? '',
        auth.getSync('access_token', '') as string, auth.getSync('expires_at', '') as string, Date.now());
      const projectId = (store.getSync(KEY_PROJECT_ID, '') as string).trim();
      const title = (store.getSync(KEY_TITLE, '') as string).trim();
      const daysLeft = store.getSync(KEY_DAYS_LEFT, 0) as number;
      const hasDeadline = store.getSync(KEY_HAS_DEADLINE, false) as boolean;
      const deadlineKind = (store.getSync(KEY_DEADLINE_KIND, 'NONE') as string).trim();
      const deadlineText = (store.getSync(KEY_DEADLINE_TEXT, '未设截止日') as string).trim();
      const readiness = store.getSync(KEY_READINESS, 0) as number;
      const nextActionTitle = (store.getSync(KEY_NEXT_ACTION_TITLE, '') as string).trim();
      const nextActionReason = (store.getSync(KEY_NEXT_ACTION_REASON, '') as string).trim();
      const nextAction = (store.getSync(KEY_NEXT_ACTION, '') as string).trim();
      const status = (store.getSync(KEY_STATUS, '') as string).trim();
      const statusTone = (store.getSync(KEY_STATUS_TONE, 'neutral') as string).trim();
      const checkpointInfo = (store.getSync(KEY_CHECKPOINT_INFO, '') as string).trim();

      if (visible && title.length > 0) {
        return {
          'projectId': projectId,
          'projectTitle': title,
          'daysLeft': daysLeft,
          'hasDeadline': hasDeadline,
          'deadlineKind': deadlineKind || 'NONE',
          'deadlineText': deadlineText || '未设截止日',
          'readiness': readiness,
          'nextActionTitle': nextActionTitle || nextAction || '暂无进行中待办',
          'nextActionReason': nextActionReason,
          'nextAction': nextAction || nextActionTitle || '暂无进行中待办',
          'status': status || '进行中',
          'statusTone': statusTone || 'brand',
          'checkpointInfo': checkpointInfo
        };
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to getCachedWidgetDataSync: %{public}s', JSON.stringify(err));
    }

    // 无真实项目持久化时的优雅引导状态（严格不出现任何示例数据字眼）
    return {
      'projectId': '',
      'projectTitle': '忆程项目看板',
      'daysLeft': 0,
      'hasDeadline': false,
      'deadlineKind': 'NONE',
      'deadlineText': '待同步',
      'readiness': 0,
      'nextActionTitle': '打开应用同步项目待办',
      'nextActionReason': '',
      'nextAction': '打开应用同步项目待办',
      'status': '待同步',
      'statusTone': 'neutral',
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
    const title = safeSanitizeText(project.title, 18, '忆程项目看板');
    const hasDeadline = !!(project.dashboard && project.dashboard.deadline && typeof project.dashboard.deadline.daysRemaining === 'number');
    const daysLeft = hasDeadline ? project.dashboard!.deadline.daysRemaining! : 0;
    const deadlineFormat = formatDeadlineState(daysLeft, hasDeadline);
    const readiness = (project.dashboard && project.dashboard.readiness && typeof project.dashboard.readiness.percentage === 'number')
      ? project.dashboard.readiness.percentage
      : 0;
    const nextActionTitle = safeSanitizeText(project.dashboard?.nextAction?.label, 28, '暂无进行中待办');
    const nextActionReason = safeSanitizeText(project.dashboard?.nextAction?.detail, 38, '');
    const status = WidgetDataService.parseScenario(project.scenario);

    const payload: WidgetPayload = {
      projectId: project.id || '',
      projectTitle: title,
      daysLeft: daysLeft,
      hasDeadline: hasDeadline,
      deadlineKind: deadlineFormat.kind,
      deadlineText: deadlineFormat.text,
      readiness: readiness,
      nextActionTitle: nextActionTitle,
      nextActionReason: nextActionReason,
      nextAction: nextActionTitle,
      status: status,
      statusTone: 'brand',
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
    const title = safeSanitizeText(project.title, 18, '忆程项目看板');
    const hasDeadline = !!(dashboard && dashboard.deadline && typeof dashboard.deadline.daysRemaining === 'number');
    const daysLeft = hasDeadline ? dashboard!.deadline.daysRemaining! : 0;
    const deadlineFormat = formatDeadlineState(daysLeft, hasDeadline);
    const readiness = (dashboard && dashboard.readiness && typeof dashboard.readiness.percentage === 'number')
      ? dashboard.readiness.percentage
      : 0;
    const nextActionTitle = safeSanitizeText(dashboard?.nextAction?.label, 28, '暂无进行中待办');
    const nextActionReason = safeSanitizeText(dashboard?.nextAction?.detail, 38, '');
    const status = WidgetDataService.parseScenario(project.scenario);

    const payload: WidgetPayload = {
      projectId: project.id || '',
      projectTitle: title,
      daysLeft: daysLeft,
      hasDeadline: hasDeadline,
      deadlineKind: deadlineFormat.kind,
      deadlineText: deadlineFormat.text,
      readiness: readiness,
      nextActionTitle: nextActionTitle,
      nextActionReason: nextActionReason,
      nextAction: nextActionTitle,
      status: status,
      statusTone: 'brand',
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
    let hasDeadline = false;
    try {
      const store = preferences.getPreferencesSync(context, { name: PREFS_NAME });
      daysLeft = store.getSync(KEY_DAYS_LEFT, 0) as number;
      readiness = store.getSync(KEY_READINESS, 0) as number;
      hasDeadline = store.getSync(KEY_HAS_DEADLINE, false) as boolean;
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'Failed to read cached widget metrics: %{public}s', JSON.stringify(err));
    }
    await WidgetDataService.persistAndPushToForms(context, mapReentryToWidget(reentry, daysLeft, readiness, hasDeadline));
  }

  /**
   * 持久化到 Preferences 并批量更新所有桌面卡片实例
   */
  private static persistAndPushToForms(context: common.Context, payload: WidgetPayload): Promise<void> {
    const generation = WidgetDataService.missionGeneration;
    const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
    const token = auth.getSync('access_token', '') as string;
    return WidgetDataService.serializeMission(() => WidgetDataService.persistCurrentPayload(context, payload, generation, token));
  }

  private static async persistCurrentPayload(context: common.Context, payload: WidgetPayload, generation: number, token: string): Promise<void> {
    try {
      if (generation !== WidgetDataService.missionGeneration) return;
      const auth = preferences.getPreferencesSync(context, { name: 'projectmemo_auth_store' });
      if (token === '' || auth.getSync('access_token', '') !== token) return;
      const user = JSON.parse(auth.getSync('user_info', '{}') as string) as Record<string, string>;
      if (!visibleProjectWidget(user['id'] ?? '', user['id'] ?? '', token, auth.getSync('expires_at', '') as string, Date.now())) return;
      const store = await preferences.getPreferences(context, PREFS_NAME);
      if (generation !== WidgetDataService.missionGeneration || auth.getSync('access_token', '') !== token) return;
      await store.put(KEY_OWNER_ID, user['id']);
      await store.put(KEY_PROJECT_ID, payload.projectId);
      await store.put(KEY_TITLE, payload.projectTitle);
      await store.put(KEY_DAYS_LEFT, payload.daysLeft);
      await store.put(KEY_HAS_DEADLINE, payload.hasDeadline);
      await store.put(KEY_DEADLINE_KIND, payload.deadlineKind);
      await store.put(KEY_DEADLINE_TEXT, payload.deadlineText);
      await store.put(KEY_READINESS, payload.readiness);
      await store.put(KEY_NEXT_ACTION_TITLE, payload.nextActionTitle);
      await store.put(KEY_NEXT_ACTION_REASON, payload.nextActionReason);
      await store.put(KEY_NEXT_ACTION, payload.nextAction);
      await store.put(KEY_STATUS, payload.status);
      await store.put(KEY_STATUS_TONE, payload.statusTone);
      await store.put(KEY_CHECKPOINT_INFO, payload.checkpointInfo);
      await store.flush();

      if (generation !== WidgetDataService.missionGeneration || auth.getSync('access_token', '') !== token) return;
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

      const updateMap: Record<string, string | number | boolean> = {
        'projectId': payload.projectId,
        'projectTitle': payload.projectTitle,
        'daysLeft': payload.daysLeft,
        'hasDeadline': payload.hasDeadline,
        'deadlineKind': payload.deadlineKind,
        'deadlineText': payload.deadlineText,
        'readiness': payload.readiness,
        'nextActionTitle': payload.nextActionTitle,
        'nextActionReason': payload.nextActionReason,
        'nextAction': payload.nextAction,
        'status': payload.status,
        'statusTone': payload.statusTone,
        'checkpointInfo': payload.checkpointInfo
      };

      const rawDims = (await store.get(KEY_FORM_DIMENSIONS, '{}')) as string;
      let dims: Record<string, number> = {};
      try {
        dims = JSON.parse(rawDims) as Record<string, number>;
      } catch {
        dims = {};
      }

      for (const formId of ids) {
        if (generation !== WidgetDataService.missionGeneration || auth.getSync('access_token', '') !== token) return;
        try {
          const dim = typeof dims[formId] === 'number' ? dims[formId] : 3;
          const cardData: Record<string, string | number | boolean> = {};
          Object.keys(updateMap).forEach((k: string) => {
            cardData[k] = updateMap[k];
          });
          cardData['formDimension'] = dim;
          const bindingData = formBindingData.createFormBindingData(cardData);
          await formProvider.updateForm(formId, bindingData);
          hilog.info(DOMAIN, TAG, 'Successfully pushed real data to widget formId: %{public}s (dim: %{public}d)', formId, dim);
        } catch (pushErr) {
          hilog.warn(DOMAIN, TAG, 'Failed to push to formId %{public}s: %{public}s', formId, JSON.stringify(pushErr));
        }
      }
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed in persistAndPushToForms: %{public}s', JSON.stringify(err));
    }
  }
}


