import { ApiClient } from './ApiClient';
import { SessionStore } from './SessionStore';
import { ApiError } from '../models/Project';
import { Mission, MissionCreate, MissionReply, MissionDetailReply, MissionList, MissionEvents, MissionCommand,
  MissionCandidates, MissionMaterialInput, MissionMaterialPreview, MissionMaterialConfirm, MissionContinued,
  MissionArtifactInput, MissionArtifactPreviewReply, MissionArtifactConfirm, MissionArtifactReply,
  MissionConstraintsEdit, MissionScopeEdit, MissionPolicyEdit, MissionCapabilities } from '../models/Mission';

export class MissionService {
  private client: ApiClient;
  constructor(client?: ApiClient) { this.client = client ?? new ApiClient(); }
  private authorize(): void {
    if (!SessionStore.isTokenValid()) {
      SessionStore.handleSessionExpired();
      throw new ApiError('UNAUTHORIZED', '请先登录，再查看委托', 401);
    }
  }
  private path(id: string): string { return `/api/missions/${encodeURIComponent(id)}`; }
  async capabilities(projectId: string): Promise<MissionCapabilities> {
    this.authorize(); return this.client.get<MissionCapabilities>(`/api/missions/capabilities?projectId=${encodeURIComponent(projectId)}`);
  }
  async list(projectId: string, cursor: string = ''): Promise<MissionList> {
    this.authorize(); return this.client.get<MissionList>(`/api/missions?projectId=${encodeURIComponent(projectId)}&cursor=${encodeURIComponent(cursor)}`);
  }
  async create(body: MissionCreate): Promise<MissionReply> { this.authorize(); return this.client.post<MissionReply>('/api/missions', body); }
  async detail(id: string): Promise<Mission> {
    this.authorize(); const reply = await this.client.get<MissionDetailReply>(this.path(id)); return reply.mission;
  }
  async events(id: string, after: number): Promise<MissionEvents> {
    this.authorize(); return this.client.get<MissionEvents>(`${this.path(id)}/events?afterSeq=${after}`);
  }
  async command(id: string, action: string, body: MissionCommand, approvalId: string = ''): Promise<MissionReply> {
    this.authorize(); const suffix = approvalId === '' ? action : `approvals/${encodeURIComponent(approvalId)}`;
    return this.client.post<MissionReply>(`${this.path(id)}/${suffix}`, body);
  }
  async candidates(id: string): Promise<MissionCandidates> {
    this.authorize(); return this.client.get<MissionCandidates>(`${this.path(id)}/continuations`);
  }
  async previewMaterial(id: string, body: MissionMaterialInput): Promise<MissionMaterialPreview> {
    this.authorize(); return this.client.post<MissionMaterialPreview>(`${this.path(id)}/continuations/preview`, body);
  }
  async confirmMaterial(id: string, body: MissionMaterialConfirm): Promise<MissionContinued> {
    this.authorize(); return this.client.post<MissionContinued>(`${this.path(id)}/continuations/confirm`, body);
  }
  async previewArtifact(id: string, outputId: string, body: MissionArtifactInput): Promise<MissionArtifactPreviewReply> {
    this.authorize(); return this.client.post<MissionArtifactPreviewReply>(`${this.path(id)}/outputs/${encodeURIComponent(outputId)}/artifact-preview`, body);
  }
  async confirmArtifact(id: string, outputId: string, body: MissionArtifactConfirm): Promise<MissionArtifactReply> {
    this.authorize(); return this.client.post<MissionArtifactReply>(`${this.path(id)}/outputs/${encodeURIComponent(outputId)}/artifact-confirm`, body);
  }
  async constraints(id: string, body: MissionConstraintsEdit): Promise<MissionReply> {
    this.authorize(); return this.client.patch<MissionReply>(`${this.path(id)}/constraints`, body);
  }
  async scope(id: string, body: MissionScopeEdit): Promise<MissionReply> {
    this.authorize(); return this.client.patch<MissionReply>(`${this.path(id)}/research-scope`, body);
  }
  async policy(id: string, body: MissionPolicyEdit): Promise<MissionReply> {
    this.authorize(); return this.client.patch<MissionReply>(`${this.path(id)}/continuation-policy`, body);
  }
}
