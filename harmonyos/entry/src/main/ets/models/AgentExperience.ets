// R4 serializable DTO. The backend validates authorization and binds all actions.
export interface ExperienceEntityRef { kind: string; id: string; projectId: string; revision: string; }
export interface EvidenceLink {
  source: ExperienceEntityRef; excerptHash: string; quote: string; observedAt: string;
  readScope: string; applicability: string; verification: string; reason: string;
  claim: string; relation: string;
}
export interface GoalCriterion { id: string; requirement: string; state: string; explanation: string; evidence: EvidenceLink[]; }
export interface GoalGap {
  schemaVersion: number; id: string; projectId: string; goalRef: ExperienceEntityRef; goalQuote: string;
  criteria: GoalCriterion[]; blockers: string[]; keyUnknowns: string[]; nextInformationNeed: string | null;
}
export interface InvestigationToolCall {
  tool: string; projectId: string; afterId?: string; query?: string; sourceId?: string; actionId?: string; revision?: string;
}
export interface InvestigationDecision {
  decision: string; informationNeed?: string; expectedObservation?: string; call?: InvestigationToolCall;
  reason?: string; question?: string; mission?: ExperienceEntityRef; explanation?: string;
}
export interface InvestigationCoverage { complete: boolean; description: string; }
export interface InvestigationUsage { inputTokens: number | null; outputTokens: number | null; }
export interface InvestigationStep {
  schemaVersion: number; id: string; turnId: string; seq: number; decision: InvestigationDecision;
  inputHash: string; readSetHash: string; status: string; startedAt: string; finishedAt: string | null;
  observationHash: string | null; sources: ExperienceEntityRef[]; coverage: InvestigationCoverage;
  reservationId: string | null; provider: string | null; usage: InvestigationUsage; failureReason: string | null;
}
export interface ExperienceInlineText { kind: string; text: string; }
export interface RichTextNode {
  type: string; spans?: ExperienceInlineText[]; level?: number; ordered?: boolean; items?: ExperienceInlineText[][];
  language?: string; text?: string; headers?: string[]; rows?: string[][];
}
export interface PlanComposition {
  blockKey: string; emphasis: string; semanticType: string; dataRefs: ExperienceEntityRef[]; text?: string; content?: RichTextNode[];
}
export interface PresentationPlan { schemaVersion: number; intent: string; composition: PlanComposition[]; primaryIntent: string; }
export interface FrozenExperienceProposal { executionId: string | null; candidateId: string | null; proposalHash: string; expiresAt: string; }
export interface AllowedAction {
  bindingId: string; conversationId: string; actionKind: string; label: string; target: ExperienceEntityRef;
  expectedConversationVersion: number;
  enabled: boolean; disabledReason: string | null; frozen: FrozenExperienceProposal | null;
}
export interface ExperienceBranch { observation: string; consequence: string; }
export interface ExperienceCandidate {
  id: string; title: string; tradeoff: string; feasibility: string; expectedObservation: string | null;
  branches: ExperienceBranch[]; stopCondition: string;
}
export interface ExperienceChoice { id: string; label: string; }
export interface ExperienceTimelineEvent { ref: ExperienceEntityRef; occurredAt: string; summary: string; }
// ArkTS uses a tagged interface; Zod's discriminated union is the wire authority.
export interface HydratedBlock {
  blockKey: string; emphasis: string; semanticType: string; fallbackText: string;
  refs: ExperienceEntityRef[]; actionBindingIds: string[];
  content?: RichTextNode[]; state?: string; evidence?: EvidenceLink[]; goalGap?: GoalGap;
  proposalHash?: string; candidates?: ExperienceCandidate[]; investigationId?: string; steps?: InvestigationStep[];
  disposition?: string; goalQuote?: string; changeKind?: string; relevance?: string; unknowns?: string[];
  draftKey?: string; question?: string; inputKind?: string; required?: boolean; choices?: ExperienceChoice[];
  executionId?: string; expiresAt?: string; verification?: string; events?: ExperienceTimelineEvent[];
}
export interface AgentPresentation { schemaVersion: number; blocks: HydratedBlock[]; allowedActions: AllowedAction[]; }
