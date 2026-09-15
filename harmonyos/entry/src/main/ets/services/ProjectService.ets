import { ApiClient } from './ApiClient';
import {
  ProjectsResponse,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectCreateResponse
} from '../models/Project';
import { ApiError } from '../models/Project';
import { ProjectDetail, ProjectDetailResponse } from '../models/Memory';
import { EvaluateResponse, EvaluateProjectInput } from '../models/Intervention';

export class ProjectService {
  private client: ApiClient = new ApiClient();

  async listProjects(): Promise<Project[]> {
    const response: ProjectsResponse = await this.client.get<ProjectsResponse>('/api/projects');
    if (!response || !Array.isArray(response.projects)) {
      throw new ApiError('INVALID_PROJECT_RESPONSE', '项目列表格式不完整，请更新后端后重试');
    }
    for (const project of response.projects) {
      if (!project || !project.dashboard || !project._count ||
        !project.dashboard.deadline || !project.dashboard.readiness || !project.dashboard.nextAction) {
        throw new ApiError('INVALID_PROJECT_RESPONSE', '项目概览数据不完整，请更新后端后重试');
      }
    }
    return response.projects;
  }

  async getProjectDetail(id: string): Promise<ProjectDetail> {
    const response: ProjectDetailResponse = await this.client.get<ProjectDetailResponse>(`/api/projects/${id}`);
    return response.project;
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    const response: ProjectCreateResponse = await this.client.post<ProjectCreateResponse>(
      '/api/projects',
      input
    );
    return response.project;
  }

  async updateProject(id: string, input: ProjectUpdateInput): Promise<ProjectDetail> {
    const response: ProjectDetailResponse = await this.client.patch<ProjectDetailResponse>(
      `/api/projects/${id}`,
      input
    );
    return response.project;
  }

  async evaluateProject(id: string, scenario?: string, clearSimulation: boolean = false): Promise<EvaluateResponse> {
    const body: EvaluateProjectInput = new EvaluateProjectInput();
    if (scenario !== undefined && scenario !== '') {
      body.scenario = scenario;
    }
    if (clearSimulation) {
      body.clearSimulation = true;
    }
    return this.client.post<EvaluateResponse>(`/api/projects/${id}/agent/evaluate`, body);
  }
}
