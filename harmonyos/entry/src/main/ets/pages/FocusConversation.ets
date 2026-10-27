import { supportsAgentPresentation } from '../common/AgentPresentationContract';
import router from '@ohos.router';
import util from '@ohos.util';
import { ApiError } from '../models/Project';
import { ConversationService } from '../services/ConversationService';
import { SessionStore } from '../services/SessionStore';
import { ConversationView, ConversationListItem, ConversationCreateInput, ConversationTurnInput, ConversationConfirmInput,
  ConversationMessage, ConversationRef, ConversationProposal, ConversationEntityInput, ConversationSource, ConversationProject, PriorityReason, FocusPreferenceInput } from '../models/Conversation';
import { missionStatusLabel } from '../common/MissionContract';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
import { ConversationWorkRef } from '../models/ConversationWork';
import { ConversationWorkPanel } from '../components/ConversationWorkPanel';
import { ConversationAnchorPanel } from '../components/ConversationAnchorPanel';
import { ConversationFileGuides, ConversationAnswer } from '../components/ConversationFileGuides';
import { AgentMessageBlocks } from '../components/AgentMessageBlocks';
import { AllowedAction, HydratedBlock } from '../models/AgentExperience';
import { ConversationUIActionInput, ConversationReadStep } from '../models/Conversation';
import { ConversationDraftStore, ConversationDraft } from '../services/ConversationDraftStore';
interface CloudHelpState { isVisible: boolean; }
interface AgentMessageInput { message: ConversationMessage; }

@Entry
@Component
struct FocusConversation {
  @State private view: ConversationView = new ConversationView();
  @State private sessions: ConversationListItem[] = [];
  @State private text: string = '';
  @State private busy: boolean = false;
  @State private pageVisible: boolean = true;
  @State private error: string = '';
  @State private cloud: boolean = false;
  @State private cloudAvailable: boolean = false;
  @State private analysisReady: boolean = false;
  @State private r4Available: boolean = false;
  @State private investigationMode: string = 'STANDARD';
  @State private showCloudHelp: boolean = false;
  @State private target: string = '';
  @State private expanded: string = '';
  @State private expandedRefs: string = '';
  @State private historyOpen: boolean = false;
  @State private showPreference: boolean = false;
  @State private scopeOpen: boolean = false;
  @State private workRef: ConversationWorkRef | null = null;
  @State private importanceText: string = '';
  @State private effortText: string = '';
  @State private longTermGoal: string = '';
  private preferenceVersion: number = 0;
  private originProjectId: string = '';
  private replyId: string = '';
  private entity: ConversationEntityInput | undefined = undefined;
  private generation: number = 0;
  private messageScroller: Scroller = new Scroller();
  private service: ConversationService = new ConversationService();
  private pending: ConversationTurnInput | null = null;
  private confirmationKeys: Map<string, string> = new Map<string, string>();
  private uiKeys: Map<string, ConversationUIActionInput> = new Map<string, ConversationUIActionInput>();
  private progressTimer: number = -1;
  private expired: () => void = (): void => { this.generation++; this.view = new ConversationView(); this.workRef = null; this.text = ''; this.pending = null; this.sessions = []; this.error = '登录已失效，请重新登录'; this.busy = false; this.cloud = false; this.analysisReady = false; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.initialize(); this.progressTimer = setInterval(() => { this.pollProgress(); }, 1500); }
  aboutToDisappear(): void { this.saveComposer(); ConversationDraftStore.flush(); this.generation++; if (this.progressTimer >= 0) clearInterval(this.progressTimer); SessionStore.offSessionExpired(this.expired); }
  onPageShow(): void { this.pageVisible = true; if (this.view.id !== '' && !this.busy) this.refresh(); }
  onPageHide(): void { this.pageVisible = false; this.saveComposer(); ConversationDraftStore.flush(); }
  private async initialize(): Promise<void> {
    const epoch = ++this.generation; this.busy = true;
    try {
      await ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id);
      const caps = await this.service.capabilities();
      if (epoch !== this.generation) return;
      this.cloudAvailable = caps.cloudAvailable;
      this.cloud = caps.cloudAvailable; this.analysisReady = true; this.r4Available = caps.r4Available === true;
      if (!caps.enabled) { this.error = '全局协作尚未开启'; return; }
      await this.service.syncWorkspace();
      if (epoch !== this.generation) return;
      const params = router.getParams() as Record<string, string>;
      const projectId = params?.['projectId'] ?? '';
      this.originProjectId = projectId;
      const list = await this.service.list(projectId);
      if (epoch !== this.generation) return;
      this.sessions = list.conversations;
      let id = params?.['conversationId'] ?? '';
      if (id === '' && params?.['originId']) {
        const input = new ConversationCreateInput(); input.requestId = util.generateRandomUUID();
        input.entry = { kind: params['originKind'], projectId: projectId, id: params['originId'] };
        id = (await this.service.entry(input)).id;
        this.text = '为什么提醒我这个？';
      } else if (id === '') {
        const recent = projectId !== '' ? list.conversations[0] : list.conversations.find((item: ConversationListItem) => item.scope === 'WORKSPACE');
        id = recent?.id ?? '';
      }
      if (id !== '') { const loaded = await this.service.read(id); if (epoch !== this.generation) return; this.view = loaded; }
      this.target = projectId || this.view.focusProjectId || '';
      if (this.text === '') this.restoreComposer();
      if (params?.['entityId']) {
        const entity = new ConversationEntityInput(); entity.id = params['entityId']; entity.kind = params['entityKind'] ?? 'MISSION'; entity.projectId = projectId; this.entity = entity;
        this.text = '请调查这个原对象的依据和下一步。';
      }
    } catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private fail(e: Error): void {
    this.error = e.message || '讨论暂不可用';
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) this.expired();
  }
  private async create(project: boolean = false): Promise<void> {
    if (this.busy) return;
    const epoch = ++this.generation; this.busy = true; this.error = '';
    try {
      const input = new ConversationCreateInput(); input.requestId = util.generateRandomUUID();
      if ((project && this.target !== '') || this.originProjectId !== '') { input.scope = 'PROJECT'; input.projectId = this.target || this.originProjectId; }
      const c = await this.service.create(input);
      const view = await this.service.read(c.id);
      if (epoch !== this.generation) return;
      this.view = view; this.text = ''; this.pending = null; this.replyId = ''; this.workRef = null;
      const sessions = (await this.service.list()).conversations;
      if (epoch === this.generation) this.sessions = sessions;
    } catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async refresh(): Promise<void> {
    const epoch = this.generation, owned = !this.busy; if (owned) this.busy = true;
    try { const v = await this.service.read(this.view.id); if (epoch === this.generation) { this.view = v; if (v.latestTurn?.canRetry) { this.pending = null; this.error = ''; } } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (owned && epoch === this.generation) this.busy = false; }
  }
  private async selectDiscussion(id: string): Promise<void> {
    if (this.busy) return;
    this.saveComposer();
    const epoch = ++this.generation; this.busy = true; this.pending = null; this.replyId = ''; this.workRef = null; this.historyOpen = false; this.error = '';
    try { const view = await this.service.read(id); if (epoch === this.generation) { this.view = view; this.target = view.focusProjectId ?? ''; this.restoreComposer(); } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async ask(): Promise<void> {
    if (this.busy || !this.analysisReady || this.text.trim() === '' || this.view.id === '') return;
    const epoch = this.generation; this.busy = true; this.error = '';
    if (this.pending === null || this.pending.message !== this.text.trim()) {
      const input = new ConversationTurnInput(); input.requestId = util.generateRandomUUID(); input.expectedVersion = this.view.version;
      input.message = this.text.trim(); input.llmContextApproved = this.cloud && this.cloudAvailable;
      if (this.r4Available) input.investigationMode = this.investigationMode;
      input.projectId = this.target === '' ? null : this.target;
      if (this.replyId !== '') input.replyToMessageId = this.replyId;
      if (this.entity !== undefined && this.entity.projectId === this.target) input.entityRef = this.entity;
      this.pending = input;
    }
    try {
      const reply = await this.service.ask(this.view.id, this.pending!);
      if (epoch !== this.generation) return;
      this.view = reply.conversation; this.target = this.view.focusProjectId ?? '';
      this.sessions = this.sessions.map((item: ConversationListItem): ConversationListItem => item.id === this.view.id ? { id: item.id, title: this.view.title, scope: item.scope, homeProjectId: item.homeProjectId } : item);
      setTimeout(() => { if (epoch === this.generation) this.messageScroller.scrollEdge(Edge.Bottom); }, 50);
      if (reply.status === 'ANSWERED' || reply.status === 'NEEDS_CLARIFICATION' || reply.status === 'CANCELLED') { this.text = ''; this.saveComposer(); this.pending = null; this.replyId = ''; }
      else { this.error = ''; if (['FAILED', 'UNKNOWN'].includes(reply.status)) this.pending = null; }
    } catch (e) { if (epoch === this.generation) { this.fail(e); await this.refresh(); } }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async confirm(p: ConversationProposal): Promise<void> {
    if (this.busy) return;
    const epoch = this.generation; this.busy = true;
    const input = new ConversationConfirmInput(); input.requestId = this.confirmationKeys.get(p.executionId) ?? util.generateRandomUUID();
    this.confirmationKeys.set(p.executionId, input.requestId); input.proposalHash = p.proposalHash;
    try { const r = await this.service.confirm(this.view.id, p.executionId, input); if (epoch === this.generation) { this.view = r.conversation; setTimeout(() => { if (epoch === this.generation) this.messageScroller.scrollEdge(Edge.Bottom); }, 50); } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private open(ref: ConversationRef, messageId: string): void {
    if (ref.kind === 'MISSION') router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: ref.projectId, missionId: ref.id, conversationId: this.view.id, originMessageId: messageId } });
    else router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: ref.projectId, tab: ref.kind === 'ACTION' ? 'actions' : 'memory', actionId: ref.kind === 'ACTION' ? ref.id : '', conversationId: this.view.id, originMessageId: messageId } });
  }
  private async loadPreference(): Promise<void> {
    if (this.target === '') return;
    const epoch = this.generation, target = this.target;
    try { const p = (await this.service.preference(target)).preference;
      if (epoch !== this.generation || target !== this.target) return;
      this.preferenceVersion = p?.version ?? 0; this.importanceText = p?.importance?.toString() ?? '';
      this.effortText = p?.estimatedMinutes?.toString() ?? ''; this.longTermGoal = p?.longTermGoal ?? ''; this.showPreference = true;
    } catch (e) { this.fail(e); }
  }
  private async savePreference(): Promise<void> {
    const input = new FocusPreferenceInput(); input.expectedVersion = this.preferenceVersion;
    input.importance = this.importanceText === '' ? null : Number(this.importanceText);
    input.estimatedMinutes = this.effortText === '' ? null : Number(this.effortText); input.longTermGoal = this.longTermGoal;
    try { const p = (await this.service.savePreference(this.target, input)).preference; this.preferenceVersion = p?.version ?? 0; this.showPreference = false; }
    catch (e) { this.fail(e); }
  }
  private cloudExplanation(): string {
    return !this.analysisReady ? '正在确认分析方式…' : !this.cloudAvailable ? '未配置云模型，当前仅整理项目记录' : this.cloud ? '发送即允许云模型分析本次授权项目资料，可关闭' : '仅整理项目记录，不调用云模型';
  }
  private hasPresentation(message: ConversationMessage): boolean { return supportsAgentPresentation(message.presentation); }
  private saveComposer(): void { if (this.view.id === '') return; const draft = new ConversationDraft(); draft.answer = this.text; ConversationDraftStore.save(this.view.id + ':composer', draft); }
  private restoreComposer(): void { this.text = ConversationDraftStore.read(this.view.id + ':composer').answer; }
  private modeIndex(): number { return this.investigationMode === 'QUICK' ? 0 : this.investigationMode === 'DEEP' ? 2 : 1; }
  private modeLabel(): string { return ['快速调查', '标准调查', '深入调查'][this.modeIndex()]; }
  private progressLabel(): string {
    const labels: Record<string, string> = { 'ROUTING': '正在定位相关项目', 'READING_SOURCE': '正在读取原资料', 'EVALUATING': '正在判断目标差距', 'WAITING_MODEL': '正在整理结论', 'STOPPING': '正在停止后续调查', 'READY': '正在保存回答', 'WAITING_USER': '正在整理需要你补充的条件' };
    return labels[this.view.activeTurn?.progress?.phase ?? ''] ?? '正在核对项目资料…';
  }
  private async pollProgress(): Promise<void> {
    if (!this.busy || !this.pageVisible || this.view.id === '') return;
    const epoch = this.generation, id = this.view.id;
    try { const view = await this.service.read(id); if (epoch === this.generation && this.view.id === id && view.version >= this.view.version) this.view = view; } catch { /* Original request handles errors. */ }
  }
  private async stop(): Promise<void> {
    if (!this.view.activeTurn) return;
    const epoch = this.generation;
    try { const result = await this.service.stop(this.view.id, this.view.activeTurn.id); if (epoch === this.generation) this.view = result.conversation; }
    catch (e) { if (epoch === this.generation) this.fail(e); }
  }
  private async uiAction(message: ConversationMessage, action: AllowedAction, answer: string): Promise<void> {
    if (this.busy || !action.enabled) return;
    const epoch = this.generation; this.busy = true; this.error = '';
    let input = this.uiKeys.get(action.bindingId);
    if (!input) { input = new ConversationUIActionInput(); input.messageId = message.id; input.bindingId = action.bindingId; input.requestId = util.generateRandomUUID(); input.expectedConversationVersion = this.view.version; this.uiKeys.set(action.bindingId, input); }
    try {
      const result = await this.service.uiAction(this.view.id, input);
      if (epoch !== this.generation) return;
      this.view = result.conversation;
      if (action.actionKind === 'ASK') {
        this.uiKeys.delete(action.bindingId); this.target = action.target.projectId; this.replyId = message.id; this.pending = null;
        this.text = answer || '请调查这条变化的依据，判断对原目标有什么影响，并给出待确认的下一步。'; this.saveComposer();
        if (answer.trim() !== '') { this.busy = false; await this.ask(); if (this.text === '') ConversationDraftStore.save(this.view.id + ':' + action.target.id, new ConversationDraft()); }
      } else if (action.actionKind === 'OPEN' && result.href && action.target.kind === 'ACTION') {
        this.workRef = { kind: 'ACTION', id: action.target.id, projectId: action.target.projectId };
        this.messageScroller.scrollEdge(Edge.Bottom);
      }
    } catch (e) {
      if (epoch === this.generation) { if (e instanceof ApiError && [401, 403, 404, 409, 422].includes(e.status)) this.uiKeys.delete(action.bindingId); this.fail(e); await this.refresh(); }
    } finally { if (epoch === this.generation) this.busy = false; }
  }
  @Builder private Message($$: AgentMessageInput) {
    Column({ space: 10 }) {
      if ($$.message.role === 'USER') {
        Row({ space: 8 }) {
          Blank()
          Text('你').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
          Text('我').fontSize(12).fontColor(PMColors.INK_SECONDARY).width(27).height(27).textAlign(TextAlign.Center).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
        }.width('100%')
      }
      if ($$.message.role === 'ASSISTANT') {
        Row({ space: 8 }) {
          Text('忆').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND).width(26).height(26).textAlign(TextAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(8)
          Text('忆程').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          Blank()
          Text($$.message.provider === 'rules' ? '本地整理' : $$.message.provider === 'project_state' ? '项目记录' : '云端分析').fontSize(11).fontColor(PMColors.INK_TERTIARY)
        }.width('100%')
      }
      if (this.hasPresentation($$.message)) {
        AgentMessageBlocks({ presentation: $$.message.presentation!, files: $$.message.fileGuides ?? [], conversationId: this.view.id, messageId: $$.message.id, busy: this.busy,
          onAction: (action: AllowedAction, answer: string): void => { this.uiAction($$.message, action, answer); } })
      } else {
      ConversationAnswer({ content: $$.message.content, files: $$.message.fileGuides ?? [], conversationId: this.view.id, rightAligned: $$.message.role === 'USER' })
      if ($$.message.fileGuides && $$.message.fileGuides.length > 0) { ConversationFileGuides({ files: $$.message.fileGuides, conversationId: this.view.id }) }
      if ($$.message.priorities.length > 0 || $$.message.sources.length > 0) {
        Button(this.expanded === $$.message.id ? '收起依据  ⌃' : '优先级与来源  ⌄', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND)
          .backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => { this.expanded = this.expanded === $$.message.id ? '' : $$.message.id; })
      }
      if (this.expanded === $$.message.id) {
        ForEach($$.message.priorities, (p: PriorityReason) => { Text(p.importance + '；' + p.urgency + '；' + p.blocking + '；' + p.effort + '\n' + p.preference + '\n' + p.tradeoff).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY) }, (p: PriorityReason) => p.projectId)
        ForEach($$.message.sources, (s: ConversationSource) => { Text(s.title + '\n' + s.excerpt).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY) }, (s: ConversationSource) => s.id)
      }
      }
      ForEach($$.message.refs.filter((r: ConversationRef) => ['PROJECT', 'MISSION', 'ACTION'].includes(r.kind)).slice(0, this.expandedRefs === $$.message.id ? $$.message.refs.length : 2), (r: ConversationRef) => {
        if (r.kind === 'PROJECT') {
          Button(r.title + '  ↗', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(Color.Transparent).padding({ left: 0, right: 4 })
            .onClick(() => { this.open(r, $$.message.id); })
        } else {
          Column({ space: 6 }) {
            Text((r.kind === 'MISSION' ? '长期委托' : '行动') + (r.status ? ' · ' + (r.kind === 'MISSION' ? missionStatusLabel(r.status) : r.status === 'DONE' ? '已完成' : r.status === 'DOING' ? '进行中' : r.status === 'TODO' ? '待办' : '状态待核对') : ''))
              .fontSize(11).fontColor(PMColors.INK_TERTIARY)
            Text(r.title).fontSize(14).lineHeight(21).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
            Row({ space: 12 }) {
              Button('打开原任务 ↗', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(Color.Transparent).padding({ left: 0, right: 4 }).onClick(() => { this.open(r, $$.message.id); })
              Blank()
              Button('在此协作 →', { type: ButtonType.Normal }).height(44).fontSize(13).fontWeight(FontWeight.Medium)
                .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 }).enabled(!this.busy)
                .onClick(() => { this.workRef = { kind: r.kind, id: r.id, projectId: r.projectId }; this.messageScroller.scrollEdge(Edge.Bottom); })
            }.width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 14, right: 14, top: 12, bottom: 0 })
            .backgroundColor(PMColors.SURFACE).borderRadius(12).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }
      }, (r: ConversationRef) => r.bindingId ?? r.id)
      if ($$.message.refs.filter((r: ConversationRef) => ['PROJECT', 'MISSION', 'ACTION'].includes(r.kind)).length > 2) {
        Button(this.expandedRefs === $$.message.id ? '收起其他关联任务 ⌃' : '其他关联任务 ⌄', { type: ButtonType.Normal }).height(44)
          .fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
          .onClick(() => { this.expandedRefs = this.expandedRefs === $$.message.id ? '' : $$.message.id; })
      }
      if ($$.message.proposal !== null && !(this.hasPresentation($$.message) && $$.message.presentation!.blocks.some((b: HydratedBlock) => ['approval', 'receipt'].includes(b.semanticType)))) {
        Text($$.message.proposal.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        Text($$.message.proposal.description).fontSize(14).fontColor(PMColors.INK_SECONDARY)
        if ($$.message.proposal.resultId !== null) {
          Text((!$$.message.proposal.tool || $$.message.proposal.tool === 'create_action' ? '已创建行动 · ' : '已提交原操作 · ') + ($$.message.proposal.actionStatus ?? '回执已保存')).fontSize(14).fontColor(PMColors.BRAND)
          PMButton({ label: '查看原结果', secondary: true, onAction: (): void => {
            if ($$.message.proposal!.tool === 'adopt_artifact') router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: $$.message.proposal!.projectId, tab: 'artifacts', conversationId: this.view.id } });
            else if ($$.message.proposal!.tool && !['create_action', 'complete_action'].includes($$.message.proposal!.tool!)) router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: $$.message.proposal!.projectId, missionId: $$.message.proposal!.resultId, conversationId: this.view.id, originMessageId: $$.message.id } });
            else this.workRef = { kind: 'ACTION', projectId: $$.message.proposal!.projectId, id: $$.message.proposal!.resultId! };
          } })
          if ($$.message.proposal.resultCardId) { Text('复盘已保存 · ' + $$.message.proposal.resultCardId).fontSize(12).fontColor(PMColors.BRAND) }
        } else if ($$.message.proposal.status === 'PENDING') {
          PMButton({ label: $$.message.proposal.tool === 'resume_mission' ? '确认接续原委托' : !$$.message.proposal.tool || $$.message.proposal.tool === 'create_action' ? '确认创建行动' : '确认此操作', disabled: this.busy, onAction: (): void => { this.confirm($$.message.proposal!); } })
          PMButton({ label: '不采用', secondary: true, disabled: this.busy, onAction: (): void => { if (this.busy) return; const epoch = this.generation; this.busy = true; this.service.decline(this.view.id, $$.message.proposal!.executionId).then(r => { if (epoch === this.generation) this.view = r.conversation; }).catch((e: Error) => { if (epoch === this.generation) this.fail(e); }).finally(() => { if (epoch === this.generation) this.busy = false; }); } })
        }
      }
      if ($$.message.role === 'ASSISTANT' && !$$.message.restricted) {
        Button('追问这条 ↗', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
          .onClick(() => { this.replyId = $$.message.id; this.text = '为什么这样建议？'; })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: $$.message.role === 'USER' ? 2 : 0, bottom: $$.message.role === 'USER' ? 8 : 0 })
  }
  build() {
    Column() {
      PMAppBar({ title: '与忆程协作', subtitle: this.view.messages.length > 0 ? this.view.title : '', showBack: true, rightActionText: '新讨论', showRightIcon: true, rightIconLabel: '历史讨论', onRightAction: (): void => { if (!this.busy) this.historyOpen = !this.historyOpen; }, onRightTextAction: (): void => { if (!this.busy) this.create(); } })
      if (this.historyOpen) {
        Scroll() {
          Column({ space: 4 }) {
            ForEach(this.sessions, (item: ConversationListItem) => {
              PMButton({ label: item.title, secondary: true, disabled: this.busy, onAction: (): void => { this.selectDiscussion(item.id); } })
            }, (item: ConversationListItem) => item.id)
          }.width('100%').padding(12)
        }.constraintSize({ maxHeight: 220 }).backgroundColor(PMColors.SURFACE)
      }
      Scroll(this.messageScroller) {
        Column({ space: 20 }) {
          if (this.view.id !== '') {
            ForEach([this.view.id], (id: string) => {
              ConversationAnchorPanel({ conversationId: id, revision: this.view.version, busy: $busy, visible: this.pageVisible, suspended: this.workRef !== null,
                onReadResults: (): void => { const epoch = this.generation; setTimeout(() => { if (epoch === this.generation && this.view.id === id) this.messageScroller.scrollEdge(Edge.Bottom); }, 50); },
                onUpdated: (view: ConversationView): void => { if (this.view.id === view.id) this.view = view; } })
            }, (id: string) => id)
          }
          if (this.view.messages.length === 0) {
            Column({ space: 12 }) {
              Text('忆').fontSize(30).fontColor(PMColors.BRAND).width(60).height(60).textAlign(TextAlign.Center)
                .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(20)
              Text('今天，先推进哪件事？').fontSize(20).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
              if (this.view.id === '') { PMButton({ label: '开始讨论', disabled: this.busy, onAction: (): void => { this.create(); } }) }
              else {
                PMButton({ label: '最近哪个项目最值得先处理？', secondary: true, onAction: (): void => { this.text = '最近哪个项目最值得先处理？'; } })
                PMButton({ label: '这周有哪些待回应的事？', secondary: true, onAction: (): void => { this.text = '这周有哪些待回应的事？'; } })
              }
            }.width('100%').padding({ top: 64, bottom: 48 })
          }
          ForEach(this.view.messages, (m: ConversationMessage, index: number) => { this.Message({ message: this.view.messages[index] }) }, (m: ConversationMessage) => m.id)
          if (!this.busy && (this.view.latestTurn?.message || this.error !== '')) {
            Column({ space: 8 }) {
              Row({ space: 8 }) { Text('忆').fontSize(12).fontColor(PMColors.BRAND).width(24).height(24).textAlign(TextAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(8); Text(this.view.latestTurn?.canRetry ? '这次分析未完成' : '讨论状态').fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY) }.width('100%')
              Text(this.view.latestTurn?.message || this.error).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY)
              Row({ space: 16 }) {
                Button('读取状态', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.refresh(); })
                if (this.view.latestTurn?.canRetry) { Button('重新提问', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.pending = null; if (this.text.trim() === '') this.text = this.view.messages.filter((m: ConversationMessage) => m.role === 'USER').slice(-1)[0]?.content ?? ''; this.ask(); }) }
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor(PMColors.SURFACE).borderRadius(14).border({ width: 1, color: PMColors.BORDER_SUBTLE })
          }
          if (this.workRef) { ForEach([this.workRef], (ref: ConversationWorkRef) => { ConversationWorkPanel({ conversation: this.view, workRef: ref, onUpdated: (v: ConversationView): void => { this.view = v; }, onClose: (): void => { this.workRef = null; } }) }, (ref: ConversationWorkRef) => this.view.id + ref.id) }
          if (this.busy) {
            Column({ space: 8 }) {
              Row({ space: 10 }) { LoadingProgress().width(18).height(18).color(PMColors.BRAND); Text(this.progressLabel()).fontSize(14).fontColor(PMColors.INK_SECONDARY) }.width('100%')
              ForEach(this.view.activeTurn?.progress?.steps ?? [], (s: ConversationReadStep) => { Text((s.status === 'SUCCEEDED' ? '✓ ' : '· ') + s.label).fontSize(13).fontColor(PMColors.INK_SECONDARY) })
              if (this.view.activeTurn?.progress) { Button('停止本轮调查', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(this.view.activeTurn.progress.phase !== 'STOPPING').onClick(() => { this.stop(); }) }
            }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 8 })
          }
          if (this.view.id !== '') {
            Row({ space: 16 }) {
              if (this.target !== '') { Button('项目偏好', { type: ButtonType.Normal }).fontSize(12).fontColor(PMColors.INK_TERTIARY).backgroundColor(Color.Transparent).height(40).onClick(() => { this.loadPreference(); }) }
              Button('刷新状态', { type: ButtonType.Normal }).fontSize(12).fontColor(PMColors.INK_TERTIARY).backgroundColor(Color.Transparent).height(40).enabled(!this.busy).onClick(() => { if (!this.busy) this.refresh(); })
            }
          }
          if (this.showPreference) {
            Column({ space: 12 }) {
              Text('重要性与投入').fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
              TextInput({ text: this.importanceText, placeholder: '重要性1–5，未知可留空' }).type(InputType.Number).onChange((v: string) => { this.importanceText = v; })
              TextInput({ text: this.effortText, placeholder: '本次投入分钟，未知可留空' }).type(InputType.Number).onChange((v: string) => { this.effortText = v; })
              TextInput({ text: this.longTermGoal, placeholder: '长期目标' }).onChange((v: string) => { this.longTermGoal = v; })
              PMButton({ label: '保存偏好', onAction: (): void => { this.savePreference(); } })
            }.width('100%').padding(16).backgroundColor(PMColors.SURFACE).borderRadius(16)
          }
        }.padding({ left: 20, right: 20, top: 18, bottom: 24 }).width('100%').alignItems(HorizontalAlign.Start).justifyContent(FlexAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off).align(Alignment.TopStart)
      if (this.view.id !== '') {
        Column() {
        if (this.scopeOpen) {
          Scroll() {
            Column({ space: 4 }) {
              if (this.view.scope !== 'PROJECT') { PMButton({ label: '全部授权项目', secondary: true, onAction: (): void => { this.target = ''; this.scopeOpen = false; this.pending = null; } }) }
              ForEach(this.view.linkedProjects, (p: ConversationProject) => {
                PMButton({ label: p.title, secondary: true, onAction: (): void => { this.target = p.id; this.scopeOpen = false; this.pending = null; } })
              }, (p: ConversationProject) => p.id)
            }.padding(10).width('100%')
          }.width('100%').constraintSize({ maxHeight: 200 }).align(Alignment.TopStart)
        }
        Column({ space: 0 }) {
          if (this.r4Available && this.cloud && this.cloudAvailable) {
            Select([{ value: '快速调查' }, { value: '标准调查' }, { value: '深入调查' }]).selected(this.modeIndex()).value(this.modeLabel()).font({ size: 13 }).fontColor(PMColors.INK_SECONDARY).height(44).width(128).enabled(!this.busy)
              .accessibilityText('调查深度').onSelect((index: number) => { this.investigationMode = ['QUICK', 'STANDARD', 'DEEP'][index]; this.pending = null; })
          }
          TextArea({ text: this.text, placeholder: '聊聊下一步…' }).height(84).fontSize(15).fontColor(PMColors.INK_PRIMARY).backgroundColor(Color.Transparent).padding({ left: 15, right: 15, top: 14, bottom: 4 })
            .enabled(!this.busy).onChange((v: string) => { this.text = v; this.saveComposer(); })
          Row({ space: 8 }) {
            Row({ space: 6 }) {
            Checkbox().width(18).height(18).selectedColor(PMColors.BRAND).select(this.cloud).enabled(this.analysisReady && this.cloudAvailable && !this.busy).onChange((v: boolean) => { this.cloud = v; this.pending = null; })
            Text(this.cloudAvailable ? '云端分析' : '本地整理').fontSize(12).fontColor(PMColors.INK_SECONDARY)
            }.height(44).accessibilityText('云端分析').accessibilityDescription(this.cloudExplanation())
              .gesture(LongPressGesture({ repeat: false, duration: 500 }).onAction(() => { this.showCloudHelp = true; }))
              .onHover((hover: boolean) => { this.showCloudHelp = hover; })
              .bindPopup(this.showCloudHelp, { message: this.cloudExplanation(), placement: Placement.Top, onStateChange: (event: CloudHelpState) => { if (!event.isVisible) this.showCloudHelp = false; } })
            Text('·').fontSize(12).fontColor(PMColors.INK_MUTED)
            Button(this.target === '' ? '跨项目 ⌄' : '当前项目 ⌄', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 4, right: 6 }).enabled(!this.busy)
              .accessibilityText('选择讨论项目范围').onClick(() => { this.scopeOpen = !this.scopeOpen; })
            Blank()
            Button({ type: ButtonType.Circle }) {
              if (this.busy) { LoadingProgress().width(18).height(18).color(Color.White) }
              else {
                Stack() {
                  Row().width(2).height(16).backgroundColor(Color.White).borderRadius(1).translate({ y: 2 })
                  Row().width(11).height(2).backgroundColor(Color.White).borderRadius(1).rotate({ angle: -45 }).translate({ x: -3.5, y: -3.5 })
                  Row().width(11).height(2).backgroundColor(Color.White).borderRadius(1).rotate({ angle: 45 }).translate({ x: 3.5, y: -3.5 })
                }.width(22).height(22)
              }
            }.height(38).width(38).accessibilityText('发送').backgroundColor(PMColors.BRAND)
              .enabled(!this.busy && this.analysisReady && this.text.trim() !== '').onClick(() => { this.ask(); })
          }.width('100%').padding({ left: 12, right: 10, bottom: 8 })
        }.width('100%').backgroundColor(PMColors.SURFACE_SUBTLE).border({ width: 1, color: PMColors.BORDER_SUBTLE }).borderRadius(22).clip(true)
        }.width('100%').padding({ left: 10, right: 10, top: 8, bottom: 10 }).backgroundColor(PMColors.SURFACE)
      }
    }.width('100%').height('100%').backgroundColor(PMColors.SURFACE)
  }
}
