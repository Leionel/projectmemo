import { MissionExperience } from './Experience';
import { FitPremise, EvidenceReview, EvidenceFit, FitExcerpt } from './EvidenceFit';

export class MissionConstraints {
  availableMinutes: number | null = null;
  resourceLimits: string[] = [];
  costCeiling: MissionCost | null = null;
  deadline: string | null = null;
  priority: number | null = null;
  forbiddenApproaches: string[] = [];
  rejectedActions: string[] = [];
  executionBoundary: string = 'PROPOSE_ACTION';
  llmContextApproved?: boolean;
}
export class MissionCost { amount: number = 0; currency: string = 'CNY'; }
export class MissionScope {
  enabled: boolean = false;
  topic: string = '';
  publicTerms: string[] = [];
  allowedCategories: string[] = ['PUBLIC_TOPIC'];
  excludedTerms: string[] = [];
  allowedHosts: string[] = [];
}
export class MissionPolicy { mode: string = 'MANUAL'; schemaVersion?: number; expiresAt?: string; checkEveryMinutes?: number; maxModels?: number; maxTools?: number; maxMetadataRequests?: number; allowedTools?: string[]; connectionIds?: string[]; timezone?: string; quietStart?: number; quietEnd?: number; attention?: string; }
export class MissionCreate {
  projectId: string = '';
  requestId: string = '';
  goal: string = '';
  missionConstraints: MissionConstraints = new MissionConstraints();
  researchScope: MissionScope = new MissionScope();
  llmContextApproved: boolean = false;
  continuationPolicy: MissionPolicy = new MissionPolicy();
}
export interface MissionSummary { id: string; goal: string; status: string; version: number; }
export interface MissionList { missions: MissionSummary[]; nextCursor: string | null; }
export interface MissionReply { mission: MissionSummary; }
export interface MissionDetailReply { mission: Mission; }
export interface MissionCapabilities { enabled: boolean; widgetEnabled: boolean; }
export interface MissionQuestionPayload { question: string; missing: string; gapId?: string; }
export interface MissionQuestion { id: string; seq: number; payloadJson: MissionQuestionPayload; }
export interface MissionSource {
  id: string; kind: string; entityType: string; hash: string; revision: string;
  text?: string; url?: string; excerpts?: string[];
  knowledgeClass?: string;
}
export interface MissionResult { data?: Object; sources?: MissionSource[]; }
export interface MissionStep { id: string; ordinal: number; toolName: string; status: string; result: MissionResult | null; }
export interface MissionActionArgs { title: string; description?: string; priority?: number; dueAt?: string | null; }
export interface MissionProposal { tool: string; args: MissionActionArgs; }
export interface MissionApproval { id: string; proposalHash: string; proposal: MissionProposal; expiresAt: string; }
export interface MissionBlock { blockId: string; text: string; kind: string; sourceIds: string[]; }
export interface MissionContent { blocks: MissionBlock[]; }
export interface MissionClaim { claimId?: string; blockId?: string; text?: string; status: string; mode?: string; }
export interface MissionOutput { id: string; revision: number; contentJson: MissionContent; verificationStatus: string; claimChecksJson: MissionClaim[]; }
export interface MissionRecovery {
  kind: string; automatic: boolean; message: string;
  attempt?: number; maxAttempts?: number; nextAttemptAt?: string;
}
export interface MissionError { code?: string; message?: string; phase?: string; recovery?: MissionRecovery; }
export interface MissionCompletionSummary {
  criteriaPassed: boolean | null; criteriaCheckedAt: string | null;
  draftVerification: string | null; adoptionCount: number; latestArtifactId: string | null;
  realityOutcome: string;
}
export interface MissionCompletionFact { label: string; value: string; }
export class MissionAttentionReceipt { requestId: string = ''; expectedVersion: number = 1; decisionId: string = ''; }
export interface MissionAttention { level: string; reason: string; decisionId?: string; delivery?: MissionAttentionDelivery; }
export interface MissionAttentionDelivery { status: string; seenAt?: string | null; }
export interface MissionDelegation { attention?: MissionAttention | null; }
export class Mission {
  delegation?: MissionDelegation | null;
  evidencePremise?: FitPremise | null;
  id: string = ''; projectId: string = ''; goal: string = ''; status: string = '';
  version: number = 1; contextVersion: number = 1; planRevision: number = 1;
  constraintsVersion: number = 1; researchScopeVersion: number = 1;
  constraints: MissionConstraints = new MissionConstraints();
  researchScope: MissionScope = new MissionScope();
  continuationPolicy: MissionPolicy = new MissionPolicy();
  autoContinuationEnabled: boolean = false; artifactAdoptionEnabled: boolean = false;
  investigationDelegationEnabled?: boolean;
  pauseRequestedAt: string | null = null; cancelRequestedAt: string | null = null;
  pauseReason: string | null = null; error: MissionError | null = null;
  completion?: MissionCompletionSummary;
  experience?: MissionExperience;
  question: MissionQuestion | null = null;
  steps: MissionStep[] = []; approvals: MissionApproval[] = []; outputs: MissionOutput[] = [];
}
export interface MissionEvent { id: string; seq: number; type: string; createdAt: string; payloadJson: Object; }
export interface MissionEvents { events: MissionEvent[]; nextAfterSeq: number; }
export class MissionCommand {
  evidenceReview?: EvidenceReview;
  requestId: string = ''; expectedVersion: number = 1;
  questionId?: string; answer?: string; decision?: string; proposalHash?: string;
}
export interface MissionPointer { id: string; hash: string; }
export interface MissionCandidate { title?: string; sourcePointer: MissionPointer; readable: boolean; excerpt: string; observedAt: string; }
export interface MissionCandidates { candidates: MissionCandidate[]; }
export class MissionMaterialInput { questionId: string = ''; sourcePointers: MissionPointer[] = []; evidenceReview?: EvidenceReview; }
export interface MissionMaterialPreview {
  evidenceFit?: EvidenceFit; fitHash?: string;
  observationExcerpts?: FitExcerpt[];
  questionId: string; version: number; contextVersion: number; assessment: string; relevance: string;
  sourcePointers: MissionPointer[]; assessmentHash: string; remaining: string[]; readable: boolean;
}
export class MissionMaterialConfirm extends MissionMaterialInput {
  fitHash?: string;
  requestId: string = ''; expectedVersion: number = 1; expectedContextVersion: number = 1;
  assessmentHash: string = ''; answer: string = ''; confirmedGap: boolean = true;
}
export interface MissionContinued { continued: boolean; reason?: string; }
export class MissionArtifactInput { artifactType: string = 'weekly_report'; expectedOutputRevision: number = 1; }
export class MissionArtifactConfirm extends MissionArtifactInput {
  requestId: string = ''; previewHash: string = ''; expectedContextVersion: number = 1;
}
export interface MissionArtifactPreview {
  missionId: string; outputId: string; outputRevision: number; content: string;
  contextVersion: number; previewHash: string; visibility: string; sourceManifest: MissionSource[];
  verification: MissionVerification;
}
export interface MissionVerification { status: string; claims: MissionClaim[]; }
export interface MissionArtifactPreviewReply { receipt: MissionArtifactPreview; }
export interface MissionArtifactReceipt { artifactId: string; outputRevision: number; }
export interface MissionArtifactReply { receipt: MissionArtifactReceipt; }
export class MissionConstraintsEdit {
  requestId: string = ''; expectedVersion: number = 1; expectedConstraintsVersion: number = 1;
  constraints: MissionConstraints = new MissionConstraints(); llmContextApproved: boolean = false;
}
export class MissionScopeEdit {
  requestId: string = ''; expectedVersion: number = 1; expectedScopeVersion: number = 1;
  scope: MissionScope = new MissionScope();
}
export class MissionPolicyEdit {
  requestId: string = ''; expectedVersion: number = 1; policy: MissionPolicy = new MissionPolicy();
}

export interface MissionWorkspaceItem {
  id: string; goal: string; status: string; version: number; attention: string | null;
  activity: string | null; activityAt: string | null; outputRevision: number | null;
}
export interface MissionWorkspaceSummary { enabled: boolean; totalActive: number; items: MissionWorkspaceItem[]; }
