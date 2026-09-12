import { ApiClient } from './ApiClient';
import {
  PolicyResponse,
  PolicySuggestionBody,
  PolicyUpdateBody
} from '../models/Intervention';

// 提醒策略：预算、静默时段与降频建议。V1 为单端安装的全局共享预算，
// 不宣称跨设备/多人同步；所有修改都会提升策略版本并可恢复默认。
export class InterventionPolicyService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async get(projectId: string): Promise<PolicyResponse> {
    return this.client.get<PolicyResponse>(`/api/projects/${projectId}/interventions/policy`);
  }

  async update(projectId: string, input: PolicyUpdateBody): Promise<PolicyResponse> {
    return this.client.patch<PolicyResponse>(`/api/projects/${projectId}/interventions/policy`, input);
  }

  async decideSuggestion(projectId: string, action: string, triggerType: string): Promise<void> {
    const body = new PolicySuggestionBody();
    body.action = action;
    body.triggerType = triggerType;
    await this.client.post<object>(`/api/projects/${projectId}/interventions/policy/suggestion`, body);
  }

  async restoreDefaults(projectId: string): Promise<void> {
    await this.client.post<object>(`/api/projects/${projectId}/interventions/policy/restore`, undefined);
  }
}
