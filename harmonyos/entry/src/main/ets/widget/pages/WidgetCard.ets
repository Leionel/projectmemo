const ACTION_ROUTER: string = 'router';
const ABILITY_NAME: string = 'EntryAbility';
let storage = new LocalStorage();

@Entry(storage)
@Component
struct WidgetCard {
  @LocalStorageProp('formDimension') formDimension: number = 3; // 2: 2*2, 3: 2*4
  @LocalStorageProp('projectId') projectId: string = '';
  @LocalStorageProp('projectTitle') projectTitle: string = '忆程项目看板';
  @LocalStorageProp('daysLeft') daysLeft: number = 0;
  @LocalStorageProp('hasDeadline') hasDeadline: boolean = false;
  @LocalStorageProp('deadlineKind') deadlineKind: string = 'NONE';
  @LocalStorageProp('deadlineText') deadlineText: string = '未设截止日';
  @LocalStorageProp('readiness') readiness: number = 0;
  @LocalStorageProp('nextActionTitle') nextActionTitle: string = '打开应用同步项目待办';
  @LocalStorageProp('nextActionReason') nextActionReason: string = '';
  @LocalStorageProp('nextAction') nextAction: string = '打开应用同步项目待办';
  @LocalStorageProp('status') status: string = '待同步';
  @LocalStorageProp('statusTone') statusTone: string = 'neutral';
  @LocalStorageProp('checkpointInfo') checkpointInfo: string = '';
  @LocalStorageProp('missionId') missionId: string = '';
  @LocalStorageProp('missionProjectId') missionProjectId: string = '';
  @LocalStorageProp('missionSummary') missionSummary: string = '';
  @LocalStorageProp('missionUpdatedAt') missionUpdatedAt: string = '';
  @LocalStorageProp('missionQuestionId') missionQuestionId: string = '';
  @LocalStorageProp('missionApprovalId') missionApprovalId: string = '';
  @LocalStorageProp('missionAttention') missionAttention: string = '';
  @LocalStorageProp('missionSync') missionSync: string = '';
  @LocalStorageProp('missionExpiresAt') missionExpiresAt: number = 0;
  @LocalStorageProp('missionVersion') missionVersion: number = 0;

  private getStatusColor(): Resource {
    if (this.statusTone === 'risk' || this.status === '需要重整' || this.status === '已逾期') {
      return $r('app.color.pm_risk');
    }
    if (this.statusTone === 'warning' || this.status === '部分过期' || this.status === '待整理') {
      return $r('app.color.pm_warning');
    }
    if (this.statusTone === 'neutral' || this.status === '待同步' || this.status === '待登录' || this.status === '已暂停') {
      return $r('app.color.pm_ink_secondary');
    }
    return $r('app.color.pm_brand');
  }

  private getStatusBgColor(): Resource {
    if (this.statusTone === 'risk' || this.status === '需要重整' || this.status === '已逾期') {
      return $r('app.color.pm_risk_light');
    }
    if (this.statusTone === 'warning' || this.status === '部分过期' || this.status === '待整理') {
      return $r('app.color.pm_warning_light');
    }
    if (this.statusTone === 'neutral' || this.status === '待同步' || this.status === '待登录' || this.status === '已暂停') {
      return $r('app.color.pm_surface_subtle');
    }
    return $r('app.color.pm_brand_light');
  }

  private getDeadlineColor(): Resource {
    if (this.deadlineKind === 'OVERDUE' || this.daysLeft < 0) {
      return $r('app.color.pm_risk');
    }
    if (this.deadlineKind === 'TODAY' || this.daysLeft === 0) {
      return $r('app.color.pm_warning');
    }
    return $r('app.color.pm_brand');
  }

  private getDisplayActionTitle(): string {
    if (this.missionId !== '' && this.missionAttention !== '') {
      return this.missionAttention;
    }
    if (this.missionId !== '' && this.missionSummary !== '') {
      return this.missionSummary;
    }
    if (this.nextActionTitle !== '' && this.nextActionTitle !== '暂无进行中待办') {
      return this.nextActionTitle;
    }
    if (this.nextAction !== '') {
      return this.nextAction;
    }
    return '打开应用同步项目待办';
  }

  // ----------------------------------------------------
  // 2×4 宽卡片：不对称双区构图（精致项目便签风格）
  // ----------------------------------------------------
  @Builder
  WidgetCard2x4() {
    Column() {
      // 1. 顶部头部（品牌标识 + 次级项目名 + 状态微徽标）
      Row({ space: 6 }) {
        Row({ space: 4 }) {
          Text('忆')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.pm_brand'))
            .width(20)
            .height(20)
            .textAlign(TextAlign.Center)
            .backgroundColor($r('app.color.pm_brand_light'))
            .borderRadius(6)
          Text('忆程')
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.pm_ink_primary'))
        }

        if (this.projectTitle !== '') {
          Text(`· ${this.projectTitle}`)
            .fontSize(11)
            .fontColor($r('app.color.pm_ink_secondary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        } else {
          Blank()
        }

        if (this.status !== '') {
          Text(this.status)
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.getStatusColor())
            .backgroundColor(this.getStatusBgColor())
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
        }
      }
      .width('100%')
      .height(24)
      .alignItems(VerticalAlign.Center)

      // 2. 中部核心双区：左侧待处理事项，右侧局部便签小色块
      Row({ space: 10 }) {
        // 左侧主要行动信息
        Column({ space: 3 }) {
          Text(this.missionId !== '' ? '待确认委托' : '当前聚焦')
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.pm_ink_tertiary'))

          Text(this.getDisplayActionTitle())
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.pm_ink_primary'))
            .lineHeight(19)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })

          if (this.missionId === '' && this.nextActionReason !== '') {
            Text(this.nextActionReason)
              .fontSize(11)
              .fontColor($r('app.color.pm_ink_secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .margin({ top: 1 })
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .justifyContent(FlexAlign.Center)

        // 右侧不对称便签色块（关键状态 / 真实数字，无截止日决不展示虚假倒计时）
        Column() {
          if (this.missionId !== '') {
            Text('委托')
              .fontSize(10)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.pm_warning'))
            Text('待确认')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.pm_warning'))
              .margin({ top: 2 })
          } else if (this.hasDeadline) {
            Text(this.daysLeft === 0 ? '0' : (this.daysLeft > 0 ? `${this.daysLeft}` : `${Math.abs(this.daysLeft)}`))
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.getDeadlineColor())
              .lineHeight(22)
            Text(this.daysLeft === 0 ? '今天截止' : (this.daysLeft > 0 ? '天后截止' : '天已逾期'))
              .fontSize(10)
              .fontColor(this.getDeadlineColor())
              .margin({ top: 1 })
          } else if (this.checkpointInfo !== '' && this.checkpointInfo !== this.status) {
            Text('检查点')
              .fontSize(10)
              .fontColor($r('app.color.pm_ink_tertiary'))
            Text(this.checkpointInfo)
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.pm_brand'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .margin({ top: 2 })
          } else {
            Text('项目')
              .fontSize(10)
              .fontColor($r('app.color.pm_ink_tertiary'))
            Text(this.status !== '' ? this.status : '进行中')
              .fontSize(12)
              .fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.pm_brand'))
              .margin({ top: 2 })
          }
        }
        .width(74)
        .height(56)
        .backgroundColor($r('app.color.pm_surface_subtle'))
        .borderRadius(10)
        .border({ width: 1, color: $r('app.color.pm_border_subtle') })
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }
      .width('100%')
      .layoutWeight(1)
      .alignItems(VerticalAlign.Center)

      // 3. 底部轻量跳转提示
      Row() {
        if (this.checkpointInfo !== '' && this.checkpointInfo !== this.status) {
          Text(this.checkpointInfo)
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        } else if (this.missionId !== '') {
          Text('点击处理委托待办')
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .layoutWeight(1)
        } else {
          Text(this.hasDeadline ? this.deadlineText : '查看项目工作台')
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .layoutWeight(1)
        }

        Text('打开 ↗')
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.pm_brand'))
      }
      .width('100%')
      .height(20)
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .padding(14)
    .alignItems(HorizontalAlign.Start)
  }

  // ----------------------------------------------------
  // 2×2 方卡片：独立紧凑便签结构（不按比例直接缩小）
  // ----------------------------------------------------
  @Builder
  WidgetCard2x2() {
    Column() {
      // 1. 顶部品牌与状态微标
      Row() {
        Row({ space: 4 }) {
          Text('忆')
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.pm_brand'))
            .width(18)
            .height(18)
            .textAlign(TextAlign.Center)
            .backgroundColor($r('app.color.pm_brand_light'))
            .borderRadius(5)
          Text('忆程')
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.pm_ink_primary'))
        }
        Blank()
        if (this.status !== '') {
          Text(this.status)
            .fontSize(9)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.getStatusColor())
            .backgroundColor(this.getStatusBgColor())
            .padding({ left: 4, right: 4, top: 1, bottom: 1 })
            .borderRadius(3)
        }
      }
      .width('100%')
      .height(20)
      .alignItems(VerticalAlign.Center)

      // 2. 中部核心区：弱化项目名，突出当前事项
      Column({ space: 3 }) {
        if (this.projectTitle !== '') {
          Text(this.projectTitle)
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }

        Text(this.getDisplayActionTitle())
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.pm_ink_primary'))
          .lineHeight(17)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Start)

      // 3. 底部关键提示条
      Row() {
        if (this.missionId !== '') {
          Text(this.missionSync !== '' ? this.missionSync : '待处理委托')
            .fontSize(10)
            .fontColor($r('app.color.pm_warning'))
            .layoutWeight(1)
        } else if (this.hasDeadline) {
          Text(this.deadlineText)
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.getDeadlineColor())
            .layoutWeight(1)
        } else if (this.checkpointInfo !== '' && this.checkpointInfo !== this.status) {
          Text(this.checkpointInfo)
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .layoutWeight(1)
        } else {
          Text('进行中')
            .fontSize(10)
            .fontColor($r('app.color.pm_ink_tertiary'))
            .layoutWeight(1)
        }

        Text('↗')
          .fontSize(12)
          .fontColor($r('app.color.pm_brand'))
      }
      .width('100%')
      .height(18)
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      if (this.formDimension === 3) {
        this.WidgetCard2x4()
      } else {
        this.WidgetCard2x2()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.pm_surface'))
    .border({ width: 1, color: $r('app.color.pm_border_subtle') })
    .borderRadius(this.formDimension === 3 ? 18 : 16)
    .clip(true)
    .onClick(() => {
      // P1：修复跳转。点击委托跳转到对应委托详情，点击项目状态进入对应项目工作台
      if (this.missionId !== '' && this.missionProjectId !== '') {
        postCardAction(this, {
          action: ACTION_ROUTER,
          abilityName: ABILITY_NAME,
          params: {
            targetTab: 2,
            missionId: this.missionId,
            projectId: this.missionProjectId,
            // 只带定位身份与期限；执行批准仍要回到 App 重新鉴权。
            questionId: this.missionQuestionId,
            approvalId: this.missionApprovalId,
            handoffExpiresAt: String(this.missionExpiresAt > 0 ? this.missionExpiresAt : Date.now()),
            // 卡片记录的委托版本只作历史定位线索；详情会以服务端当前版本重新核对，不自动选中旧提案。
            missionVersion: String(this.missionVersion > 0 ? this.missionVersion : '')
          }
        });
      } else {
        postCardAction(this, {
          action: ACTION_ROUTER,
          abilityName: ABILITY_NAME,
          params: {
            targetTab: 0,
            projectId: this.projectId
          }
        });
      }
    })
  }
}

