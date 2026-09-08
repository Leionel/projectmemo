export type ChangeImpactTargetType = 'ACTION' | 'ARTIFACT' | 'CARD';
export type ProposedImpactAction = 'CANCEL' | 'UPDATE' | 'REGENERATE';

export interface ChangeImpactItem {
  id: string;
  type: ChangeImpactTargetType;
  targetId: string;
  title: string;
  impactReason: string;
  proposedAction: ProposedImpactAction;
  confirmed: boolean;
}

export interface ChangeImpactProposal {
  proposalId: string;
  projectId: string;
  newFactText: string;
  supersededCardId: string | null;
  supersededCardTitle: string | null;
  impactedActions: ChangeImpactItem[];
  impactedArtifacts: ChangeImpactItem[];
  summary: string;
}

export interface ConfirmChangeInput {
  proposalId: string;
  newFactText: string;
  supersededCardId?: string | null;
  cancelledActionIds?: string[];
  newActions?: Array<{
    title: string;
    description: string;
    priority: number;
  }>;
}
