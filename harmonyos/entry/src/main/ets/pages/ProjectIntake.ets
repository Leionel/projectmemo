import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { common } from '@kit.AbilityKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton, PMStatusPill } from '../components/PMReferencePrimitives';
import { PMColors, PMFontSize, PMRadius, PMSpacing } from '../common/DesignTokens';
import { ApiError } from '../models/Project';
import { IntakeService } from '../services/IntakeService';
import { SessionStore } from '../services/SessionStore';
import {
  intakeAppliedObjective, intakeCanConfirm, intakeCoverageItemLabel, intakeFileName, intakeMaterialStatusLabel, intakeCoverageSummary, intakeEditableFields, intakeOriginalPageMatches, intakeOriginalViewKey, intakeSyncSummary, intakeUnderstandingLabel,
  IntakeAcceptedFields, IntakeCandidate, IntakeCoverageItem, IntakeMaterialTextReply, IntakeMaterialView,
  IntakePreview, IntakeStatement, IntakeSyncReply, IntakeUnknown
} from '../models/ProjectIntake';

/**
 * 手机端的项目前材料核对：贴文字或加文件 → 看短预览 → 一句话纠正 → 确认。
 *
 * 与 Web 是同一份草稿与同一版预览；手机上不做“另一套理解”。
 * 图片识别要走云模型，先取得这份草稿的云处理同意；PDF 由服务端抽取文本。
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
  private materialTextGeneration: number = 0;
  private sessionListener: () => void = () => {
    this.pageGeneration++;
    this.material = ''; this.correction = ''; this.preview = new IntakePreview(); this.accepted = new IntakeAcceptedFields();
    this.draftId = ''; this.projectId = ''; this.sync = null; this.requestKeys.clear(); this.confirmRequestId = ''; this.acceptedDirty = false;
    this.notice = ''; this.error = ''; this.busy = false; this.confirmPayload = '';
    this.materialTextGeneration++;
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
    this.closeMaterialText();
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
      if (intakeOriginalViewKey(this.preview) !== intakeOriginalViewKey(reply.preview)) this.closeMaterialText();
      this.preview = reply.preview;
      if (!this.acceptedDirty) this.accepted = intakeEditableFields(reply.preview);
      this.loaded = true;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '无法读取这份材料';
    }
  }

  private closeMaterialText(): void {
    this.materialTextGeneration++;
    this.openTextMaterialId = ''; this.materialText = ''; this.materialTextOffset = 0;
    this.materialTextTotal = 0; this.materialTextHasMore = false; this.materialTextLoading = false;
  }

  /** 原文核对：打开一份材料并读第一页；再次点击同一份则收起。 */
  private async toggleMaterialText(materialId: string): Promise<void> {
    if (this.openTextMaterialId === materialId) { this.closeMaterialText(); return; }
    this.closeMaterialText();
    this.openTextMaterialId = materialId;
    this.materialText = ''; this.materialTextOffset = 0; this.materialTextTotal = 0;
    this.materialTextHasMore = false; this.materialTextLoading = false;
    await this.loadMaterialTextPage();
  }

  private async loadMaterialTextPage(): Promise<void> {
    if (this.draftId === '' || this.openTextMaterialId === '' || this.materialTextLoading) return;
    this.materialTextLoading = true; this.error = '';
    const materialId = this.openTextMaterialId;
    const generation = this.materialTextGeneration, viewKey = intakeOriginalViewKey(this.preview);
    try {
      const reply = await this.own(() => this.service.materialText(this.draftId, materialId, this.materialTextOffset));
      if (generation !== this.materialTextGeneration || viewKey !== intakeOriginalViewKey(this.preview) || this.openTextMaterialId !== materialId) return;
      if (!intakeOriginalPageMatches(this.preview, materialId, reply)) {
        this.closeMaterialText();
        this.error = '原文版本已变化或无法核对，请刷新材料预览后重新打开原文';
        return;
      }
      this.appendMaterialText(reply);
    } catch (e) {
      if (generation === this.materialTextGeneration) {
        this.closeMaterialText();
        this.error = e instanceof ApiError ? e.message : '读取原文失败';
      }
    } finally { if (generation === this.materialTextGeneration) this.materialTextLoading = false; }
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
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '材料保存失败';
    } finally {
      this.busy = false;
    }
  }

  private async chooseAttachment(): Promise<void> {
    if (this.busy) return;
    let index = -1;
    try {
      index = (await promptAction.showActionMenu({ title: '添加附件', buttons: [
        { text: '拍照', color: '#0A7EA4' }, { text: '从相册选图片', color: '#0A7EA4' }, { text: '选择 PDF', color: '#0A7EA4' }
      ] })).index;
    } catch (_e) { return; }
    if (index === 0) await this.takePhoto();
    else if (index === 1) await this.pickImage();
    else if (index === 2) await this.pickPdf();
  }

  /** 图片要发给云模型识别，服务端要求这份草稿已有同意；取消就不上传。 */
  private async confirmImageProcessing(): Promise<boolean> {
    if (this.preview.coverage !== undefined && this.preview.coverage.consentGranted) return true;
    try {
      const choice = await promptAction.showDialog({ title: '发送给云模型识别？', message: '图片会发给云模型提取文字，只用于这份材料预览。',
        buttons: [{ text: '取消', color: '#666666' }, { text: '继续', color: '#0A7EA4' }] });
      if (choice.index !== 1) return false;
      const id = await this.ensureDraft();
      await this.own(() => this.service.consent(id));
      return true;
    } catch (e) {
      if (e instanceof ApiError) this.error = e.message;
      return false;
    }
  }

  // 系统相机写入应用缓存，不申请相机权限；上传结束即删除缓存副本。
  private async takePhoto(): Promise<void> {
    if (!(await this.confirmImageProcessing())) return;
    const context = getContext(this) as common.UIAbilityContext;
    const localPath = `${context.cacheDir}/intake-photo-${Date.now()}.jpg`;
    try {
      fileIo.closeSync(fileIo.openSync(localPath, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC));
      const profile: cameraPicker.PickerProfile = { cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK, saveUri: fileUri.getUriFromPath(localPath) };
      const result = await cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], profile);
      if (result.resultCode === 0 && fileIo.statSync(localPath).size > 0) await this.uploadFile(localPath, `photo-${Date.now()}.jpg`, 'image/jpeg');
    } catch (_e) {
      this.error = '相机不可用，可以改从相册选图片';
    } finally {
      try { fileIo.unlinkSync(localPath); } catch (_e) {}
    }
  }

  private async pickImage(): Promise<void> {
    if (!(await this.confirmImageProcessing())) return;
    let uri = '';
    try {
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const result = await new photoAccessHelper.PhotoViewPicker().select(options);
      if (result.photoUris.length === 0) return;
      uri = result.photoUris[0];
    } catch (_e) { return; }
    await this.uploadPicked(uri, intakeFileName(uri, `image-${Date.now()}.jpg`), 'image/jpeg');
  }

  private async pickPdf(): Promise<void> {
    let uri = '';
    try {
      const options = new picker.DocumentSelectOptions();
      options.fileSuffixFilters = ['PDF|.pdf'];
      options.maxSelectNumber = 1;
      const uris = await new picker.DocumentViewPicker().select(options);
      if (uris.length === 0) return;
      uri = uris[0];
    } catch (_e) { return; }
    await this.uploadPicked(uri, intakeFileName(uri, `document-${Date.now()}.pdf`), 'application/pdf');
  }

  /** 选择器给的 URI 只有临时读权限，先复制进应用缓存再上传，结束后删除。 */
  private async uploadPicked(uri: string, name: string, mimeType: string): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    const localPath = `${context.cacheDir}/intake-${Date.now()}`;
    try {
      const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      try { fileIo.copyFileSync(source.fd, localPath); } finally { fileIo.closeSync(source); }
      await this.uploadFile(localPath, name, mimeType);
    } catch (_e) {
      this.error = '无法读取这个文件，请重新选择';
    } finally {
      try { fileIo.unlinkSync(localPath); } catch (_e) {}
    }
  }

  private async uploadFile(localPath: string, name: string, mimeType: string): Promise<void> {
    this.busy = true; this.error = ''; this.notice = '';
    try {
      const size = fileIo.statSync(localPath).size;
      if (size === 0 || size > 20 * 1024 * 1024) { this.error = '文件为空或超过 20MB'; return; }
      const id = await this.ensureDraft();
      const requestId = this.stableId(`file:${id}:${name}:${size}`);
      await this.own(() => this.service.addFile(id, requestId, localPath, name, mimeType));
      await this.refresh();
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '文件保存失败';
    } finally {
      this.busy = false;
    }
  }

  private async understand(): Promise<void> {
    if (this.material.trim() !== '') {
      await this.addMaterial();
      if (this.error !== '') return;
    }
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
      else if (intakeAppliedObjective(reply.appliedObjective) !== '') this.notice = `已按你的话调整当前范围：${reply.appliedObjective}`;
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
          Text(intakeMaterialStatusLabel(item))
            .fontSize(PMFontSize.CAPTION).fontColor(item.sync.state === 'FAILED' || item.extractionStatus === 'FAILED' ? PMColors.RISK : PMColors.INK_TERTIARY)
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
    if (this.preview.coverage !== undefined) {
    Column({ space: 8 }) {
      Text('模型实际读到的范围').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      Text(intakeCoverageSummary(this.preview.coverage)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
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
      if (this.preview.coverage.current.stale) {
        Text('之后新增的材料还没有送入；建立项目后可在项目中继续深读全文。')
          .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(10)
    .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM)
    }
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
      if (intakeAppliedObjective(this.preview.correction.appliedObjective) !== '') {
        Text(`当前范围：${this.preview.correction.appliedObjective}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND)
      }
      ForEach(this.preview.correction.candidates, (candidate: IntakeCandidate) => {
        Text(`还没有生效的解释：“${candidate.quote}”`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }, (candidate: IntakeCandidate, index: number) => `candidate-${index}`)
      if (this.preview.correction.clarify !== null) {
        Text(this.preview.correction.clarify.question).fontSize(PMFontSize.BODY).fontColor(PMColors.RISK)
      }
      if (this.preview.coverage !== undefined && this.preview.materials.length > 0) this.CoverageBlock()
      if (this.preview.coverage === undefined && this.preview.materials.length > 0) {
        Text('当前服务未提供材料覆盖记录，请核对后端版本；已保存不代表模型已读全文。')
          .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
      }
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
          if (this.busy) Text('处理中…').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)

          if (this.projectId === '') {
            Column({ space: 8 }) {
              TextArea({ text: this.material, placeholder: '粘贴课程要求、实验记录或群通知' })
                .onChange((value: string) => { this.material = value; }).height(112)
              Row({ space: 8 }) {
                Column() {
                  PMButton({ label: '加入文字', secondary: true, disabled: this.busy || this.material.trim().length === 0,
                    onAction: (): void => { this.addMaterial(); } })
                }.layoutWeight(1)
                Column() {
                  PMButton({ label: '添加附件', secondary: true, disabled: this.busy,
                    onAction: (): void => { this.chooseAttachment(); } })
                }.layoutWeight(1)
              }.width('100%')
              if (this.preview.materials.length > 0) this.MaterialList()
              PMButton({ label: this.preview.understandingState === 'READY' ? '重新读懂' : '读懂材料',
                disabled: this.busy || (this.preview.materials.length === 0 && this.material.trim().length === 0),
                onAction: (): void => { this.understand(); } })
              Text('读懂时会把材料发给云模型处理一次').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
            }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })

            if (this.preview.draftId !== '' && this.preview.understandingState !== 'NONE') this.PreviewBody()

            if (this.preview.draftId !== '' && this.preview.materials.length > 0 && this.preview.understandingState !== 'NONE') {
              Column({ space: 8 }) {
                Text('用一句话纠正').fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                TextArea({ text: this.correction, placeholder: '例如：本周先确认设备可用性' })
                  .onChange((value: string) => { this.correction = value; }).height(76)
                PMButton({ label: '按这句话调整', secondary: true,
                  disabled: this.busy || this.correction.trim().length === 0 || this.preview.revision === 0,
                  onAction: (): void => { this.revise(); } })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
            }

            if (this.preview.draftId !== '' && this.preview.materials.length > 0 && this.preview.understandingState !== 'NONE') {
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
