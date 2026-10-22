import { MissionApproval } from '../models/Mission';
import { PMColors, PMSpacing } from '../common/DesignTokens';
@Component
export struct MissionApprovalSheet {
  @Prop approval: MissionApproval = { id: '', proposalHash: '', proposal: { tool: '', args: { title: '' } }, expiresAt: '' };
  @Prop busy: boolean = false;
  onDecide: (decision: string) => void = () => {};
  onClose: () => void = () => {};
  build() {
    Column({ space: 10 }) {
      Text('审阅行动提案').fontSize(20)
      Text(this.approval.proposal.args.title).fontSize(18)
      Text(this.approval.proposal.args.description ?? '')
      Text(`优先级：${this.approval.proposal.args.priority ?? '未指定'}；截止：${this.approval.proposal.args.dueAt ?? '未指定'}`)
      Text(`提案有效期至 ${this.approval.expiresAt}`).fontSize(13)
      Text('批准后由服务端执行，并在步骤中返回行动回执。创建行动仍是待办，完成后需记录实际结果。').fontColor(PMColors.INK_SECONDARY)
      if (Date.parse(this.approval.expiresAt) <= Date.now()) { Text('提案已过期，请返回委托更新依据并重新预览。').fontColor(PMColors.WARNING) }
      Button('批准创建行动').backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy && Date.parse(this.approval.expiresAt) > Date.now()).onClick(() => { this.onDecide('APPROVED'); })
      Button('拒绝此提案').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onDecide('REJECTED'); })
      Button('返回任务').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onClose(); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
  }
}
