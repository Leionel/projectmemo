import { ApiClient } from './ApiClient';
import {
  ChangeImpactProposal,
  ConfirmChangeInput,
  ConfirmChangeResult
} from '../models/DecisionImpact';

export class DecisionService {
  private client: ApiClient = new ApiClient();

  async previewImpact(projectId: string, newFactText: string): Promise<ChangeImpactProposal> {
    const payload: Record<string, string> = {
      'newFactText': newFactText
    };
    return this.client.post<ChangeImpactProposal>(
      `/api/projects/${projectId}/decisions/impact-preview`,
      payload
    );
  }

  async confirmChange(projectId: string, input: ConfirmChangeInput): Promise<ConfirmChangeResult> {
    return this.client.post<ConfirmChangeResult>(
      `/api/projects/${projectId}/decisions/confirm-change`,
      input
    );
  }
}
