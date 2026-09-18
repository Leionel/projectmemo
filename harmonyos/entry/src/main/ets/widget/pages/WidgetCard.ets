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
      if (this.formDimension === 2) {
        // ------------------------------------
        // 2*2 紧凑规格（正方形卡片）
        // ------------------------------------
        Column() {
          // 顶栏：状态点 + 倒计时
          Row() {
            Row() {
              Row()
                .width(8)
                .height(8)
                .borderRadius(4)
                .backgroundColor('#E5484D')
                .margin({ right: 4 })

              Text(this.projectTitle)
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor('#0F172A')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
            .layoutWeight(1)
            .alignItems(VerticalAlign.Center)

            Row() {
              Text(`${this.daysLeft}`)
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor('#E5484D')
              Text('天')
                .fontSize(10)
                .fontColor('#E5484D')
            }
            .padding({ left: 6, right: 6, top: 1, bottom: 1 })
            .backgroundColor('#FFEBEB')
            .borderRadius(8)
            .margin({ left: 4 })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          // 中间：准备度大字与徽章
          Row() {
            Column() {
              Text('准备度')
                .fontSize(10)
                .fontColor('#64748B')
              Text(`${this.readiness}%`)
                .fontSize(20)
                .fontWeight(FontWeight.Bolder)
                .fontColor('#0284C7')
                .margin({ top: 1 })
            }
            .alignItems(HorizontalAlign.Start)

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
          .margin({ top: 6 })

          // 进度条
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(4)
              .backgroundColor('#E2E8F0')
              .borderRadius(2)
            Row()
              .width(`${Math.min(100, Math.max(0, this.readiness))}%`)
              .height(4)
              .backgroundColor('#0284C7')
              .borderRadius(2)
          }
          .width('100%')
          .margin({ top: 4 })

          // 底栏：要务简述
          Row() {
            Text(this.nextAction)
              .fontSize(10)
              .fontColor('#475569')
              .fontWeight(FontWeight.Medium)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)

            Text('→')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#0284C7')
              .margin({ left: 4 })
          }
          .width('100%')
          .padding({ left: 6, right: 6, top: 4, bottom: 4 })
          .backgroundColor('#F1F5F9')
          .borderRadius(6)
          .margin({ top: 6 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.SpaceBetween)
      } else {
        // ------------------------------------
        // 2*4 全尺寸规格（宽卡片）
        // ------------------------------------
        Column() {
          // 顶栏：项目标题与倒计时警示胶囊
          Row() {
            Row() {
              Row()
                .width(8)
                .height(8)
                .borderRadius(4)
                .backgroundColor('#E5484D')
                .margin({ right: 6 })

              Text(this.projectTitle)
                .fontSize(14)
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
                .fontSize(11)
                .fontColor('#E5484D')
              Text(`${this.daysLeft}`)
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor('#E5484D')
              Text(' 天')
                .fontSize(11)
                .fontColor('#E5484D')
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
              Text('备赛准备度')
                .fontSize(11)
                .fontColor('#64748B')
              Row() {
                Text(`${this.readiness}%`)
                  .fontSize(22)
                  .fontWeight(FontWeight.Bolder)
                  .fontColor('#0284C7')

                Stack({ alignContent: Alignment.Start }) {
                  Row()
                    .width('100%')
                    .height(6)
                    .backgroundColor('#E2E8F0')
                    .borderRadius(3)
                  Row()
                    .width(`${Math.min(100, Math.max(0, this.readiness))}%`)
                    .height(6)
                    .backgroundColor('#0284C7')
                    .borderRadius(3)
                }
                .width(100)
                .margin({ left: 10 })
              }
              .alignItems(VerticalAlign.Center)
              .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)

            // 状态徽章
            Text(this.status)
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor('#0284C7')
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor('#E0F2FE')
              .borderRadius(6)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          .alignItems(VerticalAlign.Center)
          .margin({ top: 6 })

          // 底栏：今日第一要务待办（可点击直达）
          Row() {
            Column() {
              Row() {
                Text('今日第一要务')
                  .fontSize(11)
                  .fontWeight(FontWeight.Bold)
                  .fontColor('#0F172A')
                Text('（点击直达待办）')
                  .fontSize(10)
                  .fontColor('#64748B')
              }
              .width('100%')

              Text(this.nextAction)
                .fontSize(12)
                .fontColor('#0284C7')
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
              .fontColor('#0284C7')
              .margin({ left: 6 })
          }
          .width('100%')
          .padding({ left: 10, right: 10, top: 8, bottom: 8 })
          .backgroundColor('#F1F5F9')
          .border({ width: 1, color: '#E2E8F0' })
          .borderRadius(8)
          .margin({ top: 6 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.SpaceBetween)
      }
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .linearGradient({
      angle: 180,
      colors: [['#FFFFFF', 0.0], ['#F8FAFC', 1.0]]
    })
    .border({ width: 1, color: '#CBD5E1' })
    .borderRadius(16)
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
