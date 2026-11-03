import { workPhaseLabel } from '../common/GlobalFocusPresentation';
import { MissionBudgetReview } from "../models/Mission";
import { MissionMetricReceipt } from '../components/MissionMetricReceipt';
import { MissionInvestigationDelegation } from "../components/MissionInvestigationDelegation";
import { EvidenceReview, FitGroup, FitExcerpt } from '../models/EvidenceFit';
import { MissionEvidenceReview } from '../components/MissionEvidenceReview';
import { DecisionScenarioPanel } from '../components/DecisionScenarioPanel';
import { ExperiencePanel } from '../components/ExperiencePanel';
import { GoalQuestionPanel } from '../components/GoalQuestionPanel';
import { ProjectImpactPanel } from '../components/ProjectImpactPanel';
import { MissionReadTarget } from '../models/MissionReadback';
import { MissionReadbackView } from '../components/MissionReadbackView';
import { WorkPacketActionView } from '../models/WorkPacket';
import { failedReadState } from '../common/ReadState';
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
import { MissionProgressPresentation } from '../common/MissionProgressPresentation';
import { PMColors, PMSpacing, PMRadius, PMFontSize } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { PMStatusPill, PMButton } from '../components/PMReferencePrimitives';
import { MissionSettingsForm } from '../components/MissionSettingsForm';
import { MissionApprovalSheet } from '../components/MissionApprovalSheet';
import { MissionEventList } from '../components/MissionEventList';
import { MissionResponsibilitySection } from '../components/MissionResponsibilitySection';

interface MissionActionReceipt { actionId?: string; id?: string; title?: string; status?: string; resultCardId?: string | null; }

@Entry
@Component
struct MissionDetail {
  @State projectId: string = '';
  @State private focusConversationId: string = '';
  @State mission: Mission = new Mission();
  @State missions: MissionSummary[] = [];
  @State events: MissionEvent[] = [];
  @State candidates: MissionCandidate[] = [];
  @State showMaterials: boolean = false;
  @State materialsReviewed: boolean = false;
  @State premiseReviewed: boolean = false;
  @State evidenceMode: string = 'CONDITIONAL_ANALYSIS';
  @State showCompletion: boolean = false;
  @State showFitDetails: boolean = false;
  @State readbackRefreshKey: number = 0;
  private returnedSourceId: string = '';
  private returnedQuestionId: string = '';
  private handledReturn: string = '';
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
  @State readState: string = 'unavailable';
  private readTarget: MissionReadTarget = new MissionReadTarget();
  @State showExecution: boolean = false;
  @State showBudgetDetail: boolean = false;
  @State detailView: string = 'overview';
  @State expandedStepId: string = '';
  @State showRawStep: string = '';
  @State showAllSteps: boolean = false;
  @State showAllEvents: boolean = false;
  @State showSettings: boolean = false;
  @State showOlderOutputs: boolean = false;
  @State showGoal: boolean = false;
  @StorageProp('missionAppActive') @Watch('appActivityChanged') appActive: boolean = true;
  private service: MissionService = new MissionService();
  private missionId: string = '';
  private createRequested: boolean = false;
  private directCreate: boolean = false;
  // 卡片/通知带来的历史定位线索：只提示不授权，当前对象仍以服务端读回为准。
  private handoffVersion: string = '';
  private handoffExpired: boolean = false;
  private handoffNoticeShown: boolean = false;
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
    this.stop(); this.loaded = false; this.readState = 'unavailable'; this.mission = new Mission(); this.missions = []; this.events = []; this.candidates = [];
    this.approval = null; this.adoption = null; this.preview = null; this.answer = ''; this.form = '';
    this.editSnapshot = new Mission(); this.requestKeys = {};
    if (this.visible) router.replaceUrl({ url: 'pages/LoginPage' });
  };

  aboutToAppear(): void {
    SessionStore.onSessionExpired(this.sessionExpired);
    const params = router.getParams() as Record<string, string>;
    this.projectId = params?.['projectId'] ?? '';
    this.focusConversationId = params?.['conversationId'] ?? '';
    this.missionId = params?.['missionId'] ?? '';
    this.readTarget.questionId = params?.['questionId'] ?? ''; this.readTarget.approvalId = params?.['approvalId'] ?? '';
    this.readTarget.outputId = params?.['outputId'] ?? ''; this.readTarget.revision = params?.['revision'] ?? ''; this.readTarget.receiptId = params?.['receiptId'] ?? ''; this.readTarget.sourceId = params?.['sourceId'] ?? '';
    this.createRequested = params?.['mode'] === 'create';
    this.directCreate = this.createRequested;
    this.handoffVersion = params?.['handoffMissionVersion'] ?? '';
    this.handoffExpired = params?.['handoffExpired'] === '1';
  }
  onPageShow(): void {
    this.visible = true;
    const params = router.getParams() as Record<string, string>;
    if (params?.['missionId'] === this.missionId && params?.['projectId'] === this.projectId && params?.['sourceId']) {
      this.returnedSourceId = params['sourceId']; this.returnedQuestionId = params['questionId'] ?? '';
      const target = new MissionReadTarget(); target.questionId = this.returnedQuestionId; target.sourceId = this.returnedSourceId;
      this.readTarget = target;
    }
    this.readbackRefreshKey++; this.refresh();
  }
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
    this.readState = failedReadState(this.loaded, e instanceof ApiError ? e.status : 0);
    this.error = e instanceof ApiError ? e.message : '无法连接服务，请检查网络后刷新';
    if (e instanceof ApiError && e.status === 401) {
      this.stop(); this.mission = new Mission(); this.events = []; this.missions = []; this.approval = null; this.adoption = null;
      router.replaceUrl({ url: 'pages/LoginPage' });
    }
    if (e instanceof ApiError && [403, 404].includes(e.status)) {
      this.stop(); this.missionUiEnabled = false; this.mission = new Mission(); this.events = []; this.missions = [];
      this.candidates = []; this.approval = null; this.adoption = null; this.preview = null; this.form = ''; this.answer = '';
      this.editSnapshot = new Mission();
      // 明确失去项目/委托权限时同时清掉系统卡片上的私有快照，旧内容不能继续可操作。
      WidgetDataService.clearMission(getContext(this), true).catch(() => {});
    }

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
        if (this.mission.evidencePremise?.premiseHash !== detail.evidencePremise?.premiseHash) { this.premiseReviewed = false; this.preview = null; }
        if (this.mission.question?.id !== detail.question?.id) { this.answer = ''; this.selectedSources = []; this.preview = null; }
        if (this.mission.version !== detail.version) { this.preview = null; this.approval = null; this.adoption = null; }
        this.mission = detail; this.events = mergeMissionEvents(this.events, batch.events); this.afterSeq = batch.nextAfterSeq;
        if (!this.handoffNoticeShown) {
          if (this.handoffExpired) {
            // 过期卡片的旧问题/提案不会作为执行入口：清空定位目标，回到当前委托重新核对。
            this.handoffNoticeShown = true;
            this.readTarget = new MissionReadTarget();
            this.notice = '原卡片已过期，已回到当前委托；旧问题/提案需重新核对，不会被自动选中或批准。';
          } else if (this.handoffVersion !== '') {
            const recorded = Number(this.handoffVersion);
            if (!Number.isNaN(recorded) && detail.version > recorded) {
              this.handoffNoticeShown = true;
              this.notice = `卡片记录的是 v${this.handoffVersion}，当前已是 v${detail.version}：已按当前对象重新核对，不会自动选中或批准旧提案。`;
            }
          }
        }
        if (capability.widgetEnabled) await WidgetDataService.updateMission(getContext(this), detail, SessionStore.getUser().id, SessionStore.getExpiresAt());
        else await WidgetDataService.clearMission(getContext(this));
        if (detail.status === 'WAITING_INPUT') {
          const matchingReturn = this.returnedQuestionId === detail.question?.id ? this.returnedSourceId : '';
          const material = await this.service.candidates(id, this.showMaterials || matchingReturn !== '' ? detail.question?.id ?? '' : '', matchingReturn, this.showMaterials);
          if (!this.current(generation, token)) return;
          if (this.preview !== null && !this.preview.sourcePointers.every((p: MissionPointer) => material.candidates.some((c: MissionCandidate) => c.readable && c.sourcePointer.id === p.id && c.sourcePointer.hash === p.hash))) {
            this.preview = null; this.materialsReviewed = false; this.notice = '所选资料已变化，请重新评估；答复仍保留';
          }
          this.candidates = material.candidates;
          const returned = material.candidates.find((c: MissionCandidate) => c.sourcePointer.id === matchingReturn);
          if (returned !== undefined) this.showMaterials = true;
          const returnKey = `${this.returnedQuestionId}:${this.returnedSourceId}`;
          if (returned?.readable && this.handledReturn !== returnKey) {
            this.handledReturn = returnKey; this.showMaterials = true;
            this.selectedSources = [returned.sourcePointer.id];
            if (this.answer === '') this.answer = `请根据这份原记录重新判断，保留未核对的内容：${returned.excerpt}`;
          }
        } else this.candidates = [];
        if (this.returnedSourceId !== '' && this.returnedQuestionId !== detail.question?.id) this.notice = '返回链接中的原问题已变化。资料仍保留；下方可读历史问题，不会自动提交给新问题。';
      }
      this.updatedAt = new Date().toLocaleString('zh-CN'); this.loaded = true; this.readState = 'fresh'; this.error = ''; this.errorCount = 0;
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
    this.readState = 'unavailable'; this.loaded = false; this.readTarget = new MissionReadTarget();
    this.stop(); this.missionId = id; this.mission = new Mission(); this.events = []; this.afterSeq = 0;
    this.candidates = []; this.preview = null; this.adoption = null; this.approval = null; this.form = '';
    this.answer = ''; this.error = ''; this.notice = ''; this.stablePolls = 0;
    this.handoffVersion = ''; this.handoffExpired = false; this.handoffNoticeShown = false;
    this.showGoal = false; this.showExecution = false; this.showSettings = false; this.showOlderOutputs = false; this.detailView = 'overview';
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
    if (this.busy || this.readState !== 'fresh') return; this.busy = true; this.error = '';
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
  private evidenceReview(): EvidenceReview | undefined {
    const premise = this.mission.evidencePremise;
    if (!premise || !this.premiseReviewed || this.answer.trim() === '') return undefined;
    const review = new EvidenceReview(); review.mode = this.evidenceMode; review.note = this.answer.trim().substring(0, 1000); review.premiseHash = premise.premiseHash;
    return review;
  }
  private async reviewBudget():Promise<void> {
    if(this.busy||this.readState!=='fresh')return;
    const body=new MissionBudgetReview();body.expectedVersion=this.mission.version;
    body.totals.metadataRequests=Math.min(960,(this.mission.budget.metadataRequests??24)+24);
    body.totals.browserRequests=Math.min(1000,(this.mission.budget.browserRequests??40)+40);body.totals.browserBytes=Math.min(64000000,(this.mission.budget.browserBytes??4000000)+4000000);
    body.totals.calendarRequests=Math.min(128,(this.mission.budget.calendarRequests??8)+16);body.totals.externalWrites=Math.min(32,(this.mission.budget.externalWrites??2)+10);
    body.totals.models=Math.min(240,this.mission.budget.models+6);body.totals.tools=Math.min(640,this.mission.budget.tools+8);
    body.totals.activeMs=Math.min(86400000,this.mission.budget.activeMs+180000);body.totals.reservedOutputTokens=Math.min(480000,this.mission.budget.reservedOutputTokens+12000);
    body.requestId=this.requestKey(body);this.busy=true;
    try{await this.service.budgetReview(this.missionId,body);this.notice='累计预算已复核，已用与UNKNOWN预占保留；委托保持暂停';}
    catch(e){this.error=(e as Error).message;}finally{this.busy=false;await this.refresh();}
  }
  private async command(action: string, decision: string = ''): Promise<void> {
    if (this.busy || this.readState !== 'fresh') return;
    const body = new MissionCommand(); body.expectedVersion = this.mission.version;
    const approval = this.approval;
    if (action === 'input') { body.questionId = this.mission.question?.id; body.answer = this.answer.trim(); if (!body.answer) return; body.evidenceReview = this.evidenceReview(); if (this.mission.evidencePremise && (!body.evidenceReview || this.evidenceMode !== 'CONDITIONAL_ANALYSIS')) return; }
    if (action === 'approval') {
      if (approval === null) return; body.expectedVersion = this.reviewedVersion;
      body.proposalHash = approval.proposalHash; body.decision = decision;
    }
    body.requestId = this.requestKey(`${action}:${JSON.stringify(body)}`); this.busy = true; this.error = '';
    try {
      await this.service.command(this.missionId, action, body, action === 'approval' ? approval?.id ?? '' : '');
      this.approval = null; this.notice = '请求已受理，请查看服务端状态与执行回执';
      // 补料/答复等结果未必推进 missionVersion（如关联被保留），回执区需主动重读。
      this.readbackRefreshKey++;
    } catch (e) {
      // 409（含 WORK_PACKET_AUTHORITY_CHANGED）：服务端拒绝旧版本/旧授权。
      // 保留答复与已选资料草稿，重新读取当前状态后再提交；不当作已成功，也不重复执行。
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) {
        this.notice = '当前版本或授权已变化，草稿与所选资料已保留；请按最新状态重新核对后再提交。';
        if (action === 'approval') this.approval = null;
        this.readbackRefreshKey++;
      } else {
        this.fail(e); this.approval = null;
      }
    }
    finally { this.busy = false; this.refresh(); }
  }
  /**
   * 工作包主动作只路由到原对象：原问题/原提案/原结果/原委托。
   * 旧问题或已替代的提案回到当前委托重新核对，不生成另一条任务，
   * 也不新增客户端批准端点；版本与幂等仍由原服务端命令校验。
   */
  private packetAction(action: WorkPacketActionView): void {
    if (this.busy) return;
    if (action.kind === 'ANSWER_QUESTION') {
      const currentQuestion = this.mission.question !== null ? this.mission.question.id : '';
      if (this.mission.status === 'WAITING_INPUT' && action.targetId !== '' && action.targetId === currentQuestion) {
        this.detailView = 'overview';
        this.notice = '已定位到当前待补料问题；请在下方原问题处补充。';
      } else {
        this.notice = '原问题已变化或已结束，已回到当前委托；旧问题不会被当成新问题，也不会自动提交。';
      }
      this.readbackRefreshKey++; this.refresh(); return;
    }
    if (action.kind === 'REVIEW_APPROVAL') {
      const pending = this.mission.approvals.find((item: MissionApproval) => item.id === action.targetId);
      if (pending !== undefined && this.mission.status === 'WAITING_APPROVAL') {
        this.approval = pending; this.reviewedVersion = this.mission.version;
      } else {
        this.notice = '原提案已失效或被替代，已回到当前委托；请重新核对服务端当前提案，不会生成新的批准请求。';
        this.readbackRefreshKey++; this.refresh();
      }
      return;
    }
    if (action.kind === 'RESUME_DELEGATION') {
      if (this.mission.status === 'PAUSED') { this.command('resume'); }
      else { this.notice = '当前状态不需要继续委托；已重新读取服务端状态。'; this.readbackRefreshKey++; this.refresh(); }
      return;
    }
    if (action.kind === 'VIEW_RESULT' || action.kind === 'REVIEW_FAILURE') {
      this.detailView = 'progress';
      this.notice = action.kind === 'VIEW_RESULT' ? '已定位到原结果与回执；完成状态仍以原回执为准。' : '已定位到执行记录；失败原因与已执行结果分别保留。';
      return;
    }
    // RECHECK_AUTHORITY / CHECK_UNKNOWN_EFFECT / CHECK_STOP_SETTLEMENT：只重新读取，不用读取核销 UNKNOWN。
    this.notice = action.kind === 'CHECK_STOP_SETTLEMENT'
      ? '已重新读取服务端状态；停止请求在结算前仍显示为未完成。'
      : action.kind === 'CHECK_UNKNOWN_EFFECT'
        ? '已重新读取服务端状态；读取不会核销未结算效果，仍以原请求/回执为准。'
        : '已重新读取服务端状态；请按当前版本与许可再次核对。';
    this.readbackRefreshKey++;
    this.refresh();
  }
  private async cancel(): Promise<void> {
    const result = await promptAction.showDialog({ title: '取消长期委托', message: '停止后续执行，保留已有成果与审批历史。', buttons: [{ text: '返回', color: '#64748B' }, { text: '确认取消', color: '#B91C1C' }] });
    if (result.index === 1) this.command('cancel');
  }
  private async policy(): Promise<void> {
    if (this.busy || this.readState !== 'fresh') return;
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
    body.evidenceReview = this.evidenceReview();
    if (!body.sourcePointers.length || this.mission.evidencePremise && !body.evidenceReview) return; this.busy = true;
    const generation = this.generation; const token = SessionStore.getToken();
    try { const preview = await this.service.previewMaterial(this.missionId, body); if (this.current(generation, token)) this.preview = preview; }
    catch (e) { this.fail(e); } finally { this.busy = false; }
  }
  private async continueMaterials(): Promise<void> {
    const preview = this.preview;
    if (this.busy || this.readState !== 'fresh' || !this.materialsReviewed || preview === null || this.answer.trim() === '') return;
    const body = new MissionMaterialConfirm(); body.questionId = preview.questionId; body.sourcePointers = preview.sourcePointers;
    body.expectedVersion = preview.version; body.expectedContextVersion = preview.contextVersion;
    body.assessmentHash = preview.assessmentHash; body.answer = this.answer.trim(); body.evidenceReview = this.evidenceReview(); body.fitHash = preview.fitHash; body.requestId = this.requestKey(body); this.busy = true;
    const generation = this.generation; const token = SessionStore.getToken();
    try {
      const result = await this.service.confirmMaterial(this.missionId, body);
      if (!this.current(generation, token)) return;
      this.notice = result.continued ? '资料已绑定，同一委托可以继续；后续执行仍待服务端处理' : `仍需等待：${this.holdReason(result.reason ?? '')}`;
      this.preview = null;
      // HELD 关联等结果不推进 missionVersion，回执区据此重读材料使用事实。
      this.readbackRefreshKey++;
    } catch (e) { if (this.current(generation, token)) { this.fail(e); this.preview = null; } } finally { this.busy = false; this.refresh(); }
  }
  /** 暂停原因可能是服务端枚举，也可能是自然语言；枚举转为用户可读，原文进技术诊断。 */
  private pauseReasonText(): string {
    const raw = this.mission.pauseReason ?? '';
    const labels: Record<string, string> = { 'REVIEW_REQUIRED': '暂停等待人工核对：请确认预算与执行条件后再继续。', 'BUDGET_EXCEEDED': '执行预算已用完：可复核累计预算或调整后继续。', 'PAUSE_REQUESTED': '已按你的请求暂停，可随时继续。', 'CANCEL_REQUESTED': '正在等待取消流程完成。' };
    if (labels[raw] !== undefined) { return labels[raw]; }
    return raw === '' ? '服务端未提供具体原因，请查看执行回执。' : raw;
  }
  private recentSteps(): MissionStep[] {
    if (this.showAllSteps) { return this.mission.steps; }
    const succeeded = this.mission.steps.filter((step: MissionStep) => step.status === 'SUCCEEDED');
    if (succeeded.length > 5) { return succeeded.slice(-5); }
    return this.mission.steps.slice(-5);
  }
  private holdReason(reason: string): string {
    const labels: Record<string, string> = { 'SUFFICIENT': '材料字段齐备，仍需核对含义', 'INSUFFICIENT': '资料尚不足', 'CONFLICT': '资料存在冲突', 'UNKNOWN': '充分性需要人工核对',
      'LLM_CONTEXT_NOT_APPROVED': '尚未批准模型使用任务上下文', 'BUDGET_EXHAUSTED': '执行预算已耗尽', 'BACKGROUND_ONLY': '资料仅作背景，原问题继续等待' };
    return labels[reason] ?? '请核对资料与授权';
  }
  private async previewOutput(output: MissionOutput): Promise<void> {
    if (this.busy || this.readState !== 'fresh') return; this.busy = true;
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
  private async chooseExistingMaterials(): Promise<void> {
    if (this.busy || this.readState !== 'fresh' || this.mission.question === null) return;
    this.showMaterials = !this.showMaterials;
    if (!this.showMaterials) return;
    const generation = this.generation; const token = SessionStore.getToken(); const questionId = this.mission.question.id;
    try {
      const page = await this.service.candidates(this.missionId, questionId, '', true);
      if (this.current(generation, token) && this.mission.question?.id === questionId) this.candidates = page.candidates;
    } catch (e) { if (this.current(generation, token)) this.fail(e); }
  }
  @Builder private WaitingInput() {
    Column({ space: 14 }) {
      Text('补充资料').fontSize(13).fontColor(PMColors.BRAND).fontWeight(FontWeight.Medium)
      Text(this.mission.question?.payloadJson.question ?? '请补充资料').fontSize(17).lineHeight(26).fontColor(PMColors.INK_PRIMARY)
      TextArea({ placeholder: this.selectedSources.length > 0 ? '补充你对这份资料的答复…' : '写下你的答复，或从下方选择资料…', text: this.answer })
        .height(92).fontSize(15).fontColor(PMColors.INK_PRIMARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
        .padding(12).maxLength(3000).onChange((v: string) => { this.answer = v; this.materialsReviewed = false; if (this.mission.evidencePremise) this.preview = null; })
      Row({ space: 8 }) {
        Button('＋ 新记录或附件', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.BRAND)
          .backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).layoutWeight(1)
          .enabled(this.readState === 'fresh' && !this.busy).onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.projectId, materialMissionId: this.missionId, materialQuestionId: this.mission.question?.id ?? '' } }); })
        Button(this.showMaterials ? '收起项目资料 ⌃' : '选择项目资料 ⌄', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.BRAND)
          .backgroundColor(Color.Transparent).padding({ left: 8, right: 0 }).layoutWeight(1)
          .enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.chooseExistingMaterials(); })
      }.width('100%')
      if (this.showMaterials) {
        if (this.candidates.length === 0) { Text('还没有可选资料，先添加一条记录或附件。').fontSize(13).fontColor(PMColors.INK_SECONDARY) }
        ForEach(this.candidates, (candidate: MissionCandidate) => {
          Row({ space: 12 }) {
            Column({ space: 5 }) {
              if (candidate.title && !candidate.excerpt.trim().startsWith(candidate.title.trim())) {
                Text(candidate.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              Text(candidate.excerpt || candidate.title || '正文尚不可读，原件仍保留').fontSize(13).lineHeight(20).fontColor(PMColors.INK_SECONDARY)
                .maxLines(this.selectedSources.includes(candidate.sourcePointer.id) ? 6 : 3).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (!candidate.readable) { Text('等待解析').fontSize(11).fontColor(PMColors.INK_TERTIARY) }
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            Button(this.selectedSources.includes(candidate.sourcePointer.id) ? '✓' : '＋', { type: ButtonType.Normal })
              .width(44).height(44).fontSize(18).fontColor(PMColors.BRAND).backgroundColor(this.selectedSources.includes(candidate.sourcePointer.id) ? PMColors.BRAND_LIGHT : Color.Transparent).borderRadius(12)
              .accessibilityText((this.selectedSources.includes(candidate.sourcePointer.id) ? '取消选择：' : '选择资料：') + (candidate.title ?? candidate.excerpt))
              .enabled(this.readState === 'fresh' && !this.busy && candidate.readable && (this.selectedSources.includes(candidate.sourcePointer.id) || this.selectedSources.length < 8)).onClick(() => {
                const already = this.selectedSources.includes(candidate.sourcePointer.id);
                this.selectedSources = already ? this.selectedSources.filter((id: string) => id !== candidate.sourcePointer.id) : this.selectedSources.concat([candidate.sourcePointer.id]);
                if (!already && this.answer === '') this.answer = `请根据所选资料重新判断：${candidate.excerpt}`;
                this.preview = null; this.materialsReviewed = false;
              })
          }.width('100%').alignItems(VerticalAlign.Top).padding({ top: 10, bottom: 10 })
            .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
        }, (candidate: MissionCandidate) => `${candidate.sourcePointer.id}:${candidate.sourcePointer.hash}`)
      }
      if (this.mission.evidencePremise) {
        MissionEvidenceReview({ premise: this.mission.evidencePremise!, mode: this.evidenceMode, confirmed: this.premiseReviewed, disabled: this.busy || this.readState !== 'fresh',
          onMode: (value: string): void => { this.evidenceMode = value; this.preview = null; this.materialsReviewed = false; },
          onConfirm: (value: boolean): void => { this.premiseReviewed = value; this.preview = null; this.materialsReviewed = false; } })
      }
      if (this.selectedSources.length === 0) {
        PMButton({ label: '补充并继续', disabled: this.readState !== 'fresh' || this.busy || this.answer.trim() === '' || !!this.mission.evidencePremise && (!this.premiseReviewed || this.evidenceMode !== 'CONDITIONAL_ANALYSIS'), onAction: (): void => { this.command('input'); } })
      } else if (this.preview === null) {
        PMButton({ label: '评估所选资料', disabled: this.readState !== 'fresh' || this.busy || this.selectedSources.length === 0 || this.selectedSources.length > 8 || !!this.mission.evidencePremise && (!this.premiseReviewed || this.answer.trim() === ''), onAction: (): void => { this.materialsReviewed = false; this.previewMaterials(); } })
      } else {
        if (this.preview.evidenceFit) {
          Text(this.preview.evidenceFit!.fitStatus === 'FIT' ? '条件对应，可用于回答本次测量' : this.preview.evidenceFit!.fitStatus === 'NOT_FIT' ? '观察条件不符，可保留为背景' : '仍有未决项，请保留未知')
            .fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
          Button(this.showFitDetails ? '收起核对原文' : '查看核对原文').type(ButtonType.Normal).height(44).fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.BUTTON).onClick(() => { this.showFitDetails = !this.showFitDetails; })
          if (this.showFitDetails) {
            ForEach(this.preview.observationExcerpts ?? [], (excerpt: FitExcerpt) => {
              Text(excerpt.text || '这份资料中尚无明确观察').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).copyOption(CopyOptions.LocalDevice)
              if (excerpt.truncated) { Text('此段只展示部分内容，其余保持未知').fontSize(PMFontSize.CAPTION).fontColor(PMColors.WARNING) }
            }, (excerpt: FitExcerpt) => excerpt.observationGroup)
          }
          ForEach(this.preview.evidenceFit!.groups, (group: FitGroup) => {
            if (group.measurementResult === 'EXCEEDS_LIMIT') { Text('测量超出约定预算，负结果保留').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.WARNING) }
          }, (group: FitGroup) => group.observationGroup)
        }
        Text(this.holdReason(this.preview.assessment)).fontSize(PMFontSize.BODY).fontColor(PMColors.BRAND).fontWeight(FontWeight.Medium)
        if (this.preview.remaining.length > 0) { Text(`待补：${this.preview.remaining.join('、')}`).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY) }
        Row({ space: PMSpacing.SM }) {
          Checkbox({ name: 'material-reviewed' }).selectedColor(PMColors.BRAND).select(this.materialsReviewed).onChange((v: boolean) => { this.materialsReviewed = v; })
          Text('已核对资料与原问题的关系，确认以上答复').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
        }.width('100%')
        PMButton({ label: '确认资料并接续', disabled: this.readState !== 'fresh' || this.busy || !this.materialsReviewed || this.answer.trim() === '', onAction: (): void => { this.continueMaterials(); } })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(18).backgroundColor(PMColors.SURFACE).borderRadius(16)
      .border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
  @Builder private BudgetRow(label: string, used: number, limit: number, suggested: number, unit: string) {
    Row({ space: 10 }) {
      Text(label).fontSize(13).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
      Text(`${used}${unit} / ${limit}${unit}${suggested > limit ? ' → 建议 ' + suggested + unit : ''}`)
        .fontSize(13).fontColor(PMColors.INK_PRIMARY)
    }.width('100%')
  }
  /** 运行额度：默认展示已用与主要上限；复核只是提高累计上限并保持暂停，与继续执行是两个操作。 */
  @Builder private BudgetCard() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('运行额度').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Button(this.showBudgetDetail ? '收起全部额度' : '展开全部额度', { type: ButtonType.Normal }).height(40).fontSize(12)
          .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 })
          .onClick(() => { this.showBudgetDetail = !this.showBudgetDetail; })
      }.width('100%')
      this.BudgetRow('模型调用', this.mission.used.models ?? 0, this.mission.budget.models, Math.min(240, this.mission.budget.models + 6), ' 次')
      this.BudgetRow('工具调用', this.mission.used.tools ?? 0, this.mission.budget.tools, Math.min(640, this.mission.budget.tools + 8), ' 次')
      this.BudgetRow('活动时间', Math.round((this.mission.used.activeMs ?? 0) / 60000), Math.round(this.mission.budget.activeMs / 60000), Math.round(Math.min(86400000, this.mission.budget.activeMs + 180000) / 60000), ' 分钟')
      this.BudgetRow('输出预留（tokens）', this.mission.used.reservedOutputTokens ?? 0, this.mission.budget.reservedOutputTokens, Math.min(480000, this.mission.budget.reservedOutputTokens + 12000), '')
      if (this.showBudgetDetail) {
        this.BudgetRow('元数据与环境 HTTP', this.mission.used.metadataRequests ?? 0, this.mission.budget.metadataRequests ?? 24, Math.min(960, (this.mission.budget.metadataRequests ?? 24) + 24), ' 次')
        this.BudgetRow('浏览器请求', this.mission.used.browserRequests ?? 0, this.mission.budget.browserRequests ?? 40, Math.min(1000, (this.mission.budget.browserRequests ?? 40) + 40), '')
        this.BudgetRow('浏览器字节', this.mission.used.browserBytes ?? 0, this.mission.budget.browserBytes ?? 4000000, Math.min(64000000, (this.mission.budget.browserBytes ?? 4000000) + 4000000), '')
        this.BudgetRow('日历调用', this.mission.used.calendarRequests ?? 0, this.mission.budget.calendarRequests ?? 8, Math.min(128, (this.mission.budget.calendarRequests ?? 8) + 16), '')
        this.BudgetRow('外部写入', this.mission.used.externalWrites ?? 0, this.mission.budget.externalWrites ?? 2, Math.min(32, (this.mission.budget.externalWrites ?? 2) + 10), '')
        Text('UNKNOWN 预占与已用都会保留；新外部效果仍需逐项批准。').fontSize(12).fontColor(PMColors.INK_TERTIARY)
      }
      Text('预算复核只提高累计上限并保持暂停；确认后仍需你再次继续原委托。').fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
      PMButton({ label: '确认累计预算，保持暂停', secondary: true, disabled: this.busy || this.readState !== 'fresh', onAction: (): void => { this.reviewBudget(); } })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
  @Builder private ViewTab(label: string, key: string) {
    Text(label).fontSize(14).fontWeight(this.detailView === key ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(this.detailView === key ? PMColors.INK_PRIMARY : PMColors.INK_TERTIARY)
      .textAlign(TextAlign.Center).layoutWeight(1).height(36).borderRadius(9)
      .backgroundColor(this.detailView === key ? PMColors.SURFACE : Color.Transparent)
      .onClick(() => { this.detailView = key; })
      .accessibilityText(label + (this.detailView === key ? '，当前视图' : ''))
  }
  @Builder private NavRow(label: string, sub: string, onOpen: () => void) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(label).fontSize(14).fontColor(PMColors.INK_PRIMARY)
        if (sub !== '') { Text(sub).fontSize(12).fontColor(PMColors.INK_TERTIARY) }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text('›').fontSize(20).fontColor(PMColors.INK_TERTIARY)
    }.width('100%').height(52).alignItems(VerticalAlign.Center)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .onClick(() => { onOpen(); })
      .accessibilityText(label)
  }
  @Builder private OverviewView() {
    Column({ space: 12 }) {
      Column({ space: 12 }) {
        Row() {
          PMStatusPill({ label: this.mission.workState ? workPhaseLabel(this.mission.workState!.phase) : missionStatusLabel(this.mission.status), tone: this.mission.status === 'PAUSED' || this.mission.status === 'FAILED' ? 'risk' : 'brand' })
          Blank()
          Button(this.showCompletion ? '收起状态详情 ⌃' : '状态详情 ⌄', { type: ButtonType.Normal }).height(44).fontSize(12)
            .fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 }).onClick(() => { this.showCompletion = !this.showCompletion; })
        }.width('100%')
        Text(this.mission.goal).fontSize(22).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
          .maxLines(this.showGoal ? 100 : 3).textOverflow({ overflow: TextOverflow.Ellipsis }).lineHeight(32)
        if (this.mission.delegation?.attention?.level === 'URGENT') { Text('临近任务截止，需要你核对当前问题后决定下一步。').fontSize(14).fontColor(PMColors.BRAND) }
        if (this.mission.goal.length > 40) {
          Button(this.showGoal ? '收起目标原文' : '展开目标原文').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON)
            .fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
            .height(44).onClick(() => { this.showGoal = !this.showGoal; })
        }
        if (this.showCompletion) {
          Column({ space: 8 }) {
            ForEach(missionCompletionFacts(this.mission.status, this.mission.completion, this.mission.outputs[0]?.verificationStatus), (fact: MissionCompletionFact) => {
              Row({ space: 12 }) {
                Text(fact.label).fontSize(12).fontColor(PMColors.INK_TERTIARY).width(64)
                Text(fact.value).fontSize(13).fontColor(PMColors.INK_SECONDARY).lineHeight(20).layoutWeight(1)
              }.width('100%').alignItems(VerticalAlign.Top)
            }, (fact: MissionCompletionFact) => fact.label)
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 10, bottom: 10 })
            .border({ width: { top: 1, bottom: 1 }, color: PMColors.BORDER_SUBTLE })
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.CARD)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
      MissionReadbackView({
        missionId: this.missionId, target: this.readTarget, missionVersion: this.mission.version,
        refreshKey: this.readbackRefreshKey, targetKey: JSON.stringify(this.readTarget),
        mode: 'packet', inlinePrimaryAction: true,
        onPrimaryAction: (action: WorkPacketActionView): void => { this.packetAction(action); }
      })
      Column({ space: 6 }) {
        if (this.mission.workState) { Text(this.mission.workState.reasonText).fontSize(14).fontColor(PMColors.INK_SECONDARY).lineHeight(21) }
        if (this.mission.workingObjective) { Text('当前重点：' + this.mission.workingObjective).fontSize(14).fontColor(PMColors.INK_SECONDARY).lineHeight(21) }
        if (this.mission.status === 'RUNNING' && (this.mission.cancelRequestedAt || this.mission.pauseRequestedAt)) { Text(this.mission.cancelRequestedAt ? '已收到取消请求，当前在途步骤尚未结算；不会继续派发新步骤' : '已收到暂停请求，当前在途步骤尚未结算；不会继续派发新步骤').fontColor(PMColors.WARNING) }
        if (this.readState === 'lastKnown') { Text(`上次读取于 ${this.updatedAt}；当前为历史状态，刷新成功后可操作。`).fontSize(12).fontColor(PMColors.RISK) }
      }.width('100%').alignItems(HorizontalAlign.Start)
      if (this.mission.status === 'WAITING_INPUT' && this.mission.question !== null) { this.WaitingInput() }
      if (this.mission.approvals.length > 0) {
        Column({ space: 10 }) {
          Text('待你批准').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
          ForEach(this.mission.approvals, (approval: MissionApproval) => {
            Column({ space: 6 }) {
              Text(approval.proposal.args.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              Text(approval.proposal.args.description).fontSize(13).fontColor(PMColors.INK_SECONDARY).lineHeight(20)
              Row({ space: 10 }) {
                Text(`批准有效至 ${new Date(approval.expiresAt).toLocaleString('zh-CN')}`).fontSize(11).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
                Text('审阅并决定 ›').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND).height(40)
                  .enabled(this.readState === 'fresh' && !this.busy && this.missionUiEnabled)
                  .onClick(() => { this.approval = approval; this.reviewedVersion = this.mission.version; })
              }.width('100%')
            }.width('100%').alignItems(HorizontalAlign.Start).padding(14)
              .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER })
          }, (approval: MissionApproval) => approval.id)
          if (this.mission.status === 'WAITING_APPROVAL') {
            Text('提案可能已失效？更新依据并重新评估').fontSize(13).fontColor(PMColors.BRAND).height(40)
              .enabled(this.readState === 'fresh' && !this.busy && this.missionUiEnabled)
              .onClick(() => { this.command('replan'); })
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      if (this.mission.error !== null || this.mission.status === 'PAUSED' || this.mission.status === 'FAILED') {
        Column({ space: PMSpacing.SM }) {
          Text('当前状态').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          Text(this.mission.status === 'PAUSED' ? '执行已暂停，已有进度保留' : this.mission.status === 'FAILED' ? '执行失败，已执行的结果保留' : '本次执行需要恢复，已有进度保留')
            .fontSize(PMFontSize.SECTION_TITLE).fontWeight(FontWeight.Medium).fontColor(PMColors.RISK)
          Text(this.mission.status === 'PAUSED' ? this.pauseReasonText()
            : this.mission.error?.message ?? this.mission.pauseReason ?? '服务端未提供具体原因，请查看执行回执。')
            .fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY).lineHeight(24)
          if (this.mission.error?.recovery?.automatic) { Text('由服务端按限次策略处理，无需手动重试').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
          Column({ space: 5 }) {
            Text('继续前请核对').fontSize(11).fontColor(PMColors.INK_TERTIARY)
            Text(this.mission.error?.recovery?.message ?? (this.mission.status === 'PAUSED' ? '检查服务配置及执行回执，再继续原委托。' : this.mission.status === 'FAILED' ? '核对执行回执后，返回列表重新委托。' : '请读取最新状态，服务端会保留此前进度。'))
              .fontSize(13).fontColor(PMColors.INK_PRIMARY).lineHeight(20)
          }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.WARNING_LIGHT).borderRadius(12)
          if (this.mission.error?.code || this.mission.error?.phase) {
            Text(`技术诊断：${this.mission.error?.code ?? ''}${this.mission.error?.phase ? ' · 发生阶段：' + missionErrorPhaseLabel(this.mission.error!.phase) : ''}`)
              .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          if (this.mission.status === 'PAUSED' && this.missionUiEnabled) {
            this.BudgetCard()
            Button('继续原委托', { type: ButtonType.Normal }).width('100%').height(48).borderRadius(PMRadius.BUTTON)
              .backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).fontSize(15).fontWeight(FontWeight.Medium)
              .enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.command('resume'); })
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      }
      Column({ space: 8 }) {
        Text('最近进展').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        if (this.mission.steps.filter((step: MissionStep) => step.status === 'SUCCEEDED').length === 0) {
          Text(this.mission.status === 'READY' ? '委托已保存，等待开始执行。' : '尚无已完成的执行步骤。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }
        ForEach(this.mission.steps.filter((step: MissionStep) => step.status === 'SUCCEEDED').slice(-3), (step: MissionStep) => {
          Row({ space: 10 }) {
            Circle({ width: 8, height: 8 }).fill(PMColors.BRAND).margin({ top: 8 })
            Column({ space: 3 }) {
              Text(`${step.ordinal} · ${missionToolLabel(step.toolName)}`).fontSize(13).fontColor(PMColors.INK_PRIMARY)
              if (this.actionReceipt(step) !== '') { Text(this.actionReceipt(step)).fontSize(12).fontColor(PMColors.INK_SECONDARY) }
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').alignItems(VerticalAlign.Top)
        }, (step: MissionStep) => step.id)
        if (this.mission.outputs.length > 0) { Text(`草稿修订 ${this.mission.outputs[0].revision} 已保存，内容待审阅。`).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
        this.NavRow('查看执行详情、回执与成果', '', (): void => { this.detailView = 'progress'; })
      }.width('100%').alignItems(HorizontalAlign.Start)
      PMButton({ label: '调整当前重点／继续讨论', secondary: true, onAction: (): void => { router.pushUrl({ url: 'pages/FocusConversation', params: { projectId: this.projectId, entityKind: 'MISSION', entityId: this.missionId } }); } })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private SourceRow(source: MissionSource) {
    Column({ space: 4 }) {
      Row({ space: 8 }) {
        Text(MissionProgressPresentation.sourceTitle(source)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Text(this.knowledge(source.knowledgeClass ?? source.kind)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
      }.width('100%')
      if (MissionProgressPresentation.sourcePreview(source) !== '') {
        Text(MissionProgressPresentation.sourcePreview(source)).fontSize(12).lineHeight(19).fontColor(PMColors.INK_SECONDARY)
      }
      Row({ space: 10 }) {
        if (source.deployment) {
          Text('查看环境观察与证据层级 ›').fontSize(12).fontColor(PMColors.BRAND).height(36)
            .onClick(() => { router.pushUrl({ url: 'pages/ConversationWebSource', params: { missionId: this.missionId, sourceId: source.id } }); })
        } else if (source.kind === 'EXTERNAL') {
          Text('查看公开资料与阅读级别 ›').fontSize(12).fontColor(PMColors.BRAND).height(36)
            .onClick(() => { router.pushUrl({ url: 'pages/ConversationWebSource', params: { missionId: this.missionId, sourceId: source.id } }); })
        }
        if (source.document) {
          Text((source.document!.pages.length > 0 ? '原件第 ' + source.document!.pages[0].toString() + ' 页' : '查看原页与引用') + ' ›').fontSize(12).fontColor(PMColors.BRAND).height(36)
            .onClick(() => { router.pushUrl({ url: 'pages/ConversationWebSource', params: { missionId: this.missionId, sourceId: source.id } }); })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 8 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
  @Builder private StepDetail(step: MissionStep) {
    Column({ space: 8 }) {
      if (MissionProgressPresentation.stepSummary(step) !== '') {
        Text(MissionProgressPresentation.stepSummary(step)).fontSize(13).lineHeight(21).fontColor(PMColors.INK_PRIMARY)
      }
      if (step.execution && step.execution!.phase !== 'NOT_DISPATCHED') { MissionMetricReceipt({ execution: step.execution!, stepStatus: step.status }) }
      if (this.actionReceipt(step) !== '') { Text(this.actionReceipt(step)).fontSize(13).fontColor(PMColors.INK_PRIMARY) }
      ForEach(step.result?.sources ?? [], (source: MissionSource) => {
        this.SourceRow(source)
      }, (source: MissionSource) => source.id)
      if (MissionProgressPresentation.rawDiagnostic(step) !== '') {
        Text(this.showRawStep === step.id ? '收起技术诊断 ⌃' : '技术诊断（原始 JSON，可复制） ⌄').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          .onClick(() => { this.showRawStep = this.showRawStep === step.id ? '' : step.id; })
        if (this.showRawStep === step.id) {
          Text(MissionProgressPresentation.rawDiagnostic(step)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            .copyOption(CopyOptions.LocalDevice).maxLines(12).lineHeight(17)
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 10, bottom: 12, left: 12, right: 12 })
      .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
  }
  @Builder private StepRow(step: MissionStep) {
    Column({ space: 6 }) {
      Row({ space: 10 }) {
        Text(step.status === 'SUCCEEDED' ? '✓' : step.status === 'FAILED' ? '×' : '·')
          .fontSize(13).fontWeight(FontWeight.Bold)
          .fontColor(step.status === 'SUCCEEDED' ? PMColors.BRAND : step.status === 'FAILED' ? PMColors.RISK : PMColors.INK_TERTIARY)
          .width(20)
        Column({ space: 3 }) {
          Row({ space: 8 }) {
            Text(`${step.ordinal} · ${missionToolLabel(step.toolName)}`).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
            if (step.status !== 'SUCCEEDED') { Text(missionStatusLabel(step.status)).fontSize(11).fontColor(step.status === 'FAILED' ? PMColors.RISK : PMColors.INK_TERTIARY) }
          }.width('100%')
          if (MissionProgressPresentation.stepSummary(step) !== '') {
            Text(MissionProgressPresentation.stepSummary(step)).fontSize(12).lineHeight(19).fontColor(PMColors.INK_SECONDARY)
              .maxLines(this.expandedStepId === step.id ? 100 : 2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(this.expandedStepId === step.id ? '⌃' : '›').fontSize(14).fontColor(PMColors.INK_TERTIARY)
      }.width('100%').alignItems(VerticalAlign.Top)
      if (this.expandedStepId === step.id) { this.StepDetail(step) }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 10, bottom: 10 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .onClick(() => { this.expandedStepId = this.expandedStepId === step.id ? '' : step.id; })
      .accessibilityText(`步骤 ${step.ordinal}：${missionToolLabel(step.toolName)}`)
  }
  @Builder private ProgressView() {
    Column({ space: 14 }) {
      Column({ space: 2 }) {
        Text('执行时间线').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).padding({ top: 4, bottom: 4 })
        Text(`上下文 ${this.mission.contextVersion} · 计划 ${this.mission.planRevision}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
      }.width('100%').alignItems(HorizontalAlign.Start)
      Column({ space: 2 }) {
        ForEach(this.recentSteps(), (step: MissionStep) => {
          this.StepRow(step)
        }, (step: MissionStep) => step.id)
        if (this.mission.steps.length === 0) {
          Text(this.mission.status === 'READY' ? '委托已保存，等待开始执行。' : '尚无执行步骤。').fontSize(13).fontColor(PMColors.INK_SECONDARY).padding({ top: 8 })
        }
        if (this.mission.steps.length > this.recentSteps().length) {
          Button(this.showAllSteps ? '收起，只看最近执行' : `查看全部执行历史（${this.mission.steps.length} 步）`, { type: ButtonType.Normal })
            .height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
            .onClick(() => { this.showAllSteps = !this.showAllSteps; })
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
      Column({ space: 4 }) {
        Row({ space: 8 }) {
          Text('执行事件').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
          if (this.events.length > 5) {
            Button(this.showAllEvents ? '收起事件' : `全部事件（${this.events.length}）`, { type: ButtonType.Normal }).height(40).fontSize(12)
              .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 })
              .onClick(() => { this.showAllEvents = !this.showAllEvents; })
          }
        }.width('100%')
        MissionEventList({ events: this.showAllEvents ? this.events : this.events.slice(-5) })
      }.width('100%').alignItems(HorizontalAlign.Start)
      Column({ space: 10 }) {
        Text('成果草稿').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        if (this.mission.outputs.length === 0) {
          Text('尚无已保存的成果草稿；草稿由执行过程按计划生成。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }
        if (this.mission.outputs.length > 1) { Button(this.showOlderOutputs ? '收起历史草稿' : `查看其余 ${this.mission.outputs.length - 1} 份草稿`).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).constraintSize({ minHeight: 44 }).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => { this.showOlderOutputs = !this.showOlderOutputs; }) }
        ForEach(this.showOlderOutputs ? this.mission.outputs : this.mission.outputs.slice(0, 1), (output: MissionOutput) => {
          Column({ space: 8 }) {
            Text(`草稿修订 ${output.revision} · 待审阅`).fontSize(13).fontColor(PMColors.INK_SECONDARY)
            ForEach(output.contentJson.blocks, (block: MissionBlock) => {
              Text(`${this.knowledge(block.kind)}\n${block.text}\n来源：${block.sourceIds.join('、') || '未引用'}`)
            }, (block: MissionBlock) => block.blockId)
            ForEach(output.claimChecksJson ?? [], (claim: MissionClaim) => {
              Text(`${this.claimStatus(claim.status)}：${claim.text ?? '该段内容尚未逐句核验'}`).fontSize(13)
            }, (claim: MissionClaim, index: number) => claim.claimId ?? `${claim.blockId}-${index}`)
            if (this.mission.artifactAdoptionEnabled) { Button('预览归入项目周报 ›').type(ButtonType.Normal).height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.previewOutput(output); }) }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (output: MissionOutput) => output.id)
      }.width('100%').alignItems(HorizontalAlign.Start)
      MissionReadbackView({
        missionId: this.missionId, target: this.readTarget, missionVersion: this.mission.version,
        refreshKey: this.readbackRefreshKey, targetKey: JSON.stringify(this.readTarget),
        mode: 'full', inlinePrimaryAction: false,
        onPrimaryAction: (action: WorkPacketActionView): void => { this.packetAction(action); }
      })
      GoalQuestionPanel({ projectId: this.projectId, missionId: this.missionId, compact: true })
      ProjectImpactPanel({ projectId: this.projectId })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private PlanView() {
    Column({ space: 12 }) {
      DecisionScenarioPanel({ missionId: this.missionId, disabled: this.readState !== 'fresh' || this.busy || missionTerminal(this.mission.status), onAdopted: (): void => { this.refresh(); } })
      if (this.mission.experience !== undefined && this.mission.experience.enabled && this.mission.experience.suggestions.length > 0) {
        ExperiencePanel({ projectId: this.projectId, missionId: this.mission.id, suggestions: this.mission.experience.suggestions, onChanged: (): void => { this.refresh(); } })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private SettingsView() {
    Column({ space: 12 }) {
      Column({ space: 4 }) {
        Text('委托设置').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).padding({ top: 6, bottom: 6 })
        if (!missionTerminal(this.mission.status) && this.missionUiEnabled) {
          this.NavRow('个人约束', '时间、费用、优先级与执行限制', (): void => { this.openForm('constraints'); })
          this.NavRow('公开研究范围', this.mission.researchScope.enabled ? '已开启公开网络研究' : '未开启', (): void => { this.openForm('scope'); })
          this.NavRow('接续许可', this.mission.continuationPolicy.mode === 'MANUAL' ? '每次确认后继续' : '满足条件后自动读取与分析', (): void => { this.policy(); })
        } else {
          Text('委托已结束；设置保留为只读，可在原记录中查看。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }
        if (!missionTerminal(this.mission.status) && this.missionUiEnabled && this.mission.investigationDelegationEnabled) {
          MissionInvestigationDelegation({ mission: this.mission, onSaved: (): void => { this.refresh(); } })
        }
        MissionResponsibilitySection({ missionId: this.mission.id, onRevised: (): void => { this.refresh(); } })
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.MD })
        .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      Column({ space: 4 }) {
        Text('委托管理').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).padding({ top: 6, bottom: 6 })
        if (!missionTerminal(this.mission.status) && this.missionUiEnabled) {
          if (['READY', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(this.mission.status)) {
            this.NavRow('暂停委托', '等待当前步骤安全停止；进度保留', (): void => { this.command('pause'); })
          }
          this.NavRow('取消委托', '停止后续执行；成果、审批与回执保留', (): void => { this.cancel(); })
          Text('危险操作会先弹出确认；取消不影响已有记录。').fontSize(12).fontColor(PMColors.INK_TERTIARY).padding({ top: 6, bottom: 6 })
        } else {
          Text('委托已结束，无需暂停或取消。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.MD })
        .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder private MissionBody() {
    Column({ space: 12 }) {
      Row({ space: 4 }) {
        this.ViewTab('概况', 'overview')
        this.ViewTab('进展', 'progress')
        this.ViewTab('方案', 'plan')
        this.ViewTab('设置', 'settings')
      }.width('100%').backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11).padding(3)
      if (this.detailView === 'progress') { this.ProgressView() }
      else if (this.detailView === 'plan') { this.PlanView() }
      else if (this.detailView === 'settings') { this.SettingsView() }
      else { this.OverviewView() }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  build() {
    Column() {
      PMAppBar({ title: this.form === 'create' ? '新建长期委托' : '长期委托', backLabel: '项目', rightActionText: '刷新', onRightTextAction: () => { this.error = ''; this.errorCount = 0; this.refresh(); } })
      if (this.focusConversationId !== '') { PMButton({ label: '继续原焦点讨论', secondary: true, onAction: (): void => { router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: this.focusConversationId, projectId: this.projectId } }); } }) }
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
            Button('确认归入项目成果').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.adopt(); })
            Button('返回任务').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.adoption = null; })
          } else if (this.mission.id !== '') {
            this.MissionBody()
          } else {
            if (this.missionUiEnabled) { PMButton({ label: '＋ 新建长期委托', disabled: this.busy || this.readState !== 'fresh', onAction: (): void => { this.editSnapshot = new Mission(); this.form = 'create'; } }) }
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
            if (this.nextCursor !== '') { Button('加载更多委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(this.readState === 'fresh' && !this.busy).onClick(() => { this.more(); }) }
          }
        }.width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
          .justifyContent(FlexAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
