import { ApiClient } from './ApiClient';
import {
  ChangeBriefResponse,
  StateCheckInBody,
  StateCheckInResponse,
  StateDiffResponse,
  StateSnapshotResponse,
  StateRefreshResponse
} from '../models/ProjectState';

// 项目状态：GET 不隐式生成；每次打开面板都重新拉取，
// 离线/失败时如实报错，不把缓存快照冒充最新状态。
export class ProjectStateService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async getLatest(projectId: string): Promise<StateSnapshotResponse> {
    return this.client.get<StateSnapshotResponse>(`/api/projects/${projectId}/state`);
  }

  async refresh(projectId: string): Promise<StateRefreshResponse> {
    return this.client.post<StateRefreshResponse>(`/api/projects/${projectId}/state/refresh`, undefined);
  }

  async diff(projectId: string, fromSnapshotId: string, toSnapshotId: string): Promise<StateDiffResponse> {
    return this.client.get<StateDiffResponse>(
      `/api/projects/${projectId}/state/diff?from=${fromSnapshotId}&to=${toSnapshotId}`
    );
  }

  async getBrief(projectId: string, fromSnapshotId: string, toSnapshotId: string): Promise<ChangeBriefResponse> {
    const fromPart = fromSnapshotId === '' ? '' : `from=${fromSnapshotId}&`;
    return this.client.get<ChangeBriefResponse>(
      `/api/projects/${projectId}/state/brief?${fromPart}to=${toSnapshotId}`
    );
  }

  async checkIn(projectId: string, displayedSnapshotId: string, consumerKey: string): Promise<StateCheckInResponse> {
    const body = new StateCheckInBody();
    body.displayedSnapshotId = displayedSnapshotId;
    body.consumerKey = consumerKey;
    return this.client.post<StateCheckInResponse>(`/api/projects/${projectId}/state/check-in`, body);
  }
}
