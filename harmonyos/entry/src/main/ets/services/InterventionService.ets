import { ApiClient } from './ApiClient';
import { Intervention, InterventionsResponse, InterventionUpdateResponse } from '../models/Intervention';
import { buildAcceptBody, buildDismissBody, buildSnoozeBody } from '../common/ApiContract';
import { ApiError } from '../models/Project';

// B3 曝光口径（明确记录的近似口径）：提醒列表加载即计一次曝光，按提醒幂等去重；
// 系统通知发布另走 delivery receipt，不把它混入曝光或用户反馈。待上报队列按 projectId 分区（跨项目互不污染），
// 仅删除服务端明确确认的 ID；单批 ≤50 条，失败保留可重试。
const PENDING_EXPOSURE_LIMIT = 100;
const EXPOSURE_CHUNK_SIZE = 50;

class ExposureBody {
  installationId: string = '';
  interventionIds: string[] = [];
}

class ExposureResult {
  exposed: number = 0;
  duplicates: number = 0;
  confirmedIds: string[] = [];
}

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

  private pendingKey(projectId: string): string {
    return `pendingExposureIds_${projectId}`;
  }

  private pendingIds(projectId: string): string[] {
    const cached = AppStorage.get<string>(this.pendingKey(projectId));
    if (cached === undefined || cached === '') {
      return [];
    }
    return cached.split(',');
  }

  private savePending(projectId: string, ids: string[]): void {
    const bounded = ids.slice(0, PENDING_EXPOSURE_LIMIT);
    AppStorage.setOrCreate<string>(this.pendingKey(projectId), bounded.join(','));
  }

  private async reportExposures(projectId: string, openIds: string[]): Promise<void> {
    const mergedSet = new Set<string>([...this.pendingIds(projectId), ...openIds]);
    if (mergedSet.size === 0) {
      return;
    }
    const merged = Array.from<string>(mergedSet);
    const confirmed = new Set<string>();
    // 分批上报，单批不超过接口限制
    for (let start = 0; start < merged.length; start += EXPOSURE_CHUNK_SIZE) {
      const chunk = merged.slice(start, start + EXPOSURE_CHUNK_SIZE);
      try {
        const body = new ExposureBody();
        body.installationId = AppStorage.get<string>('deviceConsumerKey') ?? 'unknown-installation';
        body.interventionIds = chunk;
        const res = await this.client.post<ExposureResult>(
          `/api/projects/${projectId}/interventions/exposures`,
          body
        );
        for (let i = 0; i < (res.confirmedIds ?? []).length; i++) {
          confirmed.add((res.confirmedIds ?? [])[i]);
        }
      } catch (_e) {
        // 失败：本批及之后批次保留待重试，不阻断用户接受/忽略提醒
        break;
      }
    }
    // 只移除服务端明确确认的 ID
    this.savePending(projectId, merged.filter((id: string) => !confirmed.has(id)));
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
