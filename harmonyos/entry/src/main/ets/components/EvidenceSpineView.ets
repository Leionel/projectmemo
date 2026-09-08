import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { AgentEvidence } from '../models/Intervention';
import { TextFormatters } from '../common/TextFormatters';
import { SpineNodeIcon } from './PMIcons';

export class SpineNodeItem {
  timeLabel: string = '';
  sourceLabel: string = '';
  factContent: string = '';
  isJudgement: boolean = false;
}

@Component
export struct EvidenceSpineView {
  @Prop evidence: AgentEvidence = new AgentEvidence();
  @Prop triggerType: string = '';
  @Prop isSimulated: boolean = false;
  @Prop judgementTitle: string = '';
  @Prop judgementContent: string = '';

  private extractTimeLabel(fact: string, evaluatedAt?: string): string {
    const match = fact.match(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)|(\d{1,2}月\d{1,2}日)/);
    if (match && match[0]) {
      return match[0];
    }
    if (evaluatedAt && evaluatedAt.length >= 10) {
      try {
        const d = new Date(evaluatedAt);
        if (!isNaN(d.getTime())) {
          const month = d.getMonth() + 1;
          const day = d.getDate();
          return `${month}月${day}日`;
        }
      } catch (_e) {
        // ignore
      }
    }
    return '时间未知';
  }

  private extractSourceLabel(fact: string): string {
    if (fact.includes('截止') || fact.includes('倒计时')) return '截止日期';
    if (fact.includes('要求') || fact.includes('比赛') || fact.includes('竞赛')) return '参赛要求';
    if (fact.includes('实验')) return '实验记录';
    if (fact.includes('行动') || fact.includes('待办')) return '行动闭环';
    if (fact.includes('活动') || fact.includes('停滞')) return '推进节奏';
    if (fact.includes('论文') || fact.includes('笔记')) return '论文笔记';
    if (fact.includes('风险')) return '风险识别';
    if (fact.includes('材料') || fact.includes('大纲')) return '交付材料';
    return '项目记录';
  }

  private getSpineNodes(): SpineNodeItem[] {
    const nodes: SpineNodeItem[] = [];

    // 1. 如果有后端返回的真实 facts，按真实时间与来源解析，不伪造任何日期
    if (this.evidence.facts && this.evidence.facts.length > 0) {
      this.evidence.facts.forEach((fact: string) => {
        const item = new SpineNodeItem();
        item.timeLabel = this.extractTimeLabel(fact, this.evidence.evaluatedAt);
        item.sourceLabel = this.extractSourceLabel(fact);
        if (this.isSimulated) {
          item.sourceLabel = `[模拟] ${item.sourceLabel}`;
        }
        item.factContent = TextFormatters.readableText(fact, '证据事实无法读取，请重新录入。');
        nodes.push(item);
      });
    } else {
      // 2. facts 为空时如实反映“证据不足”或“演示模拟”，绝不虚构日期与事实
      const item = new SpineNodeItem();
      if (this.isSimulated) {
        item.timeLabel = '模拟时点';
        item.sourceLabel = '演示情境';
        item.factContent = '当前为演示模拟场景，未产生真实事实记录。';
      } else {
        item.timeLabel = '时间未知';
        item.sourceLabel = '证据不足';
        item.factContent = this.evidence.rule !== ''
          ? `依据规则：${TextFormatters.ruleDescriptionToChinese(this.evidence.rule)}（未附加具体事实）`
          : '暂无结构化证据记录，建议核对上下文后再作决策。';
      }
      nodes.push(item);
    }

    // 终点判定节点 (Judgement Node)
    const judgementNode = new SpineNodeItem();
    judgementNode.timeLabel = this.isSimulated ? '模拟判断' : '当前判断';
    judgementNode.sourceLabel = '结论';
    judgementNode.factContent = this.judgementTitle !== '' ?
      TextFormatters.readableText(this.judgementTitle, '当前判断文本无法读取') : TextFormatters.triggerTypeToChinese(this.triggerType);
    judgementNode.isJudgement = true;
    nodes.push(judgementNode);

    return nodes;
  }

  build() {
    Column() {
      // 头部标题
      Row() {
        Text('提醒依据')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)

        Text('时间 — 来源 — 事实 — 判断')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .margin({ bottom: PMSpacing.MD })

      if (this.isSimulated) {
        Row() {
          Text('⚠ 演示模拟介入 · 事实不计入真实指标')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
        }
        .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: PMSpacing.XS, bottom: PMSpacing.XS })
        .backgroundColor(PMColors.RISK_LIGHT)
        .borderRadius(PMRadius.SM)
        .margin({ bottom: PMSpacing.MD })
      }

      // 纵向证据脊线流 (Evidence Spine)
      Column() {
        ForEach(this.getSpineNodes(), (node: SpineNodeItem, index: number) => {
          Row() {
            // 左侧：时间轴与脊线连线
            Column() {
              SpineNodeIcon({ isJudgement: node.isJudgement, color: node.isJudgement ? PMColors.RISK : PMColors.EVIDENCE })

              if (index < this.getSpineNodes().length - 1) {
                Column()
                  .width(1.5)
                  .height(34)
                  .backgroundColor(PMColors.EVIDENCE_TINT)
                  .margin({ top: 4 })
              }
            }
            .width(20)
            .alignItems(HorizontalAlign.Center)
            .margin({ right: PMSpacing.MD })

            // 右侧：节点事实卡片
            Column() {
              Row() {
                Text(node.timeLabel)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(node.isJudgement ? FontWeight.Bold : FontWeight.Medium)
                  .fontColor(node.isJudgement ? PMColors.RISK : PMColors.INK_SECONDARY)

                Text(` · ${node.sourceLabel}`)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_TERTIARY)
              }

              Text(node.factContent)
                .fontSize(PMFontSize.BODY)
                .fontWeight(node.isJudgement ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(node.isJudgement ? PMColors.INK_PRIMARY : PMColors.INK_SECONDARY)
                .lineHeight(20)
                .margin({ top: 3 })
            }
            .layoutWeight(1)
            .padding({ bottom: index < this.getSpineNodes().length - 1 ? PMSpacing.LG : 0 })
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
        }, (node: SpineNodeItem, index: number) => `spine-${index}`)
      }
      .width('100%')
      .padding({ top: PMSpacing.SM })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .alignItems(HorizontalAlign.Start)
  }
}
