import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton, PMStatusPill } from '../components/PMReferencePrimitives';
import { PMColors, PMFontSize, PMRadius, PMSpacing } from '../common/DesignTokens';
import { ApiError } from '../models/Project';
import { IntakeService } from '../services/IntakeService';
import { SessionStore } from '../services/SessionStore';
import {
  intakeCanConfirm, intakeCoverageItemLabel, intakeCoverageSummary, intakeEditableFields, intakeSyncSummary, intakeUnderstandingLabel,
  IntakeAcceptedFields, IntakeCandidate, IntakeCoverageItem, IntakeMaterialTextReply, IntakeMaterialView,
  IntakePreview, IntakeStatement, IntakeSyncReply, IntakeUnknown
} from '../models/ProjectIntake';

/**
 * 手机端的项目前材料核对：贴一段材料 → 看短预览 → 一句话纠正 → 确认。
 *
 * 与 Web 是同一份草稿与同一版预览；手机上不做“另一套理解”。
 * 文件材料在 Web 入口加入，手机先把文本材料这条链路走通。
 */
@Entry
@Component
struct ProjectIntake {
  @State private draftId: string = '';
  @State private preview: IntakePreview = new IntakePreview();
  @State private material: string = '';
  @State private correction: string = '';
  @State private accepted: IntakeAcceptedFields = new IntakeAcceptedFields();
  @State private busy: boolean = false;
  @State private error: string = '';
  @State private notice: string = '';
  @State private projectId: string = '';
  @State private sync: IntakeSyncReply | null = null;
  @State private loaded: boolean = false;
  // 原文核对：只展开一份材料，分页追加；关闭后不保留旧页，避免换草稿时串内容。
  @State private openTextMaterialId: string = '';
  @State private materialText: string = '';
  @State private materialTextOffset: number = 0;
  @State private materialTextTotal: number = 0;
  @State private materialTextHasMore: boolean = false;
  @State private materialTextLoading: boolean = false;
  private service: IntakeService = new IntakeService();
  private confirmRequestId: string = '';
  private requestKeys: Map<string, string> = new Map<string, string>();
  private confirmPayload: string = '';
  private acceptedDirty: boolean = false;
  private pageGeneration: number = 0;
  private active: boolean = true;
  private ownerToken: string = '';
  private sessionListener: () => void = () => {
    this.pageGeneration++;
    this.material = ''; this.correction = ''; this.preview = new IntakePreview(); this.accepted = new IntakeAcceptedFields();
    this.draftId = ''; this.projectId = ''; this.sync = null; this.requestKeys.clear(); this.confirmRequestId = ''; this.acceptedDirty = false;
    this.notice = ''; this.error = ''; this.busy = false; this.confirmPayload = '';
    this.openTextMaterialId = ''; this.materialText = ''; this.materialTextOffset = 0; this.materialTextTotal = 0; this.materialTextHasMore = false; this.materialTextLoading = false;
  };
  private stableId(key: string): string {
    if (!this.requestKeys.has(key)) this.requestKeys.set(key, this.requestId('intake'));
    return this.requestKeys.get(key) ?? '';
  }
  private async own<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.pageGeneration, token = SessionStore.getToken();
    if (!this.active || token === '') throw new ApiError('SESSION_CHANGED', '请重新进入原任务', 409);
    const value = await operation();
    if (!this.active || generation !== this.pageGeneration || token !== SessionStore.getToken())
      throw new ApiError('SESSION_CHANGED', '页面或账号已变化，请重新核对原结果', 409);
    return value;
  }
  aboutToDisappear(): void {
    this.active = false; this.pageGeneration++;
    SessionStore.offSessionExpired(this.sessionListener);
  }

  aboutToAppear(): void {
    if (this.ownerToken !== '' && this.ownerToken !== SessionStore.getToken()) this.sessionListener();
    this.ownerToken = SessionStore.getToken();
    this.active = true; this.pageGeneration++;
    SessionStore.offSessionExpired(this.sessionListener); SessionStore.onSessionExpired(this.sessionListener);
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    const existing = params === undefined || params === null ? '' : (params['draftId'] ?? '');
    if (existing !== '') {
      this.draftId = existing;
      this.refresh();
    } else {
      this.loaded = true;
    }
  }

  private requestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  private async refresh(): Promise<void> {
    if (this.draftId === '') return;
    try {
      const reply = await this.own(() => this.service.read(this.draftId));
      this.preview = reply.preview;
      if (!this.acceptedDirty) this.accepted = intakeEditableFields(reply.preview);
      // 草稿内容已变（修订前移）时放弃旧的原文页，避免把上一版正文当成当前。
      if (this.openTextMaterialId !== '' && !reply.preview.materials.some(item => item.id === this.openTextMaterialId)) this.closeMaterialText();
      this.loaded = true;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '无法读取这份材料';
    }
  }

  private closeMaterialText(): void {
    this.openTextMaterialId = ''; this.materialText = ''; this.materialTextOffset = 0;
    this.materialTextTotal = 0; this.materialTextHasMore = false; this.materialTextLoading = false;
  }

  /** 原文核对：打开一份材料并读第一页；再次点击同一份则收起。 */
  private async toggleMaterialText(materialId: string): Promise<void> {
    if (this.openTextMaterialId === materialId) { this.closeMaterialText(); return; }
    this.openTextMaterialId = materialId;
    this.materialText = ''; this.materialTextOffset = 0; this.materialTextTotal = 0;
    this.materialTextHasMore = false; this.materialTextLoading = false;
    await this.loadMaterialTextPage();
  }

  private async loadMaterialTextPage(): Promise<void> {
    if (this.draftId === '' || this.openTextMaterialId === '' || this.materialTextLoading) return;
    this.materialTextLoading = true; this.error = '';
    const materialId = this.openTextMaterialId;
    try {
      const reply = await this.own(() => this.service.materialText(this.draftId, materialId, this.materialTextOffset));
      if (this.openTextMaterialId !== materialId) return;
      this.appendMaterialText(reply);
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '读取原文失败';
    } finally { this.materialTextLoading = false; }
  }

  private appendMaterialText(reply: IntakeMaterialTextReply): void {
    this.materialText = this.materialText + reply.text;
    this.materialTextOffset = reply.offset + reply.text.length;
    this.materialTextTotal = reply.totalChars;
    this.materialTextHasMore = reply.hasMore;
  }

  private async ensureDraft(): Promise<string> {
    if (this.draftId !== '') return this.draftId;
    const created = await this.own(() => this.service.createDraft(this.stableId('draft')));
    this.draftId = created.draftId;
    return this.draftId;
  }

  private async addMaterial(): Promise<void> {
    const text = this.material.trim();
    if (text.length === 0) return;
    this.busy = true; this.error = ''; this.notice = '';
    try {
      const id = await this.ensureDraft();
      const requestId = this.stableId(`text:${id}:${text}`);
      await this.own(() => this.service.addText(id, requestId, text));
      if (this.material.trim() === text) this.material = '';
      await this.refresh();
      this.notice = '材料已保存为预览材料，还不是项目目标或授权。';
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '材料保存失败';
    } finally {
      this.busy = false;
    }
  }

  private async understand(): Promise<void> {
    this.busy = true; this.error = ''; this.notice = '';
    try {
      const id = await this.ensureDraft();
      await this.own(() => this.service.consent(id));
      const reply = await this.own(() => this.service.understand(id, this.stableId(`understand:${id}:${this.preview.previewHash}`)));
      this.preview = reply.preview;
      if (!this.acceptedDirty) this.accepted = intakeEditableFields(reply.preview);
      this.notice = reply.preview.understandingState === 'READY' ? 'Agent 已给出理解，请整体核对。' : intakeUnderstandingLabel(reply.preview.understandingState);
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '这次没能形成理解';
      await this.refresh();
    } finally {
      this.busy = false;
    }
  }

  private async revise(): Promise<void> {
    const text = this.correction.trim();
    if (text.length === 0 || this.preview.revision === 0) return;
    this.busy = true; this.error = ''; this.notice = '';
    try {
      const reply = await this.own(() => this.service.revise(this.draftId, this.requestId('revise'), text, this.preview.revision));
      this.correction = '';
      this.preview = reply.preview;
      if (!this.acceptedDirty) this.accepted = intakeEditableFields(reply.preview);
      if (reply.clarify !== null) this.notice = `需要先确认：${reply.clarify.question}`;
      else if (reply.appliedObjective !== '') this.notice = `已按你的话调整当前范围：${reply.appliedObjective}`;
      else this.notice = '这句话还只是解释候选，没有改变范围。';
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '纠正失败';
    } finally {
      this.busy = false;
    }
  }

  private async confirm(): Promise<void> {
    if (this.preview.previewHash === '' || this.busy) return;
    this.busy = true; this.error = ''; this.notice = '';
    try {
      // 同一份确认的请求身份在本地保持稳定：回包丢失后重试仍是同一次建项。
      const payload = JSON.stringify({ draftId: this.draftId, revision: this.preview.revision, hash: this.preview.previewHash, accepted: this.accepted });
      if (this.confirmRequestId === '' || this.confirmPayload !== payload) {
        this.confirmPayload = payload; this.confirmRequestId = this.requestId('confirm');
      }
      const reply = await this.own(() => this.service.confirm(this.draftId, this.confirmRequestId, this.preview.revision,
        this.preview.previewHash, this.accepted));
      this.projectId = reply.projectId;
      const synced = await this.own(() => this.service.sync(this.draftId));
      this.sync = synced;
      await this.refresh();
      this.notice = intakeSyncSummary(this.preview.materials);
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '确认建项失败';
    } finally {
      this.busy = false;
    }
  }

  private async retrySync(): Promise<void> {
    if (this.draftId === '' || this.busy) return;
    this.busy = true; this.error = '';
    try {
      this.sync = await this.own(() => this.service.sync(this.draftId));
      await this.refresh();
      this.notice = intakeSyncSummary(this.preview.materials);
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '重新同步失败';
    } finally {
      this.busy = false;
    }
  }

  private openProject(): void {
    if (this.projectId === '') return;
    router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.projectId } });
  }

  @Builder private MaterialList() {
    Column({ space: 6 }) {
      ForEach(this.preview.materials, (item: IntakeMaterialView) => {
        Row({ space: 8 }) {
          Text(item.label).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(item.extractionStatus === 'NEEDS_OCR' ? '无可读文本' :
            item.sync.state === 'SYNCED' ? '已进入项目' : item.sync.state === 'FAILED' ? '同步待重试' : '已保存')
            .fontSize(PMFontSize.CAPTION).fontColor(item.sync.state === 'FAILED' ? PMColors.RISK : PMColors.INK_TERTIARY)
        }.width('100%')
      }, (item: IntakeMaterialView) => item.id)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder private Statements() {
    Column({ space: 8 }) {
      Text('材料明确说了').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      ForEach(this.preview.statements, (statement: IntakeStatement) => {
        Column({ space: 4 }) {
          Text(`“${statement.quote}”`).fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
          Text(`${statement.materialLabel} · ${statement.meaning}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
        }.width('100%').alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.SM).borderRadius(PMRadius.SM).backgroundColor(PMColors.SURFACE_SUBTLE)
      }, (statement: IntakeStatement, index: number) => `${statement.materialId}-${index}`)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder private CoverageBlock() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text('模型实际读到的范围').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
        Text(intakeCoverageSummary(this.preview.coverage)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
      }.width('100%')
      ForEach(this.preview.coverage.current.items, (item: IntakeCoverageItem) => {
        Column({ space: 2 }) {
          Row({ space: 8 }) {
            Text(`${item.label}${item.type !== '' ? ' · ' + item.type : ''}`)
              .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(intakeCoverageItemLabel(item)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }.width('100%')
          if (item.availableChars > 0) {
            Text(this.openTextMaterialId === item.materialId ? '收起原文' : '核对原文')
              .fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).height(36)
              .onClick(() => { void this.toggleMaterialText(item.materialId); })
              .accessibilityText(`${item.label} 核对原文`)
          }
          if (this.openTextMaterialId === item.materialId) {
            Column({ space: 6 }) {
              Text(this.materialText !== '' ? this.materialText : (this.materialTextLoading ? '正在读取原文…' : '暂无原文页'))
                .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_PRIMARY).lineHeight(20)
              Text(`已显示 ${this.materialText.length} / ${this.materialTextTotal} 字`)
                .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
              if (this.materialTextHasMore) {
                Text(this.materialTextLoading ? '加载中…' : '继续读')
                  .fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).height(36)
                  .onClick(() => { void this.loadMaterialTextPage(); })
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding(8)
            .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM)
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }, (item: IntakeCoverageItem) => item.materialId)
      Text(this.preview.coverage.note).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      if (!this.preview.coverage.consentGranted) {
        Text('同意云处理后才会送入材料；撤回同意不会再次送入。')
          .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
      if (this.preview.coverage.current.stale) {
        Text('之后新增的材料还没有送入；建立项目后可在项目中继续深读全文。')
          .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(10)
    .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM)
  }

  @Builder private PreviewBody() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        PMStatusPill({ label: intakeUnderstandingLabel(this.preview.understandingState), tone: this.preview.understandingState === 'READY' ? 'brand' : 'neutral' })
        Text(`第 ${this.preview.revision} 版`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }.width('100%')
      if (this.preview.summary !== '') Text(this.preview.summary).fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
      if (this.preview.statements.length > 0) this.Statements()
      if (this.preview.suggested !== null) {
        Column({ space: 4 }) {
          Text('Agent 的建议（还不是目标）').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          Text(this.preview.suggested.title).fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          Text(this.preview.suggested.goal).fontSize(PMFontSize.BODY).fontColor(PMColors.INK_SECONDARY)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      if (this.preview.unknowns.length > 0) {
        Column({ space: 4 }) {
          Text('还不知道').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          ForEach(this.preview.unknowns, (item: IntakeUnknown) => {
            Text(item.text).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
          }, (item: IntakeUnknown, index: number) => `unknown-${index}`)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      if (this.preview.nextQuestion !== null) {
        Column({ space: 4 }) {
          Text('下一步最值得查清').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          Text(this.preview.nextQuestion.text).fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY)
          Text(this.preview.nextQuestion.why).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      if (this.preview.correction.appliedObjective !== '') {
        Text(`当前范围：${this.preview.correction.appliedObjective}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND)
      }
      ForEach(this.preview.correction.candidates, (candidate: IntakeCandidate) => {
        Text(`还没有生效的解释：“${candidate.quote}”`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }, (candidate: IntakeCandidate, index: number) => `candidate-${index}`)
      if (this.preview.correction.clarify !== null) {
        Text(this.preview.correction.clarify.question).fontSize(PMFontSize.BODY).fontColor(PMColors.RISK)
      }
      if (this.preview.materials.length > 0) this.CoverageBlock()
      if (this.preview.materials.length > 0) {
        Text(intakeSyncSummary(this.preview.materials)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }

  @Builder private ConfirmFields() {
    Column({ space: 10 }) {
      Text('写进项目的字段（可以直接改）').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      TextInput({ text: this.accepted.title, placeholder: '项目名称' })
        .onChange((value: string) => { this.acceptedDirty = true; this.accepted.title = value; }).height(44)
      TextArea({ text: this.accepted.description, placeholder: '项目描述' })
        .onChange((value: string) => { this.acceptedDirty = true; this.accepted.description = value; }).height(76)
      TextArea({ text: this.accepted.goal, placeholder: '项目目标' })
        .onChange((value: string) => { this.acceptedDirty = true; this.accepted.goal = value; }).height(76)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  build() {
    Column() {
      PMAppBar({ title: '从材料开始', backLabel: '项目', rightActionText: this.draftId === '' ? '' : '刷新',
        onRightTextAction: (): void => { this.error = ''; this.refresh(); } })
      Scroll() {
        Column({ space: 14 }) {
          if (this.error !== '') Text(this.error).fontSize(PMFontSize.CAPTION).fontColor(PMColors.RISK)
          if (this.notice !== '') Text(this.notice).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND)
          if (this.busy) Text('正在处理，请等待服务端回执').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)

          if (this.projectId === '') {
            Column({ space: 8 }) {
              Text('第一步 · 放材料').fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              Text('粘贴要求、记录或计划，先不用整理成完整目标。')
                .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
              TextArea({ text: this.material, placeholder: '例如课程要求、实验记录、群里的通知' })
                .onChange((value: string) => { this.material = value; }).height(120)
              Row({ space: 8 }) {
                PMButton({ label: '加入材料', disabled: this.busy || this.material.trim().length === 0,
                  onAction: (): void => { this.addMaterial(); } })
                PMButton({ label: '读懂材料', secondary: true, disabled: this.busy || this.preview.materials.length === 0,
                  onAction: (): void => { this.understand(); } })
              }
              if (this.preview.materials.length > 0) this.MaterialList()
            }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })

            if (this.preview.draftId !== '') this.PreviewBody()

            if (this.preview.draftId !== '' && this.preview.materials.length > 0) {
              Column({ space: 8 }) {
                Text('用一句话纠正').fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                Text('明确、在范围内的要求会直接生效；含糊的会留成待确认的解释。')
                  .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
                TextArea({ text: this.correction, placeholder: '例如：本周先确认设备可用性' })
                  .onChange((value: string) => { this.correction = value; }).height(76)
                PMButton({ label: '按这句话调整', secondary: true,
                  disabled: this.busy || this.correction.trim().length === 0 || this.preview.revision === 0,
                  onAction: (): void => { this.revise(); } })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
            }

            if (this.preview.draftId !== '' && this.preview.materials.length > 0) {
              Column({ space: 10 }) {
                this.ConfirmFields()
                PMButton({ label: '确认理解，建立项目', disabled: this.busy ||
                  !intakeCanConfirm(this.preview.status, this.preview.expiresAt, Date.now()) || this.accepted.goal.trim().length === 0,
                  onAction: (): void => { this.confirm(); } })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
            }
          } else {
            Column({ space: 10 }) {
              Text('项目已建立').fontSize(PMFontSize.TITLE).fontColor(PMColors.INK_PRIMARY)
              Text(intakeSyncSummary(this.preview.materials)).fontSize(PMFontSize.BODY).fontColor(PMColors.INK_SECONDARY)
              if (this.sync !== null && this.sync.pending > 0) {
                Text('还有材料没同步完成；项目已经存在，重试不会重复建项。')
                  .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
                PMButton({ label: '重新同步材料', secondary: true, disabled: this.busy,
                  onAction: (): void => { this.retrySync(); } })
              }
              PMButton({ label: '进入项目', onAction: (): void => { this.openProject(); } })
            }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
          }
        }.width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}





