import { ProposedAction } from './Intervention';
export class EvidenceTextRange {
  start: number = 0;
  end: number = 0;
}
export class EvidenceAssessment {
  schemaVersion: number = 1;
  policyVersion: string = 'evidence-v1';
  citationAdmissibility: string = 'NOT_CHECKED';
  temporalState: string = 'UNKNOWN';
  semanticVerdict: string = 'NOT_CHECKED';
  knowledgeClass: string = 'PROJECT_OBSERVATION';
  sourceId: string = '';
  sourceRevision: string = '';
  observedAt: string = '';
  sourceTime: string | null = null;
  textRange: EvidenceTextRange | null = null;
  reasonCode: string = 'NOT_CHECKED';
  method: string = 'NONE';
}
export function evidenceAssessmentText(value: EvidenceAssessment): string {
  const citation = value.citationAdmissibility === 'ADMITTED' ? '引用可用' : value.citationAdmissibility === 'REJECTED' ? '引用不可用' : '引用尚未核对';
  const temporal = value.temporalState === 'CURRENT' ? '当前有效' : value.temporalState === 'SUPERSEDED' ? '历史记录' : value.temporalState === 'CONTESTED' ? '存在争议' : '时态未知';
  const semantic = value.semanticVerdict === 'ENTAILS' ? '原文支持此句' : value.semanticVerdict === 'CONTRADICTS' ? '原文与此句相反' : value.semanticVerdict === 'NOT_ENOUGH_INFORMATION' ? '原文不足以支持' : '语义尚未核验';
  return `${citation} · ${temporal} · ${semantic} · ${value.knowledgeClass === 'PROJECT_OBSERVATION' ? '项目记录' : '参考资料'}`;
}

export class AgentCitation {
  assessment: EvidenceAssessment | undefined = undefined;
  cardId: string = '';
  title: string = '';
  excerpt: string = '';
  current: boolean | undefined = undefined;
  supportState: string | undefined = undefined;
  topLevelState: string | undefined = undefined;
  reasonCode: string | undefined = undefined;
  displayReason: string | undefined = undefined;
  temporalReason: string | undefined = undefined;
}

export class EvidenceClaim {
  assessments: EvidenceAssessment[] | undefined = undefined;
  text: string = '';
  support: string = 'INSUFFICIENT';
  cardIds: string[] = [];
  supersededCardIds: string[] = [];
  projectRefs: ProjectEvidenceRef[] | undefined = undefined;
}

export class ProjectEvidenceRef {
  kind: string = 'project_status';
  entityId: string = '';
  label: string = '';
  detail: string = '';
  observedAt: string = '';
}

export class EvidenceTrustReceipt {
  schemaVersion: number | undefined = undefined;
  supportState: string = 'INSUFFICIENT';
  abstained: boolean = true;
  claims: EvidenceClaim[] = [];
  retrievalMode: string = 'none';
  refusalReason: string | undefined = undefined;
  evaluatedAt: string = '';
}

export class AgentMessage {
  id: string = '';
  role: string = 'USER'; // 'USER' | 'ASSISTANT'
  content: string = '';
  citations: AgentCitation[] = [];
  proposedActions: ProposedAction[] = [];
  runId: string | undefined = undefined;
  continuationSuggestion: CopilotContinuationSuggestion | undefined = undefined;
  trustReceipt: EvidenceTrustReceipt | undefined = undefined;
  createdAt: string = '';
}

export class AgentChatResponse {
  message: string = '';
  citations: AgentCitation[] = [];
  proposedActions: ProposedAction[] = [];
  fallback: boolean = false;
  runId: string | undefined = undefined;
  continuationSuggestion: CopilotContinuationSuggestion | undefined = undefined;
  trustReceipt: EvidenceTrustReceipt | undefined = undefined;
}

export class AgentMessagesResponse {
  messages: AgentMessage[] = [];
}

export class ExecuteToolResponse {
  tool: string = '';
  result: Object | undefined = undefined;
}

export class CopilotChatInput {
  requestId: string | undefined = undefined;
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
  sourceRunId: string | undefined = undefined;
}

export class CopilotMissionRef { id: string = ''; version: number = 0; planRevision: number = 0; questionId: string | null = null; approvalId: string | null = null; outputId: string | null = null; outputRevision: number | null = null; }
export class CopilotContinuationSuggestion { schemaVersion: number = 1; kind: string = 'ANSWER_ONLY'; projectId: string = ''; sourceRunId: string = ''; reason: string = ''; goal: string = ''; mission: CopilotMissionRef | null = null; }
export class CopilotMissionPreviewInput { sourceRunId: string = ''; goal: string = ''; llmContextApproved: boolean = false; }
export class CopilotMissionConfirmInput { sourceRunId: string = ''; requestId: string = ''; previewHash: string = ''; confirmed: boolean = true; }
export class CopilotMissionPreview { previewHash: string = ''; goal: string = ''; readOnly: boolean = true; llmContextApproved: boolean = false; successCriteria: string[] = []; }
export class CopilotMissionPreviewReply { preview: CopilotMissionPreview = new CopilotMissionPreview(); }
export class CopilotMissionReceipt { missionId: string = ''; projectId: string = ''; sourceRunId: string = ''; receiptId: string = ''; alreadyCreated: boolean = false; }
export class CopilotMissionReceiptReply { receipt: CopilotMissionReceipt = new CopilotMissionReceipt(); }
