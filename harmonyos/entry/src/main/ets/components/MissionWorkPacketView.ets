import { PMColors, PMFontSize, PMRadius, PMSpacing } from '../common/DesignTokens';
import { PMButton, PMStatusPill } from './PMReferencePrimitives';
import { workPhaseLabel } from '../common/GlobalFocusPresentation';
import {
  WorkPacketActionView, WorkPacketBlockerView, WorkPacketCoverageWindowView, WorkPacketObservationView, WorkPacketView,
  authorityLine, basisSummary, blockerLabel, doneSummary, legacyPacketNotice, nextSummary, observationLine,
  primaryActionKindLabel, shortPacketTime, snapshotLine, stopSummary
} from '../models/WorkPacket';

/**
 * 同一 optional workPacket 的只读呈现：四问摘要、唯一主动作、必要阻断，
 * 技术细节默认收起。数据与判断全部来自服务端投影；本组件不重新推断
 * phase、优先级或授权，也不把读取/刷新当作成功观察。
 */
@Component
export struct MissionWorkPacketView {
  @Prop hasPacket: boolean = false;
  @Prop packet: WorkPacketView = new WorkPacketView();
  @Prop observation: WorkPacketObservationView = new WorkPacketObservationView();
  @Prop inlinePrimaryAction: boolean = false;
  @Prop actionDisabled: boolean = false;
  @Prop readAtText: string = '';
  onPrimaryAction: (action: WorkPacketActionView) => void = (action: WorkPacketActionView): void => {};
  @State showBlockers: boolean = false;

  private statusText(): string {
    const stopped = this.packet.stopped;
    if (stopped.terminalPresent) {
      if (stopped.terminalStatus === 'CANCELLED') { return '已取消（不是成功）'; }
      if (stopped.terminalStatus === 'SUCCEEDED') { return '条件已验收'; }
    }
    return workPhaseLabel(stopped.phase);
  }

  private statusTone(): string {
    const stopped = this.packet.stopped;
    if (stopped.terminalStatus === 'CANCELLED' || stopped.phase === 'FAILED' || stopped.phase === 'UNKNOWN') { return 'risk'; }
    if (stopped.unsettledPresent) { return 'risk'; }
    if (stopped.stopRequestKnown && stopped.stopSettled === false) { return 'warning'; }
    if (this.packet.authority.permissionStateKnown && this.packet.authority.permissionState === 'EXPIRED') { return 'risk'; }
    if (stopped.phase === 'PAUSED' || stopped.phase === 'WAITING_USER' || stopped.phase === 'WAITING_APPROVAL') { return 'warning'; }
    return 'brand';
  }


  private action(): WorkPacketActionView { return this.packet.next.primaryAction; }

  private inlineKind(kind: string): boolean {
    return kind === 'ANSWER_QUESTION' || kind === 'REVIEW_APPROVAL' || kind === 'RESUME_DELEGATION';
  }

  private inlineHint(kind: string): string {
    if (kind === 'ANSWER_QUESTION') { return '下一步：补充原问题（在下方答复区完成）'; }
    if (kind === 'REVIEW_APPROVAL') { return '下一步：审阅原提案（在下方提案卡完成）'; }
    return '下一步：继续原委托（在下方暂停区完成）';
  }

  @Builder
  private QuestionLine(label: string, value: string) {
    Column({ space: 2 }) {
      Text(label).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      Text(value).fontSize(13).lineHeight(20).fontColor(PMColors.INK_PRIMARY)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private TechnicalLine(value: string) {
    Text(value).fontSize(11).lineHeight(17).fontColor(PMColors.INK_TERTIARY).width('100%')
  }

  @Builder
  private BlockerRow(blocker: WorkPacketBlockerView) {
    Column({ space: 3 }) {
      Row({ space: 6 }) {
        PMStatusPill({ label: blockerLabel(blocker.kind), tone: blocker.blocksActions ? 'risk' : 'warning' })
        Text(blocker.code).fontSize(10).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (blocker.at !== null) { Text(shortPacketTime(blocker.at)).fontSize(10).fontColor(PMColors.INK_TERTIARY) }
      }.width('100%')
      Text(blocker.text).fontSize(12).lineHeight(18).fontColor(PMColors.INK_SECONDARY)
      if (blocker.refPresent) {
        Text(`原对象：${blocker.refKind} ${blocker.refId}`).fontSize(10).fontColor(PMColors.INK_TERTIARY)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 6, bottom: 6 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }

  @Builder
  private TechnicalDetails() {
    Column({ space: 4 }) {
      this.TechnicalLine(`合同 ${this.packet.contractVersion} · schema ${this.packet.schemaVersion ?? '未知'} · 读取 ${this.readAtText}`)
      this.TechnicalLine(snapshotLine(this.packet))
      this.TechnicalLine(authorityLine(this.packet.authority))
      this.TechnicalLine(`身份 ${this.packet.identity.missionId} · 委托版本 ${this.packet.identity.missionVersion ?? '未知'} · 计划 ${this.packet.identity.planRevision ?? '未知'} · 上下文 ${this.packet.identity.contextVersion ?? '未知'} · 约束 ${this.packet.identity.constraintsVersion ?? '未知'} · 研究范围 ${this.packet.identity.researchScopeVersion ?? '未知'}`)
      if (this.packet.identity.controlVersion !== null) {
        this.TechnicalLine(`controlVersion ${this.packet.identity.controlVersion}`)
      }
      if (this.action().requiresKnown) {
        this.TechnicalLine(`提交需服务端重查的版本：mission ${this.action().requiresMissionVersion ?? '未知'} · plan ${this.action().requiresPlanRevision ?? '未知'} · context ${this.action().requiresContextVersion ?? '未知'} · constraints ${this.action().requiresConstraintsVersion ?? '未知'} · scope ${this.action().requiresResearchScopeVersion ?? '未知'} · boundary ${this.action().requiresBoundaryAt ?? '无'}`)
        this.TechnicalLine(`requires 只是版本要求，不是客户端凭据；服务端仍重查 owner、项目、来源许可、权限、租约、预算与幂等。主动作目标 ${this.action().targetPresent ? this.action().targetKind + ' ' + this.action().targetId : '未提供'}`)
      }
      if (this.packet.coverageWindows.length > 0) {
        ForEach(this.packet.coverageWindows, (window: WorkPacketCoverageWindowView) => {
          this.TechnicalLine(`${window.name} ${window.returned ?? '?'}/${window.limit ?? '?'}${window.truncated ? '（已截断）' : ''}`)
        }, (window: WorkPacketCoverageWindowView) => window.name)
        this.TechnicalLine('有界窗口内未找到记录只表示覆盖不足，不等于从未发生。')
      }
      this.TechnicalLine(`现实完成：${this.packet.realityOutcomeKnown ? this.packet.realityOutcome : '未知'}（不推断现实目标是否达成）`)
      this.TechnicalLine('读取不会核销 UNKNOWN、不推进成功观察时间，也不授予写入资格。')
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 6 })
  }

  build() {
    Column({ space: 10 }) {
      if (!this.hasPacket) {
        Text(legacyPacketNotice()).fontSize(PMFontSize.SECONDARY).lineHeight(19).fontColor(PMColors.INK_SECONDARY)
      } else if (!this.packet.contractCompatible) {
        Text('当前版本读不了这份工作摘要，请更新应用。委托详情仍可查看。')
          .fontSize(PMFontSize.SECONDARY).lineHeight(19).fontColor(PMColors.WARNING)
      } else {
        Row({ space: 8 }) {
          PMStatusPill({ label: this.statusText(), tone: this.statusTone() })
          Blank()
          if (this.readAtText !== '') {
            Text(`读取 ${this.readAtText}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
          }
        }.width('100%')
        Text(observationLine(this.observation)).fontSize(12).fontColor(PMColors.INK_SECONDARY).width('100%')
        if (this.packet.snapshotConsistency === 'VERSION_ADVANCED') {
          Text(snapshotLine(this.packet)).fontSize(12).fontColor(PMColors.WARNING).width('100%')
        }
        Column({ space: 8 }) {
          this.QuestionLine('做到哪', doneSummary(this.packet.done))
          this.QuestionLine('依据', basisSummary(this.packet.materials, false))
          this.QuestionLine('为什么停', stopSummary(this.packet.stopped))
          this.QuestionLine('下一步', nextSummary(this.packet.next))
        }.width('100%')
          if (this.action().present && !this.action().kindKnown) {
          Text(`服务端给出新的主动作类型（${this.action().rawKind}），请更新客户端后再操作。`)
            .fontSize(12).fontColor(PMColors.WARNING).width('100%')
        } else if (this.action().present && this.action().kindKnown && this.action().kind !== 'NONE') {
          if (this.action().kind === 'WAIT_FOR_OBSERVATION') {
            Text('正在后台推进，有结果会更新。').fontSize(12).fontColor(PMColors.INK_SECONDARY).width('100%')
          } else if (this.inlinePrimaryAction && this.inlineKind(this.action().kind)) {
            Text(this.inlineHint(this.action().kind)).fontSize(12).fontColor(PMColors.INK_SECONDARY).width('100%')
          } else {
            PMButton({
              label: this.action().label !== '' ? this.action().label : primaryActionKindLabel(this.action().kind),
              disabled: this.actionDisabled,
              onAction: (): void => { this.onPrimaryAction(this.action()); }
            })
          }
        }
        if (this.packet.blockers.length > 0) {
          Row({ space: 8 }) {
            Text(`阻断事实 ${this.packet.blockers.length} 项`).fontSize(13).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
            Text(this.showBlockers ? '收起 ⌃' : '展开 ⌄').fontSize(12).fontColor(PMColors.BRAND)
          }.width('100%').height(40).alignItems(VerticalAlign.Center)
            .onClick(() => { this.showBlockers = !this.showBlockers; })
            .accessibilityText(`阻断事实 ${this.packet.blockers.length} 项，${this.showBlockers ? '收起' : '展开'}`)
          if (this.showBlockers) {
            ForEach(this.packet.blockers, (blocker: WorkPacketBlockerView) => {
              this.BlockerRow(blocker)
            }, (blocker: WorkPacketBlockerView) => blocker.kind + ':' + blocker.code)
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
      .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
      .border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
}
