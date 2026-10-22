import { MissionCreate, MissionConstraints, MissionScope, MissionCost } from '../models/Mission';
import { editableMissionConstraints } from '../common/MissionContract';
import { PMColors } from '../common/DesignTokens';
import { PMButton } from './PMReferencePrimitives';

@Component
export struct MissionSettingsForm {
  @Prop mode: string = 'create';
  @Prop initialConstraints: MissionConstraints = new MissionConstraints();
  @Prop initialScope: MissionScope = new MissionScope();
  @Prop busy: boolean = false;
  onSubmit: (value: MissionCreate) => void = () => {};
  onClose: () => void = () => {};
  @State goal: string = '';
  @State minutes: string = '';
  @State resources: string = '';
  @State cost: string = '';
  @State currency: string = 'CNY';
  @State deadline: string = '';
  @State priority: string = '';
  @State forbidden: string = '';
  @State rejected: string = '';
  @State readOnly: boolean = false;
  @State llmApproved: boolean = false;
  @State researchEnabled: boolean = false;
  @State topic: string = '';
  @State terms: string = '';
  @State excluded: string = '';
  @State hosts: string = '';
  @State publicSources: boolean = false;
  @State error: string = '';
  @State showConstraints: boolean = false;
  @State showResearch: boolean = false;

  aboutToAppear(): void {
    this.showConstraints = this.mode === 'constraints';
    this.showResearch = this.mode === 'scope';
    const c = this.initialConstraints;
    this.minutes = c.availableMinutes === null ? '' : `${c.availableMinutes}`;
    this.resources = c.resourceLimits.join('\n'); this.cost = c.costCeiling === null ? '' : `${c.costCeiling.amount}`;
    this.currency = c.costCeiling?.currency ?? 'CNY'; this.deadline = c.deadline ?? '';
    this.priority = c.priority === null ? '' : `${c.priority}`;
    this.forbidden = c.forbiddenApproaches.join('\n'); this.rejected = c.rejectedActions.join('\n');
    this.readOnly = c.executionBoundary === 'READ_ANALYZE'; this.llmApproved = c.llmContextApproved === true;
    const s = this.initialScope; this.researchEnabled = s.enabled; this.topic = s.topic;
    this.terms = s.publicTerms.join('\n'); this.excluded = s.excludedTerms.join('\n');
    this.hosts = s.allowedHosts.join('\n'); this.publicSources = s.allowedCategories.includes('PUBLIC_SOURCE');
  }
  private lines(text: string): string[] { return text.split('\n').map((s: string) => s.trim()).filter((s: string) => s !== ''); }
  private submit(): void {
    const value = new MissionCreate(); value.goal = this.goal.trim();
    if (this.mode === 'create' && value.goal.length < 3) { this.error = '请先填写委托目标，至少三个字'; return; }
    const c = editableMissionConstraints(this.initialConstraints);
    if (this.mode !== 'scope') {
      const minutes = this.minutes.trim() === '' ? null : Number(this.minutes);
      const priority = this.priority.trim() === '' ? null : Number(this.priority);
      const cost = this.cost.trim() === '' ? null : Number(this.cost);
      if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000)) {
        this.showConstraints = true; this.error = '可投入时间请填写 1–100000 之间的整数分钟'; return;
      }
      if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) {
        this.showConstraints = true; this.error = '请选择 1–5 之间的优先级'; return;
      }
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
        this.showConstraints = true; this.error = '费用上限请填写大于或等于 0 的金额'; return;
      }
      if (this.deadline.trim() !== '' && Number.isNaN(Date.parse(this.deadline))) {
        this.showConstraints = true; this.error = '请重新选择截止日期和时间'; return;
      }
      c.availableMinutes = minutes; c.priority = priority;
      c.deadline = this.deadline.trim() === '' ? null : new Date(this.deadline).toISOString();
      c.costCeiling = null;
      if (cost !== null) { const ceiling = new MissionCost(); ceiling.amount = cost; ceiling.currency = this.currency; c.costCeiling = ceiling; }
      c.resourceLimits = this.lines(this.resources); c.forbiddenApproaches = this.lines(this.forbidden);
      c.rejectedActions = this.lines(this.rejected); c.executionBoundary = this.readOnly ? 'READ_ANALYZE' : 'PROPOSE_ACTION';
    }
    value.missionConstraints = c; value.llmContextApproved = this.llmApproved;
    const s = new MissionScope(); s.enabled = this.researchEnabled; s.topic = this.topic.trim();
    s.publicTerms = this.lines(this.terms); s.excludedTerms = this.lines(this.excluded); s.allowedHosts = this.lines(this.hosts);
    s.allowedCategories = this.publicSources ? ['PUBLIC_TOPIC', 'PUBLIC_SOURCE'] : ['PUBLIC_TOPIC'];
    value.researchScope = s;
    if (this.mode !== 'constraints' && s.enabled && (s.topic === '' || s.publicTerms.length === 0)) {
      this.showResearch = true; this.error = '开启公开研究后，请填写研究主题和至少一个可用于搜索的公开概念'; return;
    }
    this.error = ''; this.onSubmit(value);
  }
  private deadlineDate(): Date {
    if (this.deadline !== '' && !Number.isNaN(Date.parse(this.deadline))) return new Date(this.deadline);
    const date = new Date(); date.setHours(18, 0, 0, 0); return date;
  }
  private pickDate(): void {
    DatePickerDialog.show({ start: new Date(2000, 0, 1), end: new Date(2100, 11, 31), selected: this.deadlineDate(),
      onDateAccept: (date: Date) => {
        const selected = this.deadlineDate(); selected.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        this.deadline = selected.toISOString();
      } });
  }
  private pickTime(): void {
    TimePickerDialog.show({ selected: this.deadlineDate(), useMilitaryTime: true,
      onAccept: (time: TimePickerResult) => {
        const selected = this.deadlineDate(); selected.setHours(time.hour, time.minute, 0, 0);
        this.deadline = selected.toISOString();
      } });
  }
  @Builder
  private Label(title: string, help: string = '') {
    Column({ space: 4 }) {
      Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      if (help !== '') { Text(help).fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  build() {
    Column({ space: 14 }) {
      if (this.mode === 'create') {
        Column({ space: 10 }) {
          this.Label('委托目标 · 必填', '希望持续推进什么？说明要得到的结果，以及需要关注的变化。')
          TextArea({ placeholder: '例如：结合后续实验记录，持续整理一份带来源的阶段汇报草稿。', text: this.goal })
            .height(120).fontSize(15).maxLength(2000).borderRadius(12).backgroundColor(PMColors.SURFACE_SUBTLE)
            .enabled(!this.busy).onChange((v: string) => { this.goal = v; })
          Button('填入阶段汇报示例', { type: ButtonType.Normal }).fontSize(13).enabled(!this.busy)
            .backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).borderRadius(11)
            .constraintSize({ minHeight: 44 }).padding({ left: 12, right: 12 }).onClick(() => {
            this.goal = '根据本项目已有材料，形成带来源的阶段汇报草稿，包括已完成事项、当前风险和下一步建议。缺少依据的内容列为信息缺口，不编造实验指标。本次只读取、分析和保存草稿，不搜索网络，不创建或修改行动。';
            this.readOnly = true;
          })
        }.width('100%').padding(14).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(18)
      }
      if (this.mode !== 'scope') {
        Column({ space: 10 }) {
          this.Label('执行方式', '创建或修改行动前，仍需你确认。')
          Row({ space: 8 }) {
            Button('仅读取与分析', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(13)
              .fontColor(this.readOnly ? PMColors.BRAND : PMColors.INK_SECONDARY).borderRadius(11)
              .backgroundColor(this.readOnly ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE).enabled(!this.busy)
              .accessibilitySelected(this.readOnly).onClick(() => { this.readOnly = true; })
            Button('可提议行动', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(13)
              .fontColor(!this.readOnly ? PMColors.BRAND : PMColors.INK_SECONDARY).borderRadius(11)
              .backgroundColor(!this.readOnly ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE).enabled(!this.busy)
              .accessibilitySelected(!this.readOnly).onClick(() => { this.readOnly = false; })
          }.width('100%')
          Row({ space: 10 }) {
            Column({ space: 4 }) {
              Text('允许模型使用本任务资料').fontSize(14).fontColor(PMColors.INK_PRIMARY)
              Text('模型服务可处理完成此委托所需的项目上下文。').fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            Toggle({ type: ToggleType.Switch, isOn: this.llmApproved }).selectedColor(PMColors.BRAND).enabled(!this.busy)
              .onChange((v: boolean) => { this.llmApproved = v; }).accessibilityText('允许模型使用本任务资料')
          }.width('100%').padding({ top: 6 })
        }.width('100%').padding(14).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(18)
        Column({ space: 12 }) {
          Button(this.showConstraints ? '时间与限制（选填）  收起 ↑' : '时间与限制（选填）  展开 ↓', { type: ButtonType.Normal })
            .width('100%').constraintSize({ minHeight: 44 }).fontSize(14).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
            .enabled(!this.busy).onClick(() => { this.showConstraints = !this.showConstraints; })
          if (this.showConstraints) {
            this.Label('可投入时间 · 分钟', '你愿意为这次委托投入的总时间；留空不限制。')
            TextInput({ placeholder: '例如：120', text: this.minutes }).height(44).fontSize(14).borderRadius(11)
              .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.minutes = v; })
            this.Label('费用上限', '留空不限制；填 0 表示不接受费用。')
            Row({ space: 8 }) {
              TextInput({ placeholder: '例如：50', text: this.cost }).height(44).fontSize(14).borderRadius(11).layoutWeight(1)
                .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.cost = v; })
              Button(this.currency === 'CNY' ? '人民币 ▾' : '美元 ▾', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 })
                .fontSize(13).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(11).enabled(!this.busy)
                .onClick(() => { this.currency = this.currency === 'CNY' ? 'USD' : 'CNY'; })
            }.width('100%')
            this.Label('截止时间', this.deadline === '' ? '未设置截止时间；按本机时区选择。' : new Date(this.deadline).toLocaleString('zh-CN'))
            Row({ space: 8 }) {
              Button('选择日期', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(13)
                .borderRadius(11).backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.pickDate(); })
              Button('选择时间', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 }).fontSize(13)
                .borderRadius(11).backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.pickTime(); })
              if (this.deadline !== '') {
                Button('清除', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(13)
                  .backgroundColor(Color.Transparent).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.deadline = ''; })
              }
            }.width('100%')
            this.Label('优先级', '1 最高，5 最低；不指定则交由任务判断。')
            Select([{ value: '不指定' }, { value: '1 · 最高' }, { value: '2 · 较高' }, { value: '3 · 普通' }, { value: '4 · 较低' }, { value: '5 · 最低' }])
              .selected(this.priority === '' ? 0 : Number(this.priority)).value(this.priority === '' ? '不指定' : `${this.priority} 级`)
              .width('100%').height(44).font({ size: 14 }).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(11).enabled(!this.busy)
              .onSelect((index: number) => { this.priority = index === 0 ? '' : `${index}`; })
            this.Label('资源限制', '每行一条；留空表示没有额外限制。')
            TextArea({ placeholder: '例如：只能使用现有实验设备', text: this.resources }).height(80).fontSize(14).borderRadius(12)
              .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.resources = v; })
            this.Label('不要采用的方案', '每行一条。')
            TextArea({ placeholder: '例如：不购买付费数据集', text: this.forbidden }).height(80).fontSize(14).borderRadius(12)
              .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.forbidden = v; })
            this.Label('已经否决的行动', '记录不应再次提议的行动；每行一条。')
            TextArea({ placeholder: '例如：不再重复上一轮完整训练', text: this.rejected }).height(80).fontSize(14).borderRadius(12)
              .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.rejected = v; })
          }
        }.width('100%').padding(14).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(18)
      }
      if (this.mode !== 'constraints') {
        Column({ space: 12 }) {
          Button(this.showResearch ? '公开网络研究（可选）  收起 ↑' : `公开网络研究 · ${this.researchEnabled ? '已开启' : '未开启'}  展开 ↓`, { type: ButtonType.Normal })
            .width('100%').constraintSize({ minHeight: 44 }).fontSize(14).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
            .enabled(!this.busy).onClick(() => { this.showResearch = !this.showResearch; })
          if (this.showResearch) {
            Row({ space: 10 }) {
              Text('允许公开网络研究').fontSize(14).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.researchEnabled }).selectedColor(PMColors.BRAND).enabled(!this.busy)
                .onChange((v: boolean) => { this.researchEnabled = v; }).accessibilityText('允许公开网络研究')
            }.width('100%')
            Text('仅在你指定的公开范围内研究；搜索授权与模型资料授权分别设置。').fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
            if (this.researchEnabled) {
              this.Label('公开研究主题 · 必填')
              TextInput({ placeholder: '例如：轻量视觉模型的部署方法', text: this.topic }).maxLength(300).height(44).fontSize(14).borderRadius(11)
                .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.topic = v; })
              this.Label('可用于搜索的公开概念 · 必填', '每行一个；不要填写内部实验、身份信息或私有文档内容。')
              TextArea({ placeholder: '例如：模型量化\n边缘设备推理', text: this.terms }).height(90).fontSize(14).borderRadius(12)
                .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.terms = v; })
              this.Label('禁止外传的词 · 选填', '每行一个。')
              TextArea({ placeholder: '例如：未公开的项目代号', text: this.excluded }).height(80).fontSize(14).borderRadius(12)
                .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.excluded = v; })
              this.Label('允许访问的域名 · 选填', '每行一个；留空仍由服务端检查访问范围。')
              TextArea({ placeholder: '例如：arxiv.org', text: this.hosts }).height(80).fontSize(14).borderRadius(12)
                .backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.hosts = v; })
              Row({ space: 10 }) {
                Text('允许外传公开来源信息').fontSize(14).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
                Toggle({ type: ToggleType.Switch, isOn: this.publicSources }).selectedColor(PMColors.BRAND).enabled(!this.busy)
                  .onChange((v: boolean) => { this.publicSources = v; }).accessibilityText('允许外传公开来源信息')
              }.width('100%')
            }
          }
        }.width('100%').padding(14).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE).borderRadius(18)
      }
      if (this.error !== '') { Text(this.error).fontSize(13).fontColor(PMColors.RISK).accessibilityText(this.error) }
      PMButton({ label: this.busy ? '正在保存…' : this.mode === 'create' ? '创建长期委托' : '保存修改', disabled: this.busy, onAction: () => { this.submit(); } })
      PMButton({ label: this.mode === 'create' ? '取消创建' : '返回', secondary: true, disabled: this.busy, onAction: () => { this.onClose(); } })
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 16 })
  }
}
