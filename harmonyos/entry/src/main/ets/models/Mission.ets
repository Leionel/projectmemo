import { WorkState } from './WorkState';
import { DocumentSourceMeta } from './Document';
import { DeploymentSourceMeta } from './Deployment';
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
  academicMetadata: boolean = false;
  enabled: boolean = false;
  topic: string = '';
  publicTerms: string[] = [];
  allowedCategories: string[] = ['PUBLIC_TOPIC'];
  excludedTerms: string[] = [];
  allowedHosts: string[] = [];
}
export class MissionDailyBurst { maxModels?: number; maxTools?: number; }
export class MissionPolicy { mode: string = 'MANUAL'; schemaVersion?: number; expiresAt?: string; checkEveryMinutes?: number; maxModels?: number; maxTools?: number; maxMetadataRequests?: number; allowedTools?: string[]; connectionIds?: string[]; trackBranchHead?: boolean; dailyBurst?: MissionDailyBurst; timezone?: string; quietStart?: number; quietEnd?: number; attention?: string; }
export interface MissionSourceCountCriterion { type: string; minimum: number; }
export type MissionSuccessCriterion = string | MissionSourceCountCriterion;
export class MissionCreate {
  successCriteria: string[] = ['DRAFT_EXISTS'];
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
export interface MissionBackgroundState { worker: string; inspecting: boolean; lastHeartbeatAt: string | null; }
export interface MissionCloudState { available: boolean; reason: string; }
export interface MissionCapabilities { enabled: boolean; widgetEnabled: boolean; background?: MissionBackgroundState; cloud?: MissionCloudState; }
export interface MissionQuestionPayload { question: string; missing: string; gapId?: string; }
export interface MissionQuestion { id: string; seq: number; payloadJson: MissionQuestionPayload; }
export interface MissionSource {
  deployment?: DeploymentSourceMeta;
  document?: DocumentSourceMeta;
  id: string; kind: string; entityType: string; hash: string; revision: string;
  text?: string; url?: string; excerpts?: string[];
  knowledgeClass?: string;
}
export interface MissionResult { data?: Object; sources?: MissionSource[]; }
export interface MissionMetricReceiptData { jobName:string; containerId:string; receiptHash:string; finishedAt:string; image:string; scriptHash:string; exitCode:number; result:MissionMetricResult; }
export interface MissionMetricResult { state:string; delta:number|null; }
export interface MissionMetricFailure { exitCode?:number; }
export interface MissionMetricExecution { phase:string; jobName:string; current:boolean; receipt:MissionMetricReceiptData|null; failure:MissionMetricFailure|null; }
export interface MissionStep { execution?:MissionMetricExecution; id: string; ordinal: number; toolName: string; status: string; result: MissionResult | null; }
export interface MetricJobRecord { runId: string; metric: string; value: number; unit: string|null; period:string|null; direction:string|null; dataset:string|null; split:string|null; seed:string|null; evaluationCode:string|null; environment:string|null; phase:string|null; batchSize:string|null; }
export interface MetricVerificationJob { image: string; scriptHash: string; left: MetricJobRecord; right: MetricJobRecord; }
export interface MissionActionArgs { job?: MetricVerificationJob; title: string; description?: string; priority?: number; dueAt?: string | null; }
export interface MissionCalendarAttendee { type: string; openId?: string; email?: string; }
export interface MissionCalendarPayload { title?: string; description?: string; startAt?: string; endAt?: string; timeZone?: string; allDay?: boolean; recurrence?: string | null;
  attendees?: MissionCalendarAttendee[]; attachments?: string[]; }
export interface MissionCalendarTarget { accountName?: string; accountEmail?: string; calendarSummary?: string; calendarId?: string; authGeneration?: number; connectionRevision?: number; }
export interface MissionEffectQuery { marker?: string; timeMin?: string; timeMax?: string; }
export interface MissionCalendarBatchItem { index: number; marker: string; payload: MissionCalendarPayload; }
export interface MissionProposal { tool: string; args: MissionActionArgs; payload?: MissionCalendarPayload; target?: MissionCalendarTarget; marker?: string; effectQuery?: MissionEffectQuery;
  compensationPolicy?:string; operationId?: string; events?: MissionCalendarBatchItem[]; }
export interface MissionApproval { id: string; proposalHash: string; proposal: MissionProposal; expiresAt: string; }
export interface MissionBlock { blockId: string; text: string; kind: string; sourceIds: string[]; }
export interface MissionContent { blocks: MissionBlock[]; }
export interface MissionClaim { claimId?: string; blockId?: string; text?: string; status: string; mode?: string; }
export interface MissionOutput { id: string; revision: number; contentJson: MissionContent; verificationStatus: string; claimChecksJson: MissionClaim[]; sourceRefsJson?: MissionSource[]; }
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
export class MissionAttentionReceipt { requestId: string = ''; expectedVersion: number = 1; decisionId: string = ''; status?: string = 'SEEN'; }
export interface MissionAttention { level: string; reason: string; decisionId?: string; delivery?: MissionAttentionDelivery; }
export interface MissionAttentionDelivery { status: string; seenAt?: string | null; platformAcceptedAt?: string | null; channel?: string; }
export interface MissionDelegation { attention?: MissionAttention | null; }
export class Mission {workingObjective?:string|null;nextBoundary?:string|null; workState?:WorkState;
  experimentObserverEnabled?: boolean; academicResearchEnabled?: boolean; sandboxVerificationEnabled?: boolean;
  documentDeepReadEnabled?: boolean;
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
  budget:MissionBudgetTotals=new MissionBudgetTotals(); used:MissionBudgetUsage=new MissionBudgetUsage();
  steps: MissionStep[] = []; approvals: MissionApproval[] = []; outputs: MissionOutput[] = [];
}
export interface MissionEvent { id: string; seq: number; type: string; createdAt: string; payloadJson: Object; }
export interface MissionEvents { events: MissionEvent[]; nextAfterSeq: number; }
export class MissionBudgetTotals { metadataRequests?:number; browserRequests:number=40;browserBytes:number=4000000;calendarRequests:number=8;externalWrites:number=2; models:number=12; tools:number=16; activeMs:number=180000; reservedOutputTokens:number=12000; }
export class MissionBudgetUsage { metadataRequests:number=0; browserRequests:number=0;browserBytes:number=0;calendarRequests:number=0;externalWrites:number=0; models:number=0; tools:number=0; activeMs:number=0; reservedOutputTokens:number=0; }
export class MissionBudgetReview { requestId:string=""; expectedVersion:number=1; totals:MissionBudgetTotals=new MissionBudgetTotals(); }
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

export interface MissionWorkspaceItem { workState?:WorkState;
  id: string; goal: string; status: string; version: number; attention: string | null;
  activity: string | null; activityAt: string | null; outputRevision: number | null;
}
export interface MissionWorkspaceSummary { enabled: boolean; totalActive: number; items: MissionWorkspaceItem[]; }

export interface MissionBudgetUsageDetail {
  models?: number;
  tools?: number;
  maxModels?: number;
  maxTools?: number;
  metadataRequests?: number;
  maxMetadataRequests?: number;
  unknownCalls?: number;
}

export interface MissionResponsibilityBudget {
  limits: MissionBudgetUsageDetail;
  cumulativeUsed: MissionBudgetUsageDetail;
  additionalUsed: Object;
  policy: string;
  monetaryCost: string | null;
}

export interface MissionResponsibilityActivity {
  id: string;
  sequence: number;
  kind: string;
  at: string;
}

export interface MissionResponsibilityView {
  schemaVersion: number;
  missionId: string;
  projectId: string;
  controlVersion: string;
  goal: string;
  successCriteria: MissionSuccessCriterion[];
  successCriteriaLabels?: string[];
  workingObjective?: string | null;
  constraints: MissionConstraints;
  researchScope: MissionScope;
  continuationPolicy: MissionPolicy;
  deadline: string | null;
  permissionExpiresAt: string | null;
  permissionState: string;
  budget: MissionResponsibilityBudget;
  workState: WorkState;
  pendingOriginalRefs?: Object;
  nextCheckAt: string | null;
  workerPresence: string;
  workerPresenceDetail?: MissionWorkerPresenceDetail | null;
  activity: MissionResponsibilityActivity[];
  authority: string;
}
export interface MissionWorkerPresenceDetail {
  identityMatches?: boolean;
  mismatchReason?: string | null;
  failedPhase?: string | null;
  isActivelyInspecting?: boolean;
  isProcessAlive?: boolean;
}

export interface MissionResponsibilityReply {
  responsibility: MissionResponsibilityView;
}

export class MissionResponsibilityRevisionInput {
  requestId: string = '';
  expectedControlVersion: string = '';
  goal?: string;
  successCriteria?: MissionSuccessCriterion[];
  workingObjective?: string;
  constraints?: MissionConstraints;
  researchScope?: MissionScope;
  continuationPolicy?: MissionPolicy;
  llmContextApproved?: boolean;
}
