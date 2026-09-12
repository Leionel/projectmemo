// E5：会议状态变化（与 lib/types/meetingState.ts 契约一致）

export class MeetingTypedChange {
  changeId: string = '';
  kind: string = 'ACTION_CREATE';
  status: string = 'PROPOSED';
  title: string = '';
  detail: string = '';
  evidenceSpan: string = '';
  supersededCardId: string | null = null;
  supersededCardTitle: string | null = null;
  candidateCardIds: string[] = [];
  actionTitle: string | null = null;
  deadlineRaw: string | null = null;
  deadlineISO: string | null = null;
  clarification: string | null = null;
}

export class MeetingImpactPreview {
  proposalId: string = '';
  projectId: string = '';
  baseSnapshotId: string = '';
  proposalVersion: number = 1;
  sourceTextHash: string = '';
  meetingDate: string | null = null;
  extractor: string = 'rules';
  typedChanges: MeetingTypedChange[] = [];
  summary: string = '';
}

export class MeetingPreviewInput {
  text: string = '';
  meetingDate: string | undefined = undefined;
  baseSnapshotId: string | undefined = undefined;
}

export class MeetingAppliedChange {
  changeId: string = '';
  kind: string = '';
  newCardId: string | null = null;
  newActionId: string | null = null;
  supersededCardId: string | null = null;
  deadlineISO: string | null = null;
}

export class MeetingConfirmResult {
  proposalId: string = '';
  applied: MeetingAppliedChange[] = [];
  afterSnapshotId: string | null = null;
  alreadyConfirmed: boolean = false;
}

export class MeetingConfirmBody {
  proposalId: string = '';
  sourceTextHash: string = '';
  proposalVersion: number = 1;
  selectedChangeIds: string[] = [];
}
