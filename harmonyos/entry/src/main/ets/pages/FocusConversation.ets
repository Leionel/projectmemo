import router from '@ohos.router';
import util from '@ohos.util';
import { ApiError } from '../models/Project';
import { ConversationService } from '../services/ConversationService';
import { SessionStore } from '../services/SessionStore';
import { ConversationView, ConversationListItem, ConversationCreateInput, ConversationTurnInput, ConversationConfirmInput,
  ConversationMessage, ConversationRef, ConversationProposal, ConversationEntityInput, ConversationSource, ConversationProject, PriorityReason, FocusPreferenceInput } from '../models/Conversation';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
import { ConversationWorkRef } from '../models/ConversationWork';
import { ConversationWorkPanel } from '../components/ConversationWorkPanel';
import { ConversationAnchorPanel } from '../components/ConversationAnchorPanel';

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
  @State private target: string = '';
  @State private expanded: string = '';
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
  private expired: () => void = (): void => { this.generation++; this.view = new ConversationView(); this.workRef = null; this.text = ''; this.pending = null; this.sessions = []; this.error = '登录已失效，请重新登录'; this.busy = false; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.initialize(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  onPageShow(): void { this.pageVisible = true; if (this.view.id !== '' && !this.busy) this.refresh(); }
  onPageHide(): void { this.pageVisible = false; }
  private async initialize(): Promise<void> {
    const epoch = ++this.generation; this.busy = true;
    try {
      const caps = await this.service.capabilities();
      if (epoch !== this.generation) return;
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
      } else if (id === '') id = list.conversations[0]?.id ?? '';
      if (id !== '') { const loaded = await this.service.read(id); if (epoch !== this.generation) return; this.view = loaded; }
      this.target = projectId || this.view.focusProjectId || '';
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
      this.view = view; this.pending = null; this.replyId = ''; this.workRef = null;
      const sessions = (await this.service.list()).conversations;
      if (epoch === this.generation) this.sessions = sessions;
    } catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async refresh(): Promise<void> {
    const epoch = this.generation, owned = !this.busy; if (owned) this.busy = true;
    try { const v = await this.service.read(this.view.id); if (epoch === this.generation) this.view = v; }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (owned && epoch === this.generation) this.busy = false; }
  }
  private async selectDiscussion(id: string): Promise<void> {
    if (this.busy) return;
    const epoch = ++this.generation; this.busy = true; this.pending = null; this.replyId = ''; this.workRef = null; this.historyOpen = false;
    try { const view = await this.service.read(id); if (epoch === this.generation) { this.view = view; this.target = view.focusProjectId ?? ''; } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async ask(): Promise<void> {
    if (this.busy || this.text.trim() === '' || this.view.id === '') return;
    const epoch = this.generation; this.busy = true; this.error = '';
    if (this.pending === null || this.pending.message !== this.text.trim()) {
      const input = new ConversationTurnInput(); input.requestId = util.generateRandomUUID(); input.expectedVersion = this.view.version;
      input.message = this.text.trim(); input.llmContextApproved = this.cloud;
      input.projectId = this.target === '' ? null : this.target;
      if (this.replyId !== '') input.replyToMessageId = this.replyId;
      if (this.entity !== undefined && this.entity.projectId === this.target) input.entityRef = this.entity;
      this.pending = input;
    }
    try {
      const reply = await this.service.ask(this.view.id, this.pending!);
      if (epoch !== this.generation) return;
      this.view = reply.conversation; this.target = this.view.focusProjectId ?? '';
      setTimeout(() => { if (epoch === this.generation) this.messageScroller.scrollEdge(Edge.Bottom); }, 50);
      if (reply.status === 'ANSWERED' || reply.status === 'NEEDS_CLARIFICATION') { this.text = ''; this.pending = null; this.replyId = ''; }
      else this.error = '原请求状态：' + reply.status + '，请读取原状态。';
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
  @Builder private Message(m: ConversationMessage) {
    Column({ space: 10 }) {
      Text(m.content).fontSize(15).lineHeight(24).fontColor(PMColors.INK_PRIMARY).width('100%')
      if (m.priorities.length > 0 || m.sources.length > 0) {
        PMButton({ label: this.expanded === m.id ? '收起依据' : '优先级与来源', secondary: true, onAction: (): void => { this.expanded = this.expanded === m.id ? '' : m.id; } })
      }
      if (this.expanded === m.id) {
        ForEach(m.priorities, (p: PriorityReason) => { Text(p.importance + '；' + p.urgency + '；' + p.blocking + '；' + p.effort + '\n' + p.preference + '\n' + p.tradeoff).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY) }, (p: PriorityReason) => p.projectId)
        ForEach(m.sources, (s: ConversationSource) => { Text(s.title + '\n' + s.excerpt).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY) }, (s: ConversationSource) => s.id)
      }
      ForEach(m.refs.filter((r: ConversationRef) => ['PROJECT', 'MISSION', 'ACTION'].includes(r.kind)).slice(0, 3), (r: ConversationRef) => {
        Text(r.title + '  ↗').fontSize(13).fontColor(PMColors.BRAND).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).padding({ top: 8, bottom: 8 }).onClick(() => { this.open(r, m.id); })
        if (r.kind === 'MISSION' || r.kind === 'ACTION') { PMButton({ label: '在此协作', secondary: true, disabled: this.busy, onAction: (): void => { this.workRef = { kind: r.kind, id: r.id, projectId: r.projectId }; this.messageScroller.scrollEdge(Edge.Bottom); } }) }
        if (r.kind === 'MISSION' && r.status === 'PAUSED') { PMButton({ label: '预览接续原委托', disabled: this.busy, secondary: true, onAction: (): void => { if (this.busy) return; const epoch = this.generation; this.busy = true; this.service.previewResume(this.view.id, r.id).then(v => { if (epoch === this.generation) this.view = v.conversation; }).catch((e: Error) => { if (epoch === this.generation) this.fail(e); }).finally(() => { if (epoch === this.generation) this.busy = false; }); } }) }
      }, (r: ConversationRef) => r.bindingId ?? r.id)
      if (m.proposal !== null) {
        Text(m.proposal.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        Text(m.proposal.description).fontSize(14).fontColor(PMColors.INK_SECONDARY)
        if (m.proposal.resultId !== null) {
          Text((!m.proposal.tool || m.proposal.tool === 'create_action' ? '已创建行动 · ' : '已提交原操作 · ') + (m.proposal.actionStatus ?? '回执已保存')).fontSize(14).fontColor(PMColors.BRAND)
          PMButton({ label: '查看原结果', secondary: true, onAction: (): void => {
            if (m.proposal!.tool === 'adopt_artifact') router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: m.proposal!.projectId, tab: 'artifacts', conversationId: this.view.id } });
            else if (m.proposal!.tool && !['create_action', 'complete_action'].includes(m.proposal!.tool!)) router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: m.proposal!.projectId, missionId: m.proposal!.resultId, conversationId: this.view.id, originMessageId: m.id } });
            else this.workRef = { kind: 'ACTION', projectId: m.proposal!.projectId, id: m.proposal!.resultId! };
          } })
          if (m.proposal.resultCardId) { Text('复盘已保存 · ' + m.proposal.resultCardId).fontSize(12).fontColor(PMColors.BRAND) }
        } else if (m.proposal.status === 'PENDING') {
          PMButton({ label: m.proposal.tool === 'resume_mission' ? '确认接续原委托' : !m.proposal.tool || m.proposal.tool === 'create_action' ? '确认创建行动' : '确认此操作', disabled: this.busy, onAction: (): void => { this.confirm(m.proposal!); } })
          PMButton({ label: '不采用', secondary: true, disabled: this.busy, onAction: (): void => { if (this.busy) return; const epoch = this.generation; this.busy = true; this.service.decline(this.view.id, m.proposal!.executionId).then(r => { if (epoch === this.generation) this.view = r.conversation; }).catch((e: Error) => { if (epoch === this.generation) this.fail(e); }).finally(() => { if (epoch === this.generation) this.busy = false; }); } })
        }
      }
      if (m.role === 'ASSISTANT' && !m.restricted) { PMButton({ label: '追问这条', secondary: true, onAction: (): void => { this.replyId = m.id; this.text = '为什么这样建议？'; } }) }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(m.role === 'USER' ? PMColors.SURFACE_SUBTLE : PMColors.SURFACE).borderRadius(PMRadius.LG)
  }
  build() {
    Column() {
      PMAppBar({ title: '与忆程协作', showBack: true })
      Row({ space: 8 }) {
        Button(this.target === '' ? '跨项目讨论  ⌄' : '当前项目  ⌄', { type: ButtonType.Normal })
          .fontSize(13).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).height(40)
          .onClick(() => { this.scopeOpen = !this.scopeOpen; })
        Blank()
        Button('历史', { type: ButtonType.Normal }).height(40).fontSize(13).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent)
          .onClick(() => { this.historyOpen = !this.historyOpen; })
        Button('＋ 新讨论', { type: ButtonType.Normal }).height(40).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
          .enabled(!this.busy).onClick(() => { this.create(); })
      }.width('100%').padding({ left: 16, right: 16 }).backgroundColor(PMColors.SURFACE)
      if (this.scopeOpen) {
        Column({ space: 4 }) {
          if (this.view.scope !== 'PROJECT') { PMButton({ label: '全部授权项目', secondary: true, onAction: (): void => { this.target = ''; this.scopeOpen = false; this.pending = null; } }) }
          ForEach(this.view.linkedProjects, (p: ConversationProject) => {
            PMButton({ label: p.title, secondary: true, onAction: (): void => { this.target = p.id; this.scopeOpen = false; this.pending = null; } })
          }, (p: ConversationProject) => p.id)
        }.padding(12).width('100%').backgroundColor(PMColors.SURFACE)
      }
      if (this.historyOpen) {
        Scroll() {
          Column({ space: 4 }) {
            ForEach(this.sessions, (item: ConversationListItem) => {
              PMButton({ label: item.title, secondary: true, disabled: this.busy, onAction: (): void => { this.selectDiscussion(item.id); } })
            }, (item: ConversationListItem) => item.id)
          }.width('100%').padding(12)
        }.constraintSize({ maxHeight: 220 }).backgroundColor(PMColors.SURFACE)
      }
      if (this.error !== '') {
        Text(this.error).fontSize(12).lineHeight(20).fontColor(PMColors.RISK).padding({ left: 20, right: 20, top: 8, bottom: 8 }).width('100%')
      }
      Scroll(this.messageScroller) {
        Column({ space: 16 }) {
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
          ForEach(this.view.messages, (m: ConversationMessage) => { this.Message(m) }, (m: ConversationMessage) => m.id)
          if (this.workRef) { ForEach([this.workRef], (ref: ConversationWorkRef) => { ConversationWorkPanel({ conversation: this.view, workRef: ref, onUpdated: (v: ConversationView): void => { this.view = v; }, onClose: (): void => { this.workRef = null; } }) }, (ref: ConversationWorkRef) => this.view.id + ref.id) }
          if (this.busy) { Text('正在核对项目资料…').fontSize(13).fontColor(PMColors.INK_SECONDARY) }
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
        }.padding(16).width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
      if (this.view.id !== '') {
        Column({ space: 8 }) {
          TextArea({ text: this.text, placeholder: '和忆程聊聊下一步…' }).height(80).fontSize(15).backgroundColor(PMColors.SURFACE_SUBTLE)
            .enabled(!this.busy).onChange((v: string) => { this.text = v; })
          Row({ space: 8 }) {
            Checkbox().width(18).height(18).selectedColor(PMColors.BRAND).select(this.cloud).onChange((v: boolean) => { this.cloud = v; this.pending = null; })
            Text('云端分析').fontSize(12).fontColor(PMColors.INK_TERTIARY).accessibilityText('允许云模型使用本次授权项目资料')
            Blank()
            Button('发送 ↑', { type: ButtonType.Normal }).height(40).padding({ left: 20, right: 20 }).fontSize(14)
              .backgroundColor(PMColors.BRAND).fontColor(Color.White).borderRadius(12)
              .enabled(!this.busy && this.text.trim() !== '').onClick(() => { this.ask(); })
          }.width('100%')
        }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 16 }).backgroundColor(PMColors.SURFACE)
      }
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
