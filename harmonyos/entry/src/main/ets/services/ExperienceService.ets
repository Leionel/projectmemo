import { ApiClient } from './ApiClient';
import { SessionStore } from './SessionStore';
import { ApiError } from '../models/Project';
import { ExperienceActionBody, ExperienceActionResult, ExperienceListReply } from '../models/Experience';

/** P3-A 项目内经验：列表与激活/撤销；全程建议性质，不授予写入权限。 */
export class ExperienceService {
  private client: ApiClient;
  constructor(client?: ApiClient) { this.client = client ?? new ApiClient(); }
  private authorize(): void {
    if (!SessionStore.isTokenValid()) {
      SessionStore.handleSessionExpired();
      throw new ApiError('UNAUTHORIZED', '请先登录，再查看项目经验', 401);
    }
  }
  async list(projectId: string): Promise<ExperienceListReply> {
    this.authorize();
    return this.client.get<ExperienceListReply>(`/api/projects/${encodeURIComponent(projectId)}/experiences`);
  }
  async act(projectId: string, experienceId: string, body: ExperienceActionBody): Promise<ExperienceActionResult> {
    this.authorize();
    return this.client.post<ExperienceActionResult>(`/api/projects/${encodeURIComponent(projectId)}/experiences/${encodeURIComponent(experienceId)}`, body);
  }
}
