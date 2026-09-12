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
  /** 最高分并列时的候选卡片：评分只生成候选，歧义时必须由用户选择，不自动取代 */
  ambiguousCandidateIds?: string[];
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
