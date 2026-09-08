export class ChangeImpactItem {
  id: string = '';
  type: string = 'ACTION';
  targetId: string = '';
  title: string = '';
  impactReason: string = '';
  proposedAction: string = 'CANCEL';
  confirmed: boolean = true;
}

export class ChangeImpactProposal {
  proposalId: string = '';
  projectId: string = '';
  newFactText: string = '';
  supersededCardId: string | null = null;
  supersededCardTitle: string | null = null;
  impactedActions: ChangeImpactItem[] = [];
  impactedArtifacts: ChangeImpactItem[] = [];
  summary: string = '';
}

export class NewActionPayload {
  title: string = '';
  description: string = '';
  priority: number = 3;
}

export class ConfirmChangeInput {
  proposalId: string = '';
  newFactText: string = '';
  supersededCardId: string | null = null;
  cancelledActionIds: string[] = [];
  newActions: NewActionPayload[] = [];
}

export class ConfirmChangeResult {
  success: boolean = false;
  newCardId: string = '';
  supersededCardId: string | null = null;
  cancelledCount: number = 0;
  createdActionsCount: number = 0;
}
