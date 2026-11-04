import { MissionApproval, MissionCalendarBatchItem, MissionCalendarPayload, MissionCalendarAttendee } from '../models/Mission';
import { PMColors, PMSpacing } from '../common/DesignTokens';
import { shortPacketTime } from '../models/WorkPacket';
@Component
export struct MissionApprovalSheet {
  @Prop approval: MissionApproval = { id: '', proposalHash: '', proposal: { tool: '', args: { title: '' } }, expiresAt: '' };
  @Prop busy: boolean = false;
  onDecide: (decision: string) => void = () => {};
  onClose: () => void = () => {};
  private expired(): boolean { return Date.parse(this.approval.expiresAt) <= Date.now(); }
  private expiryText(): string {
    if (this.expired()) return '已过期';
    return Number.isNaN(Date.parse(this.approval.expiresAt)) ? '有效期未记录' : shortPacketTime(this.approval.expiresAt) + ' 过期';
  }
  private when(payload:MissionCalendarPayload):string {
    if(payload.allDay)return (payload.startAt??'')+' 至 '+(payload.endAt??'')+'（全天）';
    try{return new Date(payload.startAt??'').toLocaleString('zh-CN',{timeZone:payload.timeZone??'Asia/Shanghai'})+' → '+new Date(payload.endAt??'').toLocaleString('zh-CN',{timeZone:payload.timeZone??'Asia/Shanghai'})+'（'+(payload.timeZone??'Asia/Shanghai')+'）';}catch{return (payload.startAt??'')+' → '+(payload.endAt??'');}
  }
  @Builder
  calendarFields(payload:MissionCalendarPayload) {
    Column({space:4}) {
      Text(this.when(payload)).fontSize(13)
      if(payload.description){Text('外发描述：'+payload.description).fontSize(13).copyOption(CopyOptions.LocalDevice)}
      if(payload.recurrence){Text('重复：'+payload.recurrence).fontSize(13)}
      ForEach(payload.attendees??[],(person:MissionCalendarAttendee)=>{Text('参与人：'+(person.email??person.openId??'未知')).fontSize(13)},(person:MissionCalendarAttendee)=>person.email??person.openId??'')
      ForEach(payload.attachments??[],(token:string)=>{Text('附件：'+token).fontSize(13).copyOption(CopyOptions.LocalDevice)},(token:string)=>token)
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
  build() {
    Scroll() {
    Column({ space: 10 }) {
      Row() {
        Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '审阅固定核算' : this.approval.proposal.tool === 'create_calendar_event' ? '审阅飞书日历写入' : this.approval.proposal.tool === 'create_calendar_events' ? '审阅飞书日历批量写入' : '审阅行动提案').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
        Text(this.expiryText()).fontSize(12).fontColor(this.expired() ? PMColors.RISK : PMColors.WARNING)
      }.width('100%')
      if (this.approval.proposal.tool === 'create_calendar_events') {
        Text('将在已连接日历创建 ' + (this.approval.proposal.events?.length ?? 0) + ' 个日程').fontSize(18)
        Text('账号：' + (this.approval.proposal.target?.accountName ?? this.approval.proposal.target?.accountEmail ?? '已连接账号') + '；日历：' + (this.approval.proposal.target?.calendarSummary ?? this.approval.proposal.target?.calendarId ?? '未知')).fontSize(13)
        ForEach(this.approval.proposal.events ?? [], (item: MissionCalendarBatchItem) => {
          Column({ space: 2 }) {
            Text((item.index + 1) + '. ' + (item.payload.title ?? '')).fontSize(15)
            this.calendarFields(item.payload)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (item: MissionCalendarBatchItem) => '' + item.index)

      } else if (this.approval.proposal.tool === 'create_calendar_event') {
        Text(this.approval.proposal.payload?.title ?? this.approval.proposal.args.title).fontSize(18)
        this.calendarFields(this.approval.proposal.payload??{})
        Text('账号：' + (this.approval.proposal.target?.accountName ?? this.approval.proposal.target?.accountEmail ?? '已连接账号') + '；日历：' + (this.approval.proposal.target?.calendarSummary ?? this.approval.proposal.target?.calendarId ?? '未知')).fontSize(13)
        Text('写入前逐次核对授权与租约；回包丢失时只查询原效果，不自动再创建。').fontColor(PMColors.INK_SECONDARY).fontSize(13)
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
      if(this.approval.proposal.tool==='create_calendar_event'||this.approval.proposal.tool==='create_calendar_events'){Text(this.approval.proposal.compensationPolicy==='RECHECK_THEN_DELETE_CREATED_EVENTS'?'批准包含上述创建、参与人添加和失败补偿删除；补偿前重新读取核对，发现变化、停止或撤权则保留待核对。不发送参与人通知。先读后删与飞书编辑不原子互斥，核对后发生的编辑仍可能被删除。':'本提案不包含自动删除许可。').fontColor(PMColors.INK_SECONDARY).fontSize(13)}
      Text(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准后在无网、只读副本、非root容器中重算差值，CPU 0.5核 / 内存64MB / 最长8秒；不是训练或复现实验。' : this.approval.proposal.tool === 'create_calendar_event' ? '批准后只在上述账号与日历创建一条日程，并完成原对象回读；外部创建不等于现实目标达成。' : this.approval.proposal.tool === 'create_calendar_events' ? '批准后按顺序创建本批日程，按上述范围处理失败，保留部分结果与待核对回执。' : '批准后由服务端执行，并在步骤中返回行动回执。创建行动仍是待办，完成后需记录实际结果。').fontColor(PMColors.INK_SECONDARY)
      if (this.expired()) {
        Text('提案已过期，请返回委托更新依据并重新预览。').fontSize(13).fontColor(PMColors.WARNING)
          .padding({ left: 12, right: 12, top: 10, bottom: 10 }).borderRadius(13).backgroundColor(PMColors.WARNING_LIGHT).width('100%')
        Button('返回任务', { type: ButtonType.Normal }).width('100%').height(48).borderRadius(11).fontSize(15)
          .backgroundColor(PMColors.SURFACE).fontColor(PMColors.INK_PRIMARY).border({ width: 1, color: PMColors.BORDER })
          .enabled(!this.busy).onClick(() => { this.onClose(); })
      } else {
        Button(this.approval.proposal.tool === 'verify_experiment_metrics' ? '批准固定核算' : this.approval.proposal.tool === 'create_calendar_event' ? '批准创建日程' : this.approval.proposal.tool === 'create_calendar_events' ? '批准创建本批日程' : '批准创建行动', { type: ButtonType.Normal })
          .width('100%').height(48).borderRadius(11).fontSize(15).fontWeight(FontWeight.Medium)
          .backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy).onClick(() => { this.onDecide('APPROVED'); })
        Button('拒绝此提案', { type: ButtonType.Normal }).width('100%').height(40).borderRadius(11).fontSize(14)
          .backgroundColor(Color.Transparent).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.onDecide('REJECTED'); })
        Button('稍后再决定', { type: ButtonType.Normal }).width('100%').height(40).borderRadius(11).fontSize(14)
          .backgroundColor(Color.Transparent).fontColor(PMColors.INK_TERTIARY).enabled(!this.busy).onClick(() => { this.onClose(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
    }.width('100%').height('100%')
  }
}
