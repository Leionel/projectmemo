export class PublicResearchScope {
  academicMetadata: boolean = false;
  enabled: boolean = false; topic: string = ''; publicTerms: string[] = []; allowedCategories: string[] = ['PUBLIC_TOPIC', 'PUBLIC_SOURCE'];
  excludedTerms: string[] = []; allowedHosts: string[] = [];
}
export interface ConversationResearchInfo { available: boolean; revision: number; projectId: string | null; scope: PublicResearchScope; }
export class ResearchScopeInput { expectedRevision: number = 1; projectId: string = ''; scope: PublicResearchScope = new PublicResearchScope(); }
export interface WebSourceApplicability { edition: string | null; effectiveFrom: string | null; effectiveUntil: string | null; status: string; evidenceSourceIds: string[]; }
export interface BrowserRenderCoverage {
  complete: boolean; visibleCharacters: number; totalCharacters: number; truncated: boolean;
  scrolls: number; pages: number; requests: number; blockedRequests: number; bytes: number;
}
export interface BrowserSourceLocator { selector: string; headingPath: string[]; quote: string; start: number; end: number; textHash: string; }
export interface BrowserSourceMeta {
  renderer: string; version: number; status: string; requestedUrl: string; finalUrl: string; observedAt: string; renderMs: number;
  mode: string; readyState: string; coverage: BrowserRenderCoverage; locator: BrowserSourceLocator;
  screenshotHash: string | null; failureCode: string | null; failureMessage: string | null;
}
export interface ExternalSourceMeta {
  provenanceSourceIds?: string[];
  conversationId: string; turnId: string; scopeRevision: number; origin: string; provider: string; requestedUrl: string; resolvedUrl: string | null;
  publishedAt: string | null; fetchedAt: string; readLevel: string; retrievalMethod: string; truncated: boolean; totalCharacters: number; applicability: WebSourceApplicability;
  browser?: BrowserSourceMeta;
}
export interface CalendarSourceWindow { start: string; end: string; complete: boolean; pages: number; truncated: boolean; eventCount: number; malformedCount: number; }
export interface CalendarSourceMeta {
  provider: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string; calendarTimeZone: string; accessRole: string;
  eventId: string; recurringEventId: string | null; eventStatus: string; title: string; recurrence: string | null; isException: boolean;
  startAt: string | null; endAt: string | null; allDay: boolean; startDate: string | null; endDate: string | null; timeZone: string | null; transparency: string | null;
  eventUpdatedAt: string | null; eventRevision: string; connectionRevision: number; authGeneration: number; observedAt: string; window: CalendarSourceWindow;
  conversationId?: string; turnId?: string;
}
export interface ResearchConflict { claim: string; sourceIds: string[]; }
export interface ResearchFacet { id: string; question: string; kind: string; coverage: string; sourceIds: string[]; missing: string[]; conflicts: ResearchConflict[]; }
export interface ResearchCoverage { schemaVersion: number; questionHash: string; scopeRevision: number; asOf: string; facets: ResearchFacet[]; nextDecision: string; expectedDecisionChange: string; stopReason: string | null; }
export class ResearchSummaryInput { action: string = 'PREVIEW'; expectedConversationVersion: number = 1; previewHash?: string; }
export interface ResearchSummaryReply { previewHash: string; content: string; projectId: string; artifactId?: string; }
