/** Display of original work, never an execution state or authorization. */
export type WorkState = {
  phase: "QUEUED" | "RUNNING" | "WAITING_OBSERVATION" | "WAITING_USER" | "WAITING_APPROVAL" | "PAUSED" | "FAILED" | "UNKNOWN" | "COMPLETED" | "UNAVAILABLE";
  nextActor: "USER" | "AGENT" | "SYSTEM" | "UNKNOWN" | "NONE";
  requiresUser: boolean;
  reasonCode: string;
  reasonText: string;
  actionLabel: string;
  originalRef: { kind: "MISSION"; id: string; version: number };
  exactQuestionRef: string | null;
  exactApprovalRef: string | null;
  checkedAt: string;
  observedAt: string | null;
  nextCheckAt: string | null;
  nextBoundary: string | null;
  freshness: "FRESH" | "PARTIAL" | "UNAVAILABLE";
};
