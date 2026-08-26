import { ProposedAction } from './Intervention';

export class AgentCitation {
  cardId: string = '';
  title: string = '';
  excerpt: string = '';
}

export class AgentMessage {
  id: string = '';
  role: string = 'USER'; // 'USER' | 'ASSISTANT'
  content: string = '';
  citations: AgentCitation[] = [];
  proposedActions: ProposedAction[] = [];
  createdAt: string = '';
}

export class AgentChatResponse {
  message: string = '';
  citations: AgentCitation[] = [];
  proposedActions: ProposedAction[] = [];
  fallback: boolean = false;
  runId: string | undefined = undefined;
}

export class AgentMessagesResponse {
  messages: AgentMessage[] = [];
}

export class ExecuteToolResponse {
  tool: string = '';
  result: Object | undefined = undefined;
}

export class CopilotChatInput {
  message: string = '';
}

export class ActionCreatePayload {
  title: string = '';
  description: string | undefined = undefined;
  priority: number | undefined = undefined;
}

export class ArtifactGeneratePayload {
  artifactType: string = '';
}

export class CopilotToolConfirmInput {
  tool: string = '';
  confirmed: boolean = true;
  payload: Object = new Object();
}
