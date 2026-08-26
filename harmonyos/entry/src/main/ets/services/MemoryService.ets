import { ApiClient } from './ApiClient';
import { KnowledgeCard, ProjectDetailResponse, CaptureResponse, CaptureInput, CardSearchResponse } from '../models/Memory';

export class MemoryService {
  private client: ApiClient = new ApiClient();

  async getTimeline(projectId: string): Promise<KnowledgeCard[]> {
    const response: ProjectDetailResponse = await this.client.get<ProjectDetailResponse>(`/api/projects/${projectId}`);
    return response.project.cards;
  }

  async capture(projectId: string, rawText: string, sourceType?: string): Promise<KnowledgeCard> {
    const input: CaptureInput = new CaptureInput();
    input.rawText = rawText;
    if (sourceType !== undefined && sourceType !== '') {
      input.sourceType = sourceType;
    }
    const response: CaptureResponse = await this.client.post<CaptureResponse>(
      `/api/projects/${projectId}/captures`,
      input
    );
    return response.card;
  }

  async searchCards(projectId: string, query: string, type?: string): Promise<KnowledgeCard[]> {
    const typeParam = type && type !== 'all' ? `&type=${encodeURIComponent(type)}` : '';
    const res: CardSearchResponse = await this.client.get<CardSearchResponse>(
      `/api/projects/${projectId}/cards/search?q=${encodeURIComponent(query)}${typeParam}`
    );
    const detail = await this.getTimeline(projectId);
    if (!res.results || res.results.length === 0) return detail;

    // 按检索分数排序并映射
    const scoreMap = new Map<string, number>();
    for (const r of res.results) {
      scoreMap.set(r.cardId, r.score);
    }

    return detail.filter((c) => scoreMap.has(c.id)).sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
  }
}
