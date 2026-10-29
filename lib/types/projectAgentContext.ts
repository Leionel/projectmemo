/** Read-only projection. Selecting a focus never starts or approves a Mission. */
export type AgentAttentionKind = "WAITING_INPUT" | "WAITING_APPROVAL" | "SOURCE_CHANGED" | "STOPPED" | "RUNNING" | "READY" | "REMINDER" | "ACTION" | "CAPTURE" | "UNAVAILABLE";
export type AgentEntityRef = { kind: "MISSION" | "INTERVENTION" | "ACTION" | "PROJECT"; id: string; version: number | null; questionId: string | null; approvalId: string | null; outputRevision: number | null };
export type ProjectAgentContext = {
  schemaVersion: 1; projectId: string; projectTitle: string;
  goalRef: { projectGoalHash: string; missionId: string | null; planRevision: number | null };
  goal: string; focusMissionId: string | null;
  nextStep: { attentionKind: AgentAttentionKind; status: string; entityRef: AgentEntityRef; title: string; reason: string; actionLabel: string; href: string; evidenceRefs: string[]; priority: number };
  observedAt: string; generatedAt: string; observationHash: string;
  freshness: "FRESH" | "PARTIAL" | "UNAVAILABLE"; fallbackReason: string | null;
};
