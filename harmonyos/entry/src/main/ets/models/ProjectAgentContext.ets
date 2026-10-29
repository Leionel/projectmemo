export interface AgentGoalRef { projectGoalHash: string; missionId: string | null; planRevision: number | null; }
export interface AgentEntityRef { kind: string; id: string; version: number | null; questionId: string | null; approvalId: string | null; outputRevision: number | null; }
export interface AgentNextStep { attentionKind: string; status: string; entityRef: AgentEntityRef; title: string; reason: string; actionLabel: string; href: string; evidenceRefs: string[]; priority: number; }
export interface ProjectAgentContext {
  schemaVersion: number; projectId: string; projectTitle: string; goalRef: AgentGoalRef; goal: string; focusMissionId: string | null;
  nextStep: AgentNextStep; observedAt: string; generatedAt: string; observationHash: string; freshness: string; fallbackReason: string | null;
}
export class AgentContextReply { context: ProjectAgentContext | null = null; }
export class AgentFocusInput { missionId: string | null = null; }
