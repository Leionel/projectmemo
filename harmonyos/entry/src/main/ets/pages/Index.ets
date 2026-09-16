import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Project, ApiError, ProjectCreateInput } from '../models/Project';
import { ProjectDetail, KnowledgeCard, CardTemporalStatus } from '../models/Memory';
import { Intervention } from '../models/Intervention';
import { ActionItem } from '../models/Action';
import { SettingsResponse, UpdateSettingsInput, ProbeInput, ProbeResponse } from '../models/Settings';
import { UserInfo } from '../models/Auth';

import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { ActionService } from '../services/ActionService';
import { MemoryService } from '../services/MemoryService';
import { SettingsService } from '../services/SettingsService';
import { SessionStore } from '../services/SessionStore';
import { AuthService } from '../services/AuthService';
import { LoginView } from '../components/LoginView';
import { ReminderSettingsView } from '../components/ReminderSettingsView';

import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction, PMMotion, PMMaterial, PMTransition } from '../common/DesignTokens';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { SeverityBadge, StatusBadge, MemoryTypeBadge, CategoryBadge, TemporalBadge } from '../components/MetricBadge';
import { FolderIcon, TaskIcon, MemoryIcon, SettingsIcon, AlertIcon, BookOpenIcon, PaperclipIcon, ClockIcon } from '../components/PMIcons';
import { DeadlineBadge } from '../components/DeadlineBadge';
import { TextFormatters } from '../common/TextFormatters';
import { Constants } from '../common/Constants';
import { PMBreakpoint, PMStorageKey, PMWidthBp } from '../common/WindowMetrics';

@Entry
@Component
struct Index {
  @State currentMainTabIndex: number = 0;
  @StorageProp(PMStorageKey.WIDTH_BP) widthBp: string = PMWidthBp.SM;

  // 认证与会话状态
  @State isAuthenticated: boolean = false;
  @State isCheckingAuth: boolean = true;
  @State currentUser: UserInfo = new UserInfo();
  @State sessionExpiresAt: string = '';

  // 数据主状态
  @State projects: Project[] = [];
  @State allInterventions: Intervention[] = [];
  @State allActions: ActionItem[] = [];
  @State allCards: KnowledgeCard[] = [];

  // 通用状态
  @State isLoading: boolean = false;
  @State errorMessage: string = '';

  // Tab 0: 项目专属
  @State selectedScenarioFilter: string = 'ALL';

  // Tab 2: 待办专属
  @State taskTabFilter: string = 'REMINDERS'; // 'REMINDERS' | 'ACTIONS'

  // Tab 1: 记忆专属
  @State globalMemorySearchQuery: string = '';
  @State globalCardStates: CardTemporalStatus[] = [];
  @State selectedGlobalType: string = 'all';

  // Tab 3: 设置专属状态
  @State llmMode: string = 'mock'; // 'mock' | 'openai-compatible'
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

  // 新建项目弹窗状态
  @State showCreateDialog: boolean = false;
  @State newTitle: string = '';
  @State newDescription: string = '';
  @State newGoal: string = '';
  @State newScenario: string = 'COMPETITION';
  @State newDeadline: string = '';
  @State isCreating: boolean = false;
  @State createError: string = '';

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
  }

  private async checkAndRestoreAuth(): Promise<void> {
    this.isCheckingAuth = true;
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
      this.isCheckingAuth = false;
    }
  }

  private handleSessionExpired(): void {
    this.isAuthenticated = false;
    this.currentUser = new UserInfo();
    this.projects = [];
    this.allCards = [];
    this.allActions = [];
    this.allInterventions = [];
    promptAction.showToast({ message: '登录已失效，请重新登录' });
  }

  private handleLoginSuccess(): void {
    this.isAuthenticated = true;
    this.currentUser = SessionStore.getUser();
    this.sessionExpiresAt = SessionStore.getExpiresAt();
    this.loadAllData();
    this.loadLlmSettings();
    promptAction.showToast({ message: '登录成功' });
  }

  private handleLogout(): void {
    promptAction.showDialog({
      title: '退出登录',
      message: '确认退出当前复赛演示账号？退出后需重新输入凭据。',
      buttons: [
        { text: '取消', color: '#666666' },
        { text: '退出登录', color: '#CF3B2B' }
      ]
    }).then(async (result) => {
      if (result.index === 1) {
        await this.authService.logout();
        this.handleSessionExpired();
      }
    });
  }

  onPageShow(): void {
    if (!this.isAuthenticated) {
      return;
    }
    this.openPendingNotification();
    if (!this.isLoading) {
      this.loadAllData(true);
    }
  }

  onBackPress(): boolean {
    if (this.showCreateDialog) {
      this.closeCreateDialog();
      return true;
    }
    return false;
  }

  private openPendingNotification(): void {
    const projectId = AppStorage.get<string>('notificationProjectId') ?? '';
    const interventionId = AppStorage.get<string>('notificationInterventionId') ?? '';
    if (projectId === '' || interventionId === '') {
      return;
    }
    AppStorage.setOrCreate<string>('notificationProjectId', '');
    AppStorage.setOrCreate<string>('notificationInterventionId', '');
    router.pushUrl({
      url: 'pages/InterventionDetail',
      params: { projectId, interventionId }
    });
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
    if (!silent) {
      this.isLoading = true;
    }
    this.errorMessage = '';
    this.dataSyncState = '同步中...';
    try {
      this.projects = await this.projectService.listProjects();

      // 聚合跨项目数据
      const intervs: Intervention[] = [];
      const acts: ActionItem[] = [];
      const cards: KnowledgeCard[] = [];
      let failedCount = 0;

      for (const p of this.projects) {
        try {
          const detail = await this.projectService.getProjectDetail(p.id);
          for (const c of detail.cards) {
            c.projectId = p.id;
            c.projectTitle = p.title;
            cards.push(c);
          }
          const pIntervs = await this.interventionService.list(p.id);
          for (const i of pIntervs) {
            intervs.push(i);
          }
          const pActs = await this.actionService.list(p.id);
          for (const a of pActs) {
            acts.push(a);
          }
        } catch (err) {
          failedCount++;
        }
      }

      this.allInterventions = intervs;
      this.allActions = acts;
      this.allCards = cards;
      // 时态状态：区分 当前有效 / 已取代 / 存在冲突 / 待确认，不删除历史
      const statuses: CardTemporalStatus[] = [];
      for (const p of this.projects) {
        try {
          const timeline = await this.memoryService.getDecisionTimeline(p.id);
          for (const item of timeline.items) {
            const st = new CardTemporalStatus();
            st.cardId = item.card.id;
            st.supportState = item.supportState;
            st.topLevelState = item.topLevelState;
            st.reasonCode = item.reasonCode;
            st.displayReason = item.displayReason;
            st.statusLabel = item.statusLabel;
            st.supersededByTitle = item.supersededBy !== null ? item.supersededBy.title : '';
            statuses.push(st);
          }
        } catch (_e) {
          // 单项目时态状态拉取失败不影响列表
        }
      }
      this.globalCardStates = statuses;
      if (failedCount > 0) {
        this.dataSyncState = `部分同步 (${this.projects.length - failedCount}/${this.projects.length})`;
      } else {
        this.dataSyncState = '已同步';
      }
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '无法连接服务，请检查网络连接';
      }
      this.dataSyncState = '同步失败';
    } finally {
      this.isLoading = false;
    }
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

  private closeCreateDialog(): void {
    if (this.isCreating) {
      return;
    }
    this.showCreateDialog = false;
  }

  private async submitCreateProject(): Promise<void> {
    if (this.isCreating) {
      return;
    }
    const title = this.newTitle.trim();
    if (title === '') {
      this.createError = '项目名称不能为空';
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
   * 动态生成无 0 噪音的项目统计摘要文案
   */
  private getProjectMetricSummary(project: Project): string {
    const parts: string[] = [];
    if (project._count.cards > 0) {
      parts.push(`${project._count.cards} 条项目记忆`);
    }
    if (project.dashboard.activeReminderCount > 0) {
      parts.push(`${project.dashboard.activeReminderCount} 条待处理提醒`);
    }
    if (project.dashboard.activeActionCount > 0) {
      parts.push(`${project.dashboard.activeActionCount} 项进行中行动`);
    }
    if (project._count.artifacts > 0) {
      parts.push(`${project._count.artifacts} 个成果草稿`);
    }
    if (parts.length === 0) {
      return '尚未形成项目进度';
    }
    return parts.join(' · ');
  }

  // ----------------------------------------------------
  // 底部导航栏 Bar (一级 4 项：项目 / 记忆 / 待办 / 设置)
  // ----------------------------------------------------
  @Builder
  private MainTabItemIcon(index: number) {
    if (index === 0) {
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
      this.MainTabItemIcon(index)
      Text(label)
        .fontSize(PMFontSize.BOTTOM_NAV)
        .fontFamily(PMFontFamily.SANS)
        .fontWeight(this.currentMainTabIndex === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.currentMainTabIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
        .margin({ top: 3 })
    }
    .layoutWeight(1)
    .height(56)
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
      this.MainTabBarItem(0, '项目')
      this.MainTabBarItem(1, '记忆')
      this.MainTabBarItem(2, '待办')
      this.MainTabBarItem(3, '设置')
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
      // 场景分类筛选胶囊
      Scroll() {
        Row() {
          Button('全部')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Regular)
            .fontColor(this.selectedScenarioFilter === 'ALL' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.selectedScenarioFilter === 'ALL' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(44)
            .border({ width: this.selectedScenarioFilter === 'ALL' ? 2 : 1, color: this.selectedScenarioFilter === 'ALL' ? PMColors.BRAND : PMColors.BORDER })
            .margin({ right: PMSpacing.XS })
            .accessibilityText('按场景筛选：全部')
            .accessibilitySelected(this.selectedScenarioFilter === 'ALL')
            .onClick(() => {
              this.selectedScenarioFilter = 'ALL';
            })

          Button('竞赛备赛')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Regular)
            .fontColor(this.selectedScenarioFilter === 'COMPETITION' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.selectedScenarioFilter === 'COMPETITION' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(44)
            .border({ width: this.selectedScenarioFilter === 'COMPETITION' ? 2 : 1, color: this.selectedScenarioFilter === 'COMPETITION' ? PMColors.BRAND : PMColors.BORDER })
            .margin({ right: PMSpacing.XS })
            .accessibilityText('按场景筛选：竞赛备赛')
            .accessibilitySelected(this.selectedScenarioFilter === 'COMPETITION')
            .onClick(() => {
              this.selectedScenarioFilter = 'COMPETITION';
            })

          Button('学术课题')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Regular)
            .fontColor(this.selectedScenarioFilter === 'RESEARCH' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.selectedScenarioFilter === 'RESEARCH' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(44)
            .border({ width: this.selectedScenarioFilter === 'RESEARCH' ? 2 : 1, color: this.selectedScenarioFilter === 'RESEARCH' ? PMColors.BRAND : PMColors.BORDER })
            .margin({ right: PMSpacing.XS })
            .accessibilityText('按场景筛选：学术课题')
            .accessibilitySelected(this.selectedScenarioFilter === 'RESEARCH')
            .onClick(() => {
              this.selectedScenarioFilter = 'RESEARCH';
            })

          Button('课程设计')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Regular)
            .fontColor(this.selectedScenarioFilter === 'COURSE_DESIGN' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.selectedScenarioFilter === 'COURSE_DESIGN' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(44)
            .border({ width: this.selectedScenarioFilter === 'COURSE_DESIGN' ? 2 : 1, color: this.selectedScenarioFilter === 'COURSE_DESIGN' ? PMColors.BRAND : PMColors.BORDER })
            .accessibilityText('按场景筛选：课程设计')
            .accessibilitySelected(this.selectedScenarioFilter === 'COURSE_DESIGN')
            .onClick(() => {
              this.selectedScenarioFilter = 'COURSE_DESIGN';
            })
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

      if (this.getFilteredProjects().length === 0) {
        EmptyStateView({
          title: '暂无项目档案',
          description: '点击右上角“+ 新建项目”开始建立首个证据档案',
          actionText: '+ 新建项目',
          onAction: () => {
            this.openCreateDialog();
          }
        })
      } else {
        List({ space: PMSpacing.SM }) {
          ForEach(this.getFilteredProjects(), (project: Project) => {
            ListItem() {
              this.projectItem(project)
            }
          }, (project: Project) => project.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.LG })
      }
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .align(Alignment.Top)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  private getFilteredProjects(): Project[] {
    if (this.selectedScenarioFilter === 'ALL') {
      return this.projects;
    }
    return this.projects.filter((p) => p.scenario === this.selectedScenarioFilter);
  }

  @Builder
  private projectItem(project: Project) {
    Column() {
      // 头部：统一分类 Badge 与截止日
      Row() {
        CategoryBadge({ category: project.scenario })
        DeadlineBadge({ deadline: project.dashboard.deadline })
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)

      // 标题与简介
      Text(TextFormatters.readableText(project.title, '项目名称无法读取，请重新编辑。'))
        .fontSize(PMFontSize.PRIMARY_JUDGEMENT)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: PMSpacing.SM })

      if (project.description !== '') {
        Text(TextFormatters.readableText(project.description, '项目简介无法读取，请重新编辑。'))
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: PMSpacing.XS })
      }

      // 进度语义随项目场景变化，避免课程设计显示备赛准备度。
      Column() {
        Row() {
          Text(TextFormatters.projectProgressLabel(project.scenario))
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text(project.dashboard.readiness.percentage === 0 && project._count.cards === 0 && project._count.artifacts === 0 ?
            '尚未形成' : `${project.dashboard.readiness.percentage}%`)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(project.dashboard.deadline.kind === 'overdue' ? PMColors.RISK : PMColors.BRAND)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(5)
            .backgroundColor(PMColors.BORDER)
            .borderRadius(PMRadius.FULL)
          Row()
            .width(`${Math.min(100, Math.max(0, project.dashboard.readiness.percentage))}%`)
            .height(5)
            .backgroundColor(project.dashboard.deadline.kind === 'overdue' ? PMColors.RISK : PMColors.BRAND)
            .borderRadius(PMRadius.FULL)
        }
        .width('100%')
        .margin({ top: PMSpacing.XS })
      }
      .width('100%')
      .margin({ top: PMSpacing.MD })

      // 动态记忆与统计摘要（无 0 KPI 噪音）
      Row() {
        Text(this.getProjectMetricSummary(project))
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
      }
      .width('100%')
      .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
      .border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
      .margin({ top: PMSpacing.SM })

      // 下一步行动引导
      if (project.dashboard.nextAction.label !== '') {
        Row() {
          Text('下一步')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(project.dashboard.deadline.kind === 'overdue' ? PMColors.RISK : PMColors.BRAND)
            .margin({ right: PMSpacing.SM })

          Text(TextFormatters.readableText(project.dashboard.nextAction.label, '下一步行动无法读取'))
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_PRIMARY)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)

          Text('→')
            .fontSize(PMFontSize.BODY)
            .fontColor(project.dashboard.deadline.kind === 'overdue' ? PMColors.RISK : PMColors.BRAND)
            .margin({ left: PMSpacing.XS })
        }
        .width('100%')
        .padding({ top: 4, bottom: 2 })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({
      width: { left: 4, top: 1, right: 1, bottom: 1 },
      color: {
        left: project.dashboard.deadline.kind === 'overdue' ? PMColors.RISK :
          project.dashboard.highestReminderSeverity >= 4 ? PMColors.EVIDENCE :
            project.dashboard.readiness.percentage > 0 ? PMColors.BRAND : PMColors.BORDER,
        top: PMColors.BORDER,
        right: PMColors.BORDER,
        bottom: PMColors.BORDER
      }
    })
    .shadow({
      radius: 8,
      color: project.dashboard.deadline.kind === 'overdue' ? 'rgba(220, 38, 38, 0.08)' : 'rgba(19, 36, 58, 0.04)',
      offsetX: 0,
      offsetY: 2
    })
    .alignItems(HorizontalAlign.Start)
    .clickEffect(PMInteraction.PRESS_EFFECT)
    .onClick(() => {
      router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: project.id } });
    })
  }

  // ----------------------------------------------------
  // Tab 1: 待办提醒视图 (跨项目待办与提醒)
  // ----------------------------------------------------
  @Builder
  private TasksTab() {
    Column() {
      // 提醒 vs 待办行动 分类切换
      Row() {
        Button(`主动提醒 (${this.allInterventions.filter((i) => i.status === 'OPEN').length})`)
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.taskTabFilter === 'REMINDERS' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.taskTabFilter === 'REMINDERS' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .height(48)
          .accessibilityText('查看主动提醒')
          .accessibilitySelected(this.taskTabFilter === 'REMINDERS')
          .layoutWeight(1)
          .onClick(() => {
            this.taskTabFilter = 'REMINDERS';
          })

        Button(`待办行动 (${this.allActions.filter((a) => a.status !== 'DONE').length})`)
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.taskTabFilter === 'ACTIONS' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.taskTabFilter === 'ACTIONS' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .height(48)
          .accessibilityText('查看待办行动')
          .accessibilitySelected(this.taskTabFilter === 'ACTIONS')
          .layoutWeight(1)
          .margin({ left: PMSpacing.SM })
          .onClick(() => {
            this.taskTabFilter = 'ACTIONS';
          })
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

      if (this.taskTabFilter === 'REMINDERS') {
        List({ space: PMSpacing.MD }) {
          ForEach(this.allInterventions.filter((i) => i.status === 'OPEN'), (interv: Intervention) => {
            ListItem() {
              Column() {
                // 顶部：所属项目与严重等级 (保留左侧 Accent 与 SeverityBadge，去除重复感叹号)
                Row() {
                  SeverityBadge({ severity: interv.severity })

                  Text(interv.projectId !== '' ? (this.projects.find((p: Project) => p.id === interv.projectId)?.title ?? '') : '')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                    .textAlign(TextAlign.End)
                    .margin({ left: PMSpacing.SM })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)

                Text(interv.title)
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ top: PMSpacing.SM })

                Text(interv.content)
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(20)
                  .margin({ top: PMSpacing.XS })

                Row() {
                  Button('查看提醒依据 →')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SURFACE)
                    .backgroundColor(PMColors.BRAND)
                    .borderRadius(PMRadius.SM)
                    .height(44)
                    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: 6, bottom: 6 })
                    .onClick(() => {
                      router.pushUrl({
                        url: 'pages/InterventionDetail',
                        params: { projectId: interv.projectId, interventionId: interv.id }
                      });
                    })
                }
                .width('100%')
                .justifyContent(FlexAlign.End)
                .margin({ top: PMSpacing.SM })
              }
              .width('100%')
              .padding(PMSpacing.LG)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.LG)
              .border({
                width: { left: 3, top: 1, right: 1, bottom: 1 },
                color: {
                  left: interv.severity >= 4 ? PMColors.RISK : PMColors.EVIDENCE,
                  top: PMColors.BORDER,
                  right: PMColors.BORDER,
                  bottom: PMColors.BORDER
                }
              })
              .shadow({ radius: 8, color: 'rgba(19, 36, 58, 0.04)', offsetX: 0, offsetY: 2 })
              .alignItems(HorizontalAlign.Start)
            }
          }, (interv: Intervention) => interv.id)
        }
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
      } else {
        List({ space: PMSpacing.MD }) {
          ForEach(this.allActions.filter((a) => a.status !== 'DONE'), (action: ActionItem) => {
            ListItem() {
              Column() {
                Row() {
                  StatusBadge({ status: action.status })
                  Text(TextFormatters.priorityToChinese(action.priority))
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
                .width('100%')
                .justifyContent(FlexAlign.SpaceBetween)

                Text(action.title)
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ top: PMSpacing.SM })

                Row() {
                  Button('进入项目 →')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.BRAND)
                    .backgroundColor(PMColors.BRAND_LIGHT)
                    .borderRadius(PMRadius.XS)
                    .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: 4, bottom: 4 })
                    .onClick(() => {
                      router.pushUrl({
                        url: 'pages/ProjectHome',
                        params: { projectId: action.projectId }
                      });
                    })
                }
                .width('100%')
                .justifyContent(FlexAlign.End)
                .margin({ top: PMSpacing.SM })
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.MD)
              .border({ width: 1, color: PMColors.BORDER })
              .alignItems(HorizontalAlign.Start)
            }
          }, (action: ActionItem) => action.id)
        }
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
      }
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .align(Alignment.Top)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  // ----------------------------------------------------
  // Tab 1: 记忆视图 (跨项目知识库)
  // ----------------------------------------------------
  @Builder
  private GlobalMemoryTab() {
    Column() {
      // 搜索框与筛选
      Column() {
        TextInput({ text: this.globalMemorySearchQuery, placeholder: '搜索所有项目记忆与复盘...' })
          .onChange((v: string) => {
            this.globalMemorySearchQuery = v;
          })
          .fontSize(PMFontSize.BODY)
          .height(40)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .border({ width: 1, color: PMColors.BORDER })

        Scroll() {
          Row() {
            Button('全部')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Regular)
              .fontColor(this.selectedGlobalType === 'all' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedGlobalType === 'all' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：全部')
              .accessibilitySelected(this.selectedGlobalType === 'all')
              .onClick(() => {
                this.selectedGlobalType = 'all';
              })

            Button('论文笔记')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Regular)
              .fontColor(this.selectedGlobalType === 'paper_note' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedGlobalType === 'paper_note' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：论文笔记')
              .accessibilitySelected(this.selectedGlobalType === 'paper_note')
              .onClick(() => {
                this.selectedGlobalType = 'paper_note';
              })

            Button('实验记录')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Regular)
              .fontColor(this.selectedGlobalType === 'experiment_log' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedGlobalType === 'experiment_log' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：实验记录')
              .accessibilitySelected(this.selectedGlobalType === 'experiment_log')
              .onClick(() => {
                this.selectedGlobalType = 'experiment_log';
              })

            Button('阶段复盘')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Regular)
              .fontColor(this.selectedGlobalType === 'reflection' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedGlobalType === 'reflection' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .accessibilityText('按记忆类型筛选：阶段复盘')
              .accessibilitySelected(this.selectedGlobalType === 'reflection')
              .onClick(() => {
                this.selectedGlobalType = 'reflection';
              })
          }
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .margin({ top: PMSpacing.SM })
      }
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

      List({ space: PMSpacing.MD }) {
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
                    if (this.cardStatus(card.id) !== null) {
                      Text(this.cardStatus(card.id)!.statusLabel)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(this.statusColor(this.cardStatus(card.id)!.topLevelState))
                        .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.XS)
                        .accessibilityText(`记忆状态：${this.cardStatus(card.id)!.statusLabel}`)
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
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: PMSpacing.SM })

                if (TextFormatters.shouldShowSummary(card.title, card.summary)) {
                  Text(card.summary)
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .margin({ top: PMSpacing.XS })
                }
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
              .padding({ top: PMSpacing.SM })
              .accessibilityText(`所属项目：${card.projectTitle !== '' ? card.projectTitle : '项目归属未同步'}`)
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Start)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              if (card.projectId !== '') {
                router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: card.projectId, tab: 'memory' } });
              }
            })
            .accessibilityText(`记忆：${TextFormatters.readableText(card.title, '历史记忆需要修复')}，所属项目：${card.projectTitle !== '' ? card.projectTitle : '项目归属未同步'}`)
            .accessibilityDescription(card.projectId !== '' ? '打开所属项目的记忆页面' : '项目归属未同步，暂时无法跳转')
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
    if (state === 'UNKNOWN' || state === 'INSUFFICIENT' || state === 'REVOKED') return PMColors.EVIDENCE;
    return PMColors.SUCCESS;
  }

  private getFilteredGlobalCards(): KnowledgeCard[] {
    const q = this.globalMemorySearchQuery.trim().toLowerCase();
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

  // ----------------------------------------------------
  // Tab 3: 设置视图 (大模型 API 配置与环境)
  // ----------------------------------------------------
  @Builder
  private AppInfoCard() {
    Column() {
      Text('应用信息')
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_TERTIARY)

      Row() {
        Image($r('app.media.app_icon'))
          .width(56)
          .height(56)
          .borderRadius(PMRadius.LG)
          .objectFit(ImageFit.Cover)
          .accessibilityText('忆程 ProjectMemo 应用图标')

        Column() {
          Text('忆程 ProjectMemo')
            .fontSize(PMFontSize.PAGE_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
          Text('证据驱动的项目过程档案与决策手账')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(20)
            .margin({ top: PMSpacing.XS })
          Text('HarmonyOS 客户端')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .margin({ left: PMSpacing.MD })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .margin({ top: PMSpacing.SM })
      .accessibilityText('忆程 ProjectMemo，证据驱动的项目过程档案与决策手账，HarmonyOS 客户端')

      Divider()
        .color(PMColors.DIVIDER)
        .margin({ top: PMSpacing.MD, bottom: PMSpacing.SM })

      Row() {
        Column() {
          Text('功能范围')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text('记忆 · 提醒 · 待办 · 成果')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: PMSpacing.XS })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        Column() {
          Text('数据同步')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text(this.dataSyncState)
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.dataSyncState === '同步失败' ? PMColors.RISK :
              this.dataSyncState === '同步中...' ? PMColors.BRAND : PMColors.SUCCESS)
            .margin({ top: PMSpacing.XS })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private SettingsTab() {
    Scroll() {
      Column() {
        // 1. 一级卡片：应用身份与当前环境 (App Summary)
        this.AppInfoCard()

        // 2. 账号与会话 (Account & Session)
        Text('账号与授权')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text(this.currentUser.displayName !== '' ? this.currentUser.displayName : '复赛演示账号')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('账号：' + (this.currentUser.username !== '' ? this.currentUser.username : 'contest-demo'))
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Row() {
              Text('会话有效')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.SUCCESS)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(PMColors.SUCCESS_LIGHT)
                .borderRadius(PMRadius.FULL)
            }
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('退出登录')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.RISK)
              Text('撤销会话并清除本地凭证')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('退出 ›')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.RISK)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            this.handleLogout();
          })
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })

        // 3. AI 与忆程 (AI & Engine)
        Text('AI 与忆程')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text('大模型与引擎')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text(this.llmMode === 'openai-compatible' ? 'OpenAI-compatible · 在线' : '确定性规则 · 仍需后端')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Row() {
              Text(this.llmMode === 'openai-compatible' ? '在线 API' : '规则模式')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND : PMColors.MEMORY)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND_LIGHT : PMColors.MEMORY_LIGHT)
                .borderRadius(PMRadius.FULL)
                .margin({ right: PMSpacing.XS })
              Text('›')
                .fontSize(20)
                .fontColor(PMColors.INK_TERTIARY)
            }
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            this.settingsSheetMode = 'api';
            this.showSettingsSheet = true;
          })

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('忆程回答偏好')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('证据优先 · 不确定时明确说明')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('已启用')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.SUCCESS)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor(PMColors.SUCCESS_LIGHT)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('小艺连接状态')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('平台联调尚未验收')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('待验证')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.SUCCESS)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor(PMColors.SUCCESS_LIGHT)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })

        // 3. 提醒与主动介入 (Intervention & Notification)
        Text('提醒与主动介入')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text('风险主动介入提醒')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('由项目风险和提醒预算共同决定')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('按提醒策略').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('截止临近提醒')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('依据项目实际截止日期评估')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('按提醒策略').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('夜间免打扰')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('设置开始与结束时间，以服务端策略为准')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('设置 ›')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.settingsSheetMode = 'policy';
            this.showSettingsSheet = true;
          })

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('提醒介入强度')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('设置每日主动提醒上限')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('设置 ›')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.settingsSheetMode = 'policy';
            this.showSettingsSheet = true;
          })
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })

        // 4. 证据与记忆 (Evidence & Memory)
        Text('证据与记忆')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text('证据可信度规则')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('多维溯源，来源存在不等于事实成立')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('固定规则')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('记忆确认与变更策略')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('双步确认生效，禁止系统静默改写')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('固定规则')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('不确定信息处理')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('Unknown 严格保留，不作为 False 处理')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('保留 UNKNOWN')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.EVIDENCE)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor(PMColors.EVIDENCE_LIGHT)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })

        // 5. 小艺与设备 (XiaoYi & Human-in-the-Loop)
        Text('小艺与设备')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text('允许小艺读取项目状态')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('需完成平台授权与实际联调')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('暂未接入').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('允许小艺记录项目记忆')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('需完成平台授权与实际联调')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('暂未接入').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('行动创建需要确认')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('行动提案确认后才提交；明确记录指令可保存')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('安全策略 · 强制')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })

        // 6. 帮助与关于 (Help & About)
        Text('帮助与关于')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS, left: 4 })

        Column() {
          Row() {
            Column() {
              Text('功能介绍与设计理念')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('项目记忆、状态对比与主动介入答辩说明')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('›')
              .fontSize(20)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            router.pushUrl({ url: 'pages/FeatureGuide' });
          })

          Divider().color(PMColors.BORDER_SUBTLE)

          Row() {
            Column() {
              Text('版本号')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('HarmonyOS NEXT · Release 2026')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text('v0.1.0')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .height(52)
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
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
        projectId: this.projects.length > 0 ? this.projects[0].id : '',
        onClose: () => { this.showSettingsSheet = false; }
      })
    } else {
      this.ApiSheet()
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
        Button('✕')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_TERTIARY)
          .backgroundColor('transparent')
          .onClick(() => {
            this.showSettingsSheet = false;
          })
          .accessibilityText('关闭 API 配置')
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      Scroll() {
        Column() {
          Row() {
            Text('当前运行方式')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_TERTIARY)
            Text(this.llmMode === 'openai-compatible' ? '在线 API' : '离线确定性引擎')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND : PMColors.MEMORY)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
              .backgroundColor(this.llmMode === 'openai-compatible' ? PMColors.BRAND_LIGHT : PMColors.MEMORY_LIGHT)
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
            Button(this.llmMode === 'openai-compatible' ? '✓ OpenAI 兼容 API' : 'OpenAI 兼容 API')
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

            Button(this.llmMode === 'mock' ? '✓ 离线确定性引擎' : '离线确定性引擎')
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
              Button(this.isProbing ? '正在测试...' : '测试连通性')
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

            Button(!this.settingsEditable ? '生产环境只读' : (this.isSavingSettings ? '保存中...' : '保存配置'))
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

          Button('重新同步数据')
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
      Column() {
        LoadingStateView({ message: '正在连接演示环境...' })
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
      .backgroundColor(PMColors.BACKGROUND)
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
    } else {
      Stack() {
        Column() {
          // 头部：正式统一品牌名 "忆程 ProjectMemo"
          Row() {
          Image($r('app.media.app_icon'))
            .width(36)
            .height(36)
            .borderRadius(PMRadius.SM)
            .objectFit(ImageFit.Cover)
            .margin({ right: PMSpacing.SM })
            .accessibilityText('忆程 ProjectMemo 标志')

          Column() {
            Text('忆程 ProjectMemo')
              .fontSize(PMFontSize.TITLE)
              .fontWeight(FontWeight.Bold)
              .fontFamily(PMFontFamily.SANS)
              .fontColor(PMColors.INK_PRIMARY)
            Text(this.currentMainTabIndex === 0 ? '证据驱动的项目过程档案与决策手账' :
              this.currentMainTabIndex === 1 ? '项目过程记忆与复盘' :
                this.currentMainTabIndex === 2 ? '主动提醒与待办事项' : '大模型 API 配置与运行参数')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 3 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ right: PMSpacing.SM })

          if (this.currentMainTabIndex === 0) {
            Row() {
              Button('+ 新建项目')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(48)
                .accessibilityText('新建项目')
                .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
                .onClick(() => {
                  this.openCreateDialog();
                })
            }
          }
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
        .backgroundColor(PMColors.SURFACE)
        .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

        Column() {
          if (this.isLoading) {
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

      // 新建项目弹窗
      if (this.showCreateDialog) {
        Column() {
          Column() {
            Text('新建项目档案')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            Text('项目名称（必填）')
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

            Text('项目目标')
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

            Text('项目简述')
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
            Row() {
              Button('学术备赛')
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Regular)
                .fontColor(this.newScenario === 'COMPETITION' ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.newScenario === 'COMPETITION' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .layoutWeight(1)
                .onClick(() => {
                  this.newScenario = 'COMPETITION';
                })

              Button('学术课题')
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Regular)
                .fontColor(this.newScenario === 'RESEARCH' ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.newScenario === 'RESEARCH' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .layoutWeight(1)
                .margin({ left: PMSpacing.XS })
                .onClick(() => {
                  this.newScenario = 'RESEARCH';
                })

              Button('课程设计')
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Regular)
                .fontColor(this.newScenario === 'COURSE_DESIGN' ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.newScenario === 'COURSE_DESIGN' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .layoutWeight(1)
                .margin({ left: PMSpacing.XS })
                .onClick(() => {
                  this.newScenario = 'COURSE_DESIGN';
                })
            }
            .width('100%')
            .margin({ top: PMSpacing.XS })

            Text('截止日期 (YYYY-MM-DD，选填)')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })

            Row() {
              TextInput({ text: this.newDeadline, placeholder: '例如：2026-09-30' })
                .onChange((value: string) => {
                  this.newDeadline = value;
                })
                .fontSize(PMFontSize.BODY)
                .height(48)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .layoutWeight(1)

              if (this.newDeadline !== '') {
                Button('清空')
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
            }

            Row() {
              Button('取消')
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

              Button(this.isCreating ? '创建中...' : '确认创建')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(this.newTitle.trim() !== '' && !this.isCreating ? PMColors.BRAND : PMColors.INK_MUTED)
                .borderRadius(PMRadius.SM)
                .height(48)
                .margin({ left: PMSpacing.MD })
                .enabled(this.newTitle.trim() !== '' && !this.isCreating)
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
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .alignItems(HorizontalAlign.Start)
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
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
