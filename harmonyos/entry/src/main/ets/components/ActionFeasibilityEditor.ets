import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion } from '../common/DesignTokens';
import { FeasibilityAssessment, FeasibilityDependency, FeasibilityInput, FeasibilityRequirementBody } from '../models/Action';
import { ApiError } from '../models/Project';
import { ActionService } from '../services/ActionService';
import { ProjectService } from '../services/ProjectService';
import { MilestoneService } from '../services/MilestoneService';

class PickerItem {
  kind: string = 'action';
  id: string = '';
  title: string = '';
}

// E4：行动可行性编辑——依赖增删、软硬切换、估时设置在同一半模态完成；
// 保存后由服务端按当前源状态重评，界面不缓存旧结论。
@Component
export struct ActionFeasibilityEditor {
  @Prop projectId: string = '';
  @Prop actionId: string = '';
  @Prop assessment: FeasibilityAssessment = new FeasibilityAssessment();
  @State deps: FeasibilityDependency[] = [];
  @State estimateText: string = '';
  @State pickerSource: string = 'action';
  @State pickerItems: PickerItem[] = [];
  @State hardRequirement: boolean = true;
  @State isSaving: boolean = false;
  @State editorError: string = '';
  @State pendingRequirementId: string = '';
  @State dependencyVersion: number = 1;

  private actionService: ActionService = new ActionService();
  private projectService: ProjectService = new ProjectService();
  private milestoneService: MilestoneService = new MilestoneService();
  onSaved: () => void = () => {};
  onClose: () => void = () => {};

  aboutToAppear(): void {
    this.deps = this.assessment.dependencies;
    this.dependencyVersion = this.assessment.dependencyVersion;
    this.estimateText = this.assessment.estimateMinutes !== null ? `${this.assessment.estimateMinutes}` : '';
    this.loadPicker('action');
  }

  private async loadPicker(source: string): Promise<void> {
    this.pickerSource = source;
    this.pickerItems = [];
    try {
      if (source === 'action') {
        const actions = await this.actionService.list(this.projectId);
        this.pickerItems = actions
          .filter((action) => action.id !== this.actionId && action.status !== 'DONE')
          .map((action): PickerItem => {
            const item = new PickerItem();
            item.kind = 'action';
            item.id = action.id;
            item.title = action.title;
            return item;
          });
      } else if (source === 'card') {
        const detail = await this.projectService.getProjectDetail(this.projectId);
        this.pickerItems = detail.cards.map((card): PickerItem => {
          const item = new PickerItem();
          item.kind = 'card';
          item.id = card.id;
          item.title = card.title;
          return item;
        });
      } else {
        const milestones = await this.milestoneService.list(this.projectId);
        const items: PickerItem[] = [];
        for (const milestone of milestones) {
          for (const deliverable of milestone.deliverables) {
            const item = new PickerItem();
            item.kind = 'deliverable';
            item.id = deliverable.id;
            item.title = `${milestone.title} · ${deliverable.title}`;
            items.push(item);
          }
        }
        this.pickerItems = items;
      }
    } catch (e) {
      this.editorError = e instanceof ApiError ? e.message : '候选列表加载失败';
    }
  }

  private async apply(input: FeasibilityInput): Promise<FeasibilityAssessment> {
    input.expectedVersion = this.dependencyVersion;
    const updated = await this.actionService.updateFeasibility(this.projectId, input);
    this.dependencyVersion = updated.dependencyVersion;
    return updated;
  }

  private async addRequirement(item: PickerItem): Promise<void> {
    if (this.isSaving) {
      return;
    }
    this.isSaving = true;
    this.editorError = '';
    try {
      const input = new FeasibilityInput();
      input.actionId = this.actionId;
      const requirement = new FeasibilityRequirementBody();
      requirement.targetKind = item.kind;
      requirement.targetId = item.id;
      requirement.hard = this.hardRequirement;
      input.addRequirements = [requirement];
      const updated = await this.apply(input);
      this.deps = updated.dependencies;
      // 移除已添加项，避免重复添加
      this.pickerItems = this.pickerItems.filter((candidate) => !(candidate.kind === item.kind && candidate.id === item.id));
    } catch (e) {
      this.editorError = e instanceof ApiError ? e.message : '添加依赖失败';
    } finally {
      this.isSaving = false;
    }
  }

  private async removeRequirement(dependency: FeasibilityDependency): Promise<void> {
    if (this.isSaving) {
      return;
    }
    this.isSaving = true;
    this.editorError = '';
    try {
      const input = new FeasibilityInput();
      input.actionId = this.actionId;
      input.removeRequirementIds = [dependency.requirementId];
      const updated = await this.apply(input);
      this.deps = updated.dependencies;
    } catch (e) {
      this.editorError = e instanceof ApiError ? e.message : '删除依赖失败';
    } finally {
      this.isSaving = false;
    }
  }

  private async saveEstimate(clear: boolean): Promise<void> {
    if (this.isSaving) {
      return;
    }
    const trimmed = this.estimateText.trim();
    let minutes: number | null = null;
    if (!clear) {
      if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) <= 0) {
        this.editorError = '估时必须是正整数分钟，不能包含其他字符';
        return;
      }
      minutes = Number.parseInt(trimmed, 10);
    }
    this.isSaving = true;
    this.editorError = '';
    try {
      const input = new FeasibilityInput();
      input.actionId = this.actionId;
      // 清空显式发 null（JSON 序列化保留），服务端将估时置空
      input.estimatedMinutes = clear ? null : minutes;
      await this.apply(input);
      this.estimateText = clear ? '' : trimmed;
    } catch (e) {
      this.editorError = e instanceof ApiError ? e.message : '估时保存失败';
    } finally {
      this.isSaving = false;
    }
  }

  build() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .onClick(() => {
          if (!this.isSaving) {
            this.onClose();
          }
        })

      Column() {
        Row() {
          Text('编辑依赖与估时')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Button('完成')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .height(36)
            .onClick(() => {
              this.onSaved();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        Text('说明：记录卡依赖表示“依赖该结论成立”，仅存在记录并不代表前提满足；服务端每次按当前状态重评。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(16)
          .margin({ top: PMSpacing.XS })

        // 当前依赖列表
        Column() {
          Text(`依赖 (${this.deps.length})`)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_SECONDARY)
          ForEach(this.deps, (dep: FeasibilityDependency) => {
            Row() {
              Column() {
                Text(`${dep.hard ? '硬依赖' : '参考'} · ${dep.targetTitle !== null ? dep.targetTitle : dep.note}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${dep.state} · ${dep.note}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 2 })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              Button('删除')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.RISK)
                .backgroundColor(PMColors.SURFACE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.XS)
                .height(32)
                .enabled(!this.isSaving)
                .margin({ left: PMSpacing.SM })
                .onClick(() => {
                  this.removeRequirement(dep);
                })
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
            .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
          }, (dep: FeasibilityDependency) => dep.requirementId)

          if (this.deps.length === 0) {
            Text('尚未声明依赖')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
        }
        .width('100%')
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ top: PMSpacing.SM })
        .alignItems(HorizontalAlign.Start)

        // 添加依赖：来源切换 + 候选列表
        Row({ space: PMSpacing.SM }) {
          Button('行动')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(this.pickerSource === 'action' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.pickerSource === 'action' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(36)
            .onClick(() => {
              this.loadPicker('action');
            })
          Button('记录卡')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(this.pickerSource === 'card' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.pickerSource === 'card' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(36)
            .onClick(() => {
              this.loadPicker('card');
            })
          Button('交付物')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(this.pickerSource === 'deliverable' ? PMColors.BRAND : PMColors.INK_SECONDARY)
            .backgroundColor(this.pickerSource === 'deliverable' ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(36)
            .onClick(() => {
              this.loadPicker('deliverable');
            })

          Blank()

          Button(this.hardRequirement ? '硬依赖' : '参考')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(this.hardRequirement ? PMColors.RISK : PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE)
            .border({ width: 1, color: this.hardRequirement ? PMColors.RISK : PMColors.BORDER })
            .borderRadius(PMRadius.XS)
            .height(36)
            .onClick(() => {
              this.hardRequirement = !this.hardRequirement;
            })
            .accessibilityText('切换硬依赖或参考')
        }
        .width('100%')
        .margin({ top: PMSpacing.SM })

        Scroll() {
          Column() {
            ForEach(this.pickerItems, (item: PickerItem) => {
              Row() {
                Text(item.title)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
                Text('＋ 添加')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.BRAND)
                  .margin({ left: PMSpacing.SM })
              }
              .width('100%')
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.XS)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.XS })
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.addRequirement(item);
              })
              .accessibilityText(`添加依赖：${item.title}`)
            }, (item: PickerItem) => `${item.kind}-${item.id}`)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .layoutWeight(1)
        .margin({ top: PMSpacing.SM })

        // 估时
        Row({ space: PMSpacing.SM }) {
          TextInput({ text: this.estimateText, placeholder: '估时（分钟，留空为未估算）' })
            .onChange((v: string) => {
              this.estimateText = v;
            })
            .fontSize(PMFontSize.CAPTION)
            .height(40)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .layoutWeight(1)
            .accessibilityText('预估完成分钟数')

          Button('清空')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.XS)
            .height(40)
            .enabled(!this.isSaving)
            .onClick(() => {
              this.saveEstimate(true);
            })
        }
        .width('100%')
        .margin({ top: PMSpacing.SM })

        if (this.editorError !== '') {
          Text(this.editorError)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
            .margin({ top: PMSpacing.XS })
        }
      }
      .width('92%')
      .height('80%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }
}
