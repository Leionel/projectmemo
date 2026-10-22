/** Read projection shared by Web and ArkTS. No commands or synthetic progress. */
export type FocusEntry = {
  id: string; projectId: string; projectTitle: string; title: string; detail: string;
  status: string; activity: string; activityAt: string; recordedAt: string; dueAt: string; projectDeadline: string; recordFields: Array<{label: string; value: string}>;
};
export type GlobalFocus = {
  counts: {waiting: number; running: number; actions: number; reminders: number};
  nextDeadline: {projectId: string; projectTitle: string; at: string} | null;
  schemaVersion: 1; missionEnabled: boolean; archived: boolean; hasMore: boolean;
  waiting: FocusEntry[]; running: FocusEntry[]; actions: FocusEntry[]; reminders: FocusEntry[]; records: FocusEntry[];
};
