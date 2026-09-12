const ACTION_ROUTER: string = 'router';
const ABILITY_NAME: string = 'EntryAbility';
let storage = new LocalStorage();

@Entry(storage)
@Component
struct WidgetCard {
  /* 存储卡片数据（未收到真实推送前显示示例数据，需明确标识） */
  @LocalStorageProp('projectTitle') projectTitle: string = '忆程备赛看板（示例数据）';
  @LocalStorageProp('daysLeft') daysLeft: number = 2;
  @LocalStorageProp('readiness') readiness: number = 80;
  @LocalStorageProp('nextAction') nextAction: string = '示例：连接后端后显示真实待办';
  @LocalStorageProp('status') status: string = '示例数据';

  build() {
    Column() {
      // 顶栏：标题与倒计时胶囊
      Row() {
        Row() {
          Circle({ width: 8, height: 8 })
            .fill('#E5484D')
            .margin({ right: 6 })

          Text(this.projectTitle)
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .fontColor('#11181C')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .layoutWeight(1)
        .alignItems(VerticalAlign.Center)

        Row() {
          Text('仅剩 ')
            .fontSize(11)
            .fontColor('#687076')
          Text(`${this.daysLeft}`)
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .fontColor('#E5484D')
          Text(' 天')
            .fontSize(11)
            .fontColor('#687076')
        }
        .padding({ left: 8, right: 8, top: 2, bottom: 2 })
        .backgroundColor('#FFEBEB')
        .borderRadius(12)
        .margin({ left: 6 })
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)

      // 中间：准备度与状态标签
      Row() {
        Column() {
          Text('准备度')
            .fontSize(11)
            .fontColor('#687076')
          Text(`${this.readiness}%`)
            .fontSize(22)
            .fontWeight(FontWeight.Bolder)
            .fontColor('#0A7EA4')
            .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)

        // 状态徽章
        Text(this.status)
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor('#0A7EA4')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor('#E6F4F8')
          .borderRadius(4)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)
      .margin({ top: 8 })

      // 底栏：今日第一要务待办（可点击直达）
      Row() {
        Column() {
          Row() {
            Text('今日第一要务')
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .fontColor('#11181C')
            Text('（点击直达待办）')
              .fontSize(10)
              .fontColor('#687076')
          }
          .width('100%')

          Text(this.nextAction)
            .fontSize(12)
            .fontColor('#0A7EA4')
            .fontWeight(FontWeight.Medium)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 3 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text('→')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor('#0A7EA4')
          .margin({ left: 6 })
      }
      .width('100%')
      .padding({ left: 10, right: 10, top: 8, bottom: 8 })
      .backgroundColor('#F1F3F5')
      .borderRadius(8)
      .margin({ top: 8 })
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .backgroundColor('#FFFFFF')
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
