import { ApiClient } from './ApiClient';
import { KnowledgeCard, ProjectDetailResponse, CaptureResponse } from '../models/Memory';
import { buildCaptureBody } from '../common/ApiContract';

export class MemoryService {
  private client: ApiClient = new ApiClient();

  async getTimeline(projectId: string): Promise<KnowledgeCard[]> {
    const response: ProjectDetailResponse = await this.client.get<ProjectDetailResponse>(`/api/projects/${projectId}`);
    return response.project.cards;
  }

  async capture(projectId: string, rawText: string): Promise<KnowledgeCard> {
    const response: CaptureResponse = await this.client.post<CaptureResponse>(`/api/projects/${projectId}/captures`, buildCaptureBody(rawText));
    return response.card;
  }
}
