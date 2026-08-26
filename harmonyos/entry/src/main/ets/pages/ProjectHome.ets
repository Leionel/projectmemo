import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import pasteboard from '@ohos.pasteboard';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { picker } from '@kit.CoreFileKit';
import { Project, ProjectDashboard, ApiError, ReadinessItem, ProjectUpdateInput } from '../models/Project';
import { ProjectDetail, KnowledgeCard, CardLink, IncomingCardLink } from '../models/Memory';
import { Milestone, Deliverable } from '../models/Milestone';
import { Intervention, ProposedAction } from '../models/Intervention';
import { ActionItem } from '../models/Action';
import { ArtifactItem } from '../models/Artifact';
import { AgentMessage, AgentCitation, ActionCreatePayload, ArtifactGeneratePayload } from '../models/Copilot';

import { ProjectService } from '../services/ProjectService';
import { InterventionService } from '../services/InterventionService';
import { MemoryService } from '../services/MemoryService';
import { ActionService } from '../services/ActionService';
import { ArtifactService } from '../services/ArtifactService';
import { CopilotService } from '../services/CopilotService';
import { NotificationService } from '../services/NotificationService';
import { AttachmentService } from '../services/AttachmentService';
import { MilestoneService } from '../services/MilestoneService';

import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily } from '../common/DesignTokens';
import { SeverityBadge, StatusBadge, MemoryTypeBadge } from '../components/MetricBadge';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import {
  FolderIcon,
  MemoryIcon,
  TaskIcon,
  CopilotIcon,
  ArtifactIcon,
  SettingsIcon,
  ClockIcon,
  CheckIcon,
  AlertIcon,
  SpineNodeIcon
} from '../components/PMIcons';
import { TextFormatters } from '../common/TextFormatters';
import { MarkdownView } from '../components/MarkdownView';

@Entry
@Component
struct ProjectHome {
  @State projectId: string = '';
  @State currentTabIndex: number = 0;

  // 数据主状态
  @State project: ProjectDetail = new ProjectDetail();
  @State dashboard: ProjectDashboard = new ProjectDashboard();
  @State interventions: Intervention[] = [];
  @State actions: ActionItem[] = [];
  @State artifacts: ArtifactItem[] = [];
  @State chatMessages: AgentMessage[] = [];
  @State milestones: Milestone[] = [];

  // 通用状态
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';

  // Tab 0: 驾驶舱专属状态
  @State rawText: string = '';
  @State sourceType: string = '随手记录';
  @State isCapturing: boolean = false;
  @State captureError: string = '';
  @State isUploadingAttachment: boolean = false;
  @State attachmentFeedback: string = '';
  @State isEvaluating: boolean = false;
  @State evaluateError: string = '';
  @State showSettingsDialog: boolean = false;
  @State editTitle: string = '';
  @State editGoal: string = '';
  @State editDescription: string = '';
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

  // Tab 4: 成果专属状态
  @State selectedArtifactType: string = 'competition_outline';
  @State isGeneratingArtifact: boolean = false;
  @State artifactError: string = '';
  @State currentArtifact: ArtifactItem | undefined = undefined;
  @State isConfirmingEvidence: boolean = false;
  @State evidenceFeedback: string = '';
  @State evidenceError: string = '';

  private projectService: ProjectService = new ProjectService();
  private interventionService: InterventionService = new InterventionService();
  private memoryService: MemoryService = new MemoryService();
  private actionService: ActionService = new ActionService();
  private artifactService: ArtifactService = new ArtifactService();
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
    if (this.projectId === '') {
      this.routeError = '页面参数缺失，项目ID无效';
      return;
    }
    this.loadAllData();
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
    this.attachmentFeedback = '正在上传并提取内容…';
    try {
      const result = await this.attachmentService.upload(this.projectId, uri, fileName, mimeType);
      if (result.isDuplicate) {
        this.attachmentFeedback = '该附件已存在，已复用原记录';
      } else if (result.attachment.extractionStatus === 'SUCCESS') {
        this.attachmentFeedback = '附件已归档并沉淀为项目记忆';
      } else if (result.attachment.extractionStatus === 'NEEDS_OCR') {
        this.attachmentFeedback = '附件已保存；当前环境需要 OCR，未生成伪造记忆';
      } else {
        this.attachmentFeedback = `附件已保存；提取失败：${result.attachment.extractionError}`;
      }
      await this.loadAllData();
    } catch (error) {
      this.attachmentFeedback = error instanceof ApiError ? error.message : '附件上传失败';
    } finally {
      this.isUploadingAttachment = false;
    }
  }

  private async loadAllData(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const detailP = this.projectService.getProjectDetail(this.projectId);
      const listP = this.projectService.listProjects();
      const intervP = this.interventionService.list(this.projectId);
      const actionP = this.actionService.list(this.projectId);
      const artifactP = this.artifactService.list(this.projectId);
      const chatP = this.copilotService.getChatHistory(this.projectId);
      const milestoneP = this.milestoneService.list(this.projectId).catch(() => [] as Milestone[]);

      const res = await Promise.all([detailP, listP, intervP, actionP, artifactP, chatP, milestoneP]);
      this.project = res[0];
      this.dashboard = this.findDashboard(res[1]);
      this.interventions = res[2];
      this.actions = res[3];
      this.artifacts = res[4];
      this.chatMessages = res[5];
      this.milestones = res[6];

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
    for (const evidence of deliverable.evidences) {
      if (evidence.evidenceType === evidenceType && evidence.confirmed) return true;
    }
    return false;
  }

  private getEvidenceCandidates(evidenceType: string): KnowledgeCard[] {
    const candidates: KnowledgeCard[] = [];
    for (const card of this.project.cards) {
      const attachmentType = card.attachment?.type ?? '';
      const attachmentMatch = (evidenceType === 'pdf_attachment' && attachmentType === 'PDF') ||
        (evidenceType === 'image_attachment' && attachmentType === 'IMAGE');
      if (card.type === evidenceType || attachmentMatch) candidates.push(card);
      if (candidates.length >= 2) break;
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

  // --- 驾驶舱操作 ---
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

  private openSettingsDialog(): void {
    this.editTitle = this.project.title;
    this.editGoal = this.project.goal;
    this.editDescription = this.project.description;
    this.showSettingsDialog = true;
  }

  private async saveSettings(): Promise<void> {
    if (this.isSavingSettings) {
      return;
    }
    this.isSavingSettings = true;
    try {
      const input = new ProjectUpdateInput();
      input.title = this.editTitle.trim();
      input.goal = this.editGoal.trim();
      input.description = this.editDescription.trim();
      await this.projectService.updateProject(this.projectId, input);
      this.showSettingsDialog = false;
      promptAction.showToast({ message: '项目信息已更新' });
      await this.loadAllData();
    } catch (e) {
      promptAction.showToast({ message: '更新失败' });
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

  private async confirmCopilotTool(action: ProposedAction): Promise<void> {
    this.executingToolTitle = action.title;
    try {
      if (action.kind === 'generate_artifact') {
        const payload = new ArtifactGeneratePayload();
        payload.artifactType = action.artifactType ?? 'competition_outline';
        await this.copilotService.confirmTool(this.projectId, action.kind, payload);
      } else {
        const payload = new ActionCreatePayload();
        payload.title = action.title;
        payload.description = action.description;
        payload.priority = action.priority;
        await this.copilotService.confirmTool(this.projectId, action.kind, payload);
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
    const pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.currentArtifact.content);
    systemPasteboard.setData(pasteData);
    promptAction.showToast({ message: '已复制正文' });
  }

  // ----------------------------------------------------
  // 顶部导航栏 Header (长项目名称自然两行排版，无英文副标)
  // ----------------------------------------------------
  @Builder
  private TopHeader() {
    Row() {
      Row() {
        Text('‹')
          .fontSize(22)
          .fontWeight(FontWeight.Regular)
          .fontColor(PMColors.INK_PRIMARY)
          .margin({ top: -2, right: 3 })
        Text('项目')
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
      }
      .padding({ left: PMSpacing.SM, right: PMSpacing.MD, top: 4, bottom: 4 })
      .borderRadius(PMRadius.SM)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .border({ width: 1, color: PMColors.BORDER })
      .onClick(() => {
        router.back();
      })
      .accessibilityText('返回项目列表')

      Column() {
        Text(this.project.title !== '' ? this.project.title : '项目档案')
          .fontSize(PMFontSize.PAGE_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontFamily(PMFontFamily.SANS)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        Text(this.currentTabIndex === 0 ? '驾驶舱' :
          this.currentTabIndex === 1 ? '记忆' :
            this.currentTabIndex === 2 ? '待办' :
              this.currentTabIndex === 3 ? '问忆程' : '成果')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: 2 })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ left: PMSpacing.MD })

      Row() {
        SettingsIcon({ isSelected: false, iconSize: 20 })
      }
      .padding(PMSpacing.SM)
      .onClick(() => {
        this.openSettingsDialog();
      })
      .accessibilityText('项目设置')
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }

  // ----------------------------------------------------
  // 底部导航栏 Bar (5 项：驾驶舱 / 记忆 / 待办 / 问忆程 / 成果)
  // ----------------------------------------------------
  @Builder
  private BottomTabBar() {
    Row() {
      // 1. 驾驶舱
      Column() {
        FolderIcon({ isSelected: this.currentTabIndex === 0, iconSize: 20 })
        Text('驾驶舱')
          .fontSize(PMFontSize.BOTTOM_NAV)
          .fontFamily(PMFontFamily.SERIF)
          .fontWeight(this.currentTabIndex === 0 ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.currentTabIndex === 0 ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ top: 3 })
      }
      .layoutWeight(1)
      .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
      .onClick(() => {
        this.currentTabIndex = 0;
      })
      .accessibilityText('驾驶舱')
      .accessibilitySelected(this.currentTabIndex === 0)

      // 2. 记忆
      Column() {
        MemoryIcon({ isSelected: this.currentTabIndex === 1, iconSize: 20 })
        Text('记忆')
          .fontSize(PMFontSize.BOTTOM_NAV)
          .fontFamily(PMFontFamily.SERIF)
          .fontWeight(this.currentTabIndex === 1 ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.currentTabIndex === 1 ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ top: 3 })
      }
      .layoutWeight(1)
      .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
      .onClick(() => {
        this.currentTabIndex = 1;
      })
      .accessibilityText('记忆')
      .accessibilitySelected(this.currentTabIndex === 1)

      // 3. 待办
      Column() {
        TaskIcon({ isSelected: this.currentTabIndex === 2, iconSize: 20 })
        Text('待办')
          .fontSize(PMFontSize.BOTTOM_NAV)
          .fontFamily(PMFontFamily.SERIF)
          .fontWeight(this.currentTabIndex === 2 ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.currentTabIndex === 2 ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ top: 3 })
      }
      .layoutWeight(1)
      .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
      .onClick(() => {
        this.currentTabIndex = 2;
      })
      .accessibilityText('待办')
      .accessibilitySelected(this.currentTabIndex === 2)

      // 4. 问忆程
      Column() {
        CopilotIcon({ isSelected: this.currentTabIndex === 3, iconSize: 20 })
        Text('问忆程')
          .fontSize(PMFontSize.BOTTOM_NAV)
          .fontFamily(PMFontFamily.SERIF)
          .fontWeight(this.currentTabIndex === 3 ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.currentTabIndex === 3 ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ top: 3 })
      }
      .layoutWeight(1)
      .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
      .onClick(() => {
        this.currentTabIndex = 3;
      })
      .accessibilityText('问忆程')
      .accessibilitySelected(this.currentTabIndex === 3)

      // 5. 成果
      Column() {
        ArtifactIcon({ isSelected: this.currentTabIndex === 4, iconSize: 20 })
        Text('成果')
          .fontSize(PMFontSize.BOTTOM_NAV)
          .fontFamily(PMFontFamily.SERIF)
          .fontWeight(this.currentTabIndex === 4 ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.currentTabIndex === 4 ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ top: 3 })
      }
      .layoutWeight(1)
      .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
      .onClick(() => {
        this.currentTabIndex = 4;
      })
      .accessibilityText('成果')
      .accessibilitySelected(this.currentTabIndex === 4)
    }
    .width('100%')
    .padding({ top: 6, bottom: 6 })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { top: 1 }, color: PMColors.BORDER })
  }

  // ----------------------------------------------------
  // Tab 0: 驾驶舱 (Cockpit) 视图 —— 围绕“三个问题”设计
  // ----------------------------------------------------
  @Builder
  private CockpitView() {
    Scroll() {
      Column() {
        // 问题一：现在怎么样？（当前判断与准备度）
        Column() {
          Row() {
            Column() {
              Text('当前状态')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
              Text(`备赛准备度 ${this.dashboard.readiness.percentage}%`)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)

            if (this.dashboard.deadline.label !== '') {
              Row() {
                ClockIcon({ iconSize: 12, color: PMColors.RISK })
                Text(this.dashboard.deadline.label)
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.RISK)
                  .margin({ left: 4 })
              }
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
              .backgroundColor(PMColors.RISK_LIGHT)
              .borderRadius(PMRadius.XS)
            }
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

          // 备赛准备度清单：已具备 (弱化收起) vs 当前缺口 (重点放大)
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
                  Text(interv.title)
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                    .layoutWeight(1)
                    .margin({ left: PMSpacing.SM })
                }
                .width('100%')

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

          // 演示情境控制
          Column() {
            Text('比赛演示情境控制：')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

            Row() {
              Button('模拟截止48h')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_PRIMARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.XS)
                .layoutWeight(1)
                .onClick(() => {
                  this.evaluate('deadline_48h');
                })

              Button('模拟停滞72h')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_PRIMARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.XS)
                .layoutWeight(1)
                .margin({ left: PMSpacing.XS })
                .onClick(() => {
                  this.evaluate('stale_72h');
                })

              Button('风险集中')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_PRIMARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.XS)
                .layoutWeight(1)
                .margin({ left: PMSpacing.XS })
                .onClick(() => {
                  this.evaluate('risk_cluster');
                })

              Button('清除模拟')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.RISK)
                .backgroundColor(PMColors.RISK_LIGHT)
                .borderRadius(PMRadius.XS)
                .layoutWeight(1)
                .margin({ left: PMSpacing.XS })
                .onClick(() => {
                  this.evaluate(undefined, true);
                })
            }
            .width('100%')
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.MD)
        .border({ width: 1, color: PMColors.BORDER })
        .margin({ top: PMSpacing.MD })

        // 问题三：记录与沉淀（捕获项目碎片）
        Column() {
          Row() {
            Text('记录项目碎片')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            Text(`已积累 ${this.project._count.cards} 条记忆`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.MEMORY)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)

          // 来源胶囊
          Scroll() {
            Row() {
              ForEach(this.sourceOptions, (src: string) => {
                Button(src)
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Regular)
                  .fontColor(this.sourceType === src ? PMColors.BRAND : PMColors.INK_SECONDARY)
                  .backgroundColor(this.sourceType === src ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.XS)
                  .margin({ right: PMSpacing.XS })
                  .onClick(() => {
                    this.sourceType = src;
                  })
              }, (src: string) => src)
            }
          }
          .width('100%')
          .scrollable(ScrollDirection.Horizontal)
          .margin({ top: PMSpacing.SM })

          Row() {
            Button(this.isUploadingAttachment ? '处理中…' : '选择图片')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.XS)
              .enabled(!this.isUploadingAttachment)
              .onClick(() => { this.pickAndUploadImage(); })
              .accessibilityText('选择图片并沉淀为项目记忆')

            Button(this.isUploadingAttachment ? '处理中…' : '选择 PDF')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.MEMORY)
              .backgroundColor(PMColors.MEMORY_LIGHT)
              .borderRadius(PMRadius.XS)
              .enabled(!this.isUploadingAttachment)
              .margin({ left: PMSpacing.XS })
              .onClick(() => { this.pickAndUploadPdf(); })
              .accessibilityText('选择 PDF 并沉淀为项目记忆')
          }
          .width('100%')
          .margin({ top: PMSpacing.SM })

          if (this.attachmentFeedback !== '') {
            Text(this.attachmentFeedback)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: PMSpacing.XS })
          }

          TextArea({
            text: this.rawText,
            placeholder: `记录${this.sourceType}内容（导师意见、实验结果、代码报错等，至少5个字）...`
          })
            .onChange((value: string) => {
              this.rawText = value;
            })
            .fontSize(PMFontSize.BODY)
            .height(80)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
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

            Button(this.isCapturing ? '正在归档...' : '沉淀为项目记忆')
              .fontSize(PMFontSize.BUTTON)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(this.rawText.trim().length >= 5 && !this.isCapturing ? PMColors.BRAND : PMColors.INK_MUTED)
              .borderRadius(PMRadius.SM)
              .enabled(this.rawText.trim().length >= 5 && !this.isCapturing)
              .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
              .onClick(() => {
                this.capture();
              })
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .alignItems(VerticalAlign.Center)
          .margin({ top: PMSpacing.MD })
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

        ForEach(this.milestones.slice(0, 1), (milestone: Milestone) => {
          Text(milestone.title)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: PMSpacing.SM })

          ForEach(milestone.deliverables.slice(0, 3), (deliverable: Deliverable) => {
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
                Row() {
                  Text(`${this.isEvidenceConfirmed(deliverable, evidenceType) ? '✓' : '○'} ${TextFormatters.memoryTypeToChinese(evidenceType)}`)
                    .fontSize(PMFontSize.SECONDARY)
                    .fontColor(this.isEvidenceConfirmed(deliverable, evidenceType) ? PMColors.SUCCESS : PMColors.INK_SECONDARY)
                    .layoutWeight(1)
                  if (!this.isEvidenceConfirmed(deliverable, evidenceType)) {
                    ForEach(this.getEvidenceCandidates(evidenceType).slice(0, 1), (card: KnowledgeCard) => {
                      Button(this.isConfirmingEvidence ? '确认中…' : '关联并确认')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.BRAND)
                        .backgroundColor(PMColors.BRAND_LIGHT)
                        .borderRadius(PMRadius.XS)
                        .enabled(!this.isConfirmingEvidence)
                        .onClick(() => {
                          this.confirmEvidence(deliverable.id, evidenceType, card.id);
                        })
                        .accessibilityText(`关联${card.title}并确认${TextFormatters.memoryTypeToChinese(evidenceType)}证据`)
                    }, (card: KnowledgeCard) => `${deliverable.id}-${evidenceType}-${card.id}`)
                    if (this.getEvidenceCandidates(evidenceType).length === 0) {
                      Text('暂无匹配记忆')
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                    }
                  }
                }
                .width('100%')
                .margin({ top: PMSpacing.XS })
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
              .margin({ right: PMSpacing.XS })
              .onClick(() => {
                this.selectMemoryType('all');
              })

            Button('论文笔记')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'paper_note' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'paper_note' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .margin({ right: PMSpacing.XS })
              .onClick(() => {
                this.selectMemoryType('paper_note');
              })

            Button('实验记录')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'experiment_log' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'experiment_log' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .margin({ right: PMSpacing.XS })
              .onClick(() => {
                this.selectMemoryType('experiment_log');
              })

            Button('阶段复盘')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'reflection' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'reflection' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .margin({ right: PMSpacing.XS })
              .onClick(() => {
                this.selectMemoryType('reflection');
              })

            Button('代码问题')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.selectedMemoryType === 'code_issue' ? PMColors.BRAND : PMColors.INK_SECONDARY)
              .backgroundColor(this.selectedMemoryType === 'code_issue' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.XS)
              .margin({ right: PMSpacing.XS })
              .onClick(() => {
                this.selectMemoryType('code_issue');
              })
          }
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
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
              Row() {
                MemoryTypeBadge({ type: card.type })
                Text(card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : card.createdAt)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Text(card.title)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ top: PMSpacing.SM })

              if (card.summary !== '') {
                Text(card.summary)
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(20)
                  .margin({ top: PMSpacing.XS })
              }

              // 原始记录展开
              Row() {
                Text(this.expandedCardId === card.id ? '▲ 收起原始碎片' : '▼ 查看原始采集碎片')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.BRAND)
              }
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.XS })
              .onClick(() => {
                this.expandedCardId = this.expandedCardId === card.id ? '' : card.id;
              })

              if (this.expandedCardId === card.id && card.capture !== null && card.capture !== undefined) {
                Column() {
                  Text(card.capture.rawText)
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

              if (action.sourceIntervention !== null && action.sourceIntervention !== undefined && action.sourceIntervention.title !== '') {
                Text(`来源：${action.sourceIntervention.title}`)
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
                  Text(action.resultText)
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
  }

  // ----------------------------------------------------
  // Tab 3: 问忆程 (Copilot) 视图 —— 结构化证据回答与项目上下文
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

      // 常用问题快捷推荐
      Scroll() {
        Row() {
          Button('现在进展怎么样？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
            .margin({ right: PMSpacing.XS })
            .onClick(() => {
              this.copilotQuestion = '总结当前项目的真实进展与已完成事实';
              this.sendCopilotMessage();
            })

          Button('消融实验完成了吗？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
            .margin({ right: PMSpacing.XS })
            .onClick(() => {
              this.copilotQuestion = '检查当前项目中消融实验相关的记录和结果';
              this.sendCopilotMessage();
            })

          Button('为什么提醒我？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
            .margin({ right: PMSpacing.XS })
            .onClick(() => {
              this.copilotQuestion = '为什么当前项目会触发提醒？依据是什么？';
              this.sendCopilotMessage();
            })

          Button('最近完成了什么？')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.XS)
            .onClick(() => {
              this.copilotQuestion = '最近完成了哪些待办行动和回执？';
              this.sendCopilotMessage();
            })
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })

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

              Text(msg.content)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
                .margin({ top: 4 })

              // 引用证据卡片
              if (msg.citations.length > 0) {
                Column() {
                  Text('引用证据：')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.MEMORY)
                    .margin({ top: PMSpacing.SM, bottom: 2 })

                  ForEach(msg.citations, (cite: AgentCitation) => {
                    Text(`· ${cite.title}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.MEMORY)
                  }, (cite: AgentCitation) => cite.cardId)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }

              // 建议行动与两步确认
              if (msg.proposedActions.length > 0) {
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
                          this.confirmCopilotTool(act);
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

      if (this.copilotFeedback !== '') {
        Text(this.copilotFeedback)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ bottom: 4 })
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

        Button(this.isAskingCopilot ? '思考中...' : '发送')
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(this.copilotQuestion.trim() !== '' && !this.isAskingCopilot ? PMColors.BRAND : PMColors.INK_MUTED)
          .borderRadius(PMRadius.SM)
          .margin({ left: PMSpacing.SM })
          .enabled(this.copilotQuestion.trim() !== '' && !this.isAskingCopilot)
          .onClick(() => {
            this.sendCopilotMessage();
          })
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.MD })
      .backgroundColor(PMColors.SURFACE_SUBTLE)
    }
    .layoutWeight(1)
  }

  // ----------------------------------------------------
  // Tab 4: 成果 (Artifacts) 视图 —— 消除重复 CTA
  // ----------------------------------------------------
  @Builder
  private ArtifactView() {
    Column() {
      // 4 大成果类型切换
      Row() {
        Button('作品说明大纲')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'competition_outline' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'competition_outline' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .layoutWeight(1)
          .onClick(() => {
            this.selectedArtifactType = 'competition_outline';
            this.updateCurrentArtifact();
          })

        Button('答辩 PPT')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'defense_ppt' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'defense_ppt' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .onClick(() => {
            this.selectedArtifactType = 'defense_ppt';
            this.updateCurrentArtifact();
          })

        Button('项目周报')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'weekly_report' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'weekly_report' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .onClick(() => {
            this.selectedArtifactType = 'weekly_report';
            this.updateCurrentArtifact();
          })

        Button('README')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.selectedArtifactType === 'readme' ? PMColors.BRAND : PMColors.INK_SECONDARY)
          .backgroundColor(this.selectedArtifactType === 'readme' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
          .layoutWeight(1)
          .margin({ left: PMSpacing.XS })
          .onClick(() => {
            this.selectedArtifactType = 'readme';
            this.updateCurrentArtifact();
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

              Column() {
                MarkdownView({ content: this.currentArtifact.content })
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

              Text('系统会根据项目记忆、行动记录和已有成果，整理一版可继续编辑的成果结构。')
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
  }

  // ----------------------------------------------------
  // 主构建入口
  // ----------------------------------------------------
  build() {
    Stack() {
      Column() {
        this.TopHeader()

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

        // 底部导航 Bar
        this.BottomTabBar()
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
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(19, 36, 58, 0.45)')
        .padding({ left: PMSpacing.XL, right: PMSpacing.XL })
        .justifyContent(FlexAlign.Center)
      }

      // 项目设置弹窗
      if (this.showSettingsDialog) {
        Column() {
          Column() {
            Text('项目设置')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

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
              .height(42)
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
              .height(42)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })

            Row() {
              Button('取消')
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .onClick(() => {
                  this.showSettingsDialog = false;
                })

              Button(this.isSavingSettings ? '保存中...' : '保存修改')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .margin({ left: PMSpacing.MD })
                .onClick(() => {
                  this.saveSettings();
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
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(19, 36, 58, 0.45)')
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
  }
}
