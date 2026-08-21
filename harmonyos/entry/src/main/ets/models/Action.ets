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
