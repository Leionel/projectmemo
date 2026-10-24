import { ApiClient } from './ApiClient';
import {
  CopilotMissionPreviewInput, CopilotMissionConfirmInput, CopilotMissionPreviewReply, CopilotMissionReceiptReply,
  AgentMessage,
  AgentMessagesResponse,
  AgentChatResponse,
  ExecuteToolResponse,
  CopilotChatInput,
  CopilotToolConfirmInput
} from '../models/Copilot';

export class CopilotService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async getChatHistory(projectId: string, sourceRunId: string = ''): Promise<AgentMessage[]> {
    const response: AgentMessagesResponse = await this.client.get<AgentMessagesResponse>(
      `/api/projects/${projectId}/agent/chat${sourceRunId !== '' ? `?sourceRunId=${encodeURIComponent(sourceRunId)}` : ''}`
    );
    return response.messages;
  }

  async askQuestion(projectId: string, message: string, requestId?: string): Promise<AgentChatResponse> {
    const input: CopilotChatInput = new CopilotChatInput();
    input.message = message; input.requestId = requestId;
    const response: AgentChatResponse = await this.client.post<AgentChatResponse>(
      `/api/projects/${projectId}/agent/chat`,
      input
    );
    return response;
  }

  async previewMission(projectId: string, input: CopilotMissionPreviewInput): Promise<CopilotMissionPreviewReply> {
    return this.client.post<CopilotMissionPreviewReply>(`/api/projects/${projectId}/agent/continuation/preview`, input);
  }
  async confirmMission(projectId: string, input: CopilotMissionConfirmInput): Promise<CopilotMissionReceiptReply> {
    return this.client.post<CopilotMissionReceiptReply>(`/api/projects/${projectId}/agent/continuation/confirm`, input);
  }
  async confirmTool(
    projectId: string,
    tool: string,
    payload: Object,
    sourceRunId: string | undefined
  ): Promise<ExecuteToolResponse> {
    const input: CopilotToolConfirmInput = new CopilotToolConfirmInput();
    input.tool = tool;
    input.confirmed = true;
    input.payload = payload;
    input.sourceRunId = sourceRunId;
    const response: ExecuteToolResponse = await this.client.post<ExecuteToolResponse>(
      `/api/projects/${projectId}/agent/tools`,
      input
    );
    return response;
  }
}
