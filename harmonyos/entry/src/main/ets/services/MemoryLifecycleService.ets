import { ApiClient } from './ApiClient';
import {
  LifecycleActionBody,
  LifecycleArchiveResponse,
  LifecycleConfirmResponse,
  LifecycleEventsResponse
} from '../models/Memory';

// 记忆生命周期：人工确认是“来源声明”，不是自动证明事实真实；
// 归档是可恢复的检索/展示偏好，与时间有效性正交。
export class MemoryLifecycleService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async confirmFact(projectId: string, cardId: string, reason?: string): Promise<LifecycleConfirmResponse> {
    const body = new LifecycleActionBody();
    body.action = 'CONFIRM';
    if (reason !== undefined && reason !== '') {
      body.reason = reason;
    }
    return this.client.post<LifecycleConfirmResponse>(
      `/api/projects/${projectId}/cards/${cardId}/lifecycle`,
      body
    );
  }

  async archive(projectId: string, cardId: string, reason?: string): Promise<LifecycleArchiveResponse> {
    const body = new LifecycleActionBody();
    body.action = 'ARCHIVE';
    if (reason !== undefined && reason !== '') {
      body.reason = reason;
    }
    return this.client.post<LifecycleArchiveResponse>(
      `/api/projects/${projectId}/cards/${cardId}/lifecycle`,
      body
    );
  }

  async restore(projectId: string, cardId: string, reason?: string): Promise<LifecycleArchiveResponse> {
    const body = new LifecycleActionBody();
    body.action = 'RESTORE';
    if (reason !== undefined && reason !== '') {
      body.reason = reason;
    }
    return this.client.post<LifecycleArchiveResponse>(
      `/api/projects/${projectId}/cards/${cardId}/lifecycle`,
      body
    );
  }

  async listEvents(projectId: string, cardId: string): Promise<LifecycleEventsResponse> {
    return this.client.get<LifecycleEventsResponse>(
      `/api/projects/${projectId}/cards/${cardId}/lifecycle`
    );
  }
}
