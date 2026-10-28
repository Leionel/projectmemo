export class PublicResearchScope {
  enabled: boolean = false; topic: string = ''; publicTerms: string[] = []; allowedCategories: string[] = ['PUBLIC_TOPIC', 'PUBLIC_SOURCE'];
  excludedTerms: string[] = []; allowedHosts: string[] = [];
}
export interface ConversationResearchInfo { available: boolean; revision: number; projectId: string | null; scope: PublicResearchScope; }
export class ResearchScopeInput { expectedRevision: number = 1; projectId: string = ''; scope: PublicResearchScope = new PublicResearchScope(); }
export interface WebSourceApplicability { edition: string | null; effectiveFrom: string | null; effectiveUntil: string | null; status: string; evidenceSourceIds: string[]; }
export interface ExternalSourceMeta {
  conversationId: string; turnId: string; scopeRevision: number; origin: string; provider: string; requestedUrl: string; resolvedUrl: string | null;
  publishedAt: string | null; fetchedAt: string; readLevel: string; retrievalMethod: string; truncated: boolean; totalCharacters: number; applicability: WebSourceApplicability;
}
export interface ResearchConflict { claim: string; sourceIds: string[]; }
export interface ResearchFacet { id: string; question: string; kind: string; coverage: string; sourceIds: string[]; missing: string[]; conflicts: ResearchConflict[]; }
export interface ResearchCoverage { schemaVersion: number; questionHash: string; scopeRevision: number; asOf: string; facets: ResearchFacet[]; nextDecision: string; expectedDecisionChange: string; stopReason: string | null; }
export class ResearchSummaryInput { action: string = 'PREVIEW'; expectedConversationVersion: number = 1; previewHash?: string; }
export interface ResearchSummaryReply { previewHash: string; content: string; projectId: string; artifactId?: string; }
