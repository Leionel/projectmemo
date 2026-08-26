import { ApiClient } from './ApiClient';
import {
  ArtifactItem,
  ArtifactsResponse,
  ArtifactGenerateResponse,
  ArtifactGenerateInput
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
}
