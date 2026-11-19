import { MissionBudgetReview } from "../models/Mission";
import { MissionReadTarget, MissionReadbackReply, missionReadbackQuery } from '../models/MissionReadback';
import { ApiClient } from './ApiClient';
import { NativeMaterialExtract, NativeMaterialPreview, NativeMaterialPreviewBody } from '../models/NativeMaterial';
import { MissionAttentionReceipt } from '../models/Mission';
import { MissionWorkbench, WorkbenchMaterial, WorkbenchMaterialReply, WorkbenchReadReceipt, WorkbenchReadReply, OutcomeChallengeReply,
  OutcomeChallengeCommand, WorkbenchDelivery, ProjectDelegation, DelegationInput, DelegationPreview, DelegationConfirmation, DelegationResult,
  WorkbenchSprintView, WorkbenchSprintCommand } from '../models/MissionWorkbench';
import { SessionStore } from './SessionStore';
import { ApiError } from '../models/Project';
import { Mission, MissionCreate, MissionReply, MissionDetailReply, MissionList, MissionEvents, MissionCommand,
  MissionCandidates, MissionMaterialInput, MissionMaterialPreview, MissionMaterialConfirm, MissionContinued,
  MissionArtifactInput, MissionArtifactPreviewReply, MissionArtifactConfirm, MissionArtifactReply,
  MissionConstraintsEdit, MissionScopeEdit, MissionPolicyEdit, MissionCapabilities, MissionWorkspaceSummary,
  MissionResponsibilityView, MissionResponsibilityReply, MissionResponsibilityRevisionInput } from '../models/Mission';

export class MissionService {
  async workbench(id: string, revision: number = 0, baseline: number = 0): Promise<MissionWorkbench> {
    this.authorize(); return this.client.get<MissionWorkbench>(`${this.path(id)}/workbench?revision=${revision}&from=${baseline}`);
  }
  async workbenchDelivery(id: string, outputId: string, revision: number, baseline: number = 0): Promise<WorkbenchDelivery> {
    this.authorize();
    return this.client.get<WorkbenchDelivery>(`${this.path(id)}/outputs/${encodeURIComponent(outputId)}/delivery?revision=${revision}&from=${baseline}`);
  }
  private projectDelegationPath(id: string): string { return `/api/projects/${encodeURIComponent(id)}/v2-delegation`; }
  async projectDelegation(id: string): Promise<ProjectDelegation> {
    this.authorize(); return this.client.get<ProjectDelegation>(this.projectDelegationPath(id));
  }
  async previewDelegation(id: string, body: DelegationInput): Promise<DelegationPreview> {
    this.authorize(); return this.client.post<DelegationPreview>(this.projectDelegationPath(id) + '/preview', body);
  }
  async confirmDelegation(id: string, body: DelegationConfirmation): Promise<DelegationResult> {
    this.authorize(); return this.client.post<DelegationResult>(this.projectDelegationPath(id) + '/confirm', body);
  }
  async workbenchSprint(id: string): Promise<WorkbenchSprintView> {
    this.authorize(); return this.client.get<WorkbenchSprintView>(this.path(id) + '/sprint');
  }
  async commandSprint(id: string, body: WorkbenchSprintCommand): Promise<WorkbenchSprintView> {
    this.authorize(); return this.client.post<WorkbenchSprintView>(this.path(id) + '/sprint', body);
  }
  async addWorkbenchMaterial(id: string, body: WorkbenchMaterial): Promise<WorkbenchMaterialReply> { this.authorize(); return this.client.post<WorkbenchMaterialReply>(`${this.path(id)}/materials`, body); }
  async markWorkbenchOutputRead(id: string, body: WorkbenchReadReceipt): Promise<WorkbenchReadReply> {
    this.authorize(); return this.client.post<WorkbenchReadReply>(`${this.path(id)}/reentry-brief`, body);
  }

  async challenge(id: string): Promise<OutcomeChallengeReply> { this.authorize(); return this.client.get<OutcomeChallengeReply>(`${this.path(id)}/challenges`); }
  async startChallenge(id: string, body: OutcomeChallengeCommand): Promise<OutcomeChallengeReply> { this.authorize(); return this.client.post<OutcomeChallengeReply>(`${this.path(id)}/challenges`, body); }
  async challengeCommand(id: string, challengeId: string, body: OutcomeChallengeCommand): Promise<OutcomeChallengeReply> { this.authorize(); return this.client.post<OutcomeChallengeReply>(`${this.path(id)}/challenges/${encodeURIComponent(challengeId)}`, body); }
  async attention(id: string, body: MissionAttentionReceipt): Promise<void> { this.authorize(); await this.client.patch<Object>(`${this.path(id)}/attention`, body); }
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
  async summary(projectId: string): Promise<MissionWorkspaceSummary> {
    this.authorize(); return this.client.get<MissionWorkspaceSummary>(`/api/missions/summary?projectId=${encodeURIComponent(projectId)}`);
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
  async candidates(id: string, questionId: string = '', sourceId: string = '', includeExisting: boolean = false): Promise<MissionCandidates> {
    this.authorize();
    const query: string[] = [];
    if (questionId !== '') query.push(`questionId=${encodeURIComponent(questionId)}`);
    if (sourceId !== '') query.push(`sourceId=${encodeURIComponent(sourceId)}`);
    if (includeExisting) query.push('includeExisting=1');
    return this.client.get<MissionCandidates>(`${this.path(id)}/continuations${query.length > 0 ? '?' + query.join('&') : ''}`);
  }
  async previewMaterial(id: string, body: MissionMaterialInput): Promise<MissionMaterialPreview> {
    this.authorize(); return this.client.post<MissionMaterialPreview>(`${this.path(id)}/continuations/preview`, body);
  }
  async confirmMaterial(id: string, body: MissionMaterialConfirm): Promise<MissionContinued> {
    this.authorize(); return this.client.post<MissionContinued>(`${this.path(id)}/continuations/confirm`, body);
  }
  async readback(id: string, target: MissionReadTarget): Promise<MissionReadbackReply> {
    this.authorize(); return this.client.get<MissionReadbackReply>(`${this.path(id)}/readback?${missionReadbackQuery(target)}`);
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
  async budgetReview(id:string,body:MissionBudgetReview):Promise<MissionReply> { this.authorize(); return this.client.post<MissionReply>(`${this.path(id)}/budget-review`,body); }
  async policy(id: string, body: MissionPolicyEdit): Promise<MissionReply> {
    this.authorize(); return this.client.patch<MissionReply>(`${this.path(id)}/continuation-policy`, body);
  }
  async responsibility(id: string): Promise<MissionResponsibilityView> {
    this.authorize();
    const reply = await this.client.get<MissionResponsibilityReply>(`${this.path(id)}/responsibility`);
    return reply.responsibility;
  }
  async reviseResponsibility(id: string, body: MissionResponsibilityRevisionInput): Promise<MissionResponsibilityView> {
    this.authorize();
    const reply = await this.client.patch<MissionResponsibilityReply>(`${this.path(id)}/responsibility`, body);
    return reply.responsibility;
  }
}
