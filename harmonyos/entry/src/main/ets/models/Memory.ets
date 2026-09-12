export class CaptureSummary {
  rawText: string = '';
  sourceType: string | undefined = undefined;
}

export class CardSummary {
  id: string = '';
  title: string = '';
}

export class CardLink {
  reason: string = '';
  score: number = 0;
  relationType: string = '';
  relatedCard: CardSummary = new CardSummary();
}

export class IncomingCardLink {
  reason: string = '';
  score: number = 0;
  relationType: string = '';
  currentCard: CardSummary = new CardSummary();
}

export class ArtifactSummary {
  id: string = '';
  artifactType: string = '';
  createdAt: string = '';
}

export class AttachmentSummary {
  id: string = '';
  fileName: string = '';
  type: string = '';
  extractionStatus: string = '';
}

export class KnowledgeCard {
  id: string = '';
  // Global Memory 聚合时注入，项目内 Memory 不依赖这些字段。
  projectId: string = '';
  projectTitle: string = '';
  type: string = '';
  title: string = '';
  summary: string = '';
  createdAt: string = '';
  capture: CaptureSummary = new CaptureSummary();
  attachment: AttachmentSummary | undefined = undefined;
  outgoingLinks: CardLink[] = [];
  incomingLinks: IncomingCardLink[] = [];
}

export class ProjectDetailCount {
  captures: number = 0;
  cards: number = 0;
  artifacts: number = 0;
}

export class ProjectDetail {
  id: string = '';
  title: string = '';
  description: string = '';
  goal: string = '';
  scenario: string = '';
  deadline: string | undefined = undefined;
  createdAt: string = '';
  updatedAt: string = '';
  cards: KnowledgeCard[] = [];
  artifacts: ArtifactSummary[] = [];
  _count: ProjectDetailCount = new ProjectDetailCount();
}

export class ProjectDetailResponse {
  project: ProjectDetail = new ProjectDetail();
}

export class CaptureResponse {
  card: KnowledgeCard = new KnowledgeCard();
}

export class CaptureInput {
  rawText: string = '';
  sourceType: string | undefined = undefined;
}

export class CardSearchResultItem {
  cardId: string = '';
  title: string = '';
  summary: string = '';
  type: string = '';
  score: number = 0;
  reason: string = '';
  source: string = '';
  retrievalMode: string = '';
}

export class CardSearchResponse {
  query: string = '';
  total: number = 0;
  results: CardSearchResultItem[] = [];
}

export class TemporalCardSummary {
  id: string = '';
  title: string = '';
  summary: string = '';
  createdAt: string = '';
}

export class TemporalRelation {
  id: string = '';
  relationType: string = 'RELATED';
  reason: string = '';
  confidence: number | null = null;
  confirmed: boolean = false;
  confirmedAt: string | null = null;
  revokedAt: string | null = null;
  validFrom: string | null = null;
  validTo: string | null = null;
  createdAt: string = '';
  currentCard: TemporalCardSummary = new TemporalCardSummary();
  relatedCard: TemporalCardSummary = new TemporalCardSummary();
}

export class TemporalDecisionItem {
  card: TemporalCardSummary = new TemporalCardSummary();
  current: boolean = true;
  status: string = 'INSUFFICIENT';
  statusLabel: string = '证据不足';
  supportState: string = 'INSUFFICIENT';
  supersededBy: TemporalCardSummary | null = null;
  temporalReason: string | null = null;
  relations: TemporalRelation[] = [];
  confirmedSourceAt: string | null = null;
}

export class TemporalTimelineResponse {
  projectId: string = '';
  asOf: string = '';
  enabled: boolean = true;
  items: TemporalDecisionItem[] = [];
}

export class TemporalRelationResponse {
  relation: TemporalRelation = new TemporalRelation();
}

// ---- 记忆生命周期（M1：人工确认来源 / 归档 / 恢复） ----

export class LifecycleActionBody {
  action: string = 'CONFIRM';
  reason: string | undefined = undefined;
}

export class LifecycleEvent {
  id: string = '';
  projectId: string = '';
  cardId: string = '';
  eventType: string = '';
  reason: string | null = null;
  actor: string = 'user';
  relationId: string | null = null;
  createdAt: string = '';
}

export class LifecycleEventsResponse {
  events: LifecycleEvent[] = [];
}

export class LifecycleArchiveResponse {
  archivedAt: string | null = null;
}

export class LifecycleConfirmResponse {
  event: LifecycleEvent = new LifecycleEvent();
  archivedAt: string | null = null;
}
