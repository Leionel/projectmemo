import { ApiClient } from './ApiClient';
import {
  ProjectsResponse,
  ProjectDeletionInfo,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectCreateResponse,
  ProjectLifecycleResponse
} from '../models/Project';
import { ApiError } from '../models/Project';
import { ProjectDetail, ProjectDetailResponse } from '../models/Memory';
import { EvaluateResponse, EvaluateProjectInput } from '../models/Intervention';

export class ProjectService {
  private client: ApiClient = new ApiClient();
  deletionNotice: string = '';
  private createRequestIds: Map<string, string> = new Map<string, string>();

  /**
   * 主列表默认不含已归档项目。
   * 提醒 / 待办 / 记忆检索都由这个列表驱动，多带一份归档数据等于让归档项目继续打扰用户。
   */
  async listProjects(): Promise<Project[]> {
    const response: ProjectsResponse = await this.client.get<ProjectsResponse>('/api/projects');
    const pending: number = (response.deletions ?? []).filter(item => item.status !== 'COMPLETED').length;
    this.deletionNotice = pending > 0 ? `${pending} 个项目已停用，附件清理待完成；刷新查看进度` : (response.deletions ?? []).length > 0 ? response.deletions[0].message : '';
    return this.validateProjects(response);
  }

  /** 已归档项目单独取，供归档管理入口使用。 */
  async listArchivedProjects(): Promise<Project[]> {
    const response: ProjectsResponse = await this.client.get<ProjectsResponse>('/api/projects?archived=true');
    const pending: number = (response.deletions ?? []).filter(item => item.status !== 'COMPLETED').length;
    this.deletionNotice = pending > 0 ? `${pending} 个项目已停用，附件清理待完成；刷新查看进度` : (response.deletions ?? []).length > 0 ? response.deletions[0].message : '';
    return this.validateProjects(response);
  }

  private validateProjects(response: ProjectsResponse): Project[] {
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
    const payload: string = JSON.stringify([input.title, input.description, input.goal, input.scenario, input.deadline]);
    if (input.requestId === '') {
      input.requestId = this.createRequestIds.get(payload) ?? `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    this.createRequestIds.set(payload, input.requestId);
    const response: ProjectCreateResponse = await this.client.post<ProjectCreateResponse>(
      '/api/projects',
      input
    );
    this.createRequestIds.delete(payload);
    return response.project;
  }

  async updateProject(id: string, input: ProjectUpdateInput): Promise<ProjectDetail> {
    const response: ProjectDetailResponse = await this.client.patch<ProjectDetailResponse>(
      `/api/projects/${id}`,
      input
    );
    return response.project;
  }

  /**
   * 归档项目：可恢复的展示偏好，不改变记忆时态、行动与成果。
   * 返回归档时间，供调用方确认服务端实际记录的时刻（重复归档不会刷新它）。
   */
  async archiveProject(id: string): Promise<string | undefined> {
    const response: ProjectLifecycleResponse = await this.client.post<ProjectLifecycleResponse>(
      `/api/projects/${id}/archive`,
      undefined
    );
    return response.project.archivedAt;
  }

  /** 恢复已归档项目：归档期间被隐藏的数据从未改动，恢复不需要补偿写入。 */
  async restoreProject(id: string): Promise<string | undefined> {
    const response: ProjectLifecycleResponse = await this.client.post<ProjectLifecycleResponse>(
      `/api/projects/${id}/restore`,
      undefined
    );
    return response.project.archivedAt;
  }

  /**
   * 删除项目：服务端级联清空该项目的记忆卡片、行动与成果，不可恢复。
   * 与归档性质不同，界面上必须明确区分并二次确认。
   */
  async deleteProject(id: string, expectedVersion: string): Promise<string> {
    const result: ProjectDeletionResponse = await this.client.delete<ProjectDeletionResponse>(`/api/projects/${id}`, id, expectedVersion);
    return result.deletion.message;
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

class ProjectDeletionResponse {
  deletion: ProjectDeletionInfo = new ProjectDeletionInfo();
}
