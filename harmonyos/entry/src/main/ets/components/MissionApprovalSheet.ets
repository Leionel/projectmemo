import { MissionApproval, MissionCalendarBatchItem } from '../models/Mission';
import { PMColors, PMSpacing } from '../common/DesignTokens';
@Component
export struct MissionApprovalSheet {
  @Prop approval: MissionApproval = { id: '', proposalHash: '', proposal: { tool: '', args: { title: '' } }, expiresAt: '' };
  @Prop busy: boolean = false;
  onDecide: (decision: string) => void = () => {};
  onClose: () => void = () => {};
  build() {
    Column({ space: 10 }) {
      Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '审阅固定核算' : this.approval.proposal.tool === 'create_calendar_event' ? '审阅飞书日历写入' : this.approval.proposal.tool === 'create_calendar_events' ? '审阅飞书日历批量写入' : '审阅行动提案').fontSize(20)
      if (this.approval.proposal.tool === 'create_calendar_events') {
        Text('将在已连接日历创建 ' + (this.approval.proposal.events?.length ?? 0) + ' 个日程').fontSize(18)
        Text('账号：' + (this.approval.proposal.target?.accountName ?? this.approval.proposal.target?.accountEmail ?? '已连接账号') + '；日历：' + (this.approval.proposal.target?.calendarSummary ?? this.approval.proposal.target?.calendarId ?? '未知')).fontSize(13)
        ForEach(this.approval.proposal.events ?? [], (item: MissionCalendarBatchItem) => {
          Column({ space: 2 }) {
            Text((item.index + 1) + '. ' + (item.payload.title ?? '')).fontSize(15)
            Text((item.payload.startAt ?? '') + ' → ' + (item.payload.endAt ?? '') + '（' + (item.payload.timeZone ?? '') + '）').fontSize(13)
            if ((item.payload.attendees?.length ?? 0) > 0 || (item.payload.attachments?.length ?? 0) > 0) {
              Text('参与人 ' + (item.payload.attendees?.length ?? 0) + ' · 附件 ' + (item.payload.attachments?.length ?? 0)).fontSize(12)
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (item: MissionCalendarBatchItem) => '' + item.index)
        Text('任一失败会删除本批次已创建的日程作为补偿；补偿结果写入回执，不宣称全部成功。').fontColor(PMColors.INK_SECONDARY).fontSize(13)
      } else if (this.approval.proposal.tool === 'create_calendar_event') {
        Text(this.approval.proposal.payload?.title ?? this.approval.proposal.args.title).fontSize(18)
        Text(this.approval.proposal.payload?.description ?? '')
        Text('账号：' + (this.approval.proposal.target?.accountName ?? this.approval.proposal.target?.accountEmail ?? '已连接账号') + '；日历：' + (this.approval.proposal.target?.calendarSummary ?? this.approval.proposal.target?.calendarId ?? '未知')).fontSize(13)
        Text('时间：' + (this.approval.proposal.payload?.startAt ?? '') + ' → ' + (this.approval.proposal.payload?.endAt ?? '') + '（' + (this.approval.proposal.payload?.timeZone ?? '') + '）').fontSize(13)
        Text('外部日程创建后不会自动删除或回滚；使用飞书原生 idempotency_key 与操作标记核对，回包丢失时只查询原效果，不自动再创建。').fontColor(PMColors.INK_SECONDARY).fontSize(13)
      } else {
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
      }
      Text(`提案有效期至 ${this.approval.expiresAt}`).fontSize(13)
      Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准后在无网、只读副本、非root容器中重算差值，CPU 0.5核 / 内存64MB / 最长8秒；不是训练或复现实验。' : this.approval.proposal.tool === 'create_calendar_event' ? '批准后只在上述账号与日历创建一条日程，并完成原对象回读；外部创建不等于现实目标达成。' : this.approval.proposal.tool === 'create_calendar_events' ? '批准后按顺序创建本批日程；任一失败会删除本批已创建日程作为补偿，无法确认全部删除时保持待核对。' : '批准后由服务端执行，并在步骤中返回行动回执。创建行动仍是待办，完成后需记录实际结果。').fontColor(PMColors.INK_SECONDARY)
      if (Date.parse(this.approval.expiresAt) <= Date.now()) { Text('提案已过期，请返回委托更新依据并重新预览。').fontColor(PMColors.WARNING) }
      Button(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准固定核算' : this.approval.proposal.tool === 'create_calendar_event' ? '批准创建日程' : this.approval.proposal.tool === 'create_calendar_events' ? '批准创建本批日程' : '批准创建行动').backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy && Date.parse(this.approval.expiresAt) > Date.now()).onClick(() => { this.onDecide('APPROVED'); })
      Button('拒绝此提案').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onDecide('REJECTED'); })
      Button('返回任务').backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onClose(); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
  }
}
