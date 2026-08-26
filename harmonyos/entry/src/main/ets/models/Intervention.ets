import { ActionItem } from './Action';

export class AgentEvidence {
  rule: string = '';
  facts: string[] = [];
  cardIds: string[] = [];
  artifactTypes: string[] = [];
  evaluatedAt: string | undefined = undefined;
}

export class ProposedAction {
  kind: string = '';
  label: string = '';
  title: string = '';
  description: string | undefined = undefined;
  priority: number | undefined = undefined;
  artifactType: string | undefined = undefined;
  dueAt: string | undefined = undefined;
}

export class Intervention {
  id: string = '';
  projectId: string = '';
  triggerType: string = '';
  status: string = '';
  title: string = '';
  content: string = '';
  severity: number = 0;
  dedupeKey: string = '';
  isSimulated: boolean = false;
  snoozedUntil: string | undefined = undefined;
  dismissReason: string | undefined = undefined;
  handledAt: string | undefined = undefined;
  evidenceCardId: string | undefined = undefined;
  createdAt: string = '';
  updatedAt: string = '';
  evidence: AgentEvidence = new AgentEvidence();
  proposedActions: ProposedAction[] = [];
  actions: ActionItem[] = [];
}

export class InterventionsResponse {
  interventions: Intervention[] = [];
}

export class InterventionUpdateResponse {
  intervention: Intervention = new Intervention();
  action: ActionItem | undefined = undefined;
}

export class EvaluateResponse {
  interventions: Intervention[] = [];
  created: number = 0;
}

export class EvaluateProjectInput {
  scenario: string | undefined = undefined;
  clearSimulation: boolean | undefined = undefined;
}
