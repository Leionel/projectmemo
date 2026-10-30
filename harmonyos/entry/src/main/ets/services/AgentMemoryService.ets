import { ApiClient } from './ApiClient';
import { ClaimControls, ClaimText, ClaimCommand, ClaimReceipt, AgentMemoryReply } from '../models/AgentMemory';
export class AgentMemoryService {
  private client: ApiClient = new ApiClient();
  private path(projectId: string): string { return `/api/projects/${encodeURIComponent(projectId)}/agent-claims`; }
  async memory(projectId: string): Promise<AgentMemoryReply> {
    return this.client.get<AgentMemoryReply>(`/api/projects/${encodeURIComponent(projectId)}/agent-memory`);
  }
  async controls(projectId: string): Promise<ClaimControls> { return this.client.get<ClaimControls>(this.path(projectId)); }
  async source(projectId: string, kind: string, id: string): Promise<ClaimText> {
    return this.client.get<ClaimText>(`${this.path(projectId)}?kind=${encodeURIComponent(kind)}&sourceId=${encodeURIComponent(id)}`);
  }
  async submit(projectId: string, body: ClaimCommand): Promise<ClaimReceipt> {
    return this.client.post<ClaimReceipt>(this.path(projectId), body);
  }
}
