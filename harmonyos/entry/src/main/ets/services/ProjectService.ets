import { ApiClient } from './ApiClient';
import { ProjectsResponse, Project } from '../models/Project';

export class ProjectService {
  private client: ApiClient = new ApiClient();

  async listProjects(): Promise<Project[]> {
    const response: ProjectsResponse = await this.client.get<ProjectsResponse>('/api/projects');
    return response.projects;
  }
}
