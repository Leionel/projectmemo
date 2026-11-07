import promptAction from '@ohos.promptAction';
import util from '@ohos.util';
import { ApiError, Project } from '../models/Project';
import { MemoryService } from '../services/MemoryService';
import { PersonalMemoryCommandInput, PersonalMemoryService } from '../services/PersonalMemoryService';
import { ProjectService } from '../services/ProjectService';
import { PMColors, PMFontSize, PMRadius, PMSpacing } from '../common/DesignTokens';
import { PMButton, PMSheetHeader } from './PMReferencePrimitives';

const MIN_PROJECT_TEXT: number = 5;
const KIND_NAMES: string[] = ['协作偏好', '背景信息', '长期关注'];
const KIND_VALUES: string[] = ['PREFERENCE', 'BACKGROUND', 'FOCUS'];

/** 焦点页的快速记录：写进某个项目，或沉淀成个人记忆。复用现有接口，失败后原文保留可重试。 */
@Component
export struct QuickCaptureSheet {
  @Prop preferredProjectId: string = '';
  onClose: () => void = (): void => {};
  onSaved: () => void = (): void => {};
  @State private projects: Project[] = [];
  @State private projectIndex: number = 0;
  @State private kindIndex: number = 0;
  @State private personal: boolean = false;
  @State private text: string = '';
  @State private busy: boolean = false;
  @State private errorText: string = '';
  @State private loading: boolean = true;
  // 同一段内容重试时复用请求号，服务端按幂等处理；内容或去向改变后才换新。
  private requestId: string = '';
  private memoryService: MemoryService = new MemoryService();
  private personalService: PersonalMemoryService = new PersonalMemoryService();
  private projectService: ProjectService = new ProjectService();

  aboutToAppear(): void { this.loadProjects(); }

  private async loadProjects(): Promise<void> {
    try {
      this.projects = await this.projectService.listProjects();
      const preferred = this.projects.findIndex((project: Project) => project.id === this.preferredProjectId);
      this.projectIndex = preferred >= 0 ? preferred : 0;
      if (this.projects.length === 0) { this.personal = true; }
    } catch (error) {
      this.errorText = error instanceof ApiError ? error.message : '项目列表暂时读取失败，可以先记成个人记忆';
      this.personal = true;
    } finally {
      this.loading = false;
    }
  }

  private resetRequest(): void { this.requestId = ''; this.errorText = ''; }

  private canSave(): boolean {
    const length = this.text.trim().length;
    if (this.busy || this.loading) { return false; }
    return this.personal ? length > 0 : this.projects.length > 0 && length >= MIN_PROJECT_TEXT;
  }

  private async save(): Promise<void> {
    if (!this.canSave()) { return; }
    this.busy = true; this.errorText = '';
    if (this.requestId === '') { this.requestId = util.generateRandomUUID(); }
    const content = this.text.trim();
    try {
      if (this.personal) {
        const input = new PersonalMemoryCommandInput();
        input.requestId = this.requestId;
        input.operation = 'ADD_EXPLICIT';
        input.quote = content;
        input.kind = KIND_VALUES[this.kindIndex];
        await this.personalService.command(input);
        promptAction.showToast({ message: '已存入个人记忆' });
      } else {
        const saved = await this.memoryService.capture(this.projects[this.projectIndex].id, content, '随手记录', this.requestId);
        promptAction.showToast({ message: this.memoryService.captureModeLabel(saved) });
      }
      this.onSaved();
      this.onClose();
    } catch (error) {
      this.errorText = error instanceof ApiError ? error.message : '保存失败，内容还在，可以再试一次';
    } finally {
      this.busy = false;
    }
  }

  @Builder
  private DestinationTab(label: string, personal: boolean, enabled: boolean) {
    Text(label)
      .layoutWeight(1).height(40).textAlign(TextAlign.Center).borderRadius(PMRadius.SM)
      .fontSize(PMFontSize.SECONDARY)
      .fontWeight(this.personal === personal ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(this.personal === personal ? PMColors.BRAND : PMColors.INK_SECONDARY)
      .backgroundColor(this.personal === personal ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
      .opacity(enabled ? 1 : 0.5)
      .accessibilityText(`记到${label}`)
      .accessibilitySelected(this.personal === personal)
      .onClick(() => {
        if (!enabled || this.busy) { return; }
        this.personal = personal; this.resetRequest();
      })
  }

  build() {
    Column({ space: PMSpacing.MD }) {
      PMSheetHeader({ title: '记录进展', closeLabel: '关闭记录进展', closeDisabled: this.busy, onClose: (): void => { this.onClose(); } })
      Row({ space: PMSpacing.SM }) {
        this.DestinationTab('项目', false, this.projects.length > 0)
        this.DestinationTab('个人记忆', true, true)
      }.width('100%')
      if (this.personal) {
        Select(KIND_NAMES.map((name: string): SelectOption => ({ value: name } as SelectOption)))
          .selected(this.kindIndex).value(KIND_NAMES[this.kindIndex])
          .font({ size: PMFontSize.SECONDARY, weight: FontWeight.Regular }).fontColor(PMColors.INK_PRIMARY)
          .accessibilityText('个人记忆类型')
          .onSelect((index: number) => { this.kindIndex = index; this.resetRequest(); })
      } else if (this.projects.length > 0) {
        Select(this.projects.map((project: Project): SelectOption => ({ value: project.title } as SelectOption)))
          .selected(this.projectIndex).value(this.projects[this.projectIndex]?.title ?? '')
          .font({ size: PMFontSize.SECONDARY, weight: FontWeight.Regular }).fontColor(PMColors.INK_PRIMARY)
          .constraintSize({ maxWidth: '100%' })
          .accessibilityText('记录到哪个项目')
          .onSelect((index: number) => { this.projectIndex = index; this.resetRequest(); })
      }
      TextArea({ text: this.text, placeholder: this.personal ? '例如：以后技术讨论先给结论，再按需要展开。' : '导师意见、实验结果、代码报错等，至少 5 个字' })
        .fontSize(PMFontSize.BODY).height(112)
        .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM).border({ width: 1, color: PMColors.BORDER })
        .accessibilityText('记录内容')
        .onChange((value: string) => { this.text = value; this.resetRequest(); })
      if (this.errorText !== '') {
        Text(this.errorText).fontSize(PMFontSize.CAPTION).fontColor(PMColors.RISK).width('100%')
      }
      PMButton({ label: this.busy ? '正在保存…' : '保存', disabled: !this.canSave(), onAction: (): void => { this.save(); } })
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
  }
}
