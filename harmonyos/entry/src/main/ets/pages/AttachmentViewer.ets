import router from '@ohos.router';
import pasteboard from '@ohos.pasteboard';
import promptAction from '@ohos.promptAction';
import { common, wantConstant } from '@kit.AbilityKit';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { Attachment } from '../models/Attachment';
import { ApiError } from '../models/Project';
import { AttachmentService } from '../services/AttachmentService';
import { SessionStore } from '../services/SessionStore';
import { attachmentPreviewKind, attachmentSaveName, attachmentSize, attachmentStatus } from '../common/AttachmentPresentation';
import { PMColors } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton, PMStatusPill } from '../components/PMReferencePrimitives';

class AttachmentParams { projectId: string = ''; attachmentId: string = ''; }

@Entry
@Component
struct AttachmentViewer {
  @State item: Attachment = new Attachment();
  @State loading: boolean = true;
  @State error: string = '';
  @State originalError: string = '';
  @State localUri: string = '';
  @State showText: boolean = false;
  @State saving: boolean = false;
  private projectId: string = '';
  private attachmentId: string = '';
  private active: boolean = false;
  private generation: number = 0;
  private localPath: string = '';
  private session: string = '';
  private service: AttachmentService = new AttachmentService();
  private onExpired: () => void = (): void => { this.clearOriginal(); this.error = '登录状态已失效，请返回后重新登录'; };

  aboutToAppear(): void {
    const params = router.getParams() as AttachmentParams;
    this.projectId = params.projectId ?? '';
    this.attachmentId = params.attachmentId ?? '';
    this.active = true;
    SessionStore.onSessionExpired(this.onExpired);
    this.load();
  }

  aboutToDisappear(): void {
    this.active = false;
    this.generation++;
    SessionStore.offSessionExpired(this.onExpired);
    this.clearOriginal();
  }

  private clearOriginal(): void {
    this.localUri = '';
    if (this.localPath !== '') {
      try { fileIo.unlinkSync(this.localPath); } catch (_) {}
      this.localPath = '';
    }
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.session = SessionStore.getToken();
    this.loading = true; this.error = ''; this.originalError = '';
    this.clearOriginal();
    try {
      const items = await this.service.list(this.projectId);
      if (!this.active || generation !== this.generation || SessionStore.getToken() !== this.session) return;
      const found = items.find((a: Attachment) => a.id === this.attachmentId);
      if (found === undefined) throw new ApiError('NOT_FOUND', '这份附件已不存在或当前不可访问');
      this.item = found;
      try {
        const data = await this.service.original(this.projectId, this.attachmentId);
        if (!this.active || generation !== this.generation || SessionStore.getToken() !== this.session) return;
        // 路径不使用服务端文件名，离开页面即移除缓存。
        const context = getContext(this) as common.UIAbilityContext;
        this.localPath = `${context.cacheDir}/attachment-${Date.now()}-${generation}`;
        const file = fileIo.openSync(this.localPath, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
        try { fileIo.writeSync(file.fd, data); } finally { fileIo.closeSync(file); }
        this.localUri = fileUri.getUriFromPath(this.localPath);
      } catch (error) {
        if (this.active && generation === this.generation) this.originalError = error instanceof ApiError ? error.message : '原件暂时无法读取，请重试';
      }
    } catch (error) {
      if (this.active && generation === this.generation) this.error = error instanceof ApiError ? error.message : '附件信息加载失败，请重试';
    } finally {
      if (this.active && generation === this.generation) this.loading = false;
    }
  }

  private async openInApp(): Promise<void> {
    if (this.localUri === '' || SessionStore.getToken() !== this.session) return;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      await context.startAbility({ action: 'ohos.want.action.viewData', uri: this.localUri,
        type: this.item.mimeType, flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION });
    } catch (_) {
      promptAction.showToast({ message: '此设备没有可打开该格式的应用，请保存原件后查看' });
    }
  }

  private async save(): Promise<void> {
    if (this.saving || this.localPath === '' || SessionStore.getToken() !== this.session) return;
    this.saving = true;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const uris = await new picker.DocumentViewPicker(context).save({ newFileNames: [attachmentSaveName(this.item.fileName)] });
      if (uris.length === 0 || !this.active || SessionStore.getToken() !== this.session) return;
      const output = fileIo.openSync(uris[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try { fileIo.copyFileSync(this.localPath, output.fd); } finally { fileIo.closeSync(output); }
      promptAction.showToast({ message: '原件已保存到所选位置' });
    } catch (_) { promptAction.showToast({ message: '未保存原件，可重新选择保存位置' }); }
    finally { this.saving = false; }
  }

  build() {
    Column() {
      PMAppBar({ title: '附件原件', backLabel: '资料' })
      if (this.loading) { LoadingProgress().width(32).height(32).margin(24) }
      else if (this.error !== '') {
        Column({ space: 14 }) {
          Text(this.error).fontColor(PMColors.RISK)
          PMButton({ label: '重新加载', onAction: (): void => { this.load(); } })
        }.padding(20)
      } else {
        Scroll() {
          Column({ space: 16 }) {
            Column({ space: 8 }) {
              PMStatusPill({ label: attachmentStatus(this.item) })
              Text(this.item.fileName).fontSize(20).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
              Text(`${attachmentSize(this.item.size)} · ${(this.item.createdAt ?? '').substring(0, 10)}`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }.width('100%').alignItems(HorizontalAlign.Start)
            if (this.originalError !== '') {
              Text(this.originalError).width('100%').fontSize(14).fontColor(PMColors.RISK)
              PMButton({ label: '重新读取原件', secondary: true, onAction: (): void => { this.load(); } })
            }
            if (this.localUri !== '') {
              if (attachmentPreviewKind(this.item.mimeType) === 'image') {
                Image(this.localUri).width('100%').height(380).objectFit(ImageFit.Contain).backgroundColor(PMColors.SURFACE)
                  .onError(() => { this.originalError = '图片无法预览，可保存原件后查看'; })
              } else {
                Column({ space: 10 }) {
                  Text(attachmentPreviewKind(this.item.mimeType) === 'pdf' ? 'PDF 原件已就绪' : '附件原件已就绪')
                    .fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
                  Text('使用手机上的对应应用打开，也可以保存到指定位置。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
                  PMButton({ label: attachmentPreviewKind(this.item.mimeType) === 'pdf' ? '打开 PDF 原件 →' : '用其他应用打开 →', secondary: true,
                    onAction: (): void => { this.openInApp(); } })
                }.width('100%').padding(16).backgroundColor(PMColors.SURFACE).borderRadius(18).alignItems(HorizontalAlign.Start)
              }
              PMButton({ label: this.saving ? '正在保存…' : '保存原件到手机', disabled: this.saving, onAction: (): void => { this.save(); } })
            }
            Column({ space: 12 }) {
              Row() {
                Text('提取文本').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
                Button(this.showText ? '收起' : '展开', { type: ButtonType.Normal }).height(44).backgroundColor(Color.Transparent)
                  .fontColor(PMColors.BRAND).onClick(() => { this.showText = !this.showText; })
              }.width('100%')
              if (this.showText) {
                Text((this.item.extractedText ?? '').trim() === '' ? '尚未提取到文本。可返回项目的记录入口重试提取或人工校对。' : this.item.extractedText)
                  .fontSize(15).lineHeight(24).fontColor(PMColors.INK_SECONDARY).copyOption(CopyOptions.LocalDevice)
                if ((this.item.extractedText ?? '').trim() !== '') {
                  PMButton({ label: '复制提取文本', secondary: true, onAction: (): void => {
                    pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.item.extractedText))
                      .then(() => { promptAction.showToast({ message: '已复制提取文本' }); })
                      .catch(() => { promptAction.showToast({ message: '复制失败，请重试' }); });
                  } })
                }
              }
            }.width('100%').padding(16).backgroundColor(PMColors.SURFACE).borderRadius(18).alignItems(HorizontalAlign.Start)
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).align(Alignment.TopStart)
      }
    }.width('100%').height('100%').backgroundColor(PMColors.BACKGROUND)
  }
}
