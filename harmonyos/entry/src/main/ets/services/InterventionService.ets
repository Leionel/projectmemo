import { ApiClient } from './ApiClient';
import { Intervention, InterventionsResponse, InterventionUpdateResponse } from '../models/Intervention';
import { buildAcceptBody, buildDismissBody, buildSnoozeBody } from '../common/ApiContract';
import { ApiError } from '../models/Project';

// B1 曝光口径（明确记录的近似口径）：提醒列表加载即计一次曝光，按提醒幂等去重；
// 系统"送达"从未涉及。失败缓存量（上限 100）随下次列表加载合并重试。
const PENDING_EXPOSURE_KEY = 'pendingExposureIds';
const PENDING_EXPOSURE_LIMIT = 100;

export class InterventionService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Intervention[]> {
    const response: InterventionsResponse = await this.client.get<InterventionsResponse>(`/api/projects/${projectId}/interventions`);
    const openIds: string[] = [];
    for (let i = 0; i < response.interventions.length; i++) {
      const item = response.interventions[i];
      if (item.status === 'OPEN' && !item.isSimulated) {
        openIds.push(item.id);
      }
    }
    this.reportExposures(projectId, openIds);
    return response.interventions;
  }

  private pendingIds(): string[] {
    const cached = AppStorage.get<string>(PENDING_EXPOSURE_KEY);
    if (cached === undefined || cached === '') {
      return [];
    }
    return cached.split(',');
  }

  private savePending(ids: string[]): void {
    const bounded = ids.slice(0, PENDING_EXPOSURE_LIMIT);
    AppStorage.setOrCreate<string>(PENDING_EXPOSURE_KEY, bounded.join(','));
  }

  private async reportExposures(projectId: string, openIds: string[]): Promise<void> {
    const mergedSet = new Set<string>([...this.pendingIds(), ...openIds]);
    if (mergedSet.size === 0) {
      return;
    }
    const ids = Array.from<string>(mergedSet);
    try {
      const body: Record<string, string | string[]> = {
        'installationId': AppStorage.get<string>('deviceConsumerKey') ?? 'unknown-installation',
        'interventionIds': ids
      };
      await this.client.post<{ exposed: number; duplicates: number }>(
        `/api/projects/${projectId}/interventions/exposures`,
        body
      );
      this.savePending([]);
    } catch (_e) {
      // 断网/失败：保留待上报队列，不阻断用户接受/忽略提醒
      this.savePending(ids);
    }
  }

  async get(projectId: string, interventionId: string): Promise<Intervention> {
    const list = await this.list(projectId);
    for (const item of list) {
      if (item.id === interventionId) {
        return item;
      }
    }
    throw new ApiError('INTERVENTION_NOT_FOUND', '提醒记录不存在或已被移除', 404);
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
