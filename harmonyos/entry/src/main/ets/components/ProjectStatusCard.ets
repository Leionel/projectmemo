import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { ProjectDashboard } from '../models/Project';

@Component
export struct ProjectStatusCard {
  @Prop dashboard: ProjectDashboard = new ProjectDashboard();

  build() {
    Column() {
      // 顶行：备赛进度条与就绪度
      Row() {
        Column() {
          Text('备赛健康度')
            .fontSize(PMFontSize.SM)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_SECONDARY)
          Text(`${this.dashboard.readiness.percentage}%`)
            .fontSize(PMFontSize.DISPLAY)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.BRAND)
            .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)

        Column() {
          if (this.dashboard.deadline.label !== '') {
            Row() {
              Text('⏳ ')
                .fontSize(PMFontSize.SM)
              Text(this.dashboard.deadline.label)
                .fontSize(PMFontSize.SM)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.RISK)
            }
            .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: PMSpacing.XS, bottom: PMSpacing.XS })
            .backgroundColor(PMColors.RISK_LIGHT)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.RISK + '33' })
          } else {
            Text('未设截止日')
              .fontSize(PMFontSize.SM)
              .fontColor(PMColors.INK_TERTIARY)
          }
        }
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)

      // 进度指示条
      Stack({ alignContent: Alignment.Start }) {
        Row()
          .width('100%')
          .height(6)
          .backgroundColor(PMColors.BORDER)
          .borderRadius(PMRadius.FULL)

        Row()
          .width(`${Math.min(100, Math.max(0, this.dashboard.readiness.percentage))}%`)
          .height(6)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.FULL)
      }
      .width('100%')
      .margin({ top: PMSpacing.MD, bottom: PMSpacing.LG })

      // 底行：两项关键指标
      Row() {
        Row() {
          Circle({ width: 8, height: 8 })
            .fill(this.dashboard.activeReminderCount > 0 ? PMColors.RISK : PMColors.SUCCESS)
            .margin({ right: PMSpacing.SM })
          Text(`活跃提醒 ${this.dashboard.activeReminderCount}`)
            .fontSize(PMFontSize.BASE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)

        Row() {
          Circle({ width: 8, height: 8 })
            .fill(this.dashboard.activeActionCount > 0 ? PMColors.BRAND : PMColors.INK_TERTIARY)
            .margin({ right: PMSpacing.SM })
          Text(`进行中行动 ${this.dashboard.activeActionCount}`)
            .fontSize(PMFontSize.BASE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
        }
        .layoutWeight(1)
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ left: PMSpacing.MD })
      }
      .width('100%')
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
  }
}
