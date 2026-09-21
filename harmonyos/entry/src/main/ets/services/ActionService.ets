import { ApiClient } from './ApiClient';
import {
  ActionCompleteResponse,
  ActionCreateInput,
  ActionCreateResponse,
  ActionDueAtInput,
  ActionItem,
  ActionsResponse,
  ActionUpdateResponse,
  FeasibilityAssessment,
  FeasibilityInput
} from '../models/Action';
import { buildActionCompleteBody, buildActionStatusBody } from '../common/ApiContract';

export class ActionService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<ActionItem[]> {
    const response: ActionsResponse = await this.client.get<ActionsResponse>(`/api/projects/${projectId}/actions`);
    return response.actions;
  }

  async create(projectId: string, input: ActionCreateInput): Promise<ActionItem> {
    const response = await this.client.post<ActionCreateResponse>(`/api/projects/${projectId}/actions`, input);
    return response.action;
  }

  async getFeasibility(projectId: string, actionId: string): Promise<FeasibilityAssessment> {
    return this.client.get<FeasibilityAssessment>(
      `/api/projects/${projectId}/actions/feasibility?actionId=${actionId}`
    );
  }

  async updateFeasibility(projectId: string, input: FeasibilityInput): Promise<FeasibilityAssessment> {
    return this.client.post<FeasibilityAssessment>(`/api/projects/${projectId}/actions/feasibility`, input);
  }

  async complete(projectId: string, actionId: string, resultText: string): Promise<ActionItem> {
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionCompleteBody(resultText)
    );
    return response.action;
  }

  /**
   * 完成行动并同时处理未来提醒。
   * 返回完整响应：完成回执先落库（它已经发生），提醒处置结果单独返回，
   * 设备上的日程由调用方按 devicePlan 执行删除。
   */
  async completeWithReminder(projectId: string, actionId: string, resultText: string,
    disposition: string, deviceKey: string): Promise<ActionCompleteResponse> {
    return await this.client.patch<ActionCompleteResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionCompleteBody(resultText, disposition, deviceKey)
    );
  }

  async updateStatus(projectId: string, actionId: string, status: string): Promise<ActionItem> {
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionStatusBody(status)
    );
    return response.action;
  }

  async updateDueAt(projectId: string, actionId: string, dueAt: string): Promise<ActionItem> {
    const body = new ActionDueAtInput();
    body.dueAt = dueAt;
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      body
    );
    return response.action;
  }
}
