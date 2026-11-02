import { ClaimCorrectionPanel } from "../components/ClaimCorrection";
import { ConversationContinuity } from "../components/ConversationContinuity";
import { ConversationResearchControl, ConversationResearchResult } from '../components/ConversationResearch';
import { supportsAgentPresentation } from '../common/AgentPresentationContract';
import router from '@ohos.router';
import util from '@ohos.util';
import { ApiError } from '../models/Project';
import { ConversationService } from '../services/ConversationService';
import { SessionStore } from '../services/SessionStore';
import { ConversationView, ConversationListItem, ConversationCreateInput, ConversationTurnInput, ConversationConfirmInput,
  ConversationMessage, ConversationRef, ConversationProposal, ConversationEntityInput, ConversationSource, ConversationProject, PriorityReason, FocusPreferenceInput } from '../models/Conversation';
import { missionStatusLabel } from '../common/MissionContract';
import { ConversationPresentation } from '../common/ConversationPresentation';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { PMColors, PMSpacing, PMRadius, PMInteraction } from '../common/DesignTokens';
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
  @State private cloudReason: string = '未确认云模型资格，当前仅整理项目记录';
  @State private analysisReady: boolean = false;
  @State private r4Available: boolean = false;
  @State private investigationMode: string = 'STANDARD';
  @State private showCloudHelp: boolean = false;
  @State private target: string = '';
  @State private expandedRefs: string = '';
  @State private basisExpanded: string = '';
  @State private agentSheetOpen: boolean = false;
  @State private agentSheetMode: string = '';
  @State private scopeOpen: boolean = false;

  @State private correctionMessageId: string = '';
  @State private correctionProjects: ConversationProject[] = [];
  @State private nearBottom: boolean = true;
  @State private workRef: ConversationWorkRef | null = null;
  @State private importanceIndex: number = 0;
  @State private effortText: string = '';
  @State private longTermGoal: string = '';
  @State private notesText: string = '';
  private preferenceVersion: number = 0;
  private originProjectId: string = '';
  private lastSwitchId: string = '';
  private replyId: string = '';
  private entity: ConversationEntityInput | undefined = undefined;
  private generation: number = 0;
  private lastScrollY: number = 0;
  private messageScroller: Scroller = new Scroller();
  private service: ConversationService = new ConversationService();
  private pending: ConversationTurnInput | null = null;
  private confirmationKeys: Map<string, string> = new Map<string, string>();
  private uiKeys: Map<string, ConversationUIActionInput> = new Map<string, ConversationUIActionInput>();
  private progressTimer: number = -1;
  private expired: () => void = (): void => { this.generation++; this.view = new ConversationView(); this.workRef = null; this.text = ''; this.pending = null; this.sessions = []; this.error = '登录已失效，请重新登录'; this.busy = false; this.cloud = false; this.analysisReady = false; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.initialize(); this.progressTimer = setInterval(() => { this.pollProgress(); }, 1500); }
  aboutToDisappear(): void { this.saveComposer(); ConversationDraftStore.flush(); this.generation++; if (this.progressTimer >= 0) { clearInterval(this.progressTimer); } SessionStore.offSessionExpired(this.expired); }
  onPageShow(): void {
    this.pageVisible = true;
    const params = router.getParams() as Record<string, string>;
    const createFlag = params?.['createConversation'] ?? '';
    const switchId = params?.['switchConversationId'] ?? '';
    if (createFlag === '1' && !this.busy) { this.create(false); return; }
    if (switchId !== '' && switchId !== this.lastSwitchId) {
      this.lastSwitchId = switchId;
      if (switchId !== this.view.id && !this.busy) { this.selectDiscussion(switchId); return; }
    }
    if (this.view.id !== '' && !this.busy) { this.refresh(); }
  }
  onPageHide(): void { this.pageVisible = false; this.saveComposer(); ConversationDraftStore.flush(); }
  private openHistory(): void {
    if (this.busy) { return; }
    this.saveComposer(); ConversationDraftStore.flush();
    router.pushUrl({ url: 'pages/ConversationHistory', params: { conversationId: this.view.id, projectId: this.originProjectId } });
  }
  /** 副标题表达讨论上下文，不把历史话题标题当作实时项目状态。 */
  private headerSubtitle(): string {
    if (this.view.id === '') { return ''; }
    const scopeLabel = this.view.scope === 'PROJECT' ? '项目讨论' : '跨项目讨论';
    const title = this.view.title.length > 16 ? this.view.title.slice(0, 16) + '…' : this.view.title;
    return title === '' ? scopeLabel : scopeLabel + ' · ' + title;
  }
  private async initialize(): Promise<void> {
    const epoch = ++this.generation; this.busy = true;
    try {
      await ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id);
      const caps = await this.service.capabilities();
      if (epoch !== this.generation) { return; }
      this.cloudAvailable = caps.cloudAvailable;
      const reason: string = caps.cloud?.reason ?? '';
      this.cloudReason = reason === 'RULE_MODE' ? '当前使用规则整理，不调用云模型' : reason === 'NOT_CONFIGURED' ? '云模型配置未完成，当前仅整理项目记录' : reason === 'ACCOUNT_NOT_ELIGIBLE' ? '当前账号未开通云模型额度' : reason === 'DAILY_QUOTA_EXHAUSTED' ? '今日云模型额度已用完，当前仅整理项目记录' : '当前未确认云模型可用性，仅整理项目记录';
      this.cloud = caps.cloudAvailable; this.analysisReady = true; this.r4Available = caps.r4Available === true;
      if (!caps.enabled) { this.error = '全局协作尚未开启'; return; }
      await this.service.syncWorkspace();
      if (epoch !== this.generation) { return; }
      const params = router.getParams() as Record<string, string>;
      const projectId = params?.['projectId'] ?? '';
      this.originProjectId = projectId;
      const list = await this.service.list(projectId);
      if (epoch !== this.generation) { return; }
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
      if (id !== '') { const loaded = await this.service.read(id); if (epoch !== this.generation) { return; } this.view = loaded; }
      this.target = projectId || this.view.focusProjectId || '';
      if (this.text === '') { this.restoreComposer(); }
      if (params?.['entityId']) {
        const entity = new ConversationEntityInput(); entity.id = params['entityId']; entity.kind = params['entityKind'] ?? 'MISSION'; entity.projectId = projectId; this.entity = entity;
        this.text = '请调查这个原对象的依据和下一步。';
      }
    } catch (e) { if (epoch === this.generation) { this.fail(e); } }
    finally { if (epoch === this.generation) { this.busy = false; } }
  }
  private fail(e: Error): void {
    this.error = e.message || '讨论暂不可用';
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { this.expired(); }
  }
  private async create(project: boolean = false): Promise<void> {
    if (this.busy) { return; }
    const epoch = ++this.generation; this.busy = true; this.error = '';
    try {
      const input = new ConversationCreateInput(); input.requestId = util.generateRandomUUID();
      if ((project && this.target !== '') || this.originProjectId !== '') { input.scope = 'PROJECT'; input.projectId = this.target || this.originProjectId; }
      const c = await this.service.create(input);
      const view = await this.service.read(c.id);
      if (epoch !== this.generation) { return; }
      this.view = view; this.text = ''; this.pending = null; this.replyId = ''; this.workRef = null;
      const sessions = (await this.service.list()).conversations;
      if (epoch === this.generation) { this.sessions = sessions; }
    } catch (e) { if (epoch === this.generation) { this.fail(e); } }
    finally { if (epoch === this.generation) { this.busy = false; } }
  }
  private async refresh(): Promise<void> {
    const epoch = this.generation, owned = !this.busy; if (owned) { this.busy = true; }
    try { const v = await this.service.read(this.view.id); if (epoch === this.generation) { this.view = v; if (v.latestTurn?.canRetry) { this.pending = null; this.error = ''; } } }
    catch (e) { if (epoch === this.generation) { this.fail(e); } }
    finally { if (owned && epoch === this.generation) { this.busy = false; } }
  }
  private async selectDiscussion(id: string): Promise<void> {
    if (this.busy) { return; }
    this.saveComposer();
    const epoch = ++this.generation; this.busy = true; this.pending = null; this.replyId = ''; this.workRef = null; this.error = ''; this.nearBottom = true; this.lastScrollY = 0;
    try { const view = await this.service.read(id); if (epoch === this.generation) { this.view = view; this.target = view.focusProjectId ?? ''; this.restoreComposer(); } }
    catch (e) { if (epoch === this.generation) { this.fail(e); } }
    finally { if (epoch === this.generation) { this.busy = false; } }
  }
  private async ask(): Promise<void> {
    if (this.busy || !this.analysisReady || this.text.trim() === '' || this.view.id === '') { return; }
    const epoch = this.generation; this.busy = true; this.error = '';
    if (this.pending === null || this.pending.message !== this.text.trim()) {
      const input = new ConversationTurnInput(); input.requestId = util.generateRandomUUID(); input.expectedVersion = this.view.version; input.expectedContinuitySeq = this.view.continuity?.seq;
      input.message = this.text.trim(); input.llmContextApproved = this.cloud && this.cloudAvailable;
      if (this.r4Available) { input.investigationMode = this.investigationMode; }
      input.projectId = this.target === '' ? null : this.target;
      if (this.replyId !== '') { input.replyToMessageId = this.replyId; }
      if (this.entity !== undefined && this.entity.projectId === this.target) { input.entityRef = this.entity; }
      this.pending = input;
    }
    try {
      const reply = await this.service.ask(this.view.id, this.pending!);
      if (epoch !== this.generation) { return; }
      this.view = reply.conversation; this.target = this.view.focusProjectId ?? '';
      this.sessions = this.sessions.map((item: ConversationListItem): ConversationListItem => item.id === this.view.id ? { id: item.id, title: this.view.title, scope: item.scope, homeProjectId: item.homeProjectId, updatedAt: item.updatedAt } : item);
      this.nearBottom = true; setTimeout(() => { if (epoch === this.generation) { this.messageScroller.scrollEdge(Edge.Bottom); } }, 50);
      if (reply.status === 'ANSWERED' || reply.status === 'NEEDS_CLARIFICATION' || reply.status === 'CANCELLED') { this.text = ''; this.saveComposer(); this.pending = null; this.replyId = ''; }
      else { this.error = ''; if (['FAILED', 'UNKNOWN'].includes(reply.status)) { this.pending = null; } }
    } catch (e) { if (epoch === this.generation) { this.fail(e); await this.refresh(); } }
    finally { if (epoch === this.generation) { this.busy = this.view.activeTurn !== null; } }
  }
  private async confirm(p: ConversationProposal): Promise<void> {
    if (this.busy) { return; }
    const epoch = this.generation; this.busy = true;
    const input = new ConversationConfirmInput(); input.requestId = this.confirmationKeys.get(p.executionId) ?? util.generateRandomUUID();
    this.confirmationKeys.set(p.executionId, input.requestId); input.proposalHash = p.proposalHash;
    try { const r = await this.service.confirm(this.view.id, p.executionId, input); if (epoch === this.generation) { this.view = r.conversation; this.nearBottom = true; setTimeout(() => { if (epoch === this.generation) { this.messageScroller.scrollEdge(Edge.Bottom); } }, 50); } }
    catch (e) { if (epoch === this.generation) { this.fail(e); } }
    finally { if (epoch === this.generation) { this.busy = false; } }
  }
  private open(ref: ConversationRef, messageId: string): void {
    if (ref.kind === 'MISSION') { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: ref.projectId, missionId: ref.id, conversationId: this.view.id, originMessageId: messageId } }); }
    else { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: ref.projectId, tab: ref.kind === 'ACTION' ? 'actions' : 'memory', actionId: ref.kind === 'ACTION' ? ref.id : '', conversationId: this.view.id, originMessageId: messageId } }); }
  }
  private async loadPreference(): Promise<void> {
    if (this.target === '') { return; }
    const epoch = this.generation, target = this.target;
    try { const p = (await this.service.preference(target)).preference;
      if (epoch !== this.generation || target !== this.target) { return; }
      this.preferenceVersion = p?.version ?? 0;
      this.importanceIndex = p?.importance ? p.importance : 0;
      this.effortText = p?.estimatedMinutes?.toString() ?? ''; this.longTermGoal = p?.longTermGoal ?? ''; this.notesText = p?.notes ?? '';
      this.agentSheetMode = 'preference'; this.agentSheetOpen = true;
    } catch (e) { this.fail(e); }
  }
  private async savePreference(): Promise<void> {
    const input = new FocusPreferenceInput(); input.expectedVersion = this.preferenceVersion;
    input.importance = this.importanceIndex === 0 ? null : this.importanceIndex;
    input.estimatedMinutes = this.effortText === '' ? null : Number(this.effortText); input.longTermGoal = this.longTermGoal; input.notes = this.notesText;
    try { const p = (await this.service.savePreference(this.target, input)).preference; this.preferenceVersion = p?.version ?? 0; this.agentSheetOpen = false; }
    catch (e) { this.fail(e); }
  }
  private importanceOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    options.push({ value: '未明确' });
    options.push({ value: '1 / 5' });
    options.push({ value: '2 / 5' });
    options.push({ value: '3 / 5' });
    options.push({ value: '4 / 5' });
    options.push({ value: '5 / 5' });
    return options;
  }
  private toolMenuItems(): MenuElement[] {
    const items: MenuElement[] = [];
    items.push({ value: '刷新讨论状态', action: (): void => { if (!this.busy) { this.refresh(); } } });
    if (this.target !== '') { items.push({ value: '项目偏好', action: (): void => { this.loadPreference(); } }); }
    return items;
  }
  private correctionProjectId(): string {
    if (this.view.homeProjectId !== null && this.view.homeProjectId !== '') { return this.view.homeProjectId; }
    return this.correctionProjects.length > 0 ? this.correctionProjects[0].id : '';
  }
  @Builder
  private CorrectionSheet() {
    ClaimCorrectionPanel({ projectId: this.correctionProjectId(), sourceId: this.correctionMessageId,
      projects: this.correctionProjects, onClose: (): void => { this.agentSheetOpen = false; },
      onChanged: (): void => { this.refresh(); } })
  }
  private trackScroll(yOffset: number): void {
    if (yOffset < this.lastScrollY - 2) { this.nearBottom = false; }
    this.lastScrollY = yOffset;
  }
  private starterQuestions(): string[] {
    if (this.target !== '') {
      return ['这个项目当前最需要处理什么？', '最近哪些变化需要我确认？'];
    }
    return ['最近哪个项目最值得先处理？', '这周有哪些待回应的事？'];
  }
  private cloudExplanation(): string {
    return !this.analysisReady ? '正在确认分析方式…' : !this.cloudAvailable ? this.cloudReason : this.cloud ? '发送即允许云模型分析本次授权项目资料，可关闭；连通性以实际调用为准' : '仅整理项目记录，不调用云模型';
  }
  private hasPresentation(message: ConversationMessage): boolean { return supportsAgentPresentation(message.presentation); }
  private saveComposer(): void { if (this.view.id === '') { return; } const draft = new ConversationDraft(); draft.answer = this.text; ConversationDraftStore.save(this.view.id + ':composer', draft); }
  private restoreComposer(): void { this.text = ConversationDraftStore.read(this.view.id + ':composer').answer; }
  private modeIndex(): number { return this.investigationMode === 'QUICK' ? 0 : this.investigationMode === 'DEEP' ? 2 : 1; }
  private modeLabel(): string { return ['快速调查', '标准调查', '深入调查'][this.modeIndex()]; }
  private progressLabel(): string {
    const labels: Record<string, string> = { 'ROUTING': '正在定位相关项目', 'READING_SOURCE': '正在读取原资料', 'EVALUATING': '正在判断目标差距', 'WAITING_MODEL': '正在整理结论', 'STOPPING': '正在停止后续调查', 'READY': '正在保存回答', 'WAITING_USER': '正在整理需要你补充的条件' };
    return labels[this.view.activeTurn?.progress?.phase ?? ''] ?? '正在核对项目资料…';
  }
  private async pollProgress(): Promise<void> {
    const boundary = this.view.continuity?.nextBoundary;
    const due = boundary !== null && boundary !== undefined && Date.parse(boundary) <= Date.now();
    if ((!this.busy && this.view.activeTurn === null && !due) || !this.pageVisible || this.view.id === '') { return; }
    const epoch = this.generation, id = this.view.id;
    try { const view = await this.service.read(id); if (epoch === this.generation && this.view.id === id && view.version >= this.view.version) {
      this.view = view; this.busy = view.activeTurn !== null;
      if (!this.busy && this.pending && (view.latestTurn?.status === 'ANSWERED' || view.latestTurn?.status === 'NEEDS_CLARIFICATION' || view.latestTurn?.status === 'CANCELLED')) { if (this.text.trim() === this.pending.message) { this.text = ''; this.saveComposer(); } this.pending = null; this.replyId = ''; }
    } } catch { /* Original request handles errors. */ }
  }
  private async stop(): Promise<void> {
    if (!this.view.activeTurn) { return; }
    const epoch = this.generation;
    try { const result = await this.service.stop(this.view.id, this.view.activeTurn.id); if (epoch === this.generation) { this.view = result.conversation; } }
    catch (e) { if (epoch === this.generation) { this.fail(e); } }
  }
  private async uiAction(message: ConversationMessage, action: AllowedAction, answer: string): Promise<void> {
    if (this.busy || !action.enabled) { return; }
    const epoch = this.generation; this.busy = true; this.error = '';
    let input = this.uiKeys.get(action.bindingId);
    if (!input) { input = new ConversationUIActionInput(); input.messageId = message.id; input.bindingId = action.bindingId; input.requestId = util.generateRandomUUID(); input.expectedConversationVersion = this.view.version; this.uiKeys.set(action.bindingId, input); }
    try {
      const result = await this.service.uiAction(this.view.id, input);
      if (epoch !== this.generation) { return; }
      this.view = result.conversation;
      if (action.actionKind === 'PREVIEW') { this.messageScroller.scrollEdge(Edge.Bottom); }
      if (action.actionKind === 'ASK') {
        this.uiKeys.delete(action.bindingId); this.target = action.target.projectId; this.replyId = message.id; this.pending = null;
        this.text = answer || '请调查这条变化的依据，判断对原目标有什么影响，并给出待确认的下一步。'; this.saveComposer();
        if (answer.trim() !== '') { this.busy = false; await this.ask(); if (this.text === '') { ConversationDraftStore.save(this.view.id + ':' + action.target.id, new ConversationDraft()); } }
      } else if (action.actionKind === 'OPEN' && result.href && action.target.kind === 'ACTION') {
        this.workRef = { kind: 'ACTION', id: action.target.id, projectId: action.target.projectId };
        this.messageScroller.scrollEdge(Edge.Bottom);
      }
    } catch (e) {
      if (epoch === this.generation) { if (e instanceof ApiError && [401, 403, 404, 409, 422].includes(e.status)) { this.uiKeys.delete(action.bindingId); } this.fail(e); await this.refresh(); }
    } finally { if (epoch === this.generation) { this.busy = false; } }
  }
  private observedProjects(message: ConversationMessage): ConversationProject[] {
    if (this.view.homeProjectId !== null && this.view.homeProjectId !== '') { return []; }
    return this.view.linkedProjects.filter((p: ConversationProject): boolean => (message.observedProjectIds ?? []).includes(p.id));
  }
  private correctionTarget(message: ConversationMessage): string {
    if (this.view.homeProjectId !== null && this.view.homeProjectId !== '') { return this.view.homeProjectId; }
    const observed = this.observedProjects(message);
    return observed.length > 0 ? observed[0].id : '';
  }
  private projectTitle(projectId: string): string {
    const found = this.view.linkedProjects.find((p: ConversationProject): boolean => p.id === projectId);
    return found ? found.title : '项目';
  }
  private taskRefs(message: ConversationMessage): ConversationRef[] {
    return message.refs.filter((r: ConversationRef): boolean => r.kind === 'MISSION' || r.kind === 'ACTION');
  }
  private shownTasks(message: ConversationMessage): ConversationRef[] {
    const all = this.taskRefs(message);
    return this.expandedRefs === message.id ? all : all.slice(0, 2);
  }
  private refStatusLabel(r: ConversationRef): string {
    if (r.kind === 'MISSION') { return missionStatusLabel(r.status ?? ''); }
    return r.status === 'DONE' ? '已完成' : r.status === 'DOING' ? '进行中' : r.status === 'TODO' ? '待办' : '状态待核对';
  }
  @Builder
  private PriorityBasis($$: AgentMessageInput) {
    Column({ space: 6 }) {
      ForEach($$.message.priorities, (p: PriorityReason) => {
        ForEach(ConversationPresentation.headlines(p), (line: string, index: number) => {
          Text(($$.message.priorities.length > 1 && index === 0 ? this.projectTitle(p.projectId) + ' · ' : '') + line)
            .fontSize(13).lineHeight(20).fontColor(PMColors.INK_TERTIARY).width('100%')
        }, (line: string, index: number) => index.toString() + line)
      }, (p: PriorityReason) => p.projectId)
      ForEach($$.message.priorities, (p: PriorityReason) => {
        Column({ space: 4 }) {
          Text(ConversationPresentation.basisLabel(p)).fontSize(12).fontColor(PMColors.INK_TERTIARY)
          ForEach(ConversationPresentation.detail(p), (line: string) => {
            Text(line).fontSize(13).lineHeight(20).fontColor(PMColors.INK_SECONDARY).width('100%')
          }, (line: string) => line)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }, (p: PriorityReason) => p.projectId)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  private RelatedTasks($$: AgentMessageInput) {
    Column({ space: 2 }) {
      ForEach($$.message.refs.filter((r: ConversationRef): boolean => r.kind === 'PROJECT'), (r: ConversationRef) => {
        Row() {
          Button(r.title + '  ↗', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13).fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(Color.Transparent).padding({ left: 0, right: 4 })
            .onClick(() => { this.open(r, $$.message.id); })
        }.width('100%')
      }, (r: ConversationRef) => r.bindingId ?? r.id)
      if (this.taskRefs($$.message).length > 0) {
        ForEach(this.shownTasks($$.message), (r: ConversationRef) => {
          Column({ space: 2 }) {
            Text((r.kind === 'MISSION' ? '关联委托' : '关联行动') + (r.status ? '（' + this.refStatusLabel(r) + '）：' : '：') + r.title)
              .fontSize(13).lineHeight(20).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
            Row({ space: 10 }) {
              Button('查看' + (r.kind === 'MISSION' ? '委托' : '行动') + ' ↗', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(12).fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(Color.Transparent).padding({ left: 0, right: 4 }).onClick(() => { this.open(r, $$.message.id); })
              Blank()
              Button('在此继续', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13).fontWeight(FontWeight.Medium)
                .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 }).enabled(!this.busy)
                .onClick(() => { this.workRef = { kind: r.kind, id: r.id, projectId: r.projectId }; this.messageScroller.scrollEdge(Edge.Bottom); })
              if (r.kind === 'MISSION' && r.status === 'PAUSED') {
                Button('预览接续', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(12).fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(Color.Transparent).padding({ left: 4, right: 0 }).enabled(!this.busy)
                  .onClick(() => {
                    if (this.busy) { return; }
                    const epoch = this.generation; this.busy = true;
                    this.service.previewResume(this.view.id, r.id).then((res) => { if (epoch === this.generation) { this.view = res.conversation; } })
                      .catch((e: Error) => { if (epoch === this.generation) { this.fail(e); } })
                      .finally(() => { if (epoch === this.generation) { this.busy = false; } });
                  })
              }
            }.width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 4, right: 4, top: 4, bottom: 4 })
        }, (r: ConversationRef) => r.bindingId ?? r.id)
        if (this.taskRefs($$.message).length > 2) {
          Button(this.expandedRefs === $$.message.id ? '收起关联任务 ⌃' : '查看全部关联任务（' + this.taskRefs($$.message).length + '）⌄', { type: ButtonType.Normal })
            .constraintSize({ minHeight: 40 }).fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
            .onClick(() => { this.expandedRefs = this.expandedRefs === $$.message.id ? '' : $$.message.id; })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  private MessageTools($$: AgentMessageInput) {
    Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center }) {
      ConversationFileGuides({ files: $$.message.fileGuides ?? [], sources: $$.message.sources, conversationId: this.view.id })
      if ($$.message.role === 'ASSISTANT' && !$$.message.restricted && $$.message.priorities.length > 0) {
        Button('判断依据', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).borderRadius(8).padding({ left: 8, right: 8 })
          .accessibilityText('判断依据').onClick(() => { this.basisExpanded = this.basisExpanded === $$.message.id ? '' : $$.message.id; })
      }
      if ($$.message.role === 'ASSISTANT' && !$$.message.restricted && this.correctionTarget($$.message) !== '') {
        Button('纠正', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).borderRadius(8).padding({ left: 8, right: 8 })
          .accessibilityText('纠正这条回答的理解').onClick(() => {
            this.correctionMessageId = $$.message.id;
            this.correctionProjects = this.observedProjects($$.message);
            this.agentSheetMode = 'correction'; this.agentSheetOpen = true;
          })
      }
      if ($$.message.role === 'ASSISTANT' && !$$.message.restricted) {
        Button('追问', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).borderRadius(8).padding({ left: 8, right: 8 })
          .onClick(() => { this.replyId = $$.message.id; this.text = '为什么这样建议？'; this.saveComposer(); })
      }
    }.width('100%')
  }
  @Builder
  private Message($$: AgentMessageInput) {
    Column({ space: 10 }) {
      if ($$.message.role === 'ASSISTANT') {
        Row({ space: 8 }) {
          Text('忆').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND).width(26).height(26).textAlign(TextAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(8)
          Text('忆程').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          Blank()
          Text($$.message.provider === 'rules' ? '本地整理' : $$.message.provider === 'project_state' ? '项目记录' : '云端分析').fontSize(11).fontColor(PMColors.INK_TERTIARY)
        }.width('100%')
      }
      if (this.hasPresentation($$.message)) {
        AgentMessageBlocks({ presentation: $$.message.presentation!, conversationId: this.view.id, messageId: $$.message.id, busy: this.busy,
          onAction: (action: AllowedAction, answer: string): void => { this.uiAction($$.message, action, answer); } })
      } else {
        if ($$.message.role === 'USER') {
          Row() {
            Blank()
            Column({ space: 8 }) {
              ConversationAnswer({ content: $$.message.content, files: $$.message.fileGuides ?? [], conversationId: this.view.id, rightAligned: true })
            }.constraintSize({ maxWidth: '85%' }).alignItems(HorizontalAlign.End)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius({ topLeft: PMRadius.BUBBLE, topRight: PMRadius.BUBBLE, bottomLeft: PMRadius.BUBBLE, bottomRight: PMRadius.BUBBLE_TAIL })
              .border({ width: 1, color: PMColors.BORDER_SUBTLE })
              .padding({ left: 16, right: 16, top: 12, bottom: 12 })
          }.width('100%')
        } else {
          ConversationAnswer({ content: $$.message.content, files: $$.message.fileGuides ?? [], conversationId: this.view.id, rightAligned: false })
        }
      }
      if ($$.message.proposal !== null && !(this.hasPresentation($$.message) && $$.message.presentation!.blocks.some((b: HydratedBlock) => ['approval', 'receipt'].includes(b.semanticType)))) {
        Text($$.message.proposal.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        Text($$.message.proposal.description).fontSize(14).fontColor(PMColors.INK_SECONDARY)
        if ($$.message.proposal.resultId !== null) {
          Text((!$$.message.proposal.tool || $$.message.proposal.tool === 'create_action' ? '已创建行动 · ' : '已提交原操作 · ') + ($$.message.proposal.actionStatus ?? '回执已保存')).fontSize(14).fontColor(PMColors.BRAND)
          PMButton({ label: '查看原结果', secondary: true, onAction: (): void => {
            if ($$.message.proposal!.tool === 'adopt_artifact') { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: $$.message.proposal!.projectId, tab: 'artifacts', conversationId: this.view.id } }); }
            else if ($$.message.proposal!.tool && !['create_action', 'complete_action'].includes($$.message.proposal!.tool!)) { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: $$.message.proposal!.projectId, missionId: $$.message.proposal!.resultId, conversationId: this.view.id, originMessageId: $$.message.id } }); }
            else { this.workRef = { kind: 'ACTION', projectId: $$.message.proposal!.projectId, id: $$.message.proposal!.resultId! }; }
          } })
          if ($$.message.proposal.resultCardId) { Text('复盘已保存 · ' + $$.message.proposal.resultCardId).fontSize(12).fontColor(PMColors.BRAND) }
        } else if ($$.message.proposal.status === 'PENDING') {
          PMButton({ label: $$.message.proposal.tool === 'resume_mission' ? '确认接续原委托' : !$$.message.proposal.tool || $$.message.proposal.tool === 'create_action' ? '确认创建行动' : '确认此操作', disabled: this.busy, onAction: (): void => { this.confirm($$.message.proposal!); } })
          PMButton({ label: '不采用', secondary: true, disabled: this.busy, onAction: (): void => { if (this.busy) { return; } const epoch = this.generation; this.busy = true; this.service.decline(this.view.id, $$.message.proposal!.executionId).then(r => { if (epoch === this.generation) { this.view = r.conversation; } }).catch((e: Error) => { if (epoch === this.generation) { this.fail(e); } }).finally(() => { if (epoch === this.generation) { this.busy = false; } }); } })
        }
      }
      this.MessageTools({ message: $$.message })
      if (!$$.message.restricted && this.basisExpanded === $$.message.id) {
        this.PriorityBasis({ message: $$.message })
      }
      this.RelatedTasks({ message: $$.message })
      if ($$.message.role === 'ASSISTANT' && !$$.message.restricted && ($$.message.researchCoverage || $$.message.sources.some((source: ConversationSource) => source.external !== undefined))) {
        ConversationResearchResult({ message: $$.message, conversationId: this.view.id, version: this.view.version, disabled: this.busy, onContinue: (value: string): void => { this.replyId = $$.message.id; this.text = value; this.saveComposer(); } })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: $$.message.role === 'USER' ? 2 : 0, bottom: $$.message.role === 'USER' ? 8 : 12 })
  }
  @Builder
  private AgentSheet() {
    if (this.agentSheetMode === 'preference') { this.PreferenceSheet() }
    else if (this.agentSheetMode === 'correction') { this.CorrectionSheet() }
  }
  @Builder
  private PreferenceSheet() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text('项目偏好').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Button('完成', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).padding({ left: 14, right: 14 })
          .onClick(() => { this.agentSheetOpen = false; })
      }.width('100%')
      Scroll() {
        Column({ space: 14 }) {
          Column({ space: 6 }) {
            Text('重要性').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
            Select(this.importanceOptions()).selected(this.importanceIndex).value(this.importanceIndex === 0 ? '未明确' : this.importanceIndex + ' / 5')
              .font({ size: 14 }).fontColor(PMColors.INK_PRIMARY).height(44).width('100%')
              .accessibilityText('项目重要性，1 到 5，未明确可不选')
              .onSelect((index: number) => { this.importanceIndex = index; })
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 6 }) {
            Text('本次投入').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
            Row({ space: 8 }) {
              TextInput({ text: this.effortText, placeholder: '未知可留空' }).type(InputType.Number).layoutWeight(1).height(44)
                .accessibilityText('本次投入分钟数').onChange((v: string) => { this.effortText = v; })
              Text('分钟').fontSize(13).fontColor(PMColors.INK_TERTIARY)
            }.width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 6 }) {
            Text('长期目标').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
            TextArea({ text: this.longTermGoal, placeholder: '这个项目对你的长期意义' }).height(84).fontSize(14)
              .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).accessibilityText('长期目标')
              .onChange((v: string) => { this.longTermGoal = v; })
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 6 }) {
            Text('其他偏好').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
            TextInput({ text: this.notesText, placeholder: '排序、方式等偏好' }).height(44).accessibilityText('其他偏好')
              .onChange((v: string) => { this.notesText = v; })
          }.width('100%').alignItems(HorizontalAlign.Start)
          PMButton({ label: '保存偏好', disabled: this.busy, onAction: (): void => { this.savePreference(); } })
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 12 })
      }.width('100%').constraintSize({ maxHeight: 480 }).scrollBar(BarState.Auto).align(Alignment.Top)
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 18, right: 18, top: 14, bottom: 10 })
  }
  build() {
    Column() {
      PMAppBar({ title: '与忆程协作', subtitle: this.headerSubtitle(), showBack: true, rightActionText: this.view.messages.length > 0 ? '新讨论' : '', showRightIcon: true, rightIconLabel: '历史讨论', onRightAction: (): void => { this.openHistory(); }, onRightTextAction: (): void => { if (!this.busy) { this.create(); } } })
      Scroll(this.messageScroller) {
        Column({ space: 20 }) {
          if (this.view.id !== '') {
            ForEach([this.view.id], (id: string) => {
              ConversationAnchorPanel({ conversationId: id, revision: this.view.version, busy: $busy, visible: this.pageVisible, suspended: this.workRef !== null,
                onReadResults: (): void => { if (!this.nearBottom) { return; } const epoch = this.generation; setTimeout(() => { if (epoch === this.generation && this.view.id === id) { this.messageScroller.scrollEdge(Edge.Bottom); } }, 50); },
                onUpdated: (view: ConversationView): void => { if (this.view.id === view.id) { this.view = view; } } })
            }, (id: string) => id)
          }
          if (this.view.continuity) {
            ConversationContinuity({ conversationId: this.view.id, projectId: this.target || this.view.homeProjectId || this.view.focusProjectId || '', info: this.view.continuity!,
              onSaved: (): void => { this.service.read(this.view.id).then((v: ConversationView) => { this.view = v; }).catch((e: Error) => { this.fail(e); }); },
              onWork: (ref: ConversationWorkRef): void => { this.workRef = ref; } })
          }
          if (this.view.messages.length === 0) {
            Column({ space: 12 }) {
              Text('忆').fontSize(20).fontColor(PMColors.BRAND).width(40).height(40).textAlign(TextAlign.Center)
                .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(13)
              Text('有什么需要一起推进？').fontSize(18).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
              if (this.view.id === '') { PMButton({ label: '开始讨论', disabled: this.busy, onAction: (): void => { this.create(); } }) }
              else {
                // 快捷问题与当前对话范围一致：项目内问项目，跨项目才问全局
                ForEach(this.starterQuestions(), (q: string) => {
                  Row({ space: 8 }) {
                    Text(q).fontSize(14).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text('↗').fontSize(13).fontColor(PMColors.INK_TERTIARY)
                  }.width('100%').constraintSize({ minHeight: 44 }).padding({ left: 12, right: 10 })
                    .backgroundColor(PMColors.SURFACE).borderRadius(11)
                    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
                    .clickEffect(PMInteraction.PRESS_EFFECT)
                    .accessibilityText(q + '，填入输入框')
                    .onClick(() => { this.text = q; this.saveComposer(); })
                }, (q: string) => q)
              }
            }.width('100%').padding({ top: 96, bottom: 56 })
          }
          ForEach(this.view.messages, (m: ConversationMessage, index: number) => { this.Message({ message: this.view.messages[index] }) }, (m: ConversationMessage) => m.id)
          if (!this.busy && (this.view.latestTurn?.message || this.error !== '')) {
            Column({ space: 8 }) {
              Row({ space: 8 }) { Text('忆').fontSize(12).fontColor(PMColors.BRAND).width(24).height(24).textAlign(TextAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(8); Text(this.view.latestTurn?.canRetry ? '这次分析未完成' : '讨论状态').fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY) }.width('100%')
              Text(this.view.latestTurn?.message || this.error).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY)
              Row({ space: 16 }) {
                Button('读取状态', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.refresh(); })
                if (this.view.latestTurn?.canRetry) { Button('重新提问', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.pending = null; if (this.text.trim() === '') { this.text = this.view.messages.filter((m: ConversationMessage) => m.role === 'USER').slice(-1)[0]?.content ?? ''; } this.ask(); }) }
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor(PMColors.SURFACE).borderRadius(14).border({ width: 1, color: PMColors.BORDER_SUBTLE })
          }
          if (this.workRef) { ForEach([this.workRef], (ref: ConversationWorkRef) => { ConversationWorkPanel({ conversation: this.view, workRef: ref, onUpdated: (v: ConversationView): void => { this.view = v; }, onClose: (): void => { this.workRef = null; } }) }, (ref: ConversationWorkRef) => this.view.id + ref.id) }
          if (this.busy) {
            Column({ space: 8 }) {
              Row({ space: 10 }) { LoadingProgress().width(18).height(18).color(PMColors.BRAND); Text(this.progressLabel()).fontSize(14).fontColor(PMColors.INK_SECONDARY) }.width('100%')
              ForEach(this.view.activeTurn?.progress?.steps ?? [], (s: ConversationReadStep) => { Text((s.status === 'SUCCEEDED' ? '✓ ' : '· ') + s.label).fontSize(13).fontColor(PMColors.INK_SECONDARY) })
              if (this.view.activeTurn?.progress) { Button('停止本轮调查', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(this.view.activeTurn.progress.phase !== 'STOPPING').onClick(() => { this.stop(); }) }
            }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 8 })
          }
        }.padding({ left: 20, right: 20, top: 18, bottom: 24 }).width('100%').alignItems(HorizontalAlign.Start).justifyContent(FlexAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off).align(Alignment.TopStart)
        .onScroll((xOffset: number, yOffset: number) => { this.trackScroll(yOffset); })
        .onReachEnd(() => { this.nearBottom = true; })
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
            if (this.view.research?.available && this.cloud) {
              ConversationResearchControl({ conversationId: this.view.id, projectId: this.target || this.view.homeProjectId || '', info: this.view.research!, disabled: this.busy, onSaved: (): void => { this.service.read(this.view.id).then(v => { this.view = v; }).catch((e: Error) => { this.fail(e); }); } })
            }
            TextArea({ text: this.text, placeholder: '聊聊下一步…' }).constraintSize({ minHeight: 76, maxHeight: 136 }).fontSize(15).fontColor(PMColors.INK_PRIMARY).backgroundColor(Color.Transparent).padding({ left: 15, right: 15, top: 14, bottom: 4 })
              .enabled(!this.busy).onChange((v: string) => { this.text = v; this.saveComposer(); })
            Row({ space: 8 }) {
              Row({ space: 6 }) {
                Checkbox().width(18).height(18).selectedColor(PMColors.BRAND).select(this.cloud).enabled(this.analysisReady && this.cloudAvailable && !this.busy).onChange((v: boolean) => { this.cloud = v; this.pending = null; })
                Text(this.cloudAvailable ? '云端分析' : '本地整理').fontSize(12).fontColor(PMColors.INK_SECONDARY)
              }.height(44).accessibilityText('云端分析').accessibilityDescription(this.cloudExplanation())
                .gesture(LongPressGesture({ repeat: false, duration: 500 }).onAction(() => { this.showCloudHelp = true; }))
                .onHover((hover: boolean) => { this.showCloudHelp = hover; })
                .bindPopup(this.showCloudHelp, { message: this.cloudExplanation(), placement: Placement.Top, onStateChange: (event: CloudHelpState) => { if (!event.isVisible) { this.showCloudHelp = false; } } })
              Button(this.target === '' ? '跨项目 ⌄' : '当前项目 ⌄', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 4, right: 6 }).enabled(!this.busy)
                .accessibilityText('选择讨论项目范围').onClick(() => { this.scopeOpen = !this.scopeOpen; })
              Blank()
              Button('更多', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 6, right: 6 })
                .accessibilityText('更多操作：刷新讨论状态、项目偏好').bindMenu(this.toolMenuItems())
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
        .bindSheet($$this.agentSheetOpen, this.AgentSheet(), {
          height: SheetSize.FIT_CONTENT,
          dragBar: true,
          showClose: false
        })
      }
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
