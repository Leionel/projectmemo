import { alertError } from '../common/ErrorAlert';
import { ProjectImpactPanel } from '../components/ProjectImpactPanel';
import { CopilotContinuationCard } from '../components/CopilotContinuationCard';
import { SessionStore } from '../services/SessionStore';
import { ProjectAgentContext } from '../models/ProjectAgentContext';
import { ProjectAgentContextService } from '../services/ProjectAgentContextService';
import { EvidenceAssessment, evidenceAssessmentText } from '../models/Copilot';
import router from '@ohos.router';
import { FocusAgentLauncher, LauncherScrollTracker } from '../components/FocusAgentLauncher';
import { copyPickedFile, pickedFileName, removePickedCopy } from '../common/PickedFile';
import promptAction from '@ohos.promptAction';
import { missionHandoffRoute } from '../common/MissionWidgetContract';
import { captureSourceCardId } from '../models/WorkPacket';
import pasteboard from '@ohos.pasteboard';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { common } from '@kit.AbilityKit';
import { Project, ProjectDashboard, ApiError, ReadinessItem, ProjectUpdateInput } from '../models/Project';
import { ProjectDetail, KnowledgeCard, CardLink, IncomingCardLink, TemporalTimelineResponse, TemporalDecisionItem, TemporalCardSummary } from '../models/Memory';
import { Milestone, Deliverable, DeliverableEvidence } from '../models/Milestone';
import { Intervention, ProposedAction } from '../models/Intervention';
import { ActionCreateInput, ActionItem } from '../models/Action';
import { ArtifactItem } from '../models/Artifact';
import { AgentMessage, AgentCitation, EvidenceClaim, ProjectEvidenceRef, ActionCreatePayload, ArtifactGeneratePayload } from '../models/Copilot';
import { Attachment } from '../models/Attachment';
import { attachmentSize, attachmentStatus } from '../common/AttachmentPresentation';

import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { MemoryService } from '../services/MemoryService';
import { MemoryLifecycleService } from '../services/MemoryLifecycleService';
import { InterventionPolicyService } from '../services/InterventionPolicyService';
import { ProjectStateService } from '../services/ProjectStateService';
import { MeetingImportSheet } from '../components/MeetingImportSheet';
import { deadlineReminderConflict } from '../common/GlobalFocusPresentation';
import { DateOnly } from '../common/DateOnly';
import { PolicyResponse, PolicySuggestion, PolicyUpdateBody } from '../models/Intervention';
import { ActionService } from '../services/ActionService';
import { ArtifactService } from '../services/ArtifactService';
import { CopilotService } from '../services/CopilotService';
import { NotificationService } from '../services/NotificationService';
import { AttachmentService } from '../services/AttachmentService';
import { MilestoneService } from '../services/MilestoneService';
import { WidgetDataService } from '../services/WidgetDataService';
import { ReentryService, EpisodePreviewBody, EpisodeConfirmBody } from '../services/ReentryService';
import { ReentryData, Episode, EpisodeRevision, EpisodeSummarySection, EpisodeClaim, EpisodeSourceRef } from '../models/Reentry';
import { ReminderService } from '../services/ReminderService';

import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction, PMMotion, PMTransition, PMButtonSize } from '../common/DesignTokens';
import { PMBreakpoint, PMStorageKey, PMWidthBp } from '../common/WindowMetrics';
import { SeverityBadge, StatusBadge, MemoryTypeBadge, CategoryBadge } from '../components/MetricBadge';
import { EvidenceItemView } from '../components/EvidenceItemView';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import {
  DashboardIcon,
  MemoryIcon,
  TaskIcon,
  CopilotIcon,
  ArtifactIcon,
  CheckIcon,
  AlertIcon,
  SpineNodeIcon,
  PaperclipIcon,
  SearchIcon,
  PlusIcon,
  BookOpenIcon,
  CloseIcon
} from '../components/PMIcons';
import { PMAppBar } from '../components/PMAppBar';
import { ConversationService } from '../services/ConversationService';
import { PMButton, PMPageIntro, PMStatusPill, PMListRow, PMCloseButton, PMSheetHeader } from '../components/PMReferencePrimitives';
import { TextFormatters } from '../common/TextFormatters';
import { MarkdownView } from '../components/MarkdownView';
import { DeadlineBadge } from '../components/DeadlineBadge';
import { ChangeImpactDialog } from '../components/ChangeImpactDialog';
import { ClaimAuditorDrawer } from '../components/ClaimAuditorDrawer';
import { ProjectStatePanel } from '../components/ProjectStatePanel';
import { HealthEntryCard } from '../components/HealthEntryCard';
import { ActionReminderBlock } from '../components/ActionReminderBlock';
import { EpisodeActionOutcome, SuggestionEntry } from '../models/EpisodeAction';
import { EpisodeActionService } from '../services/EpisodeActionService';
import { HealthSeverityCopy } from '../models/Health';
import { ProjectStateDiffSheet } from '../components/ProjectStateDiffSheet';
import { ProjectChangeBrief } from '../components/ProjectChangeBrief';
import { ReadinessBreakdownSheet } from '../components/ReadinessBreakdownSheet';
import { ActionCreateConfirmSheet } from '../components/ActionCreateConfirmSheet';
import { ChangeBrief, StateDiff, StateDiffItem } from '../models/ProjectState';
import { JudgeRebuttalModal } from '../components/JudgeRebuttalModal';
import { AttachmentCorrectionModal } from '../components/AttachmentCorrectionModal';
import { ExportFormatter } from '../common/ExportFormatter';
import { DeviceIdentity } from '../common/DeviceIdentity';
import { MissionPanel } from '../components/MissionPanel';
import { MissionService } from '../services/MissionService';
import { MissionWorkspaceItem, MissionWorkspaceSummary } from '../models/Mission';
import { missionStatusLabel } from '../common/MissionContract';
import { selectProjectFocus } from '../common/ProjectAttention';
import { ProjectEvolutionPanel } from '../components/ProjectEvolutionPanel';
import { workStateLabel } from '../common/WorkStateBadge';

interface HomeRecentActivity {
  id: string;
  kind: string;
  title: string;
  meta: string;
  timestamp: number;
}

/** 逐卡写入 timeline 时态；未出现在投影中的卡保持 UNKNOWN，由列表决定不显示。 */
function applyTemporalStates(cards: KnowledgeCard[], timeline: TemporalTimelineResponse | null): void {
  const byId = new Map<string, TemporalDecisionItem>();
  if (timeline !== null) {
    for (const item of timeline.items) {
      byId.set(item.card.id, item);
    }
  }
  for (const card of cards) {
    const item = byId.get(card.id);
    card.topLevelState = item !== undefined ? item.topLevelState : 'UNKNOWN';
    card.reasonCode = item !== undefined ? item.reasonCode : 'NO_SUPPORTING_EVIDENCE';
    card.displayReason = item !== undefined ? item.displayReason : '';
  }
}

@Entry
@Component
struct ProjectHome {
  @State projectId: string = '';
  @State private focusConversationId: string = '';
  @State private focusAgentEnabled: boolean = false;
  @State currentTabIndex: number = 0;
  @State launcherCollapsed: boolean = false;
  private launcherTracker: LauncherScrollTracker = new LauncherScrollTracker();
  @State private transitionTitle: string = '';
  @State missionRefreshKey: number = 0;
  @State showProjectStatus: boolean = false;
  @State showQuickCopilot: boolean = false;
  @State private agentContext: ProjectAgentContext | null = null;
  @State private agentContextError: string = '';
  private agentContextGeneration: number = 0;
  // 401 会话失效时清掉本项目私有内容与未提交草稿，旧账号内容不能留在页面或本地草稿里。
  private agentContextExpired: () => void = () => {
    this.clearPrivateState('登录已失效，请重新登录。');
    if (this.pageVisible) { router.replaceUrl({ url: 'pages/LoginPage' }); }
  };
  @State homeMission: MissionWorkspaceItem | null = null;
  @State showEvolution: boolean = false;
  @StorageProp(PMStorageKey.WIDTH_BP) widthBp: string = PMWidthBp.SM;
  // 卡片/通知在 App 已在前台时由 onNewWant 投递；页面可见时用序号驱动消费一次。
  @StorageProp('pm.handoffSeq') @Watch('onHandoffIntent') handoffSeq: number = 0;
  private pageVisible: boolean = false;

  // 数据主状态
  @State project: ProjectDetail = new ProjectDetail();
  @State dashboard: ProjectDashboard = new ProjectDashboard();
  @State interventions: Intervention[] = [];
  @State actions: ActionItem[] = [];
  @State artifacts: ArtifactItem[] = [];
  @State chatMessages: AgentMessage[] = [];
  @State milestones: Milestone[] = [];
  @State attachments: Attachment[] = [];
  @State materialsMode: string = 'memory';
  @State attachmentSearch: string = '';
  @State attachmentSearchOpen: boolean = false;
  @State memorySearchOpen: boolean = false;
  @State actionSearchOpen: boolean = false;
  @State actionSearchQuery: string = '';
  @State expandedActionDescId: string = '';
  @State selectedActionId: string = '';
  @State editingActionId: string = '';
  @State editActionTitle: string = '';
  @State editActionDescription: string = '';
  @State confirmCancelActionId: string = '';
  @State actionEditBusy: boolean = false;
  @State @Watch('alertActionEditError') actionEditError: string = '';
  private alertActionEditError(): void { alertError(this.actionEditError); }
  @State attachmentLoadError: string = '';
  @State actionStatusFilter: string = 'ACTIVE';
  // 决策演化：取时态投影里最近一组“被取代 → 替代”，只读展示，关系确认在结论演进页完成
  @State decisionOld: TemporalCardSummary | null = null;
  @State decisionNew: TemporalCardSummary | null = null;
  @State lastUploadedAttachmentId: string = '';
  @State milestoneLoadError: string = '';

  // 通用状态
  @State isLoading: boolean = false;
  @State hasLoadedProjectSnapshot: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';

  // Tab 0: 工作台专属状态
  @State rawText: string = '';
  @State sourceType: string = '随手记录';
  @State captureRequestId: string = '';
  @State materialMissionId: string = '';
  @State materialQuestionId: string = '';
  @State materialQuestion: string = '';
  @State materialSourceId: string = '';
  private materialOwnerId: string = '';
  @State isCapturing: boolean = false;
  @State @Watch('alertCaptureError') captureError: string = '';
  private alertCaptureError(): void { alertError(this.captureError); }
  @State isUploadingAttachment: boolean = false;
  @State attachmentFeedback: string = '';
  @State @Watch('alertAttachmentFeedback') attachmentFeedbackTone: string = 'info';
  private alertAttachmentFeedback(): void { if (this.attachmentFeedbackTone === 'error' || this.attachmentFeedbackTone === 'warning') alertError(this.attachmentFeedback); }
  @State attachmentRetryId: string = '';
  @State isRetryingAttachment: boolean = false;
  @State isEvaluating: boolean = false;
  @State @Watch('alertEvaluateError') evaluateError: string = '';
  private alertEvaluateError(): void { alertError(this.evaluateError); }
  @State showDemoControls: boolean = false;
  // 单一半模态入口：同一时刻只挂载一个 bindSheet，按模式渲染记录/会议
  @State showEntrySheet: boolean = false;
  @State meetingInjectedText: string = '';
  @State entrySheetMode: string = 'capture'; // 'capture' | 'meeting'
  @State showChangeImpactDialog: boolean = false;
  @State showClaimAuditor: boolean = false;
  @State showStateDiffSheet: boolean = false;
  @State stateDiffForSheet: StateDiff = new StateDiff();
  @State showChangeBrief: boolean = false;
  @State briefForSheet: ChangeBrief = new ChangeBrief();
  // 项目内准备项：逐项说明与计算口径，计数仍完全来自服务端 readiness.items
  @State showReadinessSheet: boolean = false;
  // 候选行动确认：预览与提交分开，点「创建行动」不直接写入
  @State showActionConfirmSheet: boolean = false;
  @State actionConfirmIntervention: Intervention = new Intervention();
  @State actionConfirmIndex: number = 0;
  @State isCreatingFocusAction: boolean = false;
  @State @Watch('alertActionConfirmError') actionConfirmError: string = '';
  private alertActionConfirmError(): void { alertError(this.actionConfirmError); }
  // 状态面板回传的当前变化：「最近闭环」只能引用有独立依据的状态变化
  @State stateDiff: StateDiff = new StateDiff();

  @State isExportingProvenance: boolean = false;
  @State lifecycleActionCardId: string = '';
  @State showJudgeRebuttal: boolean = false;
  @State showAttachmentCorrection: boolean = false;
  @State correctingAttachment: Attachment = new Attachment();
  @State showSettingsDialog: boolean = false;
  @State isArchivingProject: boolean = false;
  @State editTitle: string = '';
  @State editGoal: string = '';
  @State editDescription: string = '';
  @State editDeadline: string = '';
  @State isSavingSettings: boolean = false;
  @State settingsTabIndex: number = 0;
  @State showSuppressionDetail: boolean = false;

  // Tab 1: 记忆专属状态
  @State memorySearchQuery: string = '';
  @State selectedMemoryType: string = 'all';
  @State expandedCardId: string = '';
  @State requestedCaptureId: string = '';
  @State captureSourceNotice: string = '';
  @State memorySearchResults: KnowledgeCard[] = [];
  @State isSearchingMemory: boolean = false;
  @State @Watch('alertMemorySearchError') memorySearchError: string = '';
  private alertMemorySearchError(): void { alertError(this.memorySearchError); }

  // Tab 2: 待办专属状态
  @State completingActionId: string = '';
  @State resultText: string = '';
  @State isSubmittingAction: boolean = false;
  @State @Watch('alertDialogError') dialogError: string = '';
  private alertDialogError(): void { alertError(this.dialogError); }
  @State startingActionId: string = '';
  @State showCreateAction: boolean = false;
  @State newActionTitle: string = '';
  @State newActionDescription: string = '';
  @State newActionPriority: number = 3;
  @State @Watch('alertNewActionError') newActionError: string = '';
  private alertNewActionError(): void { alertError(this.newActionError); }
  @State isCreatingAction: boolean = false;
  // 单待办日历提醒：功能开关探测结果 + 当前展开提醒设置的待办 ID（与行动安排页共用 ActionReminderBlock）
  @State reminderAvailable: boolean = false;
  @State actionReminderCardId: string = '';

  // Tab 3: 问忆程专属状态
  @State copilotQuestion: string = '';
  @State isAskingCopilot: boolean = false;
  @State executingToolTitle: string = '';
  @State copilotFeedback: string = '';
  @State expandedCopilotReceiptId: string = '';

  // Tab 4: 成果专属状态
  @State selectedArtifactType: string = 'competition_outline';
  @State isGeneratingArtifact: boolean = false;
  @State @Watch('alertArtifactError') artifactError: string = '';
  private alertArtifactError(): void { alertError(this.artifactError); }
  @State currentArtifact: ArtifactItem | undefined = undefined;
  @State isArtifactReader: boolean = false;
  @State isConfirmingEvidence: boolean = false;
  @State evidenceFeedback: string = '';
  @State @Watch('alertEvidenceError') evidenceError: string = '';
  private alertEvidenceError(): void { alertError(this.evidenceError); }

  private projectService: ProjectService = new ProjectService();
  private interventionService: InterventionService = new InterventionService();
  private memoryService: MemoryService = new MemoryService();
  private actionService: ActionService = new ActionService();
  private reminderService: ReminderService = new ReminderService();
  private artifactService: ArtifactService = new ArtifactService();
  private lifecycleService: MemoryLifecycleService = new MemoryLifecycleService();
  private policyService: InterventionPolicyService = new InterventionPolicyService();
  private stateService: ProjectStateService = new ProjectStateService();
  @State policyDailyBudget: string = '3';
  @State policyQuietStart: string = '23:00';
  @State policyQuietEnd: string = '08:00';
  @State policySuggestions: PolicySuggestion[] = [];
  @State policyRecentSuppressions: string = '';
  @State isSavingPolicy: boolean = false;
  @State policyFeedback: string = '';
  private copilotService: CopilotService = new CopilotService();
  private notificationService: NotificationService = new NotificationService();
  private attachmentService: AttachmentService = new AttachmentService();
  private milestoneService: MilestoneService = new MilestoneService();
  private reentryService: ReentryService = new ReentryService();
  @State reentry: ReentryData | null = null;
  @State focusedActionId: string = '';
  @State checkpointPreview: Episode | null = null;
  @State checkpointBusy: string = '';
  @State checkpointMessage: string = '';
  @State @Watch('alertCheckpointError') checkpointError: string = '';
  private alertCheckpointError(): void { alertError(this.checkpointError); }
  // 已确认检查点的完整详情（含全部版本与来源状态），来源弹层与历史版本都读它
  @State episodeDetail: Episode | null = null;
  @State sourceSheetClaim: EpisodeClaim | null = null;
  @State showSourceSheet: boolean = false;
  @State viewingRevision: number = 0;
  // F3：检查点建议 → 待办 → 日历提醒。同一条链在同一区域推进，不嵌套弹窗。
  private episodeActionService: EpisodeActionService = new EpisodeActionService();
  @State suggestionClaimId: string = '';
  @State suggestionActionId: string = '';
  // 设备日历事件标题要用真实待办标题，不能用提示文案
  @State suggestionActionTitle: string = '';
  @State suggestionCanArrange: boolean = false;
  @State suggestionBlockedReason: string = '';
  @State suggestionEntries: SuggestionEntry[] = [];
  @State suggestionBusy: string = '';
  @State suggestionNotice: string = '';
  @State @Watch('alertSuggestionError') suggestionError: string = '';
  private alertSuggestionError(): void { alertError(this.suggestionError); }
  @State reminderBlockForActionId: string = '';
  private memorySearchSerial: number = 0;

  private sourceOptions: string[] = [
    '随手记录', '论文笔记', '代码报错', '实验记录', '会议纪要', '老师建议', '参赛材料'
  ];

  aboutToDisappear(): void { this.pageVisible = false; this.agentContextGeneration++; SessionStore.offSessionExpired(this.agentContextExpired); }

  /** 权限被服务端拒绝后清掉本项目私有内容、表单草稿与卡片私有快照，旧内容不能继续可操作。 */
  private clearPrivateState(message: string): void {
    this.agentContextGeneration++;
    this.agentContext = null; this.homeMission = null; this.chatMessages = [];
    this.copilotTurnId = ''; this.copilotTurnText = ''; this.copilotQuestion = ''; this.copilotFeedback = '';
    this.expandedCopilotReceiptId = ''; this.agentContextError = message;
    this.project = new ProjectDetail(); this.dashboard = new ProjectDashboard();
    this.interventions = []; this.actions = []; this.artifacts = []; this.attachments = []; this.milestones = [];
    this.memorySearchResults = []; this.reentry = null; this.episodeDetail = null; this.checkpointPreview = null;
    this.requestedCaptureId = ''; this.captureSourceNotice = ''; this.expandedCardId = '';
    this.rawText = ''; this.captureRequestId = ''; this.attachmentFeedback = '';
    this.hasLoadedProjectSnapshot = false;
    void DeviceIdentity.clearCaptureDraft(this.captureDraftScope());
  }

  aboutToAppear(): void {
    SessionStore.onSessionExpired(this.agentContextExpired);
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失，无法定位项目';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    this.transitionTitle = params['title'] ?? '';
    this.focusConversationId = params['conversationId'] ?? '';
    const focusToken = SessionStore.getToken();
    new ConversationService().capabilities().then(v => { if (focusToken === SessionStore.getToken()) this.focusAgentEnabled = v.enabled; }).catch(() => {});
    this.showQuickCopilot = params['openCopilot'] === '1';
    this.materialMissionId = params['materialMissionId'] ?? '';
    this.materialQuestionId = params['materialQuestionId'] ?? '';
    this.materialOwnerId = SessionStore.getUser().id;
    if (this.materialMissionId !== '' && this.materialQuestionId !== '') {
      this.currentTabIndex = 1; this.entrySheetMode = 'capture'; this.showEntrySheet = true;
      this.loadMaterialQuestion();
    }
    this.sourceConversationRun = params['sourceRunId'] ?? '';
    this.requestedArtifactId = params['artifactId'] ?? '';
    if (this.requestedArtifactId !== '') this.currentTabIndex = 4;

    if (this.projectId !== '') WidgetDataService.selectProject(getContext(this), this.projectId).catch(() => {});
    if (params['tab'] === 'memory') {
      this.currentTabIndex = 1;
      this.expandedCardId = params['cardId'] ?? '';
      this.requestedCaptureId = params['captureId'] ?? '';
      if (this.requestedCaptureId !== '') {
        this.materialsMode = 'memory'; this.memorySearchQuery = ''; this.selectedMemoryType = 'all';
        this.captureSourceNotice = '正在核对原记录';
      }
    } else if (params['tab'] === 'actions') {
      this.currentTabIndex = 2;
      this.focusedActionId = params['actionId'] ?? '';
    } else if (params['tab'] === 'artifacts') {
      // 项目空间「下一步」会把成果生成入口深链到成果页
      this.currentTabIndex = 4;
    }
    if (this.projectId === '') {
      this.routeError = '页面参数缺失，项目ID无效';
      return;
    }
    this.restoreCaptureDraft();
    this.loadAllData();
    this.probeReminderAvailability();
  }

  onPageShow(): void {
    this.pageVisible = true;
    this.missionRefreshKey++;
    // NAV-02: 消费可能在热启动时通过通知/卡片写入的参数
    this.openPendingNotification();
    // NAV-01: 页面返回时静默刷新数据，保留用户当前 tab
    if (this.projectId !== '' && !this.isLoading) {
      this.loadAllData(true);
    }
  }

  onPageHide(): void {
    this.pageVisible = false;
  }

  /** 卡片/通知在前台投递时由 handoffSeq 变化驱动消费；只有当前可见页消费，避免重复跳转。 */
  private onHandoffIntent(): void {
    if (!this.pageVisible) {
      return;
    }
    this.openPendingNotification();
  }

  onBackPress(): boolean {
    // NAV-03: 系统返回键优先关闭活动弹层或阅读器，避免直接退出丢失输入
    if (this.completingActionId !== '') {
      this.completingActionId = '';
      this.resultText = '';
      this.dialogError = '';
      return true;
    }
    if (this.showSettingsDialog) {
      this.showSettingsDialog = false;
      return true;
    }
    if (this.showChangeImpactDialog) {
      this.showChangeImpactDialog = false;
      return true;
    }
    if (this.showClaimAuditor) {
      this.showClaimAuditor = false;
      return true;
    }
    if (this.showJudgeRebuttal) {
      this.showJudgeRebuttal = false;
      return true;
    }
    if (this.showAttachmentCorrection) {
      this.showAttachmentCorrection = false;
      return true;
    }
    // 提交中不允许用返回键关掉确认面板：否则用户以为没创建，实际已经写入
    if (this.showActionConfirmSheet) {
      if (!this.isCreatingFocusAction) {
        this.showActionConfirmSheet = false;
        this.actionConfirmError = '';
      }
      return true;
    }
    if (this.showReadinessSheet) {
      this.showReadinessSheet = false;
      return true;
    }
    if (this.showChangeBrief) {
      this.showChangeBrief = false;
      return true;
    }
    if (this.showStateDiffSheet) {
      this.showStateDiffSheet = false;
      return true;
    }
    if (this.showEntrySheet) {
      this.showEntrySheet = false;
      return true;
    }
    if (this.isArtifactReader) {
      this.isArtifactReader = false;
      return true;
    }
    if (this.materialMissionId !== '') { this.returnToMaterialQuestion(); return true; }
    return false;
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
      // 先消费再跳转：同一次意图不会被重复打开。
      this.clearHandoffIntents();
      // 过期定位意图不打开旧问题；用户回到当前原委托重新核对。
      if (route.expired) {
        promptAction.showToast({ message: '原卡片已过期，已回到当前委托；旧问题不会被当成新问题' });
      }
      router.pushUrl({ url: 'pages/MissionDetail', params: {
        projectId: route.projectId, missionId: route.missionId,
        questionId: route.questionId, approvalId: route.approvalId, sourceId: route.sourceId,
        outputId: route.outputId, receiptId: route.receiptId,
        handoffMissionVersion: route.missionVersion, handoffExpired: route.expired ? '1' : ''
      } }); return;
    }
    const targetProjectId = AppStorage.get<string>('notificationProjectId') ?? '';
    const targetInterventionId = AppStorage.get<string>('notificationInterventionId') ?? '';
    if (targetProjectId === '') {
      return;
    }
    AppStorage.setOrCreate<string>('notificationProjectId', '');
    AppStorage.setOrCreate<string>('notificationInterventionId', '');
    if (targetInterventionId !== '') {
      router.pushUrl({
        url: 'pages/InterventionDetail',
        params: { projectId: targetProjectId, interventionId: targetInterventionId }
      });
    } else if (targetProjectId !== this.projectId) {
      // 项目卡片指向另一个项目时回到那个原项目工作台；同项目已在当前页，不重复压栈。
      router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: targetProjectId } });
    }
  }

  private clearHandoffIntents(): void {
    AppStorage.setOrCreate<string>('pendingMissionId', ''); AppStorage.setOrCreate<string>('pendingMissionProjectId', '');
    AppStorage.setOrCreate<string>('pendingQuestionId', ''); AppStorage.setOrCreate<string>('pendingApprovalId', '');
    AppStorage.setOrCreate<string>('pendingSourceId', ''); AppStorage.setOrCreate<string>('pendingOutputId', '');
    AppStorage.setOrCreate<string>('pendingReceiptId', ''); AppStorage.setOrCreate<string>('pendingMissionVersion', '');
    AppStorage.setOrCreate<string>('pendingHandoffExpiresAt', '');
    AppStorage.setOrCreate<string>('notificationProjectId', ''); AppStorage.setOrCreate<string>('notificationInterventionId', '');
  }

  // 上传入口统一为回形针：二级菜单分开“拍照”“相册图片”与“文件（PDF 等）”几条路径
  private async openUploadMenu(): Promise<void> {
    if (this.isUploadingAttachment) {
      return;
    }
    try {
      const menu = await promptAction.showActionMenu({
        title: '上传项目资料',
        buttons: [
          { text: '拍照', color: '#0A7EA4' },
          { text: '从相册选图片', color: '#0A7EA4' },
          { text: '选择文件（PDF）', color: '#0A7EA4' },
          { text: '导入实验指标（CSV / JSON）', color: '#0A7EA4' }
        ]
      });
      if (menu.index === 0) {
        await this.takeAndUploadPhoto();
      } else if (menu.index === 1) {
        await this.pickAndUploadImage();
      } else if (menu.index === 2) {
        await this.pickAndUploadPdf();
      } else if(menu.index === 3) { await this.pickAndUploadMetrics();
      }
    } catch (_e) {
      // 用户取消菜单，无需提示
    }
  }

  // 系统相机拍完写进应用缓存再上传，不申请相机权限；上传结束即删除缓存副本。
  private async takeAndUploadPhoto(): Promise<void> {
    if (this.isUploadingAttachment) return;
    const context = getContext(this) as common.UIAbilityContext;
    const localPath = `${context.cacheDir}/camera-${Date.now()}.jpg`;
    try {
      const file = fileIo.openSync(localPath, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      fileIo.closeSync(file);
      const profile: cameraPicker.PickerProfile = {
        cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK,
        saveUri: fileUri.getUriFromPath(localPath)
      };
      const result = await cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], profile);
      if (result.resultCode === 0 && fileIo.statSync(localPath).size > 0) {
        await this.uploadAttachment(localPath, `project-photo-${Date.now()}.jpg`, 'image/jpeg');
      }
    } catch (error) {
      this.attachmentFeedback = '相机不可用，可以改从相册选图片';
    } finally {
      try { fileIo.unlinkSync(localPath); } catch (_) {}
    }
  }

  private async pickAndUploadImage(): Promise<void> {
    if (this.isUploadingAttachment) return;
    try {
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const result = await new photoAccessHelper.PhotoViewPicker().select(options);
      if (result.photoUris.length > 0) {
        await this.uploadAttachment(result.photoUris[0], `project-image-${Date.now()}.jpg`, 'image/jpeg');
      }
    } catch (error) {
      this.attachmentFeedback = '未选择图片或图片选择器不可用';
    }
  }

  private async pickAndUploadPdf(): Promise<void> {
    if (this.isUploadingAttachment) return;
    try {
      const options = new picker.DocumentSelectOptions();
      options.fileSuffixFilters = ['PDF|.pdf'];
      options.maxSelectNumber = 1;
      const uris = await new picker.DocumentViewPicker().select(options);
      if (uris.length > 0) {
        await this.uploadAttachment(uris[0], pickedFileName(uris[0], `project-document-${Date.now()}.pdf`), 'application/pdf');
      }
    } catch (error) {
      this.attachmentFeedback = '未选择 PDF 或文件选择器不可用';
    }
  }

  private async pickAndUploadMetrics(): Promise<void> {
    if (this.isUploadingAttachment) return;
    try {
      const menu = await promptAction.showActionMenu({ title: '指标副本格式', buttons: [{text:'CSV',color:'#0A7EA4'},{text:'JSON',color:'#0A7EA4'}] });
      const csv = menu.index === 0;
      const options = new picker.DocumentSelectOptions(); options.fileSuffixFilters = [csv ? 'CSV|.csv' : 'JSON|.json']; options.maxSelectNumber = 1;
      const uris = await new picker.DocumentViewPicker().select(options);
      if (uris.length > 0) await this.uploadAttachment(uris[0], 'experiment-' + Date.now().toString() + (csv ? '.csv' : '.json'), csv ? 'text/csv' : 'application/json');
    } catch { this.attachmentFeedback = '未选择指标文件或文件选择器不可用'; }
  }

  private async uploadAttachment(uri: string, fileName: string, mimeType: string): Promise<void> {
    const uploadToken = SessionStore.getToken();
    this.isUploadingAttachment = true;
    this.attachmentRetryId = '';
    this.attachmentFeedbackTone = 'info';
    this.attachmentFeedback = '正在上传并提取内容…';
    let localPath = '';
    try {
      localPath = copyPickedFile((getContext(this) as common.UIAbilityContext).cacheDir, uri);
      const result = await this.attachmentService.upload(this.projectId, localPath, fileName, mimeType);
      if (uploadToken !== SessionStore.getToken()) return;
      this.lastUploadedAttachmentId = result.attachment.id;
      if (this.materialOwnerId === SessionStore.getUser().id) this.materialSourceId = `attachment:${result.attachment.id}`;
      if (result.isDuplicate && result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '该附件已存在，已复用原记录';
        this.attachmentFeedbackTone = 'success';
        this.injectExtractedIntoMeeting(result.attachment.extractedText);
      } else if (result.isDuplicate) {
        this.attachmentFeedback = '该附件已存在，已复用原记录；当前提取未完成';
        this.attachmentFeedbackTone = result.attachment.extractionStatus === 'NEEDS_OCR' ? 'warning' : 'error';
        this.attachmentRetryId = result.attachment.id;
      } else if (result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = result.attachment.type === 'CSV' || result.attachment.type === 'JSON' ? '原指标副本已保存，可在资料页核对；尚未执行实验' : '附件已保存并生成记忆，可在资料页查看原件';
        this.attachmentFeedbackTone = 'success';
        this.injectExtractedIntoMeeting(result.attachment.extractedText);
      } else if (result.attachment.extractionStatus === 'NEEDS_OCR') {
        this.attachmentFeedback = '原件已保存，文字待提取；可在资料页查看原件';
        this.attachmentFeedbackTone = 'warning';
        this.attachmentRetryId = result.attachment.id;
      } else {
        this.attachmentFeedback = `附件已保存；提取失败：${result.attachment.extractionError}`;
        this.attachmentFeedbackTone = 'error';
        this.attachmentRetryId = result.attachment.id;
      }
      await this.loadAllData();
    } catch (error) {
      this.attachmentFeedback = error instanceof ApiError ? error.message : localPath === '' ? '无法读取所选文件，请换一个文件再试' : '附件上传失败';
      this.attachmentFeedbackTone = 'error';
    } finally {
      removePickedCopy(uri, localPath);
      this.isUploadingAttachment = false;
    }
  }

  /** 会议面板打开时，把附件识别文本填入会议草稿；同一文本重复注入不触发 @Watch，属可接受边界 */
  private injectExtractedIntoMeeting(text: string): void {
    if (this.entrySheetMode === 'meeting' && this.showEntrySheet && text !== '') {
      this.meetingInjectedText = text;
    }
  }

  private async retryAttachment(): Promise<void> {
    if (this.attachmentRetryId === '' || this.isRetryingAttachment) return;
    this.isRetryingAttachment = true;
    this.attachmentFeedbackTone = 'info';
    this.attachmentFeedback = '正在重新提取附件…';
    try {
      const result = await this.attachmentService.retry(this.projectId, this.attachmentRetryId);
      if (result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '附件已重新提取并沉淀为项目记忆';
        this.attachmentFeedbackTone = 'success';
        this.attachmentRetryId = '';
      } else if (result.attachment.extractionStatus === 'NEEDS_OCR') {
        this.attachmentFeedback = '当前环境仍需要 OCR，已保留原始附件';
        this.attachmentFeedbackTone = 'warning';
      } else {
        this.attachmentFeedback = `重新提取失败：${result.attachment.extractionError}`;
        this.attachmentFeedbackTone = 'error';
      }
      await this.loadAllData();
    } catch (error) {
      this.attachmentFeedback = error instanceof ApiError ? error.message : '重新提取失败';
      this.attachmentFeedbackTone = 'error';
    } finally {
      this.isRetryingAttachment = false;
    }
  }

  private async loadAllData(silent: boolean = false): Promise<void> {
    if (!silent) {
      this.isLoading = true;
    }
    this.errorMessage = '';
    const contextGeneration = ++this.agentContextGeneration;
    const contextToken = SessionStore.getToken();
    const contextProject = this.projectId;
    this.agentContextError = '';
    let contextDenied = false; let missionDenied = false;
    const contextP = new ProjectAgentContextService().read(contextProject).catch((e: ApiError) => { contextDenied = e instanceof ApiError && [401, 403, 404].includes(e.status); return null; });
    try {
      const detailP = this.projectService.getProjectDetail(this.projectId);
      const listP = this.projectService.listProjects();
      const intervP = this.interventionService.list(this.projectId);
      const actionP = this.actionService.list(this.projectId);
      const artifactP = this.artifactService.list(this.projectId);
      const chatP = this.copilotService.getChatHistory(this.projectId, this.sourceConversationRun);
      const missionP = new MissionService().summary(this.projectId).catch((e: ApiError) => { missionDenied = e instanceof ApiError && [401, 403, 404].includes(e.status); return null; });
      let attachmentError = '';
      const attachmentP = this.attachmentService.list(this.projectId).catch((error: ApiError) => {
        attachmentError = error instanceof ApiError ? error.message : '附件列表加载失败，请重试';
        return this.attachments;
      });
      let milestoneFailed = false;
      const milestoneP = this.milestoneService.list(this.projectId).catch(() => {
        milestoneFailed = true;
        return [] as Milestone[];
      });

      // 项目详情不含时态；与 Web 资料页一致，用 decisions/timeline 投影补齐，读取失败时不显示时态而不是默认“当前有效”。
      const timelineP = this.memoryService.getDecisionTimeline(this.projectId).catch(() => null);
      const res = await Promise.all([detailP, listP, intervP, actionP, artifactP, chatP, milestoneP, attachmentP]);
      const timeline = await timelineP;
      applyTemporalStates(res[0].cards, timeline);
      const pair = timeline !== null ? timeline.items.find((item: TemporalDecisionItem) => item.supersededBy !== null && item.supersededBy.id !== item.card.id) : undefined;
      this.decisionOld = pair !== undefined ? pair.card : null;
      this.decisionNew = pair !== undefined ? pair.supersededBy : null;
      const missionSummary = await missionP;
      const contextReply = await contextP;
      if (contextGeneration !== this.agentContextGeneration || contextToken !== SessionStore.getToken() || contextProject !== this.projectId) return;
      if (contextReply !== null) this.agentContext = contextReply.context;
      else if (contextDenied) this.agentContext = null;
      this.agentContextError = contextReply === null ? (this.agentContext !== null ? `当前显示上次读取 ${this.agentContext.observedAt} 的历史摘要，请刷新。` : '当前下一步暂时无法读取，请刷新重试。') : '';
      if (missionSummary !== null) this.homeMission = missionSummary.enabled ? missionSummary.items[0] ?? null : null;
      else if (missionDenied) this.homeMission = null;
      this.project = res[0];
      if (this.requestedCaptureId !== '') {
        this.expandedCardId = captureSourceCardId(this.requestedCaptureId, this.project.cards);
        this.captureSourceNotice = this.expandedCardId !== ''
          ? '原始记录；查看不改变委托当前的使用许可。'
          : '当前项目返回的记忆中未找到这条原记录；未替换为其他记录，也不表示原记录已删除。请返回委托核对来源。';
      }
      this.dashboard = this.findDashboard(res[1]);
      // R2 再入场：检查点/风险/下一安排聚合；失败保留上次缓存，不推送假空态
      const reentryP = this.reentryService.getReentry(this.projectId).catch(() => null);
      const reentryData = await reentryP;
      if (reentryData !== null) {
        this.reentry = reentryData;
        WidgetDataService.updateWidgetWithReentry(getContext(this), reentryData).catch(() => {});
        const episodeId = reentryData.episode !== null ? reentryData.episode.episodeId : null;
        if (episodeId !== null) {
          this.episodeDetail = await this.reentryService.getEpisode(this.projectId, episodeId)
            .then((result) => result.episode)
            .catch(() => null);
        } else {
          this.episodeDetail = null;
        }
      } else if (this.project) {
        WidgetDataService.updateWidgetWithProjectDetail(getContext(this), this.project, this.dashboard).catch(() => {});
      }
      this.interventions = res[2];
      this.actions = res[3];
      this.artifacts = res[4];
      this.chatMessages = res[5];
      if (!milestoneFailed || this.milestones.length === 0) {
        this.milestones = res[6];
      }
      this.milestoneLoadError = milestoneFailed ? '里程碑阶段数据同步异常，保留展示历史缓存' : '';
      this.attachments = res[7];
      this.attachmentLoadError = attachmentError;

      // 提取未成功附件中的第一个作为活跃重试 ID（若尚未指定）
      const failedAtt = this.attachments.find((att: Attachment) => att.extractionStatus === 'FAILED' || att.extractionStatus === 'NEEDS_OCR');
      if (failedAtt && this.attachmentRetryId === '') {
        this.attachmentRetryId = failedAtt.id;
      }

      this.updateCurrentArtifact();
      if (this.requestedArtifactId !== '') {
        const fixed = this.artifacts.find((item: ArtifactItem) => item.id === this.requestedArtifactId);
        this.currentArtifact = fixed;
        if (fixed !== undefined) { this.selectedArtifactType = fixed.artifactType; this.isArtifactReader = true; this.currentTabIndex = 4; }
        else { this.isArtifactReader = false; this.artifactError = '原成果版本当前不可访问，请核对后重新选择；不会自动替换为最新成果。'; }
        this.requestedArtifactId = '';
      }
      if (this.memorySearchQuery.trim() !== '') {
        await this.searchMemory();
      }

      // S07: 对高风险介入派发/更新本地系统通知
      for (const interv of this.interventions) {
        if (!interv.isSimulated && interv.severity >= 4 && interv.status === 'OPEN') {
          this.notificationService.publishInterventionNotification(interv, this.projectId);
        }
      }
      this.hasLoadedProjectSnapshot = true;
    } catch (e) {
      if (e instanceof ApiError && [403, 404].includes(e.status)) {
        // 服务端明确拒绝该项目：清掉项目私有内容与卡片私有快照，旧内容不能继续可操作。
        this.clearPrivateState(e.message);
        this.errorMessage = e.message;
        WidgetDataService.clearMission(getContext(this), true).catch(() => {});
      } else if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '无法同步项目数据，请检查网络';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private findDashboard(projects: Project[]): ProjectDashboard {
    for (const item of projects) {
      if (item.id === this.projectId) {
        return item.dashboard;
      }
    }
    return new ProjectDashboard();
  }

  // ---- R2 阶段检查点（60 秒再入口） ----

  private genRequestId(): string {
    return `pm-${Date.now()}-${Math.floor(Math.random() * 100000000)}`;
  }

  private async previewCheckpoint(): Promise<void> {
    if (this.checkpointBusy !== '') {
      return;
    }
    this.checkpointBusy = 'preview';
    this.checkpointError = '';
    this.checkpointMessage = '';
    try {
      const body = new EpisodePreviewBody();
      const lastWindowEnd = (this.reentry !== null && this.reentry.episode !== null && this.reentry.episode.confirmedAt !== null)
        ? this.reentry.episode.confirmedAt
        : new Date(Date.now() - 7 * 86400000).toISOString();
      body.windowStart = lastWindowEnd;
      body.windowEnd = new Date().toISOString();
      const result = await this.reentryService.previewEpisode(this.projectId, body);
      this.checkpointPreview = result.episode;
    } catch (e) {
      this.checkpointError = e instanceof ApiError ? e.message : '生成检查点预览失败';
    } finally {
      this.checkpointBusy = '';
    }
  }

  private async refreshCheckpoint(): Promise<void> {
    if (this.checkpointBusy !== '' || this.reentry === null || this.reentry.episode.episodeId === null) {
      return;
    }
    this.checkpointBusy = 'refresh';
    this.checkpointError = '';
    this.checkpointMessage = '';
    try {
      const result = await this.reentryService.refreshEpisode(this.projectId, this.reentry.episode.episodeId!);
      this.checkpointPreview = result.episode;
    } catch (e) {
      this.checkpointError = e instanceof ApiError ? e.message : '刷新检查点失败';
    } finally {
      this.checkpointBusy = '';
    }
  }

  private async confirmCheckpoint(): Promise<void> {
    const preview = this.checkpointPreview;
    if (this.checkpointBusy !== '' || preview === null || preview.revisions.length === 0) {
      return;
    }
    this.checkpointBusy = 'confirm';
    this.checkpointError = '';
    try {
      const revision: EpisodeRevision = preview.revisions[preview.revisions.length - 1];
      const body = new EpisodeConfirmBody();
      body.revision = revision.revision;
      body.requestId = this.genRequestId();
      body.expectedSourceHash = revision.sourceHash;
      await this.reentryService.confirmEpisode(this.projectId, preview.id, body);
      this.checkpointPreview = null;
      this.checkpointMessage = '阶段检查点已确认';
      const reentryData = await this.reentryService.getReentry(this.projectId);
      this.reentry = reentryData;
      WidgetDataService.updateWidgetWithReentry(getContext(this), reentryData).catch(() => {});
      this.viewingRevision = 0;
      if (reentryData.episode.episodeId !== null) {
        this.episodeDetail = await this.reentryService.getEpisode(this.projectId, reentryData.episode.episodeId!)
          .then((result) => result.episode)
          .catch(() => null);
      }
    } catch (e) {
      this.checkpointError = e instanceof ApiError ? e.message : '确认检查点失败';
    } finally {
      this.checkpointBusy = '';
    }
  }

  private publishedRevisions(): EpisodeRevision[] {
    const detail = this.episodeDetail;
    if (detail === null) {
      return [];
    }
    return detail.revisions.filter((item: EpisodeRevision) => item.status === 'PUBLISHED');
  }

  /** 当前版本 = 已发布修订中版本号最大者；历史版本只读 */
  private currentRevision(): EpisodeRevision | null {
    const published = this.publishedRevisions();
    if (published.length === 0) {
      return null;
    }
    let best = published[0];
    for (let i = 1; i < published.length; i++) {
      if (published[i].revision > best.revision) {
        best = published[i];
      }
    }
    return best;
  }

  private viewingRevisionData(): EpisodeRevision | null {
    const detail = this.episodeDetail;
    if (detail === null) {
      return null;
    }
    if (this.viewingRevision > 0) {
      const found = detail.revisions.filter((item: EpisodeRevision) => item.revision === this.viewingRevision);
      if (found.length > 0) {
        return found[0];
      }
    }
    return this.currentRevision();
  }

  private claimSourceRefs(claim: EpisodeClaim, revision: EpisodeRevision): EpisodeSourceRef[] {
    return revision.sourceRefs.filter((ref: EpisodeSourceRef) => claim.sourceRefIds.indexOf(ref.refId) >= 0);
  }

  private sourceStateLabel(refId: string): string {
    const detail = this.episodeDetail;
    if (detail === null || detail.freshness === undefined) {
      return '冻结版本';
    }
    const states = detail.freshness.sources.filter((item) => item.refId === refId);
    if (states.length === 0) {
      return '冻结版本';
    }
    return states[0].displayReason;
  }

  private isClaimAffected(claimId: string): boolean {
    const detail = this.episodeDetail;
    if (detail === null || detail.freshness === undefined) {
      return false;
    }
    return detail.freshness.affectedClaims.some((item) => item.claimId === claimId);
  }

  private viewingClaims(): EpisodeClaim[] {
    const revision = this.viewingRevisionData();
    if (revision === null) {
      return [];
    }
    return revision.claims;
  }

  private claimKindLabel(kind: string): string {
    if (kind === 'FACT') return '事实';
    if (kind === 'RULE') return '系统判断';
    return '建议';
  }

  private sourceKindLabel(kind: string): string {
    if (kind === 'CARD') return '记录';
    if (kind === 'RELATION') return '关系';
    if (kind === 'ATTACHMENT_REVISION') return '附件修订';
    if (kind === 'ACTION_RESULT') return '行动结果';
    return '状态快照';
  }

  private formatObservedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private openOriginalRecord(ref: EpisodeSourceRef): void {
    // 原始记录在「记忆」页：切页并提示定位，不伪造已打开
    this.showSourceSheet = false;
    this.currentTabIndex = 1;
    promptAction.showToast({ message: `已切到记忆列表，请查找《${ref.title}》` });
  }

  private episodeStatusText(status: string | null): string {
    if (status === 'PUBLISHED') return '结论有效';
    if (status === 'PARTIALLY_STALE') return '部分失效';
    if (status === 'STALE') return '已失效';
    return '草稿';
  }

  private previewSections(): EpisodeSummarySection[] {
    const preview = this.checkpointPreview;
    if (preview === null || preview.revisions.length === 0) {
      return [];
    }
    const revision: EpisodeRevision = preview.revisions[preview.revisions.length - 1];
    return revision.summary !== undefined ? revision.summary.sections : [];
  }

  private cancelCheckpointPreview(): void {
    this.checkpointPreview = null;
    this.checkpointMessage = '';
    this.checkpointError = '';
  }

  /**
   * 从检查点建议创建待办。
   * 检查点只提供建议：用户点这个按钮才算确认；幂等键由服务端用 revisionId + claimId 生成，
   * 重复点击只会得到同一条待办，已存在时直接复用并在这里继续下一步。
   */
  private async createSuggestionTodo(claim: EpisodeClaim, mode: string, targetActionId: string): Promise<void> {
    const episodeId = this.reentry !== null && this.reentry.episode.episodeId !== null ? this.reentry.episode.episodeId : '';
    if (episodeId === '' || this.suggestionBusy !== '') {
      return;
    }
    this.suggestionBusy = claim.claimId;
    this.suggestionError = '';
    this.suggestionNotice = '';
    try {
      const outcome: EpisodeActionOutcome = await this.episodeActionService.createFromSuggestion(
        this.projectId, episodeId, claim.claimId, mode, targetActionId);
      this.suggestionClaimId = claim.claimId;
      this.suggestionActionId = outcome.actionId;
      this.suggestionActionTitle = outcome.title;
      this.suggestionCanArrange = outcome.availability.canArrangeReminder;
      this.suggestionBlockedReason = outcome.availability.blockedReason !== null ? outcome.availability.blockedReason : '';
      this.suggestionEntries = outcome.availability.entries;
      if (mode === 'UNBLOCK') {
        this.suggestionNotice = `已创建解阻待办「${outcome.title}」。先完成它，原来的待办才有开始条件。`;
      } else if (outcome.reused) {
        this.suggestionNotice = `已存在对应待办「${outcome.title}」，直接使用它，没有重复创建。`;
      } else {
        this.suggestionNotice = `已加入待办「${outcome.title}」。${outcome.availability.canArrangeReminder ? '可以在下面直接安排提醒。' : '这条待办当前还有前置事项。'}`;
      }
      this.reminderBlockForActionId = outcome.availability.canArrangeReminder ? outcome.actionId : '';
    } catch (e) {
      this.suggestionError = e instanceof ApiError ? e.message : '加入待办失败';
    } finally {
      this.suggestionBusy = '';
    }
  }

  /** 检查点建议的下一步操作；受阻时给出解阻入口，不让用户停在死路 */
  @Builder
  SuggestionActions(claim: EpisodeClaim) {
    Column() {
      Row() {
        Button(this.suggestionBusy === claim.claimId ? '处理中…' : '加入待办').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .height(PMButtonSize.HEIGHT_MD)
          .borderRadius(PMRadius.SM)
          .enabled(this.suggestionBusy === '')
          .onClick(() => {
            this.createSuggestionTodo(claim, 'SUGGESTION', '');
          })
        Button('查看建议依据').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.BRAND)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .border({ width: 1, color: PMColors.BORDER })
          .height(PMButtonSize.HEIGHT_MD)
          .borderRadius(PMRadius.SM)
          .margin({ left: PMSpacing.SM })
          .onClick(() => {
            this.sourceSheetClaim = claim;
            this.showSourceSheet = true;
          })
        if (this.suggestionClaimId === claim.claimId && this.suggestionCanArrange && this.reminderAvailable) {
          Button(this.reminderBlockForActionId === this.suggestionActionId ? '收起提醒设置' : '安排日历提醒').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.EVIDENCE_LIGHT)
            .height(PMButtonSize.HEIGHT_MD)
            .borderRadius(PMRadius.SM)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              this.reminderBlockForActionId = this.reminderBlockForActionId === this.suggestionActionId ? '' : this.suggestionActionId;
            })
        }
        if (this.suggestionClaimId === claim.claimId && !this.suggestionCanArrange && this.suggestionBlockedReason !== '') {
          Button('先处理阻塞').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .backgroundColor(PMColors.WARNING_LIGHT)
            .height(PMButtonSize.HEIGHT_MD)
            .borderRadius(PMRadius.SM)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              this.suggestionNotice = this.suggestionBlockedReason;
            })
        }
      }
      .width('100%')
      .margin({ top: 6 })

      if (this.suggestionClaimId === claim.claimId && !this.suggestionCanArrange && this.suggestionBlockedReason !== '') {
        Column() {
          Text(this.suggestionBlockedReason)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .lineHeight(18)
          ForEach(this.suggestionEntries, (entry: SuggestionEntry) => {
            Text(`· ${entry.label}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .margin({ top: 2 })
              .onClick(() => {
                if (entry.kind === 'CREATE_UNBLOCK_ACTION') {
                  this.createSuggestionTodo(claim, 'UNBLOCK', entry.targetActionId);
                } else {
                  this.currentTabIndex = 2;
                  promptAction.showToast({ message: `请到「待办」里${entry.label}` });
                }
              })
          }, (entry: SuggestionEntry) => `${entry.kind}-${entry.targetActionId}`)
          Text('受阻的待办不会进入时间安排，也不会被写入设备日历。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: 2 })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.WARNING_LIGHT)
        .borderRadius(PMRadius.SM)
        .margin({ top: PMSpacing.SM })
      }

      if (this.suggestionClaimId === claim.claimId && this.suggestionActionId !== '') {
        Text(this.suggestionNotice)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.SUCCESS)
          .lineHeight(18)
          .margin({ top: 4 })
      }
      if (this.suggestionClaimId === claim.claimId && this.suggestionError !== '') {
        Text(this.suggestionError)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
          .lineHeight(18)
          .margin({ top: 4 })
      }
      if (this.reminderBlockForActionId !== '' && this.reminderBlockForActionId === this.suggestionActionId
        && this.suggestionClaimId === claim.claimId) {
        ActionReminderBlock({
          projectId: this.projectId,
          actionId: this.suggestionActionId,
          actionTitle: this.suggestionActionTitle,
          reminderEnabled: this.reminderAvailable,
          onClose: () => {
            this.reminderBlockForActionId = '';
          },
          onChanged: () => {
            this.loadAllData(true);
          }
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 项目体检：只读入口卡，放在「状态与变化」下方 */
  @Builder
  ProjectHealthCardView() {
    HealthEntryCard({
      projectId: this.projectId,
      active: true,
      onGoTarget: (kind: string, objectId: string, suggestedAction: string) => {
        if (kind === 'action') {
          this.currentTabIndex = 2;
          this.actionStatusFilter = 'ALL';
          if (objectId !== '') {
            this.focusedActionId = objectId;
          }
        } else if (kind === 'reminder') {
          this.currentTabIndex = 2;
          if (objectId !== '') {
            this.focusedActionId = objectId;
            const matchingIntervention = this.interventions.find((i: Intervention) => i.id === objectId);
            if (matchingIntervention !== undefined) {
              router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: this.projectId, interventionId: objectId } });
              return;
            }
          }
        } else if (kind === 'card' || kind === 'memory') {
          this.currentTabIndex = 1;
          this.materialsMode = 'memory';
          this.selectedMemoryType = 'all';
          this.memorySearchQuery = '';
          if (objectId !== '') {
            this.expandedCardId = objectId;
          }
        } else if (kind === 'attachment') {
          this.currentTabIndex = 1;
          this.materialsMode = 'attachments';
          if (objectId !== '') {
            this.openAttachment(objectId);
          }
        } else if (kind === 'deliverable') {
          this.currentTabIndex = 4;
          if (objectId !== '') {
            this.selectedArtifactType = objectId;
            this.updateCurrentArtifact();
          }
        } else if (kind === 'episode') {
          this.currentTabIndex = 0;
          this.showProjectStatus = true;
          this.showEvolution = true;
          promptAction.showToast({ message: '已展开阶段检查点' });
          return;
        } else {
          this.currentTabIndex = 0;
        }
        promptAction.showToast({ message: `去「${HealthSeverityCopy.targetLabel(kind)}」：${suggestedAction}` });
      }
    })
  }

  @Builder
  EpisodeCheckpointCardView() {
    Column() {
      Row() {
        Column() {
          Text('阶段检查点')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text('整理阶段进展')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (this.checkpointBusy !== '') {
          LoadingProgress()
            .width(18)
            .height(18)
            .color(PMColors.BRAND)
        } else if (this.checkpointPreview === null) {
          Text(this.reentry !== null && this.reentry.episode.episodeId !== null ? '重新整理' : '整理最近 7 天')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.MD)
            .onClick(() => {
              this.previewCheckpoint();
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.checkpointMessage !== '') {
        Text(this.checkpointMessage)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.SUCCESS)
          .margin({ top: 6 })
      }
      if (this.checkpointError !== '') {
        Text(this.checkpointError)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.RISK)
          .margin({ top: 6 })
      }

      if (this.checkpointPreview !== null) {
        this.CheckpointPreviewBody()
      } else if (this.reentry !== null && this.reentry.episode !== null && this.reentry.episode.episodeId !== null) {
        this.CheckpointPublishedBody()
      } else {
        Text('隔几天回到项目时，先用 60 秒看清上次做到哪、哪些结论仍有效。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: 8 })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER })
    .margin({ top: PMSpacing.MD })
    .bindSheet(this.showSourceSheet, this.SourceSheetBody(), {
      height: 560,
      showClose: true,
      onDisappear: () => {
        this.showSourceSheet = false;
      }
    })
  }

  @Builder
  CheckpointPreviewBody() {
    Text('预览未生效：确认后才成为当前阶段判断。每条事实句都可以打开当时的来源。')
      .fontSize(PMFontSize.SECONDARY)
      .fontColor(PMColors.INK_TERTIARY)
      .margin({ top: 8 })
    ForEach(this.previewSections(), (section: EpisodeSummarySection) => {
      Text(`${section.section}: ${section.text}`)
        .fontSize(PMFontSize.SECONDARY)
        .fontColor(PMColors.INK_PRIMARY)
        .margin({ top: 6 })
    }, (section: EpisodeSummarySection) => section.section)
    ForEach(this.previewClaims(), (claim: EpisodeClaim) => {
      Column() {
        Row() {
          Text(this.claimKindLabel(claim.kind))
            .fontSize(10)
            .fontColor(PMColors.BRAND)
            .padding({ left: 6, right: 6, top: 1, bottom: 1 })
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
          Text(claim.text)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .layoutWeight(1)
            .margin({ left: 6 })
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)

        if (claim.kind === 'FACT' && claim.sourceRefIds.length > 0) {
          Text(`查看 ${claim.sourceRefIds.length} 个来源`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .margin({ top: 4 })
            .onClick(() => {
              this.sourceSheetClaim = claim;
              this.showSourceSheet = true;
            })
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(PMSpacing.SM)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .margin({ top: 6 })
    }, (claim: EpisodeClaim) => claim.claimId)
    Row({ space: 8 }) {
      Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .buttonStyle(ButtonStyleMode.NORMAL)
        .fontSize(PMFontSize.SECONDARY)
        .onClick(() => {
          this.cancelCheckpointPreview();
        }).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
      Button(this.checkpointBusy === 'confirm' ? '确认中…' : '确认这一版').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .buttonStyle(ButtonStyleMode.EMPHASIZED)
        .fontSize(PMFontSize.SECONDARY)
        .enabled(this.checkpointBusy === '')
        .onClick(() => {
          this.confirmCheckpoint();
        }).fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND).constraintSize({ minHeight: 44 })
    }
    .width('100%')
    .justifyContent(FlexAlign.End)
    .margin({ top: 10 })
  }

  @Builder
  CheckpointPublishedBody() {
    Row() {
      Text(`V${this.reentry!.episode.revision ?? 1} · ${this.reentry!.episode.title ?? '阶段检查点'}`)
        .fontSize(PMFontSize.SECONDARY)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(this.episodeStatusText(this.reentry!.episode.status))
        .fontSize(PMFontSize.CAPTION)
        .fontColor(this.reentry!.episode.status === 'PUBLISHED' ? PMColors.SUCCESS : PMColors.WARNING)
        .padding({ left: 8, right: 8, top: 2, bottom: 2 })
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
    }
    .width('100%')
    .margin({ top: 8 })
    .alignItems(VerticalAlign.Center)

    Text(`确认于 ${this.formatObservedAt(this.reentry!.episode.confirmedAt ?? '')} · 来源 ${this.reentry!.episode.sourceCount} 个`)
      .fontSize(PMFontSize.CAPTION)
      .fontColor(PMColors.INK_TERTIARY)
      .margin({ top: 4 })

    if (this.reentry!.episode.keyConclusion !== null && this.reentry!.episode.keyConclusion !== '') {
      Column() {
        Text(this.reentry!.episode.isHistorical ? '历史结论（来源已变化，供参考）：' : '当前结论：')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.reentry!.episode.isHistorical ? PMColors.WARNING : PMColors.BRAND)
          .fontWeight(FontWeight.Bold)
        Text(this.reentry!.episode.keyConclusion)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_PRIMARY)
          .fontWeight(FontWeight.Medium)
          .margin({ top: 2 })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(PMSpacing.SM)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .margin({ top: 6 })
    }

    if (this.reentry!.episode.changesSince.length > 0) {
      Text('检查点之后的变化：')
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ top: 6 })
      ForEach(this.reentry!.episode.changesSince, (change: string, index: number) => {
        Text(`· ${change}`)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: 2 })
      }, (change: string, index: number) => `change-${index}`)
    } else {
      Text('检查点之后暂无已确认变化')
        .fontSize(PMFontSize.SECONDARY)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ top: 6 })
    }

    if (this.reentry!.risk.text !== null && this.reentry!.risk.text !== '') {
      Row() {
        Text(this.reentry!.risk.kind === 'BLOCKED' ? '待办受阻' : this.reentry!.risk.kind === 'UNKNOWN' ? '信息不足' : '需关注风险')
          .fontSize(10)
          .fontColor(this.reentry!.risk.kind === 'BLOCKED' ? PMColors.RISK : PMColors.WARNING)
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .backgroundColor(this.reentry!.risk.kind === 'BLOCKED' ? PMColors.SURFACE_SUBTLE : PMColors.BRAND_LIGHT)
          .borderRadius(PMRadius.XS)
        Text(this.reentry!.risk.text)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .layoutWeight(1)
          .margin({ left: 6 })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding(PMSpacing.SM)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .margin({ top: 6 })
      .onClick(() => {
        if (this.reentry!.risk.kind === 'BLOCKED') {
          this.focusedActionId = this.reentry!.risk.actionId ?? '';
          this.currentTabIndex = 2;
        }
      })
    }

    if (this.reentry!.primaryMessage !== '') {
      Text(this.reentry!.primaryMessage)
        .fontSize(PMFontSize.SECONDARY)
        .fontColor(PMColors.BRAND)
        .fontWeight(FontWeight.Medium)
        .margin({ top: 8 })
    }

    ForEach(this.viewingClaims(), (claim: EpisodeClaim) => {
      Column() {
        Row() {
          Text(this.claimKindLabel(claim.kind))
            .fontSize(10)
            .fontColor(PMColors.BRAND)
            .padding({ left: 6, right: 6, top: 1, bottom: 1 })
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
          Text(claim.text)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(this.isClaimAffected(claim.claimId) ? PMColors.WARNING : PMColors.INK_SECONDARY)
            .layoutWeight(1)
            .margin({ left: 6 })
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)

        if (claim.kind === 'FACT' && claim.sourceRefIds.length > 0) {
          Text(`查看 ${claim.sourceRefIds.length} 个来源`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .margin({ top: 4 })
            .onClick(() => {
              this.sourceSheetClaim = claim;
              this.showSourceSheet = true;
            })
        }
        if (this.isClaimAffected(claim.claimId)) {
          Text('该结论的来源已变化，可生成新版本；旧版本仍可查看')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .margin({ top: 2 })
        }
        // 建议不是已执行的事实：只有用户点确认才会创建待办
        if (claim.kind === 'SUGGESTION') {
          this.SuggestionActions(claim)
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(PMSpacing.SM)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .margin({ top: 6 })
    }, (claim: EpisodeClaim) => claim.claimId)

    if (this.publishedRevisions().length > 1) {
      Text(`历史版本（${this.publishedRevisions().length}，只读）`)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ top: 10 })
      ForEach(this.publishedRevisions(), (revision: EpisodeRevision) => {
        Row() {
          Text(`V${revision.revision}`)
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
          Text(revision.confirmedAt !== null ? `确认于 ${this.formatObservedAt(revision.confirmedAt!)}` : '未记录确认时间')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .layoutWeight(1)
            .margin({ left: 8 })
          Text(this.viewingRevision === revision.revision ? '正在查看' : '查看')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .onClick(() => {
              this.viewingRevision = this.viewingRevision === revision.revision ? 0 : revision.revision;
            })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ top: 4, bottom: 4 })
      }, (revision: EpisodeRevision) => `rev-${revision.revision}`)
    }

    Row({ space: 8 }) {
      Button('继续推进').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .buttonStyle(ButtonStyleMode.EMPHASIZED)
        .fontSize(PMFontSize.SECONDARY)
        .onClick(() => {
          this.currentTabIndex = 2;
        }).fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND).constraintSize({ minHeight: 44 })
      Button(this.checkpointBusy === 'refresh' ? '整理中…' : '根据最新来源重新整理').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .buttonStyle(ButtonStyleMode.NORMAL)
        .fontSize(PMFontSize.SECONDARY)
        .enabled(this.checkpointBusy === '')
        .onClick(() => {
          this.refreshCheckpoint();
        }).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
    }
    .width('100%')
    .justifyContent(FlexAlign.End)
    .margin({ top: 10 })
  }

  private sheetRevision(): EpisodeRevision | null {
    const preview = this.checkpointPreview;
    if (preview !== null && preview.revisions.length > 0) {
      return preview.revisions[preview.revisions.length - 1];
    }
    return this.viewingRevisionData();
  }

  private sheetSourceRefs(): EpisodeSourceRef[] {
    const claim = this.sourceSheetClaim;
    const revision = this.sheetRevision();
    if (claim === null || revision === null) {
      return [];
    }
    return this.claimSourceRefs(claim, revision);
  }

  private previewClaims(): EpisodeClaim[] {
    const preview = this.checkpointPreview;
    if (preview === null || preview.revisions.length === 0) {
      return [];
    }
    return preview.revisions[preview.revisions.length - 1].claims;
  }

  private isSourceDeleted(ref: EpisodeSourceRef): boolean {
    return this.sourceStateLabel(ref.refId) === '来源记录已被删除';
  }

  @Builder
  SourceSheetBody() {
    Column() {
      Text('来源详情')
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
      if (this.sourceSheetClaim !== null) {
        Text(this.sourceSheetClaim!.text)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: 6 })
      }
      ForEach(this.sheetSourceRefs(), (ref: EpisodeSourceRef) => {
        Column() {
          Row() {
            Text(`${this.sourceKindLabel(ref.kind)}${ref.revisionIndex !== null ? ` #${ref.revisionIndex}` : ''}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
            Text(this.sourceStateLabel(ref.refId))
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .layoutWeight(1)
              .textAlign(TextAlign.End)
          }
          .width('100%')

          Text(ref.title !== '' ? ref.title : ref.entityId)
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: 4 })
          Text(`观察于 ${this.formatObservedAt(ref.observedAt)}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: 2 })
          Text(`冻结摘要：${ref.summary !== '' ? ref.summary : '（该来源没有文本摘要）'}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: 4 })
          if (this.isSourceDeleted(ref)) {
            Text('原来源已删除，以上为生成时冻结的信息')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.WARNING)
              .margin({ top: 4 })
          } else if (ref.kind === 'CARD' || ref.kind === 'ACTION_RESULT') {
            Text('打开原记录')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .margin({ top: 6 })
              .onClick(() => {
                this.openOriginalRecord(ref);
              })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ top: 8 })
      }, (ref: EpisodeSourceRef) => ref.refId)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(PMSpacing.LG)
  }

  private getTopOpenIntervention(): Intervention | undefined {
    return this.interventions.filter((item: Intervention) => !item.isSimulated &&
      (item.status === 'OPEN' || (item.status === 'SNOOZED' && item.snoozedUntil !== null &&
        item.snoozedUntil !== undefined && Date.parse(item.snoozedUntil) <= Date.now())))
      .sort((a: Intervention, b: Intervention) => b.severity - a.severity)[0];
  }

  private homeFocusKind(): string {
    return selectProjectFocus(this.homeMission?.status ?? '', this.getTopOpenIntervention()?.severity ?? 0,
      this.dashboard.deadline.rank, this.getNextActionId() !== '');
  }
  private homeDeadlineConflict(): boolean {
    const reminder = this.getTopOpenIntervention();
    if (reminder === undefined) return false;
    return deadlineReminderConflict(reminder.title, reminder.content, this.project.deadline ?? '', Date.now());
  }
  private homeFocusTitle(): string {
    if (this.agentContext !== null) return this.agentContext.nextStep.title;
    if (this.agentContextError !== '') return '项目摘要暂不可用';
    const kind = this.homeFocusKind();
    if (kind === 'reminder') return this.homeDeadlineConflict() ? '核对提醒与当前截止日' : this.getTopOpenIntervention()?.title ?? '查看提醒';
    if (kind === 'mission') return this.homeMission?.attention ?? '查看长期委托进展';
    if (kind === 'deadline') return this.dashboard.deadline.label;
    if (kind === 'action') return this.getNextActionTitle();
    return this.project.cards.length === 0 ? '先留下一条真实的项目资料' : '记录新进展，或继续一个长期目标';
  }
  private homeFocusDetail(): string {
    if (this.agentContext !== null) return this.agentContext.nextStep.reason;
    if (this.agentContextError !== '') return this.agentContextError;
    const kind = this.homeFocusKind();
    if (kind === 'reminder') return this.homeDeadlineConflict() ? `历史提醒为「${this.getTopOpenIntervention()?.title ?? ''}」，当前截止日为 ${(this.project.deadline ?? '').substring(0, 10)}。请查看原提醒依据。` : this.getTopOpenIntervention()?.content ?? '';
    if (kind === 'mission') return this.homeMission?.activity ?? this.homeMission?.goal ?? '已有步骤与草稿会保留。';
    if (kind === 'deadline') return '核对剩余行动和项目目标，决定本次先推进什么。';
    if (kind === 'action') return this.getNextActionDescription();
    return '记录进展、实验结果或会议要求，让后续判断有据可查。';
  }
  private homeFocusAction(): string {
    if (this.agentContext !== null) return this.agentContext.nextStep.actionLabel;
    if (this.agentContextError !== '') return '重新读取项目';
    const kind = this.homeFocusKind();
    if (kind === 'reminder') return '查看提醒依据';
    if (kind === 'mission') return this.homeMission?.status === 'WAITING_INPUT' ? '补充信息' : this.homeMission?.status === 'WAITING_APPROVAL' ? '审阅行动提案' : '查看原委托';
    if (kind === 'deadline' || kind === 'action') return '查看行动';
    return this.project.cards.length === 0 ? '记录第一条资料' : '记录项目进展';
  }
  /** 打开原委托：带上当前原问题/提案/输出修订与版本线索；详情读回后仍以服务端当前对象为准。 */
  private openMission(missionId: string, questionId: string, approvalId: string, revision: string, version: string): void {
    router.pushUrl({ url: 'pages/MissionDetail', params: {
      projectId: this.projectId, missionId, questionId, approvalId, revision,
      handoffMissionVersion: version
    } });
  }

  /** 焦点卡状态标签：停止请求在途/额度等待/UNKNOWN 用事实措辞，不写成已停止或已完成。 */
  private homeMissionStatusLabel(): string {
    const state = this.homeMission?.workState;
    if (state !== undefined) {
      if (state.reasonCode === 'STOP_REQUESTED_IN_FLIGHT') { return '停止请求待结算'; }
      if (state.reasonCode === 'DAILY_BUDGET_WAITING') { return '等待额度恢复'; }
      return workStateLabel(state);
    }
    return missionStatusLabel(this.homeMission?.status ?? '');
  }
  private openHomeFocus(): void {
    if (this.agentContextError !== '') { this.loadAllData(true); return; }
    if (this.agentContext !== null) {
      const target = this.agentContext.nextStep.entityRef;
      if (target.kind === 'MISSION') {
        this.openMission(target.id, target.questionId ?? '', target.approvalId ?? '',
          target.outputRevision !== null ? String(target.outputRevision) : '',
          target.version !== null ? String(target.version) : '');
      }
      else if (target.kind === 'INTERVENTION') router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: this.projectId, interventionId: target.id } });
      else if (target.kind === 'ACTION') { this.currentTabIndex = 2; this.focusedActionId = target.id; }
      else if (this.agentContext.freshness === 'UNAVAILABLE') this.loadAllData(true);
      else this.openCaptureEntry();
      return;
    }
    const kind = this.homeFocusKind();
    if (kind === 'reminder') router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: this.projectId, interventionId: this.getTopOpenIntervention()!.id } });
    else if (kind === 'mission' && this.homeMission !== null) {
      const mission = this.homeMission;
      const state = mission.workState;
      this.openMission(mission.id,
        state !== undefined ? (state.exactQuestionRef ?? '') : '',
        state !== undefined ? (state.exactApprovalRef ?? '') : '',
        '', state !== undefined ? String(state.originalRef.version) : '');
    }
    else if (kind === 'deadline' || kind === 'action') this.currentTabIndex = 2;
    else this.openCaptureEntry();
  }

  @Builder
  private HomeFocusView() {
    Column({ space: 10 }) {
      Row() {
        Text(this.agentContext !== null ? (this.agentContext.nextStep.workState !== undefined ? '当前下一步 · ' + workStateLabel(this.agentContext.nextStep.workState) : '当前下一步') : this.homeFocusKind() === 'mission' ? this.homeMissionStatusLabel() : '当前先处理')
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.WARNING)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text(this.homeFocusTitle())
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(28)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })

      Text(this.homeFocusDetail())
        .fontSize(14)
        .lineHeight(22)
        .fontColor(PMColors.INK_SECONDARY)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })

      if (this.agentContext !== null && this.agentContext.goal !== '') {
        Text(`目标：${this.agentContext.goal}`)
          .fontSize(12)
          .fontColor(PMColors.INK_TERTIARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

      Row() {
        PMButton({
          label: this.homeFocusAction(),
          fit: true,
          onAction: (): void => { this.openHomeFocus(); }
        })
      }.width('100%').justifyContent(FlexAlign.End)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(18)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(18)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .shadow({ radius: 16, color: 'rgba(28, 46, 44, 0.06)', offsetX: 0, offsetY: 6 })
  }

  /** 准备项逐项入口：与「当前状态」卡里的缺口按钮同一套跳转规则 */
  private openReadinessItem(key: string): void {
    this.showReadinessSheet = false;
    if (key === 'competition_outline' || key === 'defense_ppt' || key === 'readme') {
      this.selectedArtifactType = key;
      this.updateCurrentArtifact();
      this.currentTabIndex = 4;
    } else if (key === 'requirement') {
      this.openCaptureEntry('参赛材料');
    } else if (key === 'experiment') {
      this.openCaptureEntry('实验记录');
    } else if (key === 'closed_loop') {
      this.currentTabIndex = 2;
    } else {
      this.currentTabIndex = 1;
    }
  }

  /**
   * 本阶段重点的依据行：只报可核对的条数，不下「来源已校对」这类结论。
   * 来源存在只说明可追溯，不等于支持结论；没有来源时如实写「依据待查看」。
   */
  private focusEvidenceLine(intervention: Intervention): string {
    const evidence = intervention.evidence;
    const factCount = evidence.facts !== undefined && evidence.facts !== null ? evidence.facts.length : 0;
    const cardCount = evidence.cardIds !== undefined && evidence.cardIds !== null ? evidence.cardIds.length : 0;
    const line = TextFormatters.evidenceCountLine(factCount, cardCount);
    if (factCount + cardCount === 0 && evidence.rule !== '') {
      return '依据待查看 · 由规则发现，未附具体事实';
    }
    return line;
  }

  /**
   * 打开候选行动确认面板。
   * 没有候选行动时不弹确认框，而是去提醒详情看依据，避免一个必然失败的确认按钮。
   */
  private openActionConfirm(intervention: Intervention): void {
    if (intervention.proposedActions.length === 0) {
      router.pushUrl({
        url: 'pages/InterventionDetail',
        params: { projectId: this.projectId, interventionId: intervention.id }
      });
      return;
    }
    this.actionConfirmIntervention = intervention;
    this.actionConfirmIndex = 0;
    this.actionConfirmError = '';
    this.showActionConfirmSheet = true;
  }

  /** 用户在确认面板里点「确认创建」之后才写入；写入结果以服务端返回为准 */
  private async confirmCreateFocusAction(): Promise<void> {
    if (this.isCreatingFocusAction) {
      return;
    }
    this.isCreatingFocusAction = true;
    this.actionConfirmError = '';
    try {
      await this.interventionService.accept(this.projectId, this.actionConfirmIntervention.id, this.actionConfirmIndex);
      await this.notificationService.cancelInterventionNotification(this.actionConfirmIntervention.id, this.projectId);
      this.showActionConfirmSheet = false;
      promptAction.showToast({ message: '已加入待办；创建不等于已排程或已完成' });
      await this.loadAllData(true);
    } catch (e) {
      this.actionConfirmError = e instanceof ApiError ? e.message : '创建行动失败，请稍后重试';
    } finally {
      this.isCreatingFocusAction = false;
    }
  }

  private getNextActionId(): string {
    for (const action of this.actions) {
      if (!action.isSimulated && (action.status === 'TODO' || action.status === 'DOING')) {
        return action.id;
      }
    }
    return '';
  }

  private getNextActionStatus(): string {
    for (const action of this.actions) {
      if (!action.isSimulated && (action.status === 'TODO' || action.status === 'DOING')) {
        return action.status;
      }
    }
    return '';
  }

  private getNextActionTitle(): string {
    for (const action of this.actions) {
      if (!action.isSimulated && (action.status === 'TODO' || action.status === 'DOING')) {
        return TextFormatters.readableText(action.title, '下一项行动标题无法读取');
      }
    }
    return '暂无待推进的行动';
  }

  private getNextActionDescription(): string {
    for (const action of this.actions) {
      if (!action.isSimulated && (action.status === 'TODO' || action.status === 'DOING')) {
        if (action.description !== undefined && action.description !== null && action.description !== '') {
          return TextFormatters.readableText(action.description, '行动说明无法读取，请打开待办查看详情。');
        }
        return action.status === 'DOING' ? '继续推进并在完成后留下事实回执。' : '今天建议开始这项行动，并保留完成事实。';
      }
    }
    return '当前没有待推进的行动，可以先记录新的项目碎片。';
  }

  private startNextAction(): void {
    const actionId = this.getNextActionId();
    if (actionId !== '') {
      this.startAction(actionId);
    }
  }

  private async searchMemory(): Promise<void> {
    const query = this.memorySearchQuery.trim();
    const type = this.selectedMemoryType;
    if (query === '') {
      this.memorySearchSerial += 1;
      this.memorySearchResults = [];
      this.memorySearchError = '';
      this.isSearchingMemory = false;
      return;
    }

    const serial = this.memorySearchSerial + 1;
    this.memorySearchSerial = serial;
    this.isSearchingMemory = true;
    this.memorySearchError = '';
    try {
      const results = await this.memoryService.searchCards(this.projectId, query, type);
      if (serial === this.memorySearchSerial) {
        this.memorySearchResults = results;
      }
    } catch (error) {
      if (serial === this.memorySearchSerial) {
        this.memorySearchResults = [];
        this.memorySearchError = error instanceof ApiError ? error.message : '记忆检索失败，请稍后重试';
      }
    } finally {
      if (serial === this.memorySearchSerial) {
        this.isSearchingMemory = false;
      }
    }
  }

  private onMemoryQueryChange(value: string): void {
    this.memorySearchQuery = value;
    this.searchMemory();
  }

  private selectMemoryType(type: string): void {
    this.selectedMemoryType = type;
    if (this.memorySearchQuery.trim() !== '') {
      this.searchMemory();
    }
  }

  private parseExpectedEvidence(value: string): string[] {
    try {
      const parsed = JSON.parse(value) as string[];
      if (!Array.isArray(parsed)) return [];
      const result: string[] = [];
      for (const item of parsed) {
        if (typeof item === 'string' && item.trim() !== '') result.push(item.trim());
      }
      return result;
    } catch (_error) {
      return [];
    }
  }

  private isEvidenceConfirmed(deliverable: Deliverable, evidenceType: string): boolean {
    return this.getConfirmedEvidence(deliverable, evidenceType) !== undefined;
  }

  private getConfirmedEvidence(deliverable: Deliverable, evidenceType: string): DeliverableEvidence | undefined {
    for (const evidence of deliverable.evidences) {
      if (evidence.evidenceType === evidenceType && evidence.confirmed) return evidence;
    }
    return undefined;
  }

  private getEvidenceCandidates(evidenceType: string): KnowledgeCard[] {
    const candidates: KnowledgeCard[] = [];
    for (const card of this.project.cards) {
      const attachmentType = card.attachment?.type ?? '';
      const attachmentMatch = (evidenceType === 'pdf_attachment' && attachmentType === 'PDF') ||
        (evidenceType === 'image_attachment' && attachmentType === 'IMAGE');
      if (card.type === evidenceType || attachmentMatch) candidates.push(card);
      if (candidates.length >= 5) break;
    }
    return candidates;
  }

  private async confirmEvidence(deliverableId: string, evidenceType: string, cardId: string): Promise<void> {
    if (this.isConfirmingEvidence) return;
    this.isConfirmingEvidence = true;
    this.evidenceFeedback = '';
    this.evidenceError = '';
    try {
      await this.milestoneService.confirmEvidence(this.projectId, deliverableId, evidenceType, cardId, '', true);
      this.evidenceFeedback = '证据已关联并确认';
      await this.loadAllData();
    } catch (error) {
      this.evidenceError = error instanceof ApiError ? error.message : '证据确认失败，请稍后重试';
    } finally {
      this.isConfirmingEvidence = false;
    }
  }

  private async revokeEvidence(deliverableId: string, evidenceType: string, cardId: string, attachmentId: string): Promise<void> {
    if (this.isConfirmingEvidence) return;
    this.isConfirmingEvidence = true;
    this.evidenceFeedback = '';
    this.evidenceError = '';
    try {
      await this.milestoneService.confirmEvidence(this.projectId, deliverableId, evidenceType, cardId, attachmentId, false);
      this.evidenceFeedback = '已撤销证据关联';
      await this.loadAllData();
    } catch (error) {
      this.evidenceError = error instanceof ApiError ? error.message : '撤销证据失败，请稍后重试';
    } finally {
      this.isConfirmingEvidence = false;
    }
  }

  private async retrySpecificAttachment(attachmentId: string): Promise<void> {
    if (attachmentId === '' || this.isRetryingAttachment) return;
    this.attachmentRetryId = attachmentId;
    this.isRetryingAttachment = true;
    this.attachmentFeedbackTone = 'info';
    this.attachmentFeedback = '正在重新提取附件…';
    try {
      const result = await this.attachmentService.retry(this.projectId, attachmentId);
      if (result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '附件已重新提取并沉淀为项目记忆';
        this.attachmentFeedbackTone = 'success';
        this.attachmentRetryId = '';
      } else if (result.attachment.extractionStatus === 'NEEDS_OCR') {
        this.attachmentFeedback = '当前环境仍需要 OCR，已保留原始附件';
        this.attachmentFeedbackTone = 'warning';
      } else {
        this.attachmentFeedback = `重新提取失败：${result.attachment.extractionError}`;
        this.attachmentFeedbackTone = 'error';
      }
      await this.loadAllData();
    } catch (error) {
      this.attachmentFeedback = error instanceof ApiError ? error.message : '重新提取失败';
      this.attachmentFeedbackTone = 'error';
    } finally {
      this.isRetryingAttachment = false;
    }
  }

  private updateCurrentArtifact(): void {
    let found: ArtifactItem | undefined = undefined;
    for (const item of this.artifacts) {
      if (item.artifactType === this.selectedArtifactType) {
        found = item;
        break;
      }
    }
    this.currentArtifact = found;
  }

  private newCaptureRequestId(): string {
    return `harmony-capture-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }

  private async loadMaterialQuestion(): Promise<void> {
    const token = SessionStore.getToken();
    try {
      const m = await new MissionService().detail(this.materialMissionId);
      if (token !== SessionStore.getToken() || m.projectId !== this.projectId) return;
      this.materialQuestion = m.question?.id === this.materialQuestionId ? m.question.payloadJson.question : '原问题已变化，返回原委托核对后再继续';
    } catch (_e) { if (token === SessionStore.getToken()) this.materialQuestion = '暂时无法读取原问题；资料仍可保存，返回后核对'; }
  }
  private captureDraftScope(): string {
    return this.materialMissionId === '' ? this.projectId : `${this.projectId}:${this.materialOwnerId}:${this.materialMissionId}:${this.materialQuestionId}`;
  }
  private returnToMaterialQuestion(): void {
    if (this.materialOwnerId !== SessionStore.getUser().id || !SessionStore.isTokenValid()) return;
    this.showEntrySheet = false;
    router.back({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: this.materialMissionId, questionId: this.materialQuestionId, sourceId: this.materialSourceId } });
  }
  @Builder private MaterialReturn() {
    if (this.materialMissionId !== '') {
      Column({ space: PMSpacing.XS }) {
        Text(this.materialQuestion || '为原问题补充资料').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
        PMButton({ label: this.materialSourceId === '' ? '返回原问题' : '回到原问题，核对这份资料 →', secondary: true, onAction: (): void => { this.returnToMaterialQuestion(); } })
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
    }
  }

  private async restoreCaptureDraft(): Promise<void> {
    const draft = await DeviceIdentity.loadCaptureDraft(this.captureDraftScope());
    if (draft !== undefined && this.rawText === '') {
      this.rawText = draft.rawText;
      this.sourceType = draft.sourceType;
      this.captureRequestId = draft.requestId;
    }
  }

  private async persistCaptureDraft(): Promise<void> {
    if (this.rawText.trim() === '') return;
    if (this.captureRequestId === '') {
      this.captureRequestId = this.newCaptureRequestId();
    }
    await DeviceIdentity.saveCaptureDraft(this.captureDraftScope(), this.rawText, this.sourceType, this.captureRequestId);
  }

  private openCaptureEntry(preferredSource?: string): void {
    if (preferredSource !== undefined && preferredSource !== '' && preferredSource !== this.sourceType) {
      this.sourceType = preferredSource;
      this.captureRequestId = '';
    }
    this.captureError = '';
    this.entrySheetMode = 'capture';
    this.showEntrySheet = true;
  }

  private openMeetingEntry(): void {
    this.entrySheetMode = 'meeting';
    this.showEntrySheet = true;
  }

  // --- 工作台操作 ---
  private async evaluate(scenario?: string, clearSim: boolean = false): Promise<void> {
    if (this.isEvaluating) {
      return;
    }
    this.isEvaluating = true;
    this.evaluateError = '';
    try {
      await this.projectService.evaluateProject(this.projectId, scenario, clearSim);
      promptAction.showToast({ message: scenario ? '已载入演示情境' : clearSim ? '已清除模拟' : '规则评估完成' });
      await this.loadAllData();
    } catch (e) {
      if (e instanceof ApiError) {
        this.evaluateError = e.message;
      } else {
        this.evaluateError = '评估发生异常';
      }
    } finally {
      this.isEvaluating = false;
    }
  }

  private async capture(): Promise<void> {
    if (this.isCapturing) {
      return;
    }
    const trimmed = this.rawText.trim();
    if (trimmed.length < 5) {
      this.captureError = '请至少输入 5 个字';
      return;
    }
    this.isCapturing = true;
    this.captureError = '';
    if (this.captureRequestId === '') {
      this.captureRequestId = this.newCaptureRequestId();
    }
    await DeviceIdentity.saveCaptureDraft(this.captureDraftScope(), trimmed, this.sourceType, this.captureRequestId);
    const captureToken = SessionStore.getToken();
    try {
      const saved = await this.memoryService.capture(this.projectId, trimmed, this.sourceType, this.captureRequestId);
      if (captureToken !== SessionStore.getToken()) return;
      if (this.materialOwnerId === SessionStore.getUser().id && saved.captureId !== '') this.materialSourceId = `capture:${saved.captureId}`;
      this.rawText = '';
      this.captureRequestId = '';
      await DeviceIdentity.clearCaptureDraft(this.captureDraftScope());
      promptAction.showToast({ message: this.memoryService.captureModeLabel(saved) });
      await this.loadAllData();
    } catch (e) {
      if (e instanceof ApiError) {
        this.captureError = e.message;
      } else {
        this.captureError = '记录保存失败';
      }
    } finally {
      this.isCapturing = false;
    }
  }

  // --- 提醒策略（B1）：预算/静默/降频建议，全部可解释、可恢复默认 ---
  private async loadPolicy(): Promise<void> {
    try {
      const res: PolicyResponse = await this.policyService.get(this.projectId);
      this.policyDailyBudget = `${res.policy.dailyBudget}`;
      this.policyQuietStart = this.minuteToLabel(res.policy.quietStartMinute);
      this.policyQuietEnd = this.minuteToLabel(res.policy.quietEndMinute);
      this.policySuggestions = res.suggestions;
      const suppressed = res.recentDecisions.filter((d) => d.decision === 'SUPPRESS').slice(0, 3);
      this.policyRecentSuppressions = suppressed.length === 0 ? '' :
        `最近被抑制：${suppressed.map((d) => `${d.reasonCode}（${d.createdAt.substring(0, 10)}）`).join('、')}`;
    } catch (_e) {
      this.policyFeedback = '提醒策略加载失败';
    }
  }

  private minuteToLabel(minute: number): string {
    const hh = Math.floor(minute / 60);
    const mm = minute % 60;
    return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
  }

  private labelToMinute(label: string): number {
    const parts = label.split(':');
    if (parts.length !== 2) {
      return -1;
    }
    const hh = Number.parseInt(parts[0], 10);
    const mm = Number.parseInt(parts[1], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) {
      return -1;
    }
    return hh * 60 + mm;
  }

  private async savePolicy(): Promise<void> {
    if (this.isSavingPolicy) {
      return;
    }
    const budget = Number.parseInt(this.policyDailyBudget, 10);
    const start = this.labelToMinute(this.policyQuietStart.trim());
    const end = this.labelToMinute(this.policyQuietEnd.trim());
    if (Number.isNaN(budget) || budget < 0 || budget > 50) {
      this.policyFeedback = '每日预算必须是 0–50 的整数';
      return;
    }
    if (start < 0 || end < 0) {
      this.policyFeedback = '静默时段格式须为 HH:mm';
      return;
    }
    this.isSavingPolicy = true;
    this.policyFeedback = '';
    try {
      const body = new PolicyUpdateBody();
      body.dailyBudget = budget;
      body.quietStartMinute = start;
      body.quietEndMinute = end;
      await this.policyService.update(this.projectId, body);
      this.policyFeedback = '提醒策略已保存';
    } catch (e) {
      this.policyFeedback = e instanceof ApiError ? e.message : '策略保存失败';
    } finally {
      this.isSavingPolicy = false;
    }
  }

  private async decideSuggestion(action: string, triggerType: string): Promise<void> {
    try {
      await this.policyService.decideSuggestion(this.projectId, action, triggerType);
      promptAction.showToast({ message: action === 'CONFIRM' ? '已降频：该类提醒每天至多 1 次' : '已忽略该建议' });
      await this.loadPolicy();
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '操作失败' });
    }
  }

  private async restorePolicyDefaults(): Promise<void> {
    try {
      await this.policyService.restoreDefaults(this.projectId);
    } catch (_e) {
      // 恢复默认失败时仍保留旧策略
      this.policyFeedback = '恢复默认失败';
      return;
    }
    try {
      const body = new PolicyUpdateBody();
      body.dailyBudget = 3;
      body.quietStartMinute = 1380;
      body.quietEndMinute = 480;
      body.timezone = 'Asia/Shanghai';
      await this.policyService.update(this.projectId, body);
      this.policyFeedback = '已恢复默认策略（预算 3 次/天，静默 23:00–08:00）';
      await this.loadPolicy();
    } catch (e) {
      this.policyFeedback = e instanceof ApiError ? e.message : '恢复默认失败';
    }
  }

  private cockpitAddMenuItems(): MenuElement[] {
    const items: MenuElement[] = [];
    items.push({
      value: '记录进展',
      action: (): void => {
        this.openCaptureEntry();
      }
    });
    items.push({
      value: '整理会议',
      action: (): void => {
        this.openMeetingEntry();
      }
    });
    return items;
  }

  private pickQuietStart(): void {
    const parts = this.policyQuietStart.split(':');
    const d = new Date();
    if (parts.length === 2) {
      const hh = Number.parseInt(parts[0], 10);
      const mm = Number.parseInt(parts[1], 10);
      if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
        d.setHours(hh, mm, 0, 0);
      }
    }
    TimePickerDialog.show({
      selected: d,
      useMilitaryTime: true,
      onAccept: (time: TimePickerResult) => {
        const hh = time.hour < 10 ? `0${time.hour}` : `${time.hour}`;
        const mm = time.minute < 10 ? `0${time.minute}` : `${time.minute}`;
        this.policyQuietStart = `${hh}:${mm}`;
      }
    });
  }

  private pickQuietEnd(): void {
    const parts = this.policyQuietEnd.split(':');
    const d = new Date();
    if (parts.length === 2) {
      const hh = Number.parseInt(parts[0], 10);
      const mm = Number.parseInt(parts[1], 10);
      if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
        d.setHours(hh, mm, 0, 0);
      }
    }
    TimePickerDialog.show({
      selected: d,
      useMilitaryTime: true,
      onAccept: (time: TimePickerResult) => {
        const hh = time.hour < 10 ? `0${time.hour}` : `${time.hour}`;
        const mm = time.minute < 10 ? `0${time.minute}` : `${time.minute}`;
        this.policyQuietEnd = `${hh}:${mm}`;
      }
    });
  }

  private openSettingsDialog(): void {
    this.policyFeedback = '';
    this.settingsTabIndex = 0;
    this.showSuppressionDetail = false;
    this.loadPolicy();
    this.editTitle = this.project.title;
    this.editGoal = this.project.goal;
    this.editDescription = this.project.description;
    this.editDeadline = this.project.deadline !== undefined && this.project.deadline !== null && this.project.deadline.length >= 10 ?
      this.project.deadline.substring(0, 10) : '';
    this.showSettingsDialog = true;
  }

  private pickEditDeadline(): void {
    DatePickerDialog.show({
      start: new Date(2000, 0, 1),
      end: new Date(2100, 11, 31),
      selected: DateOnly.selected(this.editDeadline),
      onDateAccept: (value: Date) => {
        this.editDeadline = DateOnly.format(value);
      },
    });
  }

  /**
   * 项目详情内可发现的管理入口：归档不依赖列表页长按手势。
   * 归档只让项目离开主列表，记忆、行动与成果保持有效；恢复在项目空间「管理与恢复」，
   * 删除仍留在列表长按菜单（需二次确认）。
   */
  private async archiveCurrentProject(): Promise<void> {
    if (this.isArchivingProject || this.projectId === '') {
      return;
    }
    this.isArchivingProject = true;
    try {
      await this.projectService.archiveProject(this.projectId);
      this.showSettingsDialog = false;
      promptAction.showToast({ message: '已归档，保留全部记忆与成果，可在项目空间恢复' });
      router.back();
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '归档失败，请稍后重试' });
    } finally {
      this.isArchivingProject = false;
    }
  }

  private async saveSettings(): Promise<void> {
    if (this.isSavingSettings) {
      return;
    }
    const deadlineVal = this.editDeadline.trim();
    if (deadlineVal !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(deadlineVal)) {
      promptAction.showToast({ message: '截止日期格式须为 YYYY-MM-DD' });
      return;
    }
    this.isSavingSettings = true;
    try {
      const input = new ProjectUpdateInput();
      input.title = this.editTitle.trim();
      input.goal = this.editGoal.trim();
      input.description = this.editDescription.trim();
      input.deadline = deadlineVal !== '' ? deadlineVal : null;
      await this.projectService.updateProject(this.projectId, input);
      this.showSettingsDialog = false;
      promptAction.showToast({ message: '项目信息已更新' });
      await this.loadAllData();
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '更新失败' });
    } finally {
      this.isSavingSettings = false;
    }
  }

  // --- 待办操作 ---
  private openCreateAction(): void {
    this.newActionTitle = '';
    this.newActionDescription = '';
    this.newActionPriority = 3;
    this.newActionError = '';
    this.showCreateAction = true;
  }

  private async createActionManually(): Promise<void> {
    if (this.isCreatingAction) {
      return;
    }
    const title = this.newActionTitle.trim();
    if (title.length < 2) {
      this.newActionError = '请用至少 2 个字写清要做什么';
      return;
    }
    this.isCreatingAction = true;
    this.newActionError = '';
    try {
      const input = new ActionCreateInput();
      input.title = title;
      const description = this.newActionDescription.trim();
      if (description !== '') {
        input.description = description;
      }
      input.priority = this.newActionPriority;
      await this.actionService.create(this.projectId, input);
      this.showCreateAction = false;
      promptAction.showToast({ message: '已加入待办' });
      await this.loadAllData();
    } catch (e) {
      this.newActionError = e instanceof ApiError ? e.message : '暂时无法添加，请稍后重试';
    } finally {
      this.isCreatingAction = false;
    }
  }

  private async startAction(actionId: string): Promise<void> {
    if (this.startingActionId !== '') {
      return;
    }
    this.startingActionId = actionId;
    try {
      await this.actionService.updateStatus(this.projectId, actionId, 'DOING');
      promptAction.showToast({ message: '已标记为进行中' });
      await this.loadAllData();
    } catch (e) {
      promptAction.showToast({ message: '操作失败' });
    } finally {
      this.startingActionId = '';
    }
  }

  private beginEditAction(action: ActionItem): void {
    this.confirmCancelActionId = '';
    this.actionEditError = '';
    this.editingActionId = action.id;
    this.editActionTitle = action.title;
    this.editActionDescription = action.description ?? '';
  }

  private async saveActionEdit(actionId: string): Promise<void> {
    const title = this.editActionTitle.trim();
    if (title.length < 2) {
      this.actionEditError = '行动标题至少 2 个字';
      return;
    }
    if (this.actionEditBusy) return;
    this.actionEditBusy = true;
    this.actionEditError = '';
    try {
      await this.actionService.updateContent(this.projectId, actionId, title, this.editActionDescription.trim());
      this.editingActionId = '';
      promptAction.showToast({ message: '行动已更新' });
      await this.loadAllData(true);
    } catch (e) {
      this.actionEditError = e instanceof ApiError ? e.message : '保存失败，请稍后重试；已填写的内容仍保留';
    } finally {
      this.actionEditBusy = false;
    }
  }

  /** 取消只改变行动状态，原标题、来源提醒与历史记录都保留。 */
  private async cancelAction(actionId: string): Promise<void> {
    if (this.actionEditBusy) return;
    this.actionEditBusy = true;
    this.actionEditError = '';
    try {
      await this.actionService.updateStatus(this.projectId, actionId, 'CANCELLED');
      this.confirmCancelActionId = '';
      this.selectedActionId = '';
      promptAction.showToast({ message: '已取消这项行动' });
      await this.loadAllData(true);
    } catch (e) {
      this.actionEditError = e instanceof ApiError ? e.message : '取消失败，请稍后重试';
    } finally {
      this.actionEditBusy = false;
    }
  }

  private async probeReminderAvailability(): Promise<void> {
    try {
      this.reminderAvailable = await this.reminderService.isAvailable(this.projectId);
    } catch {
      this.reminderAvailable = false;
    }
  }

  private openCompleteDialog(actionId: string): void {
    this.completingActionId = actionId;
    this.resultText = '';
    this.dialogError = '';
  }

  private async showMeetingDiff(fromId: string, toId: string): Promise<void> {
    try {
      const response = await this.stateService.diff(this.projectId, fromId, toId);
      this.stateDiffForSheet = response.diff;
      this.showEntrySheet = false;
      this.showStateDiffSheet = true;
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '会后对比获取失败' });
    }
  }

  // --- 变化简报（C1）：以快照 Diff 为唯一事实输入，服务端确定性模板 ---
  private async openChangeBrief(fromId: string, toId: string): Promise<void> {
    try {
      const response = await this.stateService.getBrief(this.projectId, fromId, toId);
      this.briefForSheet = response.brief;
      this.showChangeBrief = true;
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '简报生成失败，请稍后重试' });
    }
  }

  // --- 记忆生命周期：人工确认来源 / 归档 / 恢复 ---
  private async confirmCardSource(cardId: string): Promise<void> {
    if (this.lifecycleActionCardId !== '') {
      return;
    }
    this.lifecycleActionCardId = cardId;
    try {
      await this.lifecycleService.confirmFact(this.projectId, cardId);
      promptAction.showToast({ message: '已记录人工确认来源（来源声明，非事实证明）' });
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '确认失败，请稍后重试' });
    } finally {
      this.lifecycleActionCardId = '';
    }
  }

  private async archiveMemoryCard(cardId: string): Promise<void> {
    if (this.lifecycleActionCardId !== '') {
      return;
    }
    this.lifecycleActionCardId = cardId;
    try {
      await this.lifecycleService.archive(this.projectId, cardId);
      promptAction.showToast({ message: '已归档（可在检索中恢复）' });
      await this.loadAllData();
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '归档失败，请稍后重试' });
    } finally {
      this.lifecycleActionCardId = '';
    }
  }

  private async submitComplete(): Promise<void> {
    if (this.isSubmittingAction) {
      return;
    }
    const trimmed = this.resultText.trim();
    if (trimmed.length < 5) {
      this.dialogError = '完成事实记录至少需要 5 个字';
      return;
    }
    this.isSubmittingAction = true;
    this.dialogError = '';
    try {
      const completed = await this.actionService.complete(this.projectId, this.completingActionId, trimmed);
      this.completingActionId = '';
      this.resultText = '';
      promptAction.showToast({ message: completed.status === 'DONE' && !completed.isSimulated && completed.resultCardId !== undefined && completed.resultCardId !== null && completed.resultCardId !== '' ?
        '已完成并写入项目记忆' : '行动已提交，结果记忆关联待核对' });
      await this.loadAllData();
    } catch (e) {
      if (e instanceof ApiError) {
        this.dialogError = e.message;
      } else {
        this.dialogError = '提交失败';
      }
    } finally {
      this.isSubmittingAction = false;
    }
  }

  // --- 问忆程操作 ---
  private requestedArtifactId: string = '';
  private sourceConversationRun: string = '';
  private copilotTurnId: string = '';
  private copilotTurnText: string = '';
  private async sendCopilotMessage(): Promise<void> {
    if (this.isAskingCopilot) {
      return;
    }
    const text = this.copilotQuestion.trim();
    if (text === '') {
      return;
    }
    const token = SessionStore.getToken(); const project = this.projectId;
    if (this.copilotTurnText !== text || this.copilotTurnId === '') { this.copilotTurnText = text; this.copilotTurnId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    this.isAskingCopilot = true;
    this.copilotFeedback = '';

    const userMsg = new AgentMessage();
    userMsg.role = 'USER';
    userMsg.content = text;


    try {
      const res = await this.copilotService.askQuestion(project, text, this.copilotTurnId);
      if (token !== SessionStore.getToken() || project !== this.projectId) return;
      this.copilotQuestion = ''; this.copilotTurnId = ''; this.copilotTurnText = '';
      this.chatMessages.push(userMsg);
      const assistantMsg = new AgentMessage();
      assistantMsg.role = 'ASSISTANT';
      assistantMsg.content = res.message;
      assistantMsg.citations = res.citations;
      assistantMsg.proposedActions = res.proposedActions;
      assistantMsg.runId = res.runId;
      assistantMsg.trustReceipt = res.trustReceipt;
      assistantMsg.continuationSuggestion = res.continuationSuggestion;
      this.chatMessages.push(assistantMsg);
      if (res.fallback) {
        this.copilotFeedback = '（已从项目记忆检索并整理回复）';
      }
    } catch (e) {
      if (token !== SessionStore.getToken() || project !== this.projectId) return;
      this.copilotFeedback = e instanceof ApiError ? e.message : '问答结果尚未确认，保留问题后可重试';
      if (e instanceof ApiError && e.code === 'COPILOT_TURN_FAILED') this.copilotTurnId = '';
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { this.chatMessages = []; this.copilotQuestion = ''; this.copilotTurnId = ''; this.copilotTurnText = ''; }
    } finally {
      this.isAskingCopilot = false;
    }
  }

  private async confirmCopilotTool(action: ProposedAction, sourceRunId: string | undefined): Promise<void> {
    this.executingToolTitle = action.title;
    try {
      if (action.kind === 'generate_artifact') {
        const payload = new ArtifactGeneratePayload();
        payload.artifactType = action.artifactType ?? 'competition_outline';
        await this.copilotService.confirmTool(this.projectId, action.kind, payload, sourceRunId);
      } else {
        const payload = new ActionCreatePayload();
        payload.title = action.title;
        payload.description = action.description;
        payload.priority = action.priority;
        await this.copilotService.confirmTool(this.projectId, action.kind, payload, sourceRunId);
      }
      promptAction.showToast({ message: action.kind === 'create_action' ? '已创建待办行动' : '已生成成果草稿' });
      await this.loadAllData();
    } catch (e) {
      promptAction.showToast({ message: '执行操作失败' });
    } finally {
      this.executingToolTitle = '';
    }
  }

  // --- 成果操作 ---
  private async generateArtifact(): Promise<void> {
    if (this.isGeneratingArtifact) {
      return;
    }
    this.isGeneratingArtifact = true;
    this.artifactError = '';
    try {
      const generated = await this.artifactService.generate(this.projectId, this.selectedArtifactType);
      promptAction.showToast({ message: '新成果已生成' });
      await this.loadAllData();
      this.currentArtifact = generated;
    } catch (e) {
      if (e instanceof ApiError) {
        this.artifactError = e.message;
      } else {
        this.artifactError = '成果生成失败，请检查网络';
      }
    } finally {
      this.isGeneratingArtifact = false;
    }
  }

  private copyArtifactContent(): void {
    if (this.currentArtifact === undefined || this.currentArtifact.content === '') {
      return;
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    const readableContent = TextFormatters.readableMarkdown(this.currentArtifact.content);
    const pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, readableContent);
    systemPasteboard.setData(pasteData);
    promptAction.showToast({ message: '已复制正文' });
  }

  private async copyArtifactWithProvenance(): Promise<void> {
    if (this.currentArtifact === undefined || this.currentArtifact.content === '') {
      return;
    }
    if (this.isExportingProvenance) {
      return;
    }
    this.isExportingProvenance = true;
    try {
      // 与证据透视镜同口径：导出前实时拉取审计结果，失败即报错，不退回全项目卡片凑数
      const audit = await this.artifactService.audit(this.projectId, this.currentArtifact.id);
      const fullDoc = ExportFormatter.formatWithProvenance(
        this.project.title !== '' ? this.project.title : '项目档案',
        this.selectedArtifactType,
        this.currentArtifact.content,
        audit
      );
      const systemPasteboard = pasteboard.getSystemPasteboard();
      const pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, fullDoc);
      systemPasteboard.setData(pasteData);
      promptAction.showToast({ message: '已复制带证据审计的全文' });
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '证据审计获取失败，未导出' });
    } finally {
      this.isExportingProvenance = false;
    }
  }

  // ----------------------------------------------------
  // 顶部导航栏 Header (长项目名称自然两行排版，无英文副标)
  // ----------------------------------------------------
  @Builder
  private TopHeader() {
    PMAppBar({
      title: this.project.title !== '' ? TextFormatters.readableText(this.project.title, '项目名称无法读取') : (this.transitionTitle !== '' ? this.transitionTitle : '项目档案'),
      titleShareId: this.projectId !== '' && this.transitionTitle !== '' ? `project-title-${this.projectId}` : '',
      backLabel: '项目',
      backDescription: '返回项目列表',
      showRepository: true,
      onRepositoryAction: () => {
        router.pushUrl({ url: 'pages/MemoryTimeline', params: { projectId: this.projectId, openRepo: '1' } });
      },
      showRightIcon: true,
      rightIconLabel: '更多项目设置',
      rightIconDescription: '编辑项目名称、目标和简介',
      onRightAction: () => {
        this.openSettingsDialog();
      }
    })
  }

  // ----------------------------------------------------
  // 底部导航栏 Bar (5 项：工作台 / 记忆 / 待办 / 问忆程 / 成果)
  // ----------------------------------------------------
  @Builder
  private TabBarItemIcon(index: number) {
    if (index === 0) {
      DashboardIcon({ isSelected: this.currentTabIndex === 0, iconSize: 20 })
    } else if (index === 1) {
      MemoryIcon({ isSelected: this.currentTabIndex === 1, iconSize: 20 })
    } else if (index === 2) {
      TaskIcon({ isSelected: this.currentTabIndex === 2, iconSize: 20 })
    } else if (index === 3) {
      CopilotIcon({ isSelected: this.currentTabIndex === 3, iconSize: 20 })
    } else {
      ArtifactIcon({ isSelected: this.currentTabIndex === 4, iconSize: 20 })
    }
  }

  @Builder
  private TabBarItem(index: number, label: string) {
    Column() {
      Row() { this.TabBarItemIcon(index) }
        .width(36).height(30).justifyContent(FlexAlign.Center).borderRadius(10)
        .backgroundColor(this.currentTabIndex === index ? PMColors.BRAND_LIGHT : Color.Transparent)
      Text(label)
        .fontSize(PMFontSize.BOTTOM_NAV)
        .fontFamily(PMFontFamily.SANS)
        .fontWeight(this.currentTabIndex === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.currentTabIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
        .margin({ top: 3 })
    }
    .layoutWeight(1)
    .height(58)
    .justifyContent(FlexAlign.Center)
    .clickEffect(PMInteraction.PRESS_EFFECT)
    .onClick(() => {
      // 阅读器从「成果」内部进入，切到该 Tab 时保持阅读态；其余入口回到列表。
      if (index !== 4) {
        this.isArtifactReader = false;
      }
      this.currentTabIndex = index;
    })
    .accessibilityText(label)
    .accessibilitySelected(this.currentTabIndex === index)
  }

  @Builder
  private BottomTabBar() {
    Row() {
      this.TabBarItem(0, '概览')
      this.TabBarItem(3, '委托')
      this.TabBarItem(1, '资料')
      this.TabBarItem(2, '行动')
      this.TabBarItem(4, '成果')
    }
    .width('100%')
    .padding({ top: 4, bottom: 4 })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { top: 1 }, color: PMColors.BORDER })
    .constraintSize({ maxWidth: PMBreakpoint.barMaxWidth(this.widthBp) })
  }

  @Builder
  private ProjectBanner() {
    Column() {
      Row() {
        Row() {
          CategoryBadge({ category: this.project.scenario })
          Text(this.project.updatedAt && this.project.updatedAt.length >= 10 ? `${this.project.updatedAt.substring(5, 10)} 更新` : '')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ left: PMSpacing.SM })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(VerticalAlign.Center)

        Row({ space: PMSpacing.SM }) {
          Button('＋ 记录').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .constraintSize({ minHeight: 48 })
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .onClick(() => {
              this.openCaptureEntry();
            })

          Button('会议更新').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .constraintSize({ minHeight: 48 })
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .onClick(() => {
              this.openMeetingEntry();
            })
        }
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ top: PMSpacing.SM })
  }

  @Builder
  private MetricsOverviewGrid() {
    Column() {
      // 第一行: 实际截止 + 阶段准备度
      Row({ space: PMSpacing.SM }) {
        // 指标 1: 实际截止
        Column() {
          Text('实际截止')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text(this.dashboard.deadline.label !== '' ? this.dashboard.deadline.label : '未设置截止')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.dashboard.deadline.kind === 'overdue' ? PMColors.RISK : PMColors.INK_PRIMARY)
            .margin({ top: 4, bottom: 2 })
          Text(this.project.deadline !== null && this.project.deadline !== undefined && this.project.deadline.length >= 10 ?
            this.project.deadline.substring(0, 10) : '项目未绑定具体日期')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_MUTED)
            .maxLines(1)
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: this.dashboard.deadline.kind === 'overdue' ? PMColors.RISK_BORDER : PMColors.BORDER })
        .shadow({ radius: 4, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
        .alignItems(HorizontalAlign.Start)

        // 指标 2: 项目内准备项（计数与口径都来自服务端 readiness.items，可点开逐项查看）
        Column() {
          Text(`${TextFormatters.projectProgressLabel(this.project.scenario)} ↗`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.dashboard.readiness.items.length === 0 ? '准备项清单未返回' :
            `${this.dashboard.readiness.items.filter((i) => i.complete).length} / ${this.dashboard.readiness.items.length} 项已形成`)
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.BRAND)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 4, bottom: 2 })
          Text(this.dashboard.readiness.items.length === 0 ? '暂无可计算口径' :
            `${this.dashboard.readiness.percentage}% · 查看计算口径`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_MUTED)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .shadow({ radius: 4, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
        .alignItems(HorizontalAlign.Start)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          this.showReadinessSheet = true;
        })
        .accessibilityText(this.dashboard.readiness.items.length === 0 ? '项目内准备项清单未返回，点击查看说明' :
          `项目内准备项 ${this.dashboard.readiness.items.filter((i) => i.complete).length} / ${this.dashboard.readiness.items.length} 项已形成，点击查看计算口径`)
      }
      .width('100%')

      // 第二行: 风险提醒 + 待办行动
      Row({ space: PMSpacing.SM }) {
        // 指标 3: 风险提醒
        Column() {
          Text('风险提醒')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text(`${this.interventions.filter((i) => i.status === 'OPEN' && !i.isSimulated).length} 项`)
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.interventions.some((i) => i.status === 'OPEN' && !i.isSimulated && i.severity >= 4) ? PMColors.RISK :
              this.interventions.filter((i) => i.status === 'OPEN' && !i.isSimulated).length > 0 ? PMColors.EVIDENCE : PMColors.SUCCESS)
            .margin({ top: 4, bottom: 2 })
          Text(this.interventions.some((i) => i.status === 'OPEN' && !i.isSimulated && i.severity >= 4) ?
            `${this.interventions.filter((i) => i.status === 'OPEN' && !i.isSimulated && i.severity >= 4).length} 项高风险待处理` :
            this.interventions.some((i) => i.status === 'OPEN' && !i.isSimulated) ? '暂无高风险提醒' : '当前无待处理提醒')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_MUTED)
            .maxLines(1)
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .shadow({ radius: 4, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
        .alignItems(HorizontalAlign.Start)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          this.currentTabIndex = 2; // 跳转待办
        })

        // 指标 4: 待办行动
        Column() {
          Text('待办行动')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text(`${this.actions.filter((a) => !a.isSimulated && (a.status === 'TODO' || a.status === 'DOING')).length} 项`)
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: 4, bottom: 2 })
          Text(`${this.actions.filter((a) => !a.isSimulated && a.status === 'DOING').length} 项进行中 · ${this.actions.filter((a) => !a.isSimulated && a.status === 'DONE').length} 项完成`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_MUTED)
            .maxLines(1)
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .shadow({ radius: 4, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
        .alignItems(HorizontalAlign.Start)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          this.currentTabIndex = 2; // 跳转待办
        })
      }
      .width('100%')
      .margin({ top: PMSpacing.SM })
    }
    .width('100%')
    .margin({ top: PMSpacing.SM })
  }

  @Builder
  private StageFocusCard(topIntervention: Intervention) {
    Column() {
      Row() {
        Text('当前最值得处理')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_TERTIARY)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (topIntervention.isSimulated) {
          Text('演示情境')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.RISK)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .backgroundColor(PMColors.RISK_LIGHT)
            .borderRadius(PMRadius.XS)
            .margin({ right: PMSpacing.SM })
        }

        SeverityBadge({ severity: topIntervention.severity })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // 结论：一条最值得处理的事实性问题，不用生成式段落
      Text(TextFormatters.readableText(topIntervention.title, '关键风险提醒'))
        .fontSize(PMFontSize.PRIMARY_JUDGEMENT)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(24)
        .margin({ top: PMSpacing.MD })

      // 说明行：标签与正文分行，避免系统字体放大时标签被挤掉
      Column() {
        Text('说明')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_TERTIARY)
        Text(TextFormatters.readableText(topIntervention.content, '尚未形成完整闭环依据。'))
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .margin({ top: 2 })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ top: PMSpacing.SM })

      // 依据浅色行只承载信息：不再重复一个「查看依据」链接，也不写「来源已校对」
      Row() {
        Text(this.focusEvidenceLine(topIntervention))
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .layoutWeight(1)
      }
      .width('100%')
      .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.EVIDENCE_TINT)
      .borderRadius(PMRadius.SM)
      .margin({ top: PMSpacing.MD })
      .accessibilityText(this.focusEvidenceLine(topIntervention))

      Row({ space: PMSpacing.MD }) {
        Button('查看依据').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .layoutWeight(1)
          .height(44)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .backgroundColor(PMColors.SURFACE)
          .border({ width: 1, color: PMColors.BORDER })
          .borderRadius(PMRadius.SM)
          .onClick(() => {
            router.pushUrl({
              url: 'pages/InterventionDetail',
              params: { projectId: this.projectId, interventionId: topIntervention.id }
            });
          })

        Button('＋ 创建行动').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .layoutWeight(1)
          .height(44)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            // 先预览候选行动，由用户确认后才写入；点击瞬间不创建、也不提示已创建
            this.openActionConfirm(topIntervention);
          })
          .accessibilityText('预览并确认创建候选行动')
      }
      .width('100%')
      .margin({ top: PMSpacing.LG })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({
      width: { left: 3, top: 1, right: 1, bottom: 1 },
      color: topIntervention.severity >= 4 ? PMColors.RISK : PMColors.BORDER_SUBTLE
    })
    .shadow({ radius: 10, color: 'rgba(19, 36, 58, 0.05)', offsetX: 0, offsetY: 2 })
    .margin({ top: PMSpacing.MD })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private NextActionView() {
    if (this.getNextActionId() === '') {
      Row() {
        Circle({ width: 8, height: 8 })
          .fill(PMColors.BRAND)
          .margin({ right: PMSpacing.SM })

        Text('暂无待推进待办 · 建议记录实验灵感或新碎片')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        Text('去记录 →')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: 4, bottom: 4 })
          .backgroundColor(PMColors.BRAND_LIGHT)
          .borderRadius(PMRadius.SM)
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.MD })
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .shadow({ radius: 8, color: 'rgba(19, 36, 58, 0.04)', offsetX: 0, offsetY: 2 })
      .margin({ top: PMSpacing.MD })
      .alignItems(VerticalAlign.Center)
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        this.openCaptureEntry();
      })
      .accessibilityText('暂无待推进待办，点击展开快速记录面板')
    } else {
      Column() {
        Row() {
          Text('下一步行动')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
          Text('建议今天处理')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        Column() {
          Text(this.getNextActionTitle())
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .lineHeight(22)

          Text(this.getNextActionDescription())
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })

          Button(this.getNextActionStatus() === 'DOING' ? '查看待办' : '开始行动').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .height(48)
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
            .margin({ top: PMSpacing.MD })
            .onClick(() => {
              if (this.getNextActionStatus() === 'DOING') {
                this.currentTabIndex = 2;
              } else {
                this.startNextAction();
              }
            })
            .accessibilityText(this.getNextActionStatus() === 'DOING' ? '查看下一项待办' : '开始下一项行动')
        }
        .width('100%')
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.BRAND_LIGHT)
        .borderRadius(PMRadius.SM)
        .margin({ top: PMSpacing.SM })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .shadow({ radius: 8, color: 'rgba(19, 36, 58, 0.04)', offsetX: 0, offsetY: 2 })
      .margin({ top: PMSpacing.MD })
      .alignItems(HorizontalAlign.Start)
    }
  }

  private getRecentActivities(): HomeRecentActivity[] {
    const list: HomeRecentActivity[] = [];
    for (let i = 0; i < this.project.cards.length; i++) {
      const card = this.project.cards[i];
      const time = Date.parse(card.createdAt);
      const day = card.createdAt && card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : '';
      list.push({
        id: card.id,
        kind: 'card',
        title: card.title,
        meta: `新增记忆 · ${day}`,
        timestamp: isNaN(time) ? 0 : time
      });
    }
    const doneActions = this.actions.filter((a: ActionItem) => !a.isSimulated && a.status === 'DONE');
    for (let i = 0; i < doneActions.length; i++) {
      const action = doneActions[i];
      const rawDate = action.completedAt ?? action.updatedAt;
      const time = Date.parse(rawDate);
      const day = rawDate && rawDate.length >= 10 ? rawDate.substring(0, 10) : '';
      list.push({
        id: action.id,
        kind: 'action',
        title: action.title,
        meta: `完成行动 · ${day}`,
        timestamp: isNaN(time) ? 0 : time
      });
    }
    for (let i = 0; i < this.artifacts.length; i++) {
      const art = this.artifacts[i];
      const time = Date.parse(art.createdAt);
      const day = art.createdAt && art.createdAt.length >= 10 ? art.createdAt.substring(0, 10) : '';
      list.push({
        id: art.artifactType,
        kind: 'artifact',
        title: TextFormatters.artifactTypeToChinese(art.artifactType),
        meta: `成果草稿 · ${day}`,
        timestamp: isNaN(time) ? 0 : time
      });
    }
    list.sort((a: HomeRecentActivity, b: HomeRecentActivity) => b.timestamp - a.timestamp);
    return list.slice(0, 3);
  }

  @Builder
  private RecentChangesView() {
    Column({ space: 10 }) {
      Text('最近活动').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
      Column() {
        if (this.getRecentActivities().length === 0) {
          Text('还没有项目记录，先留下一条新进展。')
            .fontSize(14)
            .fontColor(PMColors.INK_SECONDARY)
            .padding(16)
        } else {
          ForEach(this.getRecentActivities(), (item: HomeRecentActivity) => {
            PMListRow({
              title: item.title,
              kind: item.kind === 'action' ? 'action' : undefined,
              meta: item.meta,
              onOpen: (): void => {
                if (item.kind === 'card') {
                  this.currentTabIndex = 1;
                  this.materialsMode = 'memory';
                  this.expandedCardId = item.id;
                  this.selectedMemoryType = 'all';
                  this.memorySearchQuery = '';
                } else if (item.kind === 'action') {
                  this.currentTabIndex = 2;
                  this.actionStatusFilter = 'ALL';
                  this.focusedActionId = item.id;
                } else if (item.kind === 'artifact') {
                  this.selectedArtifactType = item.id;
                  const found = this.artifacts.find((a: ArtifactItem) => a.artifactType === item.id);
                  if (found !== undefined) {
                    this.currentArtifact = found;
                  }
                  this.isArtifactReader = true;
                  this.currentTabIndex = 4;
                }
              }
            })
          }, (item: HomeRecentActivity) => `${item.kind}-${item.id}`)
        }
      }
      .width('100%')
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(18)
      .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private CompactStatusSummaryView() {
    Column({ space: 8 }) {
      Row() {
        Text('项目内准备项')
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_SECONDARY)
        Blank()
        Text(this.dashboard.readiness.items.length === 0 ? '暂无清单' : `${this.dashboard.readiness.items.filter((i: ReadinessItem) => i.complete).length} / ${this.dashboard.readiness.items.length} 项已形成`)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
      }
      .width('100%')

      Progress({
        value: Math.min(100, Math.max(0, this.dashboard.readiness.percentage)),
        total: 100,
        type: ProgressType.Linear
      })
      .width('100%')
      .color(PMColors.BRAND)
      .height(4)

      Row() {
        Text(`${this.project.cards.length} 条记忆 · ${this.actions.filter((a: ActionItem) => !a.isSimulated && a.status !== 'DONE' && a.status !== 'CANCELLED').length} 项待推进行动 · ${this.artifacts.length} 份成果草稿`)
          .fontSize(11)
          .fontColor(PMColors.INK_TERTIARY)
          .layoutWeight(1)

        Text('查看清单与缺口 →')
          .fontSize(11)
          .fontColor(PMColors.BRAND)
          .fontWeight(FontWeight.Medium)
          .onClick(() => {
            this.showReadinessSheet = true;
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }

  private latestClosedLoopAction(): ActionItem | null {
    let best: ActionItem | null = null;
    for (const action of this.actions) {
      if (action.status !== 'DONE' || action.isSimulated) {
        continue;
      }
      if (best === null) {
        best = action;
        continue;
      }
      const current: string = action.completedAt !== undefined && action.completedAt !== null ? action.completedAt : '';
      const bestSoFar: string = best.completedAt !== undefined && best.completedAt !== null ? best.completedAt : '';
      if (current > bestSoFar) {
        best = action;
      }
    }
    return best;
  }

  /**
   * 只有当状态变化本身带着指向这条行动或其结果记忆的依据时才返回；
   * 没有独立依据就不写「风险已处理」这类结论。
   */
  private closedLoopStateChange(action: ActionItem): StateDiffItem | null {
    for (const item of this.stateDiff.items) {
      if (item.changeKey.startsWith('risk:') && !item.evidenceRefs.some((ref) =>
        !((ref.entityKind === 'action' && ref.entityId === action.id) ||
          (ref.entityKind === 'card' && ref.entityId === action.resultCardId)))) {
        continue;
      }
      for (const ref of item.evidenceRefs) {
        if (ref.entityKind === 'action' && ref.entityId === action.id) {
          return item;
        }
        if (ref.entityKind === 'card' && action.resultCardId !== undefined && action.resultCardId !== null &&
          action.resultCardId !== '' && ref.entityId === action.resultCardId) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * 最近闭环：已完成行动 → 完成回执 → 结果记忆 → 可证实的状态变化。
   * 缺任一环就只显示已有的环节，不写「结果已回写」或「风险已处理」。
   */
  @Builder
  private ClosedLoopView() {
    Column() {
      Row() {
        Text('最近闭环')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
        Text('行动 → 回执 → 事实')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .padding({ left: 2, right: 2, bottom: PMSpacing.XS })

      if (this.latestClosedLoopAction() === null) {
        Column() {
          Text('还没有已完成并留下回执的行动。')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .lineHeight(20)
          Text('完成一项行动并写下结果后，这里会按「行动 → 回执 → 结果记忆 → 状态变化」展示真实链路；缺少的环节不会补写。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .alignItems(HorizontalAlign.Start)
      } else {
        Column() {
          Row() {
            Text(`已完成 · ${this.latestClosedLoopAction()!.completedAt !== undefined && this.latestClosedLoopAction()!.completedAt !== null && this.latestClosedLoopAction()!.completedAt!.length >= 10 ?
              this.latestClosedLoopAction()!.completedAt!.substring(0, 10) : '近期'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SUCCESS)
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor(PMColors.SUCCESS_LIGHT)
              .borderRadius(PMRadius.XS)
          }
          .width('100%')

          Text(TextFormatters.readableText(this.latestClosedLoopAction()!.title, '已完成行动标题无法读取'))
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .lineHeight(22)
            .margin({ top: PMSpacing.SM })

          if (this.latestClosedLoopAction()!.sourceIntervention !== undefined) {
            Text(`来自提醒「${TextFormatters.readableText(this.latestClosedLoopAction()!.sourceIntervention!.title, '来源提醒标题无法读取')}」`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(18)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .margin({ top: 2 })
          }

          // 完成回执：有文本就原文展示，没有就如实说明缺这一环
          Column() {
            if (this.latestClosedLoopAction()!.resultText !== undefined && this.latestClosedLoopAction()!.resultText !== null && this.latestClosedLoopAction()!.resultText !== '') {
              Text('完成回执')
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_SECONDARY)
              Text(TextFormatters.readableText(this.latestClosedLoopAction()!.resultText!, '完成回执文本无法读取'))
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(19)
                .maxLines(3)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .margin({ top: 2 })
            } else {
              Text('这条行动已完成，但没有留下回执文本。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(19)
            }
          }
          .width('100%')
          .padding({ left: PMSpacing.MD })
          .border({ width: { left: 2 }, color: PMColors.EVIDENCE })
          .alignItems(HorizontalAlign.Start)
          .margin({ top: PMSpacing.MD })

          // 结果记忆：只有真的关联了 resultCardId 才说已回写
          if (this.latestClosedLoopAction()!.resultCardId !== undefined && this.latestClosedLoopAction()!.resultCardId !== null && this.latestClosedLoopAction()!.resultCardId !== '') {
            Row() {
              CheckIcon({ iconSize: 14, color: PMColors.SUCCESS })
              Text(this.latestClosedLoopAction()!.resultCard !== undefined && this.latestClosedLoopAction()!.resultCard!.title !== '' ?
                `完成回执已写入项目记忆《${TextFormatters.readableText(this.latestClosedLoopAction()!.resultCard!.title, '结果记忆标题无法读取')}》` :
                '完成回执已写入项目记忆')
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SUCCESS)
                .lineHeight(18)
                .layoutWeight(1)
                .margin({ left: PMSpacing.SM })
            }
            .width('100%')
            .padding(PMSpacing.SM)
            .backgroundColor(PMColors.SUCCESS_LIGHT)
            .borderRadius(PMRadius.SM)
            .alignItems(VerticalAlign.Top)
            .margin({ top: PMSpacing.MD })
          } else {
            Text('尚未回写为项目记忆：这条行动没有关联结果记忆，闭环还差最后一环。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(18)
              .width('100%')
              .margin({ top: PMSpacing.MD })
          }

          // 状态变化：必须有指向这条行动或结果记忆的独立依据才展示
          if (this.closedLoopStateChange(this.latestClosedLoopAction()!) !== null) {
            Row() {
              Text(`状态变化：${this.closedLoopStateChange(this.latestClosedLoopAction()!)!.summary}`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(18)
                .layoutWeight(1)
              Text(`依据 ${this.closedLoopStateChange(this.latestClosedLoopAction()!)!.evidenceRefs.length} 项`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ left: PMSpacing.SM })
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
            .padding(PMSpacing.SM)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.SM })
          }

          Button(this.latestClosedLoopAction()!.resultCardId !== undefined && this.latestClosedLoopAction()!.resultCardId !== null && this.latestClosedLoopAction()!.resultCardId !== '' ?
            '查看回执与来源 →' : '去待办查看这条行动 →').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .backgroundColor('transparent')
            .height(36)
            .padding({ left: 0, right: 0 })
            .margin({ top: PMSpacing.SM })
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              const action = this.latestClosedLoopAction();
              if (action !== null && action.resultCardId !== undefined && action.resultCardId !== null && action.resultCardId !== '') {
                // 定位到那条结果记忆，而不是只跳到泛列表
                this.memorySearchQuery = '';
                this.memorySearchResults = [];
                this.expandedCardId = action.resultCardId;
                this.currentTabIndex = 1;
              } else {
                this.currentTabIndex = 2;
              }
            })
            .accessibilityText('查看这条行动的完成回执与来源')
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.EVIDENCE_BORDER })
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .margin({ top: PMSpacing.MD })
    .alignItems(HorizontalAlign.Start)
  }

  // ----------------------------------------------------
  // Tab 0: 工作台 (Workbench) 视图 —— 围绕“三个问题”设计
  // ----------------------------------------------------
  @Builder
  private CockpitView() {
    Scroll() {
      Column({ space: 16 }) {
        // 1. 项目基本状态
        Column({ space: 8 }) {
          Row() {
            CategoryBadge({ category: this.project.scenario })
            DeadlineBadge({ deadline: this.dashboard.deadline }).margin({ left: 8 })
            Blank()
            Button('＋ 新增', { type: ButtonType.Normal })
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.SM)
              .height(32)
              .padding({ left: 12, right: 12 })
              .accessibilityText('新增项目内容：记录进展或整理会议')
              .bindMenu(this.cockpitAddMenuItems())
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          if (this.project.description !== '') {
            Text(this.project.description)
              .fontSize(14)
              .lineHeight(22)
              .fontColor(PMColors.INK_SECONDARY)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.width('100%').alignItems(HorizontalAlign.Start)

        // 2. 当前下一步
        this.HomeFocusView()

        // 3. 准备项与关键指标紧凑摘要
        this.CompactStatusSummaryView()

        // 4. 最近活动
        this.RecentChangesView()

        // 5. 项目档案与工具（紧凑导航行折叠，分为3组清晰收敛）
        Row() {
          Text('项目档案与工具')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_SECONDARY)
          Blank()
          Text(this.showProjectStatus ? '收起 ↑' : '展开 ↓')
            .fontSize(13)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.SM)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .accessibilityText(this.showProjectStatus ? '收起项目档案与工具' : '展开项目档案与工具')
        .onClick(() => { this.showProjectStatus = !this.showProjectStatus; })

        if (this.showProjectStatus) {
          Column({ space: 14 }) {
            // 分组一：项目状态 (状态与变化、项目体检)
            Text('项目状态')
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 4 })

            ProjectStatePanel({
              projectId: this.projectId,
              onOpenDiffSheet: (diff: StateDiff): void => { this.stateDiffForSheet = diff; this.showStateDiffSheet = true; },
              onOpenBrief: (fromId: string, toId: string): void => { this.openChangeBrief(fromId, toId); },
              onGoActions: (): void => { this.currentTabIndex = 2; },
              onDiffUpdated: (diff: StateDiff): void => { this.stateDiff = diff; }
            })

            this.ProjectHealthCardView()

            // 层次一：最近闭环
            this.ClosedLoopView()

            ProjectImpactPanel({ projectId: this.projectId })

            this.MilestoneEvidenceView()

            // 层次二：深入查看
            Text('深入查看')
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 10 })

            Column() {
              // 1. 演进与检查点
              Row() {
                Column({ space: 4 }) {
                  Text('演进与检查点')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text('关键结论的演进轨迹与阶段检查记录')
                    .fontSize(12)
                    .fontColor(PMColors.INK_SECONDARY)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)

                Text(this.showEvolution ? '收起 ↑' : '展开 ↓')
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.BRAND)
                  .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.XS)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 14 })
              .alignItems(VerticalAlign.Center)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.showEvolution = !this.showEvolution;
              })

              if (this.showEvolution) {
                Column({ space: 10 }) {
                  ProjectEvolutionPanel({
                    projectId: this.projectId,
                    onOpenSources: (cardId: string): void => {
                      this.memorySearchQuery = '';
                      this.memorySearchResults = [];
                      this.selectedMemoryType = 'all';
                      this.expandedCardId = cardId;
                      this.currentTabIndex = 1;
                      if (cardId !== '') AppStorage.setOrCreate<string>('stateEvidenceEntityId', cardId);
                    }
                  })
                  this.EpisodeCheckpointCardView()
                }
                .width('100%')
                .padding({ left: 12, right: 12, bottom: 14 })
              }

              Divider()
                .color(PMColors.BORDER_SUBTLE)
                .strokeWidth(1)

              // 2. 证据变化与确认
              Row() {
                Column({ space: 4 }) {
                  Text('证据变化与确认')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text('核对新证据影响与变更依据')
                    .fontSize(12)
                    .fontColor(PMColors.INK_SECONDARY)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)

                Text('›')
                  .fontSize(22)
                  .fontColor(PMColors.INK_TERTIARY)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 14 })
              .alignItems(VerticalAlign.Center)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.showChangeImpactDialog = true;
              })
            }
            .width('100%')
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })

            // 层次三：管理与工具
            Text('管理与工具')
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 10 })

            Column({ space: 6 }) {
              Row() {
                Column({ space: 4 }) {
                  Text('重新评估')
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text('重新扫描项目记忆、状态与体检指标')
                    .fontSize(12)
                    .fontColor(PMColors.INK_SECONDARY)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)

                Button(this.isEvaluating ? '评估中...' : '重新评估', { type: ButtonType.Normal })
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.BRAND)
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.SM)
                  .height(34)
                  .padding({ left: 14, right: 14 })
                  .enabled(!this.isEvaluating)
                  .clickEffect(PMInteraction.PRESS_EFFECT)
                  .onClick(() => {
                    this.evaluate(undefined, true);
                  })
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 14 })
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.MD)
              .border({ width: 1, color: PMColors.BORDER_SUBTLE })
              .alignItems(VerticalAlign.Center)

              if (this.evaluateError !== '') {
                Text(this.evaluateError)
                  .fontSize(12)
                  .fontColor(PMColors.RISK)
                  .padding({ left: 4 })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 160 })
      .alignItems(HorizontalAlign.Start)
    }
    .layoutWeight(1)
    .width('100%')
    .align(Alignment.TopStart)
    .scrollBar(BarState.Off)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  // 单一 bindSheet 入口：按模式渲染记录面板或会议导入，避免同节点重复绑定
  @Builder
  private EntrySheet() {
    if (this.entrySheetMode === 'meeting') {
      MeetingImportSheet({
        projectId: this.projectId,
        injectedText: this.meetingInjectedText,
        isUploadingAttachment: this.isUploadingAttachment,
        uploadFeedback: this.attachmentFeedback,
        onRequestUpload: () => {
          void this.openUploadMenu();
        },
        onClose: () => {
          this.showEntrySheet = false;
          this.loadAllData();
        },
        onShowDiff: (fromId: string, toId: string) => {
          this.showMeetingDiff(fromId, toId);
        }
      })
    } else {
      this.CaptureSheet()
    }
  }

  // 底部半模态记录面板：来源、回形针上传与文字沉淀在同一个面板内完成
  @Builder
  private CaptureSheet() {
    Column() {
      Row() {
        Column() {
          Text('记录项目碎片')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('记录实验、导师意见和材料，并保留来源')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })
          Text(`已积累 ${this.project._count.cards} 条记忆`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        PMCloseButton({
          accessibilityLabel: '关闭记录面板',
          onAction: (): void => { this.showEntrySheet = false; }
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      this.MaterialReturn()

      Scroll() {
        Row() {
          ForEach(this.sourceOptions, (src: string) => {
            Button(src).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(this.sourceType === src ? FontWeight.Medium : FontWeight.Regular)
              .fontColor(this.sourceType === src ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.sourceType === src ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .height(36)
              .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
              .border({ width: 1, color: this.sourceType === src ? PMColors.BRAND : PMColors.BORDER_SUBTLE })
              .margin({ right: PMSpacing.SM })
              .accessibilityText(`记录来源：${src}`)
              .accessibilitySelected(this.sourceType === src)
              .onClick(() => {
                if (this.sourceType !== src) {
                  this.captureRequestId = '';
                }
                this.sourceType = src;
                this.persistCaptureDraft();
              })
          }, (src: string) => src)
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .align(Alignment.TopStart).scrollBar(BarState.Off)
      .margin({ top: PMSpacing.SM })

      if (this.attachmentFeedback !== '') {
        Text(this.attachmentFeedback)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.attachmentFeedbackTone === 'error' ? PMColors.RISK :
            this.attachmentFeedbackTone === 'success' ? PMColors.SUCCESS :
              this.attachmentFeedbackTone === 'warning' ? PMColors.EVIDENCE : PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.XS })
          .accessibilityText(`附件状态：${this.attachmentFeedback}`)
      }

      if (this.attachmentRetryId !== '') {
        Row() {
          Button(this.isRetryingAttachment ? '重新提取中…' : '重试提取').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .border({ width: 1, color: PMColors.BRAND })
            .borderRadius(PMRadius.SM)
            .height(44)
            .enabled(!this.isRetryingAttachment)
            .layoutWeight(1)
            .onClick(() => {
              this.retryAttachment();
            })

          Button('人工校对内容 (模块 E)').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.EVIDENCE)
            .backgroundColor(PMColors.EVIDENCE_LIGHT)
            .border({ width: 1, color: PMColors.EVIDENCE })
            .borderRadius(PMRadius.SM)
            .height(44)
            .layoutWeight(1.3)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              const targetAttachment = new Attachment();
              targetAttachment.id = this.attachmentRetryId;
              targetAttachment.fileName = '待校对实验附件';
              targetAttachment.extractionStatus = 'NEEDS_OCR';
              this.correctingAttachment = targetAttachment;
              this.showAttachmentCorrection = true;
            })
        }
        .width('100%')
        .margin({ top: PMSpacing.SM })
      }

      if (this.lastUploadedAttachmentId !== '') {
        PMButton({ label: '查看刚上传的原件 →', secondary: true, onAction: (): void => { this.openAttachment(this.lastUploadedAttachmentId); } })
      }
      if (this.attachments.length > 0) {
        Button(`全部附件 ${this.attachments.length} 份 · 查看原件`, { type: ButtonType.Normal })
          .constraintSize({ minHeight: 44 }).padding({ left: 0, right: PMSpacing.SM }).fontSize(PMFontSize.SECONDARY).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND)
          .onClick(() => { this.showEntrySheet = false; this.currentTabIndex = 1; this.materialsMode = 'attachments'; })
      }
      if (this.attachments.filter((a: Attachment) => a.extractionStatus !== 'SUCCESS').length > 0) {
        Column() {
          Row() {
            Text(`待处理附件 (${this.attachments.filter((a: Attachment) => a.extractionStatus !== 'SUCCESS').length})`)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.EVIDENCE)
            Text('退出重进仍可恢复重试')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          ForEach(this.attachments.filter((a: Attachment) => a.extractionStatus !== 'SUCCESS'), (item: Attachment) => {
            Row() {
              Column() {
                Text(item.fileName)
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(item.extractionStatus === 'NEEDS_OCR' ? '环境需要 OCR 提取' :
                  item.extractionError !== '' ? item.extractionError : '提取未完成')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(item.extractionStatus === 'NEEDS_OCR' ? PMColors.EVIDENCE : PMColors.RISK)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 2 })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)

              Button(this.isRetryingAttachment && this.attachmentRetryId === item.id ? '重试中…' : '重试提取').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .borderRadius(PMRadius.XS)
                .height(36)
                .enabled(!this.isRetryingAttachment)
                .margin({ left: PMSpacing.SM })
                .onClick(() => {
                  this.retrySpecificAttachment(item.id);
                })
                .accessibilityText(`重试提取附件 ${item.fileName}`)
            }
            .width('100%')
            .padding(PMSpacing.SM)
            .margin({ top: PMSpacing.XS })
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.XS)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(VerticalAlign.Center)
          }, (item: Attachment) => item.id)
        }
        .width('100%')
        .padding(PMSpacing.SM)
        .margin({ top: PMSpacing.SM })
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .border({ width: 1, color: PMColors.BORDER })
        .alignItems(HorizontalAlign.Start)
      }

      TextArea({
        text: this.rawText,
        placeholder: `记录${this.sourceType}内容（导师意见、实验结果、代码报错等，至少5个字）...`
      })
        .onChange((value: string) => {
          if (value !== this.rawText && this.captureRequestId !== '') {
            this.captureRequestId = '';
          }
          this.rawText = value;
          this.persistCaptureDraft();
        })
        .fontSize(PMFontSize.BODY)
        .height(96)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .accessibilityText(`输入${this.sourceType}内容，至少 5 个字`)
        .margin({ top: PMSpacing.SM })

      if (this.captureError !== '') {
        Text(this.captureError)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.RISK)
          .margin({ top: PMSpacing.XS })
      }

      Row() {
        Row() {
          PaperclipIcon({ iconSize: 18, color: PMColors.BRAND })
        }
        .width(48)
        .height(44)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(PMColors.BRAND_LIGHT)
        .borderRadius(PMRadius.SM)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .enabled(!this.isUploadingAttachment)
        .onClick(() => {
          this.openUploadMenu();
        })
        .accessibilityText('上传照片或 PDF 附件')

        Text(this.rawText.trim().length > 0 ? `已输入 ${this.rawText.trim().length} 字 · 至少 5 字可归档` : '至少 5 字可归档；附件会保留原始来源')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .layoutWeight(1)
          .margin({ left: PMSpacing.SM })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .margin({ top: PMSpacing.MD })

      Button(this.isCapturing ? '正在归档...' : '沉淀为项目记忆').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .fontSize(PMFontSize.BUTTON)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.SURFACE)
        .backgroundColor(this.rawText.trim().length >= 5 && !this.isCapturing ? PMColors.BRAND : PMColors.INK_MUTED)
        .borderRadius(PMRadius.SM)
        .height(48)
        .width('100%')
        .margin({ top: PMSpacing.SM })
        .enabled(this.rawText.trim().length >= 5 && !this.isCapturing)
        .onClick(() => {
          this.capture();
        })
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private MilestoneEvidenceView() {
    if (this.milestones.length > 0) {
      Column() {
        Row() {
          Text('里程碑证据')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('明确关联后才算完成')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        ForEach(this.milestones, (milestone: Milestone) => {
          Text(milestone.title)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: PMSpacing.SM })

          ForEach(milestone.deliverables, (deliverable: Deliverable) => {
            Column() {
              Row() {
                Text(deliverable.title)
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .layoutWeight(1)
                Text(deliverable.status === 'COMPLETED' ? '已完成' : '待补证据')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(deliverable.status === 'COMPLETED' ? PMColors.SUCCESS : PMColors.RISK)
              }
              .width('100%')

              ForEach(this.parseExpectedEvidence(deliverable.expectedEvidence), (evidenceType: string) => {
                Column() {
                  Row() {
                    Text(`${this.isEvidenceConfirmed(deliverable, evidenceType) ? '✓' : '○'} ${TextFormatters.memoryTypeToChinese(evidenceType)}`)
                      .fontSize(PMFontSize.SECONDARY)
                      .fontColor(this.isEvidenceConfirmed(deliverable, evidenceType) ? PMColors.SUCCESS : PMColors.INK_SECONDARY)
                      .layoutWeight(1)

                    if (this.isEvidenceConfirmed(deliverable, evidenceType)) {
                      Button(this.isConfirmingEvidence ? '撤销中…' : '撤销关联').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.RISK)
                        .backgroundColor(PMColors.SURFACE)
                        .border({ width: 1, color: PMColors.BORDER })
                        .borderRadius(PMRadius.XS)
                        .height(30)
                        .enabled(!this.isConfirmingEvidence)
                        .onClick(() => {
                          const conf: DeliverableEvidence | undefined = this.getConfirmedEvidence(deliverable, evidenceType);
                          if (conf !== undefined) {
                            this.revokeEvidence(deliverable.id, evidenceType, conf.cardId, conf.attachmentId);
                          }
                        })
                        .accessibilityText(`撤销${deliverable.title}的${TextFormatters.memoryTypeToChinese(evidenceType)}证据`)
                    }
                  }
                  .width('100%')
                  .alignItems(VerticalAlign.Center)

                  if (!this.isEvidenceConfirmed(deliverable, evidenceType)) {
                    if (this.getEvidenceCandidates(evidenceType).length === 0) {
                      Text('暂无匹配记忆（可上传附件或记录新事实）')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                        .margin({ top: PMSpacing.XS })
                    } else {
                      ForEach(this.getEvidenceCandidates(evidenceType), (card: KnowledgeCard) => {
                        Row() {
                          Column() {
                            Text(card.title)
                              .fontSize(PMFontSize.CAPTION)
                              .fontWeight(FontWeight.Medium)
                              .fontColor(PMColors.INK_PRIMARY)
                              .maxLines(1)
                              .textOverflow({ overflow: TextOverflow.Ellipsis })
                            if (card.summary !== '') {
                              Text(card.summary.length > 50 ? `${card.summary.substring(0, 50)}…` : card.summary)
                                .fontSize(PMFontSize.CAPTION)
                                .fontColor(PMColors.INK_SECONDARY)
                                .maxLines(2)
                                .textOverflow({ overflow: TextOverflow.Ellipsis })
                                .margin({ top: 2 })
                            }
                          }
                          .layoutWeight(1)
                          .alignItems(HorizontalAlign.Start)

                          Button(this.isConfirmingEvidence ? '确认中…' : '关联此条').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.BRAND)
                            .backgroundColor(PMColors.BRAND_LIGHT)
                            .borderRadius(PMRadius.XS)
                            .height(32)
                            .enabled(!this.isConfirmingEvidence)
                            .margin({ left: PMSpacing.SM })
                            .onClick(() => {
                              this.confirmEvidence(deliverable.id, evidenceType, card.id);
                            })
                            .accessibilityText(`关联${card.title}并确认${TextFormatters.memoryTypeToChinese(evidenceType)}证据`)
                        }
                        .width('100%')
                        .padding(PMSpacing.SM)
                        .margin({ top: PMSpacing.XS })
                        .backgroundColor(PMColors.SURFACE)
                        .borderRadius(PMRadius.XS)
                        .border({ width: 1, color: PMColors.BORDER })
                        .alignItems(VerticalAlign.Center)
                      }, (card: KnowledgeCard) => `${deliverable.id}-${evidenceType}-${card.id}`)
                    }
                  }
                }
                .width('100%')
                .margin({ top: PMSpacing.XS })
                .padding(PMSpacing.XS)
              }, (evidenceType: string) => `${deliverable.id}-${evidenceType}`)
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .margin({ top: PMSpacing.XS })
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Start)
          }, (deliverable: Deliverable) => deliverable.id)
        }, (milestone: Milestone) => milestone.id)

        if (this.evidenceFeedback !== '') {
          Text(this.evidenceFeedback)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SUCCESS)
            .margin({ top: PMSpacing.SM })
        }
        if (this.evidenceError !== '') {
          Text(this.evidenceError)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
            .margin({ top: PMSpacing.SM })
        }
      }
      .width('100%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.MD)
      .border({ width: 1, color: PMColors.BORDER })
      .margin({ top: PMSpacing.MD })
      .alignItems(HorizontalAlign.Start)
    }
  }

  // ----------------------------------------------------
  // Tab 1: 记忆脉络 (Memory) 视图
  // ----------------------------------------------------
  private openAttachment(attachmentId: string): void {
    router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: this.projectId, attachmentId: attachmentId } });
  }

  @Builder
  private AttachmentLibrary() {
    if (this.attachmentLoadError !== '') {
      Column({ space: 8 }) {
        Text(this.attachmentLoadError).fontSize(13).fontColor(PMColors.RISK)
        PMButton({ label: '重新加载附件', secondary: true, onAction: (): void => { this.loadAllData(true); } })
      }.width('100%').padding(16)
    }
if (this.attachmentSearchOpen) {
        Row({ space: 8 }) {
              TextInput({ text: this.attachmentSearch, placeholder: '搜索附件文件名' })
        .height(44).margin({ left: 16, right: 16, bottom: 10 }).backgroundColor(PMColors.SURFACE)
        .onChange((value: string) => { this.attachmentSearch = value; })
          Button({ type: ButtonType.Circle }) { CloseIcon({ iconSize: 16, iconColor: PMColors.INK_TERTIARY }) }
            .width(36).height(44).backgroundColor(Color.Transparent)
            .accessibilityText('关闭附件搜索并清空关键词')
            .onClick(() => { this.attachmentSearchOpen = false; this.attachmentSearch = ''; })
        }.width('100%').padding({ left: 16, right: 16 })
      } else if (this.attachmentSearch.trim() !== '') {
        Row({ space: 8 }) {
          Text('搜索：' + this.attachmentSearch).fontSize(12).fontColor(PMColors.BRAND)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          Text('清除').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).height(36)
            .accessibilityText('清除附件搜索关键词')
            .onClick(() => { this.attachmentSearch = ''; })
        }.width('100%').padding({ left: 28, right: 28 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
      }
    List({ space: 10 }) {
      if (this.attachments.length === 0 && this.attachmentLoadError === '') {
        ListItem() {
          EmptyStateView({ title: '还没有附件', description: '上传图片或 PDF 后，原件会保留在这里。', actionText: '上传附件', onAction: (): void => { this.openCaptureEntry(); } })
        }
      } else if (this.attachments.filter((a: Attachment) => a.fileName.toLowerCase().includes(this.attachmentSearch.trim().toLowerCase())).length === 0) {
        ListItem() { Text('没有找到匹配的附件').padding(20).fontColor(PMColors.INK_TERTIARY) }
      }
      ForEach(this.attachments.filter((a: Attachment) => a.fileName.toLowerCase().includes(this.attachmentSearch.trim().toLowerCase())), (item: Attachment) => {
        ListItem() {
          Column({ space: 10 }) {
            PMListRow({ title: item.fileName, subtitle: attachmentStatus(item), meta: `${attachmentSize(item.size)} · ${(item.createdAt ?? '').substring(0, 10)} · 查看原件 ›`, onOpen: (): void => { this.openAttachment(item.id); } })
            if (item.extractionStatus !== 'SUCCESS') {
              Row({ space: 10 }) {
                Button(this.isRetryingAttachment && this.attachmentRetryId === item.id ? '提取中…' : '重试提取', { type: ButtonType.Normal })
                  .constraintSize({ minHeight: 44 }).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(11).layoutWeight(1)
                  .enabled(!this.isRetryingAttachment).onClick(() => { this.retrySpecificAttachment(item.id); })
                Button('人工校对', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).layoutWeight(1)
                  .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11)
                  .onClick(() => { this.correctingAttachment = item; this.showAttachmentCorrection = true; })
              }.padding({ left: 14, right: 14, bottom: 12 }).width('100%')
            }
          }.width('100%').backgroundColor(PMColors.SURFACE).borderRadius(18).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }
      }, (item: Attachment) => item.id)
    }.layoutWeight(1).padding({ left: 16, right: 16, bottom: 16 })
  }

  @Builder
  private DecisionSide(label: string, card: TemporalCardSummary, current: boolean) {
    Column({ space: 4 }) {
      Row() {
        Text(label + (card.createdAt.length >= 10 ? ' · ' + card.createdAt.substring(5, 10).replace('-', '/') : ''))
          .fontSize(12).fontColor(current ? PMColors.BRAND : PMColors.INK_TERTIARY).layoutWeight(1)
        Text(current ? '当前时态' : '已被取代').fontSize(12)
          .fontWeight(current ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(current ? PMColors.BRAND : PMColors.INK_TERTIARY)
      }.width('100%')
      Text(TextFormatters.readableText(card.title, '决策标题无法读取'))
        .fontSize(14).fontWeight(current ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(current ? PMColors.INK_PRIMARY : PMColors.INK_SECONDARY)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).borderRadius(12)
      .backgroundColor(current ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
  }

  @Builder
  private DecisionEvolutionCard() {
    Column({ space: 8 }) {
      Text('决策演化').fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      this.DecisionSide('原决策', this.decisionOld!, false)
      Text('↓').fontSize(14).fontColor(PMColors.INK_TERTIARY).width('100%').textAlign(TextAlign.Center)
      this.DecisionSide('替代决策', this.decisionNew!, true)
      Text('查看结论演进 →').fontSize(13).fontColor(PMColors.BRAND).height(44)
        .accessibilityText('打开结论演进，核对或确认决策关系')
        .onClick(() => { router.pushUrl({ url: 'pages/MemoryTimeline', params: { projectId: this.projectId } }); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(PMColors.SURFACE)
      .borderRadius(16).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }

  @Builder
  private MemoryView() {
    Column() {
      // 材料工具区：范围切换（项目记忆/附件原件）、搜索、新建与类型筛选收在同一个头部，
      // 「当前理解与工程观察」是次要入口，贴在筛选行右侧，不再单独占一条整宽横幅。
      Column({ space: 6 }) {
        Row({ space: 8 }) {
          Row({ space: 2 }) {
            Button(`项目记忆 ${this.project.cards.length}`, { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(14)
              .fontColor(this.materialsMode === 'memory' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .fontWeight(this.materialsMode === 'memory' ? FontWeight.Medium : FontWeight.Regular)
              .backgroundColor(this.materialsMode === 'memory' ? PMColors.SURFACE : Color.Transparent).borderRadius(9)
              .accessibilitySelected(this.materialsMode === 'memory').onClick(() => { this.materialsMode = 'memory'; })
            Button(this.attachmentLoadError === '' ? `附件原件 ${this.attachments.length}` : '附件 · 未同步', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(14)
              .fontColor(this.materialsMode === 'attachments' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .fontWeight(this.materialsMode === 'attachments' ? FontWeight.Medium : FontWeight.Regular)
              .backgroundColor(this.materialsMode === 'attachments' ? PMColors.SURFACE : Color.Transparent).borderRadius(9)
              .accessibilitySelected(this.materialsMode === 'attachments').onClick(() => { this.materialsMode = 'attachments'; })
          }.layoutWeight(1).padding(3).borderRadius(12).backgroundColor(PMColors.SURFACE_SUBTLE)
          Button({ type: ButtonType.Circle }) { SearchIcon({ iconSize: 18 }) }
            .width(44).height(44).backgroundColor(Color.Transparent)
            .accessibilityText(this.materialsMode === 'memory' ? '搜索项目记忆' : '搜索附件文件名')
            .onClick(() => {
              if (this.materialsMode === 'memory') { this.memorySearchOpen = !this.memorySearchOpen; }
              else { this.attachmentSearchOpen = !this.attachmentSearchOpen; }
            })
          Button({ type: ButtonType.Circle }) { PlusIcon({ iconSize: 18 }) }
            .width(44).height(44).backgroundColor(Color.Transparent)
            .accessibilityText('记录或上传附件').onClick(() => { this.openCaptureEntry(); })
        }.width('100%')

        if (this.materialsMode === 'memory' && this.memorySearchOpen) {
          Row({ space: 8 }) {
            TextInput({ text: this.memorySearchQuery, placeholder: '搜索标题、摘要或关键词' })
              .onChange((value: string) => { this.onMemoryQueryChange(value); })
              .fontSize(14).height(44).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11)
              .border({ width: 1, color: PMColors.BORDER_SUBTLE }).layoutWeight(1)
            Button({ type: ButtonType.Circle }) { CloseIcon({ iconSize: 16, iconColor: PMColors.INK_TERTIARY }) }
              .width(36).height(44).backgroundColor(Color.Transparent)
              .accessibilityText('关闭搜索并清空关键词')
              .onClick(() => { this.memorySearchOpen = false; this.onMemoryQueryChange(''); })
          }.width('100%')
        } else if (this.materialsMode === 'memory' && this.memorySearchQuery.trim() !== '') {
          Row({ space: 8 }) {
            Text('搜索：' + this.memorySearchQuery).fontSize(12).fontColor(PMColors.BRAND)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            Text('清除').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).height(36)
              .accessibilityText('清除搜索关键词')
              .onClick(() => { this.onMemoryQueryChange(''); })
          }.width('100%').padding({ left: 12, right: 12 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
        }

        if (this.materialsMode === 'memory') {
          Row({ space: PMSpacing.SM }) {
            Scroll() {
              Row({ space: 8 }) {
                ForEach(['all', 'paper_note', 'experiment_log', 'reflection', 'code_issue'], (type: string) => {
                  Button(type === 'all' ? '全部' : type === 'paper_note' ? '论文笔记' : type === 'experiment_log' ? '实验记录' : type === 'reflection' ? '阶段复盘' : '代码问题', { type: ButtonType.Normal })
                    .fontSize(13).fontColor(this.selectedMemoryType === type ? PMColors.BRAND : PMColors.INK_SECONDARY)
                    .fontWeight(this.selectedMemoryType === type ? FontWeight.Medium : FontWeight.Regular)
                    .backgroundColor(Color.Transparent)
                    .borderRadius(0).constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
                    .border({ width: { bottom: this.selectedMemoryType === type ? 2 : 0 }, color: PMColors.BRAND })
                    .accessibilitySelected(this.selectedMemoryType === type).onClick(() => { this.selectMemoryType(type); })
                })
              }
            }.layoutWeight(1).scrollable(ScrollDirection.Horizontal).align(Alignment.TopStart).scrollBar(BarState.Off)

            // 次要入口：不占整条横幅，与筛选同一行，保留 MemoryTimeline 的 openContext 参数。
            Row({ space: 2 }) {
              BookOpenIcon({ iconSize: 16, color: PMColors.INK_TERTIARY })
              Text('当前理解').fontSize(PMFontSize.CAPTION).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
              Text('›').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_TERTIARY)
            }
            .height(44)
            .padding({ left: PMSpacing.SM })
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .accessibilityText('当前理解与工程观察')
            .accessibilityDescription('打开 Agent 记忆、仓库连接与环境观察')
            .onClick(() => {
              router.pushUrl({ url: 'pages/MemoryTimeline', params: { projectId: this.projectId, openContext: '1' } });
            })
          }.width('100%')
        }
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      if (this.materialsMode === 'attachments') {
        this.AttachmentLibrary()
      } else {
      if (this.memorySearchQuery.trim() !== '' && this.isSearchingMemory) {
        Text('正在检索项目记忆…')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM })
      }
      if (this.memorySearchQuery.trim() !== '' && !this.isSearchingMemory && this.memorySearchError === '' && this.memorySearchResults.length === 0) {
        Text('没有找到匹配的项目记忆')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD })
      }
      if (this.memorySearchError !== '') {
        Text(this.memorySearchError)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.RISK)
          .margin({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM })
      }

      if (this.requestedCaptureId !== '') {
        Column({ space: PMSpacing.SM }) {
          Text(this.captureSourceNotice).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
          Text('查看全部项目记忆').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.BRAND)
            .constraintSize({ minHeight: 44 }).onClick(() => { this.requestedCaptureId = ''; this.captureSourceNotice = ''; })
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: PMSpacing.LG, right: PMSpacing.LG })
      }
      // 卡片流
      List({ space: PMSpacing.MD }) {
        if (this.decisionOld !== null && this.decisionNew !== null && this.requestedCaptureId === '' && this.memorySearchQuery.trim() === '' && this.selectedMemoryType === 'all') {
          ListItem() { this.DecisionEvolutionCard() }
        }
        // 空态不能用空白代替：区分「还没有记忆」和「当前筛选下没有记忆」
        if (this.requestedCaptureId === '' && this.getFilteredCards().length === 0 && this.memorySearchQuery.trim() === '') {
          ListItem() {
            Column() {
              Text(this.project.cards.length === 0 ? '这个项目还没有记忆' : '当前类型下没有记忆')
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
              Text(this.project.cards.length === 0 ?
                '记录第一条项目事实后，这里会生成带来源与时态状态的记忆卡。' :
                '换一个类型看看；这里不会用全部记忆替代你的筛选结果。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(19)
                .margin({ top: PMSpacing.XS })
              Button(this.project.cards.length === 0 ? '＋ 记录第一条事实' : '清空类型筛选').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(40)
                .margin({ top: PMSpacing.LG })
                .clickEffect(PMInteraction.PRESS_EFFECT)
                .onClick(() => {
                  if (this.project.cards.length === 0) {
                    this.openCaptureEntry();
                  } else {
                    this.selectMemoryType('all');
                  }
                })
            }
            .width('100%')
            .padding({
              top: PMSpacing.XXL,
              bottom: PMSpacing.XXL,
              left: PMSpacing.LG,
              right: PMSpacing.LG
            })
            .alignItems(HorizontalAlign.Start)
          }
        }

        ForEach(this.getFilteredCards(), (card: KnowledgeCard) => {
          ListItem() {
            Row({ space: 10 }) {
            Column() {
              Circle({ width: 12, height: 12 })
                .fill(PMColors.BACKGROUND)
                .stroke(card.type === 'risk' ? PMColors.RISK : PMColors.INK_SECONDARY)
                .strokeWidth(2)
            }.width(14).padding({ top: 20 })
            Column() {
              if (this.isDamagedMemoryCard(card)) {
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

                Text('请展开查看原始采集碎片并重新录入。')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .margin({ top: PMSpacing.XS })
              } else {
                Row() {
                  Row({ space: PMSpacing.XS }) {
                    MemoryTypeBadge({ type: card.type })
                  }
                  Text(card.createdAt.length >= 10 ? card.createdAt.substring(5, 10).replace('-', '/') : card.createdAt)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
                .width('100%')
                .justifyContent(FlexAlign.SpaceBetween)
                .alignItems(VerticalAlign.Center)

                Text(TextFormatters.readableText(card.title, '记忆标题无法读取，请重新录入。'))
                  .fontSize(16)
                  .lineHeight(24)
                  .fontWeight(card.topLevelState === 'SUPERSEDED' ? FontWeight.Regular : FontWeight.Medium)
                  .fontColor(card.topLevelState === 'SUPERSEDED' ? PMColors.INK_TERTIARY : PMColors.INK_PRIMARY)
                  .margin({ top: PMSpacing.SM })

                if (card.topLevelState !== undefined && card.reasonCode !== 'NO_SUPPORTING_EVIDENCE') {
                  Row({ space: 6 }) {
                    Circle({ width: 6, height: 6 })
                      .fill(card.topLevelState === 'CURRENT' ? PMColors.BRAND : card.topLevelState === 'CONTESTED' ? PMColors.RISK : card.topLevelState === 'SUPERSEDED' ? PMColors.INK_TERTIARY : PMColors.WARNING)
                    Text(card.topLevelState === 'CURRENT' ? '当前时态' : card.topLevelState === 'SUPERSEDED' ? '已被取代' : card.topLevelState === 'CONTESTED' ? '存在争议' : '待核验')
                      .fontSize(12).fontColor(PMColors.INK_SECONDARY)
                  }.margin({ top: 6 })
                }
                if (card.displayReason !== '' && (card.reasonCode !== 'NO_SUPPORTING_EVIDENCE' || this.expandedCardId === card.id)) {
                  Text(card.displayReason)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(card.topLevelState === 'SUPERSEDED' ? PMColors.INK_MUTED : PMColors.INK_TERTIARY)
                    .lineHeight(18)
                    .margin({ top: 2 })
                }

                if (TextFormatters.shouldShowSummary(card.title, card.summary)) {
                  Text(TextFormatters.readableText(card.summary, '这条记忆摘要无法读取，请重新录入。'))
                    .fontSize(PMFontSize.BODY)
                    .maxLines(this.expandedCardId === card.id ? 1000 : 2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)
                    .margin({ top: PMSpacing.XS })
                }
              }

              // 原始记录展开
              Row() {
                Text(this.expandedCardId === card.id ? '▾ 收起原始采集碎片' : '▸ 查看原始采集碎片')
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
              }
              .constraintSize({ minHeight: 40 }).padding({ top: PMSpacing.SM, bottom: PMSpacing.XS })
              .accessibilityText(this.expandedCardId === card.id ? '收起原始采集碎片' : '查看原始采集碎片')
              .accessibilityDescription(this.isDamagedMemoryCard(card) ? '该记忆需要修复，原始采集碎片仍可查看' : '展开查看这条记忆的来源与原始内容')
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.expandedCardId = this.expandedCardId === card.id ? '' : card.id;
              })

              if (this.expandedCardId === card.id && card.capture !== null && card.capture !== undefined) {
                Column() {
                  Text(TextFormatters.readableText(card.capture.rawText, '原始记录文本无法读取，请重新录入。'))
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text(`来源: ${card.capture.sourceType ?? '随手记录'}`)
                  Text(this.memoryService.captureModeLabel(card)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ top: PMSpacing.XS })
                }
                .width('100%')
                .padding(PMSpacing.MD)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .alignItems(HorizontalAlign.Start)
              }

              if (this.expandedCardId === card.id && card.attachment !== undefined && card.attachment !== null) {
                PMButton({ label: `查看附件原件：${card.attachment.fileName}`, secondary: true,
                  onAction: (): void => { this.openAttachment(card.attachment!.id); } })
              }
              // 生命周期操作：人工确认来源 / 归档（可恢复，双击防护）
              if (this.expandedCardId === card.id) {
                Row({ space: PMSpacing.SM }) {
                  Button(this.lifecycleActionCardId === card.id ? '处理中…' : '确认来源').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                    .height(36)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.BRAND)
                    .backgroundColor(PMColors.BRAND_LIGHT)
                    .borderRadius(PMRadius.SM)
                    .enabled(this.lifecycleActionCardId === '')
                    .onClick(() => {
                      this.confirmCardSource(card.id);
                    })

                  Button('归档').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                    .height(36)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_SECONDARY)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .enabled(this.lifecycleActionCardId === '')
                    .onClick(() => {
                      this.archiveMemoryCard(card.id);
                    })
                }
                .width('100%')
                .margin({ top: PMSpacing.SM })
              }
            }
            .layoutWeight(1)
            .padding(PMSpacing.LG)
            .backgroundColor(card.topLevelState === 'SUPERSEDED' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE)
            .borderRadius(16)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .alignItems(HorizontalAlign.Start)
            }.width('100%').alignItems(VerticalAlign.Top)
          }
        }, (card: KnowledgeCard) => card.id)
      }
      .layoutWeight(1)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD })
      .contentEndOffset(96)
      }
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  private getFilteredCards(): KnowledgeCard[] {
    if (this.requestedCaptureId !== '') {
      return this.project.cards.filter((card: KnowledgeCard) => card.captureId === this.requestedCaptureId);
    }
    if (this.memorySearchQuery.trim() !== '') {
      return this.memorySearchResults;
    }
    const q = this.memorySearchQuery.trim().toLowerCase();
    return this.project.cards.filter((c: KnowledgeCard) => {
      if (this.selectedMemoryType !== 'all' && c.type !== this.selectedMemoryType) {
        return false;
      }
      if (q === '') {
        return true;
      }
      return c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q);
    });
  }

  private isDamagedMemoryCard(card: KnowledgeCard): boolean {
    const rawText = card.capture !== undefined && card.capture !== null ? card.capture.rawText : '';
    return TextFormatters.isDamagedMemory(card.title, card.summary, rawText);
  }

  // ----------------------------------------------------
  // Tab 2: 待办 (Actions) 视图 —— 轻量状态栏与中文语义化
  // ----------------------------------------------------
  /** 行动文本搜索（标题+预期结果）与状态筛选相与；只作用于当前已加载列表。 */
  private actionMatches(action: ActionItem): boolean {
    const q = this.actionSearchQuery.trim().toLowerCase();
    if (q !== '') {
      const inTitle = (action.title ?? '').toLowerCase().includes(q);
      const inDesc = (action.description ?? '').toLowerCase().includes(q);
      if (!inTitle && !inDesc) { return false; }
    }
    return this.actionStatusFilter === 'ALL' || (this.actionStatusFilter === 'ACTIVE' ? action.status !== 'DONE' && action.status !== 'CANCELLED' : action.status === this.actionStatusFilter);
  }
  private dueLabel(action: ActionItem): string {
    const due = action.dueAt ?? '';
    if (due === '') return '未设截止';
    const days = Math.ceil((Date.parse(due) - Date.now()) / 86400000);
    if (Number.isNaN(days)) return '截止 ' + due.substring(5, 10);
    return days < 0 ? `已逾期 ${-days} 天` : days === 0 ? '今天截止' : `距截止 ${days} 天`;
  }
  private actionCount(status: string): number {
    return this.actions.filter((a: ActionItem) => !a.isSimulated && (status === 'ACTIVE' ? a.status !== 'DONE' && a.status !== 'CANCELLED' : a.status === status)).length;
  }
  @Builder
  private ActionRow(action: ActionItem) {
    Column() {
      Column({ space: 6 }) {
        Row({ space: 8 }) {
          StatusBadge({ status: action.status })
          if (action.isSimulated) { Text('演示情境').fontSize(11).fontColor(PMColors.RISK) }
          Blank()
          if (action.status !== 'DONE' && action.status !== 'CANCELLED') {
            Text(this.dueLabel(action)).fontSize(12)
              .fontColor(this.dueLabel(action).startsWith('已逾期') || this.dueLabel(action) === '今天截止' ? PMColors.RISK : (action.dueAt ?? '') !== '' ? PMColors.WARNING : PMColors.INK_TERTIARY)
          }
        }.width('100%')
        Text(TextFormatters.readableText(action.title, '行动标题无法读取，请重新录入。'))
          .fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        if ((action.description ?? '').trim() !== '') {
          Text('预期结果：' + (action.description ?? '')).fontSize(13).lineHeight(19).fontColor(PMColors.INK_SECONDARY)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        } else if (action.sourceIntervention !== null && action.sourceIntervention !== undefined && action.sourceIntervention.title !== '') {
          Text('来自提醒：' + TextFormatters.readableText(action.sourceIntervention.title, '提醒来源无法读取'))
            .fontSize(13).fontColor(PMColors.INK_SECONDARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 14, bottom: 14, left: 16, right: 16 })
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => { this.selectedActionId = action.id; })
        .accessibilityText(`行动：${action.title}，${this.dueLabel(action)}，点按查看详情与操作`)
      if (!action.isSimulated && (action.status === 'DOING' || action.status === 'TODO')) {
        Text(action.status === 'DOING' ? '填写完成回执' : (this.startingActionId === action.id ? '启动中…' : '开始行动'))
          .fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(action.status === 'DOING' ? PMColors.INK_PRIMARY : PMColors.BRAND)
          .width('100%').height(48).textAlign(TextAlign.Center)
          .border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .enabled(action.status === 'DOING' || this.startingActionId === '')
          .accessibilityText(action.status === 'DOING' ? '填写这条行动的完成回执' : '开始这条行动')
          .onClick(() => { if (action.status === 'DOING') { this.openCompleteDialog(action.id); } else { this.startAction(action.id); } })
      }
    }.width('100%').backgroundColor(action.status === 'DONE' || action.status === 'CANCELLED' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE)
      .borderRadius(16).border({ width: 1, color: PMColors.BORDER_SUBTLE }).clip(true)
  }
  @Builder
  private ActionView() {
    Column() {
      Column({ space: 8 }) {
        Row({ space: 6 }) {
          Text('行动').fontSize(22).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
          Button({ type: ButtonType.Circle }) { SearchIcon({ iconSize: 18 }) }
            .width(40).height(40).backgroundColor(Color.Transparent)
            .accessibilityText('搜索行动标题与预期结果')
            .onClick(() => { this.actionSearchOpen = !this.actionSearchOpen; })
          Button({ type: ButtonType.Circle }) { PlusIcon({ iconSize: 18 }) }
            .width(40).height(40).backgroundColor(Color.Transparent)
            .accessibilityText('手动新增待办').onClick(() => { this.openCreateAction(); })
          Button('更多', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).padding({ left: 10, right: 10 })
            .fontSize(13).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).borderRadius(10)
            .accessibilityText('更多操作：安排时间')
            .bindMenu([{
              value: '安排时间（行动安排页）',
              action: (): void => { router.pushUrl({ url: 'pages/ActionBoard', params: { projectId: this.projectId } }); }
            } as MenuElement])
        }.width('100%')
        if (this.actionSearchOpen) {
          Row({ space: 8 }) {
            TextInput({ text: this.actionSearchQuery, placeholder: '搜索标题与预期结果' })
              .fontSize(14).height(44).backgroundColor(PMColors.SURFACE).borderRadius(11)
              .border({ width: 1, color: PMColors.BORDER_SUBTLE }).layoutWeight(1)
              .accessibilityText('搜索行动')
              .onChange((value: string) => { this.actionSearchQuery = value; })
            Button({ type: ButtonType.Circle }) { CloseIcon({ iconSize: 16, iconColor: PMColors.INK_TERTIARY }) }
              .width(36).height(44).backgroundColor(Color.Transparent)
              .accessibilityText('关闭行动搜索并清空关键词')
              .onClick(() => { this.actionSearchOpen = false; this.actionSearchQuery = ''; })
          }.width('100%')
        } else if (this.actionSearchQuery.trim() !== '') {
          Row({ space: 8 }) {
            Text('搜索：' + this.actionSearchQuery).fontSize(12).fontColor(PMColors.BRAND)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            Text('清除').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).height(36)
              .accessibilityText('清除行动搜索关键词')
              .onClick(() => { this.actionSearchQuery = ''; })
          }.width('100%').padding({ left: 12, right: 12 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
        }
        Scroll() {
          Row({ space: 6 }) {
            ForEach(['ACTIVE', 'DOING', 'TODO', 'DONE', 'ALL'], (status: string) => {
              Button(status === 'ALL' ? '全部' : (status === 'ACTIVE' ? '待推进' : status === 'TODO' ? '待开始' : status === 'DOING' ? '进行中' : '已完成') + ' ' + this.actionCount(status), { type: ButtonType.Normal })
                .constraintSize({ minHeight: 44 }).padding({ left: 12, right: 12 }).fontSize(13).borderRadius(10)
                .fontColor(this.actionStatusFilter === status ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.actionStatusFilter === status ? PMColors.BRAND_LIGHT : Color.Transparent)
                .accessibilitySelected(this.actionStatusFilter === status).onClick(() => { this.actionStatusFilter = status; this.focusedActionId = ''; })
            })
          }.padding({ right: 16 })
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
      }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 2 }).alignItems(HorizontalAlign.Start)

      List({ space: PMSpacing.MD }) {
        if (this.focusedActionId !== '') {
          ListItem() {
            Button('查看全部待办').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).onClick(() => { this.focusedActionId = ''; }).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
          }
        }
        if (this.focusedActionId !== '' && !this.actions.some((item: ActionItem) => item.id === this.focusedActionId)) {
          ListItem() {
            Text('这项行动已移除或当前不可访问，可查看全部行动。').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
          }
        }
        if (this.selectedActionId !== '' && this.focusedActionId === '') {
          ListItem() {
            Row({ space: 8 }) {
              Text('‹ 返回行动列表').fontSize(13).fontColor(PMColors.BRAND).height(44)
                .onClick(() => { this.selectedActionId = ''; })
                .accessibilityText('返回行动列表')
              Blank()
            }.width('100%')
          }
        }
        if (this.selectedActionId === '' && this.focusedActionId === '' && this.actionSearchQuery.trim() !== '' &&
          !this.actions.some((item: ActionItem) => this.actionMatches(item))) {
          ListItem() {
            Text('没有匹配的行动；可清除搜索或更换状态筛选。').fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_SECONDARY).padding({ top: 12, bottom: 12 })
          }
        }
        if (this.selectedActionId === '' && this.focusedActionId === '') {
          ListItem() {
            Column({ space: 12 }) {
              ForEach(this.actions.filter((item: ActionItem) => this.actionMatches(item)), (action: ActionItem) => {
                this.ActionRow(action)
              }, (action: ActionItem) => action.id)
            }.width('100%')
          }
        }
        ForEach(this.actions.filter((item: ActionItem) => item.id === (this.focusedActionId !== '' ? this.focusedActionId : this.selectedActionId)), (action: ActionItem) => {
          ListItem() {
            Column() {
              Row() {
                StatusBadge({ status: action.status })
                if (action.isSimulated) {
                  Text('演示情境')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.RISK)
                    .margin({ left: PMSpacing.SM })
                }
                if (action.status !== 'DONE' && action.status !== 'CANCELLED') {
                  Text(TextFormatters.priorityToChinese(action.priority))
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Text(TextFormatters.readableText(action.title, '行动标题无法读取，请重新录入。'))
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ top: PMSpacing.SM })

      if ((action.description ?? '').trim() !== '') {
        Column({ space: 2 }) {
          Text('预期结果').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          Text(action.description ?? '').fontSize(14).lineHeight(21).fontColor(PMColors.INK_SECONDARY)
            .maxLines(this.expandedActionDescId === action.id ? 100 : 2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if ((action.description ?? '').length > 56) {
            Text(this.expandedActionDescId === action.id ? '收起 ⌃' : '展开全文 ⌄').fontSize(12).fontColor(PMColors.BRAND).height(32)
              .onClick(() => { this.expandedActionDescId = this.expandedActionDescId === action.id ? '' : action.id; })
          }
        }.width('100%').alignItems(HorizontalAlign.Start).margin({ top: 8 })
      }
      if ((action.dueAt ?? '') !== '') {
        Text(`截止：${(action.dueAt ?? '').substring(0, 10)}`).fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ top: 8 })
      }
              if (action.sourceIntervention !== null && action.sourceIntervention !== undefined && action.sourceIntervention.title !== '') {
                Text(`来源：${TextFormatters.readableText(action.sourceIntervention.title, '提醒来源无法读取')}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.EVIDENCE)
                  .margin({ top: 4 })
              }

              if (action.status === 'DONE' && action.resultText !== undefined && action.resultText !== null && action.resultText !== '') {
                Column() {
                  Text('完成回执')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SUCCESS)
                  Text(TextFormatters.readableText(action.resultText, '完成回执文本无法读取，请重新补充。'))
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_PRIMARY)
                    .margin({ top: 2 })
                }
                .width('100%')
                .padding(PMSpacing.SM)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                .alignItems(HorizontalAlign.Start)
                .margin({ top: PMSpacing.SM })
              }

              if (action.status === 'DONE' && !action.isSimulated && action.resultCardId !== undefined && action.resultCardId !== null && action.resultCardId !== '' &&
                action.resultCard !== null && action.resultCard !== undefined && action.resultCard.title !== '') {
                Row() {
                  SpineNodeIcon({ iconSize: 14, color: PMColors.SUCCESS })
                  Text('已闭环沉淀为项目记忆')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SUCCESS)
                    .margin({ left: 4 })
                }
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .backgroundColor(PMColors.SUCCESS_LIGHT)
                .borderRadius(PMRadius.XS)
                .margin({ top: PMSpacing.SM })
              }

              // 单待办日历提醒只有一套实现（ActionReminderBlock + ReminderService），
              // 项目页与行动安排页共用同一服务契约与状态文案；ActionItem.dueAt 是截止时间，不作为设备日历写入回执。
              if (this.reminderAvailable && this.actionReminderCardId === action.id) {
                ActionReminderBlock({
                  projectId: this.projectId,
                  actionId: action.id,
                  actionTitle: action.title,
                  reminderEnabled: this.reminderAvailable,
                  onClose: () => {
                    this.actionReminderCardId = '';
                  },
                  onChanged: () => {
                    this.loadAllData(true);
                  }
                })
              }
              if (action.status === 'TODO' || action.status === 'DOING') {
                Column({ space: PMSpacing.SM }) {
                  // 主操作按状态唯一：TODO 先开始；DOING 直接完成。开始不是完成的先决条件。
                  if (action.status === 'TODO') {
                    Button(this.startingActionId === action.id ? '启动中...' : '开始行动').type(ButtonType.Normal)
                      .borderRadius(PMRadius.MD)
                      .fontSize(PMFontSize.BUTTON)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.SURFACE)
                      .backgroundColor(PMColors.BRAND)
                      .height(48)
                      .width('100%')
                      .enabled(this.startingActionId === '')
                      .accessibilityText('开始这条行动')
                      .onClick(() => {
                        this.startAction(action.id);
                      })
                  } else {
                    Button('完成并回执').type(ButtonType.Normal)
                      .borderRadius(PMRadius.MD)
                      .fontSize(PMFontSize.BUTTON)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.SURFACE)
                      .backgroundColor(PMColors.BRAND)
                      .height(48)
                      .width('100%')
                      .accessibilityText('填写完成回执')
                      .onClick(() => { this.openCompleteDialog(action.id); })
                  }
                  Row({ space: PMSpacing.MD }) {
                    if (action.status === 'TODO') {
                      Text('直接填写完成回执').fontSize(13).fontColor(PMColors.INK_SECONDARY).height(40)
                        .accessibilityText('不开始行动，直接填写完成回执')
                        .onClick(() => { this.openCompleteDialog(action.id); })
                    }
                    if (this.reminderAvailable) {
                      Blank()
                      Text(this.actionReminderCardId === action.id ? '收起提醒设置 ⌃' : '日历提醒').fontSize(13)
                        .fontColor(PMColors.INK_SECONDARY).height(40)
                        .accessibilityDescription('打开这条待办的日历提醒设置')
                        .onClick(() => {
                          this.actionReminderCardId = this.actionReminderCardId === action.id ? '' : action.id;
                        })
                    }
                  }.width('100%')
                  if (!action.isSimulated && this.editingActionId !== action.id && this.confirmCancelActionId !== action.id) {
                    Row({ space: PMSpacing.MD }) {
                      Text('编辑').fontSize(13).fontColor(PMColors.INK_SECONDARY).height(40)
                        .accessibilityText('编辑行动标题与预期结果')
                        .onClick(() => { this.beginEditAction(action); })
                      Text('不再需要').fontSize(13).fontColor(PMColors.INK_SECONDARY).height(40)
                        .accessibilityText('取消这项行动')
                        .onClick(() => { this.editingActionId = ''; this.actionEditError = ''; this.confirmCancelActionId = action.id; })
                    }.width('100%')
                  }
                  if (this.editingActionId === action.id) {
                    Column({ space: PMSpacing.SM }) {
                      TextInput({ text: this.editActionTitle, placeholder: '行动标题' })
                        .fontSize(14).height(44).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11)
                        .maxLength(160).enabled(!this.actionEditBusy)
                        .accessibilityText('行动标题')
                        .onChange((value: string) => { this.editActionTitle = value; })
                      TextArea({ text: this.editActionDescription, placeholder: '预期结果（选填）' })
                        .fontSize(14).constraintSize({ minHeight: 72 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11)
                        .maxLength(500).enabled(!this.actionEditBusy)
                        .accessibilityText('预期结果')
                        .onChange((value: string) => { this.editActionDescription = value; })
                      Row({ space: PMSpacing.SM }) {
                        PMButton({ label: this.actionEditBusy ? '正在保存…' : '保存', disabled: this.actionEditBusy,
                          onAction: (): void => { this.saveActionEdit(action.id); } }).layoutWeight(1)
                        PMButton({ label: '放弃修改', secondary: true, disabled: this.actionEditBusy,
                          onAction: (): void => { this.editingActionId = ''; this.actionEditError = ''; } }).layoutWeight(1)
                      }.width('100%')
                    }.width('100%')
                  }
                  if (this.confirmCancelActionId === action.id) {
                    Column({ space: PMSpacing.SM }) {
                      Text('确定不再需要这项行动？它会标为已取消，来源与历史记录保留。')
                        .fontSize(13).lineHeight(19).fontColor(PMColors.INK_PRIMARY)
                      Row({ space: PMSpacing.SM }) {
                        PMButton({ label: this.actionEditBusy ? '正在取消…' : '确定取消', disabled: this.actionEditBusy,
                          onAction: (): void => { this.cancelAction(action.id); } }).layoutWeight(1)
                        PMButton({ label: '保留', secondary: true, disabled: this.actionEditBusy,
                          onAction: (): void => { this.confirmCancelActionId = ''; } }).layoutWeight(1)
                      }.width('100%')
                    }.width('100%').padding(PMSpacing.MD).backgroundColor(PMColors.RISK_LIGHT).borderRadius(PMRadius.MD)
                  }
                  if (this.actionEditError !== '' && (this.editingActionId === action.id || this.confirmCancelActionId === action.id)) {
                    Text(this.actionEditError).fontSize(13).fontColor(PMColors.RISK)
                  }
                }
                .width('100%')
                .margin({ top: PMSpacing.MD })
              }
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(action.status === 'DONE' || action.status === 'CANCELLED' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE)
            .borderRadius(PMRadius.LG)
            .border({ width: 1, color: action.status === 'DONE' || action.status === 'CANCELLED' ? PMColors.BORDER_SUBTLE : PMColors.BORDER })
            .shadow({ radius: 6, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
            .alignItems(HorizontalAlign.Start)
          }
        }, (action: ActionItem) => action.id)
      }
      .layoutWeight(1)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD })
      .contentEndOffset(96)
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  // ----------------------------------------------------
  // Tab 3: 问忆程 (Copilot) 视图 —— 结构化证据回答与项目上下文
  // ----------------------------------------------------
  @Builder
  private CopilotEmptyState() {
    Column() {
      CopilotIcon({ isSelected: false, iconSize: 28 })
        .margin({ bottom: PMSpacing.MD })

      Text('暂无对话')
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)

      Text(`我会根据当前项目的 ${this.project._count.cards} 条记忆、${this.actions.filter((a) => !a.isSimulated && a.status === 'DONE').length} 项已完成行动和已有成果回答。`)
        .fontSize(PMFontSize.BODY)
        .fontColor(PMColors.INK_SECONDARY)
        .textAlign(TextAlign.Center)
        .lineHeight(22)
        .margin({ top: PMSpacing.SM })

      Text('回答会尽量附带可追溯的记忆依据。')
        .fontSize(PMFontSize.SECONDARY)
        .fontColor(PMColors.MEMORY)
        .textAlign(TextAlign.Center)
        .margin({ top: PMSpacing.XS })
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL })
  }

  // ----------------------------------------------------
  @Builder
  private MissionView() {
    if (this.showQuickCopilot) {
      Column() {
        Button('返回委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.SURFACE).fontColor(PMColors.BRAND)
          .onClick(() => { this.showQuickCopilot = false; })
        this.CopilotView()
      }.layoutWeight(1).width('100%').align(Alignment.TopStart)
    } else {
      Scroll() {
        Column({ space: PMSpacing.MD }) {
          // 问忆程入口由页面右下角悬浮胶囊承担，这里不再放置重复的提问卡片。
          PMPageIntro({ compact: true, title: '长期委托', description: '交给忆程一个目标，持续推进、补充材料并审阅成果。' })
          PMButton({ label: '＋ 新建长期委托', onAction: (): void => {
            router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, mode: 'create' } });
          } })
          MissionPanel({ projectId: this.projectId, refreshKey: this.missionRefreshKey })
        }.padding(PMSpacing.MD).width('100%').justifyContent(FlexAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).align(Alignment.TopStart).scrollBar(BarState.Off)
    }
  }

  @Builder
  private CopilotView() {
    Column() {
      // 问忆程项目上下文看板 (避免空白页面)
      Column() {
        Text('问忆程')
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)

        Text(`可检索 ${this.project._count.cards} 条项目记忆、${this.actions.filter((a) => !a.isSimulated && a.status === 'DONE').length} 项已完成行动。回答会区分已知事实与缺失依据。`)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ top: 3 })
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .alignItems(HorizontalAlign.Start)

      // 常用问题快捷推荐：Compact Suggestion Chips 横向滚动，紧凑不占屏
      Scroll() {
        Row({ space: PMSpacing.SM }) {
          Text('现在进展怎么样？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .borderRadius(PMRadius.FULL)
            .height(32)
            .padding({ left: 12, right: 12 })
            .textAlign(TextAlign.Center)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.copilotQuestion = '总结当前项目的真实进展与已完成事实';
              this.sendCopilotMessage();
            })

          Text('消融实验完成了吗？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .borderRadius(PMRadius.FULL)
            .height(32)
            .padding({ left: 12, right: 12 })
            .textAlign(TextAlign.Center)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.copilotQuestion = '检查当前项目中消融实验相关的记录和结果';
              this.sendCopilotMessage();
            })

          Text('为什么提醒我？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .border({ width: 1, color: PMColors.BRAND_LIGHT })
            .borderRadius(PMRadius.FULL)
            .height(32)
            .padding({ left: 12, right: 12 })
            .textAlign(TextAlign.Center)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.copilotQuestion = '为什么当前项目会触发提醒？依据是什么？';
              this.sendCopilotMessage();
            })

          Text('最近完成了什么？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .borderRadius(PMRadius.FULL)
            .height(32)
            .padding({ left: 12, right: 12 })
            .textAlign(TextAlign.Center)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.copilotQuestion = '最近完成了哪些待办行动和回执？';
              this.sendCopilotMessage();
            })
        }
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
      }
      .scrollable(ScrollDirection.Horizontal)
      .align(Alignment.TopStart).scrollBar(BarState.Off)
      .width('100%')
      .margin({ top: PMSpacing.SM, bottom: PMSpacing.SM })

      if (this.isAskingCopilot) {
        Row() {
          LoadingProgress()
            .width(20)
            .height(20)
            .color(PMColors.BRAND)
          Text('正在检索项目证据…')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ left: PMSpacing.SM })
        }
        .width('100%')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
        .justifyContent(FlexAlign.Center)
      }

      if (this.chatMessages.length === 0 && !this.isAskingCopilot) {
        this.CopilotEmptyState()
      } else if (this.chatMessages.length > 0) {
        // 对话消息列表
        List({ space: PMSpacing.MD }) {
        ForEach(this.chatMessages, (msg: AgentMessage, idx: number) => {
          ListItem() {
            Column() {
              Row() {
                Text(msg.role === 'USER' ? '你' : '忆程')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(msg.role === 'USER' ? PMColors.INK_SECONDARY : PMColors.BRAND)
              }
              .width('100%')

              Text(TextFormatters.readableText(msg.content, '问忆程回复文本无法读取，请重新提问。'))
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
                .margin({ top: 4 })

              // W05 Evidence Trust Receipt：状态用文字 + 颜色双重表达，拒答时不伪装成成功答案。
              if (msg.role === 'ASSISTANT' && msg.trustReceipt !== undefined && msg.trustReceipt !== null) {
                Column() {
                  Row() {
                    Text(msg.trustReceipt.supportState === 'SUPPORTED' ? '引用可用 · 语义另行核验' :
                      msg.trustReceipt.supportState === 'CONTESTED' ? '存在冲突' : '证据不足')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(msg.trustReceipt.supportState === 'SUPPORTED' ? PMColors.SUCCESS :
                        msg.trustReceipt.supportState === 'CONTESTED' ? PMColors.EVIDENCE : PMColors.RISK)
                      .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
                      .backgroundColor(msg.trustReceipt.supportState === 'SUPPORTED' ? PMColors.SUCCESS_LIGHT :
                        msg.trustReceipt.supportState === 'CONTESTED' ? PMColors.EVIDENCE_LIGHT : PMColors.RISK_LIGHT)
                      .borderRadius(PMRadius.FULL)
                      .accessibilityText(`证据支持状态：${msg.trustReceipt.supportState === 'SUPPORTED' ? '引用可用 · 语义另行核验' :
                        msg.trustReceipt.supportState === 'CONTESTED' ? '存在冲突' : '证据不足'}`)

                    Blank()

                    Button(this.expandedCopilotReceiptId === (msg.runId ?? `message-${idx}`) ? '收起回执' : '查看证据回执').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND)
                      .backgroundColor(Color.Transparent)
                      .onClick(() => {
                        const receiptId = msg.runId ?? `message-${idx}`;
                        this.expandedCopilotReceiptId = this.expandedCopilotReceiptId === receiptId ? '' : receiptId;
                      })
                  }
                  .width('100%')
                  .margin({ top: PMSpacing.SM })

                  if (msg.trustReceipt.supportState !== 'SUPPORTED') {
                    Text(`缺失依据：${msg.trustReceipt.refusalReason !== undefined && msg.trustReceipt.refusalReason !== null && msg.trustReceipt.refusalReason !== '' ? msg.trustReceipt.refusalReason : '现有资料不足以支持这项结论。'}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_SECONDARY)
                      .lineHeight(18)
                      .margin({ top: PMSpacing.SM })
                    Button('查看项目资料').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                      .height(40).fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT)
                      .borderRadius(PMRadius.MD)
                      .margin({ top: PMSpacing.XS })
                      .onClick(() => { this.currentTabIndex = 1; })
                  }

                  if (this.expandedCopilotReceiptId === (msg.runId ?? `message-${idx}`)) {
                    Column({ space: PMSpacing.SM }) {
                      Text(`检索方式：${msg.trustReceipt.retrievalMode === 'hybrid' ? '混合检索' :
                        msg.trustReceipt.retrievalMode === 'keyword_fallback' ? '关键词降级' :
                          msg.trustReceipt.retrievalMode === 'semantic_only' ? '语义检索' :
                            msg.trustReceipt.retrievalMode === 'project_state' ? '项目当前状态' : '未检索到证据'}`)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_SECONDARY)

                      ForEach(msg.trustReceipt.claims, (claim: EvidenceClaim, claimIndex: number) => {
                        Column() {
                          Text(`结论 ${claimIndex + 1} · ${claim.support === 'SUPPORTED' ? '引用可用 · 语义另行核验' : claim.support === 'CONTESTED' ? '存在冲突' : '证据不足'}`)
                            .fontSize(PMFontSize.CAPTION)
                            .fontWeight(FontWeight.Medium)
                            .fontColor(PMColors.INK_PRIMARY)
                          if (claim.assessments !== undefined && claim.assessments !== null && claim.assessments.length > 0) {
                            ForEach(claim.assessments, (assessment: EvidenceAssessment) => {
                              Text(evidenceAssessmentText(assessment))
                                .fontSize(PMFontSize.CAPTION)
                                .fontColor(PMColors.INK_SECONDARY)
                                .lineHeight(18)
                              Text(`来源版本：${assessment.sourceRevision || '未提供'}`)
                                .fontSize(PMFontSize.CAPTION)
                                .fontColor(PMColors.INK_SECONDARY)
                            }, (assessment: EvidenceAssessment) => assessment.sourceId)
                          } else {
                            Text('语义尚未核验').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
                          }
                          Text(claim.text)
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.INK_SECONDARY)
                            .lineHeight(18)
                            .margin({ top: 2 })
                          if (claim.projectRefs !== undefined && claim.projectRefs !== null) {
                            ForEach(claim.projectRefs, (ref: ProjectEvidenceRef) => {
                              Text(`${ref.label}：${ref.detail}`)
                                .fontSize(PMFontSize.CAPTION)
                                .fontColor(PMColors.MEMORY)
                                .margin({ top: 2 })
                            }, (ref: ProjectEvidenceRef) => `${ref.kind}-${ref.entityId}`)
                          }
                        }
                        .width('100%')
                        .padding(PMSpacing.SM)
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.SM)
                        .alignItems(HorizontalAlign.Start)
                      }, (claim: EvidenceClaim, claimIndex: number) => `claim-${claimIndex}`)

                      if (msg.citations.length > 0) {
                        Text('原始证据卡片')
                          .fontSize(PMFontSize.CAPTION)
                          .fontWeight(FontWeight.Medium)
                          .fontColor(PMColors.MEMORY)
                        ForEach(msg.citations, (cite: AgentCitation) => {
                          Column() {
                            Text(cite.title)
                              .fontSize(PMFontSize.CAPTION)
                              .fontWeight(FontWeight.Medium)
                              .fontColor(PMColors.MEMORY)
                            Text(cite.excerpt)
                              .fontSize(PMFontSize.CAPTION)
                              .fontColor(PMColors.INK_SECONDARY)
                              .lineHeight(18)
                              .margin({ top: 2 })
                          }
                          .width('100%')
                          .padding(PMSpacing.SM)
                          .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                          .borderRadius(PMRadius.SM)
                          .alignItems(HorizontalAlign.Start)
                          .constraintSize({ minHeight: 44 }).onClick(() => { this.currentTabIndex = 1; this.materialsMode = 'memory'; this.memorySearchQuery = ''; this.selectedMemoryType = 'all'; this.expandedCardId = cite.cardId; })
                          .accessibilityText(`查看来源记忆：${cite.title}`)
                        }, (cite: AgentCitation) => cite.cardId)
                      }

                      if (msg.trustReceipt.refusalReason !== undefined && msg.trustReceipt.refusalReason !== null && msg.trustReceipt.refusalReason !== '') {
                        Text(`拒答原因：${msg.trustReceipt.refusalReason}`)
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.RISK)
                          .lineHeight(18)
                      }
                    }
                    .width('100%')
                    .padding(PMSpacing.SM)
                    .margin({ top: PMSpacing.SM })
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .alignItems(HorizontalAlign.Start)
                  }
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }

              // 引用证据结构化展示 (替换原本的纯点号文本列表)
              if (msg.citations.length > 0 && msg.trustReceipt === undefined) {
                Column({ space: PMSpacing.XS }) {
                  Row() {
                    Text('引用依据')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(PMColors.INK_SECONDARY)
                    Text(`(${msg.citations.length} 条)`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                      .margin({ left: 4 })
                  }
                  .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

                  ForEach(msg.citations, (cite: AgentCitation) => {
                    EvidenceItemView({
                      title: TextFormatters.readableText(cite.title, '记忆依据'),
                      sourceLabel: '项目记忆',
                      iconType: 'memory'
                    })
                  }, (cite: AgentCitation) => cite.cardId)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }

              // 建议行动与两步确认
              if (msg.proposedActions.length > 0 && (msg.trustReceipt === undefined || msg.trustReceipt.supportState === 'SUPPORTED')) {
                Column({ space: PMSpacing.XS }) {
                  Row() {
                    Text('建议下一步（需人工确认）')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(PMColors.BRAND)
                  }
                  .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

                  ForEach(msg.proposedActions, (act: ProposedAction) => {
                    Row() {
                      Column() {
                        Text(act.title)
                          .fontSize(PMFontSize.BODY)
                          .fontWeight(FontWeight.Medium)
                          .fontColor(PMColors.INK_PRIMARY)
                          .maxLines(2)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                      }
                      .layoutWeight(1)
                      .alignItems(HorizontalAlign.Start)

                      Button(this.executingToolTitle === act.title ? '执行中...' : '确认执行').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                        .fontSize(PMFontSize.BUTTON)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.SURFACE)
                        .backgroundColor(PMColors.BRAND)
                        .borderRadius(PMRadius.SM)
                        .height(36)
                        .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
                        .enabled(this.executingToolTitle === '')
                        .margin({ left: PMSpacing.MD })
                        .onClick(() => {
                          this.confirmCopilotTool(act, msg.runId);
                        })
                    }
                    .width('100%')
                    .padding(PMSpacing.MD)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.MD)
                    .border({ width: 1, color: PMColors.BORDER })
                  }, (act: ProposedAction) => act.title)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }
              if (msg.runId === this.sourceConversationRun) { Text('原委托的来源对话').fontSize(12).fontColor(PMColors.BRAND) }
              if (msg.continuationSuggestion !== undefined) { CopilotContinuationCard({ suggestion: msg.continuationSuggestion }) }
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(msg.role === 'USER' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE)
            .borderRadius(PMRadius.LG)
            .border({ width: 1, color: msg.role === 'USER' ? PMColors.BORDER_SUBTLE : PMColors.BORDER })
            .shadow({ radius: 6, color: 'rgba(19, 36, 58, 0.03)', offsetX: 0, offsetY: 1 })
            .alignItems(HorizontalAlign.Start)
          }
        }, (msg: AgentMessage, idx: number) => `msg-${idx}`)
        }
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
      }

      if (this.copilotFeedback !== '') {
        Text(this.copilotFeedback)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.copilotFeedback.indexOf('失败') >= 0 || this.copilotFeedback.indexOf('无法') >= 0 ? PMColors.RISK : PMColors.INK_TERTIARY)
          .margin({ bottom: 4 })
          .accessibilityText(`问忆程状态：${this.copilotFeedback}`)
      }

      // 输入行
      Row() {
        TextInput({ text: this.copilotQuestion, placeholder: '问项目进展、历史依据或下一步…' })
          .onChange((value: string) => {
            this.copilotQuestion = value;
          })
          .fontSize(PMFontSize.BODY)
          .layoutWeight(1)
          .height(42)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.SM)
          .border({ width: 1, color: PMColors.BORDER })
          .accessibilityText('输入项目问题')

        Button(this.isAskingCopilot ? '思考中...' : '发送').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(this.copilotQuestion.trim() !== '' && !this.isAskingCopilot ? PMColors.BRAND : PMColors.INK_MUTED)
          .borderRadius(PMRadius.SM)
          .margin({ left: PMSpacing.SM })
          .enabled(this.copilotQuestion.trim() !== '' && !this.isAskingCopilot)
          .accessibilityText(this.isAskingCopilot ? '正在发送问题' : '发送项目问题')
          .onClick(() => {
            this.sendCopilotMessage();
          })
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.MD })
      .backgroundColor(PMColors.SURFACE_SUBTLE)
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  // ----------------------------------------------------
  // Tab 4: 成果 (Artifacts) 视图 —— 消除重复 CTA
  // ----------------------------------------------------
  @Builder
  private ArtifactReaderHeader() {
    Row() {
      Row() {
        Text('‹')
          .fontSize(22)
          .fontColor(PMColors.INK_PRIMARY)
          .margin({ right: 3, top: -2 })
        Text('成果')
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
      }
      .height(44)
      .padding({ left: PMSpacing.SM, right: PMSpacing.MD, top: PMSpacing.XS, bottom: PMSpacing.XS })
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .border({ width: 1, color: PMColors.BORDER })
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        this.isArtifactReader = false;
      })
      .accessibilityText('返回成果列表')

      Column() {
        Text(TextFormatters.artifactTypeToChinese(this.selectedArtifactType))
          .fontSize(PMFontSize.PAGE_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.project.title !== '' ? TextFormatters.readableText(this.project.title, '项目档案') : '项目档案')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_TERTIARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 2 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ left: PMSpacing.MD })

      Text('阅读')
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.BRAND)
        .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: PMSpacing.SM, bottom: PMSpacing.SM })
        .accessibilityText('成果阅读模式')
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }

  @Builder
  private ArtifactReaderContent() {
    Scroll() {
      Column() {
        Row() {
          Column() {
            Text(TextFormatters.artifactTypeToChinese(this.selectedArtifactType))
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
            Text('成果草稿 · 待人工复核；保存不代表已交付')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.WARNING)
              .margin({ top: PMSpacing.XS })
            Text(`最后生成于 ${this.currentArtifact !== undefined && this.currentArtifact.createdAt.length >= 10 ? this.currentArtifact.createdAt.substring(0, 10) : '近期'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 2 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        Row({ space: PMSpacing.SM }) {
            Button('证据透视').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.XS)
              .height(36)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
              .onClick(() => {
                this.showClaimAuditor = true;
              })

            Button('评委质询').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.RISK)
              .backgroundColor(PMColors.RISK_LIGHT)
              .borderRadius(PMRadius.XS)
              .height(36)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
              .onClick(() => {
                this.showJudgeRebuttal = true;
              })
        }.width('100%').margin({ top: PMSpacing.MD })

        Button(this.isExportingProvenance ? '导出中…' : '带存证导出').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.XS)
              .height(36)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
              .width('100%')
              .margin({ top: PMSpacing.SM })
              .enabled(!this.isExportingProvenance)
              .onClick(() => {
                this.copyArtifactWithProvenance();
              })


        Text(this.project.title !== '' ? TextFormatters.readableText(this.project.title, '项目档案') : '项目档案')
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.MD })

        if (this.currentArtifact !== undefined && this.currentArtifact.content !== '') {
          MarkdownView({ content: TextFormatters.readableMarkdown(this.currentArtifact.content) })
        } else {
          EmptyStateView({
            title: '成果内容暂不可用',
            description: '返回成果列表后重新选择或生成。',
            actionText: '返回成果列表',
            onAction: () => {
              this.isArtifactReader = false;
            }
          })
        }
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 18, bottom: PMSpacing.SECTION })
      .backgroundColor(PMColors.SURFACE)
      .alignItems(HorizontalAlign.Start)
    }
    .layoutWeight(1)
    .backgroundColor(PMColors.BACKGROUND)
    .align(Alignment.TopStart).scrollBar(BarState.Off)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  @Builder
  private ArtifactView() {
    if (this.isArtifactReader && this.currentArtifact !== undefined && this.currentArtifact.content !== '') {
      this.ArtifactReaderContent()
    } else {
      Column() {
      Column() {
        PMPageIntro({ compact: true, title: '成果草稿', description: `${this.artifacts.length} 份已保存 · 待人工复核` })
      }.width('100%').padding({ left: 16, right: 16, top: 16 })
      // 4 大成果类型切换
      Row() {
        Button('作品说明').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'competition_outline' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'competition_outline' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .height(44)
          .padding({ left: PMSpacing.XS, right: PMSpacing.XS, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .layoutWeight(1)
          .accessibilityText('选择作品说明成果')
          .accessibilitySelected(this.selectedArtifactType === 'competition_outline')
          .onClick(() => {
            this.selectedArtifactType = 'competition_outline';
            this.updateCurrentArtifact();
            this.isArtifactReader = false;
          })

        Button('答辩 PPT').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'defense_ppt' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'defense_ppt' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .height(44)
          .padding({ left: PMSpacing.XS, right: PMSpacing.XS, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .accessibilityText('选择答辩 PPT 成果')
          .accessibilitySelected(this.selectedArtifactType === 'defense_ppt')
          .onClick(() => {
            this.selectedArtifactType = 'defense_ppt';
            this.updateCurrentArtifact();
            this.isArtifactReader = false;
          })

        Button('项目周报').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'weekly_report' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'weekly_report' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .height(44)
          .padding({ left: PMSpacing.XS, right: PMSpacing.XS, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .accessibilityText('选择项目周报成果')
          .accessibilitySelected(this.selectedArtifactType === 'weekly_report')
          .onClick(() => {
            this.selectedArtifactType = 'weekly_report';
            this.updateCurrentArtifact();
            this.isArtifactReader = false;
          })

        Button('README').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'readme' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'readme' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .height(44)
          .padding({ left: PMSpacing.XS, right: PMSpacing.XS, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .accessibilityText('选择 README 成果')
          .accessibilitySelected(this.selectedArtifactType === 'readme')
          .onClick(() => {
            this.selectedArtifactType = 'readme';
            this.updateCurrentArtifact();
            this.isArtifactReader = false;
          })
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })

      if (this.artifactError !== '') {
        Text(this.artifactError)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.RISK)
          .margin({ bottom: PMSpacing.XS })
      }

      // 成果内容展示区
      Scroll() {
        Column() {
          if (this.artifacts.filter((a: ArtifactItem) => a.artifactType === this.selectedArtifactType).length > 0) {
            Column() {
              Text('已保存版本').fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).padding(14)
              ForEach(this.artifacts.filter((a: ArtifactItem) => a.artifactType === this.selectedArtifactType), (item: ArtifactItem) => {
                PMListRow({ title: TextFormatters.artifactTypeToChinese(item.artifactType), subtitle: '待人工复核', meta: new Date(item.createdAt).toLocaleString('zh-CN'),
                  status: this.currentArtifact?.id === item.id ? '选中' : '', onOpen: (): void => { this.currentArtifact = item; this.isArtifactReader = true; } })
              }, (item: ArtifactItem) => item.id)
            }.width('100%').backgroundColor(PMColors.SURFACE).borderRadius(18).alignItems(HorizontalAlign.Start).margin({ bottom: 16 })
          }
          if (this.currentArtifact !== undefined && this.currentArtifact.content !== '') {
            Column({ space: 12 }) {
              PMButton({ label: '阅读选中草稿 →', onAction: (): void => { this.isArtifactReader = true; } })
              Row({ space: 10 }) {
                PMButton({ label: '复制正文', secondary: true, onAction: (): void => { this.copyArtifactContent(); } }).layoutWeight(1)
                PMButton({ label: this.isGeneratingArtifact ? '生成中…' : '生成新版本', secondary: true, disabled: this.isGeneratingArtifact,
                  onAction: (): void => { this.generateArtifact(); } }).layoutWeight(1)
              }.width('100%')
            }.width('100%').padding(16).backgroundColor(PMColors.SURFACE).borderRadius(18)
          } else {
            // 成果中心引导式生成卡片 (替换苍白空状态)
            Column() {
              Row() {
                Row() {
                  ArtifactIcon({ isSelected: true, iconSize: 24 })
                }
                .width(48)
                .height(48)
                .borderRadius(PMRadius.MD)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .justifyContent(FlexAlign.Center)
                .margin({ right: PMSpacing.MD })

                Column() {
                  Text(TextFormatters.artifactTypeToChinese(this.selectedArtifactType))
                    .fontSize(PMFontSize.PRIMARY_JUDGEMENT)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text(this.selectedArtifactType === 'competition_outline' ? '面向赛事评审的作品结构与设计说明草案' :
                    this.selectedArtifactType === 'defense_ppt' ? '提取项目核心论点与成果支撑的答辩框架' :
                      this.selectedArtifactType === 'weekly_report' ? '总结阶段进展、闭环行动与下阶段计划' : '项目开源展示与快速上手文档')
                    .fontSize(PMFontSize.SECONDARY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .margin({ top: 2 })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              // 生成依据与支撑维度
              Column({ space: PMSpacing.MD }) {
                // 数量只能说明有多少可整理的材料，不能证明某份成果的结论已得到支持；
                // 计数只在下方的事实卡出现一次，避免同屏重复
                Text('将基于当前项目事实：')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.INK_SECONDARY)
                  .width('100%')

                // 2x2 事实支撑小卡片
                Row({ space: PMSpacing.SM }) {
                  Row() {
                    MemoryIcon({ isSelected: false, iconSize: 14 })
                    Text(`${this.project._count.cards} 条项目记忆`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_PRIMARY)
                      .margin({ left: 4 })
                  }
                  .layoutWeight(1)
                  .padding(8)
                  .backgroundColor(PMColors.SURFACE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER_SUBTLE })

                  Row() {
                    CheckIcon({ iconSize: 14, color: PMColors.SUCCESS })
                    Text(`${this.actions.filter((a) => !a.isSimulated && a.status === 'DONE').length} 个完成行动`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_PRIMARY)
                      .margin({ left: 4 })
                  }
                  .layoutWeight(1)
                  .padding(8)
                  .backgroundColor(PMColors.SURFACE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                }
                .width('100%')

                Row({ space: PMSpacing.SM }) {
                  Row() {
                    AlertIcon({ iconSize: 14, color: PMColors.RISK })
                    Text(`${this.interventions.filter((i) => i.status === 'OPEN' && !i.isSimulated).length} 项当前提醒`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_PRIMARY)
                      .margin({ left: 4 })
                  }
                  .layoutWeight(1)
                  .padding(8)
                  .backgroundColor(PMColors.SURFACE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER_SUBTLE })

                  Row() {
                    Text('项目内准备项')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                    Text(this.dashboard.readiness.items.length === 0 ? '暂无口径' : `${this.dashboard.readiness.percentage}%`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(PMColors.BRAND)
                      .margin({ left: 4 })
                  }
                  .layoutWeight(1)
                  .padding(8)
                  .backgroundColor(PMColors.SURFACE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                }
                .width('100%')

                // 核心生成章节一览
                Column({ space: 4 }) {
                  Text('将提取并生成四个核心结构：')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                  Flex({ wrap: FlexWrap.Wrap }) {
                    Text('● 阶段进展')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND)
                      .margin({ right: PMSpacing.SM, bottom: 2 })
                    Text('● 关键决策')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND)
                      .margin({ right: PMSpacing.SM, bottom: 2 })
                    Text('● 风险与缺口')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND)
                      .margin({ right: PMSpacing.SM, bottom: 2 })
                    Text('● 下一步建议')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.BRAND)
                      .margin({ right: PMSpacing.SM, bottom: 2 })
                  }
                  .width('100%')
                }
                .width('100%')
                .padding(PMSpacing.SM)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .borderRadius(PMRadius.SM)
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.MD)
              .margin({ top: PMSpacing.MD })

              Button(this.isGeneratingArtifact ? '正在基于事实生成成果...' : `生成${TextFormatters.artifactTypeToChinese(this.selectedArtifactType)}`).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(48)
                .width('100%')
                .margin({ top: PMSpacing.LG })
                .enabled(!this.isGeneratingArtifact)
                .onClick(() => {
                  this.generateArtifact();
                })
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.LG)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
            .alignItems(HorizontalAlign.Start)
          }
        }
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, bottom: PMSpacing.LG })
        .justifyContent(FlexAlign.Start)
      }
      .layoutWeight(1)
      .align(Alignment.Top)
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
    }
  }

  // ----------------------------------------------------
  // 主构建入口
  // ----------------------------------------------------
  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Column() {
        if (this.currentTabIndex === 4 && this.isArtifactReader) {
          this.ArtifactReaderHeader()
        } else {
          this.TopHeader()
        }

        if (this.routeError !== '') {
          ErrorStateView({
            message: this.routeError,
            onRetry: () => {
              router.back();
            }
          })
        } else if (this.isLoading && !this.hasLoadedProjectSnapshot) {
          Column() { LoadingStateView({ message: '正在同步项目档案...' }) }.width('100%').layoutWeight(1)
        } else if (this.errorMessage !== '' && !this.hasLoadedProjectSnapshot) {
          ErrorStateView({
            message: this.errorMessage,
            onRetry: () => {
              this.loadAllData();
            }
          })
        } else {
          if (this.hasLoadedProjectSnapshot && (this.isLoading || this.errorMessage !== '')) {
            Row({ space: PMSpacing.SM }) {
              Text(this.isLoading ? '正在核对最新项目状态…' : '同步未完成，当前显示已有快照；请重试核对最新状态。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .layoutWeight(1)
                .maxLines(2)
              if (!this.isLoading) {
                Button('重试同步').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.BRAND)
                  .backgroundColor(PMColors.SURFACE)
                  .height(40)
                  .onClick(() => {
                    this.loadAllData();
                  })
              }
            }
            .width('100%')
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
            .backgroundColor(PMColors.WARNING_LIGHT)
            .alignItems(VerticalAlign.Center)
          }
          if (this.currentTabIndex === 0) {
            this.CockpitView()
          } else if (this.currentTabIndex === 1) {
            this.MemoryView()
          } else if (this.currentTabIndex === 2) {
            this.ActionView()
          } else if (this.currentTabIndex === 3) {
            this.MissionView()
          } else if (this.currentTabIndex === 4) {
            this.ArtifactView()
          }
        }

        // 具体成果阅读时进入 Reader Mode，释放纵向空间；返回成果列表后恢复项目内导航。
        if (this.currentTabIndex !== 4 || !this.isArtifactReader) {
          this.BottomTabBar()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(PMColors.BACKGROUND)
      .onTouch((event: TouchEvent) => { this.launcherTracker.update(event, (collapsed: boolean): void => { this.launcherCollapsed = collapsed; }); })

      if ((this.focusConversationId !== '' || this.focusAgentEnabled) && this.hasLoadedProjectSnapshot && this.routeError === '' && !this.isArtifactReader && !this.showQuickCopilot && !this.showCreateAction && !this.showEntrySheet && !this.showReadinessSheet && !this.showStateDiffSheet && !this.showChangeImpactDialog) {
        FocusAgentLauncher({ collapsed: this.launcherCollapsed || this.currentTabIndex !== 0, onOpen: (): void => { router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: this.focusConversationId, projectId: this.projectId } }); } })
          .align(Alignment.BottomEnd).margin({ right: 18, bottom: 90 })
      }
      if (this.showCreateAction) {
        Column() {
          Column() {
            PMSheetHeader({
              title: '新增待办',
              closeLabel: '关闭新增待办',
              closeDisabled: this.isCreatingAction,
              onClose: (): void => { this.showCreateAction = false; }
            })

            Text('要做什么？')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ top: PMSpacing.MD })
            TextInput({ text: this.newActionTitle, placeholder: '例如：整理复赛演示数据' })
              .onChange((value: string) => {
                this.newActionTitle = value;
                this.newActionError = '';
              })
              .fontSize(PMFontSize.BODY)
              .height(44)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })
              .accessibilityText('待办标题')

            Text('补充说明（可不填）')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ top: PMSpacing.MD })
            TextArea({ text: this.newActionDescription, placeholder: '写下完成标准、材料位置或注意事项' })
              .onChange((value: string) => {
                this.newActionDescription = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(88)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })
              .accessibilityText('待办补充说明')

            Text('什么时候优先做？')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ top: PMSpacing.MD })
            Row({ space: PMSpacing.SM }) {
              ForEach([1, 3, 5], (priority: number) => {
                Button(priority === 1 ? '优先' : priority === 3 ? '普通' : '稍后').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(this.newActionPriority === priority ? PMColors.SURFACE : PMColors.INK_SECONDARY)
                  .backgroundColor(this.newActionPriority === priority ? PMColors.BRAND : PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(40)
                  .layoutWeight(1)
                  .onClick(() => {
                    this.newActionPriority = priority;
                  })
                  .accessibilitySelected(this.newActionPriority === priority)
              }, (priority: number) => `${priority}`)
            }
            .width('100%')
            .margin({ top: PMSpacing.XS })

            if (this.newActionError !== '') {
              Text(this.newActionError)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.SM })
            }

            Button(this.isCreatingAction ? '正在添加…' : '加入待办').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
              .fontSize(PMFontSize.BUTTON)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(this.newActionTitle.trim().length >= 2 && !this.isCreatingAction ? PMColors.BRAND : PMColors.INK_MUTED)
              .borderRadius(PMRadius.SM)
              .height(48)
              .width('100%')
              .enabled(this.newActionTitle.trim().length >= 2 && !this.isCreatingAction)
              .margin({ top: PMSpacing.LG })
              .onClick(() => {
                this.createActionManually();
              })
          }
          .width('92%')
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
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .justifyContent(FlexAlign.Center)
      }

      // 完成行动写回执弹窗
      if (this.completingActionId !== '') {
        Column() {
          Column() {
            Text('完成待办行动')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
            Text('总结完成事实与交付物（系统将自动写入项目记忆，至少 5 个字）：')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })

            TextArea({ text: this.resultText, placeholder: '例如：已完成最小消融对照实验并更新测试表格...' })
              .onChange((value: string) => {
                this.resultText = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(96)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.MD })

            if (this.dialogError !== '') {
              Text(this.dialogError)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.XS })
            }

            Row() {
              Button('取消').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .onClick(() => {
                  this.completingActionId = '';
                })

              Button(this.isSubmittingAction ? '提交中...' : '确认完成').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(this.resultText.trim().length >= 5 && !this.isSubmittingAction ? PMColors.BRAND : PMColors.INK_MUTED)
                .borderRadius(PMRadius.SM)
                .margin({ left: PMSpacing.MD })
                .enabled(this.resultText.trim().length >= 5 && !this.isSubmittingAction)
                .onClick(() => {
                  this.submitComplete();
                })
            }
            .margin({ top: PMSpacing.MD })
            .width('100%')
            .justifyContent(FlexAlign.End)
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .padding({ left: PMSpacing.XL, right: PMSpacing.XL })
        .justifyContent(FlexAlign.Center)
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.COLOR, curve: PMMotion.CURVE_CONTENT }))
      }

      // 项目设置弹窗（重构为双 Tab 结构）
      if (this.showSettingsDialog) {
        Column() {
          Column() {
            // 1. 顶部固定区：标题 + 关闭按钮 + Tab 胶囊
            Row() {
              Text('项目设置')
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
              Blank()
              PMCloseButton({
                accessibilityLabel: '关闭项目设置',
                onAction: (): void => { this.showSettingsDialog = false; }
              })
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.LG, bottom: PMSpacing.SM })

            // 双 Tab 胶囊切换
            Row({ space: 8 }) {
              Button('基本信息', { type: ButtonType.Normal })
                .fontSize(14)
                .fontWeight(this.settingsTabIndex === 0 ? FontWeight.Bold : FontWeight.Normal)
                .fontColor(this.settingsTabIndex === 0 ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.settingsTabIndex === 0 ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .layoutWeight(1)
                .height(36)
                .onClick(() => {
                  this.settingsTabIndex = 0;
                })

              Button('提醒策略', { type: ButtonType.Normal })
                .fontSize(14)
                .fontWeight(this.settingsTabIndex === 1 ? FontWeight.Bold : FontWeight.Normal)
                .fontColor(this.settingsTabIndex === 1 ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.settingsTabIndex === 1 ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .layoutWeight(1)
                .height(36)
                .onClick(() => {
                  this.settingsTabIndex = 1;
                })
            }
            .width('100%')
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, bottom: PMSpacing.SM })

            Divider().color(PMColors.BORDER_SUBTLE).width('100%')

            // 2. 中间可滚动表单区域
            Scroll() {
              Column({ space: PMSpacing.MD }) {
                if (this.settingsTabIndex === 0) {
                  // --- Tab 1: 基本信息 ---
                  Text('修改项目基本信息，不会影响已有的记忆、提醒或行动。')
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)

                  Column({ space: 6 }) {
                    Text('项目名称')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                    TextInput({ text: this.editTitle })
                      .onChange((v: string) => { this.editTitle = v; })
                      .fontSize(PMFontSize.BODY)
                      .height(44)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  Column({ space: 6 }) {
                    Text('项目目标')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                    TextArea({ text: this.editGoal })
                      .onChange((v: string) => { this.editGoal = v; })
                      .fontSize(PMFontSize.BODY)
                      .height(84)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  Column({ space: 6 }) {
                    Text('项目描述')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                    TextArea({ text: this.editDescription })
                      .onChange((v: string) => { this.editDescription = v; })
                      .fontSize(PMFontSize.BODY)
                      .height(64)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  Column({ space: 6 }) {
                    Text('截止日期')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)

                    Row() {
                      Text(this.editDeadline !== '' ? this.editDeadline : '未设置截止日期')
                        .fontSize(PMFontSize.BODY)
                        .fontColor(this.editDeadline !== '' ? PMColors.INK_PRIMARY : PMColors.INK_TERTIARY)
                        .layoutWeight(1)

                      if (this.editDeadline !== '') {
                        Button('清除', { type: ButtonType.Normal })
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.RISK)
                          .backgroundColor(PMColors.SURFACE_SUBTLE)
                          .borderRadius(PMRadius.XS)
                          .height(28)
                          .padding({ left: 8, right: 8 })
                          .margin({ right: 8 })
                          .onClick(() => { this.editDeadline = ''; })
                      }

                      Button(this.editDeadline !== '' ? '修改' : '选择日期', { type: ButtonType.Normal })
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.BRAND)
                        .backgroundColor(PMColors.BRAND_LIGHT)
                        .borderRadius(PMRadius.XS)
                        .height(28)
                        .padding({ left: 10, right: 10 })
                        .onClick(() => { this.pickEditDeadline(); })
                    }
                    .width('100%')
                    .padding({ left: 12, right: 12, top: 8, bottom: 8 })
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .border({ width: 1, color: PMColors.BORDER })
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  // 项目管理入口：归档操作不再只依赖项目空间的长按手势
                  Divider().color(PMColors.BORDER_SUBTLE).width('100%')

                  Row() {
                    Column({ space: 2 }) {
                      Text('项目归档')
                        .fontSize(PMFontSize.SECONDARY)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_PRIMARY)
                      Text('让项目离开主列表，但保留全部记忆、行动与成果；可在项目空间的「管理与恢复」中随时恢复。')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                        .lineHeight(18)
                    }
                    .layoutWeight(1)
                    .alignItems(HorizontalAlign.Start)

                    Button(this.isArchivingProject ? '归档中…' : '归档项目', { type: ButtonType.Normal })
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_SECONDARY)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .border({ width: 1, color: PMColors.BORDER })
                      .borderRadius(PMRadius.SM)
                      .height(32)
                      .padding({ left: 12, right: 12 })
                      .enabled(!this.isArchivingProject)
                      .accessibilityText(`归档项目 ${this.project.title}，可在项目空间恢复`)
                      .onClick(() => { this.archiveCurrentProject(); })
                  }
                  .width('100%')
                  .alignItems(VerticalAlign.Center)

                } else {
                  // --- Tab 2: 提醒策略 ---
                  Text('策略按账号生效：你的全部项目共享同一份提醒预算与静默时段；不会改变系统通知权限。')
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)

                  Column({ space: 6 }) {
                    Row() {
                      Text('每日提醒上限')
                        .fontSize(PMFontSize.SECONDARY)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_PRIMARY)
                      Blank()
                      Text('当前服务共享 (0–50 次)')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                    }
                    .width('100%')

                    TextInput({ text: this.policyDailyBudget, placeholder: '3' })
                      .type(InputType.Number)
                      .onChange((v: string) => { this.policyDailyBudget = v; })
                      .fontSize(PMFontSize.BODY)
                      .height(44)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  Column({ space: 6 }) {
                    Row() {
                      Text('免打扰时段')
                        .fontSize(PMFontSize.SECONDARY)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_PRIMARY)
                      Blank()
                      Text('跨午夜可用')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                    }
                    .width('100%')

                    Row({ space: PMSpacing.SM }) {
                      Button(`开始：${this.policyQuietStart}`, { type: ButtonType.Normal })
                        .fontSize(PMFontSize.BODY)
                        .fontColor(PMColors.INK_PRIMARY)
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.SM)
                        .border({ width: 1, color: PMColors.BORDER })
                        .height(44)
                        .layoutWeight(1)
                        .onClick(() => { this.pickQuietStart(); })

                      Text('至')
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_TERTIARY)

                      Button(`结束：${this.policyQuietEnd}`, { type: ButtonType.Normal })
                        .fontSize(PMFontSize.BODY)
                        .fontColor(PMColors.INK_PRIMARY)
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.SM)
                        .border({ width: 1, color: PMColors.BORDER })
                        .height(44)
                        .layoutWeight(1)
                        .onClick(() => { this.pickQuietEnd(); })
                    }
                    .width('100%')
                    .alignItems(VerticalAlign.Center)
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)

                  // 抑制记录：紧凑折叠摘要
                  if (this.policyRecentSuppressions !== '') {
                    Column({ space: 4 }) {
                      Row() {
                        Text('最近提醒抑制记录')
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.INK_SECONDARY)
                        Blank()
                        Button(this.showSuppressionDetail ? '收起 ↑' : '查看详情 ↓', { type: ButtonType.Normal })
                          .fontSize(11)
                          .fontColor(PMColors.BRAND)
                          .backgroundColor(Color.Transparent)
                          .height(24)
                          .onClick(() => { this.showSuppressionDetail = !this.showSuppressionDetail; })
                      }
                      .width('100%')

                      if (this.showSuppressionDetail) {
                        Text(this.policyRecentSuppressions)
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.INK_TERTIARY)
                          .lineHeight(18)
                          .padding(8)
                          .backgroundColor(PMColors.SURFACE_SUBTLE)
                          .borderRadius(PMRadius.SM)
                      }
                    }
                    .width('100%')
                    .alignItems(HorizontalAlign.Start)
                  }

                  // 提醒建议
                  if (this.policySuggestions.length > 0) {
                    ForEach(this.policySuggestions, (suggestion: PolicySuggestion) => {
                      Column({ space: 4 }) {
                        Text(suggestion.text)
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.INK_SECONDARY)
                          .lineHeight(18)
                        Row({ space: PMSpacing.SM }) {
                          Button('降低频率', { type: ButtonType.Normal })
                            .height(30)
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.SURFACE)
                            .backgroundColor(PMColors.BRAND)
                            .borderRadius(PMRadius.SM)
                            .onClick(() => { this.decideSuggestion('CONFIRM', suggestion.triggerType); })
                          Button('保持现状', { type: ButtonType.Normal })
                            .height(30)
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.INK_SECONDARY)
                            .backgroundColor(PMColors.SURFACE_SUBTLE)
                            .borderRadius(PMRadius.SM)
                            .onClick(() => { this.decideSuggestion('DISMISS', suggestion.triggerType); })
                        }
                      }
                      .width('100%')
                      .padding(PMSpacing.SM)
                      .backgroundColor(PMColors.BRAND_LIGHT)
                      .borderRadius(PMRadius.SM)
                      .alignItems(HorizontalAlign.Start)
                    }, (suggestion: PolicySuggestion) => suggestion.triggerType)
                  }

                  if (this.policyFeedback !== '') {
                    Text(this.policyFeedback)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(this.policyFeedback.indexOf('失败') >= 0 || this.policyFeedback.indexOf('必须') >= 0 || this.policyFeedback.indexOf('格式') >= 0
                        ? PMColors.RISK : PMColors.SUCCESS)
                  }
                }
              }
              .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.MD })
              .width('100%')
            }
            .layoutWeight(1)
            .width('100%')
            .align(Alignment.TopStart)

            Divider().color(PMColors.BORDER_SUBTLE).width('100%')

            // 3. 底部固定操作栏
            Row({ space: PMSpacing.MD }) {
              if (this.settingsTabIndex === 0) {
                Button('取消', { type: ButtonType.Normal })
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .layoutWeight(1)
                  .onClick(() => { this.showSettingsDialog = false; })

                Button(this.isSavingSettings ? '保存中...' : '保存修改', { type: ButtonType.Normal })
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .layoutWeight(1.5)
                  .enabled(!this.isSavingSettings)
                  .onClick(() => { this.saveSettings(); })
              } else {
                Button('恢复默认', { type: ButtonType.Normal })
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .layoutWeight(1)
                  .onClick(() => { this.restorePolicyDefaults(); })

                Button(this.isSavingPolicy ? '保存中…' : '保存策略', { type: ButtonType.Normal })
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .layoutWeight(1.5)
                  .enabled(!this.isSavingPolicy)
                  .onClick(() => { this.savePolicy(); })
              }
            }
            .width('100%')
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
          }
          .width('100%')
          .constraintSize({ maxHeight: '85%' })
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .shadow({ radius: 16, color: 'rgba(0, 0, 0, 0.10)', offsetX: 0, offsetY: 8 })
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

      if (this.showChangeImpactDialog) {
        ChangeImpactDialog({
          projectId: this.projectId,
          onClose: () => {
            this.showChangeImpactDialog = false;
          },
          onSuccess: () => {
            this.loadAllData();
          }
        })
      }

      if (this.showChangeBrief) {
        ProjectChangeBrief({
          brief: this.briefForSheet,
          onClose: () => {
            this.showChangeBrief = false;
          },
          onGoActions: () => {
            this.currentTabIndex = 2;
          },
          onOpenEvidence: (entityKind: string, entityId: string) => {
            // 保留实体 ID，页签打开后仍能定位到同一版本证据，而不是只跳到泛列表。
            AppStorage.setOrCreate<string>('stateEvidenceEntityId', entityId);
            this.showChangeBrief = false;
            if (entityKind === 'card') {
              // 记忆页默认不带搜索条件；展开同一张卡片即可保留“点击简报证据”的可达性。
              this.memorySearchQuery = '';
              this.memorySearchResults = [];
              this.expandedCardId = entityId;
              this.currentTabIndex = 1;
            } else if (entityKind === 'action') {
              this.currentTabIndex = 2;
            } else if (entityKind === 'deliverable') {
              this.currentTabIndex = 4;
            } else {
              this.currentTabIndex = 0;
            }
          }
        })
      }

      if (this.showStateDiffSheet) {
        ProjectStateDiffSheet({
          diff: this.stateDiffForSheet,
          onClose: () => {
            this.showStateDiffSheet = false;
          }
        })
      }

      if (this.showReadinessSheet) {
        ReadinessBreakdownSheet({
          readiness: this.dashboard.readiness,
          showItemEntry: true,
          onClose: () => {
            this.showReadinessSheet = false;
          },
          onOpenItem: (key: string) => {
            this.openReadinessItem(key);
          }
        })
      }

      if (this.showActionConfirmSheet) {
        ActionCreateConfirmSheet({
          intervention: this.actionConfirmIntervention,
          actionIndex: this.actionConfirmIndex,
          isSubmitting: this.isCreatingFocusAction,
          operationError: this.actionConfirmError,
          onClose: () => {
            // 提交中不允许关面板：避免用户以为没创建，实际已经写入
            if (!this.isCreatingFocusAction) {
              this.showActionConfirmSheet = false;
            }
          },
          onConfirm: () => {
            this.confirmCreateFocusAction();
          }
        })
      }

      if (this.showClaimAuditor) {
        ClaimAuditorDrawer({
          projectId: this.projectId,
          artifactId: this.currentArtifact !== undefined ? this.currentArtifact.id : '',
          artifactTitle: TextFormatters.artifactTypeToChinese(this.selectedArtifactType),
          onClose: () => {
            this.showClaimAuditor = false;
          }
        })
      }

      if (this.showJudgeRebuttal) {
        JudgeRebuttalModal({
          onClose: () => {
            this.showJudgeRebuttal = false;
          }
        })
      }

      if (this.showAttachmentCorrection) {
        AttachmentCorrectionModal({
          projectId: this.projectId,
          attachment: this.correctingAttachment,
          onClose: () => {
            this.showAttachmentCorrection = false;
          },
          onSuccess: () => {
            this.loadAllData();
          }
        })
      }
    }
    .width('100%')
    .height('100%')
    .bindSheet($$this.showEntrySheet, this.EntrySheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true,
      showClose: false,
      onDisappear: () => {
        // 手势收起会议面板也要刷新；确认后的变更不能只依赖页内关闭按钮触发。
        if (this.entrySheetMode === 'meeting') {
          this.loadAllData();
        }
      }
    })
  }
}


