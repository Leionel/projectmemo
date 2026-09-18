const ACTION_ROUTER: string = 'router';
const ABILITY_NAME: string = 'EntryAbility';
let storage = new LocalStorage();

@Entry(storage)
@Component
struct WidgetCard {
  /* 存储卡片数据（未收到真实推送前显示示例数据，需明确标识） */
  @LocalStorageProp('formDimension') formDimension: number = 3; // 2=2*2, 3=2*4
  @LocalStorageProp('projectTitle') projectTitle: string = '忆程备赛看板（示例数据）';
  @LocalStorageProp('daysLeft') daysLeft: number = 2;
  @LocalStorageProp('readiness') readiness: number = 80;
  @LocalStorageProp('nextAction') nextAction: string = '示例：连接后端后显示真实待办';
  @LocalStorageProp('status') status: string = '示例数据';

  build() {
    Column() {
      // ------------------------------------
      // 顶栏：圆点 + 项目标题 + 倒计时胶囊
      // ------------------------------------
      Row() {
        Row() {
          Row()
            .width(8)
            .height(8)
            .borderRadius(4)
            .backgroundColor('#E5484D')
            .margin({ right: 6 })

          Text(this.projectTitle)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#0F172A')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .layoutWeight(1)
        .alignItems(VerticalAlign.Center)

        Row() {
          Text('仅剩 ')
            .fontSize(10)
            .fontColor('#E5484D')
          Text(`${this.daysLeft}`)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#E5484D')
          Text(' 天')
            .fontSize(10)
            .fontColor('#E5484D')
        }
        .padding({ left: 6, right: 6, top: 2, bottom: 2 })
        .backgroundColor('#FFEBEB')
        .borderRadius(10)
        .margin({ left: 6 })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // ------------------------------------
      // 中间：准备度指标 + 状态标签 + 弹性全宽进度条
      // ------------------------------------
      Column() {
        Row() {
          Row() {
            Text('准备度 ')
              .fontSize(11)
              .fontColor('#64748B')
            Text(`${this.readiness}%`)
              .fontSize(18)
              .fontWeight(FontWeight.Bolder)
              .fontColor('#0284C7')
          }
          .alignItems(VerticalAlign.Bottom)

          Text(this.status)
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor('#0284C7')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .backgroundColor('#E0F2FE')
            .borderRadius(4)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        // 弹性自适应进度条
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(5)
            .backgroundColor('#E2E8F0')
            .borderRadius(3)
          Row()
            .width(`${Math.min(100, Math.max(0, this.readiness))}%`)
            .height(5)
            .backgroundColor('#0284C7')
            .borderRadius(3)
        }
        .width('100%')
        .margin({ top: 4 })
      }
      .width('100%')
      .margin({ top: 4, bottom: 4 })

      // ------------------------------------
      // 底栏：今日第一要务卡片（点击直达待办）
      // ------------------------------------
      Column() {
        Row() {
          Text('今日第一要务')
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .fontColor('#0F172A')
          Text('→')
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor('#0284C7')
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        Text(this.nextAction)
          .fontSize(11)
          .fontColor('#0284C7')
          .fontWeight(FontWeight.Medium)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ top: 2 })
      }
      .width('100%')
      .padding({ left: 8, right: 8, top: 6, bottom: 6 })
      .backgroundColor('#F1F5F9')
      .border({ width: 1, color: '#E2E8F0' })
      .borderRadius(8)
    }
    .width('100%')
    .height('100%')
    .padding(10)
    .backgroundColor('#FFFFFF')
    .border({ width: 1, color: '#E2E8F0' })
    .borderRadius(16)
    .justifyContent(FlexAlign.SpaceBetween)
    .onClick(() => {
      postCardAction(this, {
        action: ACTION_ROUTER,
        abilityName: ABILITY_NAME,
        params: {
          targetTab: 2
        }
      });
    })
  }
}
