import router from '@ohos.router';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { MarkdownView } from '../components/MarkdownView';
import { LoadingStateView } from '../components/AsyncStateView';

// 功能介绍文档：与 App 内实际能力保持同步，更新功能时同时更新本文件。
const FEATURE_DOC: string = `# 忆程 ProjectMemo 功能说明

忆程是一款**证据驱动的项目过程档案与决策手账**：把实验、导师意见、会议结论这类项目碎片沉淀为可追溯的记忆，在你确认后推进项目，并诚实标注"哪些还不知道"。

## 核心循环

1. **记录**：在工作台随手记文字、选择图片或上传 PDF，来源自动保留；
2. **确认**：决策变更先预览影响，你勾选确认后才生效；
3. **对比**：系统在关键节点生成"状态基线"，之后每次变化都能对比出"变了什么、依据是什么"；
4. **收尾**：完成行动时写下结果回执，自动写入记忆形成闭环。

## 工作台

- **状态与变化**：本次变化、最大已知风险/未知、建议下一步；点开可看每条变化的证据。首次使用先生成状态基线。
- **当前状态**：准备度、交付缺口与截止日期倒计时。
- **近期变化 / 主动提醒**：记忆与行动的最新动态；提醒遵守你在项目设置里配置的每日预算与静默时段。

## 记忆

- 记忆时间线展示每条记录的时态状态：当前有效 / 已被取代 / 存在冲突 / 待确认。
- **决策演化链**：原决策 → 替代决策 → 确认时间 → 原因，逐条可追溯。
- 长按展开可**确认来源**（来源声明，不等于事实证明）或**归档**（可恢复的展示偏好，可在时间线页「已归档」列表恢复）。
- 附件纠错保留旧提取文本，形成修订链；旧数值不再冒充当前值。

## 待办

- 行动可声明依赖与估时，系统给出 **可开始 / 受阻 / 无法确认** 三态判断；受阻时可一键创建"先解决依赖"任务。
- 完成行动必须留下结果回执，系统据此生成复盘记忆并闭环相关提醒。

## 问忆程

- 基于项目记忆的问答；每条回答附带证据回执。
- 证据不足时明确说"我不知道"，不会用模板话术填补。

## 成果

- 一键生成作品说明大纲、答辩 PPT 大纲等草稿。
- **证据审计**：每份成果可查看"生成时回执"与"当前重新检查"两个口径，导出时逐项附带证据状态。

## 设计理念

- **证据档案（Evidence Ledger）**：拒绝无事实支撑的模板化输出，以事实证据脊线支撑备赛与研发决策。
- **时态账本**：记忆有版本与有效期；被取代的旧结论可追溯，但不再冒充当前事实。
- **诚实的不确定性**：信息不足时保持"未知"，不猜测、不编造；演示数据一律明确标识。

## 功能状态说明

- **可用**：记录文字、选择图片、上传 PDF、决策变更确认、状态基线与变化对比、变化简报、行动依赖与估时、提醒预算与静默时段（部分开关需在服务端环境开启）
- **需配置**：在线模型问答与成果生成（需配置 OpenAI 兼容 API）；语义检索（需配置 embedding 服务）
- **示例**：桌面卡片看板（示例数据，未接实时项目）；演示情境（不计入真实指标）
- **未完成**：关闭 App 后的定时主动提醒、拍摄照片、小艺语音入口

## 数据与安全

- API 密钥只用于当前本地运行，不在界面回显；长期配置请使用部署环境变量。
- 规则引擎无需配置模型 API，结果按本地规则生成并可复核；App 仍需连接项目服务端读写数据。
`;

@Entry
@Component
struct FeatureGuide {
  @State content: string = '';

  aboutToAppear(): void {
    // 文档为内置常量，直接渲染；如需远程/文件加载，在此处替换 content 来源
    this.content = FEATURE_DOC;
  }

  @Builder
  private CoreCycleBar() {
    Column() {
      Text('核心闭环流程 (Human-in-the-Loop)')
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ bottom: PMSpacing.SM })

      Scroll() {
        Row({ space: 4 }) {
          this.StepNode('1', '记录', '碎片与附件')
          Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          this.StepNode('2', '确认', '影响与演化')
          Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          this.StepNode('3', '对比', '基线与Diff')
          Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          this.StepNode('4', '介入', '为什么是现在')
          Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          this.StepNode('5', '行动', '依赖与执行')
          Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY)
          this.StepNode('6', '收尾', '回执沉淀闭环')
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: PMSpacing.MD })
  }

  @Builder
  private StepNode(num: string, title: string, desc: string) {
    Column() {
      Row() {
        Text(num)
          .fontSize(10)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.SURFACE)
          .width(16)
          .height(16)
          .borderRadius(8)
          .backgroundColor(PMColors.BRAND)
          .textAlign(TextAlign.Center)
        Text(title)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .margin({ left: 4 })
      }
      Text(desc)
        .fontSize(10)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ top: 2 })
    }
    .padding({ left: 8, right: 8, top: 6, bottom: 6 })
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column() {
      PMAppBar({
        title: '功能介绍',
        subtitle: '忆程 ProjectMemo · 说明文档',
        showBack: true,
        backLabel: '设置',
        backDescription: '返回设置'
      })

      if (this.content === '') {
        LoadingStateView({ message: '正在载入文档...' })
      } else {
        Scroll() {
          Column() {
            // 核心循环工作流图
            this.CoreCycleBar()

            // 完整功能与设计理念 Markdown
            MarkdownView({ content: this.content })
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .constraintSize({ maxWidth: 720 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
