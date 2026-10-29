import { Mission, MissionPolicyEdit } from '../models/Mission';
import { MissionService } from '../services/MissionService';
@Component
export struct MissionInvestigationDelegation {
  @Prop mission: Mission;
  onSaved: () => void = (): void => {};
  @State until: string = '';
  @State models: string = '8';
  @State tools: string = '12';
  @State error: string = '';
  @State saving: boolean = false;
  private async save(stop: boolean): Promise<void> {
    if (this.saving) return; this.saving = true;
    try {
      const body = new MissionPolicyEdit(); body.requestId = 'delegation-' + Date.now().toString(); body.expectedVersion = this.mission.version;
      if (!stop) {
        body.policy.mode = 'BOUNDED_INVESTIGATION'; body.policy.schemaVersion = 1; body.policy.expiresAt = new Date(this.until.replace(' ', 'T') + '+08:00').toISOString();
        body.policy.checkEveryMinutes = 5; body.policy.maxModels = Number(this.models); body.policy.maxTools = Number(this.tools); body.policy.maxMetadataRequests = 0;
        body.policy.allowedTools = ['inspect_project', 'search_memory', 'read_project_material', 'inspect_action', 'save_mission_output', 'propose_action'];
        body.policy.connectionIds = []; body.policy.timezone = 'Asia/Shanghai'; body.policy.quietStart = 22; body.policy.quietEnd = 8; body.policy.attention = 'IMPORTANT_ONLY';
      }
      await new MissionService().policy(this.mission.id, body); this.error = ''; this.onSaved();
    } catch { this.error = '许可未保存，请核对期限、预算和原任务状态'; } finally { this.saving = false; }
  }
  build() {
    Column({ space: 8 }) {
      Text('持续调查与打扰方式').fontSize(16)
      Text('有新资料或已刷新的仓库线索时继续原任务；22:00–08:00 需要你处理的事项排队。').fontSize(13)
      if (this.mission.continuationPolicy.mode === 'BOUNDED_INVESTIGATION') { Text('已允许调查至 ' + (this.mission.continuationPolicy.expiresAt || '')).fontSize(13) }
      TextInput({ text: this.until, placeholder: '截止时间（北京时间）：2026-10-31 20:00' }).onChange((v: string) => { this.until = v; })
      TextInput({ text: this.models, placeholder: '模型调用总上限' }).type(InputType.Number).onChange((v: string) => { this.models = v; })
      TextInput({ text: this.tools, placeholder: '工具调用总上限' }).type(InputType.Number).onChange((v: string) => { this.tools = v; })
      if (this.error !== '') { Text(this.error).fontSize(13) }
      Button('允许按此期限和总预算持续调查').enabled(!this.saving && this.until !== '').onClick(() => { this.save(false); })
      if (this.mission.continuationPolicy.mode === 'BOUNDED_INVESTIGATION') { Button('撤销持续调查').enabled(!this.saving).onClick(() => { this.save(true); }) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
