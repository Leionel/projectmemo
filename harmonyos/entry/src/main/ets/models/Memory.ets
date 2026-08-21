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
  relatedCard: CardSummary = new CardSummary();
}

export class IncomingCardLink {
  reason: string = '';
  score: number = 0;
  currentCard: CardSummary = new CardSummary();
}

export class ArtifactSummary {
  id: string = '';
  artifactType: string = '';
  createdAt: string = '';
}

export class KnowledgeCard {
  id: string = '';
  type: string = '';
  title: string = '';
  summary: string = '';
  createdAt: string = '';
  capture: CaptureSummary = new CaptureSummary();
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
