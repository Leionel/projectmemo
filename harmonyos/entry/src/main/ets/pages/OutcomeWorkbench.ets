import router from '@ohos.router';
import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { ClockIcon, PaperclipIcon, CheckIcon } from '../components/PMIcons';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
import { MissionService } from '../services/MissionService';
import { NativeMaterialService } from '../services/NativeMaterialService';
import { NativeMaterialDraft, NativeMaterialPreview } from '../models/NativeMaterial';
import { nativeMaterialFormat, nativeMaterialMime, nativeMaterialPreview, nativeMaterialLimit } from '../common/NativeMaterialContract';
import { copyPickedFile, removePickedCopy } from '../common/PickedFile';
import { SessionStore } from '../services/SessionStore';
import { MissionCommand } from '../models/Mission';
import { ApiError } from '../models/Project';
import { MissionWorkbench, WorkbenchOutput, WorkbenchBlock, WorkbenchSource, WorkbenchEvent, WorkbenchMaterial,
  OutcomeChallenge, OutcomeChallengeCommand, ChallengeQuestion, ChallengeOption, workbenchOutput, workbenchSource, challengeQuestion, workbenchTime } from '../models/MissionWorkbench';

@Entry
@Component
struct OutcomeWorkbenchPage {
  @State private view: MissionWorkbench = new MissionWorkbench();
  @State private outputId: string = '';
  @State private sourceKey: string = '';
  @State private material: string = '';
  @State private challenge: OutcomeChallenge | null = null;
  @State private challengeText: string = '';
  @State private selected: string[] = [];
  @State private error: string = '';
  @State private notice: string = '';
  @State private fresh: boolean = false;
  @State private busy: boolean = false;
  @State private materialPending: boolean = false;
  @State private challengePending: boolean = false;
  @State private controlPending: boolean = false;
  @StorageProp('missionAppActive') @Watch('appActivityChanged') private appActive: boolean = true;
  @StorageProp('pm.shareSeq') @Watch('shareArrived') private shareSeq: number = 0;
  @State private nativeDraft: NativeMaterialDraft | null = null;
  @State private nativeBusy: boolean = false;
  private projectId: string = '';
  private missionId: string = '';
  private service: MissionService = new MissionService();
  private nativeService: NativeMaterialService = new NativeMaterialService();
  private visible: boolean = false;
  private generation: number = 0;
  private timer: number = -1;
  private refreshing: boolean = false;
  private materialRequest: WorkbenchMaterial | null = null;
  private challengeRequest: OutcomeChallengeCommand | null = null;
  private challengeTarget: string = '';
  private controlRequest: MissionCommand | null = null;
  private controlAction: string = '';
  private draftKey: string = '';
  private drafts: Record<string, string> = {};
  private shareConsumed: number = 0;
  private expired: () => void = () => {
    this.stop(); this.view = new MissionWorkbench(); this.challenge = null; this.fresh = false;
    this.material = ''; this.challengeText = ''; this.selected = []; this.drafts = {};
    this.materialRequest = null; this.challengeRequest = null; this.controlRequest = null;
    this.materialPending = false; this.challengePending = false; this.controlPending = false;
    if (this.visible) router.replaceUrl({ url: 'pages/LoginPage' });
  };
  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    this.projectId = params?.['projectId'] ?? ''; this.missionId = params?.['missionId'] ?? '';
    SessionStore.onSessionExpired(this.expired);
  }
  onPageShow(): void { this.visible = true; this.fresh = false; this.read(); this.consumeShare(); }
  onPageHide(): void { this.visible = false; this.stop(); }
  aboutToDisappear(): void { this.visible = false; this.stop(); SessionStore.offSessionExpired(this.expired); }
  private appActivityChanged(): void { if (this.appActive && this.visible) this.read(); else this.stop(); }
  private stop(): void { this.generation++; if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1; }
  private current(generation: number, token: string): boolean { return this.visible && this.appActive && this.generation === generation && SessionStore.getToken() === token && SessionStore.isTokenValid(); }
  private newRequestId(): string { return `harmony-outcome-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  private definite(e: Object): boolean { return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408; }
  private fail(e: Object): void {
    this.fresh = false; this.error = e instanceof ApiError ? e.message : '请求未确认，请重试原请求';
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      this.view = new MissionWorkbench(); this.challenge = null; this.sourceKey = ''; this.selected = [];
      this.challengeText = ''; this.drafts = {}; this.material = '';
      if (e.status === 401) this.expired();
    }
  }
  private setChallenge(value: OutcomeChallenge | null): void {
    const question = challengeQuestion(value), key = question === undefined || value === null ? '' : value.id + ':' + question.key;
    if (key !== this.draftKey) {
      if (this.draftKey !== '') this.drafts[this.draftKey] = this.challengeText;
      this.challengeText = this.drafts[key] ?? ''; this.selected = []; this.draftKey = key;
    }
    this.challenge = value;
  }
  private async read(): Promise<void> {
    if (!this.visible || !this.appActive || this.refreshing || this.missionId === '' || !SessionStore.isTokenValid()) return;
    if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1;
    this.refreshing = true; const generation = this.generation, token = SessionStore.getToken();
    try {
      const value = await this.service.workbench(this.missionId);
      if (!this.current(generation, token)) return;
      if (value.id !== this.missionId || value.projectId !== this.projectId) throw new ApiError('SCOPE_CHANGED', '成果不属于原项目，请返回重新进入', 403);
      this.view = value; this.fresh = true;
      if (value.challengesEnabled && !this.challengePending) {
        const reply = await this.service.challenge(this.missionId);
        if (this.current(generation, token)) this.setChallenge(reply.session);
      } else if (!value.challengesEnabled) this.setChallenge(null);
    } catch (e) { if (this.current(generation, token)) this.fail(e); }
    finally {
      this.refreshing = false;
      if (this.current(generation, token)) this.timer = setTimeout(() => { this.read(); }, 4000);
      else if (this.visible && this.appActive && SessionStore.isTokenValid()) this.read();
    }
  }

  private shareArrived(): void { if (this.visible && this.appActive) this.consumeShare(); }
  private consumeShare(): void {
    if (this.shareConsumed >= this.shareSeq) return;
    const uri = AppStorage.get<string>('pendingShareUri') ?? '';
    const name = AppStorage.get<string>('pendingShareName') ?? '分享的材料';
    if (uri === '') return;
    this.shareConsumed = this.shareSeq;
    AppStorage.setOrCreate<string>('pendingShareUri', '');
    AppStorage.setOrCreate<string>('pendingShareName', '');
    this.loadNativeFile(uri, name);
  }
  private async pickNativeMaterial(): Promise<void> {
    if (this.busy || this.nativeBusy) return;
    try {
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['TXT|.txt', 'Markdown|.md', 'CSV|.csv', 'Word|.docx'];
      const uris = await new picker.DocumentViewPicker().select(options);
      if (uris.length === 0) return;
      this.loadNativeFile(uris[0], '');
    } catch (_e) {
      this.error = '无法打开文件选择器，请改为粘贴文本或重新进入';
    }
  }
  private async loadNativeFile(uri: string, suppliedName: string): Promise<void> {
    if (this.busy || this.nativeBusy || this.missionId === '') return;
    this.nativeBusy = true; this.error = ''; this.notice = '';
    const generation = this.generation, token = SessionStore.getToken();
    const context = getContext(this) as common.UIAbilityContext;
    let localPath = uri;
    let name = suppliedName;
    try {
      if (name === '') { const parts = uri.split('?')[0].split('/'); name = decodeURIComponent(parts[parts.length - 1] ?? '材料'); }
      const format = nativeMaterialFormat(name);
      if (format === 'UNSUPPORTED') throw new ApiError('MATERIAL_FORMAT', '请选择 TXT、Markdown、普通 CSV 或 DOCX 文件');
      localPath = copyPickedFile(context.cacheDir, uri);
      const size = fileIo.statSync(localPath).size;
      if (size === 0 || size > nativeMaterialLimit(format)) throw new ApiError('MATERIAL_SIZE_LIMIT', format === 'DOCX' ? 'Word 文件需在 2MB 以内' : '文本材料需在 64KB 以内');
      let text = '';
      let limitations = '';
      if (format === 'DOCX') {
        const extracted = await this.nativeService.extract(this.projectId, localPath, name, nativeMaterialMime(format));
        text = extracted.text; limitations = extracted.limitations;
      } else {
        text = fileIo.readTextSync(localPath);
        limitations = format === 'CSV' ? '按普通文本读取，不当作实验指标。' : '按 UTF-8 文本读取，不识别排版或图片。';
      }
      if (!this.current(generation, token)) return;
      const preview: NativeMaterialPreview = await this.nativeService.preview(this.missionId, name, text);
      if (!this.current(generation, token)) return;
      this.nativeDraft = NativeMaterialDraft.fromPreview(this.missionId, uri, preview, format, size);
      this.notice = '已解析，先核对预览和目标，再确认加入。';
    } catch (e) {
      if (this.current(generation, token)) this.fail(e);
    } finally {
      removePickedCopy(uri, localPath);
      this.nativeBusy = false;
    }
  }
  private async confirmNativeMaterial(): Promise<void> {
    if (this.busy || this.nativeDraft === null || this.materialPending) return;
    const draft = this.nativeDraft;
    const body = new WorkbenchMaterial(); body.requestId = draft.requestId; body.text = draft.text; body.name = draft.name; body.kind = 'MATERIAL';
    this.materialRequest = body; this.materialPending = true; this.busy = true; this.error = '';
    const generation = this.generation, token = SessionStore.getToken();
    try {
      await this.service.addWorkbenchMaterial(this.missionId, body);
      if (!this.current(generation, token)) return;
      this.materialRequest = null; this.materialPending = false; this.nativeDraft = null;
      this.notice = '材料已加入原委托；原许可、预算和来源限制继续生效。';
    } catch (e) {
      if (this.current(generation, token)) { if (this.definite(e)) { this.materialRequest = null; this.materialPending = false; } this.fail(e); }
    } finally { this.busy = false; this.read(); }
  }
  private async addMaterial(): Promise<void> {
    if (this.busy || this.challengePending || this.controlPending || this.material.trim() === '') return;
    if (this.materialRequest === null) { const body = new WorkbenchMaterial(); body.requestId = this.newRequestId(); body.text = this.material; this.materialRequest = body; }
    this.materialPending = true; this.busy = true; this.error = ''; const generation = this.generation, token = SessionStore.getToken();
    try {
      await this.service.addWorkbenchMaterial(this.missionId, this.materialRequest);
      if (!this.current(generation, token)) return;
      this.materialRequest = null; this.materialPending = false; this.material = ''; this.notice = '反馈已存入原项目，原委托按现有许可核对。';
    } catch (e) { if (this.current(generation, token)) { if (this.definite(e)) { this.materialRequest = null; this.materialPending = false; } this.fail(e); } }
    finally { this.busy = false; this.read(); }
  }
  private async control(action: string): Promise<void> {
    if (this.busy || this.materialPending || this.challengePending) return;
    this.busy = true; this.error = ''; const generation = this.generation, token = SessionStore.getToken();
    try {
      if (this.controlRequest === null) {
        const current = await this.service.detail(this.missionId);
        if (!this.current(generation, token)) return;
        const body = new MissionCommand(); body.requestId = this.newRequestId(); body.expectedVersion = current.version;
        this.controlRequest = body; this.controlAction = action;
      }
      this.controlPending = true;
      await this.service.command(this.missionId, this.controlAction, this.controlRequest);
      if (!this.current(generation, token)) return;
      this.controlRequest = null; this.controlPending = false; this.notice = '原委托控制已送达，请以当前状态为准。';
    } catch (e) { if (this.current(generation, token)) { if (this.definite(e)) { this.controlRequest = null; this.controlPending = false; } this.fail(e); } }
    finally { this.busy = false; this.read(); }
  }
  private async play(action: string, kind: string = '', sourceKey: string = ''): Promise<void> {
    if (this.busy || this.materialPending || this.controlPending) return;
    const question = challengeQuestion(this.challenge), output = workbenchOutput(this.view, this.outputId);
    if (this.challengeRequest === null) {
      const body = new OutcomeChallengeCommand(); body.requestId = this.newRequestId();
      if (kind !== '' && output !== undefined) { body.kind = kind; body.outputId = output.id; this.challengeTarget = ''; }
      else if (this.challenge !== null) {
        body.action = action; this.challengeTarget = this.challenge.id;
        if (action === 'ANSWER' && question !== undefined) { body.questionKey = question.key; if (this.challenge.kind === 'REHEARSAL') body.text = this.challengeText; else body.selected = this.selected; }
        if (action === 'OPEN_SOURCE') body.sourceKey = sourceKey;
      } else return;
      this.challengeRequest = body;
    }
    this.challengePending = true; this.busy = true; this.error = ''; const generation = this.generation, token = SessionStore.getToken();
    try {
      const reply = this.challengeTarget === '' ? await this.service.startChallenge(this.missionId, this.challengeRequest) : await this.service.challengeCommand(this.missionId, this.challengeTarget, this.challengeRequest);
      if (!this.current(generation, token)) return;
      if (this.challengeRequest.action === 'OPEN_SOURCE') this.sourceKey = this.challengeRequest.sourceKey ?? '';
      this.challengeRequest = null; this.challengePending = false; this.setChallenge(reply.session);
    } catch (e) { if (this.current(generation, token)) { if (this.definite(e)) { this.challengeRequest = null; this.challengePending = false; } this.fail(e); } }
    finally { this.busy = false; this.read(); }
  }
  @Builder private Source(source: WorkbenchSource) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        PaperclipIcon({ iconSize: 16, color: PMColors.INK_SECONDARY })
        Text(source.name ?? '项目记录').fontSize(16).fontWeight(FontWeight.Medium).layoutWeight(1)
      }.width('100%')
      Row({ space: 8 }) {
        ClockIcon({ iconSize: 16, color: PMColors.INK_TERTIARY })
        Text(workbenchTime(source.observedAt)).fontColor(PMColors.INK_SECONDARY).fontSize(13)
      }
      Row({ space: 8 }) {
        if (source.current) { CheckIcon({ iconSize: 14, color: PMColors.BRAND }) }
        Text(source.current ? '当前引用版本' : '此前引用的版本').fontColor(PMColors.INK_TERTIARY).fontSize(13)
      }
      Text(source.text).fontSize(16).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp)
    }.alignItems(HorizontalAlign.Start).padding(14).width('100%').backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.MD)
  }
  @Builder private Question(question: ChallengeQuestion) {
    Text(question.title).fontSize(17).fontWeight(FontWeight.Medium)
    Text(question.excerpt).fontColor(PMColors.INK_SECONDARY)
    if (this.challenge?.kind === 'REHEARSAL') {
      TextArea({ text: this.challengeText, placeholder: '本轮核查意见；也可以说明目前不知道' }).maxLength(1200).height(110).enabled(!this.busy && !this.challengePending).onChange((value: string) => { this.challengeText = value; })
    } else {
      ForEach(question.options, (option: ChallengeOption) => {
        Button(`${this.selected.includes(option.key) ? '✓ ' : ''}${option.label}`).type(ButtonType.Normal).fontColor(PMColors.BRAND).backgroundColor(this.selected.includes(option.key) ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
          .width('100%').height(48).enabled(!this.busy && !this.challengePending).accessibilityText(`${option.label}，${this.selected.includes(option.key) ? '已选择' : '未选择'}`)
          .onClick(() => { this.selected = this.selected.includes(option.key) ? this.selected.filter((key: string) => key !== option.key) : this.selected.concat([option.key]); })
      }, (option: ChallengeOption) => option.key)
    }
    PMButton({ label: '保存本轮回答', secondary: true, disabled: this.busy || this.challengePending || (this.challenge?.kind === 'REHEARSAL' ? this.challengeText.trim() === '' : this.selected.length === 0), onAction: (): void => { this.play('ANSWER'); } })
  }
  @Builder private Challenge(session: OutcomeChallenge) {
    Text(`${session.kind === 'REHEARSAL' ? '交付彩排' : '引用追溯'} · 第 ${session.revision} 版`).fontSize(18).fontWeight(FontWeight.Medium)
    if (session.handoffSourceId !== null) { Text('核查意见已交回原委托，新版本会显示在上方。').fontColor(PMColors.BRAND) }
    else if (session.status === 'STALE') { Text(session.reason ?? '本轮已撤下，请核对当前成果后重新开始').fontColor(PMColors.RISK) }
    else if (session.status === 'ACTIVE' && challengeQuestion(session) !== undefined) {
      Text(`第 ${session.answers.length + 1} / ${session.questions.length} 轮`).fontSize(13).fontColor(PMColors.INK_TERTIARY)
      this.Question(session.questions[session.answers.length])
    } else if (session.status === 'COMPLETED') {
      Text(session.kind === 'REHEARSAL' ? '三项核查意见已保存，交回原委托后再修订。' : session.answers[0]?.verdict === 'LINK_MATCH' ? '已找到全部引用，表述是否受支持仍待核对。' : '选择与稿件引用有差异，可以继续核对原文。')
      PMButton({ label: '把核查缺口交回原委托', secondary: true, disabled: this.busy || this.challengePending, onAction: (): void => { this.play('HANDOFF'); } })
    }
    if (['ACTIVE', 'COMPLETED'].includes(session.status) && session.handoffSourceId === null) {
      ForEach(session.sourceKeys, (key: string, index: number) => { PMButton({ label: `查看资料 ${index + 1}`, secondary: true, disabled: this.busy || this.challengePending, onAction: (): void => { this.play('OPEN_SOURCE', '', key); } }) }, (key: string) => key)
      PMButton({ label: '退出本轮挑战', secondary: true, disabled: this.busy || this.challengePending, onAction: (): void => { this.play('STOP'); } })
    }
  }
  @Builder private Draft(output: WorkbenchOutput) {
    Row({ space: 8 }) {
      ClockIcon({ iconSize: 16, color: PMColors.INK_SECONDARY })
      Text(`私有工作稿 ${workbenchTime(output.createdAt)}`).fontSize(14).fontColor(PMColors.INK_SECONDARY)
    }
    ForEach(output.blocks, (block: WorkbenchBlock) => { Text(block.text).fontSize(16).lineHeight(26).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp) }, (block: WorkbenchBlock) => block.blockId)
    ForEach(output.sourceKeys, (key: string, index: number) => { PMButton({ label: `定位原记录 ${index + 1}`, secondary: true, disabled: !this.fresh, onAction: (): void => { this.sourceKey = key; } }) }, (key: string) => key)
  }
  build() {
    Column() {
      PMAppBar({ title: '持续成果', backLabel: '原委托', rightActionText: '刷新', onRightTextAction: (): void => { this.error = ''; this.read(); } })
      Scroll() {
        Column({ space: 16 }) {
          if (this.error !== '') { Text(this.error).fontColor(PMColors.RISK) }
          if (this.notice !== '') { Text(this.notice).fontColor(PMColors.BRAND) }
          if (this.view.id === '') { Text('正在读取原委托的成果；读取失败可点击刷新。') }
          else {
            Text(this.view.goal).fontSize(23).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
            Text(this.view.reason).fontColor(PMColors.BRAND)
            if (this.controlPending) { PMButton({ label: '重试原控制请求', secondary: true, disabled: this.busy, onAction: (): void => { this.control(this.controlAction); } }) }
            else { PMButton({ label: this.view.status === 'PAUSED' ? '恢复原委托' : '暂停原委托', secondary: true,
              disabled: this.busy || !this.fresh || this.materialPending || this.challengePending || ['SUCCEEDED', 'CANCELLED'].includes(this.view.status), onAction: (): void => { this.control(this.view.status === 'PAUSED' ? 'resume' : 'pause'); } }) }
            ForEach(this.view.outputs, (output: WorkbenchOutput) => { PMButton({ label: `第 ${output.revision} 版  ${workbenchTime(output.createdAt)}`, secondary: true, onAction: (): void => { this.outputId = output.id; this.sourceKey = ''; } }) }, (output: WorkbenchOutput) => output.id)
            if (workbenchOutput(this.view, this.outputId) !== undefined) { this.Draft(workbenchOutput(this.view, this.outputId) as WorkbenchOutput) }
            else { Text('原委托尚未交付报告稿，已有阶段成果可返回委托查看。') }
            if (workbenchSource(this.view, this.sourceKey) !== undefined && this.fresh) { this.Source(workbenchSource(this.view, this.sourceKey) as WorkbenchSource) }
            if (this.view.challengesEnabled) {
              if (this.challengePending) { PMButton({ label: '重试原挑战请求', secondary: true, disabled: this.busy, onAction: (): void => { this.play(''); } }) }
              else if (this.challenge?.status !== 'ACTIVE') {
                PMButton({ label: '严格导师 · 三轮彩排', secondary: true, disabled: this.busy || !this.fresh || this.view.outputs.length === 0, onAction: (): void => { this.play('', 'REHEARSAL'); } })
                PMButton({ label: '证据侦探 · 引用追溯', secondary: true, disabled: this.busy || !this.fresh || this.view.outputs.length === 0, onAction: (): void => { this.play('', 'EVIDENCE'); } })
              }
              if (this.challenge !== null && this.challenge.status !== 'STOPPED') { this.Challenge(this.challenge) }
            }
            Text('补材料').fontSize(18).fontWeight(FontWeight.Medium)
            if (this.nativeDraft !== null) {
              Text(`${this.nativeDraft.name} · ${this.nativeDraft.format} · ${this.nativeDraft.text.length} 字`).fontSize(13).fontColor(PMColors.INK_SECONDARY)
              Text(this.nativeDraft.limitations).fontSize(12).fontColor(PMColors.INK_TERTIARY)
              Text(nativeMaterialPreview(this.nativeDraft.text, 240)).fontSize(14).fontColor(PMColors.INK_PRIMARY)
              Row({ space: 8 }) {
                PMButton({ label: this.materialPending ? '重试原材料请求' : '确认加入原委托', disabled: this.busy, onAction: (): void => { this.confirmNativeMaterial(); } })
                PMButton({ label: '取消', secondary: true, disabled: this.busy, onAction: (): void => { this.nativeDraft = null; this.error = ''; } })
              }
            } else {
              PMButton({ label: this.nativeBusy ? '正在解析…' : '从手机补材料', secondary: true, disabled: this.busy || this.nativeBusy, onAction: (): void => { this.pickNativeMaterial(); } })
              Text('TXT、Markdown、普通 CSV 或 DOCX；先预览，确认后加入当前原委托。').fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
            Text('补充反馈').fontSize(18).fontWeight(FontWeight.Medium)
            TextArea({ text: this.material, placeholder: '记录待核对的反馈，原委托继续处理' }).height(110).maxLength(20000).enabled(!this.busy && !this.materialPending).onChange((text: string) => { this.material = text; })
            PMButton({ label: this.materialPending ? '重试原反馈' : '保存反馈到原项目', disabled: this.busy || this.challengePending || this.controlPending || this.material.trim() === '', onAction: (): void => { this.addMaterial(); } })
            PMButton({ label: '自然改道／继续讨论', secondary: true, onAction: (): void => { router.pushUrl({ url: 'pages/FocusConversation', params: { projectId: this.projectId, entityKind: 'MISSION', entityId: this.missionId } }); } })
            ForEach(this.view.events.slice(0, 5), (event: WorkbenchEvent) => { Text(event.label).fontSize(13).fontColor(PMColors.INK_TERTIARY) }, (event: WorkbenchEvent) => event.id)
          }
        }.width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
