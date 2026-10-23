import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Mission, MissionSummary, MissionCreate, MissionEvent, MissionApproval, MissionCommand,
  MissionCandidate, MissionPointer, MissionMaterialInput, MissionMaterialPreview, MissionMaterialConfirm,
  MissionOutput, MissionBlock, MissionSource, MissionArtifactPreview, MissionArtifactInput, MissionArtifactConfirm,
  MissionConstraintsEdit, MissionScopeEdit, MissionPolicyEdit, MissionStep, MissionClaim, MissionCompletionFact } from '../models/Mission';
import { ApiError } from '../models/Project';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { WidgetDataService } from '../services/WidgetDataService';
import { missionStatusLabel, mergeMissionEvents, missionTerminal, missionToolLabel, missionCompletionFacts, missionErrorPhaseLabel } from '../common/MissionContract';
import { PMColors, PMSpacing, PMRadius, PMFontSize } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { PMStatusPill, PMButton } from '../components/PMReferencePrimitives';
import { MissionSettingsForm } from '../components/MissionSettingsForm';
import { MissionApprovalSheet } from '../components/MissionApprovalSheet';
import { MissionEventList } from '../components/MissionEventList';

interface MissionActionReceipt { actionId?: string; id?: string; title?: string; status?: string; resultCardId?: string | null; }

@Entry
@Component
struct MissionDetail {
  @State projectId: string = '';
  @State mission: Mission = new Mission();
  @State missions: MissionSummary[] = [];
  @State events: MissionEvent[] = [];
  @State candidates: MissionCandidate[] = [];
  @State selectedSources: string[] = [];
  @State preview: MissionMaterialPreview | null = null;
  @State adoption: MissionArtifactPreview | null = null;
  @State approval: MissionApproval | null = null;
  @State form: string = '';
  @State answer: string = '';
  @State busy: boolean = false;
  @State error: string = '';
  @State notice: string = '';
  @State updatedAt: string = '';
  @State missionUiEnabled: boolean = false;
  @State nextCursor: string = '';
  @State loaded: boolean = false;
  @State showExecution: boolean = false;
  @State showSettings: boolean = false;
  @State showOlderOutputs: boolean = false;
  @State showGoal: boolean = false;
  @StorageProp('missionAppActive') @Watch('appActivityChanged') appActive: boolean = true;
  private service: MissionService = new MissionService();
  private missionId: string = '';
  private createRequested: boolean = false;
  private directCreate: boolean = false;
  private afterSeq: number = 0;
  private timer: number = -1;
  private visible: boolean = false;
  private refreshing: boolean = false;
  private generation: number = 0;
  private stablePolls: number = 0;
  private reviewedVersion: number = 0;
  private editSnapshot: Mission = new Mission();
  private requestKeys: Record<string, string> = {};
  private errorCount: number = 0;
  private sessionExpired: () => void = () => {
    this.stop(); this.mission = new Mission(); this.missions = []; this.events = []; this.candidates = [];
    this.approval = null; this.adoption = null; this.preview = null; this.answer = ''; this.form = '';
    this.editSnapshot = new Mission(); this.requestKeys = {};
    if (this.visible) router.replaceUrl({ url: 'pages/LoginPage' });
  };

  aboutToAppear(): void {
    SessionStore.onSessionExpired(this.sessionExpired);
    const params = router.getParams() as Record<string, string>;
    this.projectId = params?.['projectId'] ?? '';
    this.missionId = params?.['missionId'] ?? '';
    this.createRequested = params?.['mode'] === 'create';
    this.directCreate = this.createRequested;
  }
  onPageShow(): void { this.visible = true; this.refresh(); }
  onPageHide(): void { this.visible = false; this.stop(); }
  aboutToDisappear(): void { this.visible = false; this.stop(); SessionStore.offSessionExpired(this.sessionExpired); }
  private appActivityChanged(): void { if (this.appActive && this.visible) this.refresh(); else this.stop(); }
  private stop(): void { this.generation++; if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1; }
  private current(generation: number, token: string): boolean {
    return this.visible && this.appActive && this.generation === generation && SessionStore.getToken() === token && SessionStore.isTokenValid();
  }
  private requestKey(body: Object): string {
    const fingerprint = JSON.stringify(body);
    if (this.requestKeys[fingerprint] === undefined) this.requestKeys[fingerprint] = `harmony-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return this.requestKeys[fingerprint];
  }
  private fail(e: Object): void {
    this.error = e instanceof ApiError ? e.message : '无法连接服务，请检查网络后刷新';
    if (e instanceof ApiError && e.status === 401) {
      this.stop(); this.mission = new Mission(); this.events = []; this.missions = []; this.approval = null; this.adoption = null;
      router.replaceUrl({ url: 'pages/LoginPage' });
    }
    if (e instanceof ApiError && e.status === 404) {
      this.stop(); this.missionUiEnabled = false; this.mission = new Mission(); this.events = []; this.missions = [];
      this.candidates = []; this.approval = null; this.adoption = null; this.preview = null; this.form = ''; this.answer = '';
      this.editSnapshot = new Mission();
    }
    if (e instanceof ApiError && e.status === 503) this.missionUiEnabled = false;
  }
  private async refresh(): Promise<void> {
    if (this.refreshing || !this.visible || !this.appActive || this.projectId === '') return;
    if (this.timer !== -1) clearTimeout(this.timer);
    this.timer = -1; this.refreshing = true;
    const generation = this.generation; const token = SessionStore.getToken(); const id = this.missionId;
    try {
      const capability = await this.service.capabilities(this.projectId);
      if (!this.current(generation, token)) return;
      this.missionUiEnabled = capability.enabled;
      if (this.createRequested) {
        this.createRequested = false;
        if (capability.enabled) { this.editSnapshot = new Mission(); this.form = 'create'; }
        else this.error = '当前项目暂未开启长期委托，请稍后重试';
      }
      if (id === '') {
        const page = await this.service.list(this.projectId);
        if (!this.current(generation, token)) return;
        this.missions = page.missions; this.nextCursor = page.nextCursor ?? '';
      } else {
        const detail = await this.service.detail(id);
        if (!this.current(generation, token)) return;
        if (detail.projectId !== this.projectId) throw new ApiError('MISSION_NOT_FOUND', '委托不属于当前项目', 404);
        const batch = await this.service.events(id, this.afterSeq);
        if (!this.current(generation, token)) return;
        this.stablePolls = detail.version === this.mission.version ? this.stablePolls + 1 : 0;
        if (this.mission.question?.id !== detail.question?.id) { this.answer = ''; this.selectedSources = []; this.preview = null; }
        if (this.mission.version !== detail.version) { this.preview = null; this.approval = null; this.adoption = null; }
        this.mission = detail; this.events = mergeMissionEvents(this.events, batch.events); this.afterSeq = batch.nextAfterSeq;
        if (capability.widgetEnabled) await WidgetDataService.updateMission(getContext(this), detail, SessionStore.getUser().id, SessionStore.getExpiresAt());
        else await WidgetDataService.clearMission(getContext(this));
        if (detail.status === 'WAITING_INPUT') {
          const material = await this.service.candidates(id);
          if (!this.current(generation, token)) return;
          this.candidates = material.candidates;
        } else this.candidates = [];
      }
      this.updatedAt = new Date().toLocaleString('zh-CN'); this.loaded = true; this.errorCount = 0;
    } catch (e) {
      if (generation === this.generation && (token === SessionStore.getToken() || e instanceof ApiError && e.status === 401)) { this.errorCount++; this.fail(e); }
    } finally {
      this.refreshing = false;
      // 单次拉取完成后才安排下一次；隐藏/后台、失效登录和连续错误不继续轮询。
      if (this.visible && this.appActive && this.missionId !== '' && this.missionUiEnabled && SessionStore.isTokenValid() && this.errorCount < 3) {
        this.timer = setTimeout(() => { this.refresh(); }, this.stablePolls < 2 ? 1500 : 5000);
      }
    }
  }
  private openMission(id: string): void {
    this.stop(); this.missionId = id; this.mission = new Mission(); this.events = []; this.afterSeq = 0;
    this.candidates = []; this.preview = null; this.adoption = null; this.approval = null; this.form = '';
    this.answer = ''; this.error = ''; this.notice = ''; this.stablePolls = 0;
    this.showGoal = false; this.showExecution = false; this.showSettings = false; this.showOlderOutputs = false;
    this.refresh();
  }
  private async more(): Promise<void> {
    if (this.busy || this.nextCursor === '') return; this.busy = true;
    const generation = this.generation; const token = SessionStore.getToken();
    try { const page = await this.service.list(this.projectId, this.nextCursor); if (!this.current(generation, token)) return;
      this.missions = this.missions.concat(page.missions); this.nextCursor = page.nextCursor ?? ''; }
    catch (e) { this.fail(e); } finally { this.busy = false; }
  }
  private async saveForm(value: MissionCreate): Promise<void> {
    if (this.busy) return; this.busy = true; this.error = '';
    try {
      if (this.form === 'create') {
        value.projectId = this.projectId; value.requestId = this.requestKey(value);
        const response = await this.service.create(value);
        this.openMission(response.mission.id); this.notice = '委托已受理，等待服务端执行';
      } else if (this.form === 'constraints') {
        const body = new MissionConstraintsEdit(); body.expectedVersion = this.editSnapshot.version;
        body.expectedConstraintsVersion = this.editSnapshot.constraintsVersion;
        body.constraints = value.missionConstraints; body.llmContextApproved = value.llmContextApproved;
        body.requestId = this.requestKey(body); await this.service.constraints(this.missionId, body); this.form = ''; this.notice = '约束已保存；旧的未执行计划将重新评估';
      } else {
        const body = new MissionScopeEdit(); body.expectedVersion = this.editSnapshot.version;
        body.expectedScopeVersion = this.editSnapshot.researchScopeVersion; body.scope = value.researchScope;
        body.requestId = this.requestKey(body); await this.service.scope(this.missionId, body); this.form = ''; this.notice = '研究授权已更新';
      }
    } catch (e) { this.fail(e); }
    finally { this.busy = false; this.refresh(); }
  }
  private async command(action: string, decision: string = ''): Promise<void> {
    if (this.busy) return;
    const body = new MissionCommand(); body.expectedVersion = this.mission.version;
    const approval = this.approval;
    if (action === 'input') { body.questionId = this.mission.question?.id; body.answer = this.answer.trim(); if (!body.answer) return; }
    if (action === 'approval') {
      if (approval === null) return; body.expectedVersion = this.reviewedVersion;
      body.proposalHash = approval.proposalHash; body.decision = decision;
    }
    body.requestId = this.requestKey(`${action}:${JSON.stringify(body)}`); this.busy = true; this.error = '';
    try {
      await this.service.command(this.missionId, action, body, action === 'approval' ? approval?.id ?? '' : '');
      this.approval = null; this.notice = '请求已受理，请查看服务端状态与执行回执';
    } catch (e) { this.fail(e); this.approval = null; }
    finally { this.busy = false; this.refresh(); }
  }
  private async cancel(): Promise<void> {
    const result = await promptAction.showDialog({ title: '取消长期委托', message: '停止后续执行，保留已有成果与审批历史。', buttons: [{ text: '返回', color: '#64748B' }, { text: '确认取消', color: '#B91C1C' }] });
    if (result.index === 1) this.command('cancel');
  }
  private async policy(): Promise<void> {
    if (this.busy) return;
    const body = new MissionPolicyEdit(); body.expectedVersion = this.mission.version;
    body.policy.mode = this.mission.continuationPolicy.mode === 'MANUAL' ? 'LOW_RISK_READ_ANALYZE' : 'MANUAL';
    if (body.policy.mode !== 'MANUAL') {
      const result = await promptAction.showDialog({ title: '允许低风险自动接续', message: '仅在新资料满足原缺口、预算及授权仍有效时继续读取与分析；新增业务写入仍需批准。', buttons: [{ text: '返回', color: '#64748B' }, { text: '允许', color: '#1D4ED8' }] });
      if (result.index !== 1) return;
    }
    body.requestId = this.requestKey(body); this.busy = true;
    try { await this.service.policy(this.missionId, body); this.notice = '接续许可已保存'; }
    catch (e) { this.fail(e); } finally { this.busy = false; this.refresh(); }
  }
  private async previewMaterials(): Promise<void> {
    if (this.busy || !this.mission.question) return;
    const body = new MissionMaterialInput(); body.questionId = this.mission.question.id;
    body.sourcePointers = this.candidates.filter((c: MissionCandidate) => this.selectedSources.includes(c.sourcePointer.id)).map((c: MissionCandidate) => c.sourcePointer);
    if (!body.sourcePointers.length) return; this.busy = true;
    const generation = this.generation; const token = SessionStore.getToken();
    try { const preview = await this.service.previewMaterial(this.missionId, body); if (this.current(generation, token)) this.preview = preview; }
    catch (e) { this.fail(e); } finally { this.busy = false; }
  }
  private async continueMaterials(): Promise<void> {
    const preview = this.preview;
    if (this.busy || preview === null || this.answer.trim() === '') return;
    const body = new MissionMaterialConfirm(); body.questionId = preview.questionId; body.sourcePointers = preview.sourcePointers;
    body.expectedVersion = preview.version; body.expectedContextVersion = preview.contextVersion;
    body.assessmentHash = preview.assessmentHash; body.answer = this.answer.trim(); body.requestId = this.requestKey(body); this.busy = true;
    try {
      const result = await this.service.confirmMaterial(this.missionId, body);
      this.notice = result.continued ? '资料已绑定，同一委托可以继续；后续执行仍待服务端处理' : `仍需等待：${this.holdReason(result.reason ?? '')}`;
      this.preview = null;
    } catch (e) { this.fail(e); this.preview = null; } finally { this.busy = false; this.refresh(); }
  }
  private holdReason(reason: string): string {
    const labels: Record<string, string> = { 'SUFFICIENT': '信息缺口已满足', 'INSUFFICIENT': '资料尚不足', 'CONFLICT': '资料存在冲突', 'UNKNOWN': '充分性需要人工核对',
      'LLM_CONTEXT_NOT_APPROVED': '尚未批准模型使用任务上下文', 'BUDGET_EXHAUSTED': '执行预算已耗尽' };
    return labels[reason] ?? '请核对资料与授权';
  }
  private async previewOutput(output: MissionOutput): Promise<void> {
    if (this.busy) return; this.busy = true;
    const generation = this.generation; const token = SessionStore.getToken();
    const body = new MissionArtifactInput(); body.expectedOutputRevision = output.revision;
    try { const preview = await this.service.previewArtifact(this.missionId, output.id, body); if (this.current(generation, token)) this.adoption = preview.receipt; }
    catch (e) { this.fail(e); } finally { this.busy = false; }
  }
  private async adopt(): Promise<void> {
    const preview = this.adoption; if (this.busy || preview === null) return;
    const body = new MissionArtifactConfirm(); body.expectedOutputRevision = preview.outputRevision;
    body.expectedContextVersion = preview.contextVersion; body.previewHash = preview.previewHash; body.requestId = this.requestKey(body); this.busy = true;
    try {
      const result = await this.service.confirmArtifact(this.missionId, preview.outputId, body);
      this.notice = `已归入项目周报，成果版本 ${result.receipt.artifactId}；可从项目成果查看`;
      this.adoption = null;
    } catch (e) { this.fail(e); } finally { this.busy = false; this.refresh(); }
  }
  private openForm(mode: string): void { this.editSnapshot = this.mission; this.form = mode; }
  private actionReceipt(step: MissionStep): string {
    const data = step.result?.data as MissionActionReceipt | undefined;
    return data?.actionId ? `行动：${data.title ?? data.actionId} · ${data.status === 'DONE' ? '已完成' : data.status === 'DOING' ? '进行中' : data.status === 'CANCELLED' ? '已取消' : '待办'}${data.resultCardId ? ' · 已有结果复盘' : ''}` : '';
  }
  private knowledge(kind: string): string { return kind === 'EXTERNAL_REFERENCE' || kind === 'EXTERNAL' ? '外部参考，未验证为项目事实' : kind === 'MIXED' ? '混合来源，包含未核验的外部参考' : kind === 'INFERENCE' ? '分析推断，待核验' : '项目来源，结论仍需核验'; }
  private claimStatus(status: string): string {
    const labels: Record<string, string> = { 'ENTAILS': '来源支持', 'CONTRADICTS': '来源冲突', 'NOT_ENOUGH_INFORMATION': '证据不足', 'NOT_CHECKED': '尚未核验' };
    return labels[status] ?? '尚未核验';
  }
  @Builder private WaitingInput() {
    Column({ space: 10 }) {
      Text(this.mission.question?.payloadJson.question ?? '请补充资料').fontSize(18)
      Button('返回项目补充记录或附件').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.projectId } }); })
      TextArea({ placeholder: '回答当前问题，或说明所选资料如何满足缺口', text: this.answer }).height(100).maxLength(3000).onChange((v: string) => { this.answer = v; })
      Button('提交答复').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy && this.answer.trim() !== '').onClick(() => { this.command('input'); })
      Text('新资料候选：到达不代表相关，也不代表足以继续').fontSize(14)
      ForEach(this.candidates, (candidate: MissionCandidate) => {
        Column({ space: 4 }) {
          Text(candidate.excerpt)
          Text(`资料时间：${candidate.observedAt}`).fontSize(12)
          Button(this.selectedSources.includes(candidate.sourcePointer.id) ? '取消选择' : '选择此资料').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
            .enabled(!this.busy).onClick(() => {
            this.selectedSources = this.selectedSources.includes(candidate.sourcePointer.id) ? this.selectedSources.filter((id: string) => id !== candidate.sourcePointer.id) : this.selectedSources.concat([candidate.sourcePointer.id]);
            this.preview = null;
          })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }, (candidate: MissionCandidate) => candidate.sourcePointer.id)
      Button('评估所选资料').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy && this.selectedSources.length > 0 && this.selectedSources.length <= 8).onClick(() => { this.previewMaterials(); })
      if (this.preview !== null) {
        Text(`关联：${this.preview.relevance === 'RELATED' ? '可能相关' : '尚不明确'}；${this.holdReason(this.preview.assessment)}`)
        Text(`剩余缺口：${this.preview.remaining.join('、') || '字段检查未发现缺项；资料含义仍待核验'}`)
        Text('确认表示你已核对资料与当前问题，任务是否继续由服务端检查授权和预算。').fontSize(13)
        Button('确认资料并接续').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy && this.answer.trim() !== '').onClick(() => { this.continueMaterials(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private MissionBody() {
    Column({ space: 12 }) {
      Row() {
        PMStatusPill({ label: missionStatusLabel(this.mission.status), tone: this.mission.status === 'PAUSED' || this.mission.status === 'FAILED' ? 'risk' : 'brand' })
        Blank()
        Text('执行记录').fontSize(12).fontColor(PMColors.INK_TERTIARY)
      }.width('100%')
      Text(this.mission.goal).fontSize(21).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        .maxLines(this.showGoal ? 100 : 2).textOverflow({ overflow: TextOverflow.Ellipsis }).lineHeight(29)
      if (this.mission.goal.length > 40) {
        Button(this.showGoal ? '收起目标原文' : '展开目标原文').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
          .height(44).onClick(() => { this.showGoal = !this.showGoal; })
      }
      Column({ space: 8 }) {
        ForEach(missionCompletionFacts(this.mission.status, this.mission.completion, this.mission.outputs[0]?.verificationStatus), (fact: MissionCompletionFact) => {
          Row({ space: 12 }) {
            Text(fact.label).fontSize(12).fontColor(PMColors.INK_TERTIARY).width(64)
            Text(fact.value).fontSize(13).fontColor(PMColors.INK_SECONDARY).lineHeight(20).layoutWeight(1)
          }.width('100%').alignItems(VerticalAlign.Top)
        }, (fact: MissionCompletionFact) => fact.label)
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 10, bottom: 10 })
        .border({ width: { top: 1, bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      if (this.mission.error !== null || this.mission.status === 'PAUSED' || this.mission.status === 'FAILED') {
        Column({ space: PMSpacing.SM }) {
          Text('当前状态').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          Text(this.mission.status === 'PAUSED' ? '委托已暂停' : this.mission.status === 'FAILED' ? '委托执行失败' : '本次执行需要恢复')
            .fontSize(PMFontSize.SECTION_TITLE).fontWeight(FontWeight.Medium).fontColor(PMColors.RISK)
          Text(this.mission.error?.message ?? this.mission.pauseReason ?? '服务端未提供具体原因，请查看执行回执。')
            .fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
          if (this.mission.error?.code) {
            Text(`错误类别：${this.mission.error!.code}`)
              .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          if (this.mission.error?.phase) {
            Text(`发生阶段：${missionErrorPhaseLabel(this.mission.error!.phase)}`)
              .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          Column({ space: 5 }) {
            Text('建议的恢复步骤').fontSize(11).fontColor(PMColors.INK_TERTIARY)
            Text(this.mission.error?.recovery?.message ?? (this.mission.status === 'PAUSED' ? '检查服务配置及执行回执，再继续原委托。' : this.mission.status === 'FAILED' ? '核对执行回执后，返回列表重新委托。' : '请读取最新状态，服务端会保留此前进度。'))
              .fontSize(13).fontColor(PMColors.INK_PRIMARY).lineHeight(20)
            if (this.mission.error?.recovery?.automatic) { Text('由服务端按限次策略处理').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.WARNING_LIGHT).borderRadius(12)
        }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      }
      if (this.mission.status === 'RUNNING' && (this.mission.cancelRequestedAt || this.mission.pauseRequestedAt)) { Text(this.mission.cancelRequestedAt ? '取消请求已受理，等待当前步骤停止' : '暂停请求已受理，等待当前步骤停止').fontColor(PMColors.WARNING) }
      if (this.mission.status === 'PAUSED' && this.missionUiEnabled) { Button('继续原委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy).onClick(() => { this.command('resume'); }) }
      Button(this.showSettings ? '收起委托设置与控制' : '委托设置与控制').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
        .onClick(() => { this.showSettings = !this.showSettings; })
      if (this.showSettings && !missionTerminal(this.mission.status) && this.missionUiEnabled) {
        if (['READY', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(this.mission.status)) { Button('暂停委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.command('pause'); }) }
        Button('取消委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.cancel(); })
        Button('查看与修改个人约束').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.openForm('constraints'); })
        Button('查看与修改公开研究范围').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.openForm('scope'); })
        if (this.mission.autoContinuationEnabled || this.mission.continuationPolicy.mode !== 'MANUAL') {
          Text(`接续许可：${this.mission.continuationPolicy.mode === 'MANUAL' ? '每次确认' : '满足条件后自动读取与分析'}`)
          Button(this.mission.continuationPolicy.mode === 'MANUAL' ? '允许低风险自动接续' : '撤销自动接续许可').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
            .enabled(!this.busy).onClick(() => { this.policy(); })
        }
      }
      if (this.mission.status === 'WAITING_INPUT' && this.missionUiEnabled) { this.WaitingInput() }
      ForEach(this.mission.approvals, (approval: MissionApproval) => {
        Button(`审阅提案：${approval.proposal.args.title}`).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
          .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
          .enabled(!this.busy && this.missionUiEnabled).onClick(() => {
          this.approval = approval; this.reviewedVersion = this.mission.version;
        })
      }, (approval: MissionApproval) => approval.id)
      if (this.mission.status === 'WAITING_APPROVAL') { Button('提案已失效？重新评估').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy && this.missionUiEnabled).onClick(() => { this.command('replan'); }) }
      Text('执行时间线').fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).margin({ top: 8 })
      ForEach(this.mission.steps.filter((step: MissionStep) => step.status === 'SUCCEEDED').slice(-2), (step: MissionStep) => {
        Row({ space: 10 }) {
          Circle({ width: 10, height: 10 }).fill(PMColors.BRAND)
          Text(`${missionToolLabel(step.toolName)}已执行`).fontSize(13).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
        }.width('100%').padding(14).backgroundColor(PMColors.SURFACE).borderRadius(12)
      }, (step: MissionStep) => step.id)
      if (this.mission.outputs.length > 0) { Text(`草稿修订 ${this.mission.outputs[0].revision} 已保存，内容待审阅`).fontSize(14).fontColor(PMColors.INK_SECONDARY) }
      Button(this.showExecution ? '收起执行详情与回执' : '查看执行详情与回执').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
        .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
        .onClick(() => { this.showExecution = !this.showExecution; })
      if (this.showExecution) {
      Text(`上下文 ${this.mission.contextVersion} · 计划 ${this.mission.planRevision}`).fontSize(13)
      Text('执行步骤与回执').fontSize(18)
      ForEach(this.mission.steps, (step: MissionStep) => {
        Column({ space: 6 }) {
          Text(`${step.ordinal} · ${missionToolLabel(step.toolName)} · ${step.status === 'SUCCEEDED' ? '工具已执行' : missionStatusLabel(step.status)}`)
          if (this.actionReceipt(step) !== '') { Text(this.actionReceipt(step)) }
          ForEach(step.result?.sources ?? [], (source: MissionSource) => {
            Text(`${this.knowledge(source.knowledgeClass ?? source.kind)} · ${source.id}\n${source.text ?? ''}`).fontSize(13)
          }, (source: MissionSource) => source.id)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }, (step: MissionStep) => step.id)
      }
      Text(this.mission.outputs.length > 0 ? '草稿与来源' : '尚无已保存的成果草稿').fontSize(this.mission.outputs.length > 0 ? 16 : 12).fontColor(PMColors.INK_SECONDARY)
      if (this.mission.outputs.length > 1) { Button(this.showOlderOutputs ? '收起历史草稿' : `查看其余 ${this.mission.outputs.length - 1} 份草稿`).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).constraintSize({ minHeight: 48 }).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD).onClick(() => { this.showOlderOutputs = !this.showOlderOutputs; }) }
      ForEach(this.showOlderOutputs ? this.mission.outputs : this.mission.outputs.slice(0, 1), (output: MissionOutput) => {
        Column({ space: 8 }) {
          Text(`草稿修订 ${output.revision} · 待审阅`)
          ForEach(output.contentJson.blocks, (block: MissionBlock) => {
            Text(`${this.knowledge(block.kind)}\n${block.text}\n来源：${block.sourceIds.join('、') || '未引用'}`)
          }, (block: MissionBlock) => block.blockId)
          ForEach(output.claimChecksJson ?? [], (claim: MissionClaim) => {
            Text(`${this.claimStatus(claim.status)}：${claim.text ?? '该段内容尚未逐句核验'}`).fontSize(13)
          }, (claim: MissionClaim, index: number) => claim.claimId ?? `${claim.blockId}-${index}`)
          if (this.mission.artifactAdoptionEnabled) { Button('预览归入项目周报').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.previewOutput(output); }) }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }, (output: MissionOutput) => output.id)
      if (this.showExecution) { MissionEventList({ events: this.events }) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  build() {
    Column() {
      PMAppBar({ title: this.form === 'create' ? '新建长期委托' : '长期委托', backLabel: '项目', rightActionText: '刷新', onRightTextAction: () => { this.error = ''; this.errorCount = 0; this.refresh(); } })
      Scroll() {
        Column({ space: 14 }) {
          if (this.projectId === '') { Text('缺少项目参数，请返回项目后重新进入') }
          if (this.error !== '') { Text(this.error).fontColor(PMColors.RISK) }
          if (this.notice !== '') { Text(this.notice).fontColor(PMColors.BRAND) }
          if (this.busy) { Text('正在提交，请等待服务端回执') }
          if (this.form !== '') {
            MissionSettingsForm({ mode: this.form, initialConstraints: this.editSnapshot.constraints, initialScope: this.editSnapshot.researchScope, busy: this.busy,
              onSubmit: (value: MissionCreate) => { this.saveForm(value); }, onClose: () => { if (this.form === 'create' && this.directCreate) router.back(); else this.form = ''; } })
          } else if (this.approval !== null) {
            MissionApprovalSheet({ approval: this.approval, busy: this.busy, onDecide: (decision: string) => { this.command('approval', decision); }, onClose: () => { this.approval = null; } })
          } else if (this.adoption !== null) {
            Text(`归入固定修订 ${this.adoption.outputRevision}`).fontSize(20)
            Text(this.adoption.content)
            Text(`可见范围：${this.adoption.visibility}`)
            Text('核验状态：待审阅；来源支持不代表现实结果已证实')
            ForEach(this.adoption.verification.claims, (claim: MissionClaim) => {
              Text(`${this.claimStatus(claim.status)}：${claim.text ?? '该段尚未逐句核验'}`).fontSize(13)
            }, (claim: MissionClaim, index: number) => claim.claimId ?? `${claim.blockId}-${index}`)
            ForEach(this.adoption.sourceManifest, (source: MissionSource) => {
              Text(`${this.knowledge(source.knowledgeClass ?? source.kind)} · ${source.id}\n${(source.excerpts ?? []).join('\n')}`).fontSize(13)
            }, (source: MissionSource) => source.id)
            Text('归入后可由后续任务检索。确认归入不表示所有结论已证实，项目事实仍按原确认流程管理。')
            Button('确认归入项目成果').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.adopt(); })
            Button('返回任务').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.adoption = null; })
          } else if (this.mission.id !== '') {
            this.MissionBody()
            Button('返回委托列表').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.openMission(''); })
          } else {
            if (this.missionUiEnabled) { PMButton({ label: '＋ 新建长期委托', disabled: this.busy, onAction: (): void => { this.editSnapshot = new Mission(); this.form = 'create'; } }) }
            if (this.loaded && this.missions.length === 0) { Text('还没有长期委托') }
            ForEach(this.missions, (mission: MissionSummary) => {
              Column({ space: PMSpacing.SM }) {
                Text(missionStatusLabel(mission.status))
                  .fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND)
                Text(mission.goal)
                  .fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                Button('查看委托详情').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
                  .height(44).width('100%').fontColor(PMColors.BRAND)
                  .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
                  .onClick(() => { this.openMission(mission.id); })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
                .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
                .border({ width: 1, color: PMColors.BORDER })
            }, (mission: MissionSummary) => mission.id)
            if (this.nextCursor !== '') { Button('加载更多委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.more(); }) }
          }
        }.width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
          .justifyContent(FlexAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
