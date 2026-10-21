import router from '@ohos.router';
import { MissionService } from '../services/MissionService';
import { PMColors, PMSpacing } from '../common/DesignTokens';
@Component
export struct MissionPanel {
  @Prop projectId: string = '';
  @State available: boolean = false;
  aboutToAppear(): void { this.probe(); }
  private async probe(): Promise<void> {
    try { this.available = (await new MissionService().capabilities(this.projectId)).enabled; }
    catch { this.available = false; }
  }
  build() {
    if (this.available) {
      Column({ space: 6 }) {
        Text('长期委托').fontSize(18).fontColor(PMColors.INK_PRIMARY)
        Text('委托一个目标，补充资料后接着推进；已完成步骤和审阅记录持续保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
        Button('查看或创建委托').onClick(() => {
          router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId } });
        })
      }.padding(PMSpacing.MD).width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
