import { AgentPresentation } from './AgentExperience';
export interface ConversationEntry { kind: string; projectId: string; id: string; revision?: string; }
export interface ConversationRef { bindingId?: string; kind: string; id: string; projectId: string; title: string; status?: string; version?: number; href: string; }
export interface ConversationSource { id: string; projectId: string; sourceId: string; revision: string; title: string; excerpt: string; observedAt: string; temporalState: string; }
export interface ConversationFileGuide {
  number: number; sourceId: string; projectId: string; entityId: string; kind: string; title: string; revision: string;
  stale: boolean; missing: boolean; archived: boolean; temporalState: string; excerpt: string; quote: string | null; readScope: string; href: string;
}
export interface ConversationCitation { sourceId: string; quote: string; }
export interface PriorityReason { projectId: string; importance: string; urgency: string; blocking: string; effort: string; preference: string; tradeoff: string; unknown: string[]; basis: string; }
export interface ConversationProposal { tool?: string; executionId: string; projectId: string; title: string; description: string; proposalHash: string; status: string; resultId: string | null; actionStatus?: string | null; resultCardId?: string | null; }
export interface ConversationOption { key: string; label: string; projectId: string; missionId: string; proposalId: string; proposalHash: string; expectedVersion: number; purpose?: string; candidateId?: string; }
export interface ConversationMessage { id: string; seq: number; role: string; content: string; restricted: boolean; refs: ConversationRef[]; sources: ConversationSource[]; priorities: PriorityReason[]; proposal: ConversationProposal | null; provider: string; limitations: string[]; options?: ConversationOption[]; fileGuides?: ConversationFileGuide[]; citations?: ConversationCitation[]; presentation?: AgentPresentation; }
export interface ConversationProject { id: string; title: string; }
export interface ConversationListItem { id: string; title: string; scope: string; homeProjectId: string | null; }
export interface ConversationListReply { conversations: ConversationListItem[]; nextCursor: string | null; }
export interface ConversationReadStep { id: string; label: string; status: string; }
export interface ConversationProgress { phase: string; mode: string; completedReads: number; readLimit: number; steps: ConversationReadStep[]; stopReason: string | null; }
export interface ConversationActiveTurn { id: string; requestId: string; status: string; progress?: ConversationProgress; }
export interface ConversationTurnState { id: string; status: string; message: string; canRetry: boolean; }
export class ConversationView {
  schemaVersion: number = 1; id: string = ''; title: string = ''; scope: string = '';
  version: number = 1; homeProjectId: string | null = null; focusProjectId: string | null = null;
  messages: ConversationMessage[] = []; linkedProjects: ConversationProject[] = [];
  activeTurn: ConversationActiveTurn | null = null; hasMore: boolean = false; beforeSeq: number | null = null;
  latestTurn?: ConversationTurnState | null;
}
export interface ConversationCapabilities { schemaVersion: number; enabled: boolean; cloudAvailable: boolean; intents: string[]; r4Available?: boolean; }
export class ConversationCreateInput { requestId: string = ''; scope: string = 'WORKSPACE'; projectId?: string; entry?: ConversationEntry; }
export class ConversationEntityInput { kind: string = 'MISSION'; id: string = ''; projectId: string = ''; }
export class ConversationTurnInput {
  requestId: string = ''; expectedVersion: number = 1; message: string = '';
  projectId?: string | null; replyToMessageId?: string; llmContextApproved: boolean = false; entityRef?: ConversationEntityInput;
  investigationMode?: string;
}
export class ConversationConfirmInput { requestId: string = ''; proposalHash: string = ''; confirmed: boolean = true; expectedConversationVersion?: number; }
export interface ConversationCreated { id: string; }
export interface ConversationTurnReply { turnId: string; status: string; conversation: ConversationView; }
export interface ConversationConfirmReply { actionId?: string; missionId?: string; resultId?: string | null; alreadyExecuted?: boolean; conversation: ConversationView; }
export class ConversationUIActionInput { messageId: string = ''; bindingId: string = ''; requestId: string = ''; expectedConversationVersion: number = 1; }
export interface ConversationUIActionReply { conversation: ConversationView; href?: string; actionId?: string; alreadyExecuted?: boolean; }
export class FocusPreferenceInput { expectedVersion: number = 0; importance: number | null = null; longTermGoal: string = ''; estimatedMinutes: number | null = null; notes: string = ''; }
export interface FocusPreference { version: number; importance: number | null; longTermGoal: string; estimatedMinutes: number | null; notes: string; }
export interface FocusPreferenceReply { preference: FocusPreference | null; }
