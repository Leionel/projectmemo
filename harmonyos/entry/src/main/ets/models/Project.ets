export class DeadlineState {
  kind: string = 'none';
  label: string = '';
  daysRemaining: number | undefined = undefined;
  rank: number = 0;
}

export class ReadinessItem {
  key: string = '';
  label: string = '';
  complete: boolean = false;
  href: string = '';
  actionLabel: string = '';
}

export class CompetitionReadiness {
  completed: number = 0;
  total: number = 0;
  percentage: number = 0;
  blockingRiskCount: number = 0;
  items: ReadinessItem[] = [];
}

export class NextAction {
  label: string = '';
  detail: string = '';
  href: string = '';
  tone: string = 'steady';
}

export class ProjectDashboard {
  activeReminderCount: number = 0;
  highestReminderSeverity: number = 0;
  activeActionCount: number = 0;
  deadline: DeadlineState = new DeadlineState();
  readiness: CompetitionReadiness = new CompetitionReadiness();
  nextAction: NextAction = new NextAction();
  attentionScore: number = 0;
}

export class ProjectCount {
  cards: number = 0;
  artifacts: number = 0;
}

export class Project {
  id: string = '';
  title: string = '';
  description: string = '';
  goal: string = '';
  scenario: string = 'COMPETITION';
  deadline: string | undefined = undefined;
  createdAt: string = '';
  updatedAt: string = '';
  _count: ProjectCount = new ProjectCount();
  dashboard: ProjectDashboard = new ProjectDashboard();
}

export class ProjectsResponse {
  projects: Project[] = [];
}

export class ApiError extends Error {
  code: string = '';
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
