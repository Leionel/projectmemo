import { ApiClient } from './ApiClient';
import { ConversationReviews, ConversationReviewInput, ConversationReviewReply } from '../models/ChangeReview';
import { ConversationAnchorListReply, ConversationAnchorReply, ConversationAnchorInput, ConversationWorkspaceSyncReply } from '../models/ConversationAnchor';
import { ConversationWork, ConversationWorkRef, ConversationWorkInput, ConversationScenarioInput, ConversationWorkReply, ConversationMaterialAssessment } from '../models/ConversationWork';
import { ConversationCapabilities, ConversationListReply, ConversationCreated, ConversationCreateInput,
  ConversationView, ConversationTurnInput, ConversationTurnReply, ConversationConfirmInput, ConversationConfirmReply,
  FocusPreferenceInput, FocusPreferenceReply, ConversationUIActionInput, ConversationUIActionReply } from '../models/Conversation';
export class ConversationService {
  async reviews(id: string, ref: ConversationWorkRef): Promise<ConversationReviews> { return this.client.get<ConversationReviews>(`/api/conversations/${id}/work/review?kind=${ref.kind}&id=${encodeURIComponent(ref.id)}&projectId=${encodeURIComponent(ref.projectId)}`); }
  async submitReview(id: string, input: ConversationReviewInput): Promise<ConversationReviewReply> { return this.client.post<ConversationReviewReply>(`/api/conversations/${id}/work/review`, input, 60000); }
  private client: ApiClient = new ApiClient();
  async capabilities(): Promise<ConversationCapabilities> { return this.client.get<ConversationCapabilities>('/api/conversations/capabilities'); }
  async list(projectId: string = ''): Promise<ConversationListReply> {
    return this.client.get<ConversationListReply>(`/api/conversations${projectId !== '' ? '?projectId=' + encodeURIComponent(projectId) : ''}`);
  }
  async create(input: ConversationCreateInput): Promise<ConversationCreated> { return this.client.post<ConversationCreated>('/api/conversations', input); }
  async entry(input: ConversationCreateInput): Promise<ConversationCreated> { return this.client.post<ConversationCreated>('/api/conversations/entry', input); }
  async syncWorkspace(): Promise<ConversationWorkspaceSyncReply> { return this.client.post<ConversationWorkspaceSyncReply>('/api/conversations/sync', undefined); }
  async anchors(id: string): Promise<ConversationAnchorListReply> { return this.client.get<ConversationAnchorListReply>(`/api/conversations/${id}/anchors`); }
  async syncAnchors(id: string): Promise<ConversationAnchorReply> { return this.client.post<ConversationAnchorReply>(`/api/conversations/${id}/anchors/sync`, undefined); }
  async updateAnchor(id: string, anchorId: string, input: ConversationAnchorInput): Promise<ConversationAnchorReply> { return this.client.post<ConversationAnchorReply>(`/api/conversations/${id}/anchors/${anchorId}`, input); }
  async read(id: string, beforeSeq: number = 0): Promise<ConversationView> { return this.client.get<ConversationView>(`/api/conversations/${id}${beforeSeq > 0 ? '?beforeSeq=' + beforeSeq : ''}`); }
  async ask(id: string, input: ConversationTurnInput): Promise<ConversationTurnReply> { return this.client.post<ConversationTurnReply>(`/api/conversations/${id}/turns`, input, 210000); }
  async uiAction(id: string, input: ConversationUIActionInput): Promise<ConversationUIActionReply> { return this.client.post<ConversationUIActionReply>(`/api/conversations/${id}/ui-actions`, input); }
  async stop(id: string, turnId: string): Promise<ConversationUIActionReply> { return this.client.post<ConversationUIActionReply>(`/api/conversations/${id}/turns/${turnId}/stop`, undefined); }
  async confirm(id: string, executionId: string, input: ConversationConfirmInput): Promise<ConversationConfirmReply> {
    return this.client.post<ConversationConfirmReply>(`/api/conversations/${id}/proposals/${executionId}/confirm`, input);
  }
  async previewResume(id: string, missionId: string): Promise<ConversationConfirmReply> { return this.client.post<ConversationConfirmReply>(`/api/conversations/${id}/missions/${missionId}/resume-preview`, undefined); }
  async preference(projectId: string): Promise<FocusPreferenceReply> { return this.client.get<FocusPreferenceReply>(`/api/workspace/focus/preferences/${projectId}`); }
  async savePreference(projectId: string, input: FocusPreferenceInput): Promise<FocusPreferenceReply> { return this.client.patch<FocusPreferenceReply>(`/api/workspace/focus/preferences/${projectId}`, input); }
  async work(id: string, ref: ConversationWorkRef): Promise<ConversationWork> { return this.client.get<ConversationWork>(`/api/conversations/${id}/work?kind=${ref.kind}&id=${encodeURIComponent(ref.id)}&projectId=${encodeURIComponent(ref.projectId)}`); }
  async previewWork(id: string, input: ConversationWorkInput): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/work`, input); }
  async compareScenarios(id: string, input: ConversationScenarioInput): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/work/scenarios`, input); }
  async assessMaterials(id: string, input: ConversationWorkInput): Promise<ConversationMaterialAssessment> { return this.client.post<ConversationMaterialAssessment>(`/api/conversations/${id}/work/materials`, input); }
  async decline(id: string, executionId: string): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/proposals/${executionId}/decline`, undefined); }
  async reconcile(id: string): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/reconcile`, undefined); }
}
