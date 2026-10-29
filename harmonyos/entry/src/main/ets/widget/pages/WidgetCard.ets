const ACTION_ROUTER: string = 'router';
const ABILITY_NAME: string = 'EntryAbility';
let storage = new LocalStorage();

@Entry(storage)
@Component
struct WidgetCard {
  @LocalStorageProp('formDimension') formDimension: number = 3;
  @LocalStorageProp('projectTitle') projectTitle: string = '忆程项目看板';
  @LocalStorageProp('daysLeft') daysLeft: number = 0;
  @LocalStorageProp('readiness') readiness: number = 0;
  @LocalStorageProp('nextAction') nextAction: string = '打开应用同步待办';
  @LocalStorageProp('status') status: string = '待同步';
  @LocalStorageProp('checkpointInfo') checkpointInfo: string = '';
  @LocalStorageProp('missionId') missionId: string = '';
  @LocalStorageProp('missionProjectId') missionProjectId: string = '';
  @LocalStorageProp('missionSummary') missionSummary: string = '';
  @LocalStorageProp('missionUpdatedAt') missionUpdatedAt: string = '';
  build() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('忆').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.pm_brand')).width(23).height(23).textAlign(TextAlign.Center).backgroundColor($r('app.color.pm_brand_light')).borderRadius(8)
        Text('忆程').fontSize(12).fontColor($r('app.color.pm_ink_secondary'))
        Blank()
        if (this.formDimension === 3) { Text(this.status).fontSize(10).fontColor($r('app.color.pm_brand')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: 90 }) }
      }.width('100%')
      Text(this.projectTitle).fontSize(this.formDimension === 3 ? 16 : 14).fontWeight(FontWeight.Medium).fontColor($r('app.color.pm_ink_primary')).lineHeight(this.formDimension === 3 ? 23 : 20).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      Text(this.missionId !== '' ? this.missionSummary : this.nextAction).fontSize(12).lineHeight(19).fontColor($r('app.color.pm_brand')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%').layoutWeight(1)
      Row({ space: 6 }) {
        Text(this.daysLeft > 0 ? `距截止 ${this.daysLeft} 天` : this.daysLeft < 0 ? `已过截止 ${Math.abs(this.daysLeft)} 天` : '查看项目日程').fontSize(10).fontColor($r('app.color.pm_ink_tertiary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (this.formDimension === 3 && this.checkpointInfo !== '') { Text(this.checkpointInfo).fontSize(10).fontColor($r('app.color.pm_ink_tertiary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: 100 }) }
        Text('↗').fontSize(15).fontColor($r('app.color.pm_brand'))
      }.width('100%').padding({ top: 7 }).border({ width: { top: 1 }, color: $r('app.color.pm_border_subtle') })
    }.width('100%').height('100%').padding(this.formDimension === 3 ? 15 : 12).alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.pm_surface')).border({ width: 1, color: $r('app.color.pm_border_subtle') }).borderRadius(20).clip(true)
      .onClick(() => {
        postCardAction(this, { action: ACTION_ROUTER, abilityName: ABILITY_NAME, params: { targetTab: 2, missionId: this.missionId, projectId: this.missionProjectId } });
      })
  }
}
