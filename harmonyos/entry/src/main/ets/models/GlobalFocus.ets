export interface FocusEntry {
  id: string; projectId: string; projectTitle: string; title: string; detail: string;
  status: string; activity: string; activityAt: string; recordedAt: string; dueAt: string;
}
export class GlobalFocusReply {
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
