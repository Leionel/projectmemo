import { MissionMetricExecution } from '../models/Mission';
import { PMColors } from '../common/DesignTokens';
@Component
export struct MissionMetricReceipt {
  @Prop execution: MissionMetricExecution;
  @Prop stepStatus: string = '';
  build() {
    Column({ space: 8 }) {
      Text(!this.execution.current ? '原指标依据已变化，此回执仅作历史记录。' : this.stepStatus === 'SUCCEEDED' ? '核算已完成。' : '核算还没结束；继续时只核对这一次，不会重复执行。').fontSize(14)
      if (this.execution.receipt) {
        Text(this.execution.receipt!.result.state === 'SAME_CONDITIONS' ? '同条件差值：' + (this.execution.receipt!.result.delta ?? 0).toString() : '条件不同或未知，不能比较。').fontSize(14)
        Text('这是固定算术核算，不是训练或实验复现。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
      }
      if (this.execution.failure) { Text('核算没有成功完成。').fontSize(13) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
