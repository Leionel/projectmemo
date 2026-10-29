import { Mission, MissionPolicyEdit, MissionAttentionReceipt } from '../models/Mission';
import { MissionService } from '../services/MissionService';
import { RepoSignalService } from '../services/RepoSignalService';
import { ConnectionView } from '../models/RepoSignal';
@Component
export struct MissionInvestigationDelegation {
  @Prop mission: Mission;
  onSaved: () => void = (): void => {};
  @State until: string = '';
  @State models: string = '8';
  @State tools: string = '12';
  @State error: string = '';
  @State saving: boolean = false;
  @State connections: ConnectionView[] = [];
  @State selected: string[] = [];
  @State interval: string = '5';
  @State metadata: string = '12';
  @State web: boolean = false;
  @State experiments: boolean = false;
  @State papers: boolean = false;
  @State verification: boolean = false;
  @State documents: boolean = false;
  @State logs: boolean = false;
  aboutToAppear(): void {
    this.selected = this.mission.continuationPolicy.connectionIds || [];
    this.models = (this.mission.continuationPolicy.maxModels || 8).toString(); this.tools = (this.mission.continuationPolicy.maxTools || 12).toString();
    this.interval = (this.mission.continuationPolicy.checkEveryMinutes || 5).toString(); this.metadata = (this.mission.continuationPolicy.maxMetadataRequests || 12).toString();
    this.web = (this.mission.continuationPolicy.allowedTools || []).includes('web_search');
    this.experiments = (this.mission.continuationPolicy.allowedTools || []).includes('inspect_experiment_metrics');
    this.papers = (this.mission.continuationPolicy.allowedTools || []).includes('read_paper_metadata');
    this.verification = (this.mission.continuationPolicy.allowedTools || []).includes('propose_metric_verification');
    this.documents = (this.mission.continuationPolicy.allowedTools || []).includes('inspect_document');
    this.logs = (this.mission.continuationPolicy.allowedTools || []).includes('read_ci_log');
    this.loadConnections();
  }
  private async loadConnections(): Promise<void> {
    try { const reply = await new RepoSignalService().list(this.mission.projectId); this.connections = reply.connections.filter((c: ConnectionView) => c.status === 'ACTIVE' && c.revokedAt === null && (c.access === 'COMMITS_AND_CI' || c.access === 'COMMITS_CI_LOGS')); }
    catch { this.error = '仓库范围未取得，请刷新后核对；仍可只调查项目资料'; }
  }
  private logAllowed(): boolean { return this.selected.length > 0 && this.selected.every((id: string) => this.connections.some((c: ConnectionView) => c.id === id && c.access === 'COMMITS_CI_LOGS')); }
  private async seen(): Promise<void> {
    if (this.saving) return; this.saving = true;
    try { const body = new MissionAttentionReceipt(); body.requestId = 'attention-' + Date.now().toString(); body.expectedVersion = this.mission.version; body.decisionId = this.mission.delegation?.attention?.decisionId || ''; await new MissionService().attention(this.mission.id, body); this.onSaved(); }
    catch { this.error = '提醒已变化，请刷新'; } finally { this.saving = false; }
  }
  private async save(stop: boolean): Promise<void> {
    if (this.saving) return; this.saving = true;
    try {
      const body = new MissionPolicyEdit(); body.requestId = 'delegation-' + Date.now().toString(); body.expectedVersion = this.mission.version;
      if (!stop) {
        body.policy.mode = 'BOUNDED_INVESTIGATION'; body.policy.schemaVersion = 1; body.policy.expiresAt = new Date(this.until.replace(' ', 'T') + '+08:00').toISOString();
        body.policy.checkEveryMinutes = Number(this.interval); body.policy.maxModels = Number(this.models); body.policy.maxTools = Number(this.tools); body.policy.maxMetadataRequests = this.selected.length > 0 || this.papers ? Number(this.metadata) : 0;
        body.policy.allowedTools = ['inspect_project', 'search_memory', 'read_project_material', 'inspect_action', 'save_mission_output', 'propose_action'];
        if (this.web) body.policy.allowedTools.push('web_search', 'web_fetch');
        if (this.experiments) body.policy.allowedTools.push('inspect_experiment_metrics', 'compare_experiment_metrics');
        if (this.papers) body.policy.allowedTools.push('read_paper_metadata');
        if (this.verification) body.policy.allowedTools.push('propose_metric_verification');
        if (this.documents) body.policy.allowedTools.push('inspect_document', 'read_document_page', 'read_document_section', 'read_document_table');
        if (this.selected.length > 0) body.policy.allowedTools.push('read_repository_ci', 'read_ci_jobs');
        if (this.logs && this.logAllowed()) body.policy.allowedTools.push('read_ci_log');
        body.policy.connectionIds = this.selected; body.policy.timezone = 'Asia/Shanghai'; body.policy.quietStart = 22; body.policy.quietEnd = 8; body.policy.attention = 'IMPORTANT_ONLY';
      }
      await new MissionService().policy(this.mission.id, body); this.error = ''; this.onSaved();
    } catch { this.error = '许可未保存，请核对期限、预算和原任务状态'; } finally { this.saving = false; }
  }
  build() {
    Column({ space: 8 }) {
      Text('持续调查与打扰方式').fontSize(16)
      Text('新资料或所选提交的 CI 有变化时继续原任务；22:00–08:00 需要你处理的事项排队。').fontSize(13)
      if (this.mission.continuationPolicy.mode === 'BOUNDED_INVESTIGATION') { Text('已允许调查至 ' + (this.mission.continuationPolicy.expiresAt || '') + ' · 原任务累计最多 ' + (this.mission.continuationPolicy.maxModels || 0).toString() + ' 次模型、' + (this.mission.continuationPolicy.maxTools || 0).toString() + ' 次工具').fontSize(13) }
      if (this.mission.delegation?.attention && this.mission.delegation?.attention?.level !== 'SUPPRESS') {
        Text(this.mission.delegation?.attention?.level === 'QUEUE' ? '需要你处理的事项已排队' : this.mission.delegation?.attention?.level === 'URGENT' ? '临近截止，需要你决定' : '任务收件箱有待处理事项').fontSize(13)
        if (this.mission.delegation?.attention?.decisionId && this.mission.delegation?.attention?.delivery?.status !== 'SEEN') { Button('我已看到').enabled(!this.saving).onClick(() => { this.seen(); }) }
      }
      TextInput({ text: this.until, placeholder: '截止时间（北京时间）：2026-10-31 20:00' }).onChange((v: string) => { this.until = v; })
      TextInput({ text: this.models, placeholder: '模型调用总上限' }).type(InputType.Number).onChange((v: string) => { this.models = v; })
      TextInput({ text: this.tools, placeholder: '工具调用总上限' }).type(InputType.Number).onChange((v: string) => { this.tools = v; })
      Row() { Checkbox().select(this.web).onChange((v: boolean) => { this.web = v; }); Text('允许在原公开研究范围内搜索和读取').fontSize(13) }
      if (this.mission.documentDeepReadEnabled) { Row() { Checkbox().select(this.documents).onChange((v: boolean) => { this.documents = v; }); Text('允许按页、章节和表格深读本项目 PDF').fontSize(13) } }
      if (this.mission.experimentObserverEnabled) { Row() { Checkbox().select(this.experiments).onChange((v: boolean) => { this.experiments = v; }); Text('允许继续读取与比较原指标').fontSize(13) } }
      if (this.mission.academicResearchEnabled) { Row() { Checkbox().select(this.papers).onChange((v: boolean) => { this.papers = v; }); Text('允许在原许可内核对论文元数据').fontSize(13) } }
      if (this.mission.sandboxVerificationEnabled) { Row() { Checkbox().select(this.verification).onChange((v: boolean) => { this.verification = v; }); Text('允许提出核算预览，每次执行仍需批准').fontSize(13) } }
      if (this.papers && this.selected.length === 0) { TextInput({text:this.metadata,placeholder:'公开元数据请求累计上限'}).type(InputType.Number).onChange((v:string) => { this.metadata = v; }) }
      ForEach(this.connections, (c: ConnectionView) => {
        Row() { Checkbox().select(this.selected.includes(c.id)).enabled(this.selected.includes(c.id) || this.selected.length < 3).onChange((v: boolean) => { this.selected = v ? [...this.selected, c.id] : this.selected.filter((id: string) => id !== c.id); }); Text(c.repo + ' · ' + c.ref).fontSize(13) }
      }, (c: ConnectionView) => c.id)
      if (this.selected.length > 0) {
        Text('定时读取已收录的最新固定提交；无变化不调用模型，每次最多 3 次仓库请求。').fontSize(13)
        TextInput({ text: this.interval, placeholder: '检查间隔（分钟）' }).type(InputType.Number).onChange((v: string) => { this.interval = v; })
        TextInput({ text: this.metadata, placeholder: '仓库请求累计上限' }).type(InputType.Number).onChange((v: string) => { this.metadata = v; })
        if (this.logAllowed()) { Row() { Checkbox().select(this.logs).onChange((v: boolean) => { this.logs = v; }); Text('允许读取脱敏的失败日志').fontSize(13) } }
      }
      if (this.error !== '') { Text(this.error).fontSize(13) }
      Button('允许按此期限和总预算持续调查').enabled(!this.saving && this.until !== '').onClick(() => { this.save(false); })
      if (this.mission.continuationPolicy.mode === 'BOUNDED_INVESTIGATION') { Button('撤销持续调查').enabled(!this.saving).onClick(() => { this.save(true); }) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
