import { ExperienceListReply } from './Experience';

export class ClaimOrigin {
  kind: string = 'MESSAGE'; id: string = ''; contentHash: string = '';
  offsetEncoding: string = 'UTF16_CODE_UNITS'; normalization: string = 'RAW_V1';
  start: number = 0; end: number = 0; quote: string = '';
}
export interface ClaimText {
  kind: string; id: string; contentHash: string; text: string;
  offsetEncoding: string; normalization: string;
}
export interface ClaimHead {
  claimId: string; revision: number; origin: ClaimOrigin; eventKind: string;
  userQuote: string | null; validUntil: string | null; active: boolean;
}
export class ClaimControls {
  ownerUserId: string = '';
  seq: number = 0; heads: ClaimHead[] = []; reusePolicyHash: string = ''; nextBoundary: string | null = null;
}
export class ClaimScope { projectId: string = ''; }
export class ClaimCommand {
  requestId: string = ''; scope: ClaimScope = new ClaimScope(); expectedSeq: number = 0;
  expectedOwnerUserId?: string;
  expectedRevision?: number; origin: ClaimOrigin = new ClaimOrigin(); operation: string = 'CORRECT'; userQuote?: string;
}
export interface ClaimReceipt { claimId: string; eventId: string; revision: number; seq: number; }
export interface MemorySynthesisView { summary: string; conditions: string[]; retainedReasons: string[]; openQuestions: string[]; }
export interface MemoryDigestView {
  id: string; effectiveState: string; reason: string; synthesis: MemorySynthesisView | null;
  sourceMissionId: string | null; sourceConversationId: string | null; origin: ClaimOrigin | null; createdAt: string;
}
export interface MemoryCoverage { loaded: number; hasMore: boolean; }
export class DigestListView { items: MemoryDigestView[] = []; coverage: MemoryCoverage = { loaded: 0, hasMore: false }; usagePolicy: string = ''; }
export interface HypothesisEvidence { sourceId: string; projectId: string; role: string; quote: string; qualified: boolean; }
export interface HypothesisView {
 id: string; revision: number; statement: string; conditions: string[]; effectiveStatus: string;
 explanation: string | null; nextInformationNeed: string | null; qualificationReason: string | null;
 evidence: HypothesisEvidence[]; sourceMissionId: string | null; sourceConversationId: string | null;
 history?: HypothesisRevision[];
}
export interface HypothesisRevision { revision: number; at: string; statement?: string; state?: string; }
export interface HypothesisCoverage { hasMore: boolean; }
export class HypothesisListView { items: HypothesisView[] = []; coverage: HypothesisCoverage = { hasMore: false }; }
export interface AgentMemoryReply { memory: DigestListView; hypotheses: HypothesisListView; experience: ExperienceListReply | null; }
