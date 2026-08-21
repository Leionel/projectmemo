import { ApiClient } from './ApiClient';
import { ActionItem, ActionsResponse, ActionUpdateResponse } from '../models/Action';
import { buildActionCompleteBody, buildActionStatusBody } from '../common/ApiContract';

export class ActionService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<ActionItem[]> {
    const response: ActionsResponse = await this.client.get<ActionsResponse>(`/api/projects/${projectId}/actions`);
    return response.actions;
  }

  async complete(projectId: string, actionId: string, resultText: string): Promise<ActionItem> {
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionCompleteBody(resultText)
    );
    return response.action;
  }

  async updateStatus(projectId: string, actionId: string, status: string): Promise<ActionItem> {
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionStatusBody(status)
    );
    return response.action;
  }
}
