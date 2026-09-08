import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion, PMMaterial } from '../common/DesignTokens';
import {
  ChangeImpactProposal,
  ChangeImpactItem,
  ConfirmChangeInput,
  NewActionPayload
} from '../models/DecisionImpact';
import { DecisionService } from '../services/DecisionService';
import { ApiError } from '../models/Project';

@Component
export struct ChangeImpactDialog {
  @Prop projectId: string = '';
  @State newFactText: string = '显存超标，方案A改为轻量方案B，截止时间提前2天';
  @State isAnalyzing: boolean = false;
  @State isConfirming: boolean = false;
  @State proposal: ChangeImpactProposal | null = null;
  @State errorMsg: string = '';
  @State successMsg: string = '';
  @State selectedCancelledActionIds: string[] = [];

  private decisionService: DecisionService = new DecisionService();
  onClose: () => void = () => {};
  onSuccess: () => void = () => {};

  private async analyzeImpact(): Promise<void> {
    const text = this.newFactText.trim();
    if (text.length < 5) {
      this.errorMsg = '请输入具体的决策变更事实（至少5个字）';
      return;
    }
    this.isAnalyzing = true;
    this.errorMsg = '';
    this.successMsg = '';
    try {
      const res = await this.decisionService.previewImpact(this.projectId, text);
      this.proposal = res;
      // 默认全选受影响待办
      const actionIds: string[] = [];
      for (const item of res.impactedActions) {
        actionIds.push(item.targetId);
      }
      this.selectedCancelledActionIds = actionIds;
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '分析决策影响失败，请检查网络');
    } finally {
      this.isAnalyzing = false;
    }
  }

  private toggleActionSelection(targetId: string): void {
    const index = this.selectedCancelledActionIds.indexOf(targetId);
    if (index >= 0) {
      const copy: string[] = [];
      for (const id of this.selectedCancelledActionIds) {
        if (id !== targetId) {
          copy.push(id);
        }
      }
      this.selectedCancelledActionIds = copy;
    } else {
      const copy: string[] = [];
      for (const id of this.selectedCancelledActionIds) {
        copy.push(id);
      }
      copy.push(targetId);
      this.selectedCancelledActionIds = copy;
    }
  }

  private async confirmChange(): Promise<void> {
    if (this.proposal === null) return;
    this.isConfirming = true;
    this.errorMsg = '';
    try {
      const input = new ConfirmChangeInput();
      input.proposalId = this.proposal.proposalId;
      input.newFactText = this.proposal.newFactText;
      input.supersededCardId = this.proposal.supersededCardId;
      input.cancelledActionIds = this.selectedCancelledActionIds;

      // 构造根据新决策自适应生成的待办
      const newAct = new NewActionPayload();
      newAct.title = `跟进新决策：${this.newFactText.substring(0, 24)}`;
      newAct.description = '系统基于最新突发变更自动推导生成';
      newAct.priority = 1;
      input.newActions = [newAct];

      await this.decisionService.confirmChange(this.projectId, input);
      this.successMsg = '时态闭环已建立！受影响待办已作废，新记忆已写入。';
      setTimeout(() => {
        this.onSuccess();
        this.onClose();
      }, 1000);
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '确认变更失败，请稍后重试');
    } finally {
      this.isConfirming = false;
    }
  }

  build() {
    Stack() {
      // 半透明背景遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .onClick(() => {
          if (!this.isAnalyzing && !this.isConfirming) {
            this.onClose();
          }
        })

      // 主体弹层
      Column() {
        // 标头
        Row() {
          Row() {
            Circle({ width: 8, height: 8 })
              .fill(PMColors.BRAND)
              .margin({ right: PMSpacing.SM })
            Text('决策变更影响评估 (时态闭环)')
              .fontSize(PMFontSize.TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
          }
          .alignItems(VerticalAlign.Center)

          Button('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor('transparent')
            .onClick(() => {
              this.onClose();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        Scroll() {
          Column() {
            // 说明文案
            Text('当导师方案突发变更或实验推翻预期时，系统将自动基于时态账本计算受波及的旧待办与成果草稿，一键原子闭环。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
              .margin({ top: PMSpacing.XS, bottom: PMSpacing.MD })

            // 快捷填充示例
            Row() {
              Text('预设情境：')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)

              Button('显存超标改方案B')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .borderRadius(PMRadius.XS)
                .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
                .margin({ right: PMSpacing.SM })
                .onClick(() => {
                  this.newFactText = '显存超标，方案A改为轻量方案B，截止时间提前2天';
                  this.proposal = null;
                })

              Button('弃用重型蒸馏')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .borderRadius(PMRadius.XS)
                .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
                .onClick(() => {
                  this.newFactText = '放弃大模型重型蒸馏训练方案，改用提示词蒸馏与端侧量化';
                  this.proposal = null;
                })
            }
            .width('100%')
            .margin({ bottom: PMSpacing.SM })

            // 变更输入框
            TextArea({ text: this.newFactText, placeholder: '输入发生的方案变更事实（如：原方案由于XXX废弃，改为YYY）' })
              .fontSize(PMFontSize.BODY)
              .height(72)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .onChange((v: string) => {
                this.newFactText = v;
              })

            // 评估触发按钮
            Button(this.isAnalyzing ? '正在检索时态账本…' : '分析受影响行动与成果 →')
              .fontSize(PMFontSize.BUTTON)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.SM)
              .height(44)
              .width('100%')
              .margin({ top: PMSpacing.MD })
              .enabled(!this.isAnalyzing)
              .onClick(() => {
                this.analyzeImpact();
              })

            // 错误/成功提示
            if (this.errorMsg !== '') {
              Text(this.errorMsg)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.SM })
            }
            if (this.successMsg !== '') {
              Text(this.successMsg)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.SUCCESS)
                .margin({ top: PMSpacing.SM })
            }

            // 影响评估结果卡片
            if (this.proposal !== null) {
              Column() {
                // 冲突与取代状态
                Row() {
                  Text('⚡ 时态取代：')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(PMColors.RISK)

                  Text(this.proposal.supersededCardTitle !== null ?
                    `将废弃旧记忆【${this.proposal.supersededCardTitle}】` :
                    '未发现直接冲突旧记忆，将作为新决策沉淀')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_PRIMARY)
                    .layoutWeight(1)
                }
                .width('100%')
                .padding(PMSpacing.SM)
                .backgroundColor(PMColors.RISK_LIGHT)
                .borderRadius(PMRadius.XS)
                .margin({ top: PMSpacing.MD })

                // 受影响行动列表
                Text(`受波及待办 (${this.proposal.impactedActions.length} 项需作废)`)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

                if (this.proposal.impactedActions.length === 0) {
                  Text('暂无直接关联的未完成旧待办')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                } else {
                  ForEach(this.proposal.impactedActions, (act: ChangeImpactItem) => {
                    Row() {
                      Checkbox({ name: act.targetId, group: 'impactedActions' })
                        .select(this.selectedCancelledActionIds.includes(act.targetId))
                        .selectedColor(PMColors.RISK)
                        .onChange((val: boolean) => {
                          this.toggleActionSelection(act.targetId);
                        })

                      Column() {
                        Row() {
                          Text('[建议作废]')
                            .fontSize(PMFontSize.CAPTION)
                            .fontColor(PMColors.RISK)
                            .fontWeight(FontWeight.Medium)
                            .margin({ right: PMSpacing.XS })
                          Text(act.title)
                            .fontSize(PMFontSize.BODY)
                            .fontColor(PMColors.INK_PRIMARY)
                            .layoutWeight(1)
                        }
                        .width('100%')

                        Text(act.impactReason)
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.INK_SECONDARY)
                          .margin({ top: 2 })
                      }
                      .layoutWeight(1)
                      .alignItems(HorizontalAlign.Start)
                      .margin({ left: PMSpacing.SM })
                    }
                    .width('100%')
                    .padding(PMSpacing.SM)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .margin({ top: PMSpacing.XS })
                  }, (act: ChangeImpactItem) => act.id)
                }

                // 受影响成果列表
                if (this.proposal.impactedArtifacts.length > 0) {
                  Text(`受波及成果 (${this.proposal.impactedArtifacts.length} 篇需重写)`)
                    .fontSize(PMFontSize.SECONDARY)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(PMColors.INK_PRIMARY)
                    .margin({ top: PMSpacing.MD, bottom: PMSpacing.XS })

                  ForEach(this.proposal.impactedArtifacts, (art: ChangeImpactItem) => {
                    Row() {
                      Text('⚠️')
                        .fontSize(PMFontSize.CAPTION)
                        .margin({ right: PMSpacing.SM })
                      Column() {
                        Text(art.title)
                          .fontSize(PMFontSize.BODY)
                          .fontColor(PMColors.INK_PRIMARY)
                        Text(art.impactReason)
                          .fontSize(PMFontSize.CAPTION)
                          .fontColor(PMColors.INK_SECONDARY)
                          .margin({ top: 2 })
                      }
                      .layoutWeight(1)
                      .alignItems(HorizontalAlign.Start)
                    }
                    .width('100%')
                    .padding(PMSpacing.SM)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .margin({ top: PMSpacing.XS })
                  }, (art: ChangeImpactItem) => art.id)
                }

                // 一键确认闭环按钮
                Button(this.isConfirming ? '正在原子同步时态账本…' : '确认采纳并作废旧行动')
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.RISK)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .width('100%')
                  .margin({ top: PMSpacing.LG })
                  .enabled(!this.isConfirming)
                  .onClick(() => {
                    this.confirmChange();
                  })
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .constraintSize({ maxHeight: '70%' })
      }
      .width('92%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .shadow({ radius: 20, color: 'rgba(0, 0, 0, 0.15)', offsetX: 0, offsetY: 8 })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.95, y: 0.95 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }
}
