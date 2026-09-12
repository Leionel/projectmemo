import { ActionItem } from './Action';

export class AgentEvidence {
  rule: string = '';
  facts: string[] = [];
  cardIds: string[] = [];
  artifactTypes: string[] = [];
  evaluatedAt: string | undefined = undefined;
  // B1：预算管道生成的“为什么是现在”解释（确定性模板）
  whyNow: string | undefined = undefined;
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

// ---- B1 提醒策略 ----
export class InterventionPolicyData {
  scope: string = 'GLOBAL';
  timezone: string = 'Asia/Shanghai';
  dailyBudget: number = 3;
  quietStartMinute: number = 1380;
  quietEndMinute: number = 480;
  version: number = 1;
  reducedTopics: ReducedTopic[] = [];
}

export class ReducedTopic {
  triggerType: string = '';
  since: string = '';
}

export class InterventionDecisionItem {
  id: string = '';
  candidateKey: string = '';
  decision: string = '';
  reasonCode: string = '';
  whyNow: string = '';
  channel: string = '';
  policyVersion: number = 0;
  createdAt: string = '';
}

export class PolicySuggestion {
  triggerType: string = '';
  ignoredCount: number = 0;
  text: string = '';
}

export class PolicyResponse {
  policy: InterventionPolicyData = new InterventionPolicyData();
  recentDecisions: InterventionDecisionItem[] = [];
  suggestions: PolicySuggestion[] = [];
}

export class PolicyUpdateBody {
  dailyBudget: number | undefined = undefined;
  quietStartMinute: number | undefined = undefined;
  quietEndMinute: number | undefined = undefined;
  timezone: string | undefined = undefined;
}

export class PolicySuggestionBody {
  action: string = 'CONFIRM';
  triggerType: string = '';
}
