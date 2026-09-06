import { ApiClient } from './ApiClient';
import {
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

  async getChatHistory(projectId: string): Promise<AgentMessage[]> {
    const response: AgentMessagesResponse = await this.client.get<AgentMessagesResponse>(
      `/api/projects/${projectId}/agent/chat`
    );
    return response.messages;
  }

  async askQuestion(projectId: string, message: string): Promise<AgentChatResponse> {
    const input: CopilotChatInput = new CopilotChatInput();
    input.message = message;
    const response: AgentChatResponse = await this.client.post<AgentChatResponse>(
      `/api/projects/${projectId}/agent/chat`,
      input
    );
    return response;
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
