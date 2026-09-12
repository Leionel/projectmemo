export class ActionSourceIntervention {
  id: string = '';
  title: string = '';
  triggerType: string = '';
}

export class ActionCardRef {
  id: string = '';
  title: string = '';
}

export class ActionItem {
  id: string = '';
  projectId: string = '';
  title: string = '';
  status: string = '';
  description: string | undefined = undefined;
  priority: number = 3;
  dueAt: string | undefined = undefined;
  resultText: string | undefined = undefined;
  isSimulated: boolean = false;
  sourceInterventionId: string | undefined = undefined;
  sourceCardId: string | undefined = undefined;
  resultCardId: string | undefined = undefined;
  completedAt: string | undefined = undefined;
  createdAt: string = '';
  updatedAt: string = '';
  sourceIntervention: ActionSourceIntervention | undefined = undefined;
  sourceCard: ActionCardRef | undefined = undefined;
  resultCard: ActionCardRef | undefined = undefined;
}

export class ActionsResponse {
  actions: ActionItem[] = [];
}

export class ActionUpdateResponse {
  action: ActionItem = new ActionItem();
}

// ---- F1 行动可行性 ----

export class FeasibilityDependency {
  requirementId: string = '';
  targetKind: string = '';
  targetId: string = '';
  targetTitle: string | null = null;
  hard: boolean = true;
  state: string = 'UNKNOWN';
  note: string = '';
}

export class FeasibilityAssessment {
  actionId: string = '';
  feasibility: string = 'UNKNOWN';
  dependencies: FeasibilityDependency[] = [];
  overdue: boolean = false;
  deadline: string | null = null;
  estimateMinutes: number | null = null;
  estimateNote: string = '';
  assessedAt: string = '';
  summary: string = '';
}

export class FeasibilityRequirementBody {
  targetKind: string = 'action';
  targetId: string = '';
  hard: boolean = true;
}

export class FeasibilityInput {
  actionId: string = '';
  addRequirements: FeasibilityRequirementBody[] | undefined = undefined;
  removeRequirementIds: string[] | undefined = undefined;
  estimatedMinutes: number | undefined = undefined;
}

export class ActionCreateInput {
  title: string = '';
  description: string | undefined = undefined;
  priority: number = 3;
}
