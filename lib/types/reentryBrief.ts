export type ReentryItemKind = "OUTPUT_UPDATED" | "NEEDS_DECISION" | "SOURCE_CHANGED";
export type ReentryItem = {
  id: string; kind: ReentryItemKind; title: string; why: string;
  outputId?: string; revision?: number; sourceKeys: string[];
  occurredAt: string; recordedAt: string; decisionAt: string | null;
  read: boolean; handled: boolean; approved: boolean;
};
export type ReentryBrief = {
  schemaVersion: 1; missionId: string; generatedAt: string;
  readState: "UNREAD" | "SEEN";
  cursor: { seq: number; outputRevision: number };
  items: ReentryItem[];
  note: string;
};
