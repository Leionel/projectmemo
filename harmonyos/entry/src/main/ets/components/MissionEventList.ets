import { MissionEvent } from '../models/Mission';
import { missionEventLabel } from '../common/MissionContract';
import { PMColors } from '../common/DesignTokens';

/** 执行事件：与执行时间线同一套行样式；时间用短格式，不展示内部序号。 */
@Component
export struct MissionEventList {
  @Prop events: MissionEvent[] = [];
  private shortTime(at: string): string {
    const t = Date.parse(at);
    if (Number.isNaN(t)) { return ''; }
    const d = new Date(t);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  }
  build() {
    Column({ space: 6 }) {
      ForEach(this.events, (event: MissionEvent) => {
        Row({ space: 10 }) {
          Circle({ width: 6, height: 6 }).fill(PMColors.BRAND).margin({ top: 6 })
          Text(missionEventLabel(event.type)).fontSize(13).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.shortTime(event.createdAt)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        }.width('100%').alignItems(VerticalAlign.Center).padding({ top: 9, bottom: 9 })
          .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
          .accessibilityText(`${missionEventLabel(event.type)}，${this.shortTime(event.createdAt)}`)
      }, (event: MissionEvent) => event.id)
      if (this.events.length === 0) {
        Text('尚无执行事件。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
