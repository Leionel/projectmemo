import util from '@ohos.util';
import { ConversationDraftStore } from '../services/ConversationDraftStore';
import { SessionStore } from '../services/SessionStore';
import promptAction from '@ohos.promptAction';
import { MissionResponsibilityView, MissionResponsibilityRevisionInput, MissionConstraints } from '../models/Mission';
import { MissionService } from '../services/MissionService';
import { ApiError } from '../models/Project';
import { PMColors, PMRadius } from '../common/DesignTokens';
import { missionToolLabel, editableMissionConstraints } from '../common/MissionContract';

class ResponsibilityEditorDraft {
  goal: string = ''; objective: string = ''; deadline: string = ''; version: string = ''; requestId: string = '';
}
@Component
export struct MissionResponsibilitySection {
  @Prop @Watch('onMissionIdChange') missionId: string = '';
  onRevised: () => void = (): void => {};
  @State data: MissionResponsibilityView | null = null;
  @State loading: boolean = true;
  @State editing: boolean = false;
  @State expanded: boolean = false;
  @State busy: boolean = false;
  @State error: string = '';
  @State goalDraft: string = '';
  @State workingObjectiveDraft: string = '';
  @State deadlineDraft: string = '';
  private editingInitialControlVersion: string = '';
  private clientRequestId: string = '';
  private timer: number = -1;
  private epoch: number = 0;
  private inFlight: boolean = false;
  @State pendingPayload: string = '';
  private storeReady: Promise<void> = Promise.resolve();
  private draftKey(): string { return `responsibility:${this.missionId}`; }

  aboutToAppear(): void {
    this.storeReady = ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id);
    this.restore(); this.startPolling();
  }

  aboutToDisappear(): void {
    this.epoch++; this.stopPolling();
  }

  private onMissionIdChange(): void {
    this.epoch++; this.inFlight = false; this.pendingPayload = '';
    this.data = null;
    this.loading = true;
    this.editing = false;
    this.expanded = false;
    this.clientRequestId = '';
    this.editingInitialControlVersion = '';
    this.error = '';
    this.restore();
  }

  private startPolling(): void {
    if (this.timer >= 0) return;
    this.timer = setInterval(() => {
      if (this.missionId !== '' && !this.busy) {
        this.load(true);
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private async restore(): Promise<void> {
    const token=this.epoch; await this.storeReady; if(token!==this.epoch)return;
    const saved=ConversationDraftStore.read(this.draftKey());
    if(saved.answer){try{
      const draft=JSON.parse(saved.answer) as ResponsibilityEditorDraft;
      this.goalDraft=draft.goal;this.workingObjectiveDraft=draft.objective;this.deadlineDraft=draft.deadline;
      this.editingInitialControlVersion=draft.version;this.clientRequestId=draft.requestId;this.pendingPayload=saved.directiveRequest;this.editing=true;
    }catch{this.error='原草稿暂不可读，请重新核对';}}
    await this.load();
  }
  private persist(): void {
    const entry=ConversationDraftStore.read(this.draftKey()), draft=new ResponsibilityEditorDraft();
    draft.goal=this.goalDraft;draft.objective=this.workingObjectiveDraft;draft.deadline=this.deadlineDraft;
    draft.version=this.editingInitialControlVersion;draft.requestId=this.clientRequestId;
    entry.answer=JSON.stringify(draft);entry.directiveRequest=this.pendingPayload;ConversationDraftStore.save(this.draftKey(),entry);
  }
  private async load(isBackground: boolean = false): Promise<void> {
    if(this.missionId===''||this.inFlight)return;
    const token=this.epoch,id=this.missionId;this.inFlight=true;
    try{
      const resp=await new MissionService().responsibility(id);
      if(token!==this.epoch||id!==this.missionId)return;
      this.data=resp;
      if(!this.editing){this.goalDraft=resp.goal;this.workingObjectiveDraft=resp.workingObjective||'';this.deadlineDraft=resp.deadline||'';}
      if(!isBackground)this.error='';
    }catch(e){
      if(token!==this.epoch)return;
      const error=e as ApiError;
      if(error.status===401||error.status===403||error.status===404){this.data=null;this.editing=false;}
      this.error=error.message||'责任合同暂不可读';
    }finally{if(token===this.epoch){this.inFlight=false;this.loading=false;}}
  }

  private startEditing(): void {
    if (this.data === null) return;
    this.editing = true;
    this.clientRequestId = util.generateRandomUUID(true);
    this.editingInitialControlVersion = this.data.controlVersion;
    this.goalDraft = this.data.goal;
    this.workingObjectiveDraft = this.data.workingObjective || '';
    this.deadlineDraft = this.data.deadline || '';
    this.error = '';this.persist();
  }

  private cancelEditing(): void {
    if(this.pendingPayload)return;
    const draft=ConversationDraftStore.read(this.draftKey());draft.answer='';draft.directiveRequest='';ConversationDraftStore.save(this.draftKey(),draft);
    this.editing = false;
    this.clientRequestId = '';
    this.editingInitialControlVersion = '';
    this.error = '';
    if (this.data !== null) {
      this.goalDraft = this.data.goal;
      this.workingObjectiveDraft = this.data.workingObjective || '';
      this.deadlineDraft = this.data.deadline || '';
    }
  }

  private async save(): Promise<void> {
    if (this.busy || this.data === null) return;
    if (this.goalDraft.trim().length === 0) {
      this.error = '请填写委托目标';
      return;
    }
    this.busy = true;
    this.error = '';const token=this.epoch,id=this.missionId;

    if (this.clientRequestId === '') {
      this.clientRequestId = util.generateRandomUUID(true);
    }

    try {
      let input = new MissionResponsibilityRevisionInput();
      input.requestId = this.clientRequestId;
      input.expectedControlVersion = this.editingInitialControlVersion !== '' ? this.editingInitialControlVersion : this.data.controlVersion;
      input.goal = this.goalDraft.trim();
      if (this.workingObjectiveDraft.trim() !== '') {
        input.workingObjective = this.workingObjectiveDraft.trim();
      }
      const constraints = this.data.constraints ? editableMissionConstraints(this.data.constraints) : new MissionConstraints();
      constraints.deadline = this.deadlineDraft.trim() !== '' ? this.deadlineDraft.trim() : null;
      input.constraints = constraints;
      if(this.pendingPayload)input=JSON.parse(this.pendingPayload) as MissionResponsibilityRevisionInput;
      else this.pendingPayload=JSON.stringify(input);
      this.persist();await this.storeReady;
      if(!await ConversationDraftStore.flush())throw new ApiError('DRAFT_NOT_SAVED','草稿尚未保存，暂未提交',0);
      if(token!==this.epoch)return;
      const updated = await new MissionService().reviseResponsibility(id, input);
      if(token!==this.epoch||id!==this.missionId)return;
      const saved=ConversationDraftStore.read(this.draftKey());saved.answer='';saved.directiveRequest='';ConversationDraftStore.save(this.draftKey(),saved);
      this.pendingPayload='';this.data = updated;
      this.editing = false;
      this.clientRequestId = '';
      this.editingInitialControlVersion = '';
      this.onRevised();
      try {
        promptAction.showToast({ message: '责任合同已更新' });
      } catch {}
    } catch (e) {
      if(token!==this.epoch)return;
      const failure=e as ApiError;
      if(failure.status>=400&&failure.status<500){this.pendingPayload='';this.clientRequestId='';this.persist();}
      if (e instanceof ApiError && (e.status === 409 || e.code === 'MISSION_CHANGED')) {
        this.error = '责任合同已被其他端更新，请核对最新内容（草稿已保留）';
        try {
          promptAction.showToast({ message: '责任合同冲突已保护' });
        } catch {}
        await this.load(true);

      } else {
        this.error = e instanceof ApiError ? e.message : '修订失败，请重试';
      }
    } finally {
      if(token===this.epoch)this.busy = false;
    }
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text('运行与接续').fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        if (this.data !== null) {
          Text(this.data.workerPresenceDetail?.mismatchReason ? '后台版本或配置与当前服务不一致' : this.data.workerPresenceDetail?.failedPhase ? '最近巡检失败，等待重试' : this.data.workerPresence === 'RECENT' ? '近期收到后台心跳' : this.data.workerPresence === 'STALE' ? '心跳超时' : '尚未观测到后台')
            .fontSize(12)
            .fontColor(this.data.workerPresence === 'RECENT' ? PMColors.SUCCESS : PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .borderRadius(PMRadius.SM)
        }
      }.width('100%').justifyContent(FlexAlign.SpaceBetween).alignItems(VerticalAlign.Center)

      if (this.error !== '') {
        Text(this.error).fontSize(12).fontColor(PMColors.RISK).width('100%')
      }

      if (this.editing && this.data !== null && this.editingInitialControlVersion !== '' && this.data.controlVersion !== this.editingInitialControlVersion) {
        Text('责任合同已被其他端更新，提交时将基于最新版本核对（草稿已保留）')
          .fontSize(12)
          .fontColor(PMColors.RISK)
          .width('100%')
      }

      if (this.loading && this.data === null) {
        Text('正在读取责任视图...').fontSize(13).fontColor(PMColors.INK_SECONDARY)
      } else if (this.data !== null && !this.editing) {
        if (this.data.nextCheckAt && this.data.nextCheckAt !== '') {
          Text('下次计划核对：' + this.data.nextCheckAt).fontSize(13).fontColor(PMColors.INK_SECONDARY).width('100%')
        }
        Button(this.expanded ? '收起委托范围与累计用量' : '查看委托范围与累计用量', { type: ButtonType.Normal })
          .height(44).width('100%').fontSize(14).fontColor(PMColors.BRAND)
          .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.SM)
          .onClick(() => { this.expanded = !this.expanded; })
        if (this.expanded) {
        Column({ space: 6 }) {
          Text('委托目标').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          Text(this.data.goal).fontSize(14).fontColor(PMColors.INK_PRIMARY).fontWeight(FontWeight.Medium)

          if (this.data.workingObjective && this.data.workingObjective !== '') {
            Text('当前重点').fontSize(12).fontColor(PMColors.INK_SECONDARY).margin({ top: 4 })
            Text(this.data.workingObjective).fontSize(13).fontColor(PMColors.INK_PRIMARY)
          }

          if (this.data.successCriteria && this.data.successCriteria.length > 0) {
            Column({ space: 4 }) {
              Text('验收准则').fontSize(11).fontColor(PMColors.INK_SECONDARY)
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.data.successCriteriaLabels || ['验收准则待读取'], (criterion: string) => {
                  Text(criterion)
                    .fontSize(11)
                    .fontColor(PMColors.BRAND)
                    .backgroundColor(PMColors.BRAND_LIGHT)
                    .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                    .borderRadius(PMRadius.SM)
                    .margin({ right: 6, bottom: 4 })
                }, (criterion: string) => criterion)
              }
            }.width('100%').margin({ top: 2 })
          }

          if (this.data.continuationPolicy && this.data.continuationPolicy.allowedTools && this.data.continuationPolicy.allowedTools.length > 0) {
            Column({ space: 4 }) {
              Text('允许工具').fontSize(11).fontColor(PMColors.INK_SECONDARY)
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.data.continuationPolicy.allowedTools, (tool: string) => {
                  Text(missionToolLabel(tool))
                    .fontSize(11)
                    .fontColor(PMColors.INK_SECONDARY)
                    .backgroundColor(PMColors.SURFACE)
                    .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                    .borderRadius(PMRadius.SM)
                    .margin({ right: 6, bottom: 4 })
                }, (tool: string) => tool)
              }
            }.width('100%').margin({ top: 2 })
          }

          Row({ space: 12 }) {
            Column({ space: 2 }) {
              Text('截止时间').fontSize(11).fontColor(PMColors.INK_SECONDARY)
              Text(this.data.deadline || '未限定').fontSize(12).fontColor(PMColors.INK_PRIMARY)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)

            Column({ space: 2 }) {
              Text('授权状态').fontSize(11).fontColor(PMColors.INK_SECONDARY)
              Text(this.data.permissionState === 'WITHIN_TIME_BOUNDARY' ? '许可期内' : this.data.permissionState === 'EXPIRED' ? '已到期' : '已停止')
                .fontSize(12).fontColor(PMColors.INK_PRIMARY)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').margin({ top: 4 })

          Column({ space: 4 }) {
            Text('累计消耗 / 总包').fontSize(12).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
            Row({ space: 16 }) {
              Text('模型：' + (this.data.budget.cumulativeUsed.models !== undefined ? this.data.budget.cumulativeUsed.models : 0).toString() + ' / ' + (this.data.budget.limits.models !== undefined ? this.data.budget.limits.models : (this.data.budget.limits.maxModels !== undefined ? this.data.budget.limits.maxModels : '待核对')).toString())
                .fontSize(12).fontColor(PMColors.INK_SECONDARY)
              Text('工具：' + (this.data.budget.cumulativeUsed.tools !== undefined ? this.data.budget.cumulativeUsed.tools : 0).toString() + ' / ' + (this.data.budget.limits.tools !== undefined ? this.data.budget.limits.tools : (this.data.budget.limits.maxTools !== undefined ? this.data.budget.limits.maxTools : '待核对')).toString())
                .fontSize(12).fontColor(PMColors.INK_SECONDARY)
            }
          }.width('100%').padding(8).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.SM).margin({ top: 4 })


          Button('修订责任范围', { type: ButtonType.Normal })
            .height(44)
            .borderRadius(PMRadius.BUTTON)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .onClick(() => { this.startEditing(); })
        }.width('100%').alignItems(HorizontalAlign.Start)
        }
      } else if (this.data !== null && this.editing) {
        if (this.pendingPayload === '' && this.data.controlVersion !== this.editingInitialControlVersion) {
          Button('核对最新版本，保留我的修改').height(44).onClick(() => { if(this.data){this.editingInitialControlVersion=this.data.controlVersion;this.clientRequestId=util.generateRandomUUID(true);this.persist();} })
        }
        Column({ space: 8 }) {
          Text('修订目标').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          TextInput({ text: this.goalDraft, placeholder: '委托目标' })
            .fontSize(13)
            .enabled(!this.busy && this.pendingPayload === '').onChange((v: string) => { this.goalDraft = v; this.persist(); })

          Text('当前重点（可选）').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          TextInput({ text: this.workingObjectiveDraft, placeholder: '留空沿用原目标' })
            .fontSize(13)
            .enabled(!this.busy && this.pendingPayload === '').onChange((v: string) => { this.workingObjectiveDraft = v; this.persist(); })

          Text('截止时间（ISO或格式化时间）').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          TextInput({ text: this.deadlineDraft, placeholder: '如 2026-10-31T20:00:00Z' })
            .fontSize(13)
            .enabled(!this.busy && this.pendingPayload === '').onChange((v: string) => { this.deadlineDraft = v; this.persist(); })

          Row({ space: 10 }) {
            Button('取消', { type: ButtonType.Normal })
              .height(44)
              .borderRadius(PMRadius.BUTTON)
              .fontColor(PMColors.INK_SECONDARY)
              .backgroundColor(PMColors.SURFACE)
              .enabled(!this.busy && this.pendingPayload === '').onClick(() => { this.cancelEditing(); })
            Button(this.busy ? '核对中...' : this.pendingPayload !== '' ? '核对上次提交结果' : '确认修订', { type: ButtonType.Normal })
              .height(44)
              .borderRadius(PMRadius.BUTTON)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .enabled(!this.busy && this.goalDraft.trim().length > 0)
              .onClick(() => { this.save(); })
          }.width('100%').justifyContent(FlexAlign.End)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .margin({ top: 8, bottom: 8 })
  }
}
