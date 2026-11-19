import router from '@ohos.router';
import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { AgentMessageBlocks } from '../components/AgentMessageBlocks';
import { WorkbenchSprint } from '../components/WorkbenchSprint';
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
import { MissionWorkbench, WorkbenchOutput, WorkbenchBlock, WorkbenchSource, WorkbenchEvent, WorkbenchMaterial, WorkbenchReadReceipt,
  WorkbenchDelivery, WorkbenchComparison, WorkbenchChange, WorkbenchStageArtifact, OutcomeChallenge, OutcomeChallengeCommand, ChallengeQuestion, ChallengeOption,
  unreadWorkbenchOutput, workbenchSource, challengeQuestion, workbenchTime } from '../models/MissionWorkbench';

@Entry
@Component
struct OutcomeWorkbenchPage {
  @State private view: MissionWorkbench = new MissionWorkbench();
  @State private selectedRevision: number = 0;
  @State private baselineRevision: number = 0;
  @State private questionPin: string = '';
  private reviewRevision: number = 0;
  @State private delivery: WorkbenchDelivery | null = null;
  @State private deliveryBusy: boolean = false;
  @State private showVersions: boolean = false;
  @State private selectedStageId: string = '';
  @State private showProcess: boolean = false;
  @State private showSprint: boolean = false;
  @State private feedbackSourceId: string = '';
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
  @State private readReceipt: WorkbenchReadReceipt | null = null;
  @State private savingReadReceipt: boolean = false;
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
    this.readReceipt = null; this.delivery = null;
    if (this.visible) router.replaceUrl({ url: 'pages/LoginPage' });
  };
  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    this.projectId = params?.['projectId'] ?? ''; this.missionId = params?.['missionId'] ?? '';
    this.selectedRevision = Number(params?.['revision'] ?? 0) || 0;
    this.baselineRevision = Number(params?.['baseline'] ?? 0) || 0;
    this.questionPin = params?.['questionId'] ?? '';
    if (params?.['entry'] === 'review') this.reviewRevision = this.selectedRevision;
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
      this.readReceipt = null; this.delivery = null;
      if (e.status === 401) this.expired();
    }
  }
  private async markOutputRead(output?: WorkbenchOutput): Promise<void> {
    if (this.savingReadReceipt) return;
    if (this.readReceipt === null) {
      if (!this.fresh || output === undefined || output.sourceAccessChanged) return;
      const receipt = new WorkbenchReadReceipt();
      receipt.requestId = this.newRequestId();
      receipt.seenOutputRevision = output.revision;
      this.readReceipt = receipt;
    }
    const receipt = this.readReceipt, generation = this.generation, token = SessionStore.getToken();
    this.savingReadReceipt = true;
    this.error = '';
    try {
      await this.service.markWorkbenchOutputRead(this.missionId, receipt);
      if (!this.current(generation, token)) return;
      this.readReceipt = null;
      this.notice = `已记录第 ${receipt.seenOutputRevision} 版已读，Web 与手机共用这个位置。`;
    } catch (e) {
      if (this.current(generation, token)) {
        if (this.definite(e)) this.readReceipt = null;
        this.fail(e);
      }
    } finally { this.savingReadReceipt = false; this.read(); }
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
      const value = await this.service.workbench(this.missionId, this.selectedRevision, this.baselineRevision);
      if (!this.current(generation, token)) return;
      if (value.id !== this.missionId || value.projectId !== this.projectId) throw new ApiError('SCOPE_CHANGED', '成果不属于原项目，请返回重新进入', 403);
      this.view = value; this.fresh = true;
      if (this.reviewRevision > 0) {
        const revision = this.reviewRevision;
        this.reviewRevision = 0;
        const opened = value.outputs.find((output: WorkbenchOutput) => output.revision === revision && !output.sourceAccessChanged);
        if (opened !== undefined && revision > (value.lastSeenOutputRevision ?? 0)) this.markOutputRead(opened);
      }
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

  private currentOutput(): WorkbenchOutput | undefined {
    return this.selectedRevision > 0
      ? this.view.outputs.find((output: WorkbenchOutput) => output.revision === this.selectedRevision)
      : this.view.outputs[0];
  }

  private selectDraft(output: WorkbenchOutput, baseline: number = 0, feedbackSourceId: string = ''): void {
    this.reviewRevision = 0;
    this.selectedRevision = output.revision; this.baselineRevision = baseline;
    this.sourceKey = ''; this.delivery = null; this.feedbackSourceId = feedbackSourceId; this.read();
  }

  private feedbackOutput(session: OutcomeChallenge): WorkbenchOutput | undefined {
    return this.view.outputs.find((output: WorkbenchOutput) => !output.sourceAccessChanged && output.revision > session.revision &&
      output.blocks.some((block: WorkbenchBlock) => block.sourceIds.includes(session.handoffSourceId ?? '')));
  }

  private comparisonChanges(compare: WorkbenchComparison): WorkbenchChange[] {
    if (!this.feedbackSourceId) return compare.changes;
    return compare.changes.filter((change: WorkbenchChange) =>
      change.afterKeys.some((key: string) => workbenchSource(this.view, key)?.id === this.feedbackSourceId));
  }

  private openQuestion(): void {
    const questionId = this.view.pendingQuestionId ?? '';
    if (!this.fresh || !questionId) return;
    if (this.questionPin && this.questionPin !== questionId) { this.questionPin = questionId; return; }
    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: this.missionId, questionId } });
  }

  private openWeeklyReport(output: WorkbenchOutput): void {
    if (output.weeklyReportArtifactId) {
      router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.projectId, artifactId: output.weeklyReportArtifactId } });
    } else {
      router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: this.missionId,
        outputId: output.id, revision: String(output.revision) } });
    }
  }

  private async prepareDelivery(output: WorkbenchOutput, save: boolean): Promise<void> {
    if (this.deliveryBusy || !this.fresh || output.sourceAccessChanged) return;
    this.deliveryBusy = true;
    this.error = '';
    const generation = this.generation, token = SessionStore.getToken(), from = this.baselineRevision;
    try {
      const next = await this.service.workbenchDelivery(this.missionId, output.id, output.revision, from);
      if (!this.current(generation, token) || this.currentOutput()?.id !== output.id || from !== this.baselineRevision) return;
      if (!save || next.markdown !== this.delivery?.markdown) {
        this.delivery = next;
        if (save) this.notice = '交付稿已更新，请先查看修改。';
        return;
      }
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [next.filename];
      const destinations = await new picker.DocumentViewPicker().save(options);
      if (!destinations.length || token !== SessionStore.getToken() || !SessionStore.isTokenValid() ||
          this.currentOutput()?.id !== output.id || from !== this.baselineRevision) return;
      const verified = await this.service.workbenchDelivery(this.missionId, output.id, output.revision, from);
      if (token !== SessionStore.getToken() || !SessionStore.isTokenValid()) return;
      if (verified.markdown !== next.markdown) { this.delivery = verified; this.notice = '交付稿已更新，请先查看修改。'; return; }
      const file = fileIo.openSync(destinations[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try { fileIo.writeSync(file.fd, verified.markdown); } finally { fileIo.closeSync(file); }
      this.notice = '已保存交付稿。';
    } catch (error) {
      if (token === SessionStore.getToken()) { this.delivery = null; this.fail(error); }
    } finally { this.deliveryBusy = false; }
  }

  private shareArrived(): void { if (this.visible && this.appActive) this.consumeShare(); }
  private consumeShare(): void {
    if (this.busy || this.nativeBusy || this.nativeDraft !== null || this.materialPending) return;
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
      options.fileSuffixFilters = ['TXT|.txt', 'Markdown|.md', 'CSV|.csv', 'Word|.docx', 'Excel|.xlsx'];
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
      if (format === 'UNSUPPORTED') throw new ApiError('MATERIAL_FORMAT', '请选择 TXT、Markdown、普通 CSV、DOCX 或 XLSX 文件');
      localPath = copyPickedFile(context.cacheDir, uri, nativeMaterialLimit(format));
      const size = fileIo.statSync(localPath).size;
      if (size === 0 || size > nativeMaterialLimit(format)) throw new ApiError('MATERIAL_SIZE_LIMIT', format === 'DOCX' || format === 'XLSX' ? 'Office 文件需在 2MB 以内' : '文本材料需在 64KB 以内');
      // All formats share server byte/UTF-8 validation; decoding locally could silently replace
      // malformed input before the strict parser sees the original bytes.
      const extracted = await this.nativeService.extract(this.projectId, localPath, name, nativeMaterialMime(format));
      const text = extracted.text;
      const limitations = extracted.limitations;
      if (!this.current(generation, token)) return;
      const preview: NativeMaterialPreview = await this.nativeService.preview(this.missionId, name, text);
      preview.limitations = limitations;
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
    const question = challengeQuestion(this.challenge), output = this.currentOutput();
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
      if (this.challengeRequest.action === 'DELETE_ATTEMPT') { this.challengeText = ''; this.selected = []; }
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
          .onClick(() => { this.selected = this.selected.includes(option.key) ? this.selected.filter((key: string) => key !== option.key)
            : this.challenge?.kind === 'METRIC' ? [option.key] : this.selected.concat([option.key]); })
      }, (option: ChallengeOption) => option.key)
    }
    PMButton({ label: '保存本轮回答', secondary: true, disabled: this.busy || this.challengePending || (this.challenge?.kind === 'REHEARSAL' ? this.challengeText.trim() === '' : this.selected.length === 0), onAction: (): void => { this.play('ANSWER'); } })
  }
  @Builder private Challenge(session: OutcomeChallenge) {
    Text(`${session.kind === 'REHEARSAL' ? '交付彩排' : session.kind === 'METRIC' ? '指标可比性' : '引用追溯'} · 第 ${session.revision} 版`).fontSize(18).fontWeight(FontWeight.Medium)
    if (session.handoffSourceId !== null) {
      Text('核查意见已交回原委托。').fontColor(PMColors.BRAND)
      if (this.feedbackOutput(session) !== undefined) {
        PMButton({ label: '查看反馈关联改动', onAction: (): void => {
          const target = this.feedbackOutput(session);
          if (target !== undefined) this.selectDraft(target, session.revision, session.handoffSourceId ?? '');
        } })
      }
    }
    else if (session.status === 'STALE') { Text(session.reason ?? '本轮已撤下，请核对当前成果后重新开始').fontColor(PMColors.RISK) }
    else if (session.status === 'ACTIVE' && challengeQuestion(session) !== undefined) {
      Text(`第 ${session.answers.length + 1} / ${session.questions.length} 轮`).fontSize(13).fontColor(PMColors.INK_TERTIARY)
      this.Question(session.questions[session.answers.length])
    } else if (session.status === 'COMPLETED') {
      Text(session.kind === 'REHEARSAL' ? '三项核查意见已保存，交回原委托后再修订。' : session.kind === 'METRIC' ?
          (session.answers[0]?.verdict === 'LINK_MATCH' ? '判断符合两条记录中的条件和口径。' : '可以再核对两条指标的单位、周期和实验条件。')
        : session.answers[0]?.verdict === 'LINK_MATCH' ? '已找到全部引用，表述是否受支持仍待核对。' : '选择与稿件引用有差异，可以继续核对原文。')
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
    if (output.presentation !== undefined) {
      AgentMessageBlocks({ presentation: output.presentation, messageId: output.id })
    } else {
      ForEach(output.blocks, (block: WorkbenchBlock) => { Text(block.text).fontSize(16).lineHeight(26).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp) }, (block: WorkbenchBlock) => block.blockId)
    }
    ForEach(output.sourceKeys, (key: string, index: number) => { PMButton({ label: `定位原记录 ${index + 1}`, secondary: true, disabled: !this.fresh, onAction: (): void => { this.sourceKey = key; } }) }, (key: string) => key)
  }
  private currentStage(): WorkbenchStageArtifact | undefined {
    const artifacts = this.view.stageArtifacts ?? [];
    return artifacts.find((artifact: WorkbenchStageArtifact) => artifact.id === this.selectedStageId) ?? artifacts[0];
  }

  @Builder private StageArtifact(artifact: WorkbenchStageArtifact) {
    Column({ space: 10 }) {
      Text('阶段成果').fontSize(19).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      if ((this.view.stageArtifacts?.length ?? 0) > 1) {
        ForEach(this.view.stageArtifacts ?? [], (item: WorkbenchStageArtifact) => {
          PMButton({ label: item.label + ' · ' + workbenchTime(item.createdAt), secondary: item.id !== artifact.id,
            onAction: (): void => { this.selectedStageId = item.id; this.sourceKey = ''; } })
        }, (item: WorkbenchStageArtifact) => item.id)
      } else {
        Text(artifact.label + ' · ' + workbenchTime(artifact.createdAt)).fontSize(13).fontColor(PMColors.INK_SECONDARY)
      }
      AgentMessageBlocks({ presentation: artifact.presentation, messageId: artifact.id })
      ForEach(artifact.unknowns, (item: string) => {
        Text('待确认 · ' + item).fontSize(13).fontColor(PMColors.INK_SECONDARY)
      })
      ForEach(artifact.sourceKeys, (key: string) => { this.Reference(key, '原记录 · ') }, (key: string) => key)
    }.width('100%').padding(PMSpacing.MD).alignItems(HorizontalAlign.Start)
      .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
  }

  @Builder private ReturnDraft(output: WorkbenchOutput) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Image($r('app.media.bookmark_spirit_avatar')).width(44).height(44).objectFit(ImageFit.Contain)
        Text(`第 ${output.revision} 版已备好`).fontSize(19).fontWeight(FontWeight.Medium)
      }
      Text(workbenchTime(output.createdAt)).fontSize(13).fontColor(PMColors.INK_SECONDARY)
      PMButton({ label: (this.view.lastSeenOutputRevision ?? 0) > 0 ? '看改了什么' : '打开成果', disabled: !this.fresh,
        onAction: (): void => { this.selectDraft(output, this.view.lastSeenOutputRevision ?? 0); this.markOutputRead(output); } })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
  }
  @Builder private Reference(key: string, prefix: string = '') {
    if (workbenchSource(this.view, key) !== undefined) {
      PMButton({ label: prefix + (workbenchSource(this.view, key)?.name ?? '原始资料'), secondary: true, disabled: !this.fresh,
        onAction: (): void => { this.sourceKey = key; } })
    }
  }
  @Builder private Comparison(compare: WorkbenchComparison) {
    Column({ space: 10 }) {
      Text(`第 ${compare.baselineRevision} 版 → 第 ${compare.revision} 版`).fontSize(20).fontWeight(FontWeight.Medium)
      if (compare.restricted) {
        Text('来源许可已变化，当前无法核对这两版差异。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
      } else {
        if (this.feedbackSourceId) {
          Text('显示与这次反馈关联的改动').fontSize(13).fontColor(PMColors.INK_SECONDARY)
          PMButton({ label: '查看全部改动', secondary: true, onAction: (): void => { this.feedbackSourceId = ''; } })
        } else {
          Text(`${compare.changes.length} 处变化 · 新增 ${compare.addedKeys.length} 条引用 · 移除 ${compare.removedKeys.length} 条引用`)
            .fontSize(13).fontColor(PMColors.INK_SECONDARY)
          ForEach(compare.addedKeys, (key: string) => { this.Reference(key, '新增引用 · ') }, (key: string) => key)
          ForEach(compare.removedKeys, (key: string) => { this.Reference(key, '旧稿引用 · ') }, (key: string) => key)
        }
        ForEach(this.comparisonChanges(compare), (change: WorkbenchChange) => {
          Column({ space: 6 }) {
            if (change.before) Text(change.before).fontSize(14).fontColor(PMColors.INK_SECONDARY)
            if (change.after) Text(change.after).fontSize(16).fontColor(PMColors.INK_PRIMARY)
            ForEach(change.beforeKeys, (key: string) => { this.Reference(key, '原稿 · ') }, (key: string) => key)
            ForEach(change.afterKeys, (key: string) => { this.Reference(key, '新稿 · ') }, (key: string) => key)
          }.width('100%').padding(10).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.MD)
        }, (change: WorkbenchChange) => change.id)
      }
      PMButton({ label: '查看完整稿', secondary: true, onAction: (): void => { this.baselineRevision = 0; this.delivery = null; this.read(); } })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private Delivery(output: WorkbenchOutput) {
    if (this.delivery !== null && this.delivery.revision === output.revision && !output.sourceAccessChanged) {
      Text(this.delivery.markdown).fontSize(13).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp)
      PMButton({ label: '保存 Markdown', onAction: (): void => { this.prepareDelivery(output, true); }, disabled: this.deliveryBusy })
      PMButton({ label: '收起交付预览', secondary: true, onAction: (): void => { this.delivery = null; } })
    } else {
      PMButton({ label: '预览交付稿', secondary: true, disabled: !this.fresh || this.deliveryBusy || !!output.sourceAccessChanged,
        onAction: (): void => { this.prepareDelivery(output, false); } })
    }
    if (this.view.artifactAdoptionEnabled && !output.sourceAccessChanged) {
      PMButton({ label: output.weeklyReportArtifactId ? '打开已归入的项目周报' : '归入项目周报', secondary: true,
        disabled: !this.fresh, onAction: (): void => { this.openWeeklyReport(output); } })
    }
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
            if (this.view.pendingQuestionId) {
              PMButton({ label: this.questionPin && this.questionPin !== this.view.pendingQuestionId ? '原问题已变化，查看当前问题' : '回答原问题',
                disabled: !this.fresh, onAction: (): void => { this.openQuestion(); } })
            } else if (unreadWorkbenchOutput(this.view) !== undefined) { this.ReturnDraft(unreadWorkbenchOutput(this.view) as WorkbenchOutput) }
            if (this.readReceipt !== null) { PMButton({ label: this.savingReadReceipt ? '正在记录已读…' : '重试原已读回执', secondary: true,
              disabled: this.savingReadReceipt, onAction: (): void => { this.markOutputRead(); } }) }
            if (this.controlPending) { PMButton({ label: '重试原控制请求', secondary: true, disabled: this.busy, onAction: (): void => { this.control(this.controlAction); } }) }
            else if (this.view.reasonCode !== 'STOP_REQUESTED_IN_FLIGHT' && ['READY', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'PAUSED'].includes(this.view.status)) {
              PMButton({ label: this.view.status === 'PAUSED' ? '恢复原委托' : '暂停原委托', secondary: true,
                disabled: this.busy || !this.fresh || this.materialPending || this.challengePending,
                onAction: (): void => { this.control(this.view.status === 'PAUSED' ? 'resume' : 'pause'); } })
            }
            if (this.currentOutput() !== undefined) {
              if (this.baselineRevision > 0 && this.view.comparison?.revision === this.currentOutput()?.revision &&
                this.view.comparison?.baselineRevision === this.baselineRevision) {
                this.Comparison(this.view.comparison as WorkbenchComparison)
              } else {
                this.Draft(this.currentOutput() as WorkbenchOutput)
                if (this.baselineRevision > 0) Text('正在核对所选版本的对照。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
              }
              this.Delivery(this.currentOutput() as WorkbenchOutput)
              PMButton({ label: this.showVersions ? '收起历史版本' : '历史版本', secondary: true,
                onAction: (): void => { this.showVersions = !this.showVersions; } })
              if (this.showVersions) {
                ForEach(this.view.outputs, (output: WorkbenchOutput) => {
                  PMButton({ label: `查看第 ${output.revision} 版 · ${workbenchTime(output.createdAt)}`, secondary: true,
                    onAction: (): void => { this.selectDraft(output); } })
                  if (output.revision < (this.currentOutput()?.revision ?? 0)) {
                    PMButton({ label: `与第 ${output.revision} 版对照`, secondary: true,
                      onAction: (): void => { const current = this.currentOutput(); if (current !== undefined) this.selectDraft(current, output.revision); } })
                  }
                }, (output: WorkbenchOutput) => output.id)
              }
            } else if (this.selectedRevision > 0 || this.currentStage() === undefined) {
              Text(this.selectedRevision > 0 ? '所选版本暂不可读。' : '正在等待第一份成果。')
            }
            if (this.currentStage() !== undefined) { this.StageArtifact(this.currentStage() as WorkbenchStageArtifact) }
            if (workbenchSource(this.view, this.sourceKey) !== undefined && this.fresh) { this.Source(workbenchSource(this.view, this.sourceKey) as WorkbenchSource) }
            if (this.view.challengesEnabled) {
              if (this.challengePending) { PMButton({ label: '重试原挑战请求', secondary: true, disabled: this.busy, onAction: (): void => { this.play(''); } }) }
              else if (this.challenge?.status !== 'ACTIVE') {
                PMButton({ label: '严格导师 · 三轮彩排', secondary: true, disabled: this.busy || !this.fresh || this.view.outputs.length === 0, onAction: (): void => { this.play('', 'REHEARSAL'); } })
                PMButton({ label: '证据侦探 · 引用追溯', secondary: true, disabled: this.busy || !this.fresh || this.view.outputs.length === 0, onAction: (): void => { this.play('', 'EVIDENCE'); } })
                PMButton({ label: '指标可比性', secondary: true, disabled: this.busy || !this.fresh || this.view.outputs.length === 0,
                  onAction: (): void => { this.play('', 'METRIC'); } })
              }
              PMButton({ label: this.showSprint ? '收起双人冲刺' : '双人冲刺', secondary: true, onAction: (): void => { this.showSprint = !this.showSprint; } })
              if (this.showSprint) {
                WorkbenchSprint({ missionId: this.missionId, sources: this.view.sources,
                  openRevision: (revision: number): void => {
                    this.selectedRevision = revision; this.baselineRevision = 0; this.delivery = null; this.sourceKey = ''; this.read();
                  },
                  openSource: (key: string): void => { this.sourceKey = key; }
                })
              }
              if (this.challenge !== null && this.challenge.status !== 'STOPPED') { this.Challenge(this.challenge) }
              if (this.challenge !== null) {
                PMButton({ label: '删除本轮回答及交回反馈', secondary: true, disabled: this.busy || this.challengePending,
                  onAction: (): void => { this.play('DELETE_ATTEMPT'); } })
              }
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
              Text('支持 TXT、Markdown、普通 CSV、DOCX 和 XLSX。确认后加入原委托。').fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
            Text('补充反馈').fontSize(18).fontWeight(FontWeight.Medium)
            TextArea({ text: this.material, placeholder: '记录待核对的反馈，原委托继续处理' }).height(110).maxLength(20000).enabled(!this.busy && !this.materialPending).onChange((text: string) => { this.material = text; })
            PMButton({ label: this.materialPending ? '重试原反馈' : '保存反馈到原项目', disabled: this.busy || this.challengePending || this.controlPending || this.material.trim() === '', onAction: (): void => { this.addMaterial(); } })
            PMButton({ label: '自然改道／继续讨论', secondary: true, onAction: (): void => { router.pushUrl({ url: 'pages/FocusConversation', params: { projectId: this.projectId, entityKind: 'MISSION', entityId: this.missionId } }); } })
            PMButton({ label: this.showProcess ? '收起过程' : '查看过程', secondary: true, onAction: (): void => { this.showProcess = !this.showProcess; } })
            if (this.showProcess) {
              ForEach(this.view.events.slice(0, 8), (event: WorkbenchEvent) => {
                Text(`${event.label} · ${workbenchTime(event.at)}`).fontSize(13).fontColor(PMColors.INK_TERTIARY)
              }, (event: WorkbenchEvent) => event.id)
            }
          }
        }.width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
