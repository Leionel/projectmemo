import router from '@ohos.router';
import { promptAction } from '@kit.ArkUI';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMCardStyle, PMInteraction, PMTransition } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { PMSheetHeader } from '../components/PMReferencePrimitives';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { TextFormatters } from '../common/TextFormatters';
import { PersonalMemoryService, PersonalEntry, PersonalMemoryCommandInput, PersonalMemoryPolicyInput,
  PersonalMemoryDetail, personalMemoryErrorMessage } from '../services/PersonalMemoryService';
import { ProjectService } from '../services/ProjectService';
import { Project } from '../models/Project';

/**
 * 我的记忆（账户级）：查看、添加、暂停/恢复、删除与使用策略。
 * 只保存用户明确提供的非敏感内容；来源、版本与停止语义在页内直说，不做伪装成开关的固定规则。
 */
@Entry
@Component
struct PersonalMemoryPage {
  @State loading: boolean = true;
  @State busy: boolean = false;
  @State error: string = '';
  @State notice: string = '';
  @State entries: PersonalEntry[] = [];
  @State candidates: PersonalEntry[] = [];
  @State projects: Project[] = [];
  @State policyUseEnabled: boolean = false;
  @State policyCloudEnabled: boolean = false;
  @State policyVersion: number = 0;
  @State hasPolicy: boolean = false;
  @State showStopped: boolean = false;
  @State showAddSheet: boolean = false;
  @State addQuote: string = '';
  @State addKindIndex: number = 0;
  @State addTopic: string = '';
  @State detail: PersonalMemoryDetail | null = null;
  private service: PersonalMemoryService = new PersonalMemoryService();
  private kindNames: string[] = ['协作偏好', '背景信息', '长期关注'];
  private kindValues: string[] = ['PREFERENCE', 'BACKGROUND', 'FOCUS'];

  onPageShow(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = this.entries.length === 0;
    this.error = '';
    try {
      const result = await this.service.list(this.showStopped);
      this.entries = result.items;
      this.candidates = await this.service.listCandidates();
      this.projects = await new ProjectService().listProjects();
      // 后端在账号还没有任何策略时会返回 policy: null；null 不能当成"有策略"去读字段。
      if (result.policy !== undefined && result.policy !== null) {
        this.hasPolicy = true;
        this.policyUseEnabled = result.policy.useInContextEnabled;
        this.policyCloudEnabled = result.policy.cloudProcessingEnabled;
        this.policyVersion = result.policy.settingsVersion;
      } else {
        this.hasPolicy = false;
      }
      this.loading = false;
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
      this.loading = false;
    }
  }

  private async runCommand(input: PersonalMemoryCommandInput, successNotice: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      const result = await this.service.command(input);
      if (result.status === 'NOT_SAVED') {
        this.notice = result.admissionQuestion !== undefined && result.admissionQuestion !== undefined ?
          `需要澄清：${result.admissionQuestion}` : `未保存：${result.admissionReason ?? '范围不明确'}`;
      } else {
        this.notice = successNotice;
        this.showAddSheet = false;
        this.addQuote = '';
        this.addTopic = '';
      }
      await this.load();
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  private entryKindLabel(kind: string): string {
    if (kind === 'PREFERENCE') {
      return '协作偏好';
    }
    if (kind === 'BACKGROUND') {
      return '背景信息';
    }
    return '长期关注';
  }

  private entryStatusLabel(status: string): string {
    if (status === 'ACTIVE') {
      return '使用中';
    }
    if (status === 'PAUSED') {
      return '已暂停';
    }
    if (status === 'WITHDRAWN') {
      return '已撤回';
    }
    return '已删除';
  }

  @Builder
  private EntryRow(entry: PersonalEntry) {
    Column() {
      Row() {
        Column({ space: 3 }) {
          Text(entry.statement !== '' ? entry.statement : '（正文已删除）')
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(entry.statement !== '' ? PMColors.INK_PRIMARY : PMColors.INK_TERTIARY)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          Text(`${this.entryKindLabel(entry.kind)} · ${this.entryStatusLabel(entry.status)}${entry.topics.length > 0 ? ' · 适用：' + entry.topics.join('、') : ''}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text('详情 ›')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.BRAND)
          .margin({ left: PMSpacing.SM })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .constraintSize({ minHeight: 44 })
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        this.openDetail(entry.claimId);
      })

      Row({ space: PMSpacing.SM }) {
        if (entry.status === 'ACTIVE') {
          this.EntryAction('暂停使用', PMColors.INK_SECONDARY, (): void => {
            this.runCommand(this.commandFor(entry, 'PAUSE'), '已暂停使用；内容保留，模型上下文不再使用。');
          })
        }
        if (entry.status === 'PAUSED' || entry.status === 'WITHDRAWN') {
          this.EntryAction('恢复使用', PMColors.BRAND, (): void => {
            this.runCommand(this.commandFor(entry, 'RESUME'), '已恢复使用。');
          })
        }
        this.EntryAction('删除', PMColors.RISK, (): void => {
          this.runCommand(this.commandFor(entry, 'DELETE'), '已删除：先停止使用，正文已清除。');
        })
      }
      .width('100%')
      .margin({ top: PMSpacing.XS })
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
    .alignItems(HorizontalAlign.Start)
  }

  private commandFor(entry: PersonalEntry, operation: string): PersonalMemoryCommandInput {
    const input = new PersonalMemoryCommandInput();
    input.requestId = `pm-${operation}-${entry.claimId}-${entry.revision}-${Date.now()}`;
    input.operation = operation;
    input.claimId = entry.claimId;
    input.expectedRevision = entry.revision;
    return input;
  }

  private async confirmCandidate(entry: PersonalEntry, scopeProjectId: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      const input = new PersonalMemoryCommandInput();
      input.requestId = `pm-confirm-${entry.claimId}-${entry.revision}-${Date.now()}`;
      input.operation = 'CONFIRM_CANDIDATE';
      input.claimId = entry.claimId;
      input.expectedRevision = entry.revision;
      input.frozenContentHash = entry.contentHash;
      if (scopeProjectId !== '') {
        input.useScopeMode = 'PROJECTS';
        input.useScopeProjectIds = [scopeProjectId];
      }
      await this.service.command(input);
      this.notice = scopeProjectId === '' ? '已按候选范围记住，之后的协作会使用。' : '已仅在该项目中使用。';
      await this.load();
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  private async rejectCandidate(entry: PersonalEntry): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.service.command(this.commandFor(entry, 'REJECT_CANDIDATE'));
      this.notice = '已拒绝；同类依据不变化时不会重复提议。';
      await this.load();
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  @Builder
  private EntryAction(label: string, color: ResourceColor, onRun: () => void) {
    Text(label)
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(color)
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(PMColors.SURFACE_SUBTLE)
      .borderRadius(PMRadius.SM)
      .constraintSize({ minHeight: 32 })
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        onRun();
      })
  }

  private async openDetail(claimId: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      this.detail = await this.service.detail(claimId);
      this.error = '';
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  private async togglePolicy(useEnabled: boolean | undefined, cloudEnabled: boolean | undefined, label: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const input = new PersonalMemoryPolicyInput();
      input.requestId = `pm-policy-${Date.now()}`;
      input.expectedVersion = this.policyVersion;
      input.useInContextEnabled = useEnabled;
      input.cloudProcessingEnabled = cloudEnabled;
      await this.service.updatePolicy(input);
      this.notice = label;
      await this.load();
    } catch (e) {
      this.error = personalMemoryErrorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column() {
      PMAppBar({
        title: '我的记忆',
        subtitle: '忆程 ProjectMemo · 账户协作背景',
        showBack: true,
        backLabel: '设置',
        backDescription: '返回设置'
      })

      Stack() {
        Column() {
          Scroll() {
            Column({ space: PMSpacing.MD }) {
              if (this.notice !== '') {
                Text(this.notice)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.SUCCESS)
                  .width('100%')
                  .padding(PMSpacing.SM)
                  .backgroundColor(PMColors.SUCCESS_LIGHT)
                  .borderRadius(PMRadius.SM)
              }
              if (this.error !== '') {
                Text(this.error)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.RISK)
                  .width('100%')
                  .padding(PMSpacing.SM)
                  .backgroundColor(PMColors.RISK_LIGHT)
                  .borderRadius(PMRadius.SM)
              }

              Row() {
                Text(`已记住（${this.entries.length}）`)
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.INK_PRIMARY)
                  .layoutWeight(1)
                Text(this.showStopped ? '隐藏已停用' : '显示已停用')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.BRAND)
                  .padding({ left: 8, right: 8, top: 6, bottom: 6 })
                  .onClick(() => {
                    this.showStopped = !this.showStopped;
                    this.load();
                  })
                Button('添加', { type: ButtonType.Capsule })
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .height(32)
                  .margin({ left: PMSpacing.SM })
                  .accessibilityText('添加一条个人记忆')
                  .onClick(() => {
                    this.showAddSheet = true;
                  })
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              if (this.loading) {
                LoadingStateView({ message: '正在读取我的记忆…' })
              } else if (this.entries.length === 0) {
                EmptyStateView({
                  title: '还没有保存任何内容',
                  description: '你可以在对话里明确说明一次，或点击右上角“添加”写入一条非敏感偏好或背景。',
                  actionText: '添加一条',
                  onAction: () => {
                    this.showAddSheet = true;
                  }
                })
              } else {
                ForEach(this.entries, (entry: PersonalEntry) => {
                  this.EntryRow(entry)
                }, (entry: PersonalEntry) => entry.claimId + ':' + entry.revision.toString())
              }

              if (this.candidates.length > 0) {
                Column({ space: PMSpacing.SM }) {
                  Text(`待确认的理解（${this.candidates.length}）`)
                    .fontSize(PMFontSize.SECTION_TITLE)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(PMColors.INK_PRIMARY)
                    .width('100%')
                  ForEach(this.candidates, (candidate: PersonalEntry) => {
                    Column({ space: PMSpacing.SM }) {
                      Text(candidate.statement)
                        .fontSize(PMFontSize.BODY)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_PRIMARY)
                        .width('100%')
                      Text(`依据：${candidate.basis}`)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                        .width('100%')
                      Row({ space: PMSpacing.SM }) {
                        Text('按这个范围记住')
                          .fontSize(PMFontSize.CAPTION)
                          .fontWeight(FontWeight.Medium)
                          .fontColor(PMColors.SURFACE)
                          .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                          .backgroundColor(PMColors.BRAND)
                          .borderRadius(PMRadius.SM)
                          .clickEffect(PMInteraction.PRESS_EFFECT)
                          .onClick(() => {
                            this.confirmCandidate(candidate, '');
                          })
                        Select(this.projects.map((project: Project): SelectOption => ({ value: project.title } as SelectOption)))
                          .value('仅保留在…')
                          .font({ size: PMFontSize.CAPTION })
                          .onSelect((index: number) => {
                            if (index >= 0 && index < this.projects.length) {
                              this.confirmCandidate(candidate, this.projects[index].id);
                            }
                          })
                        Text('拒绝')
                          .fontSize(PMFontSize.CAPTION)
                          .fontWeight(FontWeight.Medium)
                          .fontColor(PMColors.INK_SECONDARY)
                          .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                          .backgroundColor(PMColors.SURFACE_SUBTLE)
                          .borderRadius(PMRadius.SM)
                          .clickEffect(PMInteraction.PRESS_EFFECT)
                          .onClick(() => {
                            this.rejectCandidate(candidate);
                          })
                      }
                      .width('100%')
                    }
                    .width('100%')
                    .padding(PMSpacing.MD)
                    .backgroundColor(PMColors.SURFACE)
                    .borderRadius(PMRadius.MD)
                    .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
                    .alignItems(HorizontalAlign.Start)
                  }, (candidate: PersonalEntry) => candidate.claimId + ':' + candidate.revision.toString())
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }

              // 使用与控制：账户开关只影响个人上下文，不影响项目资料与原任务
              Column({ space: PMSpacing.SM }) {
                Text('记忆使用与控制')
                  .fontSize(PMFontSize.SECONDARY)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(PMColors.INK_TERTIARY)
                  .width('100%')
                Row() {
                  Column({ space: 2 }) {
                    Text('在对话与委托中使用')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                    Text('关闭后项目资料与原任务照常可用，已保存内容保留。')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)

                  Toggle({ type: ToggleType.Switch, isOn: this.policyUseEnabled })
                    .selectedColor(PMColors.BRAND)
                    .enabled(this.hasPolicy && !this.busy)
                    .onChange((isOn: boolean) => {
                      this.togglePolicy(isOn, undefined, isOn ? '已开启使用。' : '已关闭使用；项目资料与原任务不受影响。');
                    })
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)

                Row() {
                  Column({ space: 2 }) {
                    Text('允许把个人正文发给远端模型')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                    Text('默认关闭：个人内容只在本地规则处理；开启后仍受当轮云模型许可约束。')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)

                  Toggle({ type: ToggleType.Switch, isOn: this.policyCloudEnabled })
                    .selectedColor(PMColors.BRAND)
                    .enabled(this.hasPolicy && !this.busy)
                    .onChange((isOn: boolean) => {
                      this.togglePolicy(undefined, isOn, isOn ? '已允许远端处理个人正文。' : '已停止远端处理个人正文。');
                    })
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.MD)
              .border({ width: PMCardStyle.BORDER_WIDTH, color: PMColors.BORDER_SUBTLE })
              .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .alignItems(HorizontalAlign.Start)
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
        }
        .width('100%')
        .height('100%')

        // 添加条目：底部弹层，原话 + 类别 + 可选主题；保存失败保留草稿不关闭
        if (this.showAddSheet) {
          Column() {
            Blank()
              .onClick(() => {
                // 点遮罩不丢弃草稿：输入内容还在，用户可继续编辑或明确关闭
              })
              .layoutWeight(1)

            Column({ space: PMSpacing.MD }) {
              PMSheetHeader({
                title: '添加记忆',
                closeLabel: '关闭添加面板，草稿保留',
                onClose: (): void => { this.showAddSheet = false; }
              })

              // 表单可滚动：大字体或键盘弹出时不会把底部说明挤出屏幕。
              Scroll() {
                Column({ space: PMSpacing.MD }) {
                  TextArea({ text: this.addQuote, placeholder: '例如：以后技术讨论先给结论，再按需要展开。' })
                    .fontSize(PMFontSize.BODY)
                    .height(88)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.SM)
                    .border({ width: 1, color: PMColors.BORDER })
                    .onChange((value: string) => {
                      this.addQuote = value;
                    })

                  Row({ space: PMSpacing.SM }) {
                    Select(this.kindNames.map((name: string): SelectOption => ({ value: name } as SelectOption)))
                      .selected(this.addKindIndex)
                      .value(this.kindNames[this.addKindIndex])
                      .fontColor(PMColors.INK_PRIMARY)
                      .font({ size: PMFontSize.SECONDARY, weight: FontWeight.Regular })
                      .onSelect((index: number) => {
                        this.addKindIndex = index;
                      })
                      .layoutWeight(1)
                    TextInput({ text: this.addTopic, placeholder: '适用主题（可选）' })
                      .fontSize(PMFontSize.SECONDARY)
                      .height(40)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })
                      .layoutWeight(2)
                      .onChange((value: string) => {
                        this.addTopic = value;
                      })
                  }
                  .width('100%')

                  Button(this.busy ? '保存中…' : '保存', { type: ButtonType.Normal })
                    .fontSize(PMFontSize.BUTTON)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SURFACE)
                    .backgroundColor(PMColors.BRAND)
                    .borderRadius(PMRadius.SM)
                    .height(44)
                    .width('100%')
                    .enabled(!this.busy && this.addQuote.trim().length > 0)
                    .accessibilityText('保存这条个人记忆')
                    .onClick(() => {
                      const input = new PersonalMemoryCommandInput();
                      input.requestId = `pm-add-${Date.now()}`;
                      input.operation = 'ADD_EXPLICIT';
                      input.quote = this.addQuote.trim();
                      input.kind = this.kindValues[this.addKindIndex];
                      input.topics = this.addTopic.trim() !== '' ? [this.addTopic.trim()] : undefined;
                      this.runCommand(input, '已保存，之后的对话与委托会按当前版本使用。');
                    })
                  Text('凭据、健康、财务等敏感内容不会保存；保存后可随时暂停或删除。')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .width('100%')
                    .lineHeight(18)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }
              .width('100%')
              .scrollBar(BarState.Off)
              .constraintSize({ maxHeight: '58%' })
            }
            .width('100%')
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.XL })
            .backgroundColor(PMColors.SURFACE)
            .borderRadius({ topLeft: PMRadius.XL, topRight: PMRadius.XL })
            .alignItems(HorizontalAlign.Start)
            .transition(PMTransition.CONTENT_ENTER)
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.End)
          .backgroundColor(PMColors.SCRIM)
          .onClick(() => {
            // 遮罩点击不关闭，避免误触丢草稿；右上角关闭按钮是明确关闭入口
          })
        }

        // 条目详情：来源、版本经过
        if (this.detail !== null) {
          Column() {
            Blank()
              .onClick(() => {
                this.detail = null;
              })
              .layoutWeight(1)

            Column({ space: PMSpacing.SM }) {
              PMSheetHeader({
                title: '条目详情',
                closeLabel: '关闭详情',
                onClose: (): void => { this.detail = null; }
              })

              Scroll() {
                Column({ space: PMSpacing.SM }) {
                  Text(this.detail.entry.quote !== '' ? this.detail.entry.quote : this.detail.entry.statement)
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                    .width('100%')
                  Text(`来源：${this.detail.sourceDescription} 形成于 ${TextFormatters.readableText(this.detail.formedAt, '时间未读取')}`)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_SECONDARY)
                    .width('100%')
                    .lineHeight(18)

                  ForEach(this.detail.history, (item: import('../services/PersonalMemoryService').PersonalHistoryItem) => {
                    Text(`#${item.revision} ${item.eventKind} · ${TextFormatters.readableText(item.at, '')}${item.quote !== undefined && item.quote !== null ? ' · ' + item.quote : ''}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_SECONDARY)
                      .width('100%')
                      .lineHeight(18)
                  }, (item: import('../services/PersonalMemoryService').PersonalHistoryItem) => item.revision.toString() + item.at)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
              }
              .width('100%')
              .scrollBar(BarState.Off)
              .constraintSize({ maxHeight: '46%' })

              Button('关闭', { type: ButtonType.Normal })
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.BRAND_LIGHT)
                .borderRadius(PMRadius.SM)
                .height(40)
                .width('100%')
                .onClick(() => {
                  this.detail = null;
                })
            }
            .width('100%')
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.XL })
            .backgroundColor(PMColors.SURFACE)
            .borderRadius({ topLeft: PMRadius.XL, topRight: PMRadius.XL })
            .alignItems(HorizontalAlign.Start)
            .constraintSize({ maxHeight: '70%' })
            .transition(PMTransition.CONTENT_ENTER)
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.End)
          .backgroundColor(PMColors.SCRIM)
          .onClick(() => {
            this.detail = null;
          })
        }
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
