import { MissionMetricExecution } from '../models/Mission';
import { PMColors } from '../common/DesignTokens';
@Component
export struct MissionMetricReceipt {
  @Prop execution: MissionMetricExecution;
  @Prop stepStatus: string = '';
  @State expanded: boolean = false;
  build() {
    Column({ space: 8 }) {
      Text(!this.execution.current ? '原指标依据已变化，此回执仅作历史记录。' : this.stepStatus === 'SUCCEEDED' ? '固定脚本核算已完成。' : '原job尚未结算；继续只核对同一job，不重发创建。').fontSize(14)
      if (this.execution.receipt) {
        Text(this.execution.receipt!.result.state === 'SAME_CONDITIONS' ? '同条件差值：' + (this.execution.receipt!.result.delta ?? 0).toString() : '条件不同或未知，不能比较。').fontSize(14)
        Text('这是固定算术核算，不是训练或实验复现。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
        Button(this.expanded ? '收起回执' : '查看核算回执').height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.expanded = !this.expanded; })
        if (this.expanded) {
          Text('结束于 ' + this.execution.receipt!.finishedAt + ' · 退出码 ' + this.execution.receipt!.exitCode.toString()).fontSize(12)
          Text('Job：' + this.execution.receipt!.jobName).fontSize(12).copyOption(CopyOptions.LocalDevice)
          Text('回执：' + this.execution.receipt!.receiptHash).fontSize(12).copyOption(CopyOptions.LocalDevice)
          Text('镜像：' + this.execution.receipt!.image).fontSize(12).copyOption(CopyOptions.LocalDevice)
          Text('脚本：' + this.execution.receipt!.scriptHash).fontSize(12).copyOption(CopyOptions.LocalDevice)
        }
      }
      if (this.execution.failure) { Text('原job未成功完成，退出码：' + (this.execution.failure!.exitCode ?? -1).toString()).fontSize(13) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
