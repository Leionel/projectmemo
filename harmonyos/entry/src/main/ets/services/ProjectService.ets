import { ApiClient } from './ApiClient';
import { ProjectsResponse, Project } from '../models/Project';
import { ProjectDetail, ProjectDetailResponse } from '../models/Memory';
import { EvaluateResponse } from '../models/Intervention';

class EvaluateProjectBody {
}

export class ProjectService {
  private client: ApiClient = new ApiClient();

  async listProjects(): Promise<Project[]> {
    const response: ProjectsResponse = await this.client.get<ProjectsResponse>('/api/projects');
    return response.projects;
  }

  async getProjectDetail(id: string): Promise<ProjectDetail> {
    const response: ProjectDetailResponse = await this.client.get<ProjectDetailResponse>(`/api/projects/${id}`);
    return response.project;
  }

  async evaluateProject(id: string): Promise<EvaluateResponse> {
    return this.client.post<EvaluateResponse>(`/api/projects/${id}/agent/evaluate`, new EvaluateProjectBody());
  }
}
