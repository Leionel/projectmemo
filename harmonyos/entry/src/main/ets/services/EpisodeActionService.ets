import { ApiClient } from './ApiClient';
import { EpisodeActionBody, EpisodeActionOutcome, EpisodeActionResponse } from '../models/EpisodeAction';

/** 从阶段检查点的「建议下一步」创建待办；幂等由服务端保证 */
export class EpisodeActionService {
  private client: ApiClient = new ApiClient();

  async createFromSuggestion(projectId: string, episodeId: string, claimId: string, mode: string,
    unblockTargetActionId?: string): Promise<EpisodeActionOutcome> {
    const body = new EpisodeActionBody();
    body.claimId = claimId;
    body.confirm = true;
    body.mode = mode;
    if (unblockTargetActionId !== undefined && unblockTargetActionId !== '') {
      body.unblockTargetActionId = unblockTargetActionId;
    }
    const response = await this.client.post<EpisodeActionResponse>(
      `/api/projects/${projectId}/episodes/${episodeId}/actions`,
      body,
    );
    return response.outcome;
  }
}
