import { ApiClient } from './ApiClient';
import { Intervention, InterventionsResponse, InterventionUpdateResponse } from '../models/Intervention';
import { buildAcceptBody, buildDismissBody, buildSnoozeBody } from '../common/ApiContract';

export class InterventionService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Intervention[]> {
    const response: InterventionsResponse = await this.client.get<InterventionsResponse>(`/api/projects/${projectId}/interventions`);
    return response.interventions;
  }

  async get(projectId: string, interventionId: string): Promise<Intervention> {
    const list = await this.list(projectId);
    for (const item of list) {
      if (item.id === interventionId) {
        return item;
      }
    }
    throw new Error('Intervention not found');
  }

  async accept(projectId: string, interventionId: string, actionIndex: number): Promise<InterventionUpdateResponse> {
    return this.client.patch<InterventionUpdateResponse>(
      `/api/projects/${projectId}/interventions/${interventionId}`,
      buildAcceptBody(actionIndex)
    );
  }

  async snooze(projectId: string, interventionId: string, until: string): Promise<InterventionUpdateResponse> {
    return this.client.patch<InterventionUpdateResponse>(
      `/api/projects/${projectId}/interventions/${interventionId}`,
      buildSnoozeBody(until)
    );
  }

  async dismiss(projectId: string, interventionId: string, reason: string): Promise<InterventionUpdateResponse> {
    return this.client.patch<InterventionUpdateResponse>(
      `/api/projects/${projectId}/interventions/${interventionId}`,
      buildDismissBody(reason)
    );
  }
}
