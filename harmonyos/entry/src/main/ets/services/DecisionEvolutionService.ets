import { ApiClient } from './ApiClient';
import { ImpactReply, DecisionInput, DecisionConfirm, DecisionReply, DecisionReceiptReply, GoalQuestionReply, GoalQuestionInput, DecisionAck } from '../models/DecisionEvolution';
export class DecisionEvolutionService {
 private client: ApiClient;
 constructor(client?: ApiClient) { this.client = client ?? new ApiClient(); }
 async latest(missionId: string): Promise<DecisionReply> { return this.client.get<DecisionReply>(`/api/missions/${encodeURIComponent(missionId)}/decision-scenarios`); }
 async impact(projectId: string): Promise<ImpactReply> { return this.client.get<ImpactReply>(`/api/projects/${encodeURIComponent(projectId)}/impact`); }
 async create(missionId: string, body: DecisionInput): Promise<DecisionReply> { return this.client.post<DecisionReply>(`/api/missions/${encodeURIComponent(missionId)}/decision-scenarios`, body); }
 async read(id: string): Promise<DecisionReply> { return this.client.get<DecisionReply>(`/api/decision-scenarios/${encodeURIComponent(id)}`); }
 async adopt(id: string, body: DecisionConfirm): Promise<DecisionReceiptReply> { return this.client.post<DecisionReceiptReply>(`/api/decision-scenarios/${encodeURIComponent(id)}`, body); }
 async reject(id: string): Promise<DecisionAck> { return this.client.delete<DecisionAck>(`/api/decision-scenarios/${encodeURIComponent(id)}`); }
 async question(projectId: string): Promise<GoalQuestionReply> { return this.client.get<GoalQuestionReply>(`/api/projects/${encodeURIComponent(projectId)}/goal-question`); }
 async respond(projectId: string, body: GoalQuestionInput): Promise<GoalQuestionReply> { return this.client.post<GoalQuestionReply>(`/api/projects/${encodeURIComponent(projectId)}/goal-question`, body); }
 async resetQuestion(missionId: string): Promise<DecisionAck> { return this.client.delete<DecisionAck>(`/api/missions/${encodeURIComponent(missionId)}/goal-question-preference`); }
}
