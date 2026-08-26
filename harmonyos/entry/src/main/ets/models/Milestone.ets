export class DeliverableEvidence {
  id: string = '';
  deliverableId: string = '';
  cardId: string = '';
  attachmentId: string = '';
  evidenceType: string = '';
  confirmed: boolean = false;
  createdAt: string = '';
}

export class Deliverable {
  id: string = '';
  milestoneId: string = '';
  title: string = '';
  expectedEvidence: string = '[]';
  status: string = 'PENDING';
  createdAt: string = '';
  updatedAt: string = '';
  evidences: DeliverableEvidence[] = [];
}

export class Milestone {
  id: string = '';
  projectId: string = '';
  title: string = '';
  targetDate: string = '';
  status: string = 'IN_PROGRESS';
  createdAt: string = '';
  updatedAt: string = '';
  deliverables: Deliverable[] = [];
}
