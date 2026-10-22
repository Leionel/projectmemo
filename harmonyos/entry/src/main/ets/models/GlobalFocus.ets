export interface FocusEntry {
  id: string; projectId: string; projectTitle: string; title: string; detail: string;
  status: string; activity: string; activityAt: string; recordedAt: string; dueAt: string; projectDeadline?: string; recordFields?: FocusRecordField[];
}
export class GlobalFocusReply {
  // Additive Web presentation fields are optional for older clients.
  counts?: FocusCounts;
  nextDeadline?: FocusDeadline | null;
  schemaVersion: number = 1;
  missionEnabled: boolean = false;
  archived: boolean = false;
  hasMore: boolean = false;
  waiting: FocusEntry[] = [];
  running: FocusEntry[] = [];
  actions: FocusEntry[] = [];
  reminders: FocusEntry[] = [];
  records: FocusEntry[] = [];
}

export interface FocusCounts { waiting: number; running: number; actions: number; reminders: number; }
export interface FocusDeadline { projectId: string; projectTitle: string; at: string; }
export interface FocusRecordField { label: string; value: string; }
