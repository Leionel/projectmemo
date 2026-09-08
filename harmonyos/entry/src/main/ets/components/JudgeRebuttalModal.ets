import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion, PMMaterial } from '../common/DesignTokens';

export class JudgeQuestionItem {
  id: string = '';
  question: string = '';
  tag: string = '';
  answer: string = '';
  isRefusal: boolean = false;
  evidenceRef: string = '';

  constructor(id: string, question: string, tag: string, answer: string, isRefusal: boolean, evidenceRef: string) {
    this.id = id;
    this.question = question;
    this.tag = tag;
    this.answer = answer;
    this.isRefusal = isRefusal;
    this.evidenceRef = evidenceRef;
  }
}

@Component
export struct JudgeRebuttalModal {
  @State selectedIndex: number = 0;
  onClose: () => void = () => {};

  private questions: JudgeQuestionItem[] = [
    new JudgeQuestionItem(
      'q1',
      '方案中途因算力超标突发改变，如何保证旧待办与成果不脱节？',
      '方案变更时态闭环',
      'ProjectMemo 内置时态账本引擎。当突发方案变更时，系统自动识别冲突记忆并建立 SUPERSEDES 取代链，批量将波及的旧待办行动作废（CANCELLED），同时在成果中将原引用断言标记为“已被新决策取代”，确保全链路严密闭环，杜绝脏数据。',
      false,
      '实现依据：时态账本引擎 (changeImpactService) 与 CardRelation 表'
    ),
    new JudgeQuestionItem(
      'q2',
      '你们项目宣称的性能指标提升，原始实验记录在哪里？',
      '证据可溯源性',
      '成果正文中的核心断言均可锚定底层真实碎片。点击“证据透视镜”可穿透查看关联的原始实验数据与日志记录，时间戳、操作人员与消融对照清晰可验。',
      false,
      '实现依据：Claim Auditor 证据透视抽屉与底库原始实验卡片'
    ),
    new JudgeQuestionItem(
      'q3',
      '本项目是否在极低功耗边缘设备（如低端 MCU）上做过压力实测？',
      '防幻觉确凿拒答',
      '【严谨拒答规范范式】遵循真实性与防幻觉底线：在真实运行中，当知识库与实验档案无对应实测记录时，系统严格执行拒答策略，不提供未经实测虚构断言，并建议立项发起实测补充。',
      true,
      '规范依据：学术诚信原则与动态检索无证据拒答规范'
    ),
    new JudgeQuestionItem(
      'q4',
      '如何证明整个项目的产出不是大模型凭空胡编（AI 幻觉）？',
      '学术诚信与存证',
      '系统实行“无证据不生成”原则（Evidence-Grounded）。每一个成果章节与行动建议均有底层知识碎片强校验，并在成果导出时自动附带完整的《过程证据与时态存证目录》，支持端到端核验。',
      false,
      '实现依据：带存证附录导出 (ExportFormatter) 与系统可信收据'
    )
  ];

  build() {
    Stack() {
      // 背景遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .onClick(() => {
          this.onClose();
        })

      // 弹窗本体
      Column() {
        // 标头
        Row() {
          Row() {
            Circle({ width: 8, height: 8 })
              .fill(PMColors.RISK)
              .margin({ right: PMSpacing.SM })
            Text('评委答辩质询透视镜 (Judge Rebuttal)')
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

        Text('【功能演示与防幻觉规范】内置典型答辩质询应对范式。真实联机环境下系统动态检索知识库，无证据时严格执行此“严谨拒答”规范。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.MD })

        // 问题选择胶囊
        Scroll() {
          Row() {
            ForEach(this.questions, (q: JudgeQuestionItem, index: number) => {
              Button(q.tag)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(this.selectedIndex === index ? FontWeight.Bold : FontWeight.Regular)
                .fontColor(this.selectedIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
                .backgroundColor(this.selectedIndex === index ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.XS)
                .border({ width: this.selectedIndex === index ? 2 : 1, color: this.selectedIndex === index ? PMColors.BRAND : PMColors.BORDER })
                .height(40)
                .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
                .margin({ right: PMSpacing.SM })
                .onClick(() => {
                  this.selectedIndex = index;
                })
            }, (q: JudgeQuestionItem) => q.id)
          }
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .margin({ bottom: PMSpacing.MD })

        // 当前质询与回答展示
        Scroll() {
          Column() {
            // 评委提问卡
            Column() {
              Row() {
                Text('⚖️ 评委质询：')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.RISK)
                Text(this.questions[this.selectedIndex].tag)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Text(this.questions[this.selectedIndex].question)
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
                .margin({ top: PMSpacing.XS })
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.RISK_LIGHT)
            .borderRadius(PMRadius.SM)

            // Agent 答辩辞
            Column() {
              Row() {
                Text('🤖 ProjectMemo 答辩响应：')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.questions[this.selectedIndex].isRefusal ? PMColors.RISK : PMColors.BRAND)

                Text(this.questions[this.selectedIndex].isRefusal ? '【确凿拒答 · 严守底线】' : '【证据确凿】')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.questions[this.selectedIndex].isRefusal ? PMColors.RISK : PMColors.SUCCESS)
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Text(this.questions[this.selectedIndex].answer)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(22)
                .margin({ top: PMSpacing.SM })

              // 证据链小注
              Row() {
                Text('🔗')
                  .fontSize(PMFontSize.CAPTION)
                  .margin({ right: 4 })
                Text(this.questions[this.selectedIndex].evidenceRef)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .layoutWeight(1)
              }
              .width('100%')
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.XS)
              .margin({ top: PMSpacing.MD })
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .margin({ top: PMSpacing.MD })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .constraintSize({ maxHeight: '60%' })
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
