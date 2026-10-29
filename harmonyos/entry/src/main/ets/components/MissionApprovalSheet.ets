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
      Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '审阅固定核算' : '审阅行动提案').fontSize(20)
      Text(this.approval.proposal.args.title).fontSize(18)
      Text(this.approval.proposal.args.description ?? '')
      if(this.approval.proposal.tool!=='verify_experiment_metrics') {Text(`优先级：${this.approval.proposal.args.priority ?? '未指定'}；截止：${this.approval.proposal.args.dueAt ?? '未指定'}`) }
      if (this.approval.proposal.args.job) {
        Text(this.approval.proposal.args.job!.left.runId + '：' + this.approval.proposal.args.job!.left.value.toString() + ' → ' + this.approval.proposal.args.job!.right.runId + '：' + this.approval.proposal.args.job!.right.value.toString()).fontSize(14)
        Text('数据集版本：' + (this.approval.proposal.args.job!.left.dataset ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.dataset ?? '未知')).fontSize(12)
        Text('评估切分：' + (this.approval.proposal.args.job!.left.split ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.split ?? '未知')).fontSize(12)
        Text('随机种子：' + (this.approval.proposal.args.job!.left.seed ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.seed ?? '未知')).fontSize(12)
        Text('评估代码：' + (this.approval.proposal.args.job!.left.evaluationCode ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.evaluationCode ?? '未知')).fontSize(12)
        Text('环境：' + (this.approval.proposal.args.job!.left.environment ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.environment ?? '未知')).fontSize(12)
        Text('阶段：' + (this.approval.proposal.args.job!.left.phase ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.phase ?? '未知')).fontSize(12)
        Text('批量大小：' + (this.approval.proposal.args.job!.left.batchSize ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.batchSize ?? '未知')).fontSize(12)
        Text('单位：' + (this.approval.proposal.args.job!.left.unit ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.unit ?? '未知')).fontSize(12)
        Text('时间窗口：' + (this.approval.proposal.args.job!.left.period ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.period ?? '未知')).fontSize(12)
        Text('指标方向：' + (this.approval.proposal.args.job!.left.direction ?? '未知') + ' / ' + (this.approval.proposal.args.job!.right.direction ?? '未知')).fontSize(12)
        Text('镜像：' + this.approval.proposal.args.job!.image).fontSize(12).copyOption(CopyOptions.LocalDevice)
        Text('固定脚本：' + this.approval.proposal.args.job!.scriptHash).fontSize(12).copyOption(CopyOptions.LocalDevice)
      }
      Text(`提案有效期至 ${this.approval.expiresAt}`).fontSize(13)
      Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准后在无网、只读副本、非root容器中重算差值，CPU 0.5核 / 内存64MB / 最长8秒；不是训练或复现实验。' : '批准后由服务端执行，并在步骤中返回行动回执。创建行动仍是待办，完成后需记录实际结果。').fontColor(PMColors.INK_SECONDARY)
      if (Date.parse(this.approval.expiresAt) <= Date.now()) { Text('提案已过期，请返回委托更新依据并重新预览。').fontColor(PMColors.WARNING) }
      Button(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准固定核算' : '批准创建行动').backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy && Date.parse(this.approval.expiresAt) > Date.now()).onClick(() => { this.onDecide('APPROVED'); })
      Button('拒绝此提案').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onDecide('REJECTED'); })
      Button('返回任务').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onClose(); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
  }
}
