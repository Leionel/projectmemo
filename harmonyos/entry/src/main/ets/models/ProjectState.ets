// ---- R2/S1 项目状态（与 lib/types/projectState.ts 契约保持一致） ----

export class StateEvidenceRef {
  entityKind: string = 'card';
  entityId: string = '';
  field: string = '';
  observedAt: string = '';
  contentHash: string = '';
}

export class StateRisk {
  stableKey: string = '';
  text: string = '';
  truth: string = 'UNKNOWN';
  severity: string = 'LOW';
  ruleId: string = '';
}

export class StateUnknown {
  predicate: string = '';
  text: string = '';
  missingInputs: string[] = [];
  suggestedInputAction: string = '';
}

export class StatePayload {
  snapshotId: string = '';
  projectId: string = '';
  schemaVersion: number = 1;
  evaluatedAt: string = '';
  goal: string | null = null;
  deadline: string | null = null;
  stage: string | null = null;
  health: string = 'UNKNOWN';
  risks: StateRisk[] = [];
  unknowns: StateUnknown[] = [];
}

export class StateSnapshot {
  id: string = '';
  projectId: string = '';
  schemaVersion: number = 1;
  contentHash: string = '';
  evaluatedAt: string = '';
  previousSnapshotId: string | null = null;
  payload: StatePayload = new StatePayload();
}

export class StateDiffItem {
  changeKey: string = '';
  kind: string = 'CHANGED';
  summary: string = '';
  before: string | null = null;
  after: string | null = null;
  evidenceRefs: StateEvidenceRef[] = [];
}

export class StateDiff {
  fromSnapshotId: string = '';
  toSnapshotId: string = '';
  algorithmVersion: string = '1';
  materialChange: boolean = false;
  summary: string = '';
  items: StateDiffItem[] = [];
}

export class StateSnapshotResponse {
  status: string = 'EMPTY';
  snapshot: StateSnapshot = new StateSnapshot();
}

export class StateRefreshResponse {
  status: string = 'OK';
  snapshot: StateSnapshot = new StateSnapshot();
  changed: boolean = false;
  reused: boolean = false;
}

export class StateDiffResponse {
  status: string = 'OK';
  diff: StateDiff = new StateDiff();
}

export class StateCheckInBody {
  displayedSnapshotId: string = '';
  consumerKey: string = '';
}

export class StateCheckInResponse {
  status: string = 'OK';
  lastSeenSnapshotId: string = '';
}

// ---- C1 变化简报（服务端确定性模板） ----

export class BriefEvidence {
  entityKind: string = 'card';
  entityId: string = '';
}

export class BriefSentence {
  changeKey: string = '';
  kind: string = 'CHANGED';
  text: string = '';
  impact: string = '';
  suggestion: string = '';
  evidenceCount: number = 0;
  evidence: BriefEvidence[] = [];
}

export class ChangeBrief {
  fromSnapshotId: string = '';
  toSnapshotId: string = '';
  templateVersion: string = '1';
  materialChange: boolean = false;
  headline: string = '';
  sentences: BriefSentence[] = [];
  generatedAt: string = '';
}

export class ChangeBriefResponse {
  status: string = 'OK';
  brief: ChangeBrief = new ChangeBrief();
}
