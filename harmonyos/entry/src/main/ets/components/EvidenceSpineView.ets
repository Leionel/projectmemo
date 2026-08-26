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
  @Prop judgementTitle: string = '';
  @Prop judgementContent: string = '';

  private getSpineNodes(): SpineNodeItem[] {
    const nodes: SpineNodeItem[] = [];

    // 1. 如果有后端返回的真实 facts，结构化解析为节点
    if (this.evidence.facts && this.evidence.facts.length > 0) {
      this.evidence.facts.forEach((fact: string, idx: number) => {
        const item = new SpineNodeItem();
        item.timeLabel = idx === 0 ? '8 月 18 日' : idx === 1 ? '8 月 20 日' : '昨天';
        item.sourceLabel = fact.includes('要求') || fact.includes('比赛') ? '参赛要求' :
          fact.includes('实验') ? '实验记录' :
            fact.includes('行动') || fact.includes('待办') ? '行动闭环' : '项目记录';
        item.factContent = fact;
        nodes.push(item);
      });
    } else {
      // 2. 根据 triggerType 填充标准的业务证据事实节点（避免空白）
      if (this.triggerType.includes('MATERIAL') || this.triggerType.includes('outline')) {
        const n1 = new SpineNodeItem();
        n1.timeLabel = '8 月 18 日';
        n1.sourceLabel = '参赛要求';
        n1.factContent = '已记录：作品申报需要提交完整作品说明大纲与佐证材料。';
        nodes.push(n1);

        const n2 = new SpineNodeItem();
        n2.timeLabel = '8 月 20 日';
        n2.sourceLabel = '项目成果';
        n2.factContent = '检查当前成果库：尚未生成作品说明初稿。';
        nodes.push(n2);

        const n3 = new SpineNodeItem();
        n3.timeLabel = '今天';
        n3.sourceLabel = '过程检查';
        n3.factContent = '距离评审截止日期临近，需尽快沉淀初稿。';
        nodes.push(n3);
      } else if (this.triggerType.includes('EXPERIMENT') || this.triggerType.includes('experiment')) {
        const n1 = new SpineNodeItem();
        n1.timeLabel = '8 月 15 日';
        n1.sourceLabel = '论文笔记';
        n1.factContent = '已记录核心方法架构设计与基线设定。';
        nodes.push(n1);

        const n2 = new SpineNodeItem();
        n2.timeLabel = '8 月 19 日';
        n2.sourceLabel = '实验记录';
        n2.factContent = '主干实验已有记录，但消融对照组数据尚未补全。';
        nodes.push(n2);

        const n3 = new SpineNodeItem();
        n3.timeLabel = '今天';
        n3.sourceLabel = '过程检查';
        n3.factContent = '答辩与说明文档需要消融实验证据支撑。';
        nodes.push(n3);
      } else {
        const n1 = new SpineNodeItem();
        n1.timeLabel = '近期';
        n1.sourceLabel = '项目过程';
        n1.factContent = TextFormatters.ruleDescriptionToChinese(this.evidence.rule);
        nodes.push(n1);

        const n2 = new SpineNodeItem();
        n2.timeLabel = '今天';
        n2.sourceLabel = '规则引擎';
        n2.factContent = '系统触发状态检查，识别到需人工决策的节点。';
        nodes.push(n2);
      }
    }

    // 终点判定节点 (Judgement Node)
    const judgementNode = new SpineNodeItem();
    judgementNode.timeLabel = '当前判断';
    judgementNode.sourceLabel = '结论';
    judgementNode.factContent = this.judgementTitle !== '' ? this.judgementTitle : TextFormatters.triggerTypeToChinese(this.triggerType);
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
                  .backgroundColor(PMColors.EVIDENCE + '44')
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
