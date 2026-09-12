import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion } from '../common/DesignTokens';
import { MeetingAppliedChange, MeetingConfirmBody, MeetingConfirmResult, MeetingImpactPreview, MeetingPreviewInput, MeetingTypedChange } from '../models/Meeting';
import { ApiError } from '../models/Project';
import { MeetingService } from '../services/MeetingService';

// E5：会议文本导入。粘贴 → 预览（逐项勾选，待澄清项禁确认）→ 原子确认 → 会后 Diff。
// 编辑文本/日期会使旧 proposalVersion 失效，必须重新预览。
@Component
export struct MeetingImportSheet {
  @Prop projectId: string = '';
  @State draftText: string = '';
  @State meetingDate: string = '';
  @State preview: MeetingImpactPreview = new MeetingImpactPreview();
  @State hasPreview: boolean = false;
  @State selectedIds: string[] = [];
  @State isLoadingPreview: boolean = false;
  @State isConfirming: boolean = false;
  @State errorMessage: string = '';
  @State stage: string = 'draft'; // draft | preview | done
  @State applied: MeetingAppliedChange[] = [];
  @State afterSnapshotId: string = '';
  @State baseSnapshotId: string = '';
  private meetingService: MeetingService = new MeetingService();
  onClose: () => void = () => {};
  onShowDiff: (fromId: string, toId: string) => void = (_fromId: string, _toId: string) => {};

  private kindLabel(kind: string): string {
    if (kind === 'DECISION_SUPERSEDE') return '决策取代';
    if (kind === 'ACTION_CREATE') return '新增行动';
    if (kind === 'DEADLINE_CHANGE') return '截止变化';
    return '结论记录';
  }

  private kindColor(kind: string): ResourceColor {
    if (kind === 'DECISION_SUPERSEDE') return PMColors.RISK;
    if (kind === 'ACTION_CREATE') return PMColors.BRAND;
    if (kind === 'DEADLINE_CHANGE') return PMColors.EVIDENCE;
    return PMColors.SUCCESS;
  }

  private isSelected(changeId: string): boolean {
    return this.selectedIds.indexOf(changeId) >= 0;
  }

  private toggle(change: MeetingTypedChange): void {
    if (change.status !== 'PROPOSED') {
      return;
    }
    if (this.isSelected(change.changeId)) {
      this.selectedIds = this.selectedIds.filter((id: string) => id !== change.changeId);
    } else {
      const next: string[] = this.selectedIds.slice();
      next.push(change.changeId);
      this.selectedIds = next;
    }
  }

  private proposedCount(): number {
    let count = 0;
    for (let i = 0; i < this.preview.typedChanges.length; i++) {
      if (this.preview.typedChanges[i].status === 'PROPOSED') count += 1;
    }
    return count;
  }

  private async generatePreview(): Promise<void> {
    if (this.isLoadingPreview) {
      return;
    }
    if (this.draftText.trim().length < 5) {
      this.errorMessage = '会议文本请至少输入 5 个字';
      return;
    }
    const date = this.meetingDate.trim();
    if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.errorMessage = '会议日期格式须为 YYYY-MM-DD，留空则相对日期无法解析';
      return;
    }
    this.isLoadingPreview = true;
    this.errorMessage = '';
    try {
      const input = new MeetingPreviewInput();
      input.text = this.draftText;
      if (date !== '') {
        input.meetingDate = date;
      }
      this.preview = await this.meetingService.preview(this.projectId, input);
      this.hasPreview = true;
      this.stage = 'preview';
      this.selectedIds = [];
      this.baseSnapshotId = this.preview.baseSnapshotId;
    } catch (e) {
      // 失败保留输入，停留在草稿阶段
      this.errorMessage = e instanceof ApiError ? e.message : '预览生成失败，请稍后重试';
      this.stage = 'draft';
    } finally {
      this.isLoadingPreview = false;
    }
  }

  private backToDraft(): Promise<void> {
    this.hasPreview = false;
    this.stage = 'draft';
    this.selectedIds = [];
    return Promise.resolve();
  }

  private async confirmSelected(): Promise<void> {
    if (this.isConfirming || this.selectedIds.length === 0) {
      return;
    }
    this.isConfirming = true;
    this.errorMessage = '';
    try {
      const body = new MeetingConfirmBody();
      body.proposalId = this.preview.proposalId;
      body.sourceTextHash = this.preview.sourceTextHash;
      body.proposalVersion = this.preview.proposalVersion;
      body.selectedChangeIds = this.selectedIds;
      const result: MeetingConfirmResult = await this.meetingService.confirm(this.projectId, body);
      this.applied = result.applied;
      this.afterSnapshotId = result.afterSnapshotId !== null ? result.afterSnapshotId : '';
      this.stage = 'done';
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STATE_CHANGED_REPREVIEW') {
        // 预览后源状态变化：保留输入并重新预览
        this.errorMessage = '预览后相关决策已变化，已自动重新预览，请重新勾选确认';
        await this.generatePreview();
      } else {
        this.errorMessage = e instanceof ApiError ? e.message : '确认失败，可重试同一次确认（不会重复写入）';
      }
    } finally {
      this.isConfirming = false;
    }
  }

  @Builder
  private changeRow(change: MeetingTypedChange) {
    Column() {
      Row() {
        Text(this.kindLabel(change.kind))
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.kindColor(change.kind))
        Blank()
        if (change.status === 'PROPOSED') {
          Text(this.isSelected(change.changeId) ? '☑ 已勾选' : '☐ 勾选')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(this.isSelected(change.changeId) ? PMColors.BRAND : PMColors.INK_TERTIARY)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.toggle(change);
            })
            .accessibilityText(`勾选${change.title}`)
            .accessibilitySelected(this.isSelected(change.changeId))
        } else {
          Text('待澄清，不可确认')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
        }
      }
      .width('100%')

      Text(change.title)
        .fontSize(PMFontSize.BODY)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(20)
        .margin({ top: 4 })

      Text(`原文：${change.evidenceSpan}`)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
        .lineHeight(16)
        .margin({ top: 2 })

      if (change.kind === 'DECISION_SUPERSEDE' && change.supersededCardTitle !== null) {
        Text(`拟取代：${change.supersededCardTitle}`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
          .margin({ top: 2 })
      }
      if (change.kind === 'DEADLINE_CHANGE' && change.deadlineISO !== null) {
        Text(`新截止：${change.deadlineISO}`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.EVIDENCE)
          .margin({ top: 2 })
      }
      if (change.status === 'NEEDS_CLARIFICATION' && change.clarification !== null) {
        Text(change.clarification)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
          .lineHeight(16)
          .margin({ top: 2 })
      }
    }
    .width('100%')
    .padding(PMSpacing.SM)
    .backgroundColor(change.status === 'NEEDS_CLARIFICATION' ? PMColors.RISK_LIGHT : PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
    .margin({ bottom: PMSpacing.XS })
    .alignItems(HorizontalAlign.Start)
    .opacity(change.status === 'NEEDS_CLARIFICATION' ? 0.9 : 1)
  }

  build() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .onClick(() => {
          if (!this.isConfirming) {
            this.onClose();
          }
        })

      Column() {
        Row() {
          Text('导入会议文本')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Button('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor('transparent')
            .onClick(() => {
              if (!this.isConfirming) {
                this.onClose();
              }
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        if (this.stage === 'done') {
          Column() {
            Text('✓ 会议变更已确认写入')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SUCCESS)
            Text(`共 ${this.applied.length} 项变更；规则抽取，未使用模型语义理解。`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.XS })

            ForEach(this.applied, (item: MeetingAppliedChange) => {
              Row() {
                Text(this.kindLabel(item.kind))
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(this.kindColor(item.kind))
                Text(`${item.changeId}${item.newCardId !== null ? ' · 新记忆' : ''}${item.newActionId !== null ? ' · 新待办' : ''}${item.deadlineISO !== null ? ` · 截止 ${item.deadlineISO}` : ''}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .layoutWeight(1)
                  .margin({ left: PMSpacing.SM })
              }
              .width('100%')
              .padding({ top: PMSpacing.XS, bottom: PMSpacing.XS })
            }, (item: MeetingAppliedChange) => item.changeId)

            if (this.afterSnapshotId !== '' && this.baseSnapshotId !== '') {
              Button('查看会后变化对比')
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(48)
                .width('100%')
                .margin({ top: PMSpacing.MD })
                .onClick(() => {
                  this.onShowDiff(this.baseSnapshotId, this.afterSnapshotId);
                  this.onClose();
                })
            }
            Button('完成')
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.INK_SECONDARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .height(44)
              .width('100%')
              .margin({ top: PMSpacing.SM })
              .onClick(() => {
                this.onClose();
              })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        } else if (this.stage === 'preview') {
          Text(this.preview.summary)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: PMSpacing.XS })

          Scroll() {
            Column() {
              ForEach(this.preview.typedChanges, (change: MeetingTypedChange) => {
                this.changeRow(change)
              }, (change: MeetingTypedChange) => change.changeId)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
          .scrollable(ScrollDirection.Vertical)
          .layoutWeight(1)
          .margin({ top: PMSpacing.SM })

          if (this.errorMessage !== '') {
            Text(this.errorMessage)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.RISK)
              .margin({ top: PMSpacing.XS })
          }

          Text(`已勾选 ${this.selectedIds.length}/${this.proposedCount()} 项可确认变化`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })

          Row({ space: PMSpacing.SM }) {
            Button('修改文本')
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.INK_SECONDARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .height(48)
              .layoutWeight(1)
              .enabled(!this.isConfirming)
              .onClick(() => {
                this.backToDraft();
              })
            Button(this.isConfirming ? '确认中…' : `确认选中 ${this.selectedIds.length} 项`)
              .fontSize(PMFontSize.BUTTON)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(this.selectedIds.length > 0 ? PMColors.BRAND : PMColors.INK_MUTED)
              .borderRadius(PMRadius.SM)
              .height(48)
              .layoutWeight(1.4)
              .enabled(this.selectedIds.length > 0 && !this.isConfirming)
              .onClick(() => {
                this.confirmSelected();
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.MD })
        } else {
          Text('粘贴会议记录，系统按规则抽取候选变化（决策取代 / 新行动 / 截止变化 / 结论），逐项勾选后确认写入。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(16)
            .margin({ top: PMSpacing.XS })

          TextArea({ text: this.draftText, placeholder: '例如：会上决定将方案A改为方案B。张三需要完成测试报告。截止提前到 2026-10-01。' })
            .onChange((v: string) => {
              this.draftText = v;
            })
            .fontSize(PMFontSize.BODY)
            .height(140)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .margin({ top: PMSpacing.SM })
            .accessibilityText('输入会议文本')

          Text('会议日期（YYYY-MM-DD，用于解析“下周五”等相对日期）')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.SM })
          TextInput({ text: this.meetingDate, placeholder: '例如 2026-09-14，留空则相对日期标记待澄清' })
            .onChange((v: string) => {
              this.meetingDate = v;
            })
            .fontSize(PMFontSize.BODY)
            .height(44)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .margin({ top: PMSpacing.XS })

          if (this.errorMessage !== '') {
            Text(this.errorMessage)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.RISK)
              .margin({ top: PMSpacing.XS })
          }

          Button(this.isLoadingPreview ? '解析中…' : '生成预览')
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .height(48)
            .width('100%')
            .margin({ top: PMSpacing.MD })
            .enabled(!this.isLoadingPreview)
            .onClick(() => {
              this.generatePreview();
            })
        }
      }
      .width('92%')
      .height('85%')
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
