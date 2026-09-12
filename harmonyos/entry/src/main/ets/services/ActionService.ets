import { ApiClient } from './ApiClient';
import {
  ActionCreateInput,
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
    return this.client.post<ActionItem>(`/api/projects/${projectId}/actions`, input);
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

  async updateStatus(projectId: string, actionId: string, status: string): Promise<ActionItem> {
    const response: ActionUpdateResponse = await this.client.patch<ActionUpdateResponse>(
      `/api/projects/${projectId}/actions/${actionId}`,
      buildActionStatusBody(status)
    );
    return response.action;
  }
}
