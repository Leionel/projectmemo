import { ApiClient } from './ApiClient';
import { Milestone } from '../models/Milestone';

export class DeliverableEvidenceInput {
  evidenceType: string = '';
  cardId: string | null = null;
  attachmentId: string | null = null;
  confirmed: boolean = false;
}

export class MilestoneService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Milestone[]> {
    return this.client.get<Milestone[]>(`/api/projects/${projectId}/milestones`);
  }

  async confirmEvidence(projectId: string, deliverableId: string, evidenceType: string,
    cardId: string, attachmentId: string, confirmed: boolean): Promise<void> {
    const body = new DeliverableEvidenceInput();
    body.evidenceType = evidenceType;
    body.cardId = cardId || null;
    body.attachmentId = attachmentId || null;
    body.confirmed = confirmed;
    await this.client.post<Object>(
      `/api/projects/${projectId}/milestones/deliverables/${deliverableId}/evidence`,
      body
    );
  }
}
