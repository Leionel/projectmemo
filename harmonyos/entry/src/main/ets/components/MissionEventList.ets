import { MissionEvent } from '../models/Mission';
import { missionEventLabel } from '../common/MissionContract';
import { PMColors } from '../common/DesignTokens';
@Component
export struct MissionEventList {
  @Prop events: MissionEvent[] = [];
  build() {
    Column({ space: 8 }) {
      Text('执行历史').fontSize(18)
      ForEach(this.events, (event: MissionEvent) => {
        Text(`${event.seq} · ${missionEventLabel(event.type)} · ${new Date(event.createdAt).toLocaleString()}`)
          .fontSize(13).fontColor(PMColors.INK_SECONDARY).width('100%')
      }, (event: MissionEvent) => event.id)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
