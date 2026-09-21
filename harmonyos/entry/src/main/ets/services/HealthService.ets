import { ApiClient } from './ApiClient';
import { ProjectHealthReport, ProjectHealthResponse } from '../models/Health';

/** 项目体检：只读聚合，读取不产生任何业务写入 */
export class HealthService {
  private client: ApiClient = new ApiClient();

  async load(projectId: string): Promise<ProjectHealthReport> {
    const response: ProjectHealthResponse = await this.client.get<ProjectHealthResponse>(
      `/api/projects/${projectId}/health`,
    );
    return response.report;
  }
}
