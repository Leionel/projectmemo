import { ApiClient } from './ApiClient';
import { Milestone } from '../models/Milestone';

export class MilestoneService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Milestone[]> {
    return this.client.get<Milestone[]>(`/api/projects/${projectId}/milestones`);
  }

  async confirmEvidence(projectId: string, deliverableId: string, evidenceType: string,
    cardId: string, attachmentId: string, confirmed: boolean): Promise<void> {
    await this.client.post(`/api/projects/${projectId}/milestones/deliverables/${deliverableId}/evidence`, {
      evidenceType,
      cardId: cardId || null,
      attachmentId: attachmentId || null,
      confirmed
    });
  }
}
