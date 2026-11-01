import router from '@ohos.router';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMTransition, PMInteraction } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { MemoryIcon, TaskIcon, FolderIcon, DashboardIcon, PaperclipIcon, BookOpenIcon, AlertIcon } from '../components/PMIcons';

/**
 * 使用指南：按用户任务组织的产品说明。
 * 内容与当前实现对齐（2026-11 核对）：桌面卡片读取真实项目数据；提醒策略为账号级；
 * 小艺语音入口尚未接入。深入的技术口径见「个人设置 · 证据与记忆原则」。
 */

interface GuideEntry {
  key: string;
  icon: number;
  title: string;
  summary: string;
  detail: string;
}

interface GuideGroup {
  title: string;
  entries: GuideEntry[];
}

interface PrincipleRow {
  title: string;
  text: string;
}

interface SupportRow {
  label: string;
  items: string;
  labelColor: ResourceColor;
}

@Entry
@Component
struct FeatureGuide {
  @State expandedKey: string = '';

  private groups: GuideGroup[] = [
    {
      title: '记录与整理', entries: [
        {
          key: 'capture', icon: 1, title: '随手记录进展',
          summary: '文字、图片或 PDF，来源自动保留',
          detail: '在工作台随手记下实验现象、导师意见或会议结论，可标注来源类型；上传的附件保留原件，解析结果出错时可以纠错，旧提取文本会形成修订链，不会静默覆盖。'
        },
        {
          key: 'memory', icon: 2, title: '项目记忆档案',
          summary: '时间线查看每条记忆的当前状态',
          detail: '每条记忆标注当前有效 / 已被取代 / 存在冲突 / 待确认；可以确认来源（来源声明不等于事实证明），也能归档与恢复；顶栏搜索可按标题、摘要或关键词定位。'
        },
        {
          key: 'attach', icon: 3, title: '保存材料原件',
          summary: '解析失败也不丢失原文件',
          detail: 'PDF、图片等附件始终保留原件；解析状态如实展示，需要时可以重试提取。'
        }
      ]
    },
    {
      title: '理解变化', entries: [
        {
          key: 'state', icon: 4, title: '状态与变化对比',
          summary: '变了什么、依据是什么',
          detail: '在项目概览生成状态基线后，每次重要变化都能对比出差异，并逐条附上证据；已知风险与未知会如实展示，不会把「不知道」写成结论。'
        },
        {
          key: 'copilot', icon: 5, title: '问忆程问答',
          summary: '基于项目记忆回答，附资料依据',
          detail: '回答附带引用的资料入口，可点开核对原文；证据不足时明确说不知道。涉及业务变更的建议，都需要你确认后才会应用。'
        }
      ]
    },
    {
      title: '推进项目', entries: [
        {
          key: 'action', icon: 6, title: '行动与依赖',
          summary: '可开始 / 受阻 / 无法确认 三态判断',
          detail: '行动可声明依赖与估时；受阻时会建议「先解决依赖」的任务。完成行动需要留下结果回执，系统据此生成复盘记忆并闭环相关提醒。'
        },
        {
          key: 'reminder', icon: 7, title: '主动提醒',
          summary: '每日预算与免打扰时段按你的策略执行',
          detail: '在「个人设置 · 提醒策略」中配置每日上限与静默时段（支持跨午夜），对你的全部项目生效；每条提醒都说明「为什么是现在」，可延期或处理。'
        },
        {
          key: 'mission', icon: 8, title: '长期委托',
          summary: '把持续跟进的任务交给忆程',
          detail: '委托会按阶段推进并保留进展记录、备选方案与运行额度；继续运行、采纳方案都需要你确认，异常时会暂停并保留已执行步骤。'
        },
        {
          key: 'widget', icon: 9, title: '桌面服务卡片',
          summary: '在桌面查看所选项目的进展摘要',
          detail: '卡片读取所选项目的真实数据（状态与截止日），支持 2×2 与 2×4 两种尺寸；未选择项目时显示引导，不展示虚构数据。'
        }
      ]
    },
    {
      title: '整理成果', entries: [
        {
          key: 'artifact', icon: 10, title: '成果草稿生成',
          summary: '作品说明、答辩 PPT、README 大纲',
          detail: '基于项目记忆生成草稿，全部标记为待人工复核；生成是起点，不是交付。'
        },
        {
          key: 'audit', icon: 11, title: '证据核查',
          summary: '生成回执与当前重检两个口径',
          detail: '每份成果可以查看「生成时的依据」和「当前重新检查」的结果；导出时逐项附带证据状态，方便核对哪些结论仍然有支撑。'
        }
      ]
    }
  ];

  private principles: PrincipleRow[] = [
    { title: '保留来源', text: '每条结论都能追溯到原始记录；来源存在不等于事实成立，孤证不会被写成定论。' },
    { title: '需要确认', text: '重要变更先展示影响，由你确认后才生效；Agent 只提出候选。' },
    { title: '保留未知', text: '信息不足时明确标注「未知」，不会自动推断为「否」，也不会编造补充。' },
    { title: '版本可溯', text: '被取代的旧结论可以查看演化过程，但不再冒充当前事实。' },
    { title: '权限在服务端', text: '项目归属、审批与版本控制由服务端强制执行；Agent 无权绕过。' }
  ];

  private supportRows: SupportRow[] = [
    { label: '已可用', labelColor: PMColors.SUCCESS, items: '记录文字与图片、上传 PDF、附件解析与纠错、状态基线与变化对比、行动依赖与结果回执、成果草稿与证据核查、桌面服务卡片（真实项目数据）、提醒预算与静默时段（预算开关需在服务端开启）' },
    { label: '需要配置', labelColor: PMColors.WARNING, items: '在线模型问答与成果生成（需配置 OpenAI 兼容 API）、语义检索（需配置 embedding 服务）' },
    { label: '暂不支持', labelColor: PMColors.INK_TERTIARY, items: '关闭应用后的定时推送提醒、拍摄录入、小艺语音入口（平台能力尚未接入）' },
    { label: '演示数据', labelColor: PMColors.INK_TERTIARY, items: '演示情境始终明确标识，不计入真实行为与效果统计' }
  ];

  /** 跳回主界面指定页签：通过 AppStorage 传递意图，返回后由 Index.onPageShow 消费 */
  private goMainTab(tab: number): void {
    AppStorage.setOrCreate<number>('pm.pendingMainTab', tab);
    router.back();
  }

  @Builder
  private EntryIcon(icon: number) {
    if (icon === 1 || icon === 3) {
      PaperclipIcon({ iconSize: 18, color: PMColors.BRAND })
    } else if (icon === 2 || icon === 9) {
      MemoryIcon({ isSelected: true, iconSize: 18 })
    } else if (icon === 4) {
      DashboardIcon({ isSelected: true, iconSize: 18 })
    } else if (icon === 5 || icon === 11) {
      BookOpenIcon({ iconSize: 18, color: PMColors.BRAND })
    } else if (icon === 6) {
      TaskIcon({ isSelected: true, iconSize: 18 })
    } else if (icon === 7) {
      AlertIcon({ iconSize: 18, color: PMColors.BRAND })
    } else {
      FolderIcon({ isSelected: true, iconSize: 18 })
    }
  }

  @Builder
  private GuideEntryRow(entry: GuideEntry) {
    Column() {
      Row() {
        this.EntryIcon(entry.icon)
        Column({ space: 2 }) {
          Text(entry.title)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text(entry.summary)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: PMSpacing.SM })

        Text(this.expandedKey === entry.key ? '⌄' : '›')
          .fontSize(18)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        this.expandedKey = this.expandedKey === entry.key ? '' : entry.key;
      })
      .accessibilityText(`${entry.title}，${entry.summary}，点击${this.expandedKey === entry.key ? '收起' : '展开'}说明`)

      if (this.expandedKey === entry.key) {
        Text(entry.detail)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .margin({ top: PMSpacing.SM, left: 30, right: PMSpacing.SM })
          .transition(PMTransition.CONTENT_ENTER)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
  }

  @Builder
  private GuideGroupCard(group: GuideGroup) {
    Column() {
      Text(group.title)
        .fontSize(PMFontSize.SECONDARY)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_TERTIARY)
        .width('100%')
        .margin({ bottom: PMSpacing.XS })

      ForEach(group.entries, (entry: GuideEntry, index: number) => {
        this.GuideEntryRow(entry)
        if (index < group.entries.length - 1) {
          Divider().color(PMColors.BORDER_SUBTLE)
        }
      }, (entry: GuideEntry) => entry.key)
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private FlowStep(label: string) {
    Text(label)
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(PMColors.BRAND)
      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
      .backgroundColor(PMColors.BRAND_LIGHT)
      .borderRadius(PMRadius.FULL)
  }

  @Builder
  private JumpChip(label: string, tab: number) {
    Button(label, { type: ButtonType.Capsule })
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(PMColors.INK_SECONDARY)
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.FULL)
      .height(36)
      .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
      .accessibilityText(`前往${label}`)
      .onClick(() => {
        this.goMainTab(tab);
      })
  }

  build() {
    Column() {
      PMAppBar({
        title: '使用指南',
        subtitle: '忆程 ProjectMemo · 产品指南',
        showBack: true,
        backLabel: '设置',
        backDescription: '返回设置'
      })

      Scroll() {
        Column() {
          // 一、产品简介
          Text('让项目进展有迹可循')
            .fontSize(PMFontSize.PAGE_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .width('100%')
          Text('记录进展，核对变化，推进下一步。')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: PMSpacing.XS })
            .width('100%')

          // 二、核心工作流程：一行直观呈现，不要求左右滚动阅读
          Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center }) {
            this.FlowStep('记录')
            Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ left: 6, right: 6 })
            this.FlowStep('理解')
            Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ left: 6, right: 6 })
            this.FlowStep('确认')
            Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ left: 6, right: 6 })
            this.FlowStep('行动')
            Text('→').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ left: 6, right: 6 })
            this.FlowStep('回执')
          }
          .width('100%')
          .margin({ top: PMSpacing.LG })

          Text('这是帮助理解的简化循环；服务端实际按记忆时态、状态基线与提醒策略逐项评估，不以单一线性路径为准。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(18)
            .width('100%')
            .margin({ top: PMSpacing.SM })

          // 三、按任务了解功能
          Column({ space: PMSpacing.MD }) {
            ForEach(this.groups, (group: GuideGroup) => {
              this.GuideGroupCard(group)
            }, (group: GuideGroup) => group.title)
          }
          .width('100%')
          .margin({ top: PMSpacing.LG })
          .alignItems(HorizontalAlign.Start)

          // 四、忆程如何处理你的信息
          Text('忆程如何处理你的信息')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_TERTIARY)
            .width('100%')
            .margin({ top: PMSpacing.XL, bottom: PMSpacing.XS })

          Column() {
            ForEach(this.principles, (item: PrincipleRow, index: number) => {
              Row() {
                Text(item.title)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)
                  .width(88)
                Text(item.text)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
            }, (item: PrincipleRow) => item.title)
          }
          .width('100%')
          .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER_SUBTLE })

          // 五、功能支持情况：只描述经过代码核对的状态
          Text('功能支持情况')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_TERTIARY)
            .width('100%')
            .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS })

          Column() {
            ForEach(this.supportRows, (row: SupportRow, index: number) => {
              Row() {
                Text(row.label)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(row.labelColor)
                  .width(88)
                Text(row.items)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
            }, (row: SupportRow) => row.label)
          }
          .width('100%')
          .padding({ left: PMSpacing.LG, right: PMSpacing.LG })
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER_SUBTLE })

          // 六、前往功能：跳回主界面对应页签；项目内功能需先打开项目
          Text('前往功能')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_TERTIARY)
            .width('100%')
            .margin({ top: PMSpacing.LG, bottom: PMSpacing.XS })

          Column() {
            Row({ space: PMSpacing.SM }) {
              this.JumpChip('我的项目空间', 0)
              this.JumpChip('项目记忆档案', 1)
            }

            Row({ space: PMSpacing.SM }) {
              this.JumpChip('行动与提醒', 2)
              this.JumpChip('今日项目焦点', 4)
            }
            .margin({ top: PMSpacing.SM })

            Text('长期委托与问忆程在项目内使用：先在项目空间打开一个项目，再进入对应页签。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(18)
              .width('100%')
              .margin({ top: PMSpacing.SM })
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER_SUBTLE })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .constraintSize({ maxWidth: 720 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
