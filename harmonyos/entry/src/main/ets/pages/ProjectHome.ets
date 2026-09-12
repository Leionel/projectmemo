import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import pasteboard from '@ohos.pasteboard';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { picker } from '@kit.CoreFileKit';
import { Project, ProjectDashboard, ApiError, ReadinessItem, ProjectUpdateInput } from '../models/Project';
import { ProjectDetail, KnowledgeCard, CardLink, IncomingCardLink } from '../models/Memory';
import { Milestone, Deliverable, DeliverableEvidence } from '../models/Milestone';
import { Intervention, ProposedAction } from '../models/Intervention';
import { ActionItem } from '../models/Action';
import { ArtifactItem } from '../models/Artifact';
import { AgentMessage, AgentCitation, EvidenceClaim, ActionCreatePayload, ArtifactGeneratePayload } from '../models/Copilot';
import { Attachment } from '../models/Attachment';

import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { MemoryService } from '../services/MemoryService';
import { MemoryLifecycleService } from '../services/MemoryLifecycleService';
import { InterventionPolicyService } from '../services/InterventionPolicyService';
import { ProjectStateService } from '../services/ProjectStateService';
import { PolicyResponse, PolicySuggestion, PolicyUpdateBody } from '../models/Intervention';
import { ActionService } from '../services/ActionService';
import { ArtifactService } from '../services/ArtifactService';
import { CopilotService } from '../services/CopilotService';
import { NotificationService } from '../services/NotificationService';
import { AttachmentService } from '../services/AttachmentService';
import { MilestoneService } from '../services/MilestoneService';

import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction, PMMotion, PMMaterial, PMTransition } from '../common/DesignTokens';
import { PMBreakpoint, PMStorageKey, PMWidthBp } from '../common/WindowMetrics';
import { SeverityBadge, StatusBadge, MemoryTypeBadge } from '../components/MetricBadge';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import {
  DashboardIcon,
  MemoryIcon,
  TaskIcon,
  CopilotIcon,
  ArtifactIcon,
  CheckIcon,
  AlertIcon,
  SpineNodeIcon
} from '../components/PMIcons';
import { PMAppBar } from '../components/PMAppBar';
import { TextFormatters } from '../common/TextFormatters';
import { MarkdownView } from '../components/MarkdownView';
import { DeadlineBadge } from '../components/DeadlineBadge';
import { ChangeImpactDialog } from '../components/ChangeImpactDialog';
import { ClaimAuditorDrawer } from '../components/ClaimAuditorDrawer';
import { ProjectStatePanel } from '../components/ProjectStatePanel';
import { ProjectStateDiffSheet } from '../components/ProjectStateDiffSheet';
import { ProjectChangeBrief } from '../components/ProjectChangeBrief';
import { ChangeBrief, StateDiff } from '../models/ProjectState';
import { JudgeRebuttalModal } from '../components/JudgeRebuttalModal';
import { AttachmentCorrectionModal } from '../components/AttachmentCorrectionModal';
import { ExportFormatter } from '../common/ExportFormatter';

@Entry
@Component
struct ProjectHome {
  @State projectId: string = '';
  @State currentTabIndex: number = 0;
  @StorageProp(PMStorageKey.WIDTH_BP) widthBp: string = PMWidthBp.SM;

  // 数据主状态
  @State project: ProjectDetail = new ProjectDetail();
  @State dashboard: ProjectDashboard = new ProjectDashboard();
  @State interventions: Intervention[] = [];
  @State actions: ActionItem[] = [];
  @State artifacts: ArtifactItem[] = [];
  @State chatMessages: AgentMessage[] = [];
  @State milestones: Milestone[] = [];
  @State attachments: Attachment[] = [];
  @State milestoneLoadError: string = '';

  // 通用状态
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';

  // Tab 0: 工作台专属状态
  @State rawText: string = '';
  @State sourceType: string = '随手记录';
  @State isCapturing: boolean = false;
  @State captureError: string = '';
  @State isUploadingAttachment: boolean = false;
  @State attachmentFeedback: string = '';
  @State attachmentFeedbackTone: string = 'info';
  @State attachmentRetryId: string = '';
  @State isRetryingAttachment: boolean = false;
  @State isEvaluating: boolean = false;
  @State evaluateError: string = '';
  @State showDemoControls: boolean = false;
  @State showCapturePanel: boolean = false;
  @State showChangeImpactDialog: boolean = false;
  @State showClaimAuditor: boolean = false;
  @State showStateDiffSheet: boolean = false;
  @State stateDiffForSheet: StateDiff = new StateDiff();
  @State showChangeBrief: boolean = false;
  @State briefForSheet: ChangeBrief = new ChangeBrief();
  @State isExportingProvenance: boolean = false;
  @State lifecycleActionCardId: string = '';
  @State showJudgeRebuttal: boolean = false;
  @State showAttachmentCorrection: boolean = false;
  @State correctingAttachment: Attachment = new Attachment();
  @State showSettingsDialog: boolean = false;
  @State editTitle: string = '';
  @State editGoal: string = '';
  @State editDescription: string = '';
  @State editDeadline: string = '';
  @State isSavingSettings: boolean = false;

  // Tab 1: 记忆专属状态
  @State memorySearchQuery: string = '';
  @State selectedMemoryType: string = 'all';
  @State expandedCardId: string = '';
  @State memorySearchResults: KnowledgeCard[] = [];
  @State isSearchingMemory: boolean = false;
  @State memorySearchError: string = '';

  // Tab 2: 待办专属状态
  @State completingActionId: string = '';
  @State resultText: string = '';
  @State isSubmittingAction: boolean = false;
  @State dialogError: string = '';
  @State startingActionId: string = '';

  // Tab 3: 问忆程专属状态
  @State copilotQuestion: string = '';
  @State isAskingCopilot: boolean = false;
  @State executingToolTitle: string = '';
  @State copilotFeedback: string = '';
  @State expandedCopilotReceiptId: string = '';

  // Tab 4: 成果专属状态
  @State selectedArtifactType: string = 'competition_outline';
  @State isGeneratingArtifact: boolean = false;
  @State artifactError: string = '';
  @State currentArtifact: ArtifactItem | undefined = undefined;
  @State isArtifactReader: boolean = false;
  @State isConfirmingEvidence: boolean = false;
  @State evidenceFeedback: string = '';
  @State evidenceError: string = '';

  private projectService: ProjectService = new ProjectService();
  private interventionService: InterventionService = new InterventionService();
  private memoryService: MemoryService = new MemoryService();
  private actionService: ActionService = new ActionService();
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
  private memorySearchSerial: number = 0;

  private sourceOptions: string[] = [
    '随手记录', '论文笔记', '代码报错', '实验记录', '会议纪要', '老师建议', '参赛材料'
  ];

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失，无法定位项目';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (params['tab'] === 'memory') {
      this.currentTabIndex = 1;
    }
    if (this.projectId === '') {
      this.routeError = '页面参数缺失，项目ID无效';
      return;
    }
    this.loadAllData();
  }

  onPageShow(): void {
    // NAV-02: 消费可能在热启动时通过通知写入的参数
    this.openPendingNotification();
    // NAV-01: 页面返回时静默刷新数据，保留用户当前 tab
    if (this.projectId !== '' && !this.isLoading) {
      this.loadAllData(true);
    }
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
    if (this.showCapturePanel) {
      this.showCapturePanel = false;
      return true;
    }
    if (this.isArtifactReader) {
      this.isArtifactReader = false;
      return true;
    }
    return false;
  }

  private openPendingNotification(): void {
    const targetProjectId = AppStorage.get<string>('notificationProjectId') ?? '';
    const targetInterventionId = AppStorage.get<string>('notificationInterventionId') ?? '';
    if (targetProjectId !== '' && targetInterventionId !== '') {
      AppStorage.setOrCreate<string>('notificationProjectId', '');
      AppStorage.setOrCreate<string>('notificationInterventionId', '');
      router.pushUrl({
        url: 'pages/InterventionDetail',
        params: { projectId: targetProjectId, interventionId: targetInterventionId }
      });
    }
  }

  // 上传入口统一为回形针：二级菜单分开“相册图片”与“文件（PDF 等）”两条路径
  private async openUploadMenu(): Promise<void> {
    if (this.isUploadingAttachment) {
      return;
    }
    try {
      const menu = await promptAction.showActionMenu({
        title: '上传照片 / PDF',
        buttons: [
          { text: '从相册选图片', color: '#0A7EA4' },
          { text: '选择文件（PDF 等）', color: '#0A7EA4' }
        ]
      });
      if (menu.index === 0) {
        await this.pickAndUploadImage();
      } else if (menu.index === 1) {
        await this.pickAndUploadPdf();
      }
    } catch (_e) {
      // 用户取消菜单，无需提示
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
        await this.uploadAttachment(uris[0], `project-document-${Date.now()}.pdf`, 'application/pdf');
      }
    } catch (error) {
      this.attachmentFeedback = '未选择 PDF 或文件选择器不可用';
    }
  }

  private async uploadAttachment(uri: string, fileName: string, mimeType: string): Promise<void> {
    this.isUploadingAttachment = true;
    this.attachmentRetryId = '';
    this.attachmentFeedbackTone = 'info';
    this.attachmentFeedback = '正在上传并提取内容…';
    try {
      const result = await this.attachmentService.upload(this.projectId, uri, fileName, mimeType);
      if (result.isDuplicate && result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '该附件已存在，已复用原记录';
        this.attachmentFeedbackTone = 'success';
      } else if (result.isDuplicate) {
        this.attachmentFeedback = '该附件已存在，已复用原记录；当前提取未完成';
        this.attachmentFeedbackTone = result.attachment.extractionStatus === 'NEEDS_OCR' ? 'warning' : 'error';
        this.attachmentRetryId = result.attachment.id;
      } else if (result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '附件已归档并沉淀为项目记忆';
        this.attachmentFeedbackTone = 'success';
      } else if (result.attachment.extractionStatus === 'NEEDS_OCR') {
        this.attachmentFeedback = '附件已保存；当前环境需要 OCR，未生成伪造记忆';
        this.attachmentFeedbackTone = 'warning';
        this.attachmentRetryId = result.attachment.id;
      } else {
        this.attachmentFeedback = `附件已保存；提取失败：${result.attachment.extractionError}`;
        this.attachmentFeedbackTone = 'error';
        this.attachmentRetryId = result.attachment.id;
      }
      await this.loadAllData();
    } catch (error) {
      this.attachmentFeedback = error instanceof ApiError ? error.message : '附件上传失败';
      this.attachmentFeedbackTone = 'error';
    } finally {
      this.isUploadingAttachment = false;
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
    try {
      const detailP = this.projectService.getProjectDetail(this.projectId);
      const listP = this.projectService.listProjects();
      const intervP = this.interventionService.list(this.projectId);
      const actionP = this.actionService.list(this.projectId);
      const artifactP = this.artifactService.list(this.projectId);
      const chatP = this.copilotService.getChatHistory(this.projectId);
      const attachmentP = this.attachmentService.list(this.projectId).catch(() => [] as Attachment[]);
      let milestoneFailed = false;
      const milestoneP = this.milestoneService.list(this.projectId).catch(() => {
        milestoneFailed = true;
        return [] as Milestone[];
      });

      const res = await Promise.all([detailP, listP, intervP, actionP, artifactP, chatP, milestoneP, attachmentP]);
      this.project = res[0];
      this.dashboard = this.findDashboard(res[1]);
      this.interventions = res[2];
      this.actions = res[3];
      this.artifacts = res[4];
      this.chatMessages = res[5];
      if (!milestoneFailed || this.milestones.length === 0) {
        this.milestones = res[6];
      }
      this.milestoneLoadError = milestoneFailed ? '里程碑阶段数据同步异常，保留展示历史缓存' : '';
      this.attachments = res[7];

      // 提取未成功附件中的第一个作为活跃重试 ID（若尚未指定）
      const failedAtt = this.attachments.find((att: Attachment) => att.extractionStatus === 'FAILED' || att.extractionStatus === 'NEEDS_OCR');
      if (failedAtt && this.attachmentRetryId === '') {
        this.attachmentRetryId = failedAtt.id;
      }

      this.updateCurrentArtifact();
      if (this.memorySearchQuery.trim() !== '') {
        await this.searchMemory();
      }

      // S07: 对高风险介入派发/更新本地系统通知
      for (const interv of this.interventions) {
        if (interv.severity >= 4 && interv.status === 'OPEN') {
          this.notificationService.publishInterventionNotification(interv, this.projectId);
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
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

  private getNextActionId(): string {
    for (const action of this.actions) {
      if (action.status === 'TODO' || action.status === 'DOING') {
        return action.id;
      }
    }
    return '';
  }

  private getNextActionStatus(): string {
    for (const action of this.actions) {
      if (action.status === 'TODO' || action.status === 'DOING') {
        return action.status;
      }
    }
    return '';
  }

  private getNextActionTitle(): string {
    for (const action of this.actions) {
      if (action.status === 'TODO' || action.status === 'DOING') {
        return TextFormatters.readableText(action.title, '下一项行动标题无法读取');
      }
    }
    return '暂无待推进的行动';
  }

  private getNextActionDescription(): string {
    for (const action of this.actions) {
      if (action.status === 'TODO' || action.status === 'DOING') {
        if (action.description !== undefined && action.description !== '') {
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
    try {
      await this.memoryService.capture(this.projectId, trimmed, this.sourceType);
      this.rawText = '';
      promptAction.showToast({ message: '已归档并生成记忆卡片' });
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

  private openSettingsDialog(): void {
    this.policyFeedback = '';
    this.loadPolicy();
    this.editTitle = this.project.title;
    this.editGoal = this.project.goal;
    this.editDescription = this.project.description;
    this.editDeadline = this.project.deadline !== undefined && this.project.deadline !== null && this.project.deadline.length >= 10 ?
      this.project.deadline.substring(0, 10) : '';
    this.showSettingsDialog = true;
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

  private openCompleteDialog(actionId: string): void {
    this.completingActionId = actionId;
    this.resultText = '';
    this.dialogError = '';
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
      await this.actionService.complete(this.projectId, this.completingActionId, trimmed);
      this.completingActionId = '';
      this.resultText = '';
      promptAction.showToast({ message: '已完成并写入项目记忆' });
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
  private async sendCopilotMessage(): Promise<void> {
    if (this.isAskingCopilot) {
      return;
    }
    const text = this.copilotQuestion.trim();
    if (text === '') {
      return;
    }
    this.copilotQuestion = '';
    this.isAskingCopilot = true;
    this.copilotFeedback = '';

    const userMsg = new AgentMessage();
    userMsg.role = 'USER';
    userMsg.content = text;
    this.chatMessages.push(userMsg);

    try {
      const res = await this.copilotService.askQuestion(this.projectId, text);
      const assistantMsg = new AgentMessage();
      assistantMsg.role = 'ASSISTANT';
      assistantMsg.content = res.message;
      assistantMsg.citations = res.citations;
      assistantMsg.proposedActions = res.proposedActions;
      assistantMsg.runId = res.runId;
      assistantMsg.trustReceipt = res.trustReceipt;
      this.chatMessages.push(assistantMsg);
      if (res.fallback) {
        this.copilotFeedback = '（已从项目记忆检索并整理回复）';
      }
    } catch (e) {
      this.copilotFeedback = '问答服务异常，请稍后重试';
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
      title: this.project.title !== '' ? TextFormatters.readableText(this.project.title, '项目名称无法读取') : '项目档案',
      subtitle: `项目工作区 · ${this.currentTabIndex === 0 ? '工作台' :
        this.currentTabIndex === 1 ? '记忆' :
          this.currentTabIndex === 2 ? '待办' :
            this.currentTabIndex === 3 ? '问忆程' : '成果'}`,
      backLabel: '项目',
      backDescription: '返回项目列表',
      rightActionText: this.currentTabIndex === 0 ? '＋ 记录' : '',
      onRightTextAction: () => {
        this.showCapturePanel = true;
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
      this.TabBarItemIcon(index)
      Text(label)
        .fontSize(PMFontSize.BOTTOM_NAV)
        .fontFamily(PMFontFamily.SANS)
        .fontWeight(this.currentTabIndex === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.currentTabIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
        .margin({ top: 3 })
    }
    .layoutWeight(1)
    .height(56)
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
      this.TabBarItem(0, '工作台')
      this.TabBarItem(1, '记忆')
      this.TabBarItem(2, '待办')
      this.TabBarItem(3, '问忆程')
      this.TabBarItem(4, '成果')
    }
    .width('100%')
    .padding({ top: 4, bottom: 4 })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { top: 1 }, color: PMColors.BORDER })
    .constraintSize({ maxWidth: PMBreakpoint.barMaxWidth(this.widthBp) })
  }

  @Builder
  private NextActionView() {
    if (this.getNextActionId() === '') {
      Row() {
        Text('✦')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.BRAND)
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
          .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
          .backgroundColor(PMColors.BRAND_LIGHT)
          .borderRadius(PMRadius.XS)
      }
      .width('100%')
      .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.MD)
      .border({ width: 1, color: PMColors.BORDER })
      .margin({ top: PMSpacing.MD })
      .alignItems(VerticalAlign.Center)
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        this.showCapturePanel = true;
      })
      .accessibilityText('暂无待推进待办，点击展开快速记录面板')
    } else {
      Column() {
        Row() {
          Text('下一步')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text('建议今天处理')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        Column() {
          Text(this.getNextActionTitle())
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .lineHeight(22)

          Text(this.getNextActionDescription())
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })

          Button(this.getNextActionStatus() === 'DOING' ? '查看待办' : '开始行动')
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .height(44)
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
      .borderRadius(PMRadius.MD)
      .border({ width: 1, color: PMColors.BORDER })
      .margin({ top: PMSpacing.MD })
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  private RecentChangesView() {
    Column() {
      Row() {
        Text('近期变化')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
        Text(`${this.project._count.cards} 条记忆 · ${this.actions.filter((a) => a.status === 'DONE').length} 个行动完成`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      Column() {
        if (this.project.cards.length > 0) {
          Row() {
            MemoryIcon({ isSelected: false, iconSize: 18 })
            Column() {
              Text(TextFormatters.readableText(this.project.cards[0].title, '最近新增的记忆文本无法读取'))
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(`新增记忆 · ${this.project.cards[0].createdAt.length >= 10 ? this.project.cards[0].createdAt.substring(0, 10) : '近期'}`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.MEMORY)
                .margin({ top: 2 })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            .margin({ left: PMSpacing.SM })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }

        ForEach(this.actions.filter((a) => a.status === 'DONE').slice(0, 2), (action: ActionItem) => {
          Row() {
            CheckIcon({ iconSize: 18, color: PMColors.SUCCESS })
            Column() {
              Text(TextFormatters.readableText(action.title, '已完成行动标题无法读取'))
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(action.resultText !== undefined && action.resultText !== '' ?
                TextFormatters.readableText(action.resultText, '完成回执文本无法读取') : '已完成并留下回执')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.SUCCESS)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .margin({ top: 2 })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            .margin({ left: PMSpacing.SM })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ top: PMSpacing.SM })
        }, (action: ActionItem) => action.id)

        if (this.artifacts.length > 0) {
          Row() {
            ArtifactIcon({ isSelected: false, iconSize: 18 })
            Column() {
              Text(`${TextFormatters.artifactTypeToChinese(this.artifacts[0].artifactType)} 已更新`)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
              Text(`成果 · ${this.artifacts[0].createdAt.length >= 10 ? this.artifacts[0].createdAt.substring(0, 10) : '近期'}`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
                .margin({ top: 2 })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            .margin({ left: PMSpacing.SM })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ top: PMSpacing.SM })
        }

        if (this.project.cards.length === 0 && this.actions.filter((a) => a.status === 'DONE').length === 0 && this.artifacts.length === 0) {
          Text('还没有新的项目变化，先记录一条事实。')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.MD })
        }
      }
      .width('100%')
      .margin({ top: PMSpacing.SM })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .margin({ top: PMSpacing.MD })
    .alignItems(HorizontalAlign.Start)
  }

  // ----------------------------------------------------
  // Tab 0: 工作台 (Workbench) 视图 —— 围绕“三个问题”设计
  // ----------------------------------------------------
  @Builder
  private CockpitView() {
    Scroll() {
      Column() {
        // 问题零：变了什么、依据是什么（R2/S1 状态快照与 Diff）
        ProjectStatePanel({
          projectId: this.projectId,
          onOpenDiffSheet: (diff: StateDiff) => {
            this.stateDiffForSheet = diff;
            this.showStateDiffSheet = true;
          },
          onOpenBrief: (fromId: string, toId: string) => {
            this.openChangeBrief(fromId, toId);
          },
          onGoActions: () => {
            this.currentTabIndex = 2;
          }
        })

        // 问题一：现在怎么样？（当前判断与准备度）
        Column() {
          Row() {
            Column() {
              Text('当前状态')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
              Text(this.project._count.cards === 0 && this.project._count.artifacts === 0 ?
                '尚未形成项目进度' :
                `${TextFormatters.projectProgressLabel(this.project.scenario)} ${this.dashboard.readiness.percentage}%`)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)

            DeadlineBadge({ deadline: this.dashboard.deadline })
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          // 准备度进度条
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(3)
              .backgroundColor(PMColors.BORDER)
              .borderRadius(PMRadius.FULL)
            Row()
              .width(`${Math.min(100, Math.max(0, this.dashboard.readiness.percentage))}%`)
              .height(3)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.FULL)
          }
          .width('100%')
          .margin({ top: PMSpacing.SM })

          // 项目进度清单：已具备 (弱化收起) vs 当前缺口 (重点放大)
          Column() {
            // 当前缺口 (重点展示)
            Text('当前缺口')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.RISK)
              .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

            ForEach(this.dashboard.readiness.items.filter((item: ReadinessItem) => !item.complete), (item: ReadinessItem) => {
              Row() {
                Column() {
                  Text(item.label)
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)

                  Text(item.key === 'competition_outline' ? '已有参赛要求，但尚未生成初稿' :
                    item.key === 'defense_ppt' ? '尚无可复用答辩结构' :
                      item.key === 'experiment_log' ? '尚未形成完整实验证据' : '尚未沉淀关键交付物')
                    .fontSize(PMFontSize.SECONDARY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .margin({ top: 2 })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Button(`${item.actionLabel} →`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.BRAND)
                  .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: 4, bottom: 4 })
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.SM)
                  .onClick(() => {
                    if (item.key === 'competition_outline' || item.key === 'defense_ppt' || item.key === 'readme') {
                      this.selectedArtifactType = item.key;
                      this.updateCurrentArtifact();
                      this.currentTabIndex = 4; // 跳转成果
                    } else if (item.key === 'closed_loop') {
                      this.currentTabIndex = 2; // 跳转待办
                    } else {
                      this.currentTabIndex = 1; // 跳转记忆
                    }
                  })
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })
            }, (item: ReadinessItem) => item.key)

            // 已具备 (弱化展示)
            if (this.dashboard.readiness.items.some((item: ReadinessItem) => item.complete)) {
              Text('已具备')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

              Row() {
                ForEach(this.dashboard.readiness.items.filter((item: ReadinessItem) => item.complete), (item: ReadinessItem) => {
                  Row() {
                    Text('✓ ')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.SUCCESS)
                    Text(item.label)
                      .fontSize(PMFontSize.SECONDARY)
                      .fontColor(PMColors.INK_SECONDARY)
                  }
                  .margin({ right: PMSpacing.MD })
                }, (item: ReadinessItem) => item.key)
              }
              .width('100%')
              .padding({ top: 2 })
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: { left: 3 }, color: PMColors.EVIDENCE })

        this.NextActionView()

        this.RecentChangesView()

        this.MilestoneEvidenceView()

        // 问题二：为什么？（主动提醒与依据）
        Column() {
          Row() {
            Text('主动提醒')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            Text(`${this.interventions.filter((i) => i.status === 'OPEN').length} 项待处理`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          if (this.interventions.filter((i) => i.status === 'OPEN').length > 0) {
            ForEach(this.interventions.filter((i) => i.status === 'OPEN').slice(0, 1), (interv: Intervention) => {
              Column() {
                Row() {
                  SeverityBadge({ severity: interv.severity })
                  Text(TextFormatters.readableText(interv.title, '提醒标题无法读取，请重新评估。'))
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                    .layoutWeight(1)
                    .margin({ left: PMSpacing.SM })
                }
                .width('100%')

                Text(TextFormatters.readableText(interv.content, '提醒依据文本无法读取，请重新评估。'))
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
                    .borderRadius(PMRadius.XS)
                    .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: 4, bottom: 4 })
                    .onClick(() => {
                      router.pushUrl({
                        url: 'pages/InterventionDetail',
                        params: { projectId: this.projectId, interventionId: interv.id }
                      });
                    })
                }
                .width('100%')
                .justifyContent(FlexAlign.End)
                .margin({ top: PMSpacing.SM })
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.SM })
            }, (interv: Intervention) => interv.id)
          } else {
            Text('当前无阻断性风险，规则引擎评估正常')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.SUCCESS)
              .margin({ top: PMSpacing.MD })
          }

          // 演示情境控制：默认折叠，比赛时仍可快速打开。
          Row() {
            Text('比赛演示情境控制')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
            Text(this.showDemoControls ? '收起' : '展开')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
          .margin({ top: PMSpacing.MD })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            this.showDemoControls = !this.showDemoControls;
          })
          .accessibilityText(`比赛演示情境控制，${this.showDemoControls ? '收起' : '展开'}`)

          if (this.showDemoControls) {
            Column() {
              Row() {
                Button('模拟截止 48h')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .border({ width: 1, color: PMColors.BORDER })
                  .borderRadius(PMRadius.XS)
                  .height(48)
                  .layoutWeight(1)
                  .onClick(() => {
                    this.evaluate('deadline_48h');
                  })

                Button('模拟停滞 72h')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .border({ width: 1, color: PMColors.BORDER })
                  .borderRadius(PMRadius.XS)
                  .height(48)
                  .layoutWeight(1)
                  .margin({ left: PMSpacing.SM })
                  .onClick(() => {
                    this.evaluate('stale_72h');
                  })
              }
              .width('100%')

              Row() {
                Button('模拟风险集中')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .border({ width: 1, color: PMColors.BORDER })
                  .borderRadius(PMRadius.XS)
                  .height(48)
                  .layoutWeight(1)
                  .margin({ top: PMSpacing.SM })
                  .onClick(() => {
                    this.evaluate('risk_cluster');
                  })

                Button('清除模拟')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.RISK)
                  .backgroundColor(PMColors.RISK_LIGHT)
                  .borderRadius(PMRadius.XS)
                  .height(48)
                  .layoutWeight(1)
                  .margin({ left: PMSpacing.SM, top: PMSpacing.SM })
                  .onClick(() => {
                    this.evaluate(undefined, true);
                  })
              }
              .width('100%')

              Row() {
                Button('⚡ 模拟方案突发变更 (模块 A)')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.RISK)
                  .borderRadius(PMRadius.XS)
                  .height(44)
                  .width('100%')
                  .margin({ top: PMSpacing.SM })
                  .onClick(() => {
                    this.showChangeImpactDialog = true;
                  })
              }
              .width('100%')
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
          }
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .margin({ top: PMSpacing.MD })

        // 问题三：记录与沉淀——输入区已改为底部半模态面板，此处仅保留入口
        Column() {
          Row() {
            Column() {
              Text('记录项目碎片')
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Text('快速记录文字、图片或 PDF，并保留来源。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.XS })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text(`已积累 ${this.project._count.cards} 条记忆`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.MEMORY)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          Button('开始记录')
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .border({ width: 1, color: PMColors.BRAND })
            .borderRadius(PMRadius.SM)
            .height(48)
            .width('100%')
            .margin({ top: PMSpacing.MD })
            .onClick(() => {
              this.showCapturePanel = true;
            })
            .accessibilityText('打开记录项目碎片面板')
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .margin({ top: PMSpacing.MD })
      }
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.XL })
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
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
          Text(`记录实验、导师意见和材料，并保留来源 · 已积累 ${this.project._count.cards} 条记忆`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Button('✕')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_TERTIARY)
          .backgroundColor('transparent')
          .onClick(() => {
            this.showCapturePanel = false;
          })
          .accessibilityText('关闭记录面板')
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Top)

      Scroll() {
        Row() {
          ForEach(this.sourceOptions, (src: string) => {
            Button(src)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Regular)
              .fontColor(this.sourceType === src ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.sourceType === src ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .border({ width: this.sourceType === src ? 2 : 1, color: this.sourceType === src ? PMColors.BRAND : PMColors.BORDER })
              .margin({ right: PMSpacing.XS })
              .accessibilityText(`记录来源：${src}`)
              .accessibilitySelected(this.sourceType === src)
              .onClick(() => {
                this.sourceType = src;
              })
          }, (src: string) => src)
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
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
          Button(this.isRetryingAttachment ? '重新提取中…' : '重试提取')
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

          Button('人工校对内容 (模块 E)')
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

              Button(this.isRetryingAttachment && this.attachmentRetryId === item.id ? '重试中…' : '重试提取')
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
          this.rawText = value;
        })
        .fontSize(PMFontSize.BODY)
        .height(90)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .border({ width: 1, color: PMColors.BORDER })
        .accessibilityText(`输入${this.sourceType}内容，至少 5 个字`)
        .margin({ top: PMSpacing.SM })

      if (this.captureError !== '') {
        Text(this.captureError)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.RISK)
          .margin({ top: PMSpacing.XS })
      }

      Row() {
        Text(this.rawText.trim().length > 0 ? `${this.rawText.trim().length} 字` : '至少 5 字')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)

        Row({ space: PMSpacing.SM }) {
          Button('📎')
            .fontSize(18)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(48)
            .width(52)
            .enabled(!this.isUploadingAttachment)
            .onClick(() => {
              this.openUploadMenu();
            })
            .accessibilityText('上传照片或 PDF 附件')

          Button(this.isCapturing ? '正在归档...' : '沉淀为项目记忆')
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(this.rawText.trim().length >= 5 && !this.isCapturing ? PMColors.BRAND : PMColors.INK_MUTED)
            .borderRadius(PMRadius.SM)
            .height(48)
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
            .enabled(this.rawText.trim().length >= 5 && !this.isCapturing)
            .onClick(() => {
              this.capture();
            })
        }
        .alignItems(VerticalAlign.Center)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)
      .margin({ top: PMSpacing.MD })
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
                      Button(this.isConfirmingEvidence ? '撤销中…' : '撤销关联')
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

                          Button(this.isConfirmingEvidence ? '确认中…' : '关联此条')
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
  @Builder
  private MemoryView() {
    Column() {
      // 搜索框与类型胶囊
      Column() {
        TextInput({ text: this.memorySearchQuery, placeholder: '搜索记忆标题、摘要或关键词...' })
          .onChange((value: string) => {
            this.onMemoryQueryChange(value);
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
              .fontColor(this.selectedMemoryType === 'all' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'all' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：全部')
              .accessibilitySelected(this.selectedMemoryType === 'all')
              .onClick(() => {
                this.selectMemoryType('all');
              })

            Button('论文笔记')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'paper_note' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'paper_note' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：论文笔记')
              .accessibilitySelected(this.selectedMemoryType === 'paper_note')
              .onClick(() => {
                this.selectMemoryType('paper_note');
              })

            Button('实验记录')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'experiment_log' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'experiment_log' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：实验记录')
              .accessibilitySelected(this.selectedMemoryType === 'experiment_log')
              .onClick(() => {
                this.selectMemoryType('experiment_log');
              })

            Button('阶段复盘')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'reflection' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'reflection' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：阶段复盘')
              .accessibilitySelected(this.selectedMemoryType === 'reflection')
              .onClick(() => {
                this.selectMemoryType('reflection');
              })

            Button('代码问题')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'code_issue' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'code_issue' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .height(44)
              .margin({ right: PMSpacing.XS })
              .accessibilityText('按记忆类型筛选：代码问题')
              .accessibilitySelected(this.selectedMemoryType === 'code_issue')
              .onClick(() => {
                this.selectMemoryType('code_issue');
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

      // 卡片流
      List({ space: PMSpacing.MD }) {
        ForEach(this.getFilteredCards(), (card: KnowledgeCard) => {
          ListItem() {
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
                  MemoryTypeBadge({ type: card.type })
                  Text(card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : card.createdAt)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                }
                .width('100%')
                .justifyContent(FlexAlign.SpaceBetween)

                Text(TextFormatters.readableText(card.title, '记忆标题无法读取，请重新录入。'))
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ top: PMSpacing.SM })

                if (TextFormatters.shouldShowSummary(card.title, card.summary)) {
                  Text(TextFormatters.readableText(card.summary, '这条记忆摘要无法读取，请重新录入。'))
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(20)
                    .margin({ top: PMSpacing.XS })
                }
              }

              // 原始记录展开
              Row() {
                Text(this.expandedCardId === card.id ? '▲ 收起原始碎片' : '▼ 查看原始采集碎片')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.BRAND)
              }
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.XS })
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

              // 生命周期操作：人工确认来源 / 归档（可恢复，双击防护）
              if (this.expandedCardId === card.id) {
                Row({ space: PMSpacing.SM }) {
                  Button(this.lifecycleActionCardId === card.id ? '处理中…' : '确认来源')
                    .height(36)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.BRAND)
                    .backgroundColor(PMColors.BRAND_LIGHT)
                    .borderRadius(PMRadius.SM)
                    .enabled(this.lifecycleActionCardId === '')
                    .onClick(() => {
                      this.confirmCardSource(card.id);
                    })

                  Button('归档')
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
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Start)
          }
        }, (card: KnowledgeCard) => card.id)
      }
      .layoutWeight(1)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
    }
    .layoutWeight(1)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  private getFilteredCards(): KnowledgeCard[] {
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
  @Builder
  private ActionView() {
    Column() {
      // 轻量状态栏 (无三个巨大 Card)
      Row() {
        Row() {
          Text('进行中')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text(` ${this.actions.filter((a) => a.status === 'DOING').length}`)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
        }
        .margin({ right: PMSpacing.LG })

        Row() {
          Text('待开始')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text(` ${this.actions.filter((a) => a.status === 'TODO').length}`)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
        }
        .margin({ right: PMSpacing.LG })

        Row() {
          Text('已完成')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text(` ${this.actions.filter((a) => a.status === 'DONE').length}`)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SUCCESS)
        }
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
      .backgroundColor(PMColors.SURFACE)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

      List({ space: PMSpacing.MD }) {
        ForEach(this.actions, (action: ActionItem) => {
          ListItem() {
            Column() {
              Row() {
                StatusBadge({ status: action.status })
                if (action.status !== 'DONE') {
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

              if (action.sourceIntervention !== null && action.sourceIntervention !== undefined && action.sourceIntervention.title !== '') {
                Text(`来源：${TextFormatters.readableText(action.sourceIntervention.title, '提醒来源无法读取')}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.EVIDENCE)
                  .margin({ top: 4 })
              }

              if (action.status === 'DONE' && action.resultText !== undefined && action.resultText !== '') {
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
                .backgroundColor(PMColors.SUCCESS_LIGHT)
                .borderRadius(PMRadius.SM)
                .alignItems(HorizontalAlign.Start)
                .margin({ top: PMSpacing.SM })
              }

              if (action.resultCard !== null && action.resultCard !== undefined && action.resultCard.title !== '') {
                Text('✓ 已写入项目记忆')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.MEMORY)
                  .margin({ top: PMSpacing.SM })
              }

              if (action.status === 'TODO' || action.status === 'DOING') {
                Row() {
                  if (action.status === 'TODO') {
                    Button(this.startingActionId === action.id ? '启动中...' : '开始行动')
                      .fontSize(PMFontSize.BUTTON)
                      .fontColor(PMColors.INK_PRIMARY)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .border({ width: 1, color: PMColors.BORDER })
                      .borderRadius(PMRadius.SM)
                      .enabled(this.startingActionId === '')
                      .onClick(() => {
                        this.startAction(action.id);
                      })
                  }

                  Button('完成并写回执')
                    .fontSize(PMFontSize.BUTTON)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SURFACE)
                    .backgroundColor(PMColors.BRAND)
                    .borderRadius(PMRadius.SM)
                    .margin({ left: action.status === 'TODO' ? PMSpacing.SM : 0 })
                    .onClick(() => {
                      this.openCompleteDialog(action.id);
                    })
                }
                .width('100%')
                .justifyContent(FlexAlign.End)
                .margin({ top: PMSpacing.MD })
              }
            }
            .width('100%')
            .padding(PMSpacing.LG)
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

      Text(`我会根据当前项目的 ${this.project._count.cards} 条记忆、${this.actions.filter((a) => a.status === 'DONE').length} 项已完成行动和已有成果回答。`)
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
  private CopilotView() {
    Column() {
      // 问忆程项目上下文看板 (避免空白页面)
      Column() {
        Text('问忆程')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)

        Text(`基于当前项目的 ${this.project._count.cards} 条记忆、${this.actions.filter((a) => a.status === 'DONE').length} 项完成行动与 ${this.interventions.filter((i) => i.status === 'OPEN').length} 条提醒，回答状态事实、历史依据与下一步建议。`)
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

      // 常用问题快捷推荐：两列完整展示，避免把关键问题截断在横向滚动条里。
      Column({ space: PMSpacing.SM }) {
        Row() {
          Button('现在进展怎么样？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(44)
            .layoutWeight(1)
            .onClick(() => {
              this.copilotQuestion = '总结当前项目的真实进展与已完成事实';
              this.sendCopilotMessage();
            })

          Button('消融实验完成了吗？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(44)
            .layoutWeight(1)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              this.copilotQuestion = '检查当前项目中消融实验相关的记录和结果';
              this.sendCopilotMessage();
            })
        }
        .width('100%')

        Row() {
          Button('为什么提醒我？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(44)
            .layoutWeight(1)
            .onClick(() => {
              this.copilotQuestion = '为什么当前项目会触发提醒？依据是什么？';
              this.sendCopilotMessage();
            })

          Button('最近完成了什么？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(44)
            .layoutWeight(1)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              this.copilotQuestion = '最近完成了哪些待办行动和回执？';
              this.sendCopilotMessage();
            })
        }
        .width('100%')
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })

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
              if (msg.role === 'ASSISTANT' && msg.trustReceipt !== undefined) {
                Column() {
                  Row() {
                    Text(msg.trustReceipt.supportState === 'SUPPORTED' ? '依据充分' :
                      msg.trustReceipt.supportState === 'CONTESTED' ? '存在冲突' : '证据不足')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(msg.trustReceipt.supportState === 'SUPPORTED' ? PMColors.SUCCESS :
                        msg.trustReceipt.supportState === 'CONTESTED' ? PMColors.EVIDENCE : PMColors.RISK)
                      .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
                      .backgroundColor(msg.trustReceipt.supportState === 'SUPPORTED' ? PMColors.SUCCESS_LIGHT :
                        msg.trustReceipt.supportState === 'CONTESTED' ? PMColors.EVIDENCE_LIGHT : PMColors.RISK_LIGHT)
                      .borderRadius(PMRadius.FULL)
                      .accessibilityText(`证据支持状态：${msg.trustReceipt.supportState === 'SUPPORTED' ? '依据充分' :
                        msg.trustReceipt.supportState === 'CONTESTED' ? '存在冲突' : '证据不足'}`)

                    Blank()

                    Button(this.expandedCopilotReceiptId === (msg.runId ?? `message-${idx}`) ? '收起回执' : '查看证据回执')
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

                  if (this.expandedCopilotReceiptId === (msg.runId ?? `message-${idx}`)) {
                    Column({ space: PMSpacing.SM }) {
                      Text(`检索方式：${msg.trustReceipt.retrievalMode === 'hybrid' ? '混合检索' :
                        msg.trustReceipt.retrievalMode === 'keyword_fallback' ? '关键词降级' :
                          msg.trustReceipt.retrievalMode === 'semantic_only' ? '语义检索' : '未检索到证据'}`)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_SECONDARY)

                      ForEach(msg.trustReceipt.claims, (claim: EvidenceClaim, claimIndex: number) => {
                        Column() {
                          Text(`结论 ${claimIndex + 1} · ${claim.support === 'SUPPORTED' ? '依据充分' : claim.support === 'CONTESTED' ? '存在冲突' : '证据不足'}`)
                            .fontSize(PMFontSize.CAPTION)
                            .fontWeight(FontWeight.Medium)
                            .fontColor(PMColors.INK_PRIMARY)
                          Text(claim.text)
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.INK_SECONDARY)
                            .lineHeight(18)
                            .margin({ top: 2 })
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
                        }, (cite: AgentCitation) => cite.cardId)
                      }

                      if (msg.trustReceipt.refusalReason !== undefined && msg.trustReceipt.refusalReason !== '') {
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

              // 引用证据卡片
              if (msg.citations.length > 0 && msg.trustReceipt === undefined) {
                Column() {
                  Text('引用证据：')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.MEMORY)
                    .margin({ top: PMSpacing.SM, bottom: 2 })

                  ForEach(msg.citations, (cite: AgentCitation) => {
                    Text(`· ${TextFormatters.readableText(cite.title, '记忆标题无法读取')}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.MEMORY)
                  }, (cite: AgentCitation) => cite.cardId)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }

              // 建议行动与两步确认
              if (msg.proposedActions.length > 0 && (msg.trustReceipt === undefined || msg.trustReceipt.supportState === 'SUPPORTED')) {
                Column() {
                  Text('建议行动（需你确认）：')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.EVIDENCE)
                    .margin({ top: PMSpacing.SM, bottom: 4 })

                  ForEach(msg.proposedActions, (act: ProposedAction) => {
                    Row() {
                      Text(act.title)
                        .fontSize(PMFontSize.BODY)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_PRIMARY)
                        .layoutWeight(1)

                      Button(this.executingToolTitle === act.title ? '执行中...' : '确认执行')
                        .fontSize(PMFontSize.CAPTION)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.SURFACE)
                        .backgroundColor(PMColors.BRAND)
                        .borderRadius(PMRadius.XS)
                        .enabled(this.executingToolTitle === '')
                        .onClick(() => {
                          this.confirmCopilotTool(act, msg.runId);
                        })
                    }
                    .width('100%')
                    .padding(PMSpacing.SM)
                    .backgroundColor(PMColors.EVIDENCE_LIGHT)
                    .borderRadius(PMRadius.SM)
                    .margin({ top: 2 })
                  }, (act: ProposedAction) => act.title)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(msg.role === 'USER' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
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

        Button(this.isAskingCopilot ? '思考中...' : '发送')
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
            Text('正文')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
            Text(`最后生成于 ${this.currentArtifact !== undefined && this.currentArtifact.createdAt.length >= 10 ? this.currentArtifact.createdAt.substring(0, 10) : '近期'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: 2 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          Row() {
            Button('证据透视')
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

            Button('评委质询')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.RISK)
              .backgroundColor(PMColors.RISK_LIGHT)
              .borderRadius(PMRadius.XS)
              .height(36)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
              .margin({ left: 6 })
              .onClick(() => {
                this.showJudgeRebuttal = true;
              })

            Button(this.isExportingProvenance ? '导出中…' : '带存证导出')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.XS)
              .height(36)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM })
              .margin({ left: 6 })
              .enabled(!this.isExportingProvenance)
              .onClick(() => {
                this.copyArtifactWithProvenance();
              })
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

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
      .padding({ left: PMSpacing.XL, right: PMSpacing.XL, top: PMSpacing.LG, bottom: PMSpacing.SECTION })
      .backgroundColor(PMColors.SURFACE)
      .alignItems(HorizontalAlign.Start)
    }
    .layoutWeight(1)
    .backgroundColor(PMColors.BACKGROUND)
    .scrollBar(BarState.Off)
    .transition(PMTransition.CONTENT_ENTER)
    .constraintSize({ maxWidth: PMBreakpoint.contentMaxWidth(this.widthBp) })
  }

  @Builder
  private ArtifactView() {
    if (this.isArtifactReader && this.currentArtifact !== undefined && this.currentArtifact.content !== '') {
      this.ArtifactReaderContent()
    } else {
      Column() {
      // 4 大成果类型切换
      Row() {
        Button('作品说明')
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

        Button('答辩 PPT')
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

        Button('项目周报')
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

        Button('README')
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
          if (this.currentArtifact !== undefined && this.currentArtifact.content !== '') {
            // 已生成状态：展示元信息、正文与复制/生成新版本操作
            Column() {
              Row() {
                Column() {
                  Text(TextFormatters.artifactTypeToChinese(this.selectedArtifactType))
                    .fontSize(PMFontSize.SECTION_TITLE)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)

                  Text(`最后生成于 ${this.currentArtifact.createdAt.length >= 10 ? this.currentArtifact.createdAt.substring(0, 10) : '近期'}`)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ top: 2 })
                }
                .alignItems(HorizontalAlign.Start)

                Row() {
                  Button('复制正文')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_PRIMARY)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .border({ width: 1, color: PMColors.BORDER })
                    .borderRadius(PMRadius.SM)
                    .onClick(() => {
                      this.copyArtifactContent();
                    })

                  Button(this.isGeneratingArtifact ? '生成中...' : '生成新版本')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SURFACE)
                    .backgroundColor(PMColors.BRAND)
                    .borderRadius(PMRadius.SM)
                    .margin({ left: PMSpacing.SM })
                    .enabled(!this.isGeneratingArtifact)
                    .onClick(() => {
                      this.generateArtifact();
                    })
                }
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Button('进入阅读模式')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .border({ width: 1, color: PMColors.BRAND })
                .borderRadius(PMRadius.SM)
                .height(48)
                .width('100%')
                .margin({ top: PMSpacing.MD })
                .onClick(() => {
                  this.isArtifactReader = true;
                })
                .accessibilityText('进入成果阅读模式')

              Column() {
                MarkdownView({ content: TextFormatters.readableMarkdown(this.currentArtifact.content) })
              }
              .width('100%')
              .margin({ top: PMSpacing.MD })
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Start)
          } else {
            // 未生成空状态：只保留居中卡片单一 Primary CTA
            Column() {
              ArtifactIcon({ isSelected: false, iconSize: 36 })
                .margin({ bottom: PMSpacing.MD })

              Text(`暂无${TextFormatters.artifactTypeToChinese(this.selectedArtifactType)}`)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)

              Text('基于项目记忆与行动生成可编辑成果。')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_SECONDARY)
                .textAlign(TextAlign.Center)
                .lineHeight(22)
                .margin({ top: PMSpacing.SM, bottom: PMSpacing.LG })

              Button(this.isGeneratingArtifact ? '正在生成...' : `生成${TextFormatters.artifactTypeToChinese(this.selectedArtifactType)}`)
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL, top: PMSpacing.MD, bottom: PMSpacing.MD })
                .enabled(!this.isGeneratingArtifact)
                .onClick(() => {
                  this.generateArtifact();
                })
            }
            .width('100%')
            .padding(PMSpacing.SECTION)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Center)
          }
        }
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, bottom: PMSpacing.LG })
      }
      .layoutWeight(1)
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
    Stack() {
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
          if (this.currentTabIndex === 0) {
            this.CockpitView()
          } else if (this.currentTabIndex === 1) {
            this.MemoryView()
          } else if (this.currentTabIndex === 2) {
            this.ActionView()
          } else if (this.currentTabIndex === 3) {
            this.CopilotView()
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
              Button('取消')
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .onClick(() => {
                  this.completingActionId = '';
                })

              Button(this.isSubmittingAction ? '提交中...' : '确认完成')
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
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .padding({ left: PMSpacing.XL, right: PMSpacing.XL })
        .justifyContent(FlexAlign.Center)
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.COLOR, curve: PMMotion.CURVE_CONTENT }))
      }

      // 项目设置弹窗
      if (this.showSettingsDialog) {
        Column() {
          Column() {
            Text('项目设置')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            Text('只修改项目基本信息，不会改变已有的记忆、提醒或行动。')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(20)
              .margin({ top: PMSpacing.XS })

            Text('项目名称')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.MD })
            TextInput({ text: this.editTitle })
              .onChange((v: string) => {
                this.editTitle = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })

            Text('项目目标')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.SM })
            TextInput({ text: this.editGoal })
              .onChange((v: string) => {
                this.editGoal = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })

            Row() {
              Text('截止日期 (YYYY-MM-DD)')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
                .layoutWeight(1)
              if (this.editDeadline !== '') {
                Button('清除截止日期')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.RISK)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.XS)
                  .height(28)
                  .onClick(() => {
                    this.editDeadline = '';
                  })
              }
            }
            .width('100%')
            .margin({ top: PMSpacing.SM })

            TextInput({ text: this.editDeadline, placeholder: '例如 2026-10-01，留空表示无截止日期' })
              .onChange((v: string) => {
                this.editDeadline = v;
              })
              .fontSize(PMFontSize.BODY)
              .height(48)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .accessibilityText('输入项目截止日期，格式为 YYYY-MM-DD')

            // 提醒策略（B1）：预算与静默时段；V1 为本机安装的全局共享预算
            Column() {
              Text('提醒策略')
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)

              Text('每日预算（全局共享，0–50 次）')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.SM })
              TextInput({ text: this.policyDailyBudget, placeholder: '3' })
                .onChange((v: string) => {
                  this.policyDailyBudget = v;
                })
                .fontSize(PMFontSize.BODY)
                .height(40)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .margin({ top: 4 })
                .accessibilityText('每天最多提醒次数')

              Text('静默时段（跨午夜可用，格式 HH:mm）')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.SM })
              Row({ space: PMSpacing.SM }) {
                TextInput({ text: this.policyQuietStart, placeholder: '23:00' })
                  .onChange((v: string) => {
                    this.policyQuietStart = v;
                  })
                  .fontSize(PMFontSize.BODY)
                  .height(40)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER })
                  .layoutWeight(1)
                  .accessibilityText('静默开始时间')
                TextInput({ text: this.policyQuietEnd, placeholder: '08:00' })
                  .onChange((v: string) => {
                    this.policyQuietEnd = v;
                  })
                  .fontSize(PMFontSize.BODY)
                  .height(40)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .border({ width: 1, color: PMColors.BORDER })
                  .layoutWeight(1)
                  .accessibilityText('静默结束时间')
              }
              .width('100%')
              .margin({ top: 4 })

              if (this.policySuggestions.length > 0) {
                ForEach(this.policySuggestions, (suggestion: PolicySuggestion) => {
                  Column() {
                    Text(suggestion.text)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_SECONDARY)
                      .lineHeight(18)
                    Row({ space: PMSpacing.SM }) {
                      Button('降低频率')
                        .height(32)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.SURFACE)
                        .backgroundColor(PMColors.BRAND)
                        .borderRadius(PMRadius.SM)
                        .onClick(() => {
                          this.decideSuggestion('CONFIRM', suggestion.triggerType);
                        })
                      Button('保持现状')
                        .height(32)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_SECONDARY)
                        .backgroundColor(PMColors.SURFACE_SUBTLE)
                        .borderRadius(PMRadius.SM)
                        .onClick(() => {
                          this.decideSuggestion('DISMISS', suggestion.triggerType);
                        })
                    }
                    .margin({ top: PMSpacing.XS })
                  }
                  .width('100%')
                  .padding(PMSpacing.SM)
                  .backgroundColor(PMColors.BRAND_LIGHT)
                  .borderRadius(PMRadius.SM)
                  .margin({ top: PMSpacing.SM })
                  .alignItems(HorizontalAlign.Start)
                }, (suggestion: PolicySuggestion) => suggestion.triggerType)
              }

              if (this.policyRecentSuppressions !== '') {
                Text(this.policyRecentSuppressions)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
                  .lineHeight(18)
                  .margin({ top: PMSpacing.SM })
              }

              if (this.policyFeedback !== '') {
                Text(this.policyFeedback)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(this.policyFeedback.indexOf('失败') >= 0 || this.policyFeedback.indexOf('必须') >= 0 || this.policyFeedback.indexOf('格式') >= 0
                    ? PMColors.RISK : PMColors.SUCCESS)
                  .margin({ top: PMSpacing.XS })
              }

              Row({ space: PMSpacing.SM }) {
                Button(this.isSavingPolicy ? '保存中…' : '保存策略')
                  .height(36)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .layoutWeight(1)
                  .enabled(!this.isSavingPolicy)
                  .onClick(() => {
                    this.savePolicy();
                  })
                Button('恢复默认')
                  .height(36)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .onClick(() => {
                    this.restorePolicyDefaults();
                  })
              }
              .width('100%')
              .margin({ top: PMSpacing.SM })
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.LG })
            .alignItems(HorizontalAlign.Start)

            Row() {
              Button('取消')
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .height(48)
                .layoutWeight(1)
                .onClick(() => {
                  this.showSettingsDialog = false;
                })

              Button(this.isSavingSettings ? '保存中...' : '保存修改')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(48)
                .layoutWeight(1.8)
                .margin({ left: PMSpacing.MD })
                .onClick(() => {
                  this.saveSettings();
                })
            }
            .margin({ top: PMSpacing.LG })
            .width('100%')
          }
          .width('100%')
          .padding(PMSpacing.XL)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .shadow({ radius: 16, color: 'rgba(0, 0, 0, 0.10)', offsetX: 0, offsetY: 8 })
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
    .bindSheet($$this.showCapturePanel, this.CaptureSheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true
    })
  }
}
