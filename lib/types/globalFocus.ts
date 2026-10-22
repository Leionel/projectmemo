/** Read projection shared by Web and ArkTS. No commands or synthetic progress. */
export type FocusEntry = {
  id: string; projectId: string; projectTitle: string; title: string; detail: string;
  status: string; activity: string; activityAt: string; recordedAt: string;
};
export type GlobalFocus = {
  schemaVersion: 1; missionEnabled: boolean; archived: boolean; hasMore: boolean;
  waiting: FocusEntry[]; running: FocusEntry[]; actions: FocusEntry[]; reminders: FocusEntry[]; records: FocusEntry[];
};
