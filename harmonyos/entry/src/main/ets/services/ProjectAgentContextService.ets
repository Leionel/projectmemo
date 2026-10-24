import { ApiClient } from './ApiClient';
import { AgentContextReply, AgentFocusInput } from '../models/ProjectAgentContext';
export class ProjectAgentContextService {
  private client: ApiClient = new ApiClient();
  read(projectId: string): Promise<AgentContextReply> { return this.client.get<AgentContextReply>(`/api/projects/${encodeURIComponent(projectId)}/agent-context`); }
  focus(projectId: string, missionId: string | null): Promise<AgentContextReply> {
    const body = new AgentFocusInput(); body.missionId = missionId;
    return this.client.patch<AgentContextReply>(`/api/projects/${encodeURIComponent(projectId)}/agent-context`, body);
  }
}
