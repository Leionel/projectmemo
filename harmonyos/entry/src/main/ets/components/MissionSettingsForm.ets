import { MissionCreate, MissionConstraints, MissionScope, MissionCost } from '../models/Mission';
import { editableMissionConstraints } from '../common/MissionContract';
import { PMColors, PMSpacing } from '../common/DesignTokens';

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

  aboutToAppear(): void {
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
    const c = editableMissionConstraints(this.initialConstraints);
    if (this.mode !== 'scope') {
      const minutes = this.minutes.trim() === '' ? null : Number(this.minutes);
      const priority = this.priority.trim() === '' ? null : Number(this.priority);
      const cost = this.cost.trim() === '' ? null : Number(this.cost);
      if ((minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000)) ||
        (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) ||
        (cost !== null && (!Number.isFinite(cost) || cost < 0))) {
        this.error = '请检查时间、费用和优先级的数值'; return;
      }
      if (this.deadline.trim() !== '' && Number.isNaN(Date.parse(this.deadline))) {
        this.error = '请输入有效截止时间，例如 2026-11-01T18:00:00+08:00'; return;
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
      this.error = '请填写公开研究主题和至少一个公开概念'; return;
    }
    if (this.mode === 'create' && value.goal.length < 3) { this.error = '请用至少三个字说明委托目标'; return; }
    this.error = ''; this.onSubmit(value);
  }
  build() {
    Column({ space: 10 }) {
      if (this.mode === 'create') {
        Text('委托一个长期目标').fontSize(20).fontColor(PMColors.INK_PRIMARY)
        TextArea({ placeholder: '例如：根据后续实验结果，准备科研项目阶段汇报', text: this.goal })
          .height(100).maxLength(2000).onChange((v: string) => { this.goal = v; })
      }
      if (this.mode !== 'scope') {
        Text('本任务的个人约束').fontSize(18)
        TextInput({ placeholder: '可投入时间（分钟，留空不限制）', text: this.minutes }).onChange((v: string) => { this.minutes = v; })
        TextInput({ placeholder: '费用上限（留空不限制）', text: this.cost }).onChange((v: string) => { this.cost = v; })
        Row({ space: 10 }) {
          Text('费用币种')
          Button(this.currency === 'CNY' ? '人民币' : '美元').onClick(() => { this.currency = this.currency === 'CNY' ? 'USD' : 'CNY'; })
        }
        TextInput({ placeholder: '截止时间，含时区；留空撤销限制', text: this.deadline }).onChange((v: string) => { this.deadline = v; })
        TextInput({ placeholder: '优先级 1–5（1 最高，留空不指定）', text: this.priority }).onChange((v: string) => { this.priority = v; })
        TextArea({ placeholder: '资源限制，每行一条；清空可撤销', text: this.resources }).height(80).onChange((v: string) => { this.resources = v; })
        TextArea({ placeholder: '禁止的方案，每行一条', text: this.forbidden }).height(80).onChange((v: string) => { this.forbidden = v; })
        TextArea({ placeholder: '已否决的行动，每行一条；由你明确修改', text: this.rejected }).height(80).onChange((v: string) => { this.rejected = v; })
        Row({ space: 10 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.readOnly }).onChange((v: boolean) => { this.readOnly = v; }).accessibilityText('仅允许读取与分析')
          Text('仅读取与分析；关闭后可提议行动，写入仍需批准').layoutWeight(1)
        }
        Row({ space: 10 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.llmApproved }).onChange((v: boolean) => { this.llmApproved = v; }).accessibilityText('批准模型使用本任务项目上下文')
          Text('允许模型服务处理本任务所需的项目上下文').layoutWeight(1)
        }
      }
      if (this.mode !== 'constraints') {
        Text('公开研究范围').fontSize(18)
        Row({ space: 10 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.researchEnabled }).onChange((v: boolean) => { this.researchEnabled = v; }).accessibilityText('允许公开网络研究')
          Text('允许在以下公开范围内自主研究').layoutWeight(1)
        }
        TextInput({ placeholder: '公开研究主题', text: this.topic }).maxLength(300).onChange((v: string) => { this.topic = v; })
        TextArea({ placeholder: '允许外传的公开概念，每行一个；勿填私有资料', text: this.terms }).height(90).onChange((v: string) => { this.terms = v; })
        TextArea({ placeholder: '禁止外传的词，每行一个', text: this.excluded }).height(80).onChange((v: string) => { this.excluded = v; })
        TextArea({ placeholder: '允许访问的域名，每行一个；留空由服务端检查', text: this.hosts }).height(80).onChange((v: string) => { this.hosts = v; })
        Row({ space: 10 }) {
          Toggle({ type: ToggleType.Switch, isOn: this.publicSources }).onChange((v: boolean) => { this.publicSources = v; }).accessibilityText('允许外传公开来源信息')
          Text('允许外传公开来源信息').layoutWeight(1)
        }
        Text('搜索授权与模型上下文授权分别保存。内部实验、身份和私有文档不能因此传给搜索服务。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
      }
      if (this.error !== '') { Text(this.error).fontColor(PMColors.RISK) }
      Button(this.busy ? '正在提交…' : '确认保存').enabled(!this.busy).onClick(() => { this.submit(); })
      Button('收起').enabled(!this.busy).onClick(() => { this.onClose(); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
  }
}
