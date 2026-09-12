import { ApiClient } from './ApiClient';
import {
  ArtifactItem,
  ArtifactsResponse,
  ArtifactGenerateResponse,
  ArtifactGenerateInput,
  ArtifactAuditResponse
} from '../models/Artifact';

export class ArtifactService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async list(projectId: string): Promise<ArtifactItem[]> {
    const response: ArtifactsResponse = await this.client.get<ArtifactsResponse>(
      `/api/projects/${projectId}/artifacts`
    );
    return response.artifacts;
  }

  async generate(projectId: string, artifactType: string, content?: string): Promise<ArtifactItem> {
    const input: ArtifactGenerateInput = new ArtifactGenerateInput();
    input.artifactType = artifactType;
    if (content !== undefined && content.trim() !== '') {
      input.content = content;
    }
    const response: ArtifactGenerateResponse = await this.client.post<ArtifactGenerateResponse>(
      `/api/projects/${projectId}/artifacts`,
      input
    );
    return response.artifact;
  }

  // 每次打开审计抽屉都重新请求，不缓存：离线/失败时如实报错，不把旧结果冒充最新核验
  async audit(projectId: string, artifactId: string): Promise<ArtifactAuditResponse> {
    return this.client.get<ArtifactAuditResponse>(
      `/api/projects/${projectId}/artifacts/${artifactId}/audit`
    );
  }
}
