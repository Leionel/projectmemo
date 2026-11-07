import { alertError } from '../common/ErrorAlert';
import { PMPageIntro, PMListRow, PMCloseButton } from '../components/PMReferencePrimitives';
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { missionHandoffRoute } from '../common/MissionWidgetContract';
import preferences from '@ohos.data.preferences';
import { Project, ApiError, ProjectCreateInput, CompetitionReadiness, ReadinessItem } from '../models/Project';
import { ProjectDetail, KnowledgeCard, CardTemporalStatus } from '../models/Memory';
import { Intervention } from '../models/Intervention';
import { ActionItem, ActionCreateInput } from '../models/Action';
import { SettingsResponse, UpdateSettingsInput, ProbeInput, ProbeResponse } from '../models/Settings';
import { UserInfo } from '../models/Auth';

import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { ActionService } from '../services/ActionService';
import { MemoryService } from '../services/MemoryService';
import { SettingsService } from '../services/SettingsService';
import { SessionStore } from '../services/SessionStore';
import { AuthService } from '../services/AuthService';
import { WidgetDataService } from '../services/WidgetDataService';
import { GlobalFocusPanel } from '../components/GlobalFocusPanel';
import { LoginView } from '../components/LoginView';
import { SplashView } from '../components/SplashView';
import { OnboardingView } from '../components/OnboardingView';
import { DateOnly } from '../common/DateOnly';
import { ReminderSettingsView } from '../components/ReminderSettingsView';
import { ReadinessBreakdownSheet } from '../components/ReadinessBreakdownSheet';

import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction, PMMotion, PMTransition, PMCardStyle } from '../common/DesignTokens';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { SeverityBadge, StatusBadge, MemoryTypeBadge, CategoryBadge, TemporalBadge } from '../components/MetricBadge';
import { DashboardIcon, FolderIcon, TaskIcon, MemoryIcon, SettingsIcon, AlertIcon, BookOpenIcon, PaperclipIcon, ClockIcon, SearchIcon, PlusIcon } from '../components/PMIcons';
import { DeadlineBadge } from '../components/DeadlineBadge';
import { TextFormatters } from '../common/TextFormatters';
import { Constants } from '../common/Constants';
import { PMBreakpoint, PMStorageKey, PMWidthBp } from '../common/WindowMetrics';

/** 全局记忆的类型筛选项：下划线标签用，选中态同时靠字重与形状表达 */
const UI_PREFS_NAME: string = 'projectmemo_ui_prefs';
const KEY_HIDE_GLOBAL_MEMORY_NOTE: string = 'hideGlobalMemoryNote';
const KEY_ONBOARDING_SEEN: string = 'onboardingSeen';
// 品牌启动页最短停留，避免登录状态读得很快时一闪而过
const SPLASH_MIN_MS: number = 700;

class MemoryTypeFilter {
  value: string = '';
  label: string = '';

  constructor(value: string, label: string) {
    this.value = value;
    this.label = label;
  }
}

class ProjectAggregate {
  cards: KnowledgeCard[] = [];
  interventions: Intervention[] = [];
  actions: ActionItem[] = [];
  statuses: CardTemporalStatus[] = [];
  failed: boolean = false;
}

PersistentStorage.persistProp<boolean>('pm.reduceMotion', false);

@Entry
@Component
struct Index {
  @State currentMainTabIndex: number = 4;
  @State focusRefreshKey: number = 0;
  @StorageProp(PMStorageKey.WIDTH_BP) widthBp: string = PMWidthBp.SM;
  @StorageLink('pm.reduceMotion') reduceMotion: boolean = false;

  // 认证与会话状态
  @State isAuthenticated: boolean = false;
  @State isCheckingAuth: boolean = true;
  // 默认视为已看过，读到本机记录后再决定；读取失败不阻塞登录
  @State onboardingSeen: boolean = true;
  @State currentUser: UserInfo = new UserInfo();
  @State sessionExpiresAt: string = '';

  // 数据主状态
  @State projects: Project[] = [];
  @State projectDeletionNotice: string = '';
  // 已归档项目单独一份：主列表与跨项目聚合都不含它们，但必须仍能在这里恢复
  @State archivedProjects: Project[] = [];
  @State showArchivedProjects: boolean = false;
  // 生命周期操作进行中的项目 id：兼作双击防护，非空时禁用所有项目操作入口
  @State projectLifecycleBusyId: string = '';
  @State projectDeleteConfirmId: string = '';
  @State allInterventions: Intervention[] = [];
  @State allActions: ActionItem[] = [];
  @State allCards: KnowledgeCard[] = [];

  // 通用状态
  @State isLoading: boolean = false;
  @State errorMessage: string = '';

  // Tab 0: 项目专属
  @State selectedScenarioFilter: string = 'ALL';
  /** 项目排序模式：默认保持服务端「最近更新」；「需要关注」用可跨场景比较的本地评分排序 */
  @State projectSortMode: string = 'updated';

  // Tab 2: 待办专属
  @State taskTabFilter: string = 'REMINDERS'; // 'REMINDERS' | 'ACTIONS'

  // Tab 1: 记忆专属
  @State globalSearchQuery: string = '';
  @State globalActionStatus: string = 'ACTIVE';
  @State searchOpen: boolean = false;
  @State showGlobalCapture: boolean = false;
  @State gcProjectIndex: number = 0;
  @State gcSourceType: string = '随手记录';
  @State gcText: string = '';
  @State gcSubmitting: boolean = false;
  private gcGeneration: number = 0;
  private dataLoadGeneration: number = 0;
  private gcRequestId: string = '';
  private gcRequestPayload: string = '';
  @State @Watch('alertGcError') gcError: string = '';
  private alertGcError(): void { alertError(this.gcError); }
  @State showGlobalTodo: boolean = false;
  @State gtProjectIndex: number = 0;
  @State gtTitle: string = '';
  @State gtDescription: string = '';
  @State gtPriority: number = 3;
  @State gtSubmitting: boolean = false;
  @State @Watch('alertGtError') gtError: string = '';
  private alertGtError(): void { alertError(this.gtError); }
  @State globalCardStates: CardTemporalStatus[] = [];
  @State selectedGlobalType: string = 'all';

  // Tab 3: 设置专属状态
  // '' = 尚未从服务端读到；读取失败时不能默认显示成规则模式，否则已接入模型的部署会被误认为未接入。
  @State llmMode: string = ''; // '' | 'mock' | 'openai-compatible'
  @State llmBaseUrl: string = '';
  @State llmModelName: string = 'deepseek-v4-flash';
  @State llmApiKey: string = '';
  @State apiKeyMasked: string = '';
  @State hasApiKey: boolean = false;
  @State settingsEditable: boolean = false;
  @State settingsReadOnlyMessage: string = '';
  @State isSavingSettings: boolean = false;
  @State isProbing: boolean = false;
  @State probeResult: ProbeResponse | undefined = undefined;
  @State settingsFeedback: string = '';
  @State dataSyncState: string = '尚未同步';
  @State showSettingsSheet: boolean = false;
  @State settingsSheetMode: string = 'api';

  // 项目内准备项逐项说明：计数仍来自服务端 dashboard.readiness.items，这里只做展示
  @State showReadinessSheet: boolean = false;
  @State readinessForSheet: CompetitionReadiness = new CompetitionReadiness();
  @State globalMemoryNoteHidden: boolean = false;
  @State expandedEvidenceCardId: string = '';
  // 卡片/通知在 App 已在前台时通过 onNewWant 投递；页面存活但不会触发 onPageShow，用序号驱动消费。
  @StorageProp('pm.handoffSeq') @Watch('onHandoffIntent') handoffSeq: number = 0;
  private indexVisible: boolean = true;

  // 新建项目弹窗状态
  @State showCreateDialog: boolean = false;
  @State newTitle: string = '';
  @State newDescription: string = '';
  @State newGoal: string = '';
  @State newScenario: string = 'COMPETITION';
  @State newDeadline: string = '';
  @State isCreating: boolean = false;
  @State @Watch('alertCreateError') createError: string = '';
  private alertCreateError(): void { alertError(this.createError); }

  private projectService: ProjectService = new ProjectService();
  private interventionService: InterventionService = new InterventionService();
  private actionService: ActionService = new ActionService();
  private memoryService: MemoryService = new MemoryService();
  private settingsService: SettingsService = new SettingsService();
  private authService: AuthService = new AuthService();

  private sessionExpiredListener: () => void = () => {
    this.handleSessionExpired();
  };

  aboutToDisappear(): void {
    SessionStore.offSessionExpired(this.sessionExpiredListener);
  }

  aboutToAppear(): void {
    SessionStore.onSessionExpired(this.sessionExpiredListener);

    this.checkAndRestoreAuth();
    void this.loadUiPrefs();
  }

  private async loadUiPrefs(): Promise<void> {
    try {
      const store = await preferences.getPreferences(getContext(this), UI_PREFS_NAME);
      this.globalMemoryNoteHidden = (await store.get(KEY_HIDE_GLOBAL_MEMORY_NOTE, false)) as boolean;
    } catch {
      this.globalMemoryNoteHidden = false;
    }
  }

  private async hideGlobalMemoryNote(): Promise<void> {
    this.globalMemoryNoteHidden = true;
    try {
      const store = await preferences.getPreferences(getContext(this), UI_PREFS_NAME);
      await store.put(KEY_HIDE_GLOBAL_MEMORY_NOTE, true);
      await store.flush();
    } catch {
      // 只影响提示是否展示，持久化失败不打断浏览
    }
  }

  private async readOnboardingSeen(): Promise<boolean> {
    try {
      const store = await preferences.getPreferences(getContext(this), UI_PREFS_NAME);
      return (await store.get(KEY_ONBOARDING_SEEN, false)) as boolean;
    } catch {
      return true;
    }
  }

  private async finishOnboarding(): Promise<void> {
    animateTo({ duration: 250, curve: Curve.EaseOut }, () => { this.onboardingSeen = true; });
    try {
      const store = await preferences.getPreferences(getContext(this), UI_PREFS_NAME);
      await store.put(KEY_ONBOARDING_SEEN, true);
      await store.flush();
    } catch {
      // 只影响下次是否再显示引导
    }
  }

  private async checkAndRestoreAuth(): Promise<void> {
    this.isCheckingAuth = true;
    const startedAt = Date.now();
    const onboardingRead = this.readOnboardingSeen();
    try {
      const hasSession = await SessionStore.restoreSession(getContext(this));
      if (hasSession) {
        this.isAuthenticated = true;
        this.currentUser = SessionStore.getUser();
        this.sessionExpiresAt = SessionStore.getExpiresAt();
        this.loadAllData();
        this.loadLlmSettings();
        this.openPendingNotification();
      } else {
        this.isAuthenticated = false;
      }
    } catch {
      this.isAuthenticated = false;
    } finally {
      this.onboardingSeen = await onboardingRead;
      const remaining = SPLASH_MIN_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>((resolve: () => void) => { setTimeout(resolve, remaining); });
      }
      animateTo({ duration: 250, curve: Curve.EaseOut }, () => { this.isCheckingAuth = false; });
    }
  }

  private handleSessionExpired(message: string = '登录已失效，请重新登录'): void {
    this.isAuthenticated = false;
    this.currentMainTabIndex = 4;
    // 旧账号的卡片/通知定位意图不能跨账号保留，否则 B 登录后会被带到 A 的原对象。
    this.clearHandoffIntents();
    this.currentUser = new UserInfo();
    this.projects = [];
    this.projectDeletionNotice = '';
    this.gcGeneration += 1;
    this.dataLoadGeneration += 1;
    this.isLoading = false;
    this.globalCardStates = [];
    this.showGlobalCapture = false;
    this.gcText = '';
    this.gcError = '';
    this.gcSubmitting = false;
    this.gcRequestId = '';
    this.gcRequestPayload = '';
    this.archivedProjects = [];
    this.showArchivedProjects = false;
    this.projectLifecycleBusyId = '';
    this.projectDeleteConfirmId = '';
    this.allCards = [];
    this.allActions = [];
    this.allInterventions = [];
    promptAction.showToast({ message });
  }

  private handleLoginSuccess(): void {
    this.currentMainTabIndex = 4;
    this.isAuthenticated = true;
    this.currentUser = SessionStore.getUser();
    this.sessionExpiresAt = SessionStore.getExpiresAt();
    this.loadAllData();
    this.loadLlmSettings();
    // 登录等待期间保留的卡片定位意图，在登录完成后立即按当前时间重新核对期限后消费。
    this.openPendingNotification();
    promptAction.showToast({ message: '登录成功' });
  }

  private handleLogout(): void {
    promptAction.showDialog({
      title: '退出登录',
      message: '确认退出当前账号？退出后需重新输入凭据。',
      buttons: [
        { text: '取消', color: '#666666' },
        { text: '退出登录', color: '#CF3B2B' }
      ]
    }).then(async (result) => {
      if (result.index === 1) {
        try {
          await this.authService.logout();
          this.handleSessionExpired('已退出登录');
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'UNAUTHORIZED')) {
            promptAction.showToast({ message: '退出未完成，当前登录仍保留，请稍后重试' });
          }
        }
      }
    });
  }

  onPageShow(): void {
    this.indexVisible = true;
    if (!this.isAuthenticated) {
      return;
    }
    // 使用指南等页面的跳转意图：返回本页时切换到目标页签
    const pendingTab: number = AppStorage.get<number>('pm.pendingMainTab') ?? -1;
    if (pendingTab >= 0 && pendingTab <= 4) {
      this.currentMainTabIndex = pendingTab;
    }
    AppStorage.setOrCreate<number>('pm.pendingMainTab', -1);
    this.focusRefreshKey++;
    this.openPendingNotification();
    if (!this.isLoading) {
      this.loadAllData(true);
    }
  }

  onPageHide(): void {
    this.indexVisible = false;
  }

  onBackPress(): boolean {
    if (this.showReadinessSheet) {
      this.showReadinessSheet = false;
      return true;
    }
    if (this.showCreateDialog) {
      this.closeCreateDialog();
      return true;
    }
    if (this.showSettingsSheet) { this.showSettingsSheet = false; return true; }
    if (this.showGlobalCapture) { if (!this.gcSubmitting) this.showGlobalCapture = false; return true; }
    if (this.showGlobalTodo) { if (!this.gtSubmitting) this.showGlobalTodo = false; return true; }
    if (this.currentMainTabIndex === 3) { this.currentMainTabIndex = 4; return true; }
    return false;
  }

  /** 卡片/通知在前台投递时（onNewWant 不触发 onPageShow）由 handoffSeq 变化驱动消费一次。 */
  private onHandoffIntent(): void {
    if (!this.indexVisible || !this.isAuthenticated) {
      return;
    }
    this.openPendingNotification();
  }

  private clearHandoffIntents(): void {
    AppStorage.setOrCreate<string>('pendingMissionId', ''); AppStorage.setOrCreate<string>('pendingMissionProjectId', '');
    AppStorage.setOrCreate<string>('pendingQuestionId', ''); AppStorage.setOrCreate<string>('pendingApprovalId', '');
    AppStorage.setOrCreate<string>('pendingSourceId', ''); AppStorage.setOrCreate<string>('pendingOutputId', '');
    AppStorage.setOrCreate<string>('pendingReceiptId', ''); AppStorage.setOrCreate<string>('pendingMissionVersion', '');
    AppStorage.setOrCreate<string>('pendingHandoffExpiresAt', '');
    AppStorage.setOrCreate<string>('notificationProjectId', ''); AppStorage.setOrCreate<string>('notificationInterventionId', '');
  }

  private openPendingNotification(): void {
    const missionId = AppStorage.get<string>('pendingMissionId') ?? '';
    const missionProjectId = AppStorage.get<string>('pendingMissionProjectId') ?? '';
    if (missionId !== '' && missionProjectId !== '') {
      const route = missionHandoffRoute(missionProjectId, missionId,
        AppStorage.get<string>('pendingQuestionId') ?? '', AppStorage.get<string>('pendingApprovalId') ?? '',
        AppStorage.get<string>('pendingSourceId') ?? '', AppStorage.get<string>('pendingOutputId') ?? '',
        AppStorage.get<string>('pendingReceiptId') ?? '', AppStorage.get<string>('pendingMissionVersion') ?? '',
        AppStorage.get<string>('pendingHandoffExpiresAt') ?? '', Date.now());
      // 先消费再跳转：同一次意图不会被页面返回或前后台切换重复打开。
      this.clearHandoffIntents();
      // 排队或冷启动后过期的定位意图不再指向旧问题，回到当前原委托重新核对。
      if (route.expired) {
        promptAction.showToast({ message: '原卡片已过期，已回到当前委托；旧问题不会被当成新问题' });
      }
      router.pushUrl({ url: 'pages/MissionDetail', params: {
        projectId: route.projectId, missionId: route.missionId,
        questionId: route.questionId, approvalId: route.approvalId, sourceId: route.sourceId,
        outputId: route.outputId, receiptId: route.receiptId,
        // 卡片记录的版本只是历史定位线索，详情仍以服务端当前版本重新核对；不用于自动选中/批准旧对象。
        handoffMissionVersion: route.missionVersion, handoffExpired: route.expired ? '1' : ''
      } }); return;
    }
    const projectId = AppStorage.get<string>('notificationProjectId') ?? '';
    const interventionId = AppStorage.get<string>('notificationInterventionId') ?? '';
    if (projectId === '') {
      return;
    }
    AppStorage.setOrCreate<string>('notificationProjectId', '');
    AppStorage.setOrCreate<string>('notificationInterventionId', '');
    if (interventionId !== '') {
      router.pushUrl({
        url: 'pages/InterventionDetail',
        params: { projectId, interventionId }
      });
    } else {
      // 项目卡片只带 projectId：回到原项目工作台，不留下“点了没反应”的入口。
      router.pushUrl({ url: 'pages/ProjectHome', params: { projectId } });
    }
  }

  private async loadLlmSettings(): Promise<void> {
    try {
      const res = await this.settingsService.getSettings();
      this.llmMode = res.llmMode;
      this.llmBaseUrl = res.llmBaseUrl !== '' ? res.llmBaseUrl : 'https://api.deepseek.com/v1';
      this.llmModelName = res.llmModelName !== '' ? res.llmModelName : 'deepseek-v4-flash';
      this.hasApiKey = res.hasApiKey;
      this.apiKeyMasked = res.apiKeyMasked;
      this.settingsEditable = res.editable;
      this.settingsReadOnlyMessage = res.editable ? '' :
        (res.message !== undefined ? res.message : '生产环境配置由服务端统一管理，当前仅可查看。');
    } catch (e) {
      this.settingsEditable = false;
      this.settingsReadOnlyMessage = '暂时无法确认配置权限，已保持只读。';
    }
  }

  private async saveLlmSettings(): Promise<void> {
    if (!this.settingsEditable) {
      this.settingsFeedback = '当前环境的模型配置只读，未发起保存请求';
      return;
    }
    if (this.isSavingSettings) {
      return;
    }
    this.isSavingSettings = true;
    this.settingsFeedback = '';
    try {
      const input = new UpdateSettingsInput();
      input.llmMode = this.llmMode;
      input.llmBaseUrl = this.llmBaseUrl.trim();
      input.llmModelName = this.llmModelName.trim();
      input.llmApiKey = this.llmApiKey.trim();

      const res = await this.settingsService.updateSettings(input);
      this.hasApiKey = res.hasApiKey;
      this.apiKeyMasked = res.apiKeyMasked;
      this.settingsEditable = res.editable;
      this.llmApiKey = '';
      this.settingsFeedback = '模型配置已保存生效';
      promptAction.showToast({ message: '模型配置已更新' });
    } catch (e) {
      this.settingsFeedback = '保存失败，请检查 Base URL 或网络连接';
    } finally {
      this.isSavingSettings = false;
    }
  }

  private async probeLlmConnection(): Promise<void> {
    if (!this.settingsEditable) {
      this.settingsFeedback = '当前环境的模型配置只读，未发起连通测试';
      return;
    }
    if (this.isProbing) {
      return;
    }
    this.isProbing = true;
    this.probeResult = undefined;
    this.settingsFeedback = '';
    try {
      const input = new ProbeInput();
      if (this.llmBaseUrl.trim() !== '') {
        input.llmBaseUrl = this.llmBaseUrl.trim();
      }
      if (this.llmApiKey.trim() !== '') {
        input.llmApiKey = this.llmApiKey.trim();
      }
      if (this.llmModelName.trim() !== '') {
        input.llmModelName = this.llmModelName.trim();
      }

      const res = await this.settingsService.probeConnection(input);
      this.probeResult = res;
    } catch (e) {
      const err = new ProbeResponse();
      err.success = false;
      err.error = '网络请求异常，无法连接探针端点';
      this.probeResult = err;
    } finally {
      this.isProbing = false;
    }
  }

  private async loadAllData(silent: boolean = false): Promise<void> {
    const token: string = SessionStore.getToken();
    if (!this.isAuthenticated || token === '') return;
    const generation: number = ++this.dataLoadGeneration;
    if (!silent) {
      this.isLoading = true;
    }
    this.errorMessage = '';
    this.dataSyncState = '同步中...';
    try {
      const projects = await this.projectService.listProjects();
      if (!this.isCurrentDataLoad(token, generation)) return;
      this.projects = projects;
      this.projectDeletionNotice = this.projectService.deletionNotice;
      if (this.projects.length > 0) {
        WidgetDataService.updateWidgetWithProject(getContext(this), this.projects[0]).catch(() => {});
      }

      // 归档项目单独取。主列表与跨项目聚合都不该包含它们，
      // 但归档必须可恢复，所以归档列表本身要拉回来放在管理入口里。
      try {
        const archived = await this.projectService.listArchivedProjects();
        if (!this.isCurrentDataLoad(token, generation)) return;
        this.archivedProjects = archived;
      } catch (_e) {
        if (!this.isCurrentDataLoad(token, generation)) return;
        // 归档列表拉取失败不影响主流程呈现
        this.archivedProjects = [];
      }

      // 聚合跨项目数据
      const intervs: Intervention[] = [];
      const acts: ActionItem[] = [];
      const cards: KnowledgeCard[] = [];
      let failedCount = 0;

      // 各项目的详情、提醒、行动、时态互不依赖：项目内四个请求并发，项目之间限 4 个一批，
      // 避免启动时间随项目数线性叠加；结果仍按项目原顺序合并，单项目失败只计入部分同步。
      const statuses: CardTemporalStatus[] = [];
      const batchSize = 4;
      for (let start = 0; start < projects.length; start += batchSize) {
        const batch = projects.slice(start, start + batchSize);
        const loaded = await Promise.all(batch.map((p: Project) => this.loadProjectAggregate(p)));
        if (!this.isCurrentDataLoad(token, generation)) return;
        for (const item of loaded) {
          for (const c of item.cards) {
            cards.push(c);
          }
          for (const i of item.interventions) {
            intervs.push(i);
          }
          for (const a of item.actions) {
            acts.push(a);
          }
          for (const st of item.statuses) {
            statuses.push(st);
          }
          if (item.failed) {
            failedCount++;
          }
        }
      }

      this.allInterventions = intervs;
      this.allActions = acts;
      this.allCards = cards;
      this.globalCardStates = statuses;
      if (failedCount > 0) {
        this.dataSyncState = `部分同步 (${this.projects.length - failedCount}/${this.projects.length})`;
      } else {
        this.dataSyncState = '已同步';
      }
    } catch (e) {
      if (!this.isCurrentDataLoad(token, generation)) return;
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '无法连接服务，请检查网络连接';
      }
      this.dataSyncState = '同步失败';
    } finally {
      if (this.isCurrentDataLoad(token, generation)) this.isLoading = false;
    }
  }

  private async loadProjectAggregate(p: Project): Promise<ProjectAggregate> {
    const result = new ProjectAggregate();
    const detailP = this.projectService.getProjectDetail(p.id).then((detail) => {
      for (const c of detail.cards) {
        c.projectId = p.id;
        c.projectTitle = p.title;
        result.cards.push(c);
      }
    }).catch(() => { result.failed = true; });
    const intervP = this.interventionService.list(p.id).then((items: Intervention[]) => { result.interventions = items; })
      .catch(() => { result.failed = true; });
    const actionP = this.actionService.list(p.id).then((items: ActionItem[]) => { result.actions = items; })
      .catch(() => { result.failed = true; });
    // 时态状态：区分 当前有效 / 已取代 / 存在冲突 / 待确认，不删除历史；单项目拉取失败不影响列表
    const timelineP = this.memoryService.getDecisionTimeline(p.id).then((timeline) => {
      for (const item of timeline.items) {
        const st = new CardTemporalStatus();
        st.cardId = item.card.id;
        st.supportState = item.supportState;
        st.topLevelState = item.topLevelState;
        st.reasonCode = item.reasonCode;
        st.displayReason = item.displayReason;
        st.statusLabel = item.statusLabel;
        st.supersededByTitle = item.supersededBy !== null ? item.supersededBy.title : '';
        result.statuses.push(st);
      }
    }).catch(() => {});
    await Promise.all([detailP, intervP, actionP, timelineP]);
    return result;
  }

  private isCurrentDataLoad(token: string, generation: number): boolean {
    return this.isAuthenticated && token === SessionStore.getToken() && generation === this.dataLoadGeneration;
  }

  private openCreateDialog(): void {
    this.newTitle = '';
    this.newDescription = '';
    this.newGoal = '';
    this.newScenario = 'COMPETITION';
    this.newDeadline = '';
    this.createError = '';
    this.showCreateDialog = true;
  }

  private pickNewDeadline(): void {
    DatePickerDialog.show({
      start: new Date(2000, 0, 1),
      end: new Date(2100, 11, 31),
      selected: DateOnly.selected(this.newDeadline),
      onDateAccept: (value: Date) => {
        this.newDeadline = DateOnly.format(value);
        this.createError = '';
      },
    });
  }

  private closeCreateDialog(): void {
    if (this.isCreating) {
      return;
    }
    this.showCreateDialog = false;
  }

  private canCreateProject(): boolean {
    return this.newTitle.trim().length >= 2 && this.newGoal.trim().length >= 2 && !this.isCreating;
  }

  private async submitCreateProject(): Promise<void> {
    if (this.isCreating) {
      return;
    }
    const title = this.newTitle.trim();
    if (title.length < 2) {
      this.createError = '项目名称至少 2 个字';
      return;
    }
    if (this.newGoal.trim().length < 2) {
      this.createError = '项目目标至少 2 个字';
      return;
    }
    this.isCreating = true;
    this.createError = '';
    try {
      const input: ProjectCreateInput = new ProjectCreateInput();
      input.title = title;
      input.description = this.newDescription.trim();
      input.goal = this.newGoal.trim();
      input.scenario = this.newScenario;
      if (this.newDeadline.trim() !== '') {
        input.deadline = this.newDeadline.trim();
      }
      await this.projectService.createProject(input);
      this.showCreateDialog = false;
      promptAction.showToast({ message: '项目档案创建成功' });
      await this.loadAllData();
    } catch (e) {
      if (e instanceof ApiError) {
        this.createError = e.message;
      } else {
        this.createError = '创建项目失败';
      }
    } finally {
      this.isCreating = false;
    }
  }

  /**
   * 归档 / 恢复项目。
   *
   * 归档是可恢复的展示偏好，不是删除：记忆时态、行动与成果都不变，
   * 因此不弹二次确认——把它做成和删除一样重的动作反而会误导用户。
   * busy id 同时承担双击防护，请求未返回前所有项目入口保持禁用。
   */
  private async toggleProjectArchive(project: Project): Promise<void> {
    if (this.projectLifecycleBusyId !== '') {
      return;
    }
    const isArchived: boolean = project.archivedAt !== undefined && project.archivedAt !== null && project.archivedAt !== '';
    this.projectLifecycleBusyId = project.id;
    try {
      if (isArchived) {
        await this.projectService.restoreProject(project.id);
      } else {
        await this.projectService.archiveProject(project.id);
      }
      promptAction.showToast({ message: isArchived ? '已恢复，项目回到项目列表' : '已归档，保留全部记忆与成果，可随时恢复' });
      this.projectDeleteConfirmId = '';
      await this.loadAllData(true);
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '操作失败，请稍后重试' });
    } finally {
      this.projectLifecycleBusyId = '';
    }
  }

  /**
   * 长按项目卡片触发管理菜单：
   * 交互支持长按显示“恢复/归档”与“删除”，避免在卡片下方常驻按钮影响主界面整洁。
   */
  private async openProjectActionMenu(project: Project): Promise<void> {
    if (this.projectLifecycleBusyId !== '') {
      return;
    }
    const isArchived: boolean = project.archivedAt !== undefined && project.archivedAt !== null && project.archivedAt !== '';
    try {
      const menu = await promptAction.showActionMenu({
        title: TextFormatters.readableText(project.title, '项目管理'),
        buttons: project.canDelete === true ? [
          { text: isArchived ? '恢复项目' : '归档项目', color: '#0A7EA4' },
          { text: '删除项目', color: '#FA5151' }
        ] : [{ text: isArchived ? '恢复项目' : '归档项目', color: '#0A7EA4' }]
      });
      if (menu.index === 0) {
        await this.toggleProjectArchive(project);
      } else if (menu.index === 1 && project.canDelete === true) {
        this.projectDeleteConfirmId = project.id;
      }
    } catch (_e) {
      // 用户取消菜单，无需提示
    }
  }

  /**
   * 删除项目：服务端级联清空该项目的记忆、行动与成果，不可恢复。
   * 与归档性质完全不同，必须先经过 projectDeleteConfirmId 的二次确认。
   */
  private async deleteProjectItem(project: Project): Promise<void> {
    if (this.projectLifecycleBusyId !== '') {
      return;
    }
    this.projectLifecycleBusyId = project.id;
    try {
      const message: string = await this.projectService.deleteProject(project.id, project.updatedAt);
      promptAction.showToast({ message: message });
      this.projectDeleteConfirmId = '';
      await this.loadAllData(true);
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '删除失败，请稍后重试' });
    } finally {
      this.projectLifecycleBusyId = '';
    }
  }

  /**
   * 动态生成无 0 噪音的项目统计摘要：紧凑一行，用全角空格分隔。
   * 统计口径保持服务端定义（进行中/待处理已排除演示数据），视觉优先级低于标题、准备项与下一步。
   */
  private getProjectMetricSummary(project: Project): string {
    const parts: string[] = [];
    if (project._count.cards > 0) {
      parts.push(`${project._count.cards} 记忆`);
    }
    if (project.dashboard.activeReminderCount > 0) {
      parts.push(`${project.dashboard.activeReminderCount} 提醒`);
    }
    if (project.dashboard.activeActionCount > 0) {
      parts.push(`${project.dashboard.activeActionCount} 行动`);
    }
    if (project._count.artifacts > 0) {
      parts.push(`${project._count.artifacts} 草稿`);
    }
    if (parts.length === 0) {
      return '还没有记录与成果';
    }
    return parts.join('　');
  }

  // ----------------------------------------------------
  // 底部导航栏 Bar (一级 4 项：焦点 / 项目 / 记忆 / 行动；设置位于右上角)
  // ----------------------------------------------------
  @Builder
  private MainTabItemIcon(index: number) {
    if (index === 4) {
      DashboardIcon({ isSelected: this.currentMainTabIndex === 4, iconSize: 20 })
    } else if (index === 0) {
      FolderIcon({ isSelected: this.currentMainTabIndex === 0, iconSize: 20 })
    } else if (index === 1) {
      MemoryIcon({ isSelected: this.currentMainTabIndex === 1, iconSize: 20 })
    } else if (index === 2) {
      TaskIcon({ isSelected: this.currentMainTabIndex === 2, iconSize: 20 })
    } else {
      SettingsIcon({ isSelected: this.currentMainTabIndex === 3, iconSize: 20 })
    }
  }

  @Builder
  private MainTabBarItem(index: number, label: string) {
    Column() {
      Row() { this.MainTabItemIcon(index) }
        .width(36).height(30).justifyContent(FlexAlign.Center).borderRadius(10)
        .backgroundColor(this.currentMainTabIndex === index ? PMColors.BRAND_LIGHT : Color.Transparent)
      Text(label)
        .fontSize(PMFontSize.BOTTOM_NAV)
        .fontFamily(PMFontFamily.SANS)
        .fontWeight(this.currentMainTabIndex === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.currentMainTabIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
        .margin({ top: 3 })
    }
    .layoutWeight(1)
    .height(58)
    .justifyContent(FlexAlign.Center)
    .clickEffect(PMInteraction.PRESS_EFFECT)
    .onClick(() => {
      this.currentMainTabIndex = index;
      if (index === 3) {
        this.loadLlmSettings();
      }
    })
    .accessibilityText(label)
    .accessibilitySelected(this.currentMainTabIndex === index)
  }

  @Builder
  private MainBottomBar() {
    Row() {
      this.MainTabBarItem(4, '焦点')
      this.MainTabBarItem(0, '项目')
      this.MainTabBarItem(1, '记忆')
      this.MainTabBarItem(2, '行动')
    }
    .width('100%')
    .padding({ top: 4, bottom: 4 })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { top: 1 }, color: PMColors.BORDER })
    .constraintSize({ maxWidth: PMBreakpoint.barMaxWidth(this.widthBp) })
  }

  // ----------------------------------------------------
  // Tab 0: 项目档案视图
  // ----------------------------------------------------
  @Builder
  private ProjectsTab() {
    Column() {
      // 场景分类筛选胶囊 + 排序切换：选中态用底色与字色表达，不再叠 2px 描边
      Row() {
        Stack({ alignContent: Alignment.End }) {
        Scroll() {
          Row() {
            ForEach(['ALL', 'COURSE_DESIGN', 'RESEARCH', 'COMPETITION', 'INNOVATION', 'LAB_TASK'], (scenario: string) => {
              Button(scenario === 'ALL' ? '全部' : TextFormatters.scenarioToChinese(scenario))
                .type(ButtonType.Capsule)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(this.selectedScenarioFilter === scenario ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(this.selectedScenarioFilter === scenario ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.selectedScenarioFilter === scenario ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.FULL)
                .height(36)
                .border({ width: 1,
                  color: this.selectedScenarioFilter === scenario ? PMColors.BRAND_LIGHT : PMColors.BORDER })
                .margin({ right: PMSpacing.XS })
                .accessibilityText(`按场景筛选：${scenario === 'ALL' ? '全部' : TextFormatters.scenarioToChinese(scenario)}`)
                .accessibilitySelected(this.selectedScenarioFilter === scenario)
                .onClick(() => { this.selectedScenarioFilter = scenario; })
            }, (scenario: string) => scenario)
          }
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .align(Alignment.Start)
          Row().width(28).height(36).hitTestBehavior(HitTestMode.Transparent)
            .linearGradient({ angle: 90, colors: [[$r('app.color.pm_background_fade'), 0], [PMColors.BACKGROUND, 1]] })
        }
        .layoutWeight(1)

        Button(this.projectSortMode === 'attention' ? '需要关注' : '最近更新', { type: ButtonType.Capsule })
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.projectSortMode === 'attention' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.projectSortMode === 'attention' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.FULL)
          .height(36)
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
          .margin({ left: PMSpacing.SM })
          .accessibilityText(`排序方式：${this.projectSortMode === 'attention' ? '需要关注' : '最近更新'}，点击切换`)
          .onClick(() => { this.toggleProjectSort(); })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.XS, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.BACKGROUND)

      // 归档管理入口放在分支之外：即使项目全部归档、主列表为空，
      // 也必须能进到归档列表把它们恢复回来。
      if (this.archivedProjects.length > 0) {
        Row() {
          Text(`已归档项目（${this.archivedProjects.length}）`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .layoutWeight(1)

          Button('管理与恢复').type(ButtonType.Capsule).borderRadius(PMRadius.FULL)
            .height(40)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.FULL)
            .accessibilityText(`查看 ${this.archivedProjects.length} 个已归档项目并恢复`)
            .onClick(() => {
              this.projectDeleteConfirmId = '';
              this.showArchivedProjects = true;
            })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      }

      if (this.getFilteredProjects().length === 0) {
        if (this.globalSearchQuery.trim() !== '' || this.selectedScenarioFilter !== 'ALL') {
          EmptyStateView({
            title: '没有匹配的项目',
            description: '换个关键词，或清除分类筛选后重试',
            actionText: '清除筛选',
            onAction: () => {
              this.globalSearchQuery = '';
              this.selectedScenarioFilter = 'ALL';
            }
          })
        } else {
          EmptyStateView({
            title: '暂无项目档案',
            description: '点击右上角“+ 新建项目”开始建立首个证据档案',
            actionText: '+ 新建项目',
            onAction: () => {
              this.openCreateDialog();
            }
          })
        }
      } else {
        List({ space: PMSpacing.SM }) {
          ForEach(this.getFilteredProjects(), (project: Project) => {
            ListItem() {
              this.projectListItem(project)
            }
          }, (project: Project) => project.id)
          ListItem() {
            Text('长按项目卡片可归档或删除').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
              .width('100%').textAlign(TextAlign.Center).padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
          }
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM })
        .contentEndOffset(PMSpacing.LG)
      }
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .align(Alignment.Top)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
    .bindSheet($$this.showArchivedProjects, this.ArchivedProjectsSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true,
      showClose: false
    })
  }

  /**
   * 已归档项目管理。
   *
   * 用 sheet 而不是在主列表里再嵌一段：归档项目本来就不属于主列表，
   * 混排会让人以为它们仍然占用"需要关注"的位置；sheet 也不影响主列表的布局。
   */
  @Builder
  private ArchivedProjectsSheet() {
    Column() {
      Text('已归档项目')
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .width('100%')

      Text('归档只让项目离开主列表，它的记忆、行动与成果都保持有效；恢复后不会改变任何历史。')
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .width('100%')
        .margin({ top: PMSpacing.XS })

      if (this.archivedProjects.length === 0) {
        Text('当前没有已归档项目。')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.LG })
      } else {
        List({ space: PMSpacing.SM }) {
          ForEach(this.archivedProjects, (project: Project) => {
            ListItem() {
              Column() {
                Text(TextFormatters.readableText(project.title, '项目名称无法读取'))
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')

                this.projectLifecycleActions(project)
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.MD)
              .border({ width: 1, color: PMColors.BORDER })
              .alignItems(HorizontalAlign.Start)
            }
          }, (project: Project) => project.id)
        }
        .width('100%')
        .constraintSize({ maxHeight: 360 })
        .margin({ top: PMSpacing.MD })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(PMSpacing.LG)
  }

  private getFilteredProjects(): Project[] {
    const q = this.globalSearchQuery.trim().toLowerCase();
    const matched = this.projects.filter((p) => {
      if (this.selectedScenarioFilter !== 'ALL' && p.scenario !== this.selectedScenarioFilter) {
        return false;
      }
      if (q === '') {
        return true;
      }
      return p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.goal.toLowerCase().includes(q);
    });
    if (this.projectSortMode !== 'attention') {
      // 默认保持服务端 updatedAt desc
      return matched;
    }
    return matched.sort((left, right) => {
      const scoreDifference = this.projectAttentionScore(right) - this.projectAttentionScore(left);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }

  /**
   * 「需要关注」排序评分：结构沿用服务端 attentionScore（截止风险 > 高优提醒 > 进行中行动），
   * 但准备项缺口只在竞赛场景计入——六项竞赛准备清单对课程设计/科研训练不适用，
   * 直接复用服务端分值会让非竞赛项目固定背约 +100 的缺口偏置，排序失去跨类型可比性。
   */
  private projectAttentionScore(project: Project): number {
    const readinessGap = project.scenario === 'COMPETITION' ? 100 - project.dashboard.readiness.percentage : 0;
    return project.dashboard.deadline.rank * 1000 +
      project.dashboard.highestReminderSeverity * 100 +
      Math.min(project.dashboard.activeActionCount, 9) * 10 +
      readinessGap;
  }

  private toggleProjectSort(): void {
    this.projectSortMode = this.projectSortMode === 'attention' ? 'updated' : 'attention';
  }

  /** 顶栏搜索栏的占位文案：与当前页签的可搜索内容一致 */
  private searchPlaceholder(): string {
    if (this.currentMainTabIndex === 0) {
      return '搜索项目名称、描述或目标...';
    }
    if (this.currentMainTabIndex === 1) {
      this.gcGeneration += 1;
      this.gcSubmitting = false;
      this.gcRequestId = '';
      this.gcRequestPayload = '';
      return '搜索记忆标题、摘要或关键词...';
    }
    return '搜索提醒或行动标题...';
  }

  private toggleSearch(): void {
    if (this.searchOpen) {
      this.globalSearchQuery = '';
    }
    this.searchOpen = !this.searchOpen;
  }

  private searchTargetName(): string {
    if (this.currentMainTabIndex === 0) {
      return '项目';
    }
    if (this.currentMainTabIndex === 1) {
      return '记忆';
    }
    if (this.currentMainTabIndex === 2) {
      return '行动';
    }
    return '设置';
  }

  private createActionName(): string {
    if (this.currentMainTabIndex === 0) {
      return '新建项目';
    }
    if (this.currentMainTabIndex === 1) {
      return '记录项目碎片';
    }
    return '新增待办';
  }

  /** 全局页的新增入口：复用项目内同名表单，只是先选归属项目 */
  private openContextualCreate(): void {
    if (this.currentMainTabIndex === 0) {
      this.openCreateDialog();
      return;
    }
    if (this.projects.length === 0) {
      promptAction.showToast({ message: '请先创建项目，再记录记忆或待办' });
      return;
    }
    if (this.currentMainTabIndex === 1) {
      this.gcProjectIndex = 0;
      this.gcSourceType = '随手记录';
      this.gcText = '';
      this.gcError = '';
      this.showGlobalCapture = true;
      return;
    }
    if (this.currentMainTabIndex === 2) {
      this.gtProjectIndex = 0;
      this.gtTitle = '';
      this.gtDescription = '';
      this.gtPriority = 3;
      this.gtError = '';
      this.showGlobalTodo = true;
    }
  }

  private globalProjectId(index: number): string {
    if (index >= 0 && index < this.projects.length) {
      return this.projects[index].id;
    }
    return '';
  }

  private globalProjectTitle(index: number): string {
    if (index >= 0 && index < this.projects.length) {
      return this.projects[index].title;
    }
    return '';
  }

  private globalProjectOptions(): SelectOption[] {
    return this.projects.map((p: Project): SelectOption => ({ value: p.title } as SelectOption));
  }

  private async submitGlobalCapture(): Promise<void> {
    const projectId: string = this.globalProjectId(this.gcProjectIndex);
    const trimmed: string = this.gcText.trim();
    if (projectId === '' || trimmed.length < 5 || this.gcSubmitting) {
      return;
    }
    this.gcSubmitting = true;
    this.gcError = '';
    const token: string = SessionStore.getToken();
    const generation: number = this.gcGeneration;
    const sourceType: string = this.gcSourceType;
    const payload: string = JSON.stringify([projectId, trimmed, sourceType]);
    if (this.gcRequestPayload !== payload || this.gcRequestId === '') {
      this.gcRequestPayload = payload;
      this.gcRequestId = `harmony-capture-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }
    const requestId: string = this.gcRequestId;
    try {
      const saved = await this.memoryService.capture(projectId, trimmed, sourceType, requestId);
      if (token !== SessionStore.getToken() || generation !== this.gcGeneration) return;
      if (projectId === this.globalProjectId(this.gcProjectIndex) && trimmed === this.gcText.trim() && sourceType === this.gcSourceType) {
        this.showGlobalCapture = false;
        this.gcText = '';
        this.gcRequestId = '';
        this.gcRequestPayload = '';
      }
      promptAction.showToast({ message: this.memoryService.captureModeLabel(saved) });
      this.loadAllData();
    } catch (e) {
      if (token !== SessionStore.getToken() || generation !== this.gcGeneration) return;
      this.gcError = e instanceof ApiError ? e.message : '记录失败，请稍后重试';
    } finally {
      if (token === SessionStore.getToken() && generation === this.gcGeneration) this.gcSubmitting = false;
    }
  }

  private async submitGlobalTodo(): Promise<void> {
    const projectId: string = this.globalProjectId(this.gtProjectIndex);
    const trimmed: string = this.gtTitle.trim();
    if (projectId === '' || trimmed === '' || this.gtSubmitting) {
      return;
    }
    this.gtSubmitting = true;
    this.gtError = '';
    try {
      const input: ActionCreateInput = new ActionCreateInput();
      input.title = trimmed;
      const desc: string = this.gtDescription.trim();
      input.description = desc === '' ? undefined : desc;
      input.priority = this.gtPriority;
      await this.actionService.create(projectId, input);
      this.showGlobalTodo = false;
      this.gtTitle = '';
      this.gtDescription = '';
      promptAction.showToast({ message: '已加入待办' });
      this.loadAllData();
    } catch (e) {
      this.gtError = e instanceof ApiError ? e.message : '创建待办失败，请稍后重试';
    } finally {
      this.gtSubmitting = false;
    }
  }

  /** 与焦点页服务端计数同一口径：待处理或延后已到期、非演示、非项目目标提问。 */
  private isActiveReminder(i: Intervention): boolean {
    if (i.isSimulated || (i.dedupeKey ?? '').startsWith('goal:')) {
      return false;
    }
    if (i.status === 'OPEN') {
      return true;
    }
    return i.status === 'SNOOZED' && i.snoozedUntil !== undefined && i.snoozedUntil !== null && Date.parse(i.snoozedUntil) <= Date.now();
  }

  private visibleOpenInterventions(): Intervention[] {
    const q = this.globalSearchQuery.trim().toLowerCase();
    return this.allInterventions.filter((i) => {
      if (!this.isActiveReminder(i)) {
        return false;
      }
      return q === '' || i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q);
    });
  }

  private visibleOpenActions(): ActionItem[] {
    const q = this.globalSearchQuery.trim().toLowerCase();
    return this.allActions.filter((a) => {
      if (a.isSimulated || (this.globalActionStatus === 'ACTIVE' ? a.status === 'DONE' || a.status === 'CANCELLED' : this.globalActionStatus !== 'ALL' && a.status !== this.globalActionStatus)) {
        return false;
      }
      return q === '' || a.title.toLowerCase().includes(q);
    });
  }

  /**
   * 项目卡上的准备项摘要：只以「N/M 项已形成」表达，百分比不进卡片主文案——
   * 它只是这份清单的完成比例，与百分比并排出现会被读成项目整体进度。
   * 没有记忆也没有成果时不画虚假进度；服务端没返回清单时如实说明，不用默认值凑数。
   */
  private readinessSummary(project: Project): string {
    const items: ReadinessItem[] = project.dashboard.readiness.items;
    if (items.length === 0) {
      return '准备项清单未返回';
    }
    if (project.dashboard.readiness.percentage === 0 && project._count.cards === 0 && project._count.artifacts === 0) {
      return '尚未形成';
    }
    let completed = 0;
    for (const item of items) {
      if (item.complete) {
        completed++;
      }
    }
    return `${completed}/${items.length} 项已形成`;
  }

  /**
   * 下一步的主文案：非竞赛场景下，服务端 gap 分支的六项竞赛准备文案（如「生成答辩 PPT 大纲」、
   * 「参赛准备度 67%」）不适用，与 Web 端同规则改为「记录最新进展」，避免拿竞赛清单冒充通用进度。
   */
  private nextActionLabel(project: Project): string {
    const nextAction = project.dashboard.nextAction;
    if (this.isNonCompetitionGap(nextAction.detail, project.scenario)) {
      return '记录最新进展';
    }
    return TextFormatters.readableText(nextAction.label, '下一步行动无法读取');
  }

  /** 下一步的补充说明：非竞赛场景被改写为「记录最新进展」时，竞赛准备度说明一并去掉 */
  private nextActionDetail(project: Project): string {
    const nextAction = project.dashboard.nextAction;
    if (this.isNonCompetitionGap(nextAction.detail, project.scenario)) {
      return '';
    }
    return nextAction.detail;
  }

  private isNonCompetitionGap(detail: string, scenario: string): boolean {
    return scenario !== 'COMPETITION' && detail.startsWith('参赛准备度');
  }

  /** 下一步行动的强调色：跟随服务端 tone，不再借截止日状态表达提醒/行动语义 */
  private nextActionToneColor(project: Project): ResourceColor {
    if (project.dashboard.nextAction.tone === 'critical') {
      return PMColors.RISK;
    }
    if (project.dashboard.nextAction.tone === 'attention') {
      return PMColors.BRAND;
    }
    return PMColors.INK_SECONDARY;
  }

  /**
   * 「下一步」导航：nextAction.href 是 Web 路由锚点，不能直接当鸿蒙路由使用。
   * 显式映射到 ProjectHome 已支持的深链参数（tab=memory/actions/artifacts），
   * 识别不了的一律降级进项目概览，不伪造已定位到具体区域。
   */
  private openNextAction(project: Project): void {
    const href: string = project.dashboard.nextAction.href;
    let url: string = 'pages/ProjectHome';
    if (href.endsWith('#action-board')) {
      router.pushUrl({ url, params: { projectId: project.id, tab: 'actions' } });
      return;
    }
    if (href.endsWith('#capture-box') || href.includes('?cardType=')) {
      // 记录入口与资料清单（knowledge-assets）都在项目「资料」页
      router.pushUrl({ url, params: { projectId: project.id, tab: 'memory' } });
      return;
    }
    if (href.includes('/generate?type=')) {
      // 成果生成入口在「成果」页；ProjectHome 支持 tab=artifacts 深链
      router.pushUrl({ url, params: { projectId: project.id, tab: 'artifacts' } });
      return;
    }
    if (this.isNonCompetitionGap(project.dashboard.nextAction.detail, project.scenario)) {
      router.pushUrl({ url, params: { projectId: project.id, tab: 'memory' } });
      return;
    }
    // #interventions 与未知锚点：概览包含提醒处理区，作为安全落点
    router.pushUrl({ url, params: { projectId: project.id } });
  }

  /**
   * 项目卡片：四层信息结构（身份 → 一行简况 → 关键进展 → 下一步）。
   * 「项目名称」与「下一步」是主要视觉锚点；卡片高度随内容自然变化，
   * 准备项区块只在竞赛场景出现（六项竞赛清单对其他场景不适用，展示会被读成通用进度）。
   *
   * 点击冲突处理：ArkUI 的 onClick 会向父级冒泡（HitTestMode.Block / stopPropagation
   * 在当前 SDK 上均不可靠，真机已验证），因此整卡不绑定 onClick，
   * 各区域（身份区 → 概览、准备项 → 弹层、下一步 → 定向导航、统计 → 概览）各自独立响应。
   */
  @Builder
  private projectItem(project: Project) {
    Column() {
      // 第一、二层（身份 + 简况）：点击进入项目概览
      Column() {
        Row() {
          CategoryBadge({ category: project.scenario })
          DeadlineBadge({ deadline: project.dashboard.deadline })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        Text(TextFormatters.readableText(project.title, '项目名称无法读取，请重新编辑。'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: PMSpacing.SM })
          .sharedTransition(`project-title-${project.id}`, { duration: PMMotion.ENTER, curve: Curve.Friction })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: project.id, title: TextFormatters.readableText(project.title, '') } });
      })
      .accessibilityText(`打开项目 ${TextFormatters.readableText(project.title, '项目')}`)

      // 参赛准备项（仅竞赛场景）：计数来自服务端 readiness.items；进度条只代表清单完成比例
      if (project.scenario === 'COMPETITION') {
        Column() {
          Row() {
            Text('参赛准备项')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .layoutWeight(1)
            Text(this.readinessSummary(project))
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .fontFeature('"tnum" on')
              .maxLines(1)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(4)
              .backgroundColor(PMColors.BORDER)
              .borderRadius(PMRadius.FULL)
            Row()
              .width(`${Math.min(100, Math.max(0, project.dashboard.readiness.percentage))}%`)
              .height(4)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .margin({ top: 6 })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .constraintSize({ minHeight: 44 })
        .justifyContent(FlexAlign.Center)
        .margin({ top: PMSpacing.SM })
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          this.readinessForSheet = project.dashboard.readiness;
          this.showReadinessSheet = true;
        })
        .accessibilityText(`参赛准备项 ${this.readinessSummary(project)}，点击查看逐项清单与计算口径；该比例只是清单完成度，不代表项目整体进度`)
      }

      // 下一步条：等你处理用暖色底，其余用浅底；点击直接进入对应工作区
      if (project.dashboard.nextAction.label !== '') {
        Text(this.nextActionDetail(project) !== '' ? `${this.nextActionLabel(project)}：${this.nextActionDetail(project)}` : this.nextActionLabel(project))
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(project.dashboard.nextAction.tone === 'critical' ? PMColors.WARNING : PMColors.INK_PRIMARY)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .constraintSize({ minHeight: 44 })
          .padding({ left: 10, right: 10, top: 8, bottom: 8 })
          .backgroundColor(project.dashboard.nextAction.tone === 'critical' ? PMColors.WARNING_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(10)
          .margin({ top: PMSpacing.SM })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            this.openNextAction(project);
          })
          .accessibilityText(`下一步：${this.nextActionLabel(project)}，点击前往对应工作区`)
      }

      // 紧凑统计（无 0 值噪音）；点击进入概览，保证卡片主体无死区
      Text(this.getProjectMetricSummary(project))
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_SECONDARY)
        .width('100%')
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: project.id } });
        })
        .margin({ top: PMSpacing.SM })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
    .shadow({
      radius: PMCardStyle.SHADOW_RADIUS,
      color: PMCardStyle.SHADOW_COLOR,
      offsetX: 0,
      offsetY: PMCardStyle.SHADOW_OFFSET_Y
    })
    .alignItems(HorizontalAlign.Start)
    .gesture(
      LongPressGesture({ repeat: false })
        .onAction(() => {
          this.openProjectActionMenu(project);
        })
    )
  }

  /**
   * 项目列表项 = 可点击且支持长按管理的卡片主体。
   * 长按后唤起删除/恢复（归档）操作菜单；仅在确认删除态时就地展开风险确认框。
   */
  @Builder
  private projectListItem(project: Project) {
    Column({ space: PMSpacing.XS }) {
      this.projectItem(project)
      if (this.projectDeleteConfirmId === project.id) {
        this.projectLifecycleActions(project)
      }
    }
    .width('100%')
  }

  @Builder
  private projectLifecycleActions(project: Project) {
    Column() {
      if (this.projectDeleteConfirmId === project.id) {
        // 删除不可恢复，必须写清会失去什么再确认；平时不常驻展示
        Column() {
          Text(`删除「${TextFormatters.readableText(project.title, '该项目')}」会同时删除它的全部记忆、行动与成果，且无法恢复。`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
            .width('100%')

          Row({ space: PMSpacing.SM }) {
            Button(this.projectLifecycleBusyId === project.id ? '正在删除…' : '确认删除').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .height(40)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.RISK)
              .backgroundColor(PMColors.RISK_LIGHT)
              .border({ width: 1, color: PMColors.RISK_BORDER })
              .borderRadius(PMRadius.SM)
              .enabled(this.projectLifecycleBusyId === '')
              .accessibilityText(`确认删除项目 ${project.title}，会同时删除全部记忆、行动与成果`)
              .onClick(() => {
                this.deleteProjectItem(project);
              })

            Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .height(40)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .enabled(this.projectLifecycleBusyId === '')
              .accessibilityText('取消删除')
              .onClick(() => {
                this.projectDeleteConfirmId = '';
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.SM })
        }
        .width('100%')
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.RISK_LIGHT)
        .borderRadius(PMRadius.SM)
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
  }

  // ----------------------------------------------------
  // Tab 1: 待办提醒视图 (跨项目待办与提醒)
  // ----------------------------------------------------
  @Builder
  private TasksTab() {
    Column() {
      Column() {
        Row({ space: 8 }) {
          Button(`主动提醒 ${this.allInterventions.filter((i: Intervention) => this.isActiveReminder(i)).length}`, { type: ButtonType.Normal })
            .layoutWeight(1).constraintSize({ minHeight: 44 }).borderRadius(11).fontSize(14)
            .backgroundColor(this.taskTabFilter === 'REMINDERS' ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
            .fontColor(this.taskTabFilter === 'REMINDERS' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .accessibilitySelected(this.taskTabFilter === 'REMINDERS').onClick(() => { this.taskTabFilter = 'REMINDERS'; })
          Button(`待办行动 ${this.allActions.filter((a: ActionItem) => a.status !== 'DONE' && a.status !== 'CANCELLED' && !a.isSimulated).length}`, { type: ButtonType.Normal })
            .layoutWeight(1).constraintSize({ minHeight: 44 }).borderRadius(11).fontSize(14)
            .backgroundColor(this.taskTabFilter === 'ACTIONS' ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
            .fontColor(this.taskTabFilter === 'ACTIONS' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .accessibilitySelected(this.taskTabFilter === 'ACTIONS').onClick(() => { this.taskTabFilter = 'ACTIONS'; })
        }.width('100%')
        if (this.taskTabFilter === 'ACTIONS') {
          Scroll() {
            Row({ space: 8 }) {
              ForEach(['ACTIVE', 'TODO', 'DOING', 'DONE', 'ALL'], (status: string) => {
                Button(status === 'ACTIVE' ? '待推进' : status === 'ALL' ? '全部' : status === 'TODO' ? '待开始' : status === 'DOING' ? '进行中' : '已完成', { type: ButtonType.Normal })
                  .constraintSize({ minHeight: 44 }).fontSize(12).borderRadius(8)
                  .fontColor(this.globalActionStatus === status ? PMColors.BRAND : PMColors.INK_SECONDARY)
                  .backgroundColor(this.globalActionStatus === status ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
                  .accessibilitySelected(this.globalActionStatus === status).onClick(() => { this.globalActionStatus = status; })
              })
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).margin({ top: 8 })
        }
      }.width('100%').padding(16)
      List({ space: 10 }) {
        if (this.taskTabFilter === 'REMINDERS') {
          if (this.visibleOpenInterventions().length === 0) {
            ListItem() { Text('当前没有符合筛选的提醒').fontSize(14).fontColor(PMColors.INK_TERTIARY).padding(16) }
          }
          ForEach(this.visibleOpenInterventions(), (item: Intervention) => {
            ListItem() {
              PMListRow({ title: item.title, subtitle: item.content, kind: 'reminder', status: item.severity >= 4 ? '优先处理' : '待处理', risk: item.severity >= 4,
                meta: this.projects.find((p: Project) => p.id === item.projectId)?.title ?? '',
                onOpen: (): void => { router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: item.projectId, interventionId: item.id } }); } })
                .backgroundColor(PMColors.SURFACE).borderRadius(18)
            }
          }, (item: Intervention) => item.id)
        } else {
          if (this.visibleOpenActions().length === 0) {
            ListItem() { Text('当前没有符合筛选的行动').fontSize(14).fontColor(PMColors.INK_TERTIARY).padding(16) }
          }
          ForEach(this.visibleOpenActions(), (item: ActionItem) => {
            ListItem() {
              PMListRow({ title: item.title, subtitle: item.description ?? '', kind: 'action', status: item.status === 'DONE' ? '已完成' : item.status === 'CANCELLED' ? '已取消' : item.status === 'DOING' ? '进行中' : '待开始',
                meta: this.projects.find((p: Project) => p.id === item.projectId)?.title ?? '',
                onOpen: (): void => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId, tab: 'actions', actionId: item.id } }); } })
                .backgroundColor(PMColors.SURFACE).borderRadius(18)
            }
          }, (item: ActionItem) => item.id)
        }
      }.layoutWeight(1).padding({ left: 16, right: 16 }).contentEndOffset(16)
    }.layoutWeight(1).constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  // ----------------------------------------------------
  // Tab 1: 记忆视图 (跨项目知识库)
  // ----------------------------------------------------
  @Builder
  private GlobalMemoryTab() {
    Column() {
      // 记忆范围：同一分段控件内切换"项目记忆（本页跨项目材料）"与"我的记忆（账户级页面）"。
      // 两段字号、触控高度、排版一致，选中态统一；我的记忆进入独立页面，返回后仍停留在项目记忆。
      Column({ space: PMSpacing.XS }) {
        Row({ space: 2 }) {
          Row() {
            Text('项目记忆')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
          }
          .layoutWeight(1)
          .height(38)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(9)
          .accessibilityText('项目记忆，跨项目汇总的记忆材料，当前范围')
          .accessibilitySelected(true)

          Row() {
            Text('我的记忆')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
          }
          .layoutWeight(1)
          .height(38)
          .justifyContent(FlexAlign.Center)
          .borderRadius(9)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .accessibilityText('我的记忆，账户级偏好与协作上下文，打开管理页')
          .accessibilitySelected(false)
          .onClick(() => {
            router.pushUrl({ url: 'pages/PersonalMemoryPage' });
          })
        }
        .width('100%')
        .padding(3)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(12)

        if (!this.globalMemoryNoteHidden) {
          Row({ space: PMSpacing.SM }) {
            Text('项目记忆汇总跨项目材料，点开项目可回看原始记录；我的记忆是账户级偏好与协作上下文。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(17)
              .layoutWeight(1)
              .accessibilityText('范围说明：项目记忆汇总跨项目记忆材料，进入项目后才能看到时态关系与原始来源；我的记忆保存账户级偏好与协作上下文')
            Text('不再显示')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_MUTED)
              .constraintSize({ minHeight: 32 })
              .accessibilityText('不再显示记忆范围说明')
              .onClick(() => {
                void this.hideGlobalMemoryNote();
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.XS, bottom: PMSpacing.XS })
      .alignItems(HorizontalAlign.Start)

      // 搜索框与筛选
      Column() {
        if (!this.searchOpen && this.globalSearchQuery.trim() !== '') {
          Row({ space: 8 }) {
            Text('搜索：' + this.globalSearchQuery)
              .fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            Button('清除', { type: ButtonType.Normal })
              .height(44).fontSize(PMFontSize.SECONDARY)
              .backgroundColor(Color.Transparent).fontColor(PMColors.BRAND)
              .accessibilityText('清除记忆搜索关键词')
              .onClick(() => { this.globalSearchQuery = ''; })
          }.width('100%')
        }
        Scroll() {
          Row() {
            ForEach(this.globalTypeFilters(), (filter: MemoryTypeFilter) => {
              // 全局记忆用下划线标签：与项目内的轻量小标签区分开，两套筛选不混用。
              // 下划线挂在 Text 自身边框上，避免百分比宽度把整列撑满视口。
              Text(filter.label)
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(this.selectedGlobalType === filter.value ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(this.selectedGlobalType === filter.value ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .padding({ left: 12, right: 12, top: 10, bottom: 10 }).constraintSize({ minHeight: 44 })
                .border({ width: { bottom: 2 }, color: this.selectedGlobalType === filter.value ? PMColors.BRAND : Color.Transparent })
                .margin({ right: 8 })
                .clickEffect(PMInteraction.PRESS_EFFECT)
                .accessibilityText(`按记忆类型筛选：${filter.label}`)
                .accessibilitySelected(this.selectedGlobalType === filter.value)
                .onClick(() => {
                  this.selectedGlobalType = filter.value;
                })
            }, (filter: MemoryTypeFilter) => filter.value)
          }
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .align(Alignment.Start)

      }
      .padding({ left: PMSpacing.SM, right: PMSpacing.LG, top: 0, bottom: 0 })
      .backgroundColor(PMColors.BACKGROUND)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

      List({ space: 10 }) {
        if (this.getFilteredGlobalCards().length === 0) {
          ListItem() {
            Column() {
              Text(this.allCards.length === 0 ? '还没有跨项目记忆' : '没有符合当前筛选的记忆')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
              Text(this.allCards.length === 0 ?
                '在任意项目里记录第一条事实后，这里会汇总所有项目的记忆。' :
                '换个类型或清空搜索关键词再看看；这里不会用全部记忆替代你的筛选结果。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(19)
                .margin({ top: PMSpacing.XS })
              if (this.globalSearchQuery.trim() !== '' || this.selectedGlobalType !== 'all') {
                Button('清空筛选条件').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.BRAND)
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.SM)
                  .height(36)
                  .margin({ top: PMSpacing.MD })
                  .clickEffect(PMInteraction.PRESS_EFFECT)
                  .onClick(() => {
                    this.globalSearchQuery = '';
                    this.selectedGlobalType = 'all';
                  })
              }
            }
            .width('100%')
            .padding({ top: PMSpacing.XXL, bottom: PMSpacing.XXL, left: PMSpacing.LG, right: PMSpacing.LG })
            .alignItems(HorizontalAlign.Start)
          }
        }

        ForEach(this.getFilteredGlobalCards(), (card: KnowledgeCard) => {
          ListItem() {
            Column() {
              if (TextFormatters.isDamagedMemory(card.title, card.summary,
                card.capture !== undefined && card.capture !== null ? card.capture.rawText : '')) {
                Row() {
                  Row() {
                    AlertIcon({ iconSize: 14, color: PMColors.RISK })
                    Text('需要修复')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.RISK)
                      .margin({ left: PMSpacing.XS })
                  }
                  Text(card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : card.createdAt)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
                .width('100%')
                .justifyContent(FlexAlign.SpaceBetween)

                Text('这条历史记忆无法完整读取，原内容未被替换。')
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .lineHeight(20)
                  .margin({ top: PMSpacing.SM })

                Text('可进入所属项目查看原始采集碎片并重新录入。')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .margin({ top: PMSpacing.XS })
              } else {
                Row() {
                  Row({ space: PMSpacing.XS }) {
                    MemoryTypeBadge({ type: card.type })
                    if (card.capture?.sourceType) {
                      Text(card.capture?.sourceType ?? '').fontSize(10).fontColor(PMColors.INK_SECONDARY).padding({ left: 6, right: 6, top: 3, bottom: 3 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(5).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: 80 })
                    }
                    if (this.cardStatus(card.id) !== null && this.evidenceStateLabel(this.cardStatus(card.id)!) !== '') {
                      Text(this.evidenceStateLabel(this.cardStatus(card.id)!))
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(this.statusColor(this.cardStatus(card.id)!.topLevelState))
                        .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.XS)
                        .accessibilityText(`证据状态：${this.evidenceStateLabel(this.cardStatus(card.id)!)}，点击查看说明`)
                        .onClick(() => {
                          this.expandedEvidenceCardId = this.expandedEvidenceCardId === card.id ? '' : card.id;
                        })
                    }
                  }
                  Text(card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : card.createdAt)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
                .width('100%')
                .justifyContent(FlexAlign.SpaceBetween)

                Text(TextFormatters.readableText(card.title, '历史记忆需要修复'))
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .maxLines(3)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: PMSpacing.SM })

                if (TextFormatters.shouldShowSummary(card.title, card.summary) &&
                  !this.summaryRepeatsTitle(card.title, card.summary)) {
                  Text(card.summary)
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)
                    .constraintSize({ minHeight: 40 })
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .margin({ top: PMSpacing.XS })
                }
              }

              if (this.expandedEvidenceCardId === card.id && this.cardStatus(card.id) !== null && this.evidenceStateLabel(this.cardStatus(card.id)!) !== '') {
                Text(this.cardStatus(card.id)!.displayReason !== '' ?
                  this.cardStatus(card.id)!.displayReason :
                  '进入所属项目可查看这条结论与来源、证据之间的关系。')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .width('100%')
                  .padding(PMSpacing.SM)
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.XS)
                  .margin({ top: PMSpacing.XS })
              }

              Row() {
                Text('所属项目')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
                Text(card.projectTitle !== '' ? TextFormatters.readableText(card.projectTitle, '项目名称无法读取') : '项目归属未同步')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.BRAND)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
                  .margin({ left: PMSpacing.SM })
                Text('→')
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.BRAND)
                  .margin({ left: PMSpacing.XS })
              }
              .width('100%')
              .height(44)
              .padding({ top: PMSpacing.SM })
              .accessibilityText(`所属项目：${card.projectTitle !== '' ? card.projectTitle : '项目归属未同步'}`)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                if (card.projectId !== '') {
                  router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: card.projectId, tab: 'memory', cardId: card.id } });
                }
              })
            }
            .width('100%')
            .padding(14).backgroundColor(PMColors.SURFACE).borderRadius(18)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .alignItems(HorizontalAlign.Start)
            .accessibilityText(`记忆：${TextFormatters.readableText(card.title, '历史记忆需要修复')}，所属项目：${card.projectTitle !== '' ? card.projectTitle : '项目归属未同步'}`)
            .accessibilityDescription(card.projectId !== '' ? '使用所属项目入口打开对应记忆' : '项目归属未同步，暂时无法跳转')
          }
        }, (card: KnowledgeCard) => card.id)
      }
      .layoutWeight(1)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .align(Alignment.Top)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  private cardStatus(cardId: string): CardTemporalStatus | null {
    for (let i = 0; i < this.globalCardStates.length; i++) {
      if (this.globalCardStates[i].cardId === cardId) {
        return this.globalCardStates[i];
      }
    }
    return null;
  }

  private statusColor(state: string): ResourceColor {
    if (state === 'SUPERSEDED') return PMColors.INK_TERTIARY;
    if (state === 'CONTESTED' || state === 'CONFLICT' || state === 'PENDING') return PMColors.RISK;
    if (state === 'CURRENT' || state === 'UNKNOWN' || state === 'INSUFFICIENT' || state === 'REVOKED') return PMColors.EVIDENCE;
    return PMColors.SUCCESS;
  }

  /** 摘要只是把标题复述一遍时不再重复展示，列表只保留增量信息 */
  private summaryRepeatsTitle(title: string, summary: string): boolean {
    const strip = (v: string): string => TextFormatters.normalizeText(v).replace(/^[^:：]{1,6}[:：]\s*/, '');
    const t = strip(title);
    const sum = strip(summary);
    if (t === '' || sum === '') {
      return false;
    }
    return sum.startsWith(t) || t.startsWith(sum);
  }

  /** 标签描述的是「这条结论的证据状态」，不是记忆整体可信度 */
  private evidenceStateLabel(status: CardTemporalStatus): string {
    switch (status.reasonCode) {
      case 'ACTIVE_SUPPORT':
        return '当前时态有依据';
      case 'SUPERSEDED_BY_CONFIRMED_RELATION':
        return '已被替代';
      case 'CONTRADICTED_OR_MULTIPLE_SUPERSEDERS':
        return '存在争议';
      case 'RELATION_PENDING_CONFIRMATION':
        return '关系待确认';
      case 'RELATION_REVOKED':
        return '关系已撤销';
      case 'NO_SUPPORTING_EVIDENCE':
        return '';
      default:
        return status.statusLabel;
    }
  }

  private getFilteredGlobalCards(): KnowledgeCard[] {
    const q = this.globalSearchQuery.trim().toLowerCase();
    return this.allCards.filter((c) => {
      if (this.selectedGlobalType !== 'all' && c.type !== this.selectedGlobalType) {
        return false;
      }
      if (q === '') {
        return true;
      }
      return c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q);
    });
  }

  private globalTypeFilters(): MemoryTypeFilter[] {
    return [
      new MemoryTypeFilter('all', '全部'),
      new MemoryTypeFilter('paper_note', '论文笔记'),
      new MemoryTypeFilter('experiment_log', '实验记录'),
      new MemoryTypeFilter('reflection', '阶段复盘')
    ];
  }

  // ----------------------------------------------------
  // Tab 3: 设置视图 (账号、AI 服务、提醒策略、数据与安全)
  // ----------------------------------------------------

  /**
   * 设置分组内的一行导航项：标题 + 一行说明 + 可选状态胶囊 + 轻量箭头。
   * 只读状态用中性胶囊，不用成功绿误导为「已开启的功能」。
   * 用 targetMode 字符串分发而不是函数参数——@Builder 传函数在真机上点击不生效（实测）。
   */
  @Builder
  private SettingsNavRow(title: string, subtitle: string, badge: string, badgeColor: ResourceColor, badgeBg: ResourceColor, targetMode: string) {
    Row() {
      Column({ space: 2 }) {
        Text(title)
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
        Text(subtitle)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ right: PMSpacing.SM })

      if (badge !== '') {
        Text(badge)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(badgeColor)
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor(badgeBg)
          .borderRadius(PMRadius.FULL)
      }
      Text('›')
        .fontSize(20)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ left: PMSpacing.XS })
    }
    .width('100%')
    .height(56)
    .alignItems(VerticalAlign.Center)
    .clickEffect(PMInteraction.PRESS_EFFECT)
    .onClick(() => {
      if (targetMode === 'memory') {
        router.pushUrl({ url: 'pages/PersonalMemoryPage' });
        return;
      }
      if (targetMode === 'guide') {
        router.pushUrl({ url: 'pages/FeatureGuide' });
        return;
      }
      this.settingsSheetMode = targetMode;
      this.showSettingsSheet = true;
    })
    .accessibilityText(`${title}，${subtitle}，点击进入`)
  }

  private llmModeTag(): string {
    if (this.llmMode === 'openai-compatible') return '在线 API';
    return this.llmMode === 'mock' ? '规则模式' : '未读取';
  }

  private llmModeTagColor(): ResourceColor {
    if (this.llmMode === 'openai-compatible') return PMColors.BRAND;
    return this.llmMode === 'mock' ? PMColors.MEMORY : PMColors.INK_TERTIARY;
  }

  private llmModeTagBackground(): ResourceColor {
    if (this.llmMode === 'openai-compatible') return PMColors.BRAND_LIGHT;
    return this.llmMode === 'mock' ? PMColors.MEMORY_LIGHT : PMColors.SURFACE_SUBTLE;
  }

  private llmEntrySubtitle(): string {
    if (this.llmMode === '') {
      return '暂未读取到服务端模型配置';
    }
    if (this.llmMode === 'openai-compatible') {
      return this.hasApiKey ? '在线 API · 密钥已配置' : '在线 API · 未配置密钥';
    }
    return '规则模式 · 无需模型 API';
  }

  private dataSyncStateColor(): ResourceColor {
    if (this.dataSyncState === '同步失败') {
      return PMColors.RISK;
    }
    if (this.dataSyncState.indexOf('部分同步') === 0) {
      return PMColors.WARNING;
    }
    if (this.dataSyncState === '已同步') {
      return PMColors.SUCCESS;
    }
    return PMColors.INK_TERTIARY;
  }

  /**
   * 提醒策略本体的存储粒度是账号（服务端 USER:${userId} scope），全部项目共享一份预算与静默时段；
   * API 路径里的 projectId 只承担授权与项目级降频偏好，任一可访问项目都行。
   * 主列表为空（例如项目全部归档）时用归档项目兜底，避免「有项目却改不了策略」。
   */
  private policyAnchorProjectId(): string {
    if (this.projects.length > 0) {
      return this.projects[0].id;
    }
    if (this.archivedProjects.length > 0) {
      return this.archivedProjects[0].id;
    }
    return '';
  }

  @Builder
  private InfoSheetHeader(title: string) {
    Row() {
      Text(title)
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .layoutWeight(1)
      PMCloseButton({
        accessibilityLabel: `关闭${title}`,
        onAction: (): void => { this.showSettingsSheet = false; }
      })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  /** 信息说明页里的一组「标签 + 值」行 */
  @Builder
  private InfoSheetRow(label: string, value: string, valueColor: ResourceColor) {
    Row() {
      Text(label)
        .fontSize(PMFontSize.SECONDARY)
        .fontColor(PMColors.INK_SECONDARY)
        .layoutWeight(1)
      Text(value)
        .fontSize(PMFontSize.SECONDARY)
        .fontWeight(FontWeight.Medium)
        .fontColor(valueColor)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private AccountSheet() {
    Column({ space: PMSpacing.MD }) {
      this.InfoSheetHeader('账号')

      this.InfoSheetRow('显示名称', this.currentUser.displayName !== '' ? this.currentUser.displayName : '未读取', PMColors.INK_PRIMARY)
      this.InfoSheetRow('账号', this.currentUser.username !== '' ? this.currentUser.username : '未读取', PMColors.INK_PRIMARY)
      this.InfoSheetRow('会话状态', '有效', PMColors.SUCCESS)
      this.InfoSheetRow('服务端地址', Constants.BASE_URL, PMColors.INK_PRIMARY)

      Divider().color(PMColors.BORDER_SUBTLE)

      Button('退出登录', { type: ButtonType.Normal })
        .fontSize(PMFontSize.BUTTON)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.RISK)
        .backgroundColor(PMColors.RISK_LIGHT)
        .border({ width: 1, color: PMColors.RISK_BORDER })
        .borderRadius(PMRadius.SM)
        .height(44)
        .width('100%')
        .accessibilityText('退出登录，需确认')
        .onClick(() => {
          this.showSettingsSheet = false;
          this.handleLogout();
        })

      Text('退出会撤销会话并清除本地凭证，退出后需重新输入凭据。')
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .lineHeight(18)
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
  }

  @Builder
  private DeviceSheet() {
    Column({ space: PMSpacing.MD }) {
      this.InfoSheetHeader('设备与小艺')

      Text('小艺相关能力（语音入口、读取项目状态、记录项目记忆）属于平台侧能力，当前版本尚未接入，因此这里没有可配置的授权开关。')
        .fontSize(PMFontSize.BODY)
        .fontColor(PMColors.INK_SECONDARY)
        .lineHeight(22)
        .width('100%')

      this.InfoSheetRow('平台能力', '尚未接入', PMColors.INK_TERTIARY)
      this.InfoSheetRow('授权状态', '无（未接入）', PMColors.INK_TERTIARY)

      Text('真实接入完成后，这里会展示平台授权状态与可用功能，并按权限范围提供对应操作；在此之前不提供任何模拟入口。')
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .lineHeight(18)
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
  }

  @Builder
  private DataSheet() {
    Scroll() {
      Column({ space: PMSpacing.MD }) {
        this.InfoSheetHeader('数据同步与连接')

        Text('项目数据')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_SECONDARY)
        this.InfoSheetRow('读取状态', this.dataSyncState, this.dataSyncStateColor())
        this.InfoSheetRow('服务端地址', Constants.BASE_URL, PMColors.INK_PRIMARY)

        Button('重新同步数据', { type: ButtonType.Normal })
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .border({ width: 1, color: PMColors.BORDER })
          .borderRadius(PMRadius.SM)
          .height(40)
          .width('100%')
          .onClick(() => {
            this.loadAllData();
            promptAction.showToast({ message: '正在同步数据...' });
          })

        Text('此状态只反映项目数据的最近一次读取结果；部分同步表示个别项目读取失败，可点上方按钮重试。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(18)
          .width('100%')

        Divider().color(PMColors.BORDER_SUBTLE)

        Text('模型与引擎')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_SECONDARY)
        this.InfoSheetRow('运行模式', this.llmMode === 'openai-compatible' ? '在线 API（OpenAI-compatible）' :
          (this.llmMode === 'mock' ? '规则模式（无需模型 API）' : '暂未读取'), PMColors.INK_PRIMARY)

        Text('配置成功不等于每次运行都成功；连通测试与最近一次真实运行结果在「模型与连接」中查看，各委托的运行记录以实际回执为准。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(18)
          .width('100%')

        Divider().color(PMColors.BORDER_SUBTLE)

        Text('设备与通知')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_SECONDARY)
        this.InfoSheetRow('小艺平台', '尚未接入', PMColors.INK_TERTIARY)
        this.InfoSheetRow('系统通知', '由系统设置管理', PMColors.INK_TERTIARY)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    }
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(BarState.Off)
  }

  @Builder
  private PrinciplesSheet() {
    Scroll() {
      Column({ space: PMSpacing.MD }) {
        this.InfoSheetHeader('证据与记忆原则')

        Text('这些是忆程的固定安全机制，由服务端保证，不提供关闭开关。')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(22)
          .width('100%')

        Column({ space: PMSpacing.SM }) {
          Text('重要修改需要确认')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('Agent 只提出候选；行动创建、记忆修订与重要变更由你确认后才生效。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)

        Column({ space: PMSpacing.SM }) {
          Text('来源存在不等于事实成立')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('记忆保留原始来源；结论需要证据支撑，孤证不会被写成定论。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)

        Column({ space: PMSpacing.SM }) {
          Text('未知不会被当成错误')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('信息不足时保留「未知」，不会自动推断为「否」，也不会编造补充。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)

        Column({ space: PMSpacing.SM }) {
          Text('历史可追溯')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('原始记录与历史版本保留；被取代的结论可以查看，但不再冒充当前事实。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)

        Column({ space: PMSpacing.SM }) {
          Text('Agent 无权绕过服务端')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('项目归属、审批、幂等与版本控制都在服务端强制执行，客户端界面只是入口。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    }
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(BarState.Off)
  }

  @Builder
  private AboutSheet() {
    Column({ space: PMSpacing.MD }) {
      this.InfoSheetHeader('关于忆程')

      Row() {
        Image($r('app.media.app_icon'))
          .width(48)
          .height(48)
          .borderRadius(PMRadius.MD)
          .objectFit(ImageFit.Cover)
          .accessibilityText('忆程 ProjectMemo 应用图标')
        Column({ space: 2 }) {
          Text('忆程 ProjectMemo')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
          Text('让项目进展有迹可循')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: PMSpacing.SM })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Divider().color(PMColors.BORDER_SUBTLE)

      this.InfoSheetRow('版本', 'v0.1.0', PMColors.INK_PRIMARY)
      this.InfoSheetRow('平台', 'HarmonyOS NEXT', PMColors.INK_PRIMARY)
      this.InfoSheetRow('产品形态', '证据驱动的项目过程档案与决策手账', PMColors.INK_PRIMARY)

      Text('Web 与鸿蒙客户端共用同一服务端，业务事实以服务端持久数据为准；规则模式不需要模型 API，但仍需连接服务端读写数据。')
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .lineHeight(18)
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
  }

  @Builder
  private SettingsTab() {
    Scroll() {
      Column() {
        // 账号入口：头像 + 名称 + 会话状态；退出登录在账号详情内，保留原确认流程
        Row() {
          Image($r('app.media.app_icon'))
            .width(44)
            .height(44)
            .borderRadius(PMRadius.MD)
            .objectFit(ImageFit.Cover)
            .accessibilityText('账号头像')

          Column({ space: 3 }) {
            Text(this.currentUser.displayName !== '' ? this.currentUser.displayName : '账号名称未读取')
              .fontSize(PMFontSize.PRIMARY_JUDGEMENT)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
            Text(this.currentUser.username !== '' ? `账号 ${this.currentUser.username}` : '账号未读取')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ left: PMSpacing.SM, right: PMSpacing.SM })

          Text('会话有效')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SUCCESS)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor(PMColors.SUCCESS_LIGHT)
            .borderRadius(PMRadius.FULL)
          Text('›')
            .fontSize(20)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ left: PMSpacing.XS })
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
        .alignItems(VerticalAlign.Center)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          this.settingsSheetMode = 'account';
          this.showSettingsSheet = true;
        })
        .accessibilityText('账号详情，点击查看会话状态并退出登录')

        // 第一组：AI 与服务 —— 可编辑的模型配置与真实的设备能力状态
        Text('AI 与服务')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          this.SettingsNavRow('模型与连接', this.llmEntrySubtitle(),
            this.llmModeTag(),
            this.llmModeTagColor(),
            this.llmModeTagBackground(),
            'api')

          Divider().color(PMColors.BORDER_SUBTLE)

          this.SettingsNavRow('设备与小艺', '平台能力接入状态与授权', '尚未接入',
            PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'device')
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })

        // 第二组：提醒与偏好 —— 预算/免打扰/介入强度统一在「提醒策略」里管理
        Text('提醒与偏好')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          this.SettingsNavRow('我的记忆', '查看、纠正或停止使用个人偏好与背景', '',
            PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'memory')

          Divider().color(PMColors.BORDER_SUBTLE)

          this.SettingsNavRow('提醒策略', '每日上限 · 免打扰时段 · 全部项目共享', '', PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'policy')

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Text('减少动效').fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
            Toggle({ type: ToggleType.Switch, isOn: this.reduceMotion })
              .accessibilityText('减少动效')
              .onChange((isOn: boolean) => { this.reduceMotion = isOn; })
          }
          .width('100%').constraintSize({ minHeight: 52 })
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })

        // 第三组：数据与安全 —— 真实同步状态进二级页；固定安全机制集中说明
        Text('数据与安全')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          this.SettingsNavRow('数据同步与连接', '项目数据读取状态与服务端地址', this.dataSyncState,
            this.dataSyncStateColor(), PMColors.SURFACE_SUBTLE, 'data')

          Divider().color(PMColors.BORDER_SUBTLE)

          this.SettingsNavRow('证据与记忆原则', '重要变更确认 · 来源与未知 · 历史可追溯', '固定机制',
            PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'principles')
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })

        // 第四组：帮助与关于
        Text('帮助与关于')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          this.SettingsNavRow('使用指南', '记录 · 理解 · 推进 · 成果', '', PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'guide')

          Divider().color(PMColors.BORDER_SUBTLE)

          this.SettingsNavRow('关于忆程', '版本 · 平台 · 产品说明', '', PMColors.INK_TERTIARY, PMColors.SURFACE_SUBTLE, 'about')
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(PMSpacing.LG)
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .align(Alignment.Top)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
    .bindSheet($$this.showSettingsSheet, this.SettingsSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true,
      showClose: false
    })
  }

  @Builder
  private SettingsSheet() {
    if (this.settingsSheetMode === 'policy') {
      ReminderSettingsView({
        projectId: this.policyAnchorProjectId(),
        onClose: () => { this.showSettingsSheet = false; }
      })
    } else if (this.settingsSheetMode === 'api') {
      this.ApiSheet()
    } else if (this.settingsSheetMode === 'account') {
      this.AccountSheet()
    } else if (this.settingsSheetMode === 'device') {
      this.DeviceSheet()
    } else if (this.settingsSheetMode === 'data') {
      this.DataSheet()
    } else if (this.settingsSheetMode === 'principles') {
      this.PrinciplesSheet()
    } else if (this.settingsSheetMode === 'about') {
      this.AboutSheet()
    }
  }

  // API 与引擎配置（半模态）：含引擎模式、在线 API 参数、连通测试与服务连接
  @Builder
  private ApiSheet() {
    Column() {
      Row() {
        Text('API 与引擎')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .layoutWeight(1)
        PMCloseButton({
          accessibilityLabel: '关闭 API 配置',
          onAction: (): void => { this.showSettingsSheet = false; }
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Scroll() {
        Column() {
          Row() {
            Text('当前运行方式')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_TERTIARY)
            Text(this.llmMode === 'mock' ? '离线确定性引擎' : this.llmModeTag())
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.llmModeTagColor())
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
              .backgroundColor(this.llmModeTagBackground())
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })

          if (!this.settingsEditable) {
            Text(this.settingsReadOnlyMessage !== '' ? this.settingsReadOnlyMessage : '当前模型配置仅可查看。')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(20)
              .width('100%')
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .margin({ bottom: PMSpacing.SM })
          }

          Text('引擎模式')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_SECONDARY)

          Row() {
            Button(this.llmMode === 'openai-compatible' ? '✓ OpenAI 兼容 API' : 'OpenAI 兼容 API').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .border({
                width: this.llmMode === 'openai-compatible' ? 2 : 1,
                color: this.llmMode === 'openai-compatible' ? PMColors.BRAND : PMColors.BORDER
              })
              .borderRadius(PMRadius.SM)
              .height(48)
              .enabled(this.settingsEditable)
              .layoutWeight(1)
              .accessibilityText('选择 OpenAI 兼容 API')
              .accessibilitySelected(this.llmMode === 'openai-compatible')
              .onClick(() => {
                this.llmMode = 'openai-compatible';
              })

            Button(this.llmMode === 'mock' ? '✓ 离线确定性引擎' : '离线确定性引擎').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.llmMode === 'mock' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.llmMode === 'mock' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .border({
                width: this.llmMode === 'mock' ? 2 : 1,
                color: this.llmMode === 'mock' ? PMColors.BRAND : PMColors.BORDER
              })
              .borderRadius(PMRadius.SM)
              .height(48)
              .enabled(this.settingsEditable)
              .layoutWeight(1)
              .margin({ left: PMSpacing.SM })
              .accessibilityText('选择离线确定性引擎')
              .accessibilitySelected(this.llmMode === 'mock')
              .onClick(() => {
                this.llmMode = 'mock';
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.XS })

          if (this.llmMode === 'openai-compatible') {
            Text('API Base URL')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.MD })
            TextInput({ text: this.llmBaseUrl, placeholder: 'https://api.deepseek.com/v1' })
              .enabled(this.settingsEditable)
              .onChange((v: string) => {
                this.llmBaseUrl = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })

            Text('模型名称')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })
            TextInput({ text: this.llmModelName, placeholder: '例如：gpt-4o-mini / deepseek-chat / qwen-plus' })
              .enabled(this.settingsEditable)
              .onChange((v: string) => {
                this.llmModelName = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })

            Row() {
              Text('API 密钥')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)

              if (this.hasApiKey) {
                Text(`已配置 (${this.apiKeyMasked})`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.SUCCESS)
              } else {
                Text('未配置')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.RISK)
              }
            }
            .width('100%')
            .justifyContent(FlexAlign.SpaceBetween)
            .margin({ top: PMSpacing.SM })

            TextInput({ text: this.llmApiKey, placeholder: this.hasApiKey ? '输入新 Key 覆盖，或留空保留' : '输入以 sk- 开头的密钥' })
              .type(InputType.Password)
              .enabled(this.settingsEditable)
              .onChange((v: string) => {
                this.llmApiKey = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })
            Text('密钥只用于当前本地运行，不会回显；长期配置请使用部署环境变量。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(18)
              .margin({ top: PMSpacing.XS })
          } else {
            Column() {
              Text('离线确定性引擎已就绪')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.MEMORY)
              Text('无需配置模型 API 或密钥；仍需连接项目服务端读写数据，结果按本地规则生成并可复核。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(20)
                .margin({ top: PMSpacing.XS })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.MEMORY_LIGHT)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.MD })
          }

          if (this.probeResult !== undefined) {
            Column() {
              if (this.probeResult.success) {
                Text('✓ 连通测试成功')
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SUCCESS)
                Text(`耗时 ${this.probeResult.latencyMs}ms · ${this.probeResult.model}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .margin({ top: PMSpacing.XS })
              } else {
                Text('连通测试失败')
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.RISK)
                Text(this.probeResult.error)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.RISK)
                  .margin({ top: 2 })
              }
            }
            .width('100%')
            .padding(PMSpacing.SM)
            .backgroundColor(this.probeResult.success ? PMColors.SUCCESS_LIGHT : PMColors.RISK_LIGHT)
            .borderRadius(PMRadius.SM)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: PMSpacing.SM })
          }

          if (this.settingsFeedback !== '') {
            Text(this.settingsFeedback)
              .fontSize(PMFontSize.BODY)
              .fontColor(this.settingsFeedback.indexOf('失败') >= 0 ? PMColors.RISK : PMColors.SUCCESS)
              .margin({ top: PMSpacing.XS })
          }

          Row() {
            if (this.llmMode === 'openai-compatible') {
              Button(this.isProbing ? '正在测试...' : '测试连通性').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.SM)
                .height(48)
                .enabled(this.settingsEditable && !this.isProbing)
                .layoutWeight(1)
                .onClick(() => {
                  this.probeLlmConnection();
                })
            }

            Button(!this.settingsEditable ? '生产环境只读' : (this.isSavingSettings ? '保存中...' : '保存配置')).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.BUTTON)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(this.settingsEditable ? PMColors.BRAND : PMColors.INK_TERTIARY)
              .borderRadius(PMRadius.SM)
              .height(48)
              .enabled(this.settingsEditable && !this.isSavingSettings)
              .layoutWeight(1)
              .margin({ left: PMSpacing.SM })
              .onClick(() => {
                this.saveLlmSettings();
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.MD })

          Divider()
            .color(PMColors.BORDER_SUBTLE)
            .margin({ top: PMSpacing.MD, bottom: PMSpacing.SM })

          Row() {
            Text('服务连接')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
            Text(this.dataSyncState)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.dataSyncState === '同步失败' ? PMColors.RISK :
                this.dataSyncState === '同步中...' ? PMColors.BRAND : PMColors.SUCCESS)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          Text(`API 端点：${Constants.BASE_URL}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: PMSpacing.XS })

          Button('重新同步数据').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .border({ width: 1, color: PMColors.BORDER })
            .borderRadius(PMRadius.SM)
            .height(44)
            .width('100%')
            .margin({ top: PMSpacing.SM })
            .onClick(() => {
              this.loadAllData();
              promptAction.showToast({ message: '正在同步数据...' });
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
      }
      .scrollable(ScrollDirection.Vertical)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    .alignItems(HorizontalAlign.Start)
  }

  // ----------------------------------------------------
  // 主构建入口
  // ----------------------------------------------------
  build() {
    Stack() {
    if (this.isCheckingAuth) {
      SplashView()
        .transition(TransitionEffect.OPACITY)
    } else if (!this.isAuthenticated && !this.onboardingSeen) {
      OnboardingView({ onDone: () => { this.finishOnboarding(); } })
        .transition(TransitionEffect.OPACITY)
    } else if (!this.isAuthenticated) {
      Column() {
        LoginView({
          onLoginSuccess: () => {
            this.handleLoginSuccess();
          }
        })
      }
      .width('100%')
      .height('100%')
      .transition(TransitionEffect.OPACITY)
    } else {
      Stack() {
        Column() {
          // 参考稿：焦点页自带日期与标题，不再叠一层顶栏；其余页签用宋体页名，搜索与上下文动作置于右侧。
          if (this.currentMainTabIndex !== 4) {
          Column() {
            Row() {
              Text(this.currentMainTabIndex === 0 ? '项目' : this.currentMainTabIndex === 1 ? '记忆' : this.currentMainTabIndex === 2 ? '行动' : '设置')
                .fontSize(26).fontWeight(FontWeight.Bold)
                .fontFamily(PMFontFamily.SANS).fontColor(PMColors.INK_PRIMARY)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .accessibilityLevel('yes')

              if (this.currentMainTabIndex < 3) {
                Row() { SearchIcon({ iconSize: 19 }) }
                  .width(44).height(44).justifyContent(FlexAlign.Center)
                  .accessibilityText(this.searchOpen ? '关闭搜索' : `搜索${this.searchTargetName()}`)
                  .onClick(() => { this.toggleSearch(); })
                Row() { PlusIcon({ iconSize: 20, iconColor: PMColors.BRAND }) }
                  .width(44).height(44).justifyContent(FlexAlign.Center)
                  .accessibilityText(this.createActionName())
                  .onClick(() => { this.openContextualCreate(); })
              }
              if (this.currentMainTabIndex !== 3) {
              Row() { SettingsIcon({ iconSize: 20, isSelected: false }) }
                .width(44).height(44).justifyContent(FlexAlign.Center)
                .accessibilityText('打开设置')
                .onClick(() => { this.currentMainTabIndex = 3; this.loadLlmSettings(); })
              }
            }
            .width('100%')
            .constraintSize({ minHeight: 58 })
            .padding({ left: 14, right: 6, top: 7, bottom: 7 })

            if (this.currentMainTabIndex === 0 && this.projectDeletionNotice !== '') {
              Text(this.projectDeletionNotice).fontSize(12).fontColor(PMColors.INK_SECONDARY)
                .padding(12).onClick(() => { this.loadAllData(true); })
                .accessibilityText(`项目清除进度：${this.projectDeletionNotice}，点击刷新`)
            }
            if (this.searchOpen && this.currentMainTabIndex < 3) {
              Row() {
                TextInput({ text: this.globalSearchQuery, placeholder: this.searchPlaceholder() })
                  .onChange((v: string) => {
                    this.globalSearchQuery = v;
                  })
                  .fontSize(PMFontSize.SECONDARY)
                  .height(40)
                  .layoutWeight(1)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER })
                  .accessibilityText(this.searchPlaceholder())
                Text('取消')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_TERTIARY)
                  .margin({ left: PMSpacing.SM })
                  .accessibilityText('关闭搜索并清除关键词')
                  .onClick(() => {
                    this.toggleSearch();
                  })
              }
              .width('100%')
              .padding({ left: PMSpacing.LG, right: PMSpacing.LG, bottom: PMSpacing.SM })
            }
          }
          .width('100%')
          .backgroundColor(PMColors.BACKGROUND)
          }

        Column() {
          if (this.currentMainTabIndex === 4) {
            GlobalFocusPanel({ refreshKey: this.focusRefreshKey, onOpenActions: (reminders: boolean): void => {
              this.taskTabFilter = reminders ? 'REMINDERS' : 'ACTIONS'; this.currentMainTabIndex = 2;
            }, onOpenSettings: (): void => { this.currentMainTabIndex = 3; this.loadLlmSettings(); } })
          } else if (this.currentMainTabIndex === 3) {
            this.SettingsTab()
          } else if (this.isLoading) {
            LoadingStateView({ message: '正在同步项目档案...' })
          } else if (this.errorMessage !== '') {
            ErrorStateView({
              message: this.errorMessage,
              onRetry: () => {
                this.loadAllData();
              }
            })
          } else {
            if (this.currentMainTabIndex === 0) {
              this.ProjectsTab()
            } else if (this.currentMainTabIndex === 1) {
              this.GlobalMemoryTab()
            } else if (this.currentMainTabIndex === 2) {
              this.TasksTab()
            } else if (this.currentMainTabIndex === 3) {
              this.SettingsTab()
            }
          }
        }
        .width('100%')
        .layoutWeight(1)
        .clip(true)

        // 底部导航 Bar
        this.MainBottomBar()
      }
      .width('100%')
      .height('100%')

      // 项目内准备项逐项说明（只读；项目列表页不提供逐项跳转入口）
      if (this.showReadinessSheet) {
        ReadinessBreakdownSheet({
          readiness: this.readinessForSheet,
          showItemEntry: false,
          onClose: () => {
            this.showReadinessSheet = false;
          }
        })
      }

      // 全局记忆新增：先选归属项目，其余与项目内「记录」一致
      if (this.showGlobalCapture) {
        Column() {
          Scroll() {
            Column() {
              Text('记录项目碎片')
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('全局入口：先选这条记忆属于哪个项目，表单与项目内「记录」相同')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.XS })

              Text('归属项目')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              Select(this.globalProjectOptions()).fontColor(PMColors.INK_PRIMARY).selectedOptionFontColor(PMColors.BRAND).selectedOptionBgColor(PMColors.BRAND_LIGHT).optionFontColor(PMColors.INK_PRIMARY)
                .selected(this.gcProjectIndex)
                .value(this.globalProjectTitle(this.gcProjectIndex))
                .onSelect((index: number) => {
                  this.gcProjectIndex = index;
                })
                .width('100%')
                .margin({ top: PMSpacing.XS })
                .accessibilityText('选择记忆归属项目')

              Text('碎片类型')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              Row({ space: PMSpacing.XS }) {
                ForEach(['随手记录', '论文笔记', '实验记录', '阶段复盘', '代码报错'], (type: string) => {
                  Button(type).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(this.gcSourceType === type ? PMColors.SURFACE : PMColors.INK_SECONDARY)
                    .backgroundColor(this.gcSourceType === type ? PMColors.BRAND : PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .height(36)
                    .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
                    .onClick(() => {
                      this.gcSourceType = type;
                    })
                }, (type: string) => type)
              }
              .width('100%')
              .margin({ top: PMSpacing.XS })

              Text('记录内容（至少 5 字）')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              TextArea({ text: this.gcText, placeholder: '记录随手记录内容（导师意见、实验结果、代码报错等，至少5个字）...' })
                .onChange((value: string) => {
                  this.gcText = value;
                })
                .fontSize(PMFontSize.BODY)
                .height(120)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .margin({ top: PMSpacing.XS })
                .accessibilityText('记忆内容')

              if (this.gcError !== '') {
                Text(this.gcError)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.RISK)
                  .margin({ top: PMSpacing.SM })
              }

              Text('原文会原样保留').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).margin({ top: PMSpacing.MD })
              Row({ space: PMSpacing.SM }) {
                Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .layoutWeight(1)
                  .onClick(() => {
                    this.showGlobalCapture = false;
                  })
                Button('保存到项目').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .layoutWeight(1)
                  .enabled(this.gcText.trim().length >= 5 && !this.gcSubmitting)
                  .onClick(() => {
                    void this.submitGlobalCapture();
                  })
              }
              .margin({ top: PMSpacing.LG })
              .width('100%')
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .constraintSize({ maxHeight: '90%' })
          .scrollable(ScrollDirection.Vertical)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .justifyContent(FlexAlign.Center)
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.COLOR, curve: PMMotion.CURVE_CONTENT }))
      }

      // 全局待办新增：先选归属项目，其余与项目内「新增待办」一致
      if (this.showGlobalTodo) {
        Column() {
          Scroll() {
            Column() {
              Text('新增待办')
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('全局入口：先选这条待办属于哪个项目，表单与项目内「新增待办」相同')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.XS })

              Text('归属项目')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              Select(this.globalProjectOptions()).fontColor(PMColors.INK_PRIMARY).selectedOptionFontColor(PMColors.BRAND).selectedOptionBgColor(PMColors.BRAND_LIGHT).optionFontColor(PMColors.INK_PRIMARY)
                .selected(this.gtProjectIndex)
                .value(this.globalProjectTitle(this.gtProjectIndex))
                .onSelect((index: number) => {
                  this.gtProjectIndex = index;
                })
                .width('100%')
                .margin({ top: PMSpacing.XS })
                .accessibilityText('选择待办归属项目')

              Text('要做什么？')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              TextInput({ text: this.gtTitle, placeholder: '例如： 整理复赛演示数据' })
                .onChange((value: string) => {
                  this.gtTitle = value;
                })
                .fontSize(PMFontSize.BODY)
                .height(48)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .margin({ top: PMSpacing.XS })
                .accessibilityText('待办标题')

              Text('补充说明（可不填）')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.MD })
              TextArea({ text: this.gtDescription, placeholder: '写下完成标准、材料位置或注意事项' })
                .onChange((value: string) => {
                  this.gtDescription = value;
                })
                .fontSize(PMFontSize.BODY)
                .height(88)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .margin({ top: PMSpacing.XS })
                .accessibilityText('待办补充说明')

              Text('什么时候优先做？')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ top: PMSpacing.MD })
              Row({ space: PMSpacing.SM }) {
                ForEach([1, 3, 5], (priority: number) => {
                  Button(priority === 1 ? '优先' : priority === 3 ? '普通' : '稍后').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(this.gtPriority === priority ? PMColors.SURFACE : PMColors.INK_SECONDARY)
                    .backgroundColor(this.gtPriority === priority ? PMColors.BRAND : PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .height(40)
                    .layoutWeight(1)
                    .onClick(() => {
                      this.gtPriority = priority;
                    })
                }, (priority: number) => `${priority}`)
              }
              .width('100%')
              .margin({ top: PMSpacing.XS })

              if (this.gtError !== '') {
                Text(this.gtError)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.RISK)
                  .margin({ top: PMSpacing.SM })
              }

              Row({ space: PMSpacing.SM }) {
                Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .layoutWeight(1)
                  .onClick(() => {
                    this.showGlobalTodo = false;
                  })
                Button('加入待办').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .layoutWeight(1)
                  .enabled(this.gtTitle.trim() !== '' && !this.gtSubmitting)
                  .onClick(() => {
                    void this.submitGlobalTodo();
                  })
              }
              .margin({ top: PMSpacing.LG })
              .width('100%')
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .constraintSize({ maxHeight: '90%' })
          .scrollable(ScrollDirection.Vertical)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .justifyContent(FlexAlign.Center)
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.COLOR, curve: PMMotion.CURVE_CONTENT }))
      }

      // 新建项目弹窗
      if (this.showCreateDialog) {
        Column() {
          Scroll() {
          Column() {
            Text('新建项目档案')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            // 材料优先是主入口：目标可以由 Agent 读懂材料后和用户一起核对，不必先自己想清楚。
            Button('先放材料，让 Agent 读懂')
              .type(ButtonType.Normal)
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.SM)
              .height(48)
              .width('100%')
              .margin({ top: PMSpacing.MD })
              .onClick(() => {
                this.closeCreateDialog();
                router.pushUrl({ url: 'pages/ProjectIntake' });
              })

            Text('已经有明确目标，直接填写')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.MD })

            Text('项目名称（至少 2 字）')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.MD })
            TextInput({ text: this.newTitle, placeholder: '例如：人工智能创意赛作品开发' })
              .onChange((value: string) => {
                this.newTitle = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })

            Text('项目目标（至少 2 字）')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })
            TextInput({ text: this.newGoal, placeholder: '例如：锁定核心证据链并完成答辩材料' })
              .onChange((value: string) => {
                this.newGoal = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })

            Text('项目简述（选填）')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })
            TextArea({ text: this.newDescription, placeholder: '项目背景或主要工作说明...' })
              .onChange((value: string) => {
                this.newDescription = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(60)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })

            Text('场景类型')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(['COURSE_DESIGN', 'RESEARCH', 'COMPETITION', 'INNOVATION', 'LAB_TASK'], (scenario: string) => {
                Button(TextFormatters.scenarioToChinese(scenario), { type: ButtonType.Normal })
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(this.newScenario === scenario ? FontWeight.Medium : FontWeight.Regular)
                  .fontColor(this.newScenario === scenario ? PMColors.BRAND : PMColors.INK_SECONDARY)
                  .backgroundColor(this.newScenario === scenario ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .width('31%').height(44)
                  .margin({ right: '2%', bottom: PMSpacing.XS })
                  .accessibilitySelected(this.newScenario === scenario)
                  .onClick(() => { this.newScenario = scenario; })
              }, (scenario: string) => scenario)
            }
            .width('100%')
            .margin({ top: PMSpacing.XS })

            Text('截止日期（选填）')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })

            Row() {
              Button(this.newDeadline === '' ? '选择截止日期' : this.newDeadline).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .height(48)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .layoutWeight(1)
                .accessibilityText(this.newDeadline === '' ? '选择项目截止日期' : `项目截止日期：${this.newDeadline}，点击修改`)
                .onClick(() => {
                  this.pickNewDeadline();
                })

              if (this.newDeadline !== '') {
                Button('清空').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.RISK)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .margin({ left: PMSpacing.SM })
                  .onClick(() => {
                    this.newDeadline = '';
                  })
              }
            }
            .width('100%')
            .margin({ top: PMSpacing.XS })

            if (this.createError !== '') {
              Text(this.createError)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.SM })
            } else if (!this.canCreateProject() && !this.isCreating) {
              Text('请填写至少 2 字的名称和目标、至少 10 字的项目简述。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.SM })
            }

            Row() {
              Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.SM)
                .height(48)
                .enabled(!this.isCreating)
                .onClick(() => {
                  this.closeCreateDialog();
                })

              Button(this.isCreating ? '创建中...' : '确认创建').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(this.canCreateProject() ? PMColors.BRAND : PMColors.INK_MUTED)
                .borderRadius(PMRadius.SM)
                .height(48)
                .margin({ left: PMSpacing.MD })
                .enabled(this.canCreateProject())
                .onClick(() => {
                  this.submitCreateProject();
                })
            }
            .margin({ top: PMSpacing.LG })
            .width('100%')
            .justifyContent(FlexAlign.End)
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .constraintSize({ maxHeight: '90%' })
          .scrollable(ScrollDirection.Vertical)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .justifyContent(FlexAlign.Center)
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.COLOR, curve: PMMotion.CURVE_CONTENT }))
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
    }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}


